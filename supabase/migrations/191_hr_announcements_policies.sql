-- =====================================================================
-- 191_hr_announcements_policies.sql — Module 13: Announcements & Policies
-- =====================================================================
-- Builds on 108_hr_announcements.sql (announcements, receipts, fan-out)
-- and 129_hr_employee_documents.sql (versioned policies + acknowledgements).
-- Adds what the HR / Employee Portal screens need on top of them:
--   * 'handbook' policy category, so the employee handbook is a versioned,
--     acknowledgeable policy like any other;
--   * per-announcement progress (audience / read / acknowledged) in one call;
--   * per-employee recipient list for an announcement (HR only);
--   * throttled acknowledgement reminders for announcements, with a ledger;
--   * a pg_cron job (when pg_cron is installed) that publishes scheduled
--     announcements. Without pg_cron, opening the HR module runs it too.
-- Nothing here grants new permissions: announcements.manage / view_all and
-- documents.manage / view from 100_hr_foundation.sql still decide access.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Employee handbook as a policy category
-- ---------------------------------------------------------------------
alter table public.hr_policies drop constraint if exists hr_policies_category_check;
alter table public.hr_policies add constraint hr_policies_category_check
  check (category in ('general','code_of_conduct','hr','leave_attendance','it_security','health_safety',
                      'compliance','benefits','handbook','other'));

