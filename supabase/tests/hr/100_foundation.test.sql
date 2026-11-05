-- Foundation: roles, permissions, employee isolation, PII split, audit,
-- privileged columns, notifications, invite/link workflow.
-- Runs inside a transaction that the runner rolls back.

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated, anon, service_role;

do $$
declare dep uuid;
begin
  insert into public.hr_departments (code, name) values ('ENG', 'Engineering') returning id into dep;
  insert into t_ids values ('dep', dep);
  insert into t_ids values ('super', test.make_employee('super@test.local', 'Super', null, array['super_admin']));
  insert into t_ids values ('hr',    test.make_employee('hr@test.local', 'Hira', null, array['hr_admin']));
  insert into t_ids values ('pay',   test.make_employee('pay@test.local', 'Pay', null, array['payroll_admin']));
  insert into t_ids values ('mgr',   test.make_employee('mgr@test.local', 'Mona', null, array['manager','employee'], 'full_time', dep));
  insert into t_ids values ('emp1',  test.make_employee('emp1@test.local', 'Eli', (select v from t_ids where k='mgr'), array['employee'], 'full_time', dep));
  insert into t_ids values ('emp2',  test.make_employee('emp2@test.local', 'Ezra', null, array['employee']));
  insert into t_ids values ('intern',test.make_employee('intern@test.local', 'Ira', (select v from t_ids where k='emp1'), array['intern'], 'intern', dep));
  insert into public.hr_employee_private (employee_id, date_of_birth, phone)
  select v, date '1995-05-05', '+91 90000 00000' from t_ids where k in ('emp1','emp2');
end $$;

-- ---- employee codes are generated, unique, and immutable
select test.ok((select count(distinct employee_code) = count(*) from public.hr_employees), 'employee codes unique');
select test.ok((select bool_and(employee_code ~ '^ZT-\d{4}$') from public.hr_employees), 'employee codes follow ZT-NNNN format');
select test.ok((select probation_end_date = joining_date + interval '6 months' from public.hr_employees where id = (select v from t_ids where k='emp1')),
               'probation end date derived from employment type');

-- ---- anon sees nothing
select test.as_anon();
select test.throws('select * from public.hr_employees', 'anon cannot read hr_employees', 'permission denied');
select test.throws('select public.hr_me()', 'anon cannot call hr_me', 'permission denied');
select test.as_owner();

-- ---- employee: self only (+ own manager), no PII of others
select test.as_user(test.user_of((select v from t_ids where k='emp1')));
select test.eq(test.count_rows('select 1 from public.hr_employees'), 2::bigint, 'employee sees self + own manager only');
select test.eq(test.count_rows('select 1 from public.hr_employee_private'), 1::bigint, 'employee sees only own private record');
select test.eq(test.count_rows('select 1 from public.hr_employees where id = (select v from t_ids where k=''emp2'')'), 0::bigint, 'employee cannot see unrelated colleague');
select test.ok(not (public.hr_me() -> 'permissions') ? 'employees.view', 'employee has no employees.view permission');
-- RLS silently filters UPDATE/DELETE (0 rows) rather than raising; prove nothing changed.
update public.hr_employees set first_name = 'Hacked' where id = (select v from t_ids where k='emp1');
select test.eq((select first_name from public.hr_employees where id = (select v from t_ids where k='emp1')), 'Eli', 'employee cannot edit own employee record directly');
select test.throws($q$insert into public.hr_employees (first_name) values ('Ghost')$q$, 'employee cannot create employees', 'row-level security');
select test.throws($q$insert into public.hr_user_roles (user_id, role_key) values (auth.uid(), 'super_admin')$q$, 'employee cannot self-grant a role', 'row-level security');
select test.throws($q$select public.hr_assign_role(auth.uid(), 'hr_admin')$q$, 'employee cannot call hr_assign_role', 'not allowed');
delete from public.hr_employees where id = (select v from t_ids where k='emp1');
select test.eq(test.count_rows($q$select 1 from public.hr_employees where id = (select v from t_ids where k='emp1')$q$), 1::bigint, 'employee cannot delete employees');
-- self-service contact update works and is limited to own record
select public.hr_update_my_contact(p_phone => '+91 91111 11111', p_city => 'Guntur');
select test.eq((select phone from public.hr_employee_private where employee_id = (select v from t_ids where k='emp1')), '+91 91111 11111', 'employee updated own phone via RPC');
select test.as_owner();

