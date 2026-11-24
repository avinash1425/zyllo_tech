-- 248: Employee Portal — custom scheduled reminders (admin).
--
-- Besides the 4 built-in reminders (punch in, report, punch out, deadlines; table ep_reminder_settings),
-- the admin can create their own reminders in Notifications Management:
--   title + message + normal/urgent, sent to: everyone | chosen departments | one project team | chosen people,
--   repeat: weekly on chosen days at a time (skipped on company holidays) | once on a date at a time.
-- ep_run_due_reminders() (pg_cron, every 5 minutes) now also sends custom reminders that are due:
-- at most once per day each, only within 2 hours after their time; a one-time reminder switches itself
-- off after it is sent. Each person gets it at most once per reminder per day (dedupe key).
-- Sent reminders appear in "Sent" for the admin who created them (same message_id per send).
--   ep_admin_custom_reminders() / ep_admin_save_custom_reminder(id|null, jsonb)
--   ep_admin_delete_custom_reminder(id) / ep_admin_send_custom_reminder_now(id)
-- Rollback: supabase/rollbacks/248_rollback_employee_custom_reminders.sql

begin;

create table if not exists public.ep_custom_reminders (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(btrim(title)) between 1 and 150),
  body        text check (body is null or length(body) <= 2000),
  priority    text not null default 'normal' check (priority in ('normal', 'urgent')),
  audience    text not null check (audience in ('all', 'department', 'project', 'people')),
  departments text[],
  project_id  uuid references public.pt_projects (id) on delete cascade,
  people      uuid[],
  repeat      text not null check (repeat in ('weekly', 'once')),
  days        smallint[] check (days is null or (days <@ '{1,2,3,4,5,6,7}'::smallint[] and cardinality(days) between 1 and 7)),
  send_date   date,
  send_at     time not null check (send_at between time '06:00' and time '21:55'),
  enabled     boolean not null default true,
  last_run    date,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint ep_custom_rem_schedule check (
    (repeat = 'weekly' and days is not null) or (repeat = 'once' and send_date is not null)),
  constraint ep_custom_rem_audience check (
    audience = 'all'
    or (audience = 'department' and coalesce(cardinality(departments), 0) > 0)
    or (audience = 'project' and project_id is not null)
    or (audience = 'people' and coalesce(cardinality(people), 0) > 0))
);
comment on table public.ep_custom_reminders is
  'Employee Portal: admin-made scheduled reminders. Sent by ep_run_due_reminders() via ep_send_custom_reminder().';
alter table public.ep_custom_reminders enable row level security;
revoke all on public.ep_custom_reminders from anon, authenticated;

-- Active employees a reminder goes to.
create or replace function public.ep_custom_reminder_targets(p_id uuid)
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select e.id
  from public.ep_custom_reminders r
  join public.ep_employees e on e.is_active
  where r.id = p_id
    and case r.audience
          when 'all' then true
          when 'department' then e.department = any (r.departments)
          when 'project' then exists (select 1 from public.ep_project_members m
                                       where m.project_id = r.project_id and m.employee_id = e.id)
          else e.id = any (r.people)
        end;
$$;
revoke all on function public.ep_custom_reminder_targets(uuid) from public, anon, authenticated;

