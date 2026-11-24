-- Rollback of 264_approvals.sql: self-approval allowed again, unfiltered admin inbox, no named approver,
-- "Admin" instead of names. The approver column is dropped (assignments are lost).
begin;

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
      v_what || ' · by Admin' || coalesce(' · ' || v_comment, ''),
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
    to_char(v_row.work_date, 'DD Mon YYYY') || coalesce(' · ' || v_comment, ''),
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
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  perform public.rbac_require('portal.reports.approve'); -- rbac
  select status into v_status from public.ep_work_reports where id = p_report for update;
  if v_status is null then
    raise exception 'Report not found.' using errcode = 'P0002';
  end if;
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
                           case when r.decided_by_admin is not null and r.decided_at is not null then 'Admin' end),
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
                        when r.reviewed_by_admin is not null then jsonb_build_object('id', null, 'full_name', 'Admin')
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
     where not exists (select 1 from public.ep_admin_notification_reads r
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
   where p_ids is null or n.id = any (p_ids)
  on conflict do nothing;
end $function$;

drop function if exists public.ep_admin_set_approver(uuid, uuid);
drop function if exists public.ep_admin_approver_options();
drop function if exists public.ep_admin_inbox_visible(text, uuid);
drop function if exists public.ep_require_approver(uuid);
drop function if exists public.ep_require_not_self(uuid);
drop function if exists public.ep_is_super_admin();
drop function if exists public.ep_user_display_name(uuid);
alter table public.ep_employees drop column if exists admin_approver_id;
notify pgrst, 'reload schema';
commit;
