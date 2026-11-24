-- Rollback of 261_rbac_actions.sql: back to one permission per module (259/260).
-- Restores the security policies (split "per command" policies are merged back), the module-level
-- catalog and grants as they were before 261, and the functions. Per-action changes are lost.
begin;

do $$
declare
  b record;
  d jsonb;
  v_roles text;
  v_cmd text;
begin
  for b in select * from public.rbac_backup where kind = 'policy261' loop
    d := b.definition::jsonb;
    if d ->> 'cmd' = 'ALL' then
      foreach v_cmd in array array['select', 'insert', 'update', 'delete'] loop
        execute format('drop policy if exists %I on %I.%I', left(d ->> 'policy', 50) || ' (' || v_cmd || ')', d ->> 'schema', d ->> 'table');
      end loop;
      select string_agg(case when r = 'public' then 'public' else quote_ident(r) end, ', ') into v_roles
        from jsonb_array_elements_text(d -> 'roles') r;
      execute format('drop policy if exists %I on %I.%I', d ->> 'policy', d ->> 'schema', d ->> 'table');
      execute format('create policy %I on %I.%I as %s for all to %s%s%s', d ->> 'policy', d ->> 'schema', d ->> 'table',
                     lower(d ->> 'permissive'), v_roles,
                     case when d ->> 'qual' is not null then ' using (' || (d ->> 'qual') || ')' else '' end,
                     case when d ->> 'with_check' is not null then ' with check (' || (d ->> 'with_check') || ')' else '' end);
    elsif exists (select 1 from pg_policies where schemaname = d ->> 'schema' and tablename = d ->> 'table' and policyname = d ->> 'policy') then
      execute format('alter policy %I on %I.%I%s%s', d ->> 'policy', d ->> 'schema', d ->> 'table',
                     case when d ->> 'qual' is not null then ' using (' || (d ->> 'qual') || ')' else '' end,
                     case when d ->> 'with_check' is not null then ' with check (' || (d ->> 'with_check') || ')' else '' end);
    end if;
  end loop;
end $$;

-- catalog + grants as before 261
delete from public.rbac_role_permissions where permission_key in (select key from public.rbac_permissions where module is not null);
delete from public.rbac_permissions where module is not null;
insert into public.rbac_permissions (key, area, grp, label, description, sort_order)
select x ->> 'key', x ->> 'area', x ->> 'grp', x ->> 'label', x ->> 'description', (x ->> 'sort_order')::int
  from public.rbac_backup b, jsonb_array_elements(b.definition::jsonb) x
 where b.kind = 'catalog' and b.name = 'before 261'
on conflict do nothing;
insert into public.rbac_role_permissions (role_key, permission_key)
select x ->> 'role_key', x ->> 'permission_key'
  from public.rbac_backup b, jsonb_array_elements(b.definition::jsonb) x
 where b.kind = 'grants' and b.name = 'before 261'
   and exists (select 1 from public.rbac_roles where key = x ->> 'role_key')
on conflict do nothing;

create or replace function public.rbac_require(p_key text)
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.rbac_can(p_key) then
    raise exception 'You do not have permission for this (%).',
      coalesce((select label from public.rbac_permissions where key = p_key), p_key) using errcode = '42501';
  end if;
end $$;

-- ---- functions back to their previous versions

-- pt_private.require_admin
CREATE OR REPLACE FUNCTION pt_private.require_admin()
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null or not public.rbac_can('projects.logins') then
    raise exception 'PT_NOT_ALLOWED' using errcode = 'P0001';
  end if;
end;
$function$;

-- public.ep_add_my_document
CREATE OR REPLACE FUNCTION public.ep_add_my_document(p_category text, p_title text, p_path text, p_name text, p_size bigint, p_mime text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp uuid := public.ep_current_employee_id();
  v_id  uuid;
begin
  perform public.rbac_require('emp.documents'); -- rbac
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if p_path is null or p_path not like v_emp::text || '/%' then
    raise exception 'Invalid file location.' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'ep-documents' and name = p_path) then
    raise exception 'The file was not uploaded.' using errcode = 'P0002';
  end if;
  if (select count(*) from public.ep_employee_documents where employee_id = v_emp) >= 50 then
    raise exception 'You can keep up to 50 documents. Delete one first.' using errcode = '22023';
  end if;
  insert into public.ep_employee_documents (employee_id, category, title, storage_path, file_name, file_size, mime_type)
  values (v_emp, p_category, left(btrim(coalesce(nullif(btrim(p_title), ''), p_name)), 120),
          p_path, left(btrim(p_name), 255), p_size, p_mime)
  returning id into v_id;
  return v_id;
end $function$;

-- public.ep_add_task
CREATE OR REPLACE FUNCTION public.ep_add_task(p_project uuid, p_title text, p_description text, p_assignee uuid, p_due_date date, p_priority text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp uuid := public.ep_current_employee_id();
  v_id  uuid;
begin
  perform public.rbac_require('emp.projects'); -- rbac
  if v_emp is null or not exists (select 1 from public.ep_project_members where project_id = p_project and employee_id = v_emp) then
    raise exception 'You are not on this project.' using errcode = '42501';
  end if;
  if p_assignee is not null and not exists (select 1 from public.ep_project_members where project_id = p_project and employee_id = p_assignee) then
    raise exception 'The assignee must be on the project team.' using errcode = '22023';
  end if;
  insert into public.ep_project_tasks (project_id, title, description, assignee_id, due_date, priority, created_by)
  values (p_project, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), p_assignee, p_due_date,
          coalesce(nullif(p_priority, ''), 'medium'), v_emp)
  returning id into v_id;
  return v_id;
end $function$;

-- public.ep_admin_attendance
CREATE OR REPLACE FUNCTION public.ep_admin_attendance(p_from date, p_to date, p_emp uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.attendance'); -- rbac
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Choose a date range of at most 62 days.' using errcode = '22023';
  end if;
  perform public.ep_close_overdue_sessions(p_emp);
  return jsonb_build_object(
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'employee_code', e.employee_code, 'full_name', e.full_name,
               'designation', e.designation, 'department', e.department, 'is_active', e.is_active,
               'start_date', (timezone('Asia/Kolkata', e.created_at))::date) order by e.full_name)
      from public.ep_employees e where p_emp is null or e.id = p_emp), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.work_date desc, x.employee_id)
      from public.ep_attendance_rows(p_from, p_to, p_emp) x), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'employee_id', a.employee_id, 'work_date', a.work_date,
               'punch_in_at', a.punch_in_at, 'punch_out_at', a.punch_out_at,
               'auto_punched_out', a.auto_punched_out, 'corrected_at', a.corrected_at) order by a.punch_in_at)
      from public.ep_attendance a
      where a.work_date between p_from and p_to and (p_emp is null or a.employee_id = p_emp)), '[]'::jsonb),
    'holidays', coalesce((
      select jsonb_agg(jsonb_build_object('date', holiday_date, 'name', name) order by holiday_date)
      from public.ep_holidays where holiday_date between p_from and p_to), '[]'::jsonb),
    'leave', coalesce((
      select jsonb_agg(jsonb_build_object('employee_id', r.employee_id, 'date', g.d::date,
                                          'type', r.leave_type, 'half_day', r.half_day) order by g.d)
      from public.ep_leave_requests r,
           generate_series(greatest(r.start_date, p_from), least(r.end_date, p_to), interval '1 day') g(d)
      where r.status = 'approved' and r.start_date <= p_to and r.end_date >= p_from
        and (p_emp is null or r.employee_id = p_emp)), '[]'::jsonb),
    'pending_corrections', (select count(*) from public.ep_attendance_corrections where status = 'pending'));
end $function$;

-- public.ep_admin_corrections
CREATE OR REPLACE FUNCTION public.ep_admin_corrections(p_status text DEFAULT 'pending'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.attendance'); -- rbac
  return coalesce((
    select jsonb_agg(public.ep_correction_json(c) order by c.created_at desc)
    from (select * from public.ep_attendance_corrections
           where coalesce(p_status, 'all') = 'all' or status = p_status
           order by created_at desc limit 200) c), '[]'::jsonb);
end $function$;

-- public.ep_admin_create_employee
CREATE OR REPLACE FUNCTION public.ep_admin_create_employee(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f          text;
  v_code     text := upper(btrim(coalesce(p ->> 'employee_code', '')));
  v_name     text := btrim(coalesce(p ->> 'full_name', ''));
  v_email    text := lower(btrim(coalesce(p ->> 'email', '')));
  v_password text := coalesce(p ->> 'password', '');
  v_user     uuid;
  v_linked   boolean := false;
  v_emp      uuid;
  v_work     jsonb;
begin
  perform public.rbac_require('portal.employees'); -- rbac
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Invalid employee data.' using errcode = '22023';
  end if;
  for f in select jsonb_object_keys(p) loop
    if f not in ('employee_code', 'full_name', 'email', 'password', 'department', 'designation',
                 'reporting_manager_id', 'reporting_manager_name', 'date_of_joining', 'employment_type', 'work_location') then
      raise exception 'Field % cannot be set here.', f using errcode = '42501';
    end if;
  end loop;

  if v_code !~ '^[A-Z0-9][A-Z0-9-]{1,29}$' then
    raise exception 'Employee ID: use 2-30 letters, numbers or dashes (e.g. ZT-001).' using errcode = '22023';
  end if;
  if length(v_name) not between 1 and 120 then
    raise exception 'Name is required (up to 120 characters).' using errcode = '22023';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'Enter a valid work email.' using errcode = '22023';
  end if;
  if exists (select 1 from public.ep_employees where employee_code = v_code) then
    raise exception 'Employee ID % is already used.', v_code using errcode = '23505';
  end if;

  -- Same email twice at the same moment: serialise.
  perform pg_advisory_xact_lock(hashtextextended('ep_create_employee:' || v_email, 0));

  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is not null then
    if exists (select 1 from public.ep_employees where user_id = v_user) then
      raise exception 'This email already belongs to an employee.' using errcode = '23505';
    end if;
    if public.ep_user_is_admin(v_user) then
      raise exception 'This email is an admin account. Use a separate email for the employee.' using errcode = '22023';
    end if;
    v_linked := true;
  else
    if public.ep_password_problem(v_password) is not null then
      raise exception 'Temporary password: %', public.ep_password_problem(v_password) using errcode = '22023';
    end if;
    v_user := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
      extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('full_name', v_name), now(), now(),
      '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    values (
      v_user::text, v_user,
      jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true),
      'email', now(), now());
  end if;

  -- A new login with a temporary password must be changed at the first sign-in.
  insert into public.ep_employees (user_id, employee_code, full_name, must_change_password)
  values (v_user, v_code, v_name, not v_linked)
  returning id into v_emp;

  -- Work details: only the keys given, with the same checks as editing.
  v_work := p - 'employee_code' - 'full_name' - 'email' - 'password';
  if v_work <> '{}'::jsonb then
    perform public.ep_admin_update_employee(v_emp, v_work);
  end if;

  perform public.ep_notify(
    v_emp, 'message', 'Welcome to the Zyllo Tech Employee Portal',
    'Your account is ready. Please complete your personal details and emergency contacts in My Profile.',
    '/employee/profile');

  return public.ep_admin_employee(v_emp) || jsonb_build_object('linked_existing_account', v_linked);
end $function$;

-- public.ep_admin_custom_reminders
CREATE OR REPLACE FUNCTION public.ep_admin_custom_reminders()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.notifications'); -- rbac
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
end $function$;

-- public.ep_admin_decide_correction
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
  perform public.rbac_require('portal.attendance'); -- rbac
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

-- public.ep_admin_decide_leave
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
  perform public.rbac_require('portal.leave'); -- rbac
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
       and public.rbac_user_can(m.user_id, 'team.leave');
    if v_mgr is null and v_row.approver_id is not null and v_row.approver_id <> v_row.employee_id
       and exists (select 1 from public.ep_employees where id = v_row.approver_id and is_active
                    and public.rbac_user_can(user_id, 'team.leave')) then
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

