-- Exit management: resignation lifecycle, manager + HR review, visibility,
-- clearance (assets gate, access revocation via service role), settlement,
-- closure (status exited, portal off, roles revoked, history kept),
-- withdrawal, HR-initiated exits, last-super-admin protection.
-- Runs inside a transaction that the runner rolls back.

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated, anon, service_role;
create function pg_temp.as_k(p_k text) returns void language plpgsql as $$
begin
  perform test.as_owner();
  perform test.as_user(test.user_of((select v from t_ids where k = p_k)));
end $$;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;
create function pg_temp.item(p_exit text, p_key text) returns uuid language sql as $$
  select id from public.hr_exit_clearance_items where exit_id = (select v from t_ids where k = p_exit) and item_key = p_key
$$;

do $$
begin
  insert into t_ids values ('super',  test.make_employee('exit.super@test.local', 'Sara', null, array['super_admin']));
  insert into t_ids values ('hr',     test.make_employee('exit.hr@test.local', 'Hari', null, array['hr_admin']));
  insert into t_ids values ('mgr',    test.make_employee('exit.mgr@test.local', 'Mira', null, array['manager','employee']));
  insert into t_ids values ('emp1',   test.make_employee('exit.emp1@test.local', 'Ravi', (select v from t_ids where k='mgr'), array['employee','manager']));
  insert into t_ids values ('emp2',   test.make_employee('exit.emp2@test.local', 'Tara', null));
  insert into t_ids values ('emp3',   test.make_employee('exit.emp3@test.local', 'Neel', null));
  insert into t_ids values ('intern', test.make_employee('exit.intern@test.local', 'Ila', null, array['intern'], 'intern'));
  -- payroll preparer / approver for the full & final settlement (130)
  insert into t_ids values ('pay1',   test.make_employee('exit.pay1@test.local', 'Pia', null, array['payroll_admin','employee']));
  insert into t_ids values ('pay2',   test.make_employee('exit.pay2@test.local', 'Paz', null, array['payroll_admin','employee']));
end $$;

select test.eq(hr_private.exit_notice_days(pg_temp.id('emp1')), 30, 'default notice period from settings');
select test.eq(hr_private.exit_notice_days(pg_temp.id('intern')), 15, 'notice period override by employment type');

-- ---- submission
select test.as_anon();
select test.throws($q$select public.hr_submit_resignation('x')$q$, 'anon cannot submit', 'permission denied');
select pg_temp.as_k('emp1');
do $$ begin insert into t_ids values ('x1', public.hr_submit_resignation('Relocating to another city', hr_private.business_today())); end $$;
select test.eq((select status from public.hr_exits where id = pg_temp.id('x1')), 'manager_review', 'resignation goes to manager review');
select test.eq((select notice_period_days from public.hr_exits where id = pg_temp.id('x1')), 30, 'notice period recorded');
select test.eq((select status from public.hr_employees where id = pg_temp.id('emp1')), 'active', 'employee stays active until HR approval');
select test.throws($q$select public.hr_submit_resignation('Again please')$q$, 'only one open exit', 'already have an open');
select test.throws($q$insert into public.hr_exits (employee_id, initiated_by, exit_type) values (pg_temp.id('emp1'), 'employee', 'resignation')$q$,
  'no direct inserts', 'row-level security');
update public.hr_exits set status = 'closed';
select test.eq((select status from public.hr_exits where id = pg_temp.id('x1')), 'manager_review', 'no direct status updates');
select test.throws($q$select public.hr_hr_review_exit(pg_temp.id('x1'), true)$q$, 'employee cannot do HR review', 'not allowed');
select test.throws($q$select public.hr_manager_review_exit(pg_temp.id('x1'), true)$q$, 'employee cannot review own resignation', 'reporting manager');

