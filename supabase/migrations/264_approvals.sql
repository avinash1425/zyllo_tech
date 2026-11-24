-- 264: Approvals on the admin side.
--   1. No self-approval: nobody decides their OWN leave, attendance correction or daily report in the admin area.
--   2. Admin Notifications are filtered: each person only sees notifications of pages they may open
--      (leave -> Leave Management, attendance -> Attendance, report -> Daily Work Reports,
--       project -> Project Management, profile / account -> Employee Management).
--   3. Named approver: ep_employees.admin_approver_id (set in Employee Management). When set, only that person
--      (or a Super Admin) decides the employee's leave (admin step), attendance corrections and daily reports,
--      and only they (and Super Admins) get those notifications. When empty: anyone with the permission.
--   4. The name of the admin who decided is shown (instead of "Admin").
-- Rollback: supabase/rollbacks/264_rollback_approvals.sql

begin;

alter table public.ep_employees
  add column if not exists admin_approver_id uuid references auth.users (id) on delete set null;
comment on column public.ep_employees.admin_approver_id is
  'Who decides this employee''s requests on the admin side (null = anyone with the permission). Migration 264.';

-- ================================================================ helpers (internal)
-- Display name of any account: employee name, else the name given when the user was added, else the email.
create or replace function public.ep_user_display_name(p_user uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select e.full_name from public.ep_employees e where e.user_id = p_user limit 1),
    (select nullif(btrim(u.raw_user_meta_data ->> 'full_name'), '') from auth.users u where u.id = p_user),
    (select split_part(u.email, '@', 1) from auth.users u where u.id = p_user),
    'Admin');
$$;

create or replace function public.ep_is_super_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.rbac_user_roles where user_id = auth.uid() and role_key = 'super_admin');
$$;

-- Refuse when the signed-in person would decide their own request.
create or replace function public.ep_require_not_self(p_emp uuid)
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.ep_employees where id = p_emp and user_id = auth.uid()) then
    raise exception 'You cannot decide your own request. Another admin has to do it.' using errcode = '42501';
  end if;
end $$;

-- Refuse when the employee has a named approver who is someone else (Super Admins may always decide).
create or replace function public.ep_require_approver(p_emp uuid)
returns void
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_appr uuid;
begin
  select admin_approver_id into v_appr from public.ep_employees where id = p_emp;
  if v_appr is not null and v_appr <> auth.uid() and not public.ep_is_super_admin() then
    raise exception 'Only % (the approver set for this employee) or a Super Admin can decide this.',
      public.ep_user_display_name(v_appr) using errcode = '42501';
  end if;
end $$;

-- May the signed-in admin see this notification? (page permission + named approver)
create or replace function public.ep_admin_inbox_visible(p_kind text, p_emp uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.rbac_can(case p_kind
           when 'leave' then 'portal.leave.view'
           when 'attendance' then 'portal.attendance.view'
           when 'report' then 'portal.reports.view'
           when 'project' then 'portal.projects.view'
           else 'portal.employees.view' end)
     and (p_kind not in ('leave', 'attendance', 'report') or p_emp is null or public.ep_is_super_admin()
          or coalesce((select e.admin_approver_id = auth.uid() or e.admin_approver_id is null
                         from public.ep_employees e where e.id = p_emp), true));
$$;

revoke all on function public.ep_user_display_name(uuid), public.ep_is_super_admin(), public.ep_require_not_self(uuid),
  public.ep_require_approver(uuid), public.ep_admin_inbox_visible(text, uuid) from public, anon, authenticated;

-- ================================================================ named approver (Employee Management)
-- People who may be named: everyone whose role may approve leave (and Super Admins).
create or replace function public.ep_admin_approver_options()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.rbac_require('portal.employees.edit');
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', u.id, 'name', public.ep_user_display_name(u.id),
                                        'role', (select r.name from public.rbac_user_roles ur join public.rbac_roles r on r.key = ur.role_key
                                                  where ur.user_id = u.id limit 1))
                     order by public.ep_user_display_name(u.id))
      from auth.users u
     where public.rbac_user_can(u.id, 'portal.leave.approve')), '[]'::jsonb);
end $$;