-- public.ep_admin_delete_custom_reminder
CREATE OR REPLACE FUNCTION public.ep_admin_delete_custom_reminder(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.notifications'); -- rbac
  delete from public.ep_custom_reminders where id = p_id;
  if not found then
    raise exception 'Reminder not found.' using errcode = 'P0002';
  end if;
  return public.ep_admin_custom_reminders();
end $function$;

-- public.ep_admin_delete_holiday
CREATE OR REPLACE FUNCTION public.ep_admin_delete_holiday(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_date date;
begin
  perform public.rbac_require('portal.leave'); -- rbac
  delete from public.ep_holidays where id = p_id returning holiday_date into v_date;
  if v_date is null then
    raise exception 'Holiday not found.' using errcode = 'P0002';
  end if;
  perform public.ep_recount_leave_on(v_date);
  return public.ep_admin_holidays(extract(year from v_date)::int);
end $function$;

-- public.ep_admin_employee
CREATE OR REPLACE FUNCTION public.ep_admin_employee(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v jsonb := public.ep_admin_employee_json(p_id);
begin
  perform public.rbac_require('portal.employees'); -- rbac
  if v is null then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  return v || jsonb_build_object(
    'personal', coalesce((
      select to_jsonb(p) - 'employee_id' from public.ep_employee_profiles p where p.employee_id = p_id
    ), '{}'::jsonb),
    'emergency_contacts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', c.name, 'relationship', c.relationship,
               'phone', c.phone, 'alternate_phone', c.alternate_phone) order by c.sort_order)
      from public.ep_emergency_contacts c where c.employee_id = p_id
    ), '[]'::jsonb),
    'direct_reports', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'full_name', r.full_name, 'employee_code', r.employee_code,
               'designation', r.designation, 'is_active', r.is_active) order by r.full_name)
      from public.ep_employees r where r.reporting_manager_id = p_id
    ), '[]'::jsonb)
  );
end $function$;

-- public.ep_admin_employees
CREATE OR REPLACE FUNCTION public.ep_admin_employees()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require_any(array['portal.employees', 'portal.projects', 'portal.attendance', 'portal.leave', 'portal.reports', 'portal.notifications']); -- rbac
  return coalesce((
    select jsonb_agg(public.ep_admin_employee_json(e.id) order by e.is_active desc, e.employee_code)
    from public.ep_employees e
  ), '[]'::jsonb);
end $function$;

-- public.ep_admin_holidays
CREATE OR REPLACE FUNCTION public.ep_admin_holidays(p_year integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.leave'); -- rbac
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'date', holiday_date, 'name', name) order by holiday_date)
    from public.ep_holidays where extract(year from holiday_date) = p_year), '[]'::jsonb);
end $function$;

-- public.ep_admin_inbox
CREATE OR REPLACE FUNCTION public.ep_admin_inbox(p_filter text DEFAULT 'all'::text, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  perform public.rbac_require('portal.inbox'); -- rbac
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

-- public.ep_admin_inbox_mark_read
CREATE OR REPLACE FUNCTION public.ep_admin_inbox_mark_read(p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.inbox'); -- rbac
  insert into public.ep_admin_notification_reads (notification_id, user_id)
  select n.id, auth.uid() from public.ep_admin_notifications n
   where p_ids is null or n.id = any (p_ids)
  on conflict do nothing;
end $function$;

-- public.ep_admin_inbox_summary
CREATE OR REPLACE FUNCTION public.ep_admin_inbox_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  perform public.rbac_require('portal.inbox'); -- rbac
  return jsonb_build_object('unread', (
    select count(*) from public.ep_admin_notifications n
     where not exists (select 1 from public.ep_admin_notification_reads r
                        where r.notification_id = n.id and r.user_id = v_uid)));
end $function$;

-- public.ep_admin_leave_balances
CREATE OR REPLACE FUNCTION public.ep_admin_leave_balances(p_year integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.leave'); -- rbac
  if p_year is null or p_year not between 2020 and 2100 then
    raise exception 'Invalid year.' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'year', p_year,
    'types', (select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'is_paid', is_paid, 'default', yearly_days)
                               order by sort_order)
              from public.ep_leave_types where is_active),
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'employee_code', e.employee_code, 'full_name', e.full_name,
               'designation', e.designation, 'is_active', e.is_active,
               'balances', (select jsonb_agg(public.ep_leave_balance_json(e.id, p_year, t.code) order by t.sort_order)
                              from public.ep_leave_types t where t.is_active))
             order by e.is_active desc, e.full_name)
      from public.ep_employees e), '[]'::jsonb));
end $function$;

-- public.ep_admin_leave_requests
CREATE OR REPLACE FUNCTION public.ep_admin_leave_requests(p_status text DEFAULT 'pending'::text, p_year integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.leave'); -- rbac
  return coalesce((
    select jsonb_agg(public.ep_leave_json(r)
             || jsonb_build_object('balance',
                  public.ep_leave_balance_json(r.employee_id, extract(year from r.start_date)::int, r.leave_type))
             order by case r.status when 'pending' then 0 when 'manager_review' then 1 when 'manager_pending' then 2 else 3 end, r.start_date desc, r.created_at desc)
    from (select * from public.ep_leave_requests
           where (coalesce(p_status, 'all') = 'all' or status = p_status)
             and (p_year is null or extract(year from start_date) = p_year)
           order by start_date desc limit 300) r), '[]'::jsonb);
end $function$;

-- public.ep_admin_notification_log
CREATE OR REPLACE FUNCTION public.ep_admin_notification_log(p_kind text DEFAULT 'all'::text, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.notifications'); -- rbac
  return jsonb_build_object(
    'counts', (
      select jsonb_object_agg(k.kind, coalesce(c.n, 0))
      from unnest(array['project', 'leave', 'attendance', 'report', 'message']) k(kind)
      left join (select kind, count(*) as n from public.ep_notifications
                  where created_at > now() - interval '30 days' group by kind) c on c.kind = k.kind),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', n.id, 'kind', n.kind, 'priority', n.priority, 'title', n.title, 'body', n.body,
               'created_at', n.created_at, 'read_at', n.read_at, 'sender', n.sender_label,
               'automatic', n.sender_user_id is null,
               'employee', jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code))
             order by n.created_at desc)
      from (select * from public.ep_notifications
             where case coalesce(p_kind, 'all')
                     when 'all' then true
                     when 'automatic' then sender_user_id is null
                     when 'messages' then message_id is not null
                     else kind = p_kind
                   end
             order by created_at desc
             limit least(greatest(coalesce(p_limit, 100), 1), 300)) n
      join public.ep_employees e on e.id = n.employee_id), '[]'::jsonb));
end $function$;

-- public.ep_admin_notify_options
CREATE OR REPLACE FUNCTION public.ep_admin_notify_options()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.notifications'); -- rbac
  return jsonb_build_object(
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
                                          'designation', e.designation, 'department', e.department) order by e.full_name)
      from public.ep_employees e where e.is_active), '[]'::jsonb),
    'departments', coalesce((
      select jsonb_agg(jsonb_build_object('name', d.department, 'count', d.n) order by d.department)
      from (select department, count(*) as n from public.ep_employees
             where is_active and department is not null group by department) d), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'project_code', p.project_code, 'count', x.n)
                       order by p.name)
      from public.pt_projects p
      join (select m.project_id, count(*) as n from public.ep_project_members m
              join public.ep_employees e on e.id = m.employee_id and e.is_active
             group by m.project_id) x on x.project_id = p.id), '[]'::jsonb));
end $function$;

-- public.ep_admin_pm_delete_task
CREATE OR REPLACE FUNCTION public.ep_admin_pm_delete_task(p_task uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_project uuid;
begin
  perform public.rbac_require('portal.projects'); -- rbac
  delete from public.ep_project_tasks where id = p_task returning project_id into v_project;
  if v_project is null then
    raise exception 'Task not found.' using errcode = 'P0002';
  end if;
  return public.ep_admin_pm_project(v_project);
end $function$;

-- public.ep_admin_pm_project
CREATE OR REPLACE FUNCTION public.ep_admin_pm_project(p_project uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_today date := (timezone('Asia/Kolkata', now()))::date;
  v jsonb;
begin
  perform public.rbac_require('portal.projects'); -- rbac
  select jsonb_build_object(
           'id', p.id, 'project_code', p.project_code, 'name', p.name, 'client', c.name,
           'description', p.description, 'project_type', p.project_type,
           'status', p.status, 'priority', p.priority, 'health', p.health, 'progress', p.progress,
           'start_date', p.start_date, 'end_date', p.end_date, 'completed_date', p.completed_date,
           'project_manager', p.project_manager,
           'overdue', p.end_date < v_today and public.ep_project_is_running(p.status),
           'completed_late', p.completed_date > p.end_date,
           'delay_reasons', public.ep_project_delay_json(p.id))
    into v
  from public.pt_projects p
  left join public.pt_companies c on c.id = p.company_id
  where p.id = p_project;
  if v is null then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;

  return v || jsonb_build_object(
    'team', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'employee_code', e.employee_code, 'full_name', e.full_name,
               'designation', e.designation, 'is_active', e.is_active,
               'project_role', m.project_role, 'is_lead', m.is_lead, 'added_at', m.added_at,
               'tasks_total',       (select count(*) from public.ep_project_tasks t where t.project_id = p_project and t.assignee_id = e.id),
               'tasks_done',        (select count(*) from public.ep_project_tasks t where t.project_id = p_project and t.assignee_id = e.id and t.status = 'done'),
               'tasks_in_progress', (select count(*) from public.ep_project_tasks t where t.project_id = p_project and t.assignee_id = e.id and t.status = 'in_progress'),
               'tasks_overdue',     (select count(*) from public.ep_project_tasks t where t.project_id = p_project and t.assignee_id = e.id
                                       and t.status <> 'done' and t.due_date < v_today),
               'hours_logged', coalesce((
                 select sum(i.hours) from public.ep_work_report_items i
                 join public.ep_work_reports r on r.id = i.report_id
                 where i.project_id = p_project and r.employee_id = e.id and r.status in ('submitted', 'reviewed')), 0),
               'last_report_date', (
                 select max(r.report_date) from public.ep_work_report_items i
                 join public.ep_work_reports r on r.id = i.report_id
                 where i.project_id = p_project and r.employee_id = e.id and r.status in ('submitted', 'reviewed'))
             ) order by m.is_lead desc, e.full_name)
      from public.ep_project_members m join public.ep_employees e on e.id = m.employee_id
      where m.project_id = p_project), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'title', t.title, 'description', t.description, 'status', t.status,
               'priority', t.priority, 'due_date', t.due_date, 'completed_at', t.completed_at,
               'created_at', t.created_at,
               'overdue', t.status <> 'done' and t.due_date < v_today,
               'late', t.due_date < coalesce((timezone('Asia/Kolkata', t.completed_at))::date, v_today),
               'delay_reason', t.delay_reason, 'delay_reason_at', t.delay_reason_at,
               'delay_reason_by', (select full_name from public.ep_employees where id = t.delay_reason_by),
               'assignee', case when a.id is null then null else jsonb_build_object('id', a.id, 'full_name', a.full_name) end,
               'created_by', coalesce(cb.full_name, 'Admin'))
             order by (t.status = 'done'), t.due_date nulls last, t.created_at desc)
      from public.ep_project_tasks t
      left join public.ep_employees a on a.id = t.assignee_id
      left join public.ep_employees cb on cb.id = t.created_by
      where t.project_id = p_project), '[]'::jsonb),
    'updates', coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'body', u.body, 'created_at', u.created_at,
                                          'author', coalesce(au.full_name, 'Admin')) order by u.created_at desc)
      from (select * from public.ep_project_updates where project_id = p_project order by created_at desc limit 20) u
      left join public.ep_employees au on au.id = u.author_id), '[]'::jsonb)
  );
end $function$;

-- public.ep_admin_pm_projects
CREATE OR REPLACE FUNCTION public.ep_admin_pm_projects()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_today date := (timezone('Asia/Kolkata', now()))::date;
begin
  perform public.rbac_require('portal.projects'); -- rbac
  return coalesce((
    select jsonb_agg(x.j order by x.sort_status, x.end_date nulls last, x.name)
    from (
      select p.name, p.end_date,
             case p.status when 'in_progress' then 0 when 'planning' then 1 when 'live' then 2 when 'on_hold' then 3
                           when 'completed' then 4 else 5 end as sort_status,
             jsonb_build_object(
               'id', p.id, 'project_code', p.project_code, 'name', p.name, 'client', c.name,
               'status', p.status, 'priority', p.priority, 'health', p.health,
               'start_date', p.start_date, 'end_date', p.end_date, 'completed_date', p.completed_date,
               'team', coalesce((
                 select jsonb_agg(jsonb_build_object('id', e.id, 'full_name', e.full_name, 'is_lead', m.is_lead)
                                  order by m.is_lead desc, e.full_name)
                 from public.ep_project_members m join public.ep_employees e on e.id = m.employee_id
                 where m.project_id = p.id), '[]'::jsonb),
               'tasks_total',   (select count(*) from public.ep_project_tasks t where t.project_id = p.id),
               'tasks_done',    (select count(*) from public.ep_project_tasks t where t.project_id = p.id and t.status = 'done'),
               'tasks_overdue', (select count(*) from public.ep_project_tasks t where t.project_id = p.id
                                   and t.status <> 'done' and t.due_date < v_today)
             ) as j
      from public.pt_projects p
      left join public.pt_companies c on c.id = p.company_id
    ) x
  ), '[]'::jsonb);