-- ---- visibility
select pg_temp.as_k('emp2');
select test.eq(test.count_rows('select 1 from public.hr_exits'), 0::bigint, 'unrelated employee cannot see the exit');
select test.throws($q$select public.hr_manager_review_exit(pg_temp.id('x1'), true)$q$, 'unrelated employee cannot review', 'not found');
select pg_temp.as_k('mgr');
select test.eq(test.count_rows('select 1 from public.hr_exits'), 1::bigint, 'manager sees team exit');
select test.ok(exists (select 1 from public.hr_notifications where type = 'exit_update' and entity_id = pg_temp.id('x1')::text), 'manager notified of resignation');
select test.throws($q$select public.hr_start_exit_clearance(pg_temp.id('x1'))$q$, 'manager cannot run clearance', 'not allowed');
select test.throws($q$select public.hr_manager_review_exit(pg_temp.id('x1'), false)$q$, 'manager concerns need a note', 'note');
select public.hr_manager_review_exit(pg_temp.id('x1'), true, 'Handover plan agreed');
select test.ok((select status = 'hr_review' and manager_decision = 'approved' from public.hr_exits where id = pg_temp.id('x1')), 'manager approval moves to HR review');
select pg_temp.as_k('hr');
select test.eq(test.count_rows('select 1 from public.hr_exits'), 1::bigint, 'HR sees all exits');

-- ---- HR approval -> notice period
select public.hr_hr_review_exit(pg_temp.id('x1'), true, hr_private.business_today(), 'Accepted');
select test.eq((select status from public.hr_exits where id = pg_temp.id('x1')), 'notice_period', 'HR approval starts notice period');
select test.ok((select status = 'notice_period' and last_working_date = hr_private.business_today() and resignation_date = hr_private.business_today()
                from public.hr_employees where id = pg_temp.id('emp1')), 'employee status notice_period with dates');
select pg_temp.as_k('emp1');
select test.throws($q$select public.hr_withdraw_resignation(pg_temp.id('x1'))$q$, 'cannot self-withdraw after HR approval', 'contact HR');
select test.ok(hr_private.current_employee_id() is not null, 'employee keeps access during notice period');

-- ---- clearance
select pg_temp.as_k('hr');
insert into public.hr_assets (asset_tag, asset_type) values ('EXIT-LAP', 'Laptop');
do $$ begin
  insert into t_ids values ('asg', public.hr_assign_asset((select id from public.hr_assets where asset_tag = 'EXIT-LAP'), pg_temp.id('emp1')));
end $$;
select test.throws($q$select public.hr_complete_clearance_item(gen_random_uuid(), 'completed')$q$, 'unknown item rejected', 'not found');
select public.hr_start_exit_clearance(pg_temp.id('x1'));
select test.eq((select count(*) from public.hr_exit_clearance_items where exit_id = pg_temp.id('x1')), 9::bigint, 'nine clearance items created (incl. IT clearance, 130)');
select test.throws($q$select public.hr_complete_clearance_item(pg_temp.item('x1','asset_return'), 'completed')$q$, 'asset return blocked while assets open', 'still assigned');
select test.throws($q$select public.hr_complete_clearance_item(pg_temp.item('x1','asset_return'), 'not_applicable', 'n/a')$q$, 'asset return cannot be skipped while assets open', 'still assigned');
select public.hr_return_asset(pg_temp.id('asg'), 'good');
-- [142] returns inspected and completed, but the Module 11 asset-clearance sign-off is still required
select test.throws($q$select public.hr_complete_clearance_item(pg_temp.item('x1','asset_return'), 'completed', 'Laptop returned')$q$,
  'asset return needs the asset-clearance sign-off (142)', 'Record the asset clearance');
select test.throws($q$select public.hr_complete_clearance_item(pg_temp.item('x1','asset_return'), 'not_applicable', 'n/a')$q$,
  'not applicable cannot bypass the asset-clearance sign-off (142)', 'Record the asset clearance');