create or replace function public.ep_admin_set_approver(p_emp uuid, p_user uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp public.ep_employees;
begin
  perform public.rbac_require('portal.employees.edit');
  select * into v_emp from public.ep_employees where id = p_emp for update;
  if v_emp.id is null then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  if p_user is not null then
    if p_user = v_emp.user_id then
      raise exception 'An employee cannot approve their own requests.' using errcode = '22023';
    end if;
    if not public.rbac_user_can(p_user, 'portal.leave.approve') then
      raise exception 'Choose someone whose role may approve leave.' using errcode = '22023';
    end if;
  end if;
  update public.ep_employees set admin_approver_id = p_user, updated_at = now() where id = p_emp;
  return jsonb_build_object('user_id', p_user, 'name', case when p_user is not null then public.ep_user_display_name(p_user) end);
end $$;

revoke all on function public.ep_admin_approver_options(), public.ep_admin_set_approver(uuid, uuid) from public, anon;
grant execute on function public.ep_admin_approver_options(), public.ep_admin_set_approver(uuid, uuid) to authenticated;

-- ================================================================ generated from the current definitions
CREATE OR REPLACE FUNCTION public.ep_admin_decide_leave(p_id uuid, p_action text, p_comment text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row      public.ep_leave_requests;
  v_comment  text := nullif(btrim(coalesce(p_comment, '')), '');
  v_allowed  numeric;
  v_type     public.ep_leave_types;
  v_mgr      uuid;
  v_what     text;
  v_emp_name text;
  v_final    boolean;
begin
  perform public.rbac_require('portal.leave.approve'); -- rbac
  select * into v_row from public.ep_leave_requests where id = p_id for update;
  if v_row.id is null then
    raise exception 'Leave request not found.' using errcode = 'P0002';
  end if;
  perform public.ep_require_not_self(v_row.employee_id); -- 264
  perform public.ep_require_approver(v_row.employee_id); -- 264
  if v_row.status not in ('manager_review', 'pending', 'manager_pending') then
    raise exception 'This request was already %.', v_row.status using errcode = 'P0001';
  end if;
  if p_action not in ('approved', 'rejected') then
    raise exception 'Invalid action.' using errcode = '22023';
  end if;
  if p_action = 'rejected' and v_comment is null then
    raise exception 'Write a reason for rejecting.' using errcode = '22023';
  end if;
  if coalesce(length(v_comment), 0) > 1000 then
    raise exception 'Comment must be at most 1000 characters.' using errcode = '22023';
  end if;
  select * into v_type from public.ep_leave_types where code = v_row.leave_type;
  if p_action = 'approved' then
    v_allowed := public.ep_leave_allowance(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type);
    if v_type.is_paid and v_allowed is not null
       and public.ep_leave_taken(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type, v_row.id)
           + v_row.days > v_allowed then
      raise exception 'Not enough % balance left to approve this. Increase the balance or ask for Loss of Pay.', v_type.name
        using errcode = '22023';
    end if;
  end if;

  v_what := v_type.name || ' · ' || to_char(v_row.start_date, 'DD Mon YYYY')
    || case when v_row.end_date <> v_row.start_date then ' – ' || to_char(v_row.end_date, 'DD Mon YYYY') else '' end;
  select full_name into v_emp_name from public.ep_employees where id = v_row.employee_id;

  if v_row.status in ('manager_review', 'pending') and p_action = 'approved' then
    select m.id into v_mgr
      from public.ep_employees e join public.ep_employees m on m.id = e.reporting_manager_id
     where e.id = v_row.employee_id and m.is_active and m.id <> e.id
       and public.rbac_user_can(m.user_id, 'team.leave.approve');
    if v_mgr is null and v_row.approver_id is not null and v_row.approver_id <> v_row.employee_id
       and exists (select 1 from public.ep_employees where id = v_row.approver_id and is_active
                    and public.rbac_user_can(user_id, 'team.leave.approve')) then
      v_mgr := v_row.approver_id;
    end if;
  end if;

  if v_mgr is not null then
    -- Step 1 done: the admin approved; now the reporting manager decides.
    update public.ep_leave_requests
       set status = 'manager_pending', approver_id = v_mgr,
           decided_by_admin = auth.uid(), admin_decided_at = now(), admin_comment = v_comment, updated_at = now()
     where id = p_id returning * into v_row;
    perform public.ep_notify(v_row.employee_id, 'leave',
      'Admin approved your leave — waiting for your manager',
      v_what || ' · now with ' || (select full_name from public.ep_employees where id = v_mgr) || ' for the final decision'
        || coalesce(' · Admin: ' || v_comment, ''),
      '/employee/leave', 'normal');
    perform public.ep_notify(v_mgr, 'leave',
      'Admin approved ' || v_emp_name || '''s leave — please give your final approval',
      v_what || coalesce(' · Admin: ' || v_comment, '') || ' · Approve or reject it in Team requests.',
      '/employee/leave/team', 'normal');
  else
    -- Final decision by the admin: reject; approve with no portal manager; or deciding instead of the manager.
    v_final := v_row.status = 'manager_pending';
    update public.ep_leave_requests
       set status = p_action, decided_by = null, decided_by_admin = auth.uid(), decided_at = now(),
           decision_comment = v_comment,
           admin_decided_at = coalesce(admin_decided_at, now()),
           admin_comment = case when v_final then admin_comment else v_comment end,
           updated_at = now()
     where id = p_id returning * into v_row;
    perform public.ep_notify(v_row.employee_id, 'leave',
      'Your leave was ' || p_action,
      v_what || ' · by ' || public.ep_user_display_name(auth.uid()) || coalesce(' · ' || v_comment, ''),
      '/employee/leave', case when p_action = 'rejected' then 'urgent' else 'normal' end);
    -- The reporting manager always learns the admin's decision (approved or rejected).
    if v_row.approver_id is not null and v_row.approver_id <> v_row.employee_id then
      perform public.ep_notify(v_row.approver_id, 'leave',
        'Admin ' || p_action || ' ' || v_emp_name || '''s leave',
        v_what || coalesce(' · Admin: ' || v_comment, '')
          || case when v_final then ' · decided instead of you; no action needed.' else ' · no action needed from you.' end,
        '/employee/leave/team', 'normal');
    end if;
  end if;
  return public.ep_leave_json(v_row)
    || jsonb_build_object('balance',
         public.ep_leave_balance_json(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type));
end $function$;

CREATE OR REPLACE FUNCTION public.ep_admin_decide_correction(p_id uuid, p_action text, p_comment text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row public.ep_attendance_corrections;
  v_chk record;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  perform public.rbac_require('portal.attendance.approve'); -- rbac
  if p_action not in ('approved', 'rejected') then
    raise exception 'Invalid action.' using errcode = '22023';
  end if;
  if p_action = 'rejected' and v_comment is null then
    raise exception 'Write a reason for rejecting.' using errcode = '22023';
  end if;
  if coalesce(length(v_comment), 0) > 500 then
    raise exception 'Comment must be at most 500 characters.' using errcode = '22023';
  end if;
  select * into v_row from public.ep_attendance_corrections where id = p_id for update;
  if v_row.id is null then
    raise exception 'Correction request not found.' using errcode = 'P0002';
  end if;
  perform public.ep_require_not_self(v_row.employee_id); -- 264
  perform public.ep_require_approver(v_row.employee_id); -- 264
  if v_row.status <> 'pending' then
    raise exception 'This request was already %.', v_row.status using errcode = 'P0001';
  end if;

  if p_action = 'approved' then
    if v_row.old_in is not null and v_row.attendance_id is null then
      raise exception 'The punch session of this request no longer exists.' using errcode = 'P0002';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(v_row.employee_id::text, 0));
    -- Check again: other sessions may have changed since the request.
    select * into v_chk from public.ep_correction_check(
      v_row.employee_id, v_row.work_date, v_row.attendance_id, v_row.requested_in, v_row.requested_out);
    if v_row.attendance_id is not null then
      update public.ep_attendance
         set punch_in_at = v_chk.new_in, punch_out_at = v_chk.new_out,
             auto_punched_out = false, corrected_at = now()
       where id = v_row.attendance_id;
    else
      insert into public.ep_attendance (employee_id, work_date, punch_in_at, punch_out_at, corrected_at)
      values (v_row.employee_id, v_row.work_date, v_chk.new_in, v_chk.new_out, now());
    end if;
  end if;

  update public.ep_attendance_corrections
     set status = p_action, decided_by_admin = auth.uid(), decided_at = now(), decision_comment = v_comment
   where id = p_id returning * into v_row;

  perform public.ep_notify(v_row.employee_id, 'attendance',
    'Attendance correction ' || p_action,
    to_char(v_row.work_date, 'DD Mon YYYY') || ' · by ' || public.ep_user_display_name(auth.uid()) || coalesce(' · ' || v_comment, ''),
    '/employee/attendance', case when p_action = 'rejected' then 'urgent' else 'normal' end);
  return public.ep_correction_json(v_row);
end $function$;

CREATE OR REPLACE FUNCTION public.ep_admin_review_report(p_report uuid, p_action text, p_comment text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_status  text;
  v_emp     uuid;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  perform public.rbac_require('portal.reports.approve'); -- rbac
  select status, employee_id into v_status, v_emp from public.ep_work_reports where id = p_report for update;
  if v_status is null then
    raise exception 'Report not found.' using errcode = 'P0002';
  end if;
  perform public.ep_require_not_self(v_emp); -- 264
  perform public.ep_require_approver(v_emp); -- 264
  if v_status <> 'submitted' then
    raise exception 'Only a submitted report can be reviewed (this one is %).', v_status using errcode = 'P0001';
  end if;
  if p_action not in ('reviewed', 'returned') then
    raise exception 'Invalid action.' using errcode = '22023';
  end if;
  if p_action = 'returned' and v_comment is null then
    raise exception 'Write a comment saying what needs to change.' using errcode = '22023';
  end if;
  if coalesce(length(v_comment), 0) > 1000 then
    raise exception 'Comment must be at most 1000 characters.' using errcode = '22023';
  end if;
  update public.ep_work_reports
     set status = p_action, reviewed_by = null, reviewed_by_admin = auth.uid(), reviewed_at = now(),
         review_comment = v_comment, updated_at = now()
   where id = p_report;
  return public.ep_report_json(p_report);
end $function$;

CREATE OR REPLACE FUNCTION public.ep_leave_json(r ep_leave_requests)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id', r.id, 'leave_type', r.leave_type, 'leave_name', (select name from public.ep_leave_types where code = r.leave_type),
    'start_date', r.start_date, 'end_date', r.end_date, 'half_day', r.half_day, 'days', r.days,
    'reason', r.reason, 'status', r.status, 'created_at', r.created_at,
    'decided_at', r.decided_at, 'decision_comment', r.decision_comment,
    'decided_by', coalesce((select full_name from public.ep_employees where id = r.decided_by),
                           case when r.decided_by_admin is not null and r.decided_at is not null
                                then public.ep_user_display_name(r.decided_by_admin) end),
    'decided_by_is_admin', r.decided_by is null and r.decided_by_admin is not null and r.decided_at is not null,
    'admin_decided_by', case when r.admin_decided_at is not null then public.ep_user_display_name(r.decided_by_admin) end,
    'admin_approver', (select case when e.admin_approver_id is not null then jsonb_build_object('user_id', e.admin_approver_id,
                                 'name', public.ep_user_display_name(e.admin_approver_id)) end
                         from public.ep_employees e where e.id = r.employee_id),
    'manager_reviewed_at', r.manager_reviewed_at, 'manager_review_comment', r.manager_review_comment,
    'manager_reviewed_by', (select full_name from public.ep_employees where id = r.manager_reviewed_by),
    'admin_decided_at', r.admin_decided_at, 'admin_comment', r.admin_comment,
    'manager', (select full_name from public.ep_employees
                 where id = coalesce(r.decided_by, r.manager_reviewed_by, r.approver_id)),
    'approver', coalesce((select full_name from public.ep_employees where id = r.approver_id), r.approver_name),
    'employee', (select jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
                                           'designation', e.designation)
                   from public.ep_employees e where e.id = r.employee_id));
$function$;

CREATE OR REPLACE FUNCTION public.ep_report_json(p_report uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id', r.id, 'report_date', r.report_date, 'status', r.status, 'notes', r.notes,
    'submitted_at', r.submitted_at, 'reviewed_at', r.reviewed_at, 'review_comment', r.review_comment,
    'updated_at', r.updated_at,
    'employee', jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
                                   'designation', e.designation),
    'submitted_to', case when st.id is null then null
                         else jsonb_build_object('id', st.id, 'full_name', st.full_name, 'employee_code', st.employee_code) end,
    'reviewed_by', case when rb.id is not null then jsonb_build_object('id', rb.id, 'full_name', rb.full_name)
                        when r.reviewed_by_admin is not null then jsonb_build_object('id', null, 'full_name', public.ep_user_display_name(r.reviewed_by_admin))
                        else null end,
    'total_hours', coalesce((select sum(i.hours) from public.ep_work_report_items i where i.report_id = r.id), 0),
    'worked_minutes', (
      select floor(sum(extract(epoch from (coalesce(a.punch_out_at, now()) - a.punch_in_at))) / 60)::int
      from public.ep_attendance a where a.employee_id = r.employee_id and a.work_date = r.report_date),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'project_id', i.project_id, 'project_code', p.project_code, 'project_name', p.name,
               'task_updates', i.task_updates, 'completed_work', i.completed_work,
               'pending_work', i.pending_work, 'hours', i.hours)
             order by i.position, p.name)
      from public.ep_work_report_items i join public.pt_projects p on p.id = i.project_id
      where i.report_id = r.id), '[]'::jsonb)
  )
  from public.ep_work_reports r
  join public.ep_employees e on e.id = r.employee_id
  left join public.ep_employees st on st.id = r.submitted_to
  left join public.ep_employees rb on rb.id = r.reviewed_by
  where r.id = p_report;
