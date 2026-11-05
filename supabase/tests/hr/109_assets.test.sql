-- Assets: inventory guard, assignment uniqueness, bulk quantities, transfer,
-- return, damage, maintenance, retire/lost, requests, visibility, open
-- assets for exit clearance. Runs inside a transaction that is rolled back.

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated, anon, service_role;
create function pg_temp.as_k(p_k text) returns void language plpgsql as $$
begin
  perform test.as_owner();
  perform test.as_user(test.user_of((select v from t_ids where k = p_k)));
end $$;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;

do $$
begin
  insert into t_ids values ('hr',   test.make_employee('ast.hr@test.local', 'Hugo', null, array['hr_admin']));
  insert into t_ids values ('mgr',  test.make_employee('ast.mgr@test.local', 'Maya', null, array['manager','employee']));
  insert into t_ids values ('emp1', test.make_employee('ast.emp1@test.local', 'Ivo', (select v from t_ids where k='mgr')));
  insert into t_ids values ('emp2', test.make_employee('ast.emp2@test.local', 'Lena', null));
end $$;

-- ---- inventory writes
select pg_temp.as_k('emp1');
select test.throws($q$insert into public.hr_assets (asset_tag, asset_type) values ('LAP-X', 'Laptop')$q$, 'employee cannot create assets', 'row-level security');
select test.throws($q$select public.hr_assign_asset(gen_random_uuid(), gen_random_uuid())$q$, 'employee cannot assign assets', 'not allowed');

select pg_temp.as_k('hr');
insert into public.hr_assets (asset_tag, asset_type, brand, model, serial_number, purchase_date, purchase_cost)
values ('LAP-001', 'Laptop', 'Acme', 'Book 14', 'SN-001', current_date - 100, 75000),
       ('LAP-002', 'Laptop', 'Acme', 'Book 14', 'SN-002', current_date - 100, 75000),
       ('LAP-003', 'Laptop', 'Acme', 'Book 16', 'SN-003', current_date - 10, 90000);
insert into public.hr_assets (asset_tag, asset_type, is_bulk, quantity) values ('MOUSE-BULK', 'Mouse', true, 3);
select test.as_owner();
insert into t_ids select 'lap1', id from public.hr_assets where asset_tag = 'LAP-001';
insert into t_ids select 'lap2', id from public.hr_assets where asset_tag = 'LAP-002';
insert into t_ids select 'lap3', id from public.hr_assets where asset_tag = 'LAP-003';
insert into t_ids select 'mouse', id from public.hr_assets where asset_tag = 'MOUSE-BULK';
select test.eq((select count(*) from public.hr_asset_events where event_type = 'purchase'), 4::bigint, 'purchase event recorded for each new asset');
select test.throws($q$insert into public.hr_assets (asset_tag, asset_type, serial_number) values ('LAP-009', 'Laptop', 'SN-001')$q$, 'serial numbers are unique', 'duplicate');
select test.throws($q$insert into public.hr_assets (asset_tag, asset_type, quantity) values ('LAP-010', 'Laptop', 2)$q$, 'non-bulk asset quantity must be 1', 'check');

select pg_temp.as_k('hr');
select test.throws($q$update public.hr_assets set status = 'retired' where asset_tag = 'LAP-001'$q$, 'status not directly editable', 'asset workflow');
update public.hr_assets set notes = 'Charger included' where asset_tag = 'LAP-001';
select test.eq((select notes from public.hr_assets where asset_tag = 'LAP-001'), 'Charger included', 'HR edits asset master data');

-- ---- assignment
do $$ begin
  insert into t_ids values ('a_lap1', public.hr_assign_asset(pg_temp.id('lap1'), pg_temp.id('emp1'), null, 'Onboarding kit'));
end $$;
select test.eq((select status from public.hr_assets where id = pg_temp.id('lap1')), 'assigned', 'assigned asset status');
select test.throws($q$select public.hr_assign_asset(pg_temp.id('lap1'), pg_temp.id('emp2'))$q$, 'asset cannot be double-assigned', 'already assigned');
select test.throws($q$select public.hr_assign_asset(pg_temp.id('lap2'), pg_temp.id('emp2'), null, null, 2)$q$, 'individual asset quantity 1', 'one at a time');
-- bulk
do $$ begin
  insert into t_ids values ('a_mouse1', public.hr_assign_asset(pg_temp.id('mouse'), pg_temp.id('emp1'), null, null, 2));
  insert into t_ids values ('a_mouse2', public.hr_assign_asset(pg_temp.id('mouse'), pg_temp.id('emp2'), null, null, 1));