-- Sends one custom reminder now (internal). Returns how many people got it (repeat sends on the
-- same day are skipped per person).
create or replace function public.ep_send_custom_reminder(p_id uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  r     public.ep_custom_reminders;
  v_msg uuid := gen_random_uuid();
  v_n   integer;
begin
  select * into r from public.ep_custom_reminders where id = p_id;
  if r.id is null then
    return 0;
  end if;
  insert into public.ep_notifications
    (employee_id, kind, priority, title, body, sender_user_id, sender_label, message_id, dedupe_key)
  select t, 'message', r.priority, r.title, r.body, r.created_by, 'Admin', v_msg,
         'custom:' || r.id || ':' || (timezone('Asia/Kolkata', now()))::date
  from public.ep_custom_reminder_targets(r.id) t
  on conflict (employee_id, dedupe_key) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.ep_send_custom_reminder(uuid) from public, anon, authenticated;

-- Scheduler: built-in reminders (as before) + custom reminders.
create or replace function public.ep_run_due_reminders()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_now     timestamp := timezone('Asia/Kolkata', now());
  v_today   date := v_now::date;
  v_holiday boolean := exists (select 1 from public.ep_holidays where holiday_date = v_today);
  v_n       integer := 0;
  s         public.ep_reminder_settings;
  c         public.ep_custom_reminders;
begin
  for s in select * from public.ep_reminder_settings
            where enabled and extract(isodow from v_today)::smallint = any (days)
              and v_now::time >= send_at and v_now::time < send_at + interval '2 hours'
              and (last_run is null or last_run < v_today)
            for update skip locked loop
    v_n := v_n + case when s.kind = 'deadlines' then public.ep_send_deadline_reminders()
                      else public.ep_send_reminders(s.kind) end;
    update public.ep_reminder_settings set last_run = v_today where kind = s.kind;
  end loop;

  for c in select * from public.ep_custom_reminders
            where enabled
              and v_now::time >= send_at and v_now::time < send_at + interval '2 hours'
              and (last_run is null or last_run < v_today)
              and ((repeat = 'weekly' and extract(isodow from v_today)::smallint = any (days) and not v_holiday)
                   or (repeat = 'once' and send_date = v_today))
            for update skip locked loop
    v_n := v_n + public.ep_send_custom_reminder(c.id);
    update public.ep_custom_reminders
       set last_run = v_today, enabled = case when repeat = 'once' then false else enabled end
     where id = c.id;
  end loop;
  return v_n;
end $$;
revoke all on function public.ep_run_due_reminders() from public, anon, authenticated;

-- ---------------------------------------------------------------- admin
create or replace function public.ep_admin_custom_reminders()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'title', r.title, 'body', r.body, 'priority', r.priority,
             'audience', r.audience, 'departments', to_jsonb(r.departments), 'project_id', r.project_id,
             'project_name', (select name from public.pt_projects where id = r.project_id),
             'people', to_jsonb(r.people),
             'people_names', (select jsonb_agg(full_name order by full_name) from public.ep_employees where id = any (r.people)),
             'repeat', r.repeat, 'days', to_jsonb(r.days), 'send_date', r.send_date,
             'send_at', to_char(r.send_at, 'HH24:MI'), 'enabled', r.enabled, 'last_run', r.last_run,
             'recipients', (select count(*) from public.ep_custom_reminder_targets(r.id)))
           order by r.enabled desc, r.send_at, r.created_at)
    from public.ep_custom_reminders r), '[]'::jsonb);
end $$;