$function$;

CREATE OR REPLACE FUNCTION public.ep_correction_json(c ep_attendance_corrections)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id', c.id, 'work_date', c.work_date, 'attendance_id', c.attendance_id,
    'requested_in', c.requested_in, 'requested_out', c.requested_out,
    'old_in', c.old_in, 'old_out', c.old_out,
    'kind', case when c.old_in is null then 'add' else 'fix' end,
    'reason', c.reason, 'status', c.status, 'created_at', c.created_at,
    'decided_at', c.decided_at, 'decision_comment', c.decision_comment,
    'decided_by', case when c.decided_by_admin is not null then public.ep_user_display_name(c.decided_by_admin) end,
    'employee', (select jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code)
                   from public.ep_employees e where e.id = c.employee_id));
$function$;

CREATE OR REPLACE FUNCTION public.ep_admin_employee_json(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id',              e.id,
    'employee_code',   e.employee_code,
    'full_name',       e.full_name,
    'work_email',      u.email,
    'department',      e.department,
    'designation',     e.designation,
    'date_of_joining', e.date_of_joining,
    'employment_type', e.employment_type,
    'work_location',   e.work_location,
    'is_active',       e.is_active,
    'created_at',      e.created_at,
    'last_sign_in_at', u.last_sign_in_at,
    'manager', case when m.id is null then null else jsonb_build_object(
      'id', m.id, 'full_name', m.full_name, 'employee_code', m.employee_code,
      'designation', m.designation, 'is_active', m.is_active) end,
    'manager_name', case when m.id is null then e.reporting_manager_name end,
    'admin_approver', case when e.admin_approver_id is not null then jsonb_build_object('user_id', e.admin_approver_id,
                         'name', public.ep_user_display_name(e.admin_approver_id)) end,
    'reports_count', (select count(*) from public.ep_employees r where r.reporting_manager_id = e.id),
    'punched_in', exists (select 1 from public.ep_attendance a where a.employee_id = e.id and a.punch_out_at is null)
  )
  from public.ep_employees e
  left join auth.users u on u.id = e.user_id
  left join public.ep_employees m on m.id = e.reporting_manager_id
  where e.id = p_id;