select public.hr_record_asset_clearance(pg_temp.id('emp1'), pg_temp.id('x1'), 'Laptop returned and inspected');
select public.hr_complete_clearance_item(pg_temp.item('x1','asset_return'), 'completed', 'Laptop returned');
select test.throws($q$select public.hr_complete_clearance_item(pg_temp.item('x1','access_revocation'), 'completed')$q$, 'access item needs the revocation service', 'not been revoked');
select test.throws($q$select public.hr_record_auth_access_revoked(pg_temp.id('x1'))$q$, 'HR cannot call the service-only RPC', 'permission denied');
select test.eq((public.hr_can_revoke_exit_access(pg_temp.id('x1')) ->> 'user_id')::uuid, test.user_of(pg_temp.id('emp1')), 'pre-flight returns the auth user to ban');
select test.as_service();
select public.hr_record_auth_access_revoked(pg_temp.id('x1'));
select pg_temp.as_k('hr');
select test.ok((select auth_access_revoked_at is not null from public.hr_exits where id = pg_temp.id('x1')), 'service recorded auth revocation');
select public.hr_complete_clearance_item(pg_temp.item('x1','access_revocation'), 'completed');
select test.throws($q$select public.hr_move_exit_to_settlement(pg_temp.id('x1'))$q$, 'settlement blocked by pending items', 'document handover');
select test.throws($q$select public.hr_complete_clearance_item(pg_temp.item('x1','project_handover'), 'not_applicable')$q$, 'not applicable needs a note', 'explaining');
select public.hr_complete_clearance_item(pg_temp.item('x1','document_handover'), 'completed');
select public.hr_complete_clearance_item(pg_temp.item('x1','project_handover'), 'not_applicable', 'No active projects');
select public.hr_complete_clearance_item(pg_temp.item('x1','hr_clearance'), 'completed');
select public.hr_complete_clearance_item(pg_temp.item('x1','payroll_clearance'), 'completed');
select public.hr_complete_clearance_item(pg_temp.item('x1','it_clearance'), 'completed', 'Accounts and devices cleared');
select public.hr_move_exit_to_settlement(pg_temp.id('x1'));
select test.eq((select status from public.hr_exits where id = pg_temp.id('x1')), 'final_settlement', 'moved to final settlement');
select test.throws($q$select public.hr_complete_clearance_item(pg_temp.item('x1','hr_clearance'), 'pending')$q$, 'cleared items cannot be reopened at settlement', 'clearance');
select test.throws($q$select public.hr_close_exit(pg_temp.id('x1'), 'Paid')$q$, 'close blocked by pending settlement items', 'final settlement');
-- 130: the final settlement item is completed by an approved settlement, not by HR.
select test.throws($q$select public.hr_complete_clearance_item(pg_temp.item('x1','final_settlement'), 'completed', 'Full and final paid')$q$,
  'HR cannot complete final settlement without an approved settlement', 'not been approved');
select pg_temp.as_k('pay1');
do $$ begin insert into t_ids values ('fnf', public.hr_prepare_settlement(pg_temp.id('x1'))); end $$;
select public.hr_save_settlement_line(pg_temp.id('fnf'), null, 'other_earning', 'Pending salary (test)', 1000);
select public.hr_submit_settlement(pg_temp.id('fnf'));
select pg_temp.as_k('pay2');
select public.hr_approve_settlement(pg_temp.id('fnf'), true, 'Checked');
select pg_temp.as_k('hr');
select test.eq((select status from public.hr_exit_clearance_items where id = pg_temp.item('x1','final_settlement')), 'completed', 'approved settlement completes the item');
select public.hr_complete_clearance_item(pg_temp.item('x1','relieving_letter'), 'completed');
select public.hr_record_exit_letter(pg_temp.id('x1'), 'relieving');
select public.hr_record_exit_letter(pg_temp.id('x1'), 'experience');

-- ---- closure
select public.hr_close_exit(pg_temp.id('x1'), 'F&F settled');
select test.as_owner();
select test.ok((select status = 'exited' and not portal_access and last_working_date = hr_private.business_today()
                from public.hr_employees where id = pg_temp.id('emp1')), 'employee exited, portal access off');
select test.eq((select count(*) from public.hr_user_roles where user_id = test.user_of(pg_temp.id('emp1'))), 0::bigint, 'HR roles revoked on exit');
select test.eq((select count(*) from public.hr_employee_history where employee_id = pg_temp.id('emp1') and change_type = 'role' and new_value like '-%'), 2::bigint,
  'role revocations recorded in history');
select test.ok((select status = 'closed' and closed_at is not null and relieving_letter_issued_at is not null and experience_letter_issued_at is not null
                from public.hr_exits where id = pg_temp.id('x1')), 'exit closed with letters recorded');
select test.ok((select count(*) >= 10 from public.hr_exit_events where exit_id = pg_temp.id('x1')), 'exit history kept');
select test.ok(exists (select 1 from public.hr_audit_log where action = 'EXIT_CLOSED' and record_id = pg_temp.id('x1')::text), 'closure audited');
select test.ok(exists (select 1 from public.hr_notifications where entity_id = pg_temp.id('x1')::text and title like 'Exit completed%'
                       and recipient_user_id = test.user_of(pg_temp.id('mgr'))), 'manager notified of closure');
