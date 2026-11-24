-- 256: Employee Portal — ADMIN notifications inbox (Admin -> Admin Notifications + bell in the top bar).
--
-- The admin is notified automatically when an EMPLOYEE (or a reporting manager) does something:
--   leave      : applied, cancelled; manager accepted / rejected (two-step approval, 255)
--   attendance : punched in late (first punch of the day after the late time), auto punched out
--                (forgot to punch out), correction requested / withdrawn
--   report     : daily work report submitted
--   project    : task added, task status changed, delay reason given (task / project), update posted
--   profile    : personal / contact details, emergency contacts, documents uploaded / deleted
--   account    : first sign-in (temporary password changed)
-- Done with AFTER triggers on the existing tables, so no existing function changes. A trigger only
-- notifies when the change was made by the employee themself (auth.uid() = their login) — changes the
-- admin makes do not notify the admin. Auto punch-out (done by the nightly job) always notifies.
-- A failing notification never blocks the employee's action (errors become warnings).
--
--   ep_admin_notifications       one row per event (shared by all admins); kept 180 days
--   ep_admin_notification_reads  read state PER ADMIN (each admin has their own unread count)
--   RPCs (admins only): ep_admin_inbox(filter, limit), ep_admin_inbox_summary(), ep_admin_inbox_mark_read(ids)
-- Rollback: supabase/rollbacks/256_rollback_employee_admin_inbox.sql

begin;

-- ================================================================ tables
create table if not exists public.ep_admin_notifications (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid references public.ep_employees (id) on delete cascade,
  kind        text not null check (kind in ('leave', 'attendance', 'report', 'project', 'profile', 'account')),
  priority    text not null default 'normal' check (priority in ('normal', 'urgent')),
  title       text not null check (length(btrim(title)) between 1 and 200),
  body        text check (body is null or length(body) <= 2000),
  link        text check (link is null or link ~ '^/admin(/|$|\?)'),
  dedupe_key  text,
  created_at  timestamptz not null default now()
);
create index if not exists ep_admin_notifications_created_idx on public.ep_admin_notifications (created_at desc);
create index if not exists ep_admin_notifications_dedupe_idx on public.ep_admin_notifications (dedupe_key, created_at desc)
  where dedupe_key is not null;
comment on table public.ep_admin_notifications is
  'Employee Portal: events for the admin inbox (written by triggers through ep_admin_notify).';