-- hr_save_policy validates the category itself; same body as 129 with 'handbook' added.
create or replace function public.hr_save_policy(p_policy uuid, p_values jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb := coalesce(p_values, '{}'::jsonb); p public.hr_policies; v_id uuid; v_draft public.hr_policy_versions;
        v_type text; v_ids uuid[]; v_codes text[]; v_bad text; v_next int;
begin
  if not hr_private.has_permission('documents.manage') then
    perform hr_private.fail('You are not allowed to manage policies.', 'forbidden');
  end if;
  if jsonb_typeof(v) <> 'object' then perform hr_private.fail('Policy values must be an object.', 'invalid'); end if;
  select string_agg(k, ', ') into v_bad from jsonb_object_keys(v) k
   where k not in ('title','category','requires_acknowledgement','employee_visible','audience_type','audience_ids','audience_codes',
                   'content','effective_date','change_summary');
  if v_bad is not null then perform hr_private.fail('Unknown policy field(s): ' || v_bad || '.', 'invalid'); end if;
  if length(coalesce(v ->> 'content', '')) > 100000 then
    perform hr_private.fail('The policy text is too long (100000 characters maximum).', 'invalid');
  end if;
  if p_policy is not null then
    select * into p from public.hr_policies where id = p_policy for update;
    if p.id is null then perform hr_private.fail('Policy not found.', 'not_found'); end if;
    if p.status = 'archived' then perform hr_private.fail('An archived policy cannot be edited.', 'invalid_state'); end if;
  end if;
  p.title := coalesce(hr_private.doc_jtext(v, 'title', 200), p.title);
  if p.title is null or length(p.title) < 2 then perform hr_private.fail('Give the policy a title.', 'invalid'); end if;
  p.category := coalesce(hr_private.doc_jtext(v, 'category', 40), p.category, 'general');
  if p.category not in ('general','code_of_conduct','hr','leave_attendance','it_security','health_safety','compliance','benefits','handbook','other') then
    perform hr_private.fail('Unknown policy category.', 'invalid');
  end if;
  if v ? 'requires_acknowledgement' then p.requires_acknowledgement := (v ->> 'requires_acknowledgement')::boolean; end if;
  if v ? 'employee_visible' then p.employee_visible := (v ->> 'employee_visible')::boolean; end if;
  v_type := coalesce(hr_private.doc_jtext(v, 'audience_type', 40), p.audience_type, 'all');
  if v_type not in ('all','departments','locations','employment_types','employees') then perform hr_private.fail('Unknown audience.', 'invalid'); end if;
  v_ids := case when v ? 'audience_ids' then coalesce(array(select hr_private.doc_juuid(jsonb_build_object('x', x), 'x')
                                                             from jsonb_array_elements_text(v -> 'audience_ids') x), '{}') else coalesce(p.audience_ids, '{}') end;
  if array_position(v_ids, null) is not null then perform hr_private.fail('Audience contains an invalid id.', 'invalid'); end if;
  v_codes := case when v ? 'audience_codes' then coalesce(array(select x from jsonb_array_elements_text(v -> 'audience_codes') x), '{}') else coalesce(p.audience_codes, '{}') end;
  if v_type in ('departments','locations','employees') and cardinality(v_ids) = 0
     or v_type = 'employment_types' and cardinality(v_codes) = 0 then
    perform hr_private.fail('Choose who the policy applies to.', 'audience_required');
  end if;
  if v_type = 'all' then v_ids := '{}'; v_codes := '{}'; elsif v_type = 'employment_types' then v_ids := '{}'; else v_codes := '{}'; end if;

  if p_policy is null then
    insert into public.hr_policies (title, category, requires_acknowledgement, employee_visible, audience_type, audience_ids, audience_codes, updated_by)
    values (p.title, p.category, coalesce(p.requires_acknowledgement, true), coalesce(p.employee_visible, true), v_type, v_ids, v_codes, auth.uid())
    returning id into v_id;
  else
    update public.hr_policies set title = p.title, category = p.category, requires_acknowledgement = p.requires_acknowledgement,
           employee_visible = p.employee_visible, audience_type = v_type, audience_ids = v_ids, audience_codes = v_codes, updated_by = auth.uid()
     where id = p.id;
    v_id := p.id;
  end if;

  if p_policy is null or v ? 'content' or v ? 'effective_date' or v ? 'change_summary' then
    select * into v_draft from public.hr_policy_versions where policy_id = v_id and status = 'draft';
    if v_draft.id is null then
      v_next := coalesce((select max(version) from public.hr_policy_versions where policy_id = v_id), 0) + 1;
      insert into public.hr_policy_versions (policy_id, version, status, content, effective_date, change_summary)
      values (v_id, v_next, 'draft',
              case when v ? 'content' then nullif(v ->> 'content', '') else (select content from public.hr_policy_versions where policy_id = v_id and status = 'published') end,
              hr_private.doc_jdate(v, 'effective_date'), hr_private.doc_jtext(v, 'change_summary', 1000));
    else
      update public.hr_policy_versions
         set content = case when v ? 'content' then nullif(v ->> 'content', '') else content end,
             effective_date = case when v ? 'effective_date' then hr_private.doc_jdate(v, 'effective_date') else effective_date end,
             change_summary = case when v ? 'change_summary' then hr_private.doc_jtext(v, 'change_summary', 1000) else change_summary end
       where id = v_draft.id;
    end if;
  end if;
  return jsonb_build_object('policy_id', v_id,
    'draft_version', (select version from public.hr_policy_versions where policy_id = v_id and status = 'draft'));
end $$;

-- ---------------------------------------------------------------------
-- 2. Announcement reminder ledger (append-only, written by the RPC only)
-- ---------------------------------------------------------------------
create table public.hr_announcement_reminders (
  id              bigint generated always as identity primary key,
  announcement_id uuid not null references public.hr_announcements(id) on delete cascade,
  employee_id     uuid not null references public.hr_employees(id) on delete cascade,
  reminded_at     timestamptz not null default now(),
  reminded_by     uuid
);
create index hr_announcement_reminders_lookup on public.hr_announcement_reminders(announcement_id, employee_id, reminded_at desc);

select hr_private.secure_table('public.hr_announcement_reminders');
create policy hr_announcement_reminders_read on public.hr_announcement_reminders for select to authenticated using (
     hr_private.can_manage_announcements() or hr_private.has_permission('announcements.view_all'));
revoke insert, update, delete on public.hr_announcement_reminders from authenticated;

create or replace function hr_private.can_view_announcement_tracking()
returns boolean language sql stable security definer set search_path = '' as $$
  select hr_private.can_manage_announcements() or hr_private.has_permission('announcements.view_all')
$$;

-- ---------------------------------------------------------------------
-- 3. Progress for every announcement (one round trip for the HR list)
-- ---------------------------------------------------------------------
-- audience = current employees in the audience (drafts included, so HR sees
-- the reach before publishing); read / acknowledged = receipts.
create or replace function public.hr_announcement_progress()
returns table (announcement_id uuid, audience bigint, read bigint, acknowledged bigint, reminders bigint, last_reminded_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not hr_private.can_view_announcement_tracking() then
    perform hr_private.fail('You are not allowed to view announcement tracking.', 'forbidden');
  end if;
  return query
    select a.id,
           (select count(*) from hr_private.announcement_targets(a.id)),
           (select count(*) from public.hr_announcement_receipts r where r.announcement_id = a.id and r.read_at is not null),
           (select count(*) from public.hr_announcement_receipts r where r.announcement_id = a.id and r.acknowledged_at is not null),
           (select count(*) from public.hr_announcement_reminders m where m.announcement_id = a.id),
           (select max(m.reminded_at) from public.hr_announcement_reminders m where m.announcement_id = a.id)
    from public.hr_announcements a
    where a.status <> 'archived' or a.archived_at > now() - interval '180 days';
end $$;

-- ---------------------------------------------------------------------
-- 4. Who has / has not read or acknowledged one announcement
-- ---------------------------------------------------------------------
create or replace function public.hr_announcement_recipients(p_announcement uuid)
returns table (employee_id uuid, employee_code text, employee_name text, department_name text, portal_access boolean,
               read_at timestamptz, acknowledged_at timestamptz, reminder_count bigint, last_reminded_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not hr_private.can_view_announcement_tracking() then
    perform hr_private.fail('You are not allowed to view announcement tracking.', 'forbidden');
  end if;
  if not exists (select 1 from public.hr_announcements where id = p_announcement) then
    perform hr_private.fail('Announcement not found.', 'not_found');
  end if;
  return query
    select e.id, e.employee_code::text,
           coalesce(nullif(btrim(e.display_name), ''), btrim(e.first_name || ' ' || e.last_name))::text,
           d.name::text, e.portal_access,
           r.read_at, r.acknowledged_at,
           (select count(*) from public.hr_announcement_reminders m where m.announcement_id = p_announcement and m.employee_id = e.id),
           (select max(m.reminded_at) from public.hr_announcement_reminders m where m.announcement_id = p_announcement and m.employee_id = e.id)
    from hr_private.announcement_targets(p_announcement) t
    join public.hr_employees e on e.id = t.employee_id
    left join public.hr_departments d on d.id = e.department_id
    left join public.hr_announcement_receipts r on r.announcement_id = p_announcement and r.employee_id = e.id
    order by (r.acknowledged_at is not null), (r.read_at is not null), e.first_name, e.last_name;
end $$;

-- ---------------------------------------------------------------------
-- 5. Throttled reminders: live announcements that require acknowledgement
-- ---------------------------------------------------------------------
-- Reminds every unacknowledged portal user in the audience (or one employee),
-- skipping anyone reminded within documents.acknowledgement_reminder_hours.
-- Returns how many reminders were sent.
create or replace function public.hr_remind_announcement(p_announcement uuid, p_employee uuid default null)
returns int language plpgsql security definer set search_path = '' as $$
declare
  a public.hr_announcements;
  r record;
  v_n int := 0;
  v_hours int := coalesce((hr_private.doc_settings() ->> 'acknowledgement_reminder_hours')::int, 24);
begin
  if not hr_private.can_manage_announcements() then
    perform hr_private.fail('You are not allowed to send reminders.', 'forbidden');
  end if;
  select * into a from public.hr_announcements where id = p_announcement;
  if a.id is null then perform hr_private.fail('Announcement not found.', 'not_found'); end if;
  if a.status <> 'published' or (a.expires_at is not null and a.expires_at <= now()) then
    perform hr_private.fail('Only live announcements can be reminded.', 'invalid_state');
  end if;
  if not a.requires_acknowledgement then
    perform hr_private.fail('This announcement does not require acknowledgement.', 'not_required');
  end if;
  for r in
    select e.id, e.user_id
    from hr_private.announcement_targets(p_announcement) t
    join public.hr_employees e on e.id = t.employee_id
    where (p_employee is null or e.id = p_employee)
      and e.user_id is not null and e.portal_access
      and not exists (select 1 from public.hr_announcement_receipts x
                      where x.announcement_id = p_announcement and x.employee_id = e.id and x.acknowledged_at is not null)
      and not exists (select 1 from public.hr_announcement_reminders m
                      where m.announcement_id = p_announcement and m.employee_id = e.id
                        and m.reminded_at > now() - make_interval(hours => v_hours))
  loop
    perform hr_private.notify_user(r.user_id, 'acknowledgement_reminder', 'Acknowledgement pending: ' || a.title,
      'Please read this announcement and acknowledge it in the Employee Portal.',
      '/employee/announcements?id=' || p_announcement, 'hr_announcements', p_announcement::text);
    insert into public.hr_announcement_reminders (announcement_id, employee_id, reminded_by) values (p_announcement, r.id, auth.uid());
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then
    perform hr_private.audit_event('ANNOUNCEMENT_REMINDED', 'hr_announcements', p_announcement::text, jsonb_build_object('reminded', v_n));
  end if;
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- 6. Scheduler: publish due announcements every 5 minutes (pg_cron only)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'hr-scheduled-announcements';
    perform cron.schedule('hr-scheduled-announcements', '*/5 * * * *', 'select public.hr_process_scheduled_announcements()');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke execute on all functions in schema hr_private from anon, public;
grant execute on all functions in schema hr_private to authenticated, service_role;
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = any (array['hr_announcement_progress','hr_announcement_recipients','hr_remind_announcement'])
  loop
    execute format('revoke execute on function %s from anon, public', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