end $$;
select test.eq((select status from public.hr_assets where id = pg_temp.id('mouse')), 'assigned', 'bulk asset fully allocated');
select test.throws($q$select public.hr_assign_asset(pg_temp.id('mouse'), pg_temp.id('mgr'))$q$, 'bulk quantity cannot be exceeded', 'Only 0');
select test.throws($q$update public.hr_assets set quantity = 2 where id = pg_temp.id('mouse')$q$, 'quantity cannot drop below assigned', 'lower than');
select test.as_owner();
select test.throws($q$insert into public.hr_asset_assignments (asset_id, employee_id) values (pg_temp.id('lap1'), pg_temp.id('emp2'))$q$,
  'unique index blocks a second active assignment', 'duplicate');
select test.ok(exists (select 1 from public.hr_notifications where type = 'asset_assigned' and recipient_user_id = test.user_of(pg_temp.id('emp1'))), 'employee notified on assignment');

-- ---- employee view + self-service
select pg_temp.as_k('emp1');
select test.eq(test.count_rows('select 1 from public.hr_asset_assignments'), 2::bigint, 'employee sees own assignments only');
select test.eq(test.count_rows('select 1 from public.hr_assets'), 2::bigint, 'employee sees only assets they hold');
select test.eq(test.count_rows('select 1 from public.hr_asset_events'), 2::bigint, 'employee sees events of own assignments only');
update public.hr_asset_assignments set status = 'returned', returned_at = now();
select test.eq(test.count_rows($q$select 1 from public.hr_asset_assignments where status = 'active'$q$), 2::bigint, 'employee cannot close own assignment directly');
select public.hr_acknowledge_asset(pg_temp.id('a_lap1'));
select test.ok((select acknowledged_at is not null from public.hr_asset_assignments where id = pg_temp.id('a_lap1')), 'employee acknowledged receipt');
select public.hr_report_asset_damage(pg_temp.id('a_lap1'), null, 'Cracked hinge');
select test.as_owner();
select test.eq((select condition from public.hr_assets where id = pg_temp.id('lap1')), 'damaged', 'damage report sets condition');
select pg_temp.as_k('emp2');
select test.throws($q$select public.hr_acknowledge_asset(pg_temp.id('a_lap1'))$q$, 'cannot acknowledge colleague assignment', 'not found');
select test.throws($q$select public.hr_report_asset_damage(pg_temp.id('a_lap1'), null, 'x')$q$, 'cannot report damage on colleague assignment', 'not found');
select test.throws($q$select public.hr_report_asset_damage(null, pg_temp.id('lap1'), 'x')$q$, 'employee cannot report damage by asset id', 'not allowed');
select test.eq(test.count_rows('select 1 from public.hr_assets'), 1::bigint, 'second employee sees only the bulk item they hold');
select test.as_owner();

-- ---- transfer, return, maintenance
select pg_temp.as_k('hr');
do $$ begin
  insert into t_ids values ('a_lap1b', public.hr_transfer_asset(pg_temp.id('a_lap1'), pg_temp.id('emp2'), 'Team change'));
end $$;
select test.eq((select status from public.hr_asset_assignments where id = pg_temp.id('a_lap1')), 'returned', 'transfer closes old assignment');
select test.eq((select employee_id from public.hr_asset_assignments where id = pg_temp.id('a_lap1b')), pg_temp.id('emp2'), 'transfer opens assignment for new holder');
select test.eq((select transferred_from from public.hr_asset_assignments where id = pg_temp.id('a_lap1b')), pg_temp.id('a_lap1'), 'transfer linked to previous assignment');
select test.ok(exists (select 1 from public.hr_asset_events where asset_id = pg_temp.id('lap1') and event_type = 'transfer'), 'transfer event recorded');
select public.hr_return_asset(pg_temp.id('a_lap1b'), 'damaged', 'Hinge broken');
select test.eq((select status from public.hr_assets where id = pg_temp.id('lap1')), 'in_repair', 'damaged return goes to repair');
select test.throws($q$select public.hr_return_asset(pg_temp.id('a_lap1b'), 'good')$q$, 'cannot return twice', 'already closed');
select test.throws($q$select public.hr_assign_asset(pg_temp.id('lap1'), pg_temp.id('emp1'))$q$, 'cannot assign asset in repair', 'in repair');
select public.hr_log_asset_maintenance(pg_temp.id('lap1'), 'Hinge replaced', 2500, true);
select test.ok((select status = 'available' and condition = 'good' from public.hr_assets where id = pg_temp.id('lap1')), 'repair completed: available, good');
select test.eq((select cost from public.hr_asset_events where asset_id = pg_temp.id('lap1') and event_type = 'repair_complete'), 2500.00::numeric, 'maintenance cost recorded');
select public.hr_log_asset_maintenance(pg_temp.id('lap2'), 'Battery check', null, false);
select test.eq((select status from public.hr_assets where id = pg_temp.id('lap2')), 'in_repair', 'maintenance start moves available asset to repair');
select public.hr_set_asset_status(pg_temp.id('lap2'), 'retired', 'End of life');
select test.eq((select status from public.hr_assets where id = pg_temp.id('lap2')), 'retired', 'asset retired');
select test.throws($q$select public.hr_assign_asset(pg_temp.id('lap2'), pg_temp.id('emp1'))$q$, 'retired asset cannot be assigned', 'retired');
select test.throws($q$select public.hr_set_asset_status(pg_temp.id('mouse'), 'retired')$q$, 'cannot retire an assigned asset', 'return');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications where type = 'asset_transferred' and recipient_user_id = test.user_of(pg_temp.id('emp1'))), 'previous holder notified of transfer');
select test.ok(exists (select 1 from public.hr_notifications where type = 'asset_returned' and recipient_user_id = test.user_of(pg_temp.id('emp2'))), 'holder notified of return');