$function$;

CREATE OR REPLACE FUNCTION public.ep_admin_inbox(p_filter text DEFAULT 'all'::text, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  perform public.rbac_require('portal.inbox.view'); -- rbac
  return jsonb_build_object(
    'unread', (select count(*) from public.ep_admin_notifications n
                where public.ep_admin_inbox_visible(n.kind, n.employee_id)
                  and not exists (select 1 from public.ep_admin_notification_reads r
                                   where r.notification_id = n.id and r.user_id = v_uid)),
    'counts', coalesce((select jsonb_object_agg(kind, c) from (
                 select kind, count(*) c from public.ep_admin_notifications n
                  where public.ep_admin_inbox_visible(n.kind, n.employee_id)
                    and not exists (select 1 from public.ep_admin_notification_reads r
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
         where public.ep_admin_inbox_visible(n.kind, n.employee_id)
           and case coalesce(p_filter, 'all')
                 when 'all' then true
                 when 'unread' then not exists (select 1 from public.ep_admin_notification_reads r
                                                 where r.notification_id = n.id and r.user_id = v_uid)
                 else n.kind = p_filter end
         order by n.created_at desc
         limit least(greatest(coalesce(p_limit, 200), 1), 500)) x), '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.ep_admin_inbox_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  perform public.rbac_require('portal.inbox.view'); -- rbac
  return jsonb_build_object('unread', (
    select count(*) from public.ep_admin_notifications n
     where public.ep_admin_inbox_visible(n.kind, n.employee_id)
       and not exists (select 1 from public.ep_admin_notification_reads r
                        where r.notification_id = n.id and r.user_id = v_uid)));
end $function$;

CREATE OR REPLACE FUNCTION public.ep_admin_inbox_mark_read(p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.inbox.view'); -- rbac
  insert into public.ep_admin_notification_reads (notification_id, user_id)
  select n.id, auth.uid() from public.ep_admin_notifications n
   where (p_ids is null or n.id = any (p_ids))
     and public.ep_admin_inbox_visible(n.kind, n.employee_id)
  on conflict do nothing;
end $function$;

notify pgrst, 'reload schema';

commit;