end $function$;

-- public.ep_admin_pm_remove_member
CREATE OR REPLACE FUNCTION public.ep_admin_pm_remove_member(p_project uuid, p_employee uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.projects'); -- rbac
  delete from public.ep_project_members where project_id = p_project and employee_id = p_employee;
  if not found then
    raise exception 'This employee is not on the project.' using errcode = 'P0002';
  end if;
  update public.ep_project_tasks set assignee_id = null, updated_at = now()
   where project_id = p_project and assignee_id = p_employee and status <> 'done';
  return public.ep_admin_pm_project(p_project);
end $function$;

-- public.ep_admin_pm_save_member
CREATE OR REPLACE FUNCTION public.ep_admin_pm_save_member(p_project uuid, p_employee uuid, p_role text DEFAULT NULL::text, p_is_lead boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.projects'); -- rbac
  if not exists (select 1 from public.pt_projects where id = p_project) then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.ep_employees where id = p_employee and is_active) then
    raise exception 'Choose an active employee.' using errcode = '22023';
  end if;
  insert into public.ep_project_members (project_id, employee_id, project_role, is_lead)
  values (p_project, p_employee, nullif(btrim(coalesce(p_role, '')), ''), coalesce(p_is_lead, false))
  on conflict (project_id, employee_id) do update
    set project_role = excluded.project_role, is_lead = excluded.is_lead;
  return public.ep_admin_pm_project(p_project);
end $function$;

-- public.ep_admin_pm_save_task
CREATE OR REPLACE FUNCTION public.ep_admin_pm_save_task(p_project uuid, p_task uuid, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f text;
  v_assignee uuid;
  v_status text;
begin
  perform public.rbac_require('portal.projects'); -- rbac
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Invalid task data.' using errcode = '22023';
  end if;
  for f in select jsonb_object_keys(p) loop
    if f not in ('title', 'description', 'assignee_id', 'priority', 'status', 'due_date') then
      raise exception 'Field % cannot be set here.', f using errcode = '42501';
    end if;
  end loop;
  if not exists (select 1 from public.pt_projects where id = p_project) then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;
  if nullif(btrim(coalesce(p ->> 'title', '')), '') is null then
    raise exception 'Task title is required.' using errcode = '22023';
  end if;
  v_assignee := nullif(btrim(coalesce(p ->> 'assignee_id', '')), '')::uuid;
  -- Checked for new tasks and when the assignee changes (an existing assignee may have left the team).
  if v_assignee is not null
     and (p_task is null or v_assignee is distinct from (select assignee_id from public.ep_project_tasks where id = p_task))
     and not exists (
       select 1 from public.ep_project_members m join public.ep_employees e on e.id = m.employee_id
       where m.project_id = p_project and m.employee_id = v_assignee and e.is_active) then
    raise exception 'Assign the task to an active member of this project.' using errcode = '22023';
  end if;
  v_status := coalesce(nullif(btrim(coalesce(p ->> 'status', '')), ''), 'todo');

  if p_task is null then
    insert into public.ep_project_tasks (project_id, title, description, assignee_id, status, priority, due_date, completed_at)
    values (p_project, btrim(p ->> 'title'), nullif(btrim(coalesce(p ->> 'description', '')), ''), v_assignee, v_status,
            coalesce(nullif(btrim(coalesce(p ->> 'priority', '')), ''), 'medium'),
            nullif(btrim(coalesce(p ->> 'due_date', '')), '')::date,
            case when v_status = 'done' then now() end);
  else
    update public.ep_project_tasks set
      title        = btrim(p ->> 'title'),
      description  = nullif(btrim(coalesce(p ->> 'description', '')), ''),
      assignee_id  = v_assignee,
      status       = v_status,
      priority     = coalesce(nullif(btrim(coalesce(p ->> 'priority', '')), ''), 'medium'),
      due_date     = nullif(btrim(coalesce(p ->> 'due_date', '')), '')::date,
      completed_at = case when v_status = 'done' then coalesce(completed_at, now()) end,
      updated_at   = now()
    where id = p_task and project_id = p_project;
    if not found then
      raise exception 'Task not found.' using errcode = 'P0002';
    end if;
  end if;
  return public.ep_admin_pm_project(p_project);
end $function$;

-- public.ep_admin_pm_set_deadline
CREATE OR REPLACE FUNCTION public.ep_admin_pm_set_deadline(p_project uuid, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_start date;
begin
  perform public.rbac_require('portal.projects'); -- rbac
  select start_date into v_start from public.pt_projects where id = p_project;
  if not found then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;
  if p_date is not null and v_start is not null and p_date < v_start then
    raise exception 'The deadline cannot be before the start date (%).', to_char(v_start, 'DD Mon YYYY') using errcode = '22023';
  end if;
  update public.pt_projects set end_date = p_date, updated_at = now() where id = p_project;
  return public.ep_admin_pm_project(p_project);
end $function$;

-- public.ep_admin_portal_dashboard
CREATE OR REPLACE FUNCTION public.ep_admin_portal_dashboard()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_today   date := (timezone('Asia/Kolkata', now()))::date;
  v_holiday text;
  v_prev    date;
begin
  perform public.rbac_require('portal.dashboard'); -- rbac
  perform public.ep_close_overdue_sessions(null);
  select name into v_holiday from public.ep_holidays where holiday_date = v_today;
  -- Previous working day (skips Sundays and holidays), for "reports not submitted".
  select max(d)::date into v_prev
    from generate_series(v_today - 10, v_today - 1, interval '1 day') d
   where extract(isodow from d) <> 7 and not exists (select 1 from public.ep_holidays h where h.holiday_date = d::date);

  return jsonb_build_object(
    'today', v_today,
    'working_day', extract(isodow from v_today) <> 7 and v_holiday is null,
    'holiday', v_holiday,
    'previous_working_day', v_prev,
    'employees', (select jsonb_build_object(
                    'active', count(*) filter (where is_active),
                    'interns', count(*) filter (where is_active and employment_type = 'intern'),
                    'access_off', count(*) filter (where not is_active))
                  from public.ep_employees),
    'people', coalesce((
      select jsonb_agg(x.j order by x.ord, x.name)
      from (
        select e.full_name as name,
               case when a.open then 0 when a.first_in is not null then 1 when lv.id is not null then 2 else 3 end as ord,
               jsonb_build_object(
                 'id', e.id, 'full_name', e.full_name, 'designation', e.designation,
                 'status', case when a.open then 'in'
                                when a.first_in is not null then 'out'
                                when lv.id is not null then 'leave'
                                when extract(isodow from v_today) = 7 or v_holiday is not null then 'off'
                                else 'not_in' end,
                 'first_in', a.first_in,
                 'late', a.first_in is not null
                         and (a.first_in at time zone 'Asia/Kolkata')::time > (public.ep_attendance_rules() ->> 'late_after')::time,
                 'leave_type', lv.leave_type, 'half_day', lv.half_day) as j
        from public.ep_employees e
        left join lateral (
          select min(punch_in_at) as first_in, bool_or(punch_out_at is null) as open
          from public.ep_attendance where employee_id = e.id and work_date = v_today) a on true
        left join lateral (
          select r.id, r.leave_type, r.half_day from public.ep_leave_requests r
          where r.employee_id = e.id and r.status = 'approved' and v_today between r.start_date and r.end_date
          limit 1) lv on true
        where e.is_active) x), '[]'::jsonb),
    'pending', jsonb_build_object(
      'leave', (select count(*) from public.ep_leave_requests where status = 'pending'),
      'corrections', (select count(*) from public.ep_attendance_corrections where status = 'pending'),
      'reports_to_review', (select count(*) from public.ep_work_reports where status = 'submitted'),
      'reports_missing', (
        select count(*) from (select distinct employee_id from public.ep_attendance where work_date = v_prev) d
        where exists (select 1 from public.ep_project_members m where m.employee_id = d.employee_id)
          and not exists (select 1 from public.ep_work_reports w where w.employee_id = d.employee_id
                           and w.report_date = v_prev and w.status in ('submitted', 'reviewed'))),
      'tasks_overdue_no_reason', (
        select count(*) from public.ep_project_tasks t join public.pt_projects p on p.id = t.project_id
        where t.status <> 'done' and t.due_date < v_today and t.delay_reason is null
          and p.status not in ('completed', 'cancelled')),
      'projects_overdue', (
        select count(*) from public.pt_projects p
        where public.ep_project_is_running(p.status) and p.end_date < v_today
          and exists (select 1 from public.ep_project_members m where m.project_id = p.id))),
    'deadlines', coalesce((
      select jsonb_agg(d.j order by d.due, d.kind desc)
      from (
        select t.due_date as due, 'task' as kind, jsonb_build_object(
                 'kind', 'task', 'title', t.title, 'due_date', t.due_date, 'project_id', p.id, 'project_name', p.name,
                 'who', (select full_name from public.ep_employees where id = t.assignee_id)) as j
        from public.ep_project_tasks t join public.pt_projects p on p.id = t.project_id
        where t.status <> 'done' and t.due_date between v_today and v_today + 7
          and p.status not in ('completed', 'cancelled')
        union all
        select p.end_date, 'project', jsonb_build_object(
                 'kind', 'project', 'title', p.name, 'due_date', p.end_date, 'project_id', p.id, 'project_name', p.name,
                 'who', null)
        from public.pt_projects p
        where public.ep_project_is_running(p.status) and p.end_date between v_today and v_today + 7
        order by 1 limit 8) d), '[]'::jsonb),
    'leave_upcoming', coalesce((
      select jsonb_agg(jsonb_build_object(
               'full_name', e.full_name, 'leave_type', r.leave_type, 'start_date', r.start_date,
               'end_date', r.end_date, 'days', r.days, 'half_day', r.half_day) order by r.start_date)
      from public.ep_leave_requests r join public.ep_employees e on e.id = r.employee_id
      where r.status = 'approved' and r.start_date between v_today + 1 and v_today + 7), '[]'::jsonb),
    'next_holiday', (
      select jsonb_build_object('date', holiday_date, 'name', name)
      from public.ep_holidays where holiday_date > v_today order by holiday_date limit 1)
  );
end $function$;

-- public.ep_admin_reminder_settings
CREATE OR REPLACE FUNCTION public.ep_admin_reminder_settings()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.notifications'); -- rbac
  return (select jsonb_agg(jsonb_build_object(
                   'kind', kind, 'enabled', enabled, 'send_at', to_char(send_at, 'HH24:MI'),
                   'days', to_jsonb(days), 'last_run', last_run,
                   'sent_today', (select count(*) from public.ep_notifications
                                   where dedupe_key like s.kind || ':' || (timezone('Asia/Kolkata', now()))::date || '%'))
                 order by send_at)
          from public.ep_reminder_settings s);
end $function$;

-- public.ep_admin_remove_certificate
CREATE OR REPLACE FUNCTION public.ep_admin_remove_certificate(p_emp uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_old text;
begin
  perform public.rbac_require('portal.employees'); -- rbac
  delete from public.ep_internship_certificates where employee_id = p_emp returning storage_path into v_old;
  if v_old is null then
    raise exception 'There is no certificate to remove.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('old_path', v_old);
end $function$;

-- public.ep_admin_reports
CREATE OR REPLACE FUNCTION public.ep_admin_reports(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_today date := (timezone('Asia/Kolkata', now()))::date;
begin
  perform public.rbac_require('portal.reports'); -- rbac
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'Choose a date range of at most 93 days.' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'reports', coalesce((
      select jsonb_agg(public.ep_report_json(r.id) order by r.report_date desc, r.updated_at desc)
      from public.ep_work_reports r where r.report_date between p_from and p_to), '[]'::jsonb),
    -- Worked that day (punched in, on a project) but no submitted / reviewed report.
    'missing', coalesce((
      select jsonb_agg(jsonb_build_object(
               'employee', jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code),
               'date', d.work_date,
               'status', coalesce(w.status, 'not_started')) order by d.work_date desc, e.full_name)
      from (select distinct employee_id, work_date from public.ep_attendance
             where work_date between p_from and least(p_to, v_today)) d
      join public.ep_employees e on e.id = d.employee_id
      left join public.ep_work_reports w on w.employee_id = d.employee_id and w.report_date = d.work_date
      where exists (select 1 from public.ep_project_members m where m.employee_id = e.id)
        and (w.id is null or w.status in ('draft', 'returned'))), '[]'::jsonb));
end $function$;

-- public.ep_admin_review_report
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
  perform public.rbac_require('portal.reports'); -- rbac
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

-- public.ep_admin_save_custom_reminder
CREATE OR REPLACE FUNCTION public.ep_admin_save_custom_reminder(p_id uuid, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform public.rbac_require('portal.notifications'); -- rbac
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
end $function$;

-- public.ep_admin_save_holiday
CREATE OR REPLACE FUNCTION public.ep_admin_save_holiday(p_id uuid, p_date date, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_old date;
  v_name text := btrim(coalesce(p_name, ''));
begin
  perform public.rbac_require('portal.leave'); -- rbac
  if p_date is null or p_date not between date '2020-01-01' and date '2100-12-31' then
    raise exception 'Choose a valid date.' using errcode = '22023';
  end if;
  if length(v_name) not between 1 and 80 then
    raise exception 'Holiday name is required (up to 80 characters).' using errcode = '22023';
  end if;
  if exists (select 1 from public.ep_holidays where holiday_date = p_date and id is distinct from p_id) then
    raise exception '% is already a holiday.', to_char(p_date, 'DD Mon YYYY') using errcode = '23505';
  end if;
  if p_id is null then
    insert into public.ep_holidays (holiday_date, name) values (p_date, v_name);
  else
    select holiday_date into v_old from public.ep_holidays where id = p_id for update;
    if not found then
      raise exception 'Holiday not found.' using errcode = 'P0002';
    end if;
    update public.ep_holidays set holiday_date = p_date, name = v_name where id = p_id;
    if v_old <> p_date then
      perform public.ep_recount_leave_on(v_old);
    end if;
  end if;
  perform public.ep_recount_leave_on(p_date);
  return public.ep_admin_holidays(extract(year from p_date)::int);
end $function$;

-- public.ep_admin_save_reminder
CREATE OR REPLACE FUNCTION public.ep_admin_save_reminder(p_kind text, p_enabled boolean, p_send_at time without time zone, p_days smallint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.notifications'); -- rbac
  if p_send_at is null or p_send_at < time '06:00' or p_send_at > time '21:55' then
    raise exception 'Choose a time between 6:00 AM and 9:55 PM.' using errcode = '22023';
  end if;
  if p_days is null or cardinality(p_days) = 0 or not (p_days <@ '{1,2,3,4,5,6,7}'::smallint[]) then
    raise exception 'Choose at least one day.' using errcode = '22023';
  end if;
  update public.ep_reminder_settings
     set enabled = coalesce(p_enabled, false), send_at = p_send_at,
         days = (select array_agg(distinct d order by d) from unnest(p_days) d), updated_at = now()
   where kind = p_kind;
  if not found then
    raise exception 'Reminder not found.' using errcode = 'P0002';
  end if;
  return public.ep_admin_reminder_settings();
end $function$;

-- public.ep_admin_send_custom_reminder_now
CREATE OR REPLACE FUNCTION public.ep_admin_send_custom_reminder_now(p_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.notifications'); -- rbac
  if not exists (select 1 from public.ep_custom_reminders where id = p_id) then
    raise exception 'Reminder not found.' using errcode = 'P0002';
  end if;
  return public.ep_send_custom_reminder(p_id);
end $function$;

-- public.ep_admin_send_notification
CREATE OR REPLACE FUNCTION public.ep_admin_send_notification(p_audience text, p_to uuid[], p_departments text[], p_project uuid, p_title text, p_body text, p_priority text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_msg   uuid := gen_random_uuid();
  v_title text := btrim(coalesce(p_title, ''));
  v_body  text := nullif(btrim(coalesce(p_body, '')), '');
  v_n     integer;
begin
  perform public.rbac_require('portal.notifications'); -- rbac
  if length(v_title) not between 1 and 150 then
    raise exception 'Subject must be 1 to 150 characters.' using errcode = '22023';
  end if;
  if coalesce(length(v_body), 0) > 2000 then
    raise exception 'Message must be at most 2000 characters.' using errcode = '22023';
  end if;
  if coalesce(p_priority, '') not in ('normal', 'urgent') then
    raise exception 'Invalid priority.' using errcode = '22023';
  end if;
  if p_audience not in ('all', 'people', 'department', 'project') then
    raise exception 'Invalid audience.' using errcode = '22023';
  end if;
  if p_audience = 'people' and coalesce(cardinality(p_to), 0) = 0 then
    raise exception 'Choose at least one person.' using errcode = '22023';
  end if;
  if p_audience = 'department' and coalesce(cardinality(p_departments), 0) = 0 then
    raise exception 'Choose at least one department.' using errcode = '22023';
  end if;
  if p_audience = 'project' and p_project is null then
    raise exception 'Choose a project team.' using errcode = '22023';
  end if;

  insert into public.ep_notifications
    (employee_id, kind, priority, title, body, sender_employee_id, sender_user_id, sender_label, message_id)
  select e.id, 'message', p_priority, v_title, v_body, null, auth.uid(), 'Admin', v_msg
    from public.ep_employees e
   where e.is_active
     and case p_audience
           when 'all'        then true
           when 'people'     then e.id = any (p_to)
           when 'department' then e.department = any (p_departments)
           else exists (select 1 from public.ep_project_members m where m.project_id = p_project and m.employee_id = e.id)
         end;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Nobody active matches this audience.' using errcode = '22023';
  end if;
  return jsonb_build_object('message_id', v_msg, 'recipients', v_n);
end $function$;

-- public.ep_admin_send_reminder_now
CREATE OR REPLACE FUNCTION public.ep_admin_send_reminder_now(p_kind text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_key    text;
  v_before integer;
  v_after  integer;
begin
  perform public.rbac_require('portal.notifications'); -- rbac
  if p_kind not in ('punch_in', 'report', 'punch_out', 'deadlines') then
    raise exception 'Reminder not found.' using errcode = 'P0002';
  end if;
  v_key := p_kind || ':' || (timezone('Asia/Kolkata', now()))::date || '%';
  select count(*) into v_before from public.ep_notifications where dedupe_key like v_key;
  if p_kind = 'deadlines' then
    perform public.ep_send_deadline_reminders();
  else
    perform public.ep_send_reminders(p_kind);
  end if;
  select count(*) into v_after from public.ep_notifications where dedupe_key like v_key;
  return v_after - v_before;
end $function$;

-- public.ep_admin_set_certificate
CREATE OR REPLACE FUNCTION public.ep_admin_set_certificate(p_emp uuid, p_path text, p_name text, p_size bigint, p_mime text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_type text;
  v_old  text;
begin
  perform public.rbac_require('portal.employees'); -- rbac
  select employment_type into v_type from public.ep_employees where id = p_emp;
  if not found then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  if v_type is distinct from 'intern' then
    raise exception 'Set the employment type to Intern first.' using errcode = '22023';
  end if;
  if p_path is null or p_path not like p_emp::text || '/%' then
    raise exception 'Invalid file location.' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'ep-certificates' and name = p_path) then
    raise exception 'The file was not uploaded.' using errcode = 'P0002';
  end if;
  select storage_path into v_old from public.ep_internship_certificates where employee_id = p_emp for update;
  insert into public.ep_internship_certificates (employee_id, storage_path, file_name, file_size, mime_type, uploaded_by, uploaded_at)
  values (p_emp, p_path, left(btrim(p_name), 255), p_size, p_mime, auth.uid(), now())
  on conflict (employee_id) do update
    set storage_path = excluded.storage_path, file_name = excluded.file_name, file_size = excluded.file_size,
        mime_type = excluded.mime_type, uploaded_by = excluded.uploaded_by, uploaded_at = now();
  perform public.ep_notify(p_emp, 'message',
    case when v_old is null then 'Your internship certificate is ready' else 'Your internship certificate was updated' end,
    'Download it from My Profile.', '/employee/profile');
  return jsonb_build_object('old_path', case when v_old is distinct from p_path then v_old end);
end $function$;

-- public.ep_admin_set_employee_access
CREATE OR REPLACE FUNCTION public.ep_admin_set_employee_access(p_id uuid, p_active boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.employees'); -- rbac
  if p_active is null then
    raise exception 'Choose on or off.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.ep_employees where id = p_id) then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  -- Same lock as punch in / out, so a punch cannot slip in while access is turned off.
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  update public.ep_employees set is_active = p_active, updated_at = now()
   where id = p_id and is_active is distinct from p_active;
  if not p_active then
    update public.ep_attendance set punch_out_at = now()
     where employee_id = p_id and punch_out_at is null;
  end if;
  return public.ep_admin_employee(p_id);
end $function$;

-- public.ep_admin_set_leave_allowance
CREATE OR REPLACE FUNCTION public.ep_admin_set_leave_allowance(p_emp uuid, p_year integer, p_type text, p_days numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_type public.ep_leave_types;
  v_approved numeric;
begin
  perform public.rbac_require('portal.leave'); -- rbac
  select * into v_type from public.ep_leave_types where code = p_type;
  if v_type.code is null or not v_type.is_paid then
    raise exception 'Only paid leave types have a balance.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.ep_employees where id = p_emp) then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  if p_year is null or p_year not between 2020 and 2100 then
    raise exception 'Invalid year.' using errcode = '22023';
  end if;
  if p_days is null then
    delete from public.ep_leave_allocations where employee_id = p_emp and year = p_year and leave_type = p_type;
  else
    if p_days < 0 or p_days > 366 or p_days * 2 <> round(p_days * 2) then
      raise exception 'Days must be between 0 and 366, in steps of 0.5.' using errcode = '22023';
    end if;
    select coalesce(sum(days), 0) into v_approved from public.ep_leave_requests
     where employee_id = p_emp and leave_type = p_type and status = 'approved' and extract(year from start_date) = p_year;
    if p_days < v_approved then
      raise exception '% days of % are already approved this year; the balance cannot be lower.', v_approved, v_type.name
        using errcode = '22023';
    end if;
    insert into public.ep_leave_allocations (employee_id, year, leave_type, days)
    values (p_emp, p_year, p_type, p_days)
    on conflict (employee_id, year, leave_type) do update set days = excluded.days;
  end if;
  return public.ep_leave_balance_json(p_emp, p_year, p_type);
end $function$;

-- public.ep_admin_update_employee
CREATE OR REPLACE FUNCTION public.ep_admin_update_employee(p_id uuid, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f text;
  v_old public.ep_employees;
  v_new public.ep_employees;
  v_mgr uuid;
  v_walk uuid;
  v_depth int := 0;
  v_mgr_name text;
  v_code text;
begin
  perform public.rbac_require('portal.employees'); -- rbac
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Invalid employee data.' using errcode = '22023';
  end if;
  for f in select jsonb_object_keys(p) loop
    if f not in ('employee_code', 'full_name', 'department', 'designation', 'reporting_manager_id', 'reporting_manager_name',
                 'date_of_joining', 'employment_type', 'work_location') then
      raise exception 'Field % cannot be changed here.', f using errcode = '42501';
    end if;
  end loop;

  select * into v_old from public.ep_employees where id = p_id for update;
  if v_old.id is null then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;

  if p ? 'full_name' and nullif(btrim(p ->> 'full_name'), '') is null then
    raise exception 'Name cannot be empty.' using errcode = '22023';
  end if;

  -- Employee ID: the admin may change it (sign-in stays the same: it uses the email).
  v_code := case when p ? 'employee_code' then upper(btrim(coalesce(p ->> 'employee_code', ''))) else v_old.employee_code end;
  if v_code !~ '^[A-Z0-9][A-Z0-9-]{1,29}$' then
    raise exception 'Employee ID: use 2-30 letters, numbers or dashes (e.g. ZT-001).' using errcode = '22023';
  end if;
  if v_code <> v_old.employee_code
     and exists (select 1 from public.ep_employees where employee_code = v_code and id <> p_id) then
    raise exception 'Employee ID % is already used by another employee.', v_code using errcode = '23505';
  end if;

  -- Reporting manager: must exist, be active, not the employee, and not create a loop.
  v_mgr := case when p ? 'reporting_manager_id'
                then nullif(btrim(p ->> 'reporting_manager_id'), '')::uuid
                else v_old.reporting_manager_id end;
  if p ? 'reporting_manager_id' and v_mgr is not null
     and v_mgr is distinct from v_old.reporting_manager_id then
    if v_mgr = p_id then
      raise exception 'An employee cannot report to themselves.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.ep_employees where id = v_mgr and is_active) then
      raise exception 'Choose an active employee as reporting manager.' using errcode = '22023';
    end if;
    v_walk := v_mgr;
    while v_walk is not null and v_depth < 100 loop
      if v_walk = p_id then
        raise exception 'That would make a loop: this employee is above the chosen manager.' using errcode = '22023';
      end if;
      select reporting_manager_id into v_walk from public.ep_employees where id = v_walk;
      v_depth := v_depth + 1;
    end loop;
  end if;

  -- Typed manager name (someone who is not in the portal). A portal manager replaces it.
  v_mgr_name := case when p ? 'reporting_manager_name' then nullif(btrim(coalesce(p ->> 'reporting_manager_name', '')), '')
                     else v_old.reporting_manager_name end;
  if v_mgr is not null then
    v_mgr_name := null;
  end if;
  if length(v_mgr_name) > 120 then
    raise exception 'Manager name must be at most 120 characters.' using errcode = '22023';
  end if;

  update public.ep_employees set
    full_name            = case when p ? 'full_name' then btrim(p ->> 'full_name') else full_name end,
    department           = case when p ? 'department' then nullif(btrim(p ->> 'department'), '') else department end,
    designation          = case when p ? 'designation' then nullif(btrim(p ->> 'designation'), '') else designation end,
    employee_code        = v_code,
    reporting_manager_id = v_mgr,
    reporting_manager_name = v_mgr_name,
    date_of_joining      = case when p ? 'date_of_joining' then nullif(btrim(p ->> 'date_of_joining'), '')::date else date_of_joining end,
    employment_type      = case when p ? 'employment_type' then nullif(btrim(p ->> 'employment_type'), '') else employment_type end,
    work_location        = case when p ? 'work_location' then nullif(btrim(p ->> 'work_location'), '') else work_location end,
    updated_at           = now()
  where id = p_id
  returning * into v_new;

  if v_new.employee_code is distinct from v_old.employee_code then
    perform public.ep_notify(
      p_id, 'message', 'Your Employee ID was changed',
      'Your Employee ID is now ' || v_new.employee_code || ' (was ' || v_old.employee_code
        || '). You still sign in with the same email and password.',
      '/employee/profile');
  end if;

  -- Tell the people concerned when the reporting line changes.
  if v_new.reporting_manager_id is distinct from v_old.reporting_manager_id then
    if v_new.reporting_manager_id is not null then
      perform public.ep_notify(
        p_id, 'message', 'Your reporting manager was updated',
        'You now report to ' || (select full_name from public.ep_employees where id = v_new.reporting_manager_id) || '.',
        '/employee/profile');
      perform public.ep_notify(
        v_new.reporting_manager_id, 'message', v_new.full_name || ' now reports to you',
        v_new.full_name || ' (' || v_new.employee_code || ') was added to your team by the admin.',
        null);
    elsif v_new.reporting_manager_name is null then
      perform public.ep_notify(
        p_id, 'message', 'Your reporting manager was removed',
        'No reporting manager is set for you right now.', '/employee/profile');
    end if;
  end if;

  -- A typed (non-portal) manager set or changed: tell the employee.
  if v_new.reporting_manager_id is null and v_new.reporting_manager_name is not null
     and v_new.reporting_manager_name is distinct from v_old.reporting_manager_name then
    perform public.ep_notify(
      p_id, 'message', 'Your reporting manager was updated',
      'You now report to ' || v_new.reporting_manager_name || '.', '/employee/profile');
  end if;

  return public.ep_admin_employee(p_id);
end $function$;

-- public.ep_apply_leave
CREATE OR REPLACE FUNCTION public.ep_apply_leave(p_type text, p_start date, p_end date, p_half text, p_reason text, p_manager_id uuid, p_manager_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp     uuid := public.ep_current_employee_id();
  v_today   date := (timezone('Asia/Kolkata', now()))::date;
  v_name    text;
  v_type    public.ep_leave_types;
  v_days    numeric;
  v_allowed numeric;
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_half    text := nullif(p_half, '');
  v_mgr     uuid := p_manager_id;
  v_mgrname text := nullif(btrim(coalesce(p_manager_name, '')), '');
  v_row     public.ep_leave_requests;
  v_rev     uuid;
begin
  perform public.rbac_require('emp.leave'); -- rbac
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  select * into v_type from public.ep_leave_types where code = p_type and is_active;
  if v_type.code is null then
    raise exception 'Choose a leave type.' using errcode = '22023';
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'Choose a valid start and end date.' using errcode = '22023';
  end if;
  if extract(year from p_start) <> extract(year from p_end) then
    raise exception 'A leave request cannot cross into the next year. Apply for each year separately.' using errcode = '22023';
  end if;
  if p_start < v_today - 30 or p_end > v_today + 365 then
    raise exception 'Leave can start at most 30 days ago and end at most one year ahead.' using errcode = '22023';
  end if;
  if v_half is not null and (v_half not in ('first_half', 'second_half') or p_start <> p_end) then
    raise exception 'A half day must be a single date.' using errcode = '22023';
  end if;
  if length(v_reason) not between 1 and 1000 then
    raise exception 'Write a reason (up to 1000 characters).' using errcode = '22023';
  end if;

  -- Reporting manager: a picked colleague (must be active, not yourself) and/or a typed name.
  if v_mgr is not null then
    select full_name into v_mgrname from public.ep_employees where id = v_mgr and is_active and id <> v_emp;
    if v_mgrname is null then
      raise exception 'Choose a valid reporting manager.' using errcode = '22023';
    end if;
  end if;
  if v_mgrname is null then
    raise exception 'Enter your reporting manager.' using errcode = '22023';
  end if;
  if length(v_mgrname) > 120 then
    raise exception 'Reporting manager name must be at most 120 characters.' using errcode = '22023';
  end if;

  select full_name into v_name from public.ep_employees where id = v_emp;

  perform pg_advisory_xact_lock(hashtextextended('leave' || v_emp::text, 0));

  v_days := public.ep_leave_day_count(p_start, p_end, v_half);
  if v_days = 0 then
    raise exception 'These dates are only Sundays or company holidays, so no leave is needed.' using errcode = '22023';
  end if;
  if exists (select 1 from public.ep_leave_requests r
              where r.employee_id = v_emp and r.status in ('manager_review', 'pending', 'manager_pending', 'approved')
                and r.start_date <= p_end and r.end_date >= p_start
                and not (r.start_date = r.end_date and p_start = p_end and r.half_day is not null and v_half is not null
                         and r.half_day <> v_half)) then
    raise exception 'You already have leave on some of these dates.' using errcode = '22023';
  end if;
  v_allowed := public.ep_leave_allowance(v_emp, extract(year from p_start)::int, p_type);
  if v_type.is_paid and v_allowed is not null
     and public.ep_leave_taken(v_emp, extract(year from p_start)::int, p_type) + v_days > v_allowed then
    raise exception 'Not enough % balance: % day(s) left, % requested.', v_type.name,
      greatest(v_allowed - public.ep_leave_taken(v_emp, extract(year from p_start)::int, p_type), 0), v_days
      using errcode = '22023';
  end if;

  -- Who reviews first: the profile's reporting manager (active portal account), else the colleague
  -- picked on the form. With a reviewing manager the request starts with them (manager_review);
  -- without one it goes straight to the admin (pending).
  select m.id into v_rev
    from public.ep_employees e join public.ep_employees m on m.id = e.reporting_manager_id
   where e.id = v_emp and m.is_active and m.id <> v_emp
     and public.rbac_user_can(m.user_id, 'team.leave');
  if v_rev is null and v_mgr is not null
     and public.rbac_user_can((select user_id from public.ep_employees where id = v_mgr), 'team.leave') then
    v_rev := v_mgr;
  end if;

  insert into public.ep_leave_requests
    (employee_id, leave_type, start_date, end_date, half_day, days, reason, approver_id, approver_name, status)
  values (v_emp, p_type, p_start, p_end, v_half, v_days, v_reason, coalesce(v_rev, v_mgr), v_mgrname,
          case when v_rev is not null then 'manager_review' else 'pending' end)
  returning * into v_row;

  -- Only a colleague in the portal can be notified.
  perform public.ep_notify(v_rev, 'leave',
    v_name || ' applied for ' || v_type.name || ' — please review',
    to_char(p_start, 'DD Mon') || case when p_end <> p_start then ' – ' || to_char(p_end, 'DD Mon YYYY') else to_char(p_start, ' YYYY') end
      || ' · ' || v_days || ' day(s) · ' || left(v_reason, 200)
      || ' · review it and send it to the admin (or reject it) in Team requests.',
    '/employee/leave/team');
  return public.ep_leave_json(v_row);
end $function$;

-- public.ep_cancel_leave
CREATE OR REPLACE FUNCTION public.ep_cancel_leave(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp   uuid := public.ep_current_employee_id();
  v_row   public.ep_leave_requests;
  v_name  text;
begin
  perform public.rbac_require('emp.leave'); -- rbac
  select * into v_row from public.ep_leave_requests where id = p_id and employee_id = v_emp for update;
  if v_emp is null or v_row.id is null then
    raise exception 'Leave request not found.' using errcode = '42501';
  end if;
  -- Once the admin has approved or rejected it, the employee can no longer cancel it.
  if v_row.status = 'manager_pending' then
    raise exception 'The admin already approved this leave and it is now with your reporting manager, so it can no longer be cancelled. Please contact the admin.'
      using errcode = 'P0001';
  end if;
  if v_row.status not in ('manager_review', 'pending') then
    raise exception 'This leave was already % by the admin, so it can no longer be cancelled. Please contact the admin.',
      v_row.status using errcode = 'P0001';
  end if;
  update public.ep_leave_requests set status = 'cancelled', updated_at = now() where id = p_id returning * into v_row;
  select full_name into v_name from public.ep_employees where id = v_emp;
  perform public.ep_notify(v_row.approver_id, 'leave',
    v_name || ' cancelled a leave request',
    to_char(v_row.start_date, 'DD Mon YYYY') || case when v_row.end_date <> v_row.start_date then ' – ' || to_char(v_row.end_date, 'DD Mon YYYY') else '' end,
    '/employee/leave');
  return public.ep_leave_json(v_row);
end $function$;

-- public.ep_decide_leave
CREATE OR REPLACE FUNCTION public.ep_decide_leave(p_id uuid, p_action text, p_comment text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp     uuid := public.ep_current_employee_id();
  v_row     public.ep_leave_requests;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_allowed numeric;
  v_type    public.ep_leave_types;
  v_me      text;
  v_what    text;
begin
  perform public.rbac_require('team.leave'); -- rbac
  select r.* into v_row from public.ep_leave_requests r join public.ep_employees e on e.id = r.employee_id
   where r.id = p_id and (r.approver_id = v_emp or e.reporting_manager_id = v_emp) and r.employee_id <> v_emp
   for update of r;
  if v_emp is null or v_row.id is null then
    raise exception 'Leave request not found.' using errcode = '42501';
  end if;
  if v_row.status = 'pending' then
    raise exception 'This request is with the admin now.' using errcode = 'P0001';
  end if;
  if v_row.status not in ('manager_review', 'manager_pending') then
    raise exception 'This request was already %.', v_row.status using errcode = 'P0001';
  end if;
  if v_row.status = 'manager_review' and p_action not in ('forward', 'rejected') then
    raise exception 'Send it to the admin or reject it.' using errcode = '22023';
  end if;
  if v_row.status = 'manager_pending' and p_action not in ('approved', 'rejected') then
    raise exception 'Invalid action.' using errcode = '22023';
  end if;
  if p_action = 'rejected' and v_comment is null then
    raise exception 'Write a reason for rejecting.' using errcode = '22023';
  end if;
  if coalesce(length(v_comment), 0) > 1000 then
    raise exception 'Comment must be at most 1000 characters.' using errcode = '22023';
  end if;
  select * into v_type from public.ep_leave_types where code = v_row.leave_type;
  select full_name into v_me from public.ep_employees where id = v_emp;
  v_what := v_type.name || ' · ' || to_char(v_row.start_date, 'DD Mon YYYY')
    || case when v_row.end_date <> v_row.start_date then ' – ' || to_char(v_row.end_date, 'DD Mon YYYY') else '' end;

  if p_action = 'forward' then
    update public.ep_leave_requests
       set status = 'pending', approver_id = v_emp, manager_reviewed_by = v_emp, manager_reviewed_at = now(),
           manager_review_comment = v_comment, updated_at = now()
     where id = p_id returning * into v_row;
    perform public.ep_notify(v_row.employee_id, 'leave',
      'Your manager sent your leave to the admin',
      v_what || ' · reviewed by ' || v_me || ' · now waiting for the admin', '/employee/leave', 'normal');
    return public.ep_leave_json(v_row);
  end if;

  if p_action = 'approved' then
    -- The balance may have changed since the admin approved; check again without this request.
    v_allowed := public.ep_leave_allowance(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type);
    if v_type.is_paid and v_allowed is not null
       and public.ep_leave_taken(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type, v_row.id)
           + v_row.days > v_allowed then
      raise exception 'Not enough % balance left to approve this.', v_type.name using errcode = '22023';
    end if;
  end if;
  update public.ep_leave_requests
     set status = p_action, decided_by = v_emp, decided_at = now(), decision_comment = v_comment,
         manager_reviewed_by = coalesce(manager_reviewed_by, v_emp),
         manager_reviewed_at = coalesce(manager_reviewed_at, now()),
         updated_at = now()
   where id = p_id returning * into v_row;
  perform public.ep_notify(v_row.employee_id, 'leave',
    'Your leave was ' || p_action,
    v_what || case when p_action = 'rejected' then coalesce(' · ' || v_comment, '') else '' end,
    '/employee/leave', case when p_action = 'rejected' then 'urgent' else 'normal' end);
  return public.ep_leave_json(v_row);
end $function$;

-- public.ep_delete_my_document
CREATE OR REPLACE FUNCTION public.ep_delete_my_document(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp  uuid := public.ep_current_employee_id();
  v_path text;
begin
  perform public.rbac_require('emp.documents'); -- rbac
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  delete from public.ep_employee_documents where id = p_id and employee_id = v_emp returning storage_path into v_path;
  if v_path is null then
    raise exception 'Document not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('old_path', v_path);
end $function$;

-- public.ep_message_options
CREATE OR REPLACE FUNCTION public.ep_message_options()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_admin boolean := public.rbac_can('portal.notifications');
  v_emp   uuid    := public.ep_current_employee_id();
begin
  if not v_admin and v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'can_all',  v_admin,
    'can_team', v_emp is not null and exists (select 1 from public.ep_employees where reporting_manager_id = v_emp and is_active),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
                                          'designation', e.designation, 'department', e.department,
                                          'is_my_team', e.reporting_manager_id is not distinct from v_emp and v_emp is not null)
             order by e.full_name)
      from public.ep_employees e where e.is_active and e.id is distinct from v_emp), '[]'::jsonb));
end $function$;

-- public.ep_post_update
CREATE OR REPLACE FUNCTION public.ep_post_update(p_project uuid, p_body text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp uuid := public.ep_current_employee_id();
  v_id  uuid;
begin
  perform public.rbac_require('emp.projects'); -- rbac
  if v_emp is null or not exists (select 1 from public.ep_project_members where project_id = p_project and employee_id = v_emp) then
    raise exception 'You are not on this project.' using errcode = '42501';
  end if;
  insert into public.ep_project_updates (project_id, author_id, body)
  values (p_project, v_emp, btrim(p_body))
  returning id into v_id;
  return v_id;
end $function$;

-- public.ep_punch_in
CREATE OR REPLACE FUNCTION public.ep_punch_in()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp uuid;
  v_row public.ep_attendance;
begin
  perform public.rbac_require('emp.attendance'); -- rbac
  select id into v_emp from public.ep_employees where user_id = auth.uid() and is_active;
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_emp::text, 0));
  perform public.ep_close_overdue_sessions(v_emp);
  if exists (select 1 from public.ep_attendance where employee_id = v_emp and punch_out_at is null) then
    raise exception 'You are already punched in.' using errcode = 'P0001';
  end if;
  insert into public.ep_attendance (employee_id) values (v_emp) returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'punch_in_at', v_row.punch_in_at, 'work_date', v_row.work_date);
end $function$;

-- public.ep_punch_out
CREATE OR REPLACE FUNCTION public.ep_punch_out()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp uuid;
  v_row public.ep_attendance;
begin
  perform public.rbac_require('emp.attendance'); -- rbac
  select id into v_emp from public.ep_employees where user_id = auth.uid() and is_active;
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_emp::text, 0));
  -- Already past the cut-off: keep the automatic punch out time (not now()).
  -- No exception here, it would roll the automatic punch out back.
  if public.ep_close_overdue_sessions(v_emp) > 0 then
    select * into v_row from public.ep_attendance
     where employee_id = v_emp and auto_punched_out order by punch_out_at desc limit 1;
    return jsonb_build_object('id', v_row.id, 'punch_in_at', v_row.punch_in_at, 'punch_out_at', v_row.punch_out_at,
                              'auto_punched_out', true);
  end if;
  update public.ep_attendance
     set punch_out_at = now()
   where employee_id = v_emp and punch_out_at is null
  returning * into v_row;
  if v_row.id is null then
    raise exception 'You are not punched in.' using errcode = 'P0001';
  end if;
  return jsonb_build_object('id', v_row.id, 'punch_in_at', v_row.punch_in_at, 'punch_out_at', v_row.punch_out_at);
end $function$;

-- public.ep_request_correction
CREATE OR REPLACE FUNCTION public.ep_request_correction(p_date date, p_attendance uuid, p_in timestamp with time zone, p_out timestamp with time zone, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp uuid := public.ep_current_employee_id();
  v_chk record;
  v_att public.ep_attendance;
  v_row public.ep_attendance_corrections;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform public.rbac_require('emp.attendance'); -- rbac
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if length(v_reason) not between 1 and 500 then
    raise exception 'Write a reason (up to 500 characters).' using errcode = '22023';
  end if;
  if exists (select 1 from public.ep_attendance_corrections
              where employee_id = v_emp and work_date = p_date and status = 'pending') then
    raise exception 'You already have a pending correction for this day.' using errcode = '23505';
  end if;
  select * into v_chk from public.ep_correction_check(v_emp, p_date, p_attendance, p_in, p_out);
  if p_attendance is not null then
    select * into v_att from public.ep_attendance where id = p_attendance;
  end if;
  insert into public.ep_attendance_corrections
    (employee_id, work_date, attendance_id, requested_in, requested_out, old_in, old_out, reason)
  values (v_emp, p_date, p_attendance,
          case when p_attendance is null or p_in is distinct from v_att.punch_in_at then p_in end,
          case when p_attendance is null or p_out is distinct from v_att.punch_out_at then p_out end,
          v_att.punch_in_at, v_att.punch_out_at, v_reason)
  returning * into v_row;
  if v_row.requested_in is null and v_row.requested_out is null then
    raise exception 'The times are the same as now — nothing to correct.' using errcode = '22023';
  end if;
  return public.ep_correction_json(v_row);
end $function$;

-- public.ep_review_report
CREATE OR REPLACE FUNCTION public.ep_review_report(p_report uuid, p_action text, p_comment text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp     uuid := public.ep_current_employee_id();
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_status  text;
begin
  perform public.rbac_require('team.reports'); -- rbac
  select r.status into v_status
    from public.ep_work_reports r join public.ep_employees e on e.id = r.employee_id
   where r.id = p_report and r.status <> 'draft'
     and (r.submitted_to = v_emp or e.reporting_manager_id = v_emp)
   for update of r;
  if v_emp is null or v_status is null then
    raise exception 'Report not found.' using errcode = '42501';
  end if;
  if v_status <> 'submitted' then
    raise exception 'Only a submitted report can be reviewed.' using errcode = 'P0001';
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
     set status = p_action, reviewed_by = v_emp, reviewed_at = now(), review_comment = v_comment, updated_at = now()
   where id = p_report;
  return public.ep_report_json(p_report);
end $function$;

-- public.ep_save_my_report
CREATE OR REPLACE FUNCTION public.ep_save_my_report(p_date date, p_notes text, p_items jsonb, p_submit boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp    uuid := public.ep_current_employee_id();
  v_today  date := (timezone('Asia/Kolkata', now()))::date;
  v_mgr    uuid;
  v_rep    public.ep_work_reports;
  v_item   jsonb;
  v_pid    uuid;
  v_hours  numeric;
  v_total  numeric := 0;
  v_seen   uuid[] := '{}';
  v_pos    int := 0;
  v_notes  text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  perform public.rbac_require('emp.reports'); -- rbac
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if p_date is null or p_date > v_today then
    raise exception 'You cannot write a report for a future date.' using errcode = '22023';
  end if;
  if p_date < v_today - 7 then
    raise exception 'Reports can only be written for today and the last 7 days.' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Invalid report entries.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 20 then
    raise exception 'A report can have at most 20 project entries.' using errcode = '22023';
  end if;
  if coalesce(length(v_notes), 0) > 2000 then
    raise exception 'Notes must be at most 2000 characters.' using errcode = '22023';
  end if;
  if p_submit and jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one project entry before submitting.' using errcode = '22023';
  end if;

  select reporting_manager_id into v_mgr from public.ep_employees where id = v_emp;
  -- No reporting manager in the portal: the report is submitted to the admin (submitted_to stays null).

  -- Serialise saves of the same report.
  perform pg_advisory_xact_lock(hashtextextended(v_emp::text || p_date::text, 0));
  select * into v_rep from public.ep_work_reports where employee_id = v_emp and report_date = p_date;
  if v_rep.id is not null and v_rep.status in ('submitted', 'reviewed') then
    raise exception 'This report is already submitted and cannot be changed.' using errcode = 'P0001';
  end if;

  -- Validate every entry before writing anything.
  for v_item in select * from jsonb_array_elements(p_items) loop
    begin
      v_pid   := (v_item ->> 'project_id')::uuid;
      v_hours := (v_item ->> 'hours')::numeric;
    exception when others then
      raise exception 'Invalid report entries.' using errcode = '22023';
    end;
    if v_pid is null or not exists (select 1 from public.ep_project_members where project_id = v_pid and employee_id = v_emp) then
      raise exception 'You can only report on projects you are assigned to.' using errcode = '42501';
    end if;
    if v_pid = any (v_seen) then
      raise exception 'Each project can be added only once per report.' using errcode = '22023';
    end if;
    v_seen := v_seen || v_pid;
    if v_hours is null or v_hours <= 0 or v_hours > 24 or v_hours <> round(v_hours, 2) then
      raise exception 'Hours spent must be more than 0 and at most 24 for each project.' using errcode = '22023';
    end if;
    v_total := v_total + v_hours;
    if coalesce(btrim(v_item ->> 'task_updates'), '') = '' and coalesce(btrim(v_item ->> 'completed_work'), '') = ''
       and coalesce(btrim(v_item ->> 'pending_work'), '') = '' then
      raise exception 'Write what you worked on for every project you added.' using errcode = '22023';
    end if;
    if greatest(length(v_item ->> 'task_updates'), length(v_item ->> 'completed_work'), length(v_item ->> 'pending_work')) > 2000 then
      raise exception 'Each text box can have at most 2000 characters.' using errcode = '22023';
    end if;
  end loop;
  if v_total > 24 then
    raise exception 'Total hours for the day cannot be more than 24.' using errcode = '22023';
  end if;

  if v_rep.id is null then
    insert into public.ep_work_reports (employee_id, report_date, notes)
    values (v_emp, p_date, v_notes) returning * into v_rep;
  else
    update public.ep_work_reports set notes = v_notes, updated_at = now() where id = v_rep.id;
  end if;

  delete from public.ep_work_report_items where report_id = v_rep.id;
  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.ep_work_report_items (report_id, project_id, task_updates, completed_work, pending_work, hours, position)
    values (v_rep.id, (v_item ->> 'project_id')::uuid,
            nullif(btrim(coalesce(v_item ->> 'task_updates', '')), ''),
            nullif(btrim(coalesce(v_item ->> 'completed_work', '')), ''),
            nullif(btrim(coalesce(v_item ->> 'pending_work', '')), ''),
            (v_item ->> 'hours')::numeric, v_pos);
    v_pos := v_pos + 1;
  end loop;

  if p_submit then
    update public.ep_work_reports
       set status = 'submitted', submitted_to = v_mgr, submitted_at = now(), updated_at = now(),
           reviewed_by = null, reviewed_at = null, review_comment = null
     where id = v_rep.id;
  end if;

  return public.ep_my_report(p_date);
end $function$;

-- public.ep_send_message
CREATE OR REPLACE FUNCTION public.ep_send_message(p_audience text, p_to uuid[], p_title text, p_body text, p_priority text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_admin  boolean := public.rbac_can('portal.notifications');
  v_emp    uuid    := public.ep_current_employee_id();
  v_label  text;
  v_msg    uuid    := gen_random_uuid();
  v_title  text    := btrim(coalesce(p_title, ''));
  v_body   text    := nullif(btrim(coalesce(p_body, '')), '');
  v_n      integer;
begin
  if not v_admin and v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if length(v_title) not between 1 and 150 then
    raise exception 'Subject must be 1 to 150 characters.' using errcode = '22023';
  end if;
  if coalesce(length(v_body), 0) > 2000 then
    raise exception 'Message must be at most 2000 characters.' using errcode = '22023';
  end if;
  if coalesce(p_priority, '') not in ('normal', 'urgent') then
    raise exception 'Invalid priority.' using errcode = '22023';
  end if;
  if p_audience = 'all' and not v_admin then
    raise exception 'Only an admin can message everyone.' using errcode = '42501';
  end if;
  if p_audience = 'team' and (v_emp is null
       or not exists (select 1 from public.ep_employees where reporting_manager_id = v_emp and is_active)) then
    raise exception 'You do not have a team to message.' using errcode = '42501';
  end if;
  if p_audience = 'people' and (p_to is null or cardinality(p_to) = 0) then
    raise exception 'Choose at least one person.' using errcode = '22023';
  end if;
  if p_audience = 'people' and cardinality(p_to) > 100 then
    raise exception 'Choose at most 100 people.' using errcode = '22023';
  end if;
  if p_audience not in ('people', 'team', 'all') then
    raise exception 'Invalid audience.' using errcode = '22023';
  end if;
  if not v_admin and p_audience = 'team' and not public.rbac_can('team.messages') then -- rbac
    raise exception 'You do not have permission to message your team.' using errcode = '42501';
  end if;
  if not v_admin and p_audience = 'people' and not public.rbac_can('emp.messages') then -- rbac
    raise exception 'You do not have permission to send messages.' using errcode = '42501';
  end if;

  -- The sender's own employee name when they are an employee, else "Admin".
  select coalesce((select full_name from public.ep_employees where id = v_emp), 'Admin') into v_label;
  if v_admin and v_emp is null then
    v_label := 'Admin';
  end if;

  insert into public.ep_notifications
    (employee_id, kind, priority, title, body, sender_employee_id, sender_user_id, sender_label, message_id)
  select e.id, 'message', p_priority, v_title, v_body, v_emp, auth.uid(), v_label, v_msg
    from public.ep_employees e
   where e.is_active
     and e.id is distinct from v_emp
     and case p_audience
           when 'all'    then true
           when 'team'   then e.reporting_manager_id = v_emp
           else e.id = any (p_to)
         end;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'None of the chosen people can receive messages.' using errcode = '22023';
  end if;
  return jsonb_build_object('message_id', v_msg, 'recipients', v_n);
end $function$;

-- public.ep_sent_messages
CREATE OR REPLACE FUNCTION public.ep_sent_messages()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null or (not public.rbac_can('portal.notifications') and public.ep_current_employee_id() is null) then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(m.j order by m.created_at desc)
    from (
      select min(n.created_at) as created_at,
             jsonb_build_object(
               'message_id', n.message_id, 'title', min(n.title), 'body', min(n.body), 'priority', min(n.priority),
               'created_at', min(n.created_at), 'recipients', count(*), 'read', count(n.read_at),
               'to', (array_agg(e.full_name order by e.full_name))[1:5]) as j
      from public.ep_notifications n join public.ep_employees e on e.id = n.employee_id
      where n.sender_user_id = auth.uid() and n.message_id is not null
        and n.created_at > now() - interval '90 days'
      group by n.message_id
      order by min(n.created_at) desc
      limit 100) m), '[]'::jsonb);
end $function$;

-- public.ep_set_project_delay_reason
CREATE OR REPLACE FUNCTION public.ep_set_project_delay_reason(p_project uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp    uuid := public.ep_current_employee_id();
  v_proj   public.pt_projects;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_today  date := (timezone('Asia/Kolkata', now()))::date;
begin
  perform public.rbac_require('emp.projects'); -- rbac
  if v_emp is null or not exists (select 1 from public.ep_project_members where project_id = p_project and employee_id = v_emp) then
    raise exception 'You are not on this project.' using errcode = '42501';
  end if;
  if length(v_reason) not between 1 and 1000 then
    raise exception 'Write the reason (up to 1000 characters).' using errcode = '22023';
  end if;
  select * into v_proj from public.pt_projects where id = p_project;
  if v_proj.end_date is null
     or not coalesce((v_proj.end_date < v_today and public.ep_project_is_running(v_proj.status))
                     or v_proj.completed_date > v_proj.end_date, false) then
    raise exception 'This project has not missed its deadline.' using errcode = 'P0001';
  end if;
  insert into public.ep_project_delay_reasons (project_id, employee_id, deadline, reason)
  values (p_project, v_emp, v_proj.end_date, v_reason)
  on conflict (project_id, employee_id, deadline) do update set reason = excluded.reason, updated_at = now();
end $function$;

-- public.ep_set_task_delay_reason
CREATE OR REPLACE FUNCTION public.ep_set_task_delay_reason(p_task uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp    uuid := public.ep_current_employee_id();
  v_task   public.ep_project_tasks;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform public.rbac_require('emp.projects'); -- rbac
  select * into v_task from public.ep_project_tasks where id = p_task;
  if v_emp is null or v_task.id is null
     or not exists (select 1 from public.ep_project_members where project_id = v_task.project_id and employee_id = v_emp) then
    raise exception 'You are not on this project.' using errcode = '42501';
  end if;
  if length(v_reason) not between 1 and 1000 then
    raise exception 'Write the reason (up to 1000 characters).' using errcode = '22023';
  end if;
  if v_task.due_date is null
     or v_task.due_date >= coalesce((timezone('Asia/Kolkata', v_task.completed_at))::date,
                                    (timezone('Asia/Kolkata', now()))::date) then
    raise exception 'This task is not late.' using errcode = 'P0001';
  end if;
  update public.ep_project_tasks
     set delay_reason = v_reason, delay_reason_by = v_emp, delay_reason_at = now(), updated_at = now()
   where id = p_task;
end $function$;

-- public.ep_set_task_status
CREATE OR REPLACE FUNCTION public.ep_set_task_status(p_task uuid, p_status text, p_delay_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp    uuid := public.ep_current_employee_id();
  v_task   public.ep_project_tasks;
  v_today  date := (timezone('Asia/Kolkata', now()))::date;
  v_reason text := nullif(btrim(coalesce(p_delay_reason, '')), '');
begin
  perform public.rbac_require('emp.projects'); -- rbac
  select * into v_task from public.ep_project_tasks where id = p_task;
  if v_emp is null or v_task.id is null
     or not exists (select 1 from public.ep_project_members where project_id = v_task.project_id and employee_id = v_emp) then
    raise exception 'You are not on this project.' using errcode = '42501';
  end if;
  if coalesce(length(v_reason), 0) > 1000 then
    raise exception 'The reason must be at most 1000 characters.' using errcode = '22023';
  end if;
  if p_status = 'done' and v_task.status <> 'done' and v_task.due_date < v_today
     and v_task.delay_reason is null and v_reason is null then
    raise exception 'This task is past its deadline (%). Write why it is late to mark it done.',
      to_char(v_task.due_date, 'DD Mon YYYY') using errcode = 'P0001', hint = 'delay_reason_required';
  end if;
  update public.ep_project_tasks
     set status = p_status,
         updated_at = now(),
         completed_at = case when p_status = 'done' then coalesce(completed_at, now()) else null end,
         delay_reason    = coalesce(v_reason, delay_reason),
         delay_reason_by = case when v_reason is not null then v_emp else delay_reason_by end,
         delay_reason_at = case when v_reason is not null then now() else delay_reason_at end
   where id = p_task;
end $function$;

-- public.ep_team_leave
CREATE OR REPLACE FUNCTION public.ep_team_leave()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp   uuid := public.ep_current_employee_id();
  v_today date := (timezone('Asia/Kolkata', now()))::date;
begin
  if not public.rbac_can('team.leave') then -- rbac
    return jsonb_build_object('team_size', 0, 'requests', '[]'::jsonb);
  end if;
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'team_size', (select count(*) from public.ep_employees where reporting_manager_id = v_emp and is_active),
    'requests', coalesce((
      select jsonb_agg(public.ep_leave_json(r)
               order by (r.status in ('manager_review', 'manager_pending')) desc, r.start_date desc)
      from public.ep_leave_requests r join public.ep_employees e on e.id = r.employee_id
      where r.employee_id <> v_emp
        and (r.approver_id = v_emp or e.reporting_manager_id = v_emp or r.decided_by = v_emp or r.manager_reviewed_by = v_emp)
        and (r.status in ('manager_review', 'manager_pending')
             or (r.status = 'pending' and r.manager_reviewed_by = v_emp)
             or ((r.decided_by = v_emp or r.manager_reviewed_by = v_emp) and r.end_date >= v_today - 90))), '[]'::jsonb));
end $function$;

-- public.ep_team_report
CREATE OR REPLACE FUNCTION public.ep_team_report(p_report uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp uuid := public.ep_current_employee_id();
begin
  perform public.rbac_require('team.reports'); -- rbac
  if v_emp is null or not exists (
       select 1 from public.ep_work_reports r join public.ep_employees e on e.id = r.employee_id
        where r.id = p_report and r.status <> 'draft'
          and (r.submitted_to = v_emp or e.reporting_manager_id = v_emp)) then
    raise exception 'Report not found.' using errcode = '42501';
  end if;
  return public.ep_report_json(p_report);
end $function$;

-- public.ep_team_reports
CREATE OR REPLACE FUNCTION public.ep_team_reports()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp   uuid := public.ep_current_employee_id();
  v_today date := (timezone('Asia/Kolkata', now()))::date;
begin
  perform public.rbac_require('team.reports'); -- rbac
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'team', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
                                          'designation', e.designation) order by e.full_name)
      from public.ep_employees e where e.reporting_manager_id = v_emp and e.is_active), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'report_date', r.report_date, 'status', r.status,
               'submitted_at', r.submitted_at, 'reviewed_at', r.reviewed_at,
               'employee', jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code),
               'projects', (select count(*) from public.ep_work_report_items i where i.report_id = r.id),
               'total_hours', coalesce((select sum(i.hours) from public.ep_work_report_items i where i.report_id = r.id), 0))
             order by (r.status = 'submitted') desc, r.report_date desc, e.full_name)
      from public.ep_work_reports r join public.ep_employees e on e.id = r.employee_id
      where r.status <> 'draft'
        and (r.submitted_to = v_emp or e.reporting_manager_id = v_emp)
        and r.report_date >= v_today - 60), '[]'::jsonb)
  );
end $function$;

-- public.pt_credentials_export_passwords
CREATE OR REPLACE FUNCTION public.pt_credentials_export_passwords(p_credential_ids uuid[])
 RETURNS TABLE(credential_id uuid, password text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ids    uuid[] := array(select distinct x from unnest(coalesce(p_credential_ids, array[]::uuid[])) as x where x is not null);
  v_count  integer := cardinality(v_ids);
  v_recent integer;
  v_cred   public.pt_credentials;
begin
  perform pt_private.require_admin();
  if not pt_private.signed_in_within(600) then
    raise exception 'PT_REAUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if v_count = 0 then
    return;
  end if;
  if v_count > 500 then
    raise exception 'PT_TOO_MANY' using errcode = 'P0001';
  end if;

  select count(*) into v_recent
    from public.pt_credential_events
   where actor = auth.uid()
     and action = 'password_exported'
     and created_at > now() - interval '10 minutes';
  if v_recent + v_count > 1000 then
    raise exception 'PT_RATE_LIMITED' using errcode = 'P0001';
  end if;

  for v_cred in
    select c.* from public.pt_credentials c
     where c.id = any (v_ids) and c.has_password
  loop
    credential_id := v_cred.id;
    select d.decrypted_secret into password
      from pt_private.credential_secrets s
      join vault.decrypted_secrets d on d.id = s.secret_id
     where s.credential_id = v_cred.id;
    if password is not null then
      perform pt_private.log_credential_event(v_cred, 'password_exported');
      return next;
    end if;
  end loop;
end;
$function$;

-- public.pt_credential_remove_password
CREATE OR REPLACE FUNCTION public.pt_credential_remove_password(p_credential_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_cred public.pt_credentials;
begin
  perform pt_private.require_admin();
  select * into v_cred from public.pt_credentials where id = p_credential_id for update;
  if not found then
    raise exception 'PT_NOT_FOUND' using errcode = 'P0001';
  end if;
  delete from pt_private.credential_secrets where credential_id = p_credential_id; -- trigger deletes the vault secret

  perform set_config('pt.password_write', 'on', true);
  update public.pt_credentials
     set has_password = false, password_updated_at = now(), password_updated_by = auth.uid()
   where id = p_credential_id;
  perform set_config('pt.password_write', 'off', true);

  if v_cred.has_password then
    perform pt_private.log_credential_event(v_cred, 'password_removed');
  end if;
end;
$function$;

-- public.pt_credential_reveal_password
CREATE OR REPLACE FUNCTION public.pt_credential_reveal_password(p_credential_id uuid, p_purpose text DEFAULT 'view'::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_cred   public.pt_credentials;
  v_secret uuid;
  v_value  text;
  v_recent integer;
begin
  perform pt_private.require_admin();
  if not pt_private.signed_in_within(600) then
    raise exception 'PT_REAUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select count(*) into v_recent
    from public.pt_credential_events
   where actor = auth.uid()
     and action in ('password_viewed', 'password_copied')
     and created_at > now() - interval '10 minutes';
  if v_recent >= 30 then
    raise exception 'PT_RATE_LIMITED' using errcode = 'P0001';
  end if;

  select * into v_cred from public.pt_credentials where id = p_credential_id;
  if not found then
    raise exception 'PT_NOT_FOUND' using errcode = 'P0001';
  end if;
  select secret_id into v_secret from pt_private.credential_secrets where credential_id = p_credential_id;
  if v_secret is null then
    raise exception 'PT_NO_PASSWORD' using errcode = 'P0001';
  end if;
  select decrypted_secret into v_value from vault.decrypted_secrets where id = v_secret;
  if v_value is null then
    raise exception 'PT_NO_PASSWORD' using errcode = 'P0001';
  end if;

  perform pt_private.log_credential_event(v_cred, case when p_purpose = 'copy' then 'password_copied' else 'password_viewed' end);
  return v_value;
end;
$function$;

-- public.pt_credential_set_password
CREATE OR REPLACE FUNCTION public.pt_credential_set_password(p_credential_id uuid, p_password text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_cred   public.pt_credentials;
  v_secret uuid;
begin
  perform pt_private.require_admin();
  if p_password is null or length(p_password) = 0 or length(p_password) > 1000 then
    raise exception 'PT_PASSWORD_INVALID' using errcode = 'P0001';
  end if;
  select * into v_cred from public.pt_credentials where id = p_credential_id for update;
  if not found then
    raise exception 'PT_NOT_FOUND' using errcode = 'P0001';
  end if;

  select secret_id into v_secret from pt_private.credential_secrets where credential_id = p_credential_id;
  if v_secret is null then
    v_secret := vault.create_secret(p_password, 'pt_credential_' || p_credential_id::text, 'Project Tracker login password');
    insert into pt_private.credential_secrets (credential_id, secret_id) values (p_credential_id, v_secret);
  else
    perform vault.update_secret(v_secret, p_password);
  end if;

  perform set_config('pt.password_write', 'on', true);
  update public.pt_credentials
     set has_password = true, password_updated_at = now(), password_updated_by = auth.uid()
   where id = p_credential_id;
  perform set_config('pt.password_write', 'off', true);

  perform pt_private.log_credential_event(v_cred, case when v_cred.has_password then 'password_changed' else 'password_set' end);
end;
$function$;

-- public.rbac_admin_create_user
CREATE OR REPLACE FUNCTION public.rbac_admin_create_user(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_email text := lower(btrim(coalesce(p ->> 'email', '')));
  v_name  text := nullif(btrim(coalesce(p ->> 'full_name', '')), '');
  v_pw    text := coalesce(p ->> 'password', '');
  v_roles text[] := coalesce((select array_agg(distinct r) from jsonb_array_elements_text(coalesce(p -> 'roles', '[]'::jsonb)) r), '{}');
  v_user  uuid;
  v_bad   text;
begin
  perform public.rbac_require('settings.users');
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'Enter a valid sign-in email.' using errcode = '22023';
  end if;
  if v_name is null or length(v_name) > 120 then
    raise exception 'Name is required (up to 120 characters).' using errcode = '22023';
  end if;
  if cardinality(v_roles) = 0 then
    raise exception 'Choose at least one role.' using errcode = '22023';
  end if;
  select r into v_bad from unnest(v_roles) r
   where r not in (select key from public.rbac_roles where area = 'admin') limit 1;
  if v_bad is not null then
    raise exception 'Only admin-area roles can be given here (Super Admin, Admin, HR).' using errcode = '22023';
  end if;
  if 'super_admin' = any (v_roles)
     and not exists (select 1 from public.rbac_user_roles where user_id = auth.uid() and role_key = 'super_admin') then
    raise exception 'Only a Super Admin can give the Super Admin role.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rbac_create_user:' || v_email, 0));
  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is not null then
    if exists (select 1 from public.rbac_user_roles where user_id = v_user)
       or exists (select 1 from public.ep_employees where user_id = v_user) then
      raise exception 'This email already has an account. Change its roles in the list instead.' using errcode = '23505';
    end if;
  else
    if public.ep_password_problem(v_pw) is not null then
      raise exception 'Password: %', public.ep_password_problem(v_pw) using errcode = '22023';
    end if;
    v_user := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
      extensions.crypt(v_pw, extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('full_name', v_name), now(), now(),
      '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    values (v_user::text, v_user,
            jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true), 'email', now(), now());
  end if;
  insert into public.rbac_user_roles (user_id, role_key, granted_by)
  select v_user, r, auth.uid() from unnest(v_roles) r on conflict do nothing;
  return v_user;
end $function$;

-- public.rbac_admin_roles
CREATE OR REPLACE FUNCTION public.rbac_admin_roles()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require_any(array['settings.roles', 'settings.users']);
  return jsonb_build_object(
    'can_edit', public.rbac_can('settings.roles'),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', r.key, 'name', r.name, 'description', r.description, 'area', r.area,
               'is_protected', r.is_protected,
               'permissions', case when r.key = 'super_admin'
                                   then (select coalesce(jsonb_agg(p.key order by p.sort_order), '[]'::jsonb)
                                           from public.rbac_permissions p where p.area = 'admin')
                                   else coalesce((select jsonb_agg(rp.permission_key order by p.sort_order)
                                                    from public.rbac_role_permissions rp
                                                    join public.rbac_permissions p on p.key = rp.permission_key
                                                   where rp.role_key = r.key), '[]'::jsonb) end,
               'users', case when r.key = 'employee'
                             then (select count(*) from public.ep_employees where is_active)
                             else (select count(*) from public.rbac_user_roles ur where ur.role_key = r.key) end)
             order by r.sort_order)
        from public.rbac_roles r), '[]'::jsonb),
    'permissions', coalesce((
      select jsonb_agg(jsonb_build_object('key', p.key, 'area', p.area, 'group', p.grp, 'label', p.label,
                                          'description', p.description) order by p.sort_order)
        from public.rbac_permissions p), '[]'::jsonb));
end $function$;

-- public.rbac_admin_set_permission
CREATE OR REPLACE FUNCTION public.rbac_admin_set_permission(p_role text, p_permission text, p_enabled boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role public.rbac_roles;
  v_perm public.rbac_permissions;
begin
  perform public.rbac_require('settings.roles');
  select * into v_role from public.rbac_roles where key = p_role;
  select * into v_perm from public.rbac_permissions where key = p_permission;
  if v_role.key is null or v_perm.key is null then
    raise exception 'Unknown role or permission.' using errcode = 'P0002';
  end if;
  if v_role.key = 'super_admin' then
    raise exception 'Super Admin always has every permission.' using errcode = '42501';
  end if;
  if v_role.area <> v_perm.area then
    raise exception '% is an % role; this permission belongs to the %.', v_role.name,
      case v_role.area when 'admin' then 'admin-area' else 'Employee Portal' end,
      case v_perm.area when 'admin' then 'admin area' else 'Employee Portal' end using errcode = '22023';
  end if;
  if p_enabled then
    insert into public.rbac_role_permissions (role_key, permission_key) values (p_role, p_permission) on conflict do nothing;
  else
    delete from public.rbac_role_permissions where role_key = p_role and permission_key = p_permission;
  end if;
end $function$;

-- public.rbac_admin_set_user_roles
CREATE OR REPLACE FUNCTION public.rbac_admin_set_user_roles(p_user uuid, p_roles text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_new   text[] := coalesce((select array_agg(distinct r) from unnest(coalesce(p_roles, '{}')) r), '{}');
  v_old   text[];
  v_super boolean := public.rbac_user_can(auth.uid(), 'settings.users')
                     and exists (select 1 from public.rbac_user_roles where user_id = auth.uid() and role_key = 'super_admin');
  v_bad   text;
begin
  perform public.rbac_require('settings.users');
  if p_user = auth.uid() then
    raise exception 'You cannot change your own roles. Ask another Super Admin.' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'User not found.' using errcode = 'P0002';
  end if;
  select r into v_bad from unnest(v_new) r where r not in (select key from public.rbac_roles) limit 1;
  if v_bad is not null then
    raise exception 'Unknown role %.', v_bad using errcode = '22023';
  end if;
  if 'employee' = any (v_new) then
    raise exception 'Employee is given automatically to everyone with an Employee Portal account.' using errcode = '22023';
  end if;
  if (('manager' = any (v_new)) or ('team_lead' = any (v_new)))
     and not exists (select 1 from public.ep_employees where user_id = p_user) then
    raise exception 'Manager and Team Lead are for Employee Portal accounts.' using errcode = '22023';
  end if;
  select coalesce(array_agg(role_key), '{}') into v_old from public.rbac_user_roles where user_id = p_user;
  if (('super_admin' = any (v_new)) <> ('super_admin' = any (v_old))) and not v_super then
    raise exception 'Only a Super Admin can give or remove the Super Admin role.' using errcode = '42501';
  end if;
  delete from public.rbac_user_roles where user_id = p_user and role_key <> all (v_new);
  insert into public.rbac_user_roles (user_id, role_key, granted_by)
  select p_user, r, auth.uid() from unnest(v_new) r on conflict do nothing;
  if not exists (select 1 from public.rbac_user_roles where role_key = 'super_admin') then
    raise exception 'There must always be at least one Super Admin.' using errcode = '22023';
  end if;
  return to_jsonb(coalesce((select array_agg(role_key order by role_key) from public.rbac_user_roles where user_id = p_user), '{}'));
end $function$;

-- public.rbac_admin_users
CREATE OR REPLACE FUNCTION public.rbac_admin_users()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('settings.users');
  return coalesce((
    select jsonb_agg(x.j order by x.ord, x.nm) from (
      select (case when exists (select 1 from public.rbac_user_roles ur join public.rbac_roles r on r.key = ur.role_key
                                 where ur.user_id = u.id and r.area = 'admin') then 0 else 1 end) as ord,
             lower(coalesce(e.full_name, u.raw_user_meta_data ->> 'full_name', u.email)) as nm,
             jsonb_build_object(
               'user_id', u.id,
               'sign_in', u.email,
               'full_name', coalesce(e.full_name, nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1)),
               'employee_id', e.id, 'employee_code', e.employee_code, 'employee_active', e.is_active,
               'roles', coalesce((select jsonb_agg(ur.role_key order by r.sort_order)
                                    from public.rbac_user_roles ur join public.rbac_roles r on r.key = ur.role_key
                                   where ur.user_id = u.id), '[]'::jsonb),
               'last_sign_in_at', u.last_sign_in_at, 'created_at', u.created_at,
               'is_self', u.id = auth.uid()) as j
        from auth.users u
        left join public.ep_employees e on e.user_id = u.id
       where e.id is not null or exists (select 1 from public.rbac_user_roles ur where ur.user_id = u.id)) x),
    '[]'::jsonb);
end $function$;

delete from public.rbac_backup where kind in ('policy261', 'catalog', 'grants');
alter table public.rbac_permissions drop column if exists module, drop column if exists action, drop column if exists action_label;
notify pgrst, 'reload schema';
commit;