create table if not exists public.ep_admin_notification_reads (
  notification_id uuid not null references public.ep_admin_notifications (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (notification_id, user_id)
);
comment on table public.ep_admin_notification_reads is 'Employee Portal: which admin has read which admin notification.';

alter table public.ep_admin_notifications enable row level security;
alter table public.ep_admin_notification_reads enable row level security;
revoke all on public.ep_admin_notifications, public.ep_admin_notification_reads from anon, authenticated;
-- No policies: read and written only through the security-definer functions below.

-- ================================================================ helpers (internal)
create or replace function public.ep_admin_notify(
  p_emp uuid, p_kind text, p_title text, p_body text, p_link text,
  p_priority text default 'normal', p_dedupe text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  -- Same event again within 2 minutes (e.g. several rows saved at once): one notification is enough.
  if p_dedupe is not null and exists (
       select 1 from public.ep_admin_notifications
        where dedupe_key = p_dedupe and created_at > now() - interval '2 minutes') then
    return;
  end if;
  insert into public.ep_admin_notifications (employee_id, kind, priority, title, body, link, dedupe_key)
  values (p_emp, p_kind, coalesce(p_priority, 'normal'), left(btrim(p_title), 200), left(p_body, 2000), p_link, p_dedupe);
  -- Keep the inbox small: now and then remove events older than 180 days.
  if random() < 0.02 then
    delete from public.ep_admin_notifications where created_at < now() - interval '180 days';
  end if;
end $$;

-- The employee row of the person signed in right now (null for admins, the nightly job, SQL editor).
create or replace function public.ep_actor_employee()
returns public.ep_employees
language sql stable security definer set search_path = ''
as $$
  select e.* from public.ep_employees e where e.user_id = auth.uid() limit 1;
$$;

create or replace function public.ep_admin_fmt_dates(p_start date, p_end date)
returns text
language sql immutable set search_path = ''
as $$
  select to_char(p_start, 'DD Mon YYYY')
         || case when p_end is distinct from p_start then ' – ' || to_char(p_end, 'DD Mon YYYY') else '' end;
$$;

revoke all on function public.ep_admin_notify(uuid, text, text, text, text, text, text),
  public.ep_actor_employee(), public.ep_admin_fmt_dates(date, date) from public, anon, authenticated;

-- ================================================================ triggers
-- Leave: applied / cancelled by the employee; final decision by the reporting manager.
create or replace function public.ep_trg_admin_leave()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor public.ep_employees := public.ep_actor_employee();
  v_emp   public.ep_employees;
  v_type  text;
begin
  begin
    select * into v_emp from public.ep_employees where id = new.employee_id;
    select name into v_type from public.ep_leave_types where code = new.leave_type;
    if tg_op = 'INSERT' and v_actor.id = new.employee_id then
      perform public.ep_admin_notify(new.employee_id, 'leave',
        v_emp.full_name || ' applied for ' || v_type,
        public.ep_admin_fmt_dates(new.start_date, new.end_date) || ' · ' || trim(to_char(new.days, 'FM990.9')) || ' day(s) · '
          || left(new.reason, 200) || ' · waiting for your approval',
        '/admin/leave');
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
      if new.status = 'cancelled' and v_actor.id = new.employee_id then
        perform public.ep_admin_notify(new.employee_id, 'leave',
          v_emp.full_name || ' cancelled a leave request',
          v_type || ' · ' || public.ep_admin_fmt_dates(new.start_date, new.end_date), '/admin/leave');
      elsif old.status = 'manager_pending' and new.status in ('approved', 'rejected')
            and new.decided_by is not null and v_actor.id = new.decided_by then
        perform public.ep_admin_notify(new.employee_id, 'leave',
          v_actor.full_name || case when new.status = 'approved' then ' accepted ' else ' rejected ' end
            || v_emp.full_name || '''s leave',
          v_type || ' · ' || public.ep_admin_fmt_dates(new.start_date, new.end_date)
            || ' · final decision by the reporting manager' || coalesce(' · ' || new.decision_comment, ''),
          '/admin/leave?tab=requests');
      end if;
    end if;
  exception when others then
    raise warning 'admin notification (leave) skipped: %', sqlerrm;
  end;
  return null;
end $$;

-- Attendance: late first punch-in (by the employee); auto punch-out (nightly job).
create or replace function public.ep_trg_admin_attendance()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor public.ep_employees := public.ep_actor_employee();
  v_emp   public.ep_employees;
  v_late  time;
  v_in    time;
begin
  begin
    select * into v_emp from public.ep_employees where id = new.employee_id;
    if tg_op = 'INSERT' and v_actor.id = new.employee_id then
      v_late := coalesce((public.ep_attendance_rules() ->> 'late_after')::time, time '09:40');
      v_in := (new.punch_in_at at time zone 'Asia/Kolkata')::time;
      if v_in > v_late and not exists (
           select 1 from public.ep_attendance a
            where a.employee_id = new.employee_id and a.work_date = new.work_date and a.id <> new.id) then
        perform public.ep_admin_notify(new.employee_id, 'attendance',
          v_emp.full_name || ' punched in late at ' || to_char(new.punch_in_at at time zone 'Asia/Kolkata', 'HH12:MI am'),
          to_char(new.work_date, 'Dy DD Mon YYYY') || ' · late after ' || to_char(v_late, 'HH12:MI am'),
          '/admin/attendance?tab=late');
      end if;
    elsif tg_op = 'UPDATE' and new.auto_punched_out and not coalesce(old.auto_punched_out, false) then
      perform public.ep_admin_notify(new.employee_id, 'attendance',
        v_emp.full_name || ' forgot to punch out',
        to_char(new.work_date, 'Dy DD Mon YYYY') || ' · punched out automatically at '
          || to_char(new.punch_out_at at time zone 'Asia/Kolkata', 'HH12:MI am'),
        '/admin/attendance?tab=missing');
    end if;
  exception when others then
    raise warning 'admin notification (attendance) skipped: %', sqlerrm;
  end;
  return null;
end $$;

-- Attendance corrections: requested / withdrawn by the employee.
create or replace function public.ep_trg_admin_correction()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor public.ep_employees := public.ep_actor_employee();
  v_emp   public.ep_employees;
begin
  begin
    if v_actor.id is distinct from new.employee_id then
      return null;
    end if;
    select * into v_emp from public.ep_employees where id = new.employee_id;
    if tg_op = 'INSERT' then
      perform public.ep_admin_notify(new.employee_id, 'attendance',
        v_emp.full_name || ' requested an attendance correction',
        to_char(new.work_date, 'Dy DD Mon YYYY') || ' · ' || left(coalesce(new.reason, ''), 200) || ' · waiting for your decision',
        '/admin/attendance?tab=corrections');
    elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' then
      perform public.ep_admin_notify(new.employee_id, 'attendance',
        v_emp.full_name || ' withdrew an attendance correction',
        to_char(new.work_date, 'Dy DD Mon YYYY'), '/admin/attendance?tab=corrections');
    end if;
  exception when others then
    raise warning 'admin notification (correction) skipped: %', sqlerrm;
  end;
  return null;
end $$;

-- Daily work report submitted by the employee.
create or replace function public.ep_trg_admin_report()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor public.ep_employees := public.ep_actor_employee();
  v_emp   public.ep_employees;
begin
  begin
    if v_actor.id is distinct from new.employee_id or new.status <> 'submitted'
       or (tg_op = 'UPDATE' and old.status = 'submitted') then
      return null;
    end if;
    select * into v_emp from public.ep_employees where id = new.employee_id;
    perform public.ep_admin_notify(new.employee_id, 'report',
      v_emp.full_name || ' submitted the daily report',
      'Report for ' || to_char(new.report_date, 'Dy DD Mon YYYY')
        || case when new.submitted_to is null then ' · waiting for your review' else '' end,
      '/admin/reports');
  exception when others then
    raise warning 'admin notification (report) skipped: %', sqlerrm;
  end;
  return null;
end $$;

-- Profile: personal / contact details and emergency contacts changed by the employee.
create or replace function public.ep_trg_admin_profile()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor public.ep_employees := public.ep_actor_employee();
  v_emp_id uuid := case when tg_op = 'DELETE' then old.employee_id else new.employee_id end;
  v_what   text := case when tg_table_name = 'ep_emergency_contacts' then 'emergency contacts' else 'personal / contact details' end;
begin
  begin
    if v_actor.id is distinct from v_emp_id then
      return null;
    end if;
    perform public.ep_admin_notify(v_emp_id, 'profile',
      v_actor.full_name || ' updated their ' || v_what,
      'Open their profile to see the details.', '/admin/employees/' || v_emp_id,
      'normal', tg_table_name || ':' || v_emp_id);
  exception when others then
    raise warning 'admin notification (profile) skipped: %', sqlerrm;
  end;
  return null;
end $$;

-- Documents uploaded / deleted by the employee.
create or replace function public.ep_trg_admin_document()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor public.ep_employees := public.ep_actor_employee();
  v_row   public.ep_employee_documents := case when tg_op = 'DELETE' then old else new end;
begin
  begin
    if v_actor.id is distinct from v_row.employee_id then
      return null;
    end if;
    perform public.ep_admin_notify(v_row.employee_id, 'profile',
      v_actor.full_name || case when tg_op = 'DELETE' then ' deleted a document' else ' uploaded a document' end,
      v_row.title || ' · ' || v_row.file_name, '/admin/employees/' || v_row.employee_id);
  exception when others then
    raise warning 'admin notification (document) skipped: %', sqlerrm;
  end;
  return null;
end $$;

-- Projects: task added / status changed / delay reason by an employee; project update posted;
-- project delay reason given.
create or replace function public.ep_trg_admin_task()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor public.ep_employees := public.ep_actor_employee();
  v_proj  text;
  v_label text;
begin
  begin
    if v_actor.id is null then
      return null;
    end if;
    select coalesce(project_code || ' · ', '') || name into v_proj from public.pt_projects where id = new.project_id;
    if tg_op = 'INSERT' then
      perform public.ep_admin_notify(v_actor.id, 'project',
        v_actor.full_name || ' added a task',
        '“' || new.title || '” · ' || v_proj, '/admin/project-management/' || new.project_id);
    else
      if new.status is distinct from old.status then
        v_label := case new.status when 'done' then 'Done' when 'in_progress' then 'In progress' when 'todo' then 'To do' else new.status end;
        perform public.ep_admin_notify(v_actor.id, 'project',
          v_actor.full_name || ' marked a task as ' || v_label,
          '“' || new.title || '” · ' || v_proj, '/admin/project-management/' || new.project_id,
          'normal', 'task:' || new.id || ':' || new.status);
      end if;
      if new.delay_reason is not null and new.delay_reason is distinct from old.delay_reason then
        perform public.ep_admin_notify(v_actor.id, 'project',
          v_actor.full_name || ' gave a delay reason for a task',
          '“' || new.title || '” · ' || v_proj || ' · ' || left(new.delay_reason, 300),
          '/admin/project-management/' || new.project_id);
      end if;
    end if;
  exception when others then
    raise warning 'admin notification (task) skipped: %', sqlerrm;
  end;
  return null;
end $$;

create or replace function public.ep_trg_admin_project_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor public.ep_employees := public.ep_actor_employee();
  v_proj  text;
begin
  begin
    if v_actor.id is null or v_actor.id is distinct from new.author_id then
      return null;
    end if;
    select coalesce(project_code || ' · ', '') || name into v_proj from public.pt_projects where id = new.project_id;
    perform public.ep_admin_notify(v_actor.id, 'project',
      v_actor.full_name || ' posted a project update',
      v_proj || ' · ' || left(new.body, 300), '/admin/project-management/' || new.project_id);
  exception when others then
    raise warning 'admin notification (project update) skipped: %', sqlerrm;
  end;
  return null;
end $$;

create or replace function public.ep_trg_admin_project_delay()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor public.ep_employees := public.ep_actor_employee();
  v_proj  text;
begin
  begin
    if v_actor.id is distinct from new.employee_id
       or (tg_op = 'UPDATE' and new.reason is not distinct from old.reason) then
      return null;
    end if;
    select coalesce(project_code || ' · ', '') || name into v_proj from public.pt_projects where id = new.project_id;
    perform public.ep_admin_notify(new.employee_id, 'project',
      v_actor.full_name || ' gave a reason for the project delay',
      v_proj || ' · deadline ' || to_char(new.deadline, 'DD Mon YYYY') || ' · ' || left(new.reason, 300),
      '/admin/project-management/' || new.project_id);
  exception when others then
    raise warning 'admin notification (project delay) skipped: %', sqlerrm;
  end;
  return null;
end $$;

-- Account: first sign-in (the employee replaced the temporary password).
create or replace function public.ep_trg_admin_account()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  begin
    if old.must_change_password and not new.must_change_password then
      perform public.ep_admin_notify(new.id, 'account',
        new.full_name || ' signed in for the first time',
        new.employee_code || ' set their own password and can now use the Employee Portal.',
        '/admin/employees/' || new.id);
    end if;
  exception when others then
    raise warning 'admin notification (account) skipped: %', sqlerrm;
  end;
  return null;
end $$;

revoke all on function public.ep_trg_admin_leave(), public.ep_trg_admin_attendance(), public.ep_trg_admin_correction(),
  public.ep_trg_admin_report(), public.ep_trg_admin_profile(), public.ep_trg_admin_document(),
  public.ep_trg_admin_task(), public.ep_trg_admin_project_update(), public.ep_trg_admin_project_delay(),
  public.ep_trg_admin_account() from public, anon, authenticated;

drop trigger if exists ep_admin_leave on public.ep_leave_requests;
create trigger ep_admin_leave after insert or update of status on public.ep_leave_requests
  for each row execute function public.ep_trg_admin_leave();
drop trigger if exists ep_admin_attendance on public.ep_attendance;
create trigger ep_admin_attendance after insert or update of auto_punched_out on public.ep_attendance
  for each row execute function public.ep_trg_admin_attendance();
drop trigger if exists ep_admin_correction on public.ep_attendance_corrections;
create trigger ep_admin_correction after insert or update of status on public.ep_attendance_corrections
  for each row execute function public.ep_trg_admin_correction();
drop trigger if exists ep_admin_report on public.ep_work_reports;
create trigger ep_admin_report after insert or update of status on public.ep_work_reports
  for each row execute function public.ep_trg_admin_report();
drop trigger if exists ep_admin_profile on public.ep_employee_profiles;
create trigger ep_admin_profile after insert or update on public.ep_employee_profiles
  for each row execute function public.ep_trg_admin_profile();
drop trigger if exists ep_admin_contacts on public.ep_emergency_contacts;
create trigger ep_admin_contacts after insert or update or delete on public.ep_emergency_contacts
  for each row execute function public.ep_trg_admin_profile();
drop trigger if exists ep_admin_document on public.ep_employee_documents;
create trigger ep_admin_document after insert or delete on public.ep_employee_documents
  for each row execute function public.ep_trg_admin_document();
drop trigger if exists ep_admin_task on public.ep_project_tasks;
create trigger ep_admin_task after insert or update of status, delay_reason on public.ep_project_tasks
  for each row execute function public.ep_trg_admin_task();
drop trigger if exists ep_admin_project_update on public.ep_project_updates;
create trigger ep_admin_project_update after insert on public.ep_project_updates
  for each row execute function public.ep_trg_admin_project_update();
drop trigger if exists ep_admin_project_delay on public.ep_project_delay_reasons;
create trigger ep_admin_project_delay after insert or update of reason on public.ep_project_delay_reasons
  for each row execute function public.ep_trg_admin_project_delay();
drop trigger if exists ep_admin_account on public.ep_employees;
create trigger ep_admin_account after update of must_change_password on public.ep_employees
  for each row execute function public.ep_trg_admin_account();

-- ================================================================ admin RPCs
create or replace function public.ep_admin_inbox(p_filter text default 'all', p_limit int default 200)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  perform public.ep_require_admin();
  return jsonb_build_object(
    'unread', (select count(*) from public.ep_admin_notifications n
                where not exists (select 1 from public.ep_admin_notification_reads r
                                   where r.notification_id = n.id and r.user_id = v_uid)),
    'counts', coalesce((select jsonb_object_agg(kind, c) from (
                 select kind, count(*) c from public.ep_admin_notifications n
                  where not exists (select 1 from public.ep_admin_notification_reads r
                                     where r.notification_id = n.id and r.user_id = v_uid)
                  group by kind) k), '{}'::jsonb),
    'items', coalesce((
      select jsonb_agg(x.j order by x.created_at desc) from (
        select n.created_at, jsonb_build_object(
                 'id', n.id, 'kind', n.kind, 'priority', n.priority, 'title', n.title, 'body', n.body,
                 'link', n.link, 'created_at', n.created_at,
                 'read', exists (select 1 from public.ep_admin_notification_reads r
                                  where r.notification_id = n.id and r.user_id = v_uid),
                 'employee', (select jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code)
                                from public.ep_employees e where e.id = n.employee_id)) j
          from public.ep_admin_notifications n
         where case coalesce(p_filter, 'all')
                 when 'all' then true
                 when 'unread' then not exists (select 1 from public.ep_admin_notification_reads r
                                                 where r.notification_id = n.id and r.user_id = v_uid)
                 else n.kind = p_filter end
         order by n.created_at desc
         limit least(greatest(coalesce(p_limit, 200), 1), 500)) x), '[]'::jsonb));
end $$;

create or replace function public.ep_admin_inbox_summary()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  perform public.ep_require_admin();
  return jsonb_build_object('unread', (
    select count(*) from public.ep_admin_notifications n
     where not exists (select 1 from public.ep_admin_notification_reads r
                        where r.notification_id = n.id and r.user_id = v_uid)));
end $$;

-- p_ids null = mark everything read (for the signed-in admin only).
create or replace function public.ep_admin_inbox_mark_read(p_ids uuid[] default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  insert into public.ep_admin_notification_reads (notification_id, user_id)
  select n.id, auth.uid() from public.ep_admin_notifications n
   where p_ids is null or n.id = any (p_ids)
  on conflict do nothing;
end $$;

revoke all on function public.ep_admin_inbox(text, int), public.ep_admin_inbox_summary(),
  public.ep_admin_inbox_mark_read(uuid[]) from public, anon;
grant execute on function public.ep_admin_inbox(text, int), public.ep_admin_inbox_summary(),
  public.ep_admin_inbox_mark_read(uuid[]) to authenticated;

notify pgrst, 'reload schema';

commit;
