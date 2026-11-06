-- 201: exit access revocation ends the leaver's sessions (and only theirs),
-- stays service-role-only, respects the clearance-stage rule, and cuts an
-- Employee ID leaver's data access immediately.
-- Runs inside a transaction that the runner rolls back.

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated, anon, service_role;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;
create function pg_temp.as_k(p_k text) returns void language plpgsql as $$
begin
  perform test.as_owner();
  perform test.as_user(test.user_of((select v from t_ids where k = p_k)));
end $$;
create function pg_temp.sessions(p_user uuid) returns int language sql security definer as $$
  select count(*)::int from auth.sessions where user_id = p_user
$$;
create function pg_temp.exit_for(p_emp uuid, p_status text) returns uuid language sql as $$
  insert into public.hr_exits (employee_id, initiated_by, exit_type, status)
  values (p_emp, 'hr', 'resignation', p_status) returning id
$$;
grant execute on all functions in schema pg_temp to authenticated, anon, service_role;

do $$
declare v uuid;
begin
  insert into t_ids values ('hr',     test.make_employee('f201.hr@test.local', 'Hema', null, array['hr_admin']));
  insert into t_ids values ('leaver', test.make_employee('f201.leaver@test.local', 'Lalit'));     -- email account
  insert into t_ids values ('stayer', test.make_employee('f201.stayer@test.local', 'Sunita'));    -- must be untouched
  insert into t_ids values ('early',  test.make_employee('f201.early@test.local', 'Esha'));
  insert into public.hr_employees (first_name, status, joining_date) values ('Nolog', 'active', current_date - 10) returning id into v;
  insert into t_ids values ('nolog', v);
end $$;

-- sessions: leaver x2, stayer x1, early x1
insert into auth.sessions (user_id) select test.user_of(pg_temp.id('leaver')) from generate_series(1, 2);
insert into auth.sessions (user_id) values (test.user_of(pg_temp.id('stayer'))), (test.user_of(pg_temp.id('early')));

insert into t_ids values ('x_leaver', pg_temp.exit_for(pg_temp.id('leaver'), 'clearance'));
insert into t_ids values ('x_early',  pg_temp.exit_for(pg_temp.id('early'), 'notice_period'));
insert into t_ids values ('x_nolog',  pg_temp.exit_for(pg_temp.id('nolog'), 'clearance'));

-- ---- privileges unchanged
select test.ok(not has_function_privilege('authenticated', 'public.hr_record_auth_access_revoked(uuid)', 'EXECUTE')
           and not has_function_privilege('anon', 'public.hr_record_auth_access_revoked(uuid)', 'EXECUTE')
           and has_function_privilege('service_role', 'public.hr_record_auth_access_revoked(uuid)', 'EXECUTE'), 'still service-role only');
select pg_temp.as_k('hr');
select test.throws($q$select public.hr_record_auth_access_revoked(pg_temp.id('x_leaver'))$q$, 'HR cannot call it directly', 'permission denied');
select test.as_owner();
select test.eq(pg_temp.sessions(test.user_of(pg_temp.id('leaver'))), 2, 'leaver sessions intact after refused call');

-- ---- before clearance: refused, nothing ended
select test.as_service();
select test.throws($q$select public.hr_record_auth_access_revoked(pg_temp.id('x_early'))$q$, 'refused before clearance', 'clearance stage');
select test.as_owner();
select test.eq(pg_temp.sessions(test.user_of(pg_temp.id('early'))), 1, 'no sessions ended before clearance');

-- ---- clearance: leaver's sessions end, nobody else's
select test.as_service();
select public.hr_record_auth_access_revoked(pg_temp.id('x_leaver'));
select test.as_owner();
select test.eq(pg_temp.sessions(test.user_of(pg_temp.id('leaver'))), 0, 'all leaver sessions ended');
select test.eq(pg_temp.sessions(test.user_of(pg_temp.id('stayer'))), 1, 'other employees'' sessions untouched');
select test.eq(pg_temp.sessions(test.user_of(pg_temp.id('early'))), 1, 'other leavers'' sessions untouched');
select test.eq((select detail from public.hr_exit_access_revocations where exit_id = pg_temp.id('x_leaver') and outcome = 'revoked'),
               'Sessions ended: 2', 'revocation log records the sessions ended');
select test.ok((select auth_access_revoked_at is not null and access_revocation_status = 'revoked' from public.hr_exits where id = pg_temp.id('x_leaver')),
               'exit case marked revoked (unchanged behaviour)');

-- ---- idempotent retry
select test.as_service();
select public.hr_record_auth_access_revoked(pg_temp.id('x_leaver'));
select test.as_owner();
select test.eq((select count(*) from public.hr_exit_access_revocations where exit_id = pg_temp.id('x_leaver') and detail = 'Sessions ended: 0'), 1::bigint, 'retry succeeds with nothing left to end');

-- ---- employee without a sign-in account
select test.as_service();
select public.hr_record_auth_access_revoked(pg_temp.id('x_nolog'));
select test.as_owner();
select test.eq((select detail from public.hr_exit_access_revocations where exit_id = pg_temp.id('x_nolog')), 'No sign-in account', 'no account: recorded, no error');

-- ---- Employee ID leaver: data access stops immediately (session_id check, 200)
do $$
declare v uuid; u uuid;
begin
  insert into public.hr_employees (first_name, status, joining_date) values ('Idris', 'active', current_date - 100) returning id into v;
  insert into t_ids values ('idleaver', v);
  u := test.create_user(lower((select employee_code from public.hr_employees where id = v)) || '@staff.zyllotech.com');
  insert into t_ids values ('idleaver_user', u);
  perform set_config('hr.privileged_write', 'on', true);
  update public.hr_employees set user_id = u, login_id = employee_code, portal_access = true,
         password_change_required = false, password_changed_at = now() where id = v;
  perform set_config('hr.privileged_write', 'off', true);
  insert into public.hr_user_roles (user_id, role_key) values (u, 'employee');
  insert into auth.sessions (user_id) values (u) returning id into v;
  insert into t_ids values ('idsess', v);
end $$;
create function pg_temp.as_idleaver() returns void language plpgsql as $$
begin
  perform test.as_owner();
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.id('idleaver_user'), 'role', 'authenticated',
                     'session_id', pg_temp.id('idsess'))::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on function pg_temp.as_idleaver() to authenticated, service_role;
insert into t_ids values ('x_id', pg_temp.exit_for(pg_temp.id('idleaver'), 'clearance'));
select pg_temp.as_idleaver();
select test.eq(hr_private.current_employee_id(), pg_temp.id('idleaver'), 'Employee ID leaver has access before revocation');
select test.as_service();
select public.hr_record_auth_access_revoked(pg_temp.id('x_id'));
select pg_temp.as_idleaver();
select test.ok(hr_private.current_employee_id() is null and (public.hr_me() ->> 'revoked')::boolean,
               'Employee ID leaver: unexpired access token loses data access immediately');
select test.as_owner();