-- p: { title, body, priority, audience, departments[], project_id, people[], repeat, days[], send_date, send_at, enabled }
create or replace function public.ep_admin_save_custom_reminder(p_id uuid, p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_title    text := btrim(coalesce(p ->> 'title', ''));
  v_body     text := nullif(btrim(coalesce(p ->> 'body', '')), '');
  v_aud      text := p ->> 'audience';
  v_repeat   text := p ->> 'repeat';
  v_at       time;
  v_date     date := nullif(p ->> 'send_date', '')::date;
  v_days     smallint[];
  v_deps     text[];
  v_people   uuid[];
  v_project  uuid := nullif(p ->> 'project_id', '')::uuid;
  v_today    date := (timezone('Asia/Kolkata', now()))::date;
  v_id       uuid;
begin
  perform public.ep_require_admin();
  if length(v_title) not between 1 and 150 then
    raise exception 'Title must be 1 to 150 characters.' using errcode = '22023';
  end if;
  if coalesce(length(v_body), 0) > 2000 then
    raise exception 'Message must be at most 2000 characters.' using errcode = '22023';
  end if;
  begin
    v_at := (p ->> 'send_at')::time;
  exception when others then
    v_at := null;
  end;
  if v_at is null or v_at < time '06:00' or v_at > time '21:55' then
    raise exception 'Choose a time between 6:00 AM and 9:55 PM.' using errcode = '22023';
  end if;
  if v_aud not in ('all', 'department', 'project', 'people') then
    raise exception 'Choose who should get it.' using errcode = '22023';
  end if;
  select array_agg(distinct btrim(x)) into v_deps
    from jsonb_array_elements_text(coalesce(p -> 'departments', '[]'::jsonb)) x where btrim(x) <> '';
  select array_agg(distinct x::uuid) into v_people
    from jsonb_array_elements_text(coalesce(p -> 'people', '[]'::jsonb)) x;
  select array_agg(distinct x::smallint order by x::smallint) into v_days
    from jsonb_array_elements_text(coalesce(p -> 'days', '[]'::jsonb)) x;
  if v_aud = 'department' and v_deps is null then
    raise exception 'Choose at least one department.' using errcode = '22023';
  end if;
  if v_aud = 'project' and (v_project is null or not exists (select 1 from public.pt_projects where id = v_project)) then
    raise exception 'Choose a project team.' using errcode = '22023';
  end if;
  if v_aud = 'people' and v_people is null then
    raise exception 'Choose at least one person.' using errcode = '22023';
  end if;
  if v_repeat = 'weekly' then
    if v_days is null or not (v_days <@ '{1,2,3,4,5,6,7}'::smallint[]) then
      raise exception 'Choose at least one day.' using errcode = '22023';
    end if;
    v_date := null;
  elsif v_repeat = 'once' then
    if v_date is null or v_date < v_today then
      raise exception 'Choose today or a later date.' using errcode = '22023';
    end if;
    v_days := null;
  else
    raise exception 'Choose weekly or one time.' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.ep_custom_reminders
      (title, body, priority, audience, departments, project_id, people, repeat, days, send_date, send_at, enabled, created_by)
    values (v_title, v_body, coalesce(nullif(p ->> 'priority', ''), 'normal'), v_aud,
            case when v_aud = 'department' then v_deps end, case when v_aud = 'project' then v_project end,
            case when v_aud = 'people' then v_people end, v_repeat, v_days, v_date, v_at,
            coalesce((p ->> 'enabled')::boolean, true), auth.uid())
    returning id into v_id;
  else
    update public.ep_custom_reminders set
      title = v_title, body = v_body, priority = coalesce(nullif(p ->> 'priority', ''), 'normal'), audience = v_aud,
      departments = case when v_aud = 'department' then v_deps end,
      project_id  = case when v_aud = 'project' then v_project end,
      people      = case when v_aud = 'people' then v_people end,
      repeat = v_repeat, days = v_days, send_date = v_date, send_at = v_at,
      enabled = coalesce((p ->> 'enabled')::boolean, enabled),
      -- a changed one-time reminder may run again
      last_run = case when v_repeat = 'once' then null else last_run end,
      updated_at = now()
    where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'Reminder not found.' using errcode = 'P0002';
    end if;
  end if;
  return public.ep_admin_custom_reminders();
end $$;

create or replace function public.ep_admin_delete_custom_reminder(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  delete from public.ep_custom_reminders where id = p_id;
  if not found then
    raise exception 'Reminder not found.' using errcode = 'P0002';
  end if;
  return public.ep_admin_custom_reminders();
end $$;

create or replace function public.ep_admin_send_custom_reminder_now(p_id uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  if not exists (select 1 from public.ep_custom_reminders where id = p_id) then
    raise exception 'Reminder not found.' using errcode = 'P0002';
  end if;
  return public.ep_send_custom_reminder(p_id);
end $$;

revoke all on function public.ep_admin_custom_reminders(), public.ep_admin_save_custom_reminder(uuid, jsonb),
  public.ep_admin_delete_custom_reminder(uuid), public.ep_admin_send_custom_reminder_now(uuid) from public, anon;
grant execute on function public.ep_admin_custom_reminders(), public.ep_admin_save_custom_reminder(uuid, jsonb),
  public.ep_admin_delete_custom_reminder(uuid), public.ep_admin_send_custom_reminder_now(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