-- ---- manager: reporting line (direct + indirect), not others
select test.as_user(test.user_of((select v from t_ids where k='mgr')));
select test.eq(test.count_rows('select 1 from public.hr_employees'), 3::bigint, 'manager sees self + direct + indirect report');
select test.ok(hr_private.is_manager_of((select v from t_ids where k='intern')), 'indirect report detected');
select test.ok(not hr_private.is_manager_of((select v from t_ids where k='emp2')), 'unrelated employee is not in team');
select test.eq(test.count_rows('select 1 from public.hr_employee_private'), 0::bigint, 'manager cannot read team PII');
select test.as_owner();

-- ---- HR admin: all employees + PII, can create/edit, no payroll
select test.as_user(test.user_of((select v from t_ids where k='hr')));
select test.eq(test.count_rows('select 1 from public.hr_employees'), 7::bigint, 'HR sees all employees');
select test.eq(test.count_rows('select 1 from public.hr_employee_private'), 2::bigint, 'HR sees PII');
select test.ok(not hr_private.has_permission('payroll.view'), 'HR admin has no payroll access by default');
insert into public.hr_employees (first_name, last_name, company_email, department_id)
values ('New', 'Joiner', 'new.joiner@test.local', (select v from t_ids where k='dep'));
select test.ok((select employee_code ~ '^ZT-\d{4}$' from public.hr_employees where company_email = 'new.joiner@test.local'), 'HR-created employee gets generated code');
-- A client-supplied code is always replaced by the generator, so duplicates are impossible.
insert into public.hr_employees (first_name, employee_code) values ('Forged', 'ZT-0001');
select test.ok((select employee_code <> 'ZT-0001' from public.hr_employees where first_name = 'Forged'), 'client-supplied employee code ignored');
select test.throws($q$update public.hr_employees set employee_code = 'ZT-9999' where first_name = 'Forged'$q$, 'employee code is immutable', 'cannot be changed');
select test.throws($q$update public.hr_employees set portal_access = true where first_name = 'Forged'$q$, 'portal access only via workflow', 'invitation');
select test.throws($q$update public.hr_employees set status = 'exited' where first_name = 'Forged'$q$, 'exit only via workflow', 'Exit Management');
select test.throws($q$update public.hr_employees set manager_id = (select v from t_ids where k='intern') where id = (select v from t_ids where k='mgr')$q$,
  'manager cycle rejected', 'cycle');
-- transfer creates history
update public.hr_employees set department_id = null where id = (select v from t_ids where k='emp1');
select test.ok(exists (select 1 from public.hr_employee_history where employee_id = (select v from t_ids where k='emp1') and change_type = 'department'),
  'department transfer recorded in history');
select test.as_owner();

-- ---- payroll admin: payroll permissions without PII
select test.as_user(test.user_of((select v from t_ids where k='pay')));
select test.ok(hr_private.has_permission('payroll.approve'), 'payroll admin can approve payroll');
select test.eq(test.count_rows('select 1 from public.hr_employee_private'), 0::bigint, 'payroll admin cannot read PII');
select test.as_owner();

-- ---- audit log
select test.ok(exists (select 1 from public.hr_audit_log where table_name = 'hr_employees' and action = 'UPDATE'), 'employee updates are audited');
select test.ok((select bool_and(coalesce(new_data ->> 'phone', '[redacted]') = '[redacted]') from public.hr_audit_log where table_name = 'hr_employee_private'),
  'PII redacted in audit log');
select test.as_user(test.user_of((select v from t_ids where k='emp1')));
select test.eq(test.count_rows('select 1 from public.hr_audit_log'), 0::bigint, 'employee cannot read audit log');
select test.throws($q$delete from public.hr_audit_log$q$, 'audit log is append-only', 'permission denied');
select test.as_owner();