-- ---- requests
select pg_temp.as_k('emp1');
do $$ begin insert into t_ids values ('req1', public.hr_request_asset('Monitor', 'Second screen for design work')); end $$;
select test.throws($q$select public.hr_decide_asset_request(pg_temp.id('req1'), true)$q$, 'employee cannot decide requests', 'not allowed');
select pg_temp.as_k('emp2');
select test.eq(test.count_rows('select 1 from public.hr_asset_requests'), 0::bigint, 'colleague cannot see the request');
select test.throws($q$select public.hr_cancel_asset_request(pg_temp.id('req1'))$q$, 'colleague cannot cancel the request', 'not found');
select pg_temp.as_k('hr');
do $$ begin insert into t_ids values ('req_hr', public.hr_request_asset('Headset', 'Calls with candidates')); end $$;
select test.throws($q$select public.hr_decide_asset_request(pg_temp.id('req_hr'), true)$q$, 'HR cannot decide own request', 'own request');
select test.throws($q$select public.hr_decide_asset_request(pg_temp.id('req1'), false)$q$, 'rejection needs a note', 'reason');
select test.throws($q$select public.hr_fulfill_asset_request(pg_temp.id('req1'), pg_temp.id('lap3'))$q$, 'cannot fulfil before approval', 'approved');
select public.hr_decide_asset_request(pg_temp.id('req1'), true, 'Approved for Q4');
do $$ begin insert into t_ids values ('a_lap3', public.hr_fulfill_asset_request(pg_temp.id('req1'), pg_temp.id('lap3'))); end $$;
select test.ok((select status = 'fulfilled' and fulfilled_assignment = pg_temp.id('a_lap3') from public.hr_asset_requests where id = pg_temp.id('req1')), 'request fulfilled with assignment');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications where type = 'asset_request_decided' and recipient_user_id = test.user_of(pg_temp.id('emp1'))), 'requester notified of decision');

-- ---- open assets (exit clearance input)
select pg_temp.as_k('emp1');
select test.eq(test.count_rows($q$select 1 from public.hr_employee_open_assets(pg_temp.id('emp1'))$q$), 2::bigint, 'employee lists own open assets');
select pg_temp.as_k('emp2');
select test.throws($q$select * from public.hr_employee_open_assets(pg_temp.id('emp1'))$q$, 'colleague cannot list open assets', 'not allowed');
select pg_temp.as_k('mgr');
select test.eq(test.count_rows('select 1 from public.hr_asset_assignments'), 0::bigint, 'managers have no asset visibility without assets.view');
select pg_temp.as_k('hr');
select test.eq(test.count_rows('select 1 from public.hr_assets'), 4::bigint, 'HR sees whole inventory');
select public.hr_return_asset(pg_temp.id('a_mouse2'), 'good');
select test.eq((select status from public.hr_assets where id = pg_temp.id('mouse')), 'available', 'bulk item available again after partial return');
select public.hr_set_asset_status(pg_temp.id('lap1'), 'lost', 'Missing after office move');
select test.eq((select status from public.hr_assets where id = pg_temp.id('lap1')), 'lost', 'unassigned asset marked lost');
select public.hr_set_asset_status(pg_temp.id('lap3'), 'lost', 'Lost while travelling');
select test.eq((select status from public.hr_asset_assignments where id = pg_temp.id('a_lap3')), 'lost', 'losing an assigned asset closes its assignment as lost');
select test.throws($q$select public.hr_assign_asset(pg_temp.id('lap3'), pg_temp.id('emp2'))$q$, 'lost asset cannot be assigned', 'while it is lost');
select test.eq(test.count_rows($q$select 1 from public.hr_employee_open_assets(pg_temp.id('emp1'))$q$), 1::bigint, 'lost assignment no longer open');
select test.as_owner();

-- ---- audit
select test.ok(exists (select 1 from public.hr_audit_log where table_name = 'hr_asset_assignments'), 'assignments are audited');