select pg_temp.as_k('emp1');
select test.ok(hr_private.current_employee_id() is null, 'exited employee loses access');
select test.eq(test.count_rows('select 1 from public.hr_exits'), 0::bigint, 'exited employee sees nothing');
select pg_temp.as_k('mgr');
select test.eq(test.count_rows($q$select 1 from public.hr_exit_clearance_items where exit_id = pg_temp.id('x1')$q$), 9::bigint, 'manager still sees clearance history');

-- ---- employee without manager: HR review, withdraw, re-submit, reject
select pg_temp.as_k('emp2');
do $$ begin insert into t_ids values ('x2', public.hr_submit_resignation('Higher studies')); end $$;
select test.eq((select status from public.hr_exits where id = pg_temp.id('x2')), 'hr_review', 'no manager: straight to HR review');
select test.eq((select proposed_last_working_day from public.hr_exits where id = pg_temp.id('x2')), hr_private.business_today() + 30, 'default LWD = today + notice');
select public.hr_withdraw_resignation(pg_temp.id('x2'), 'Changed my mind');
select test.eq((select status from public.hr_exits where id = pg_temp.id('x2')), 'withdrawn', 'employee withdrew before approval');
do $$ begin insert into t_ids values ('x3', public.hr_submit_resignation('Higher studies, final')); end $$;
select test.ok(true, 'can resubmit after withdrawal');
select pg_temp.as_k('hr');
select test.throws($q$select public.hr_hr_review_exit(pg_temp.id('x3'), false)$q$, 'HR rejection needs a note', 'note');
select public.hr_hr_review_exit(pg_temp.id('x3'), false, null, 'Please discuss with HR first');
select test.ok((select e.status = 'active' and x.status = 'rejected' from public.hr_exits x join public.hr_employees e on e.id = x.employee_id
                where x.id = pg_temp.id('x3')), 'rejected resignation leaves employee active');

-- ---- HR-initiated exit and HR withdrawal
do $$ begin insert into t_ids values ('x4', public.hr_initiate_exit(pg_temp.id('emp3'), 'termination', 'Policy violation', hr_private.business_today() + 7)); end $$;
select test.ok((select x.status = 'notice_period' and e.status = 'notice_period' and e.last_working_date = hr_private.business_today() + 7
                from public.hr_exits x join public.hr_employees e on e.id = x.employee_id where x.id = pg_temp.id('x4')), 'HR-initiated exit starts notice period');
select test.throws($q$select public.hr_initiate_exit(pg_temp.id('emp3'), 'termination', 'Duplicate', hr_private.business_today())$q$, 'one open case per employee', 'already has an open');
select test.throws($q$select public.hr_initiate_exit(pg_temp.id('hr'), 'termination', 'Self', hr_private.business_today())$q$, 'HR cannot initiate own exit', 'your own exit');
select public.hr_start_exit_clearance(pg_temp.id('x4'));
select test.throws($q$select public.hr_close_exit(pg_temp.id('x4'))$q$, 'cannot close from clearance', 'final settlement stage');
select public.hr_withdraw_resignation(pg_temp.id('x4'), 'Matter resolved');
select test.ok((select status = 'active' and last_working_date is null from public.hr_employees where id = pg_temp.id('emp3')), 'HR withdrawal restores employee status');

-- ---- HR cannot decide own resignation
select pg_temp.as_k('hr');
do $$ begin insert into t_ids values ('x5', public.hr_submit_resignation('Personal reasons')); end $$;
select test.throws($q$select public.hr_hr_review_exit(pg_temp.id('x5'), true)$q$, 'HR cannot approve own resignation', 'your own exit');

-- ---- last super admin cannot be exited
select test.as_owner();
insert into public.hr_exits (employee_id, initiated_by, exit_type, status, approved_last_working_day)
values (pg_temp.id('super'), 'hr', 'termination', 'final_settlement', hr_private.business_today());
insert into t_ids select 'x6', id from public.hr_exits where employee_id = pg_temp.id('super');
select pg_temp.as_k('hr');
select test.throws($q$select public.hr_close_exit(pg_temp.id('x6'))$q$, 'last super admin protected on exit', 'last Super Admin');
select test.as_owner();
select test.ok((select status <> 'exited' from public.hr_employees where id = pg_temp.id('super')), 'super admin not exited');