-- ---- revoked access: exited employee loses everything immediately
update public.hr_employees set portal_access = false where id = (select v from t_ids where k='emp2');
select test.as_user(test.user_of((select v from t_ids where k='emp2')));
select test.ok(hr_private.current_employee_id() is null, 'revoked employee has no current employee id');
select test.eq(test.count_rows('select 1 from public.hr_employees'), 0::bigint, 'revoked employee sees no records');
select test.ok((public.hr_me() ->> 'revoked')::boolean, 'hr_me reports revoked');
select test.as_owner();

-- ---- invitation link: only service role may link accounts
do $$
declare v_new uuid := (select id from public.hr_employees where company_email = 'new.joiner@test.local');
        v_user uuid := test.create_user('new.joiner@test.local');
begin
  perform test.as_user(test.user_of((select v from t_ids where k='hr')));
  perform test.throws(format('select public.hr_link_invited_user(%L, %L, auth.uid())', v_new, v_user), 'HR cannot call link function directly', 'permission denied');
  perform test.ok((public.hr_can_invite(v_new) ->> 'email') = 'new.joiner@test.local', 'HR pre-flight invite check returns email');
  perform test.as_service();
  perform public.hr_link_invited_user(v_new, v_user, null);
  perform test.as_owner();
  perform test.ok((select portal_access and user_id = v_user from public.hr_employees where id = v_new), 'service role linked invited account');
  perform test.ok(exists (select 1 from public.hr_user_roles where user_id = v_user and role_key = 'employee'), 'default employee role granted on invite');
  perform test.as_user(v_user);
  perform test.ok((public.hr_activate_my_account() -> 'employee' ->> 'id')::uuid = v_new, 'invited employee activates account');
  perform test.as_owner();
end $$;

-- ---- notifications: recipient-only, read flag only
select hr_private.notify_employee((select v from t_ids where k='emp1'), 'test', 'Hello', 'Body');
select test.as_user(test.user_of((select v from t_ids where k='mgr')));
select test.eq(test.count_rows('select 1 from public.hr_notifications'), 0::bigint, 'other users cannot see a notification');
select test.as_user(test.user_of((select v from t_ids where k='emp1')));
select test.eq(test.count_rows('select 1 from public.hr_notifications'), 1::bigint, 'recipient sees own notification');
update public.hr_notifications set read_at = now();
select test.throws($q$update public.hr_notifications set title = 'changed'$q$, 'recipient cannot alter notification content', 'read status');
select test.throws($q$insert into public.hr_notifications (recipient_user_id, type, title) values (auth.uid(), 'x', 'spoof')$q$, 'users cannot create notifications', 'permission denied');
select test.as_owner();

-- ---- last super admin cannot be removed
select test.as_user(test.user_of((select v from t_ids where k='super')));
select test.throws($q$select public.hr_revoke_role(auth.uid(), 'super_admin')$q$, 'last super admin protected', 'last Super Admin');
select test.as_owner();

-- ---- payroll audit rows hidden from HR admins without payroll access
insert into public.hr_audit_log (action, table_name, record_id) values ('UPDATE', 'hr_payroll_runs', 'synthetic-1'), ('UPDATE', 'hr_payslips', 'synthetic-2'), ('UPDATE', 'hr_employees', 'synthetic-3');
select test.as_user(test.user_of((select v from t_ids where k='hr')));
select test.eq(test.count_rows($q$select 1 from public.hr_audit_log where record_id like 'synthetic-%' and table_name in ('hr_payroll_runs','hr_payslips')$q$), 0::bigint, 'HR admin (audit.view, no payroll.view) cannot read payroll audit rows');
select test.eq(test.count_rows($q$select 1 from public.hr_audit_log where record_id = 'synthetic-3'$q$), 1::bigint, 'HR admin still reads non-payroll audit rows');
select test.as_owner();
select test.as_user(test.user_of((select v from t_ids where k='super')));
select test.eq(test.count_rows($q$select 1 from public.hr_audit_log where record_id like 'synthetic-%'$q$), 3::bigint, 'super admin reads all audit rows');
select test.as_owner();
