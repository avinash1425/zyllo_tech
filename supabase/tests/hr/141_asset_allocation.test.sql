-- Module 11 — Asset Allocation: register (duplicates, cost restriction),
-- assignment + handover acknowledgement / confirmation, damage workflow +
-- evidence, return workflow (request -> handover -> received -> inspected ->
-- completed), reassignment after return, history immutability, overview
-- counts, exit clearance, onboarding handover status, visibility.
-- Synthetic data only. Runs inside a transaction that is rolled back.

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
  insert into t_ids values ('hr',   test.make_employee('m11.hr@test.local', 'Hana', null, array['hr_admin']));
  insert into t_ids values ('hr2',  test.make_employee('m11.hr2@test.local', 'Omar', null, array['hr_admin']));
  insert into t_ids values ('clerk', test.make_employee('m11.clerk@test.local', 'Ines', null, array['employee']));
  insert into t_ids values ('emp1', test.make_employee('m11.emp1@test.local', 'Ravi', null));
  insert into t_ids values ('emp2', test.make_employee('m11.emp2@test.local', 'Sara', null));
  insert into t_ids values ('leaver', test.make_employee('m11.leaver@test.local', 'Theo', null));
end $$;
-- An "IT asset clerk" custom role: manages assets but may not see purchase cost.
select test.as_owner();
insert into public.hr_roles (key, name, description, is_system) values ('test_asset_clerk', 'Asset clerk (test)', 'test', false);
insert into public.hr_role_permissions values ('test_asset_clerk', 'assets.view'), ('test_asset_clerk', 'assets.manage');
insert into public.hr_user_roles (user_id, role_key) values (test.user_of(pg_temp.id('clerk')), 'test_asset_clerk');

-- =====================================================================
-- Register
-- =====================================================================
select pg_temp.as_k('hr');
insert into public.hr_assets (asset_tag, asset_type, brand, model, serial_number, purchase_date, purchase_cost, warranty_expiry, storage_location, condition)
values ('M11-LAP-1', 'Laptop', 'Acme', 'Book 14', 'M11-SN-1', current_date - 30, 82000, current_date + 20, 'IT cabinet A', 'new'),
       ('M11-LAP-2', 'Laptop', 'Acme', 'Book 14', 'M11-SN-2', current_date - 30, 82000, current_date + 400, 'IT cabinet A', 'new'),
       ('M11-MON-1', 'Monitor', 'Viewo', '27Q', 'M11-SN-3', current_date - 30, 18000, null, 'IT cabinet B', 'good');
insert into public.hr_assets (asset_tag, asset_type, is_bulk, quantity, storage_location) values ('M11-HEADSET', 'Headset', true, 4, 'Store room');
select test.as_owner();
insert into t_ids select 'lap1', id from public.hr_assets where asset_tag = 'M11-LAP-1';
insert into t_ids select 'lap2', id from public.hr_assets where asset_tag = 'M11-LAP-2';
insert into t_ids select 'mon1', id from public.hr_assets where asset_tag = 'M11-MON-1';
insert into t_ids select 'head', id from public.hr_assets where asset_tag = 'M11-HEADSET';

select pg_temp.as_k('hr');
select test.throws($q$insert into public.hr_assets (asset_tag, asset_type) values ('M11-LAP-1', 'Laptop')$q$, 'duplicate asset ID rejected', 'duplicate');
select test.throws($q$insert into public.hr_assets (asset_tag, asset_type, serial_number) values ('M11-LAP-9', 'Laptop', 'M11-SN-1')$q$, 'duplicate serial number rejected', 'duplicate');
select test.throws($q$insert into public.hr_assets (asset_tag, asset_type, status) values ('M11-LAP-8', 'Laptop', 'assigned')$q$, 'new asset cannot start assigned', 'available or in repair');
select test.eq((select storage_location from public.hr_assets where id = pg_temp.id('lap1')), 'IT cabinet A', 'storage location stored');
select test.ok((select count(*) = 1 from public.hr_asset_events where asset_id = pg_temp.id('lap1') and event_type = 'purchase' and cost is null),
               'registration event recorded without copying the purchase cost');

-- ---- purchase cost restriction
select test.eq((select count(*) from public.hr_assets where purchase_cost is not null), 0::bigint, 'hr_assets.purchase_cost is always left null');
select test.eq((select purchase_cost from public.hr_asset_financials where asset_id = pg_temp.id('lap1')), 82000.00::numeric, 'cost moved to hr_asset_financials');
select test.eq((select purchase_cost from public.hr_asset_costs(array[pg_temp.id('lap1')])), 82000.00::numeric, 'HR (assets.view_cost) reads cost via RPC');
select pg_temp.as_k('clerk');
select test.eq(test.count_rows('select 1 from public.hr_assets'), (select count(*) from public.hr_assets)::bigint, 'clerk sees the register');
select test.throws($q$select * from public.hr_asset_costs(array[pg_temp.id('lap1')])$q$, 'clerk cannot read purchase cost', 'not allowed');
select test.eq(test.count_rows('select 1 from public.hr_asset_financials'), 0::bigint, 'clerk sees no rows in hr_asset_financials');
update public.hr_asset_financials set purchase_cost = 1;   -- no write policy: 0 rows
select test.as_owner();
select test.eq((select purchase_cost from public.hr_asset_financials where asset_id = pg_temp.id('lap1')), 82000.00::numeric, 'direct cost writes have no effect');
select pg_temp.as_k('clerk');
select test.throws($q$insert into public.hr_assets (asset_tag, asset_type, purchase_cost) values ('M11-KB-1', 'Keyboard', 900)$q$, 'clerk cannot record a cost', 'purchase cost');
select test.throws($q$update public.hr_assets set purchase_cost = 1 where asset_tag = 'M11-LAP-1'$q$, 'clerk cannot change a cost', 'purchase cost');
insert into public.hr_assets (asset_tag, asset_type, brand) values ('M11-KB-1', 'Keyboard', 'Keyo');
select test.ok(exists (select 1 from public.hr_assets where asset_tag = 'M11-KB-1'), 'clerk registers an asset without cost');
select pg_temp.as_k('emp1');
select test.throws($q$select * from public.hr_asset_costs(array[pg_temp.id('lap1')])$q$, 'employee cannot read purchase cost', 'not allowed');
select test.eq(test.count_rows('select 1 from public.hr_asset_financials'), 0::bigint, 'employee sees no cost rows');
select test.throws($q$select * from public.hr_asset_overview()$q$, 'employee cannot read the overview', 'not allowed');

-- =====================================================================
-- Assignment + handover
-- =====================================================================
select pg_temp.as_k('hr');
do $$ begin
  insert into t_ids values ('a1', public.hr_assign_asset_v2(pg_temp.id('lap1'), pg_temp.id('emp1'), null, 'First day',
    1, 'Onboarding', array['Charger', 'Laptop bag', ' charger '], null, 'new'));
end $$;
select test.ok((select assignment_reason = 'Onboarding' and accessories = array['Charger','Laptop bag','charger'] and issued_condition = 'new'
                from public.hr_asset_assignments where id = pg_temp.id('a1')), 'assignment stores reason, accessories, issued condition');
select test.eq((select status from public.hr_assets where id = pg_temp.id('lap1')), 'assigned', 'assigned asset status');
select test.throws($q$select public.hr_assign_asset_v2(pg_temp.id('lap1'), pg_temp.id('emp2'))$q$, 'duplicate active assignment prevented', 'already assigned');
select test.throws($q$select public.hr_assign_asset_v2(pg_temp.id('lap2'), pg_temp.id('hr'))$q$, 'cannot assign equipment to oneself', 'another asset manager');
select test.throws($q$select public.hr_assign_asset_v2(pg_temp.id('lap2'), pg_temp.id('emp2'), current_date - 1)$q$, 'expected return in the past rejected', 'past');
do $$ begin
  insert into t_ids values ('h1', (select id from public.hr_asset_handovers where assignment_id = pg_temp.id('a1')));
  insert into t_ids values ('ah', public.hr_assign_asset_v2(pg_temp.id('head'), pg_temp.id('emp1'), null, null, 2));
  insert into t_ids values ('am', public.hr_assign_asset(pg_temp.id('mon1'), pg_temp.id('emp2'), current_date + 5, 'Legacy RPC'));
end $$;
select test.ok((select status = 'pending_acknowledgement' and terms_version = '2026-11-v1' and jsonb_array_length(checklist) = 5
                from public.hr_asset_handovers where id = pg_temp.id('h1')), 'handover created with terms version and default checklist');
select test.ok(exists (select 1 from public.hr_asset_handovers where assignment_id = pg_temp.id('am')), 'legacy assign RPC also creates a handover');
select test.eq((select status from public.hr_assets where id = pg_temp.id('head')), 'available', 'bulk item partly assigned stays available');
select public.hr_update_asset_handover(pg_temp.id('h1'), null, null,
  '[{"item":"Device powers on","done":true},{"item":"Charger included","done":true}]'::jsonb, 'Sticker on lid');
select test.ok((select jsonb_array_length(checklist) = 2 and notes = 'Sticker on lid' from public.hr_asset_handovers where id = pg_temp.id('h1')),
               'HR edits the checklist before acknowledgement');
select test.throws($q$select public.hr_confirm_asset_handover(pg_temp.id('h1'))$q$, 'HR cannot confirm before acknowledgement', 'not acknowledged');

-- employee visibility + acknowledgement
select pg_temp.as_k('emp2');
select test.eq(test.count_rows($q$select 1 from public.hr_asset_handovers where id = pg_temp.id('h1')$q$), 0::bigint, 'colleague cannot see the handover');
select test.throws($q$select public.hr_acknowledge_asset_handover(pg_temp.id('h1'), '2026-11-v1')$q$, 'colleague cannot acknowledge', 'not found');
select test.eq(test.count_rows('select 1 from public.hr_asset_assignments'), 1::bigint, 'employee sees only own assignments');
select pg_temp.as_k('emp1');
select test.eq(test.count_rows('select 1 from public.hr_asset_handovers'), 2::bigint, 'employee sees own handovers');
select test.throws($q$select public.hr_acknowledge_asset_handover(pg_temp.id('h1'), 'old-version')$q$, 'stale terms version rejected', 'terms have changed');
select public.hr_acknowledge_asset_handover(pg_temp.id('h1'), '2026-11-v1');
select test.ok((select status = 'acknowledged' and acknowledged_at is not null and acknowledged_terms_version = '2026-11-v1'
                from public.hr_asset_handovers where id = pg_temp.id('h1')), 'acknowledgement timestamp and version recorded');
select test.ok((select acknowledged_at is not null from public.hr_asset_assignments where id = pg_temp.id('a1')), 'assignment acknowledged_at kept in sync');
select public.hr_acknowledge_asset(pg_temp.id('ah'));
select test.eq((select status from public.hr_asset_handovers where assignment_id = pg_temp.id('ah')), 'acknowledged', 'legacy acknowledge RPC acknowledges the handover');
select test.throws($q$select public.hr_confirm_asset_handover(pg_temp.id('h1'))$q$, 'employee cannot confirm', 'not allowed');
select pg_temp.as_k('hr');
select test.throws($q$select public.hr_update_asset_handover(pg_temp.id('h1'), 'poor')$q$, 'handover locked after acknowledgement', 'before the employee acknowledges');
select public.hr_confirm_asset_handover(pg_temp.id('h1'), 'Checked at desk');
select test.ok((select status = 'confirmed' and confirmed_by = test.user_of(pg_temp.id('hr')) from public.hr_asset_handovers where id = pg_temp.id('h1')), 'HR/IT confirmation recorded');

-- ---- handover document (Module 9 reuse)
do $$ declare r jsonb; begin
  r := public.hr_register_document_upload(pg_temp.id('emp1'), 'asset_handover', 'Handover M11-LAP-1', 'handover.pdf', 'application/pdf', 1000);
  insert into t_ids values ('doc_h', (r ->> 'document_id')::uuid);
  r := public.hr_register_document_upload(pg_temp.id('emp2'), 'asset_handover', 'Wrong employee', 'handover.pdf', 'application/pdf', 1000);
  insert into t_ids values ('doc_wrong', (r ->> 'document_id')::uuid);
  r := public.hr_register_document_upload(pg_temp.id('emp1'), 'hr_letter', 'Wrong category', 'x.pdf', 'application/pdf', 1000);
  insert into t_ids values ('doc_cat', (r ->> 'document_id')::uuid);
end $$;
select public.hr_link_asset_document(pg_temp.id('doc_h'), 'handover', pg_temp.id('h1'));
select test.throws($q$select public.hr_link_asset_document(pg_temp.id('doc_wrong'), 'handover', pg_temp.id('h1'))$q$, 'document of another employee rejected', 'different employee');
select test.throws($q$select public.hr_link_asset_document(pg_temp.id('doc_cat'), 'handover', pg_temp.id('h1'))$q$, 'document category must match', 'category');
select pg_temp.as_k('emp1');
select test.eq(test.count_rows('select 1 from public.hr_asset_document_links'), 1::bigint, 'employee sees the handover document link');

-- =====================================================================
-- Damage reports
-- =====================================================================
select pg_temp.as_k('emp1');
do $$ begin
  insert into t_ids values ('d1', public.hr_submit_asset_damage_report(pg_temp.id('a1'), null, current_date - 1, 'screen', 'high', 'Screen cracked when the bag fell'));
end $$;
select test.throws($q$select public.hr_submit_asset_damage_report(pg_temp.id('a1'), null, current_date + 1, 'screen', 'high', 'Future')$q$, 'future incident date rejected', 'today or earlier');
select test.throws($q$select public.hr_submit_asset_damage_report(pg_temp.id('a1'), null, current_date, 'nonsense', 'high', 'Bad category')$q$, 'unknown damage category rejected', 'category');
select test.throws($q$select public.hr_submit_asset_damage_report(null, pg_temp.id('lap2'), current_date, 'screen', 'low', 'Not mine')$q$, 'employee cannot report on unassigned asset', 'not allowed');
select test.ok((select condition = 'damaged' from public.hr_assets where id = pg_temp.id('lap1')), 'reported damage marks the asset damaged');
select public.hr_update_asset_damage_report(pg_temp.id('d1'), current_date - 1, 'screen', 'critical', 'Screen cracked; display flickers');
select test.eq((select severity from public.hr_asset_damage_reports where id = pg_temp.id('d1')), 'critical', 'reporter edits while Reported');
-- damage evidence upload by the employee
do $$ declare r jsonb; begin
  r := public.hr_register_document_upload(pg_temp.id('emp1'), 'asset_damage_evidence', 'Photo of screen', 'screen.jpg', 'image/jpeg', 2048);
  insert into t_ids values ('doc_ev', (r ->> 'document_id')::uuid);
end $$;
select public.hr_link_asset_document(pg_temp.id('doc_ev'), 'damage_evidence', pg_temp.id('d1'));
select test.ok(exists (select 1 from public.hr_asset_document_links where damage_report_id = pg_temp.id('d1')), 'employee attaches damage evidence');
select test.throws($q$select public.hr_advance_asset_damage_report(pg_temp.id('d1'), 'under_review')$q$, 'employee cannot review', 'not allowed');
update public.hr_asset_damage_reports set status = 'resolved' where id = pg_temp.id('d1');   -- RLS: no update policy, 0 rows
select test.eq((select status from public.hr_asset_damage_reports where id = pg_temp.id('d1')), 'reported', 'direct update had no effect');
select pg_temp.as_k('emp2');
select test.eq(test.count_rows('select 1 from public.hr_asset_damage_reports'), 0::bigint, 'colleague cannot see the damage report');

select pg_temp.as_k('hr');
select test.throws($q$select public.hr_advance_asset_damage_report(pg_temp.id('d1'), 'resolved', 'skip')$q$, 'cannot skip Under Review', 'cannot move');
select public.hr_advance_asset_damage_report(pg_temp.id('d1'), 'under_review', 'Photos received');
select pg_temp.as_k('emp1');
select test.throws($q$select public.hr_update_asset_damage_report(pg_temp.id('d1'), current_date, 'screen', 'low', 'Downplay')$q$, 'employee cannot edit after review starts', 'can no longer be edited');
select pg_temp.as_k('hr');
select public.hr_advance_asset_damage_report(pg_temp.id('d1'), 'under_repair', null, 'Sent to vendor for screen replacement');
select test.eq((select status from public.hr_assets where id = pg_temp.id('lap1')), 'assigned', 'assigned asset stays with employee while repair is arranged');
select test.throws($q$select public.hr_advance_asset_damage_report(pg_temp.id('d1'), 'resolved')$q$, 'resolution needs notes', 'resolution notes');
select public.hr_advance_asset_damage_report(pg_temp.id('d1'), 'resolved', 'Screen replaced under warranty', null, 0, 'good');
select test.ok((select status = 'resolved' and resolution_date is not null and repair_cost = 0 from public.hr_asset_damage_reports where id = pg_temp.id('d1')),
               'damage report resolved with repair details');
select test.eq((select condition from public.hr_assets where id = pg_temp.id('lap1')), 'good', 'asset condition restored after repair');
select test.throws($q$select public.hr_advance_asset_damage_report(pg_temp.id('d1'), 'under_review')$q$, 'resolved report cannot reopen', 'cannot move');
select test.throws($q$select public.hr_update_asset_damage_report(pg_temp.id('d1'), current_date, 'screen', 'low', 'Edit after resolve')$q$, 'resolved report is immutable', 'resolved');
do $$ declare r jsonb; begin
  r := public.hr_register_document_upload(pg_temp.id('emp1'), 'asset_damage_evidence', 'Late photo', 'late.jpg', 'image/jpeg', 2048);
  insert into t_ids values ('doc_late', (r ->> 'document_id')::uuid);
end $$;
select test.throws($q$select public.hr_link_asset_document(pg_temp.id('doc_late'), 'damage_evidence', pg_temp.id('d1'))$q$, 'no evidence added to a resolved report', 'not allowed');
select test.as_owner();
select test.throws($q$update public.hr_asset_damage_reports set resolution_notes = 'tamper' where id = pg_temp.id('d1')$q$, 'resolved report immutable even for the owner role', 'resolved damage report');
select test.eq((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hr_asset_damage_reports'
                and column_name ilike '%deduct%'), 0::bigint, 'damage reports carry no salary deduction field');

-- =====================================================================
-- Returns
-- =====================================================================
select pg_temp.as_k('emp1');
do $$ begin
  insert into t_ids values ('r1', public.hr_request_asset_return(pg_temp.id('a1'), 'Switching to a desktop', current_date + 2));
end $$;
select test.throws($q$select public.hr_request_asset_return(pg_temp.id('a1'), 'Again')$q$, 'only one open return per assignment', 'already in progress');
select test.throws($q$select public.hr_request_asset_return(pg_temp.id('am'), 'Not mine')$q$, 'employee cannot return a colleague''s asset', 'not found');
select test.throws($q$select public.hr_receive_asset_return(pg_temp.id('r1'))$q$, 'employee cannot receive', 'not allowed');
select test.eq((select status from public.hr_asset_returns where id = pg_temp.id('r1')), 'requested', 'employee request starts as Requested');
select pg_temp.as_k('hr');
select test.throws($q$select public.hr_transfer_asset(pg_temp.id('a1'), pg_temp.id('emp2'))$q$, 'transfer blocked while a return is open', 'return is in progress');
select test.throws($q$select public.hr_inspect_asset_return(pg_temp.id('r1'), 'good', 'available')$q$, 'cannot inspect before receipt', 'Only received');
select public.hr_schedule_asset_return(pg_temp.id('r1'), current_date + 1, 'Bring it to the IT desk');
select test.eq((select status from public.hr_asset_returns where id = pg_temp.id('r1')), 'pending_handover', 'return scheduled -> Pending Handover');
select public.hr_receive_asset_return(pg_temp.id('r1'), array['Charger'], 'Received at IT desk');
select test.ok((select status = 'received' and missing_accessories = array['Laptop bag','charger'] from public.hr_asset_returns where id = pg_temp.id('r1')),
               'receipt records missing accessories');
select test.ok((select status = 'returned' and returned_at is not null from public.hr_asset_assignments where id = pg_temp.id('a1')),
               'receipt closes the assignment (asset no longer assigned)');
select test.eq((select status from public.hr_assets where id = pg_temp.id('lap1')), 'in_inspection', 'received asset awaits inspection, not available');
select test.throws($q$select public.hr_assign_asset_v2(pg_temp.id('lap1'), pg_temp.id('emp2'))$q$, 'asset awaiting inspection cannot be reassigned', 'in inspection');
select test.throws($q$select public.hr_set_asset_status(pg_temp.id('lap1'), 'retired')$q$, 'cannot retire while inspection pending', 'awaiting inspection');
select test.eq(test.count_rows($q$select 1 from public.hr_employee_open_assets(pg_temp.id('emp1')) where asset_id = pg_temp.id('lap1')$q$), 1::bigint,
               'asset awaiting inspection still counts as open for exit clearance');
select test.throws($q$select public.hr_complete_asset_return(pg_temp.id('r1'))$q$, 'cannot complete before inspection', 'Inspect');
select test.throws($q$select public.hr_inspect_asset_return(pg_temp.id('r1'), 'damaged', 'available', 'Dent')$q$, 'damaged asset cannot go straight to stock', 'cannot go straight back');
select public.hr_inspect_asset_return(pg_temp.id('r1'), 'fair', 'available', 'Minor scratches', null);
select test.ok((select status = 'inspected' and outcome = 'available' and inspected_by is not null from public.hr_asset_returns where id = pg_temp.id('r1')), 'inspection recorded');
select test.eq((select status from public.hr_assets where id = pg_temp.id('lap1')), 'in_inspection', 'asset still not available after inspection until completion');
select pg_temp.as_k('emp1');
select public.hr_acknowledge_asset_return(pg_temp.id('r1'));
select test.ok((select employee_acknowledged_at is not null from public.hr_asset_returns where id = pg_temp.id('r1')), 'employee confirms the return');
select pg_temp.as_k('hr');
select public.hr_complete_asset_return(pg_temp.id('r1'), 'Back in cabinet A');
select test.ok((select status = 'available' and condition = 'fair' from public.hr_assets where id = pg_temp.id('lap1')), 'completion applies outcome: available, inspected condition');
select test.throws($q$select public.hr_cancel_asset_return(pg_temp.id('r1'), 'late')$q$, 'completed return cannot be cancelled', 'before the asset is received');
select test.as_owner();
select test.throws($q$update public.hr_asset_returns set outcome = 'retired' where id = pg_temp.id('r1')$q$, 'completed return immutable', 'cannot be changed');

-- ---- reassignment after return preserves history
select pg_temp.as_k('hr');
do $$ begin insert into t_ids values ('a1b', public.hr_assign_asset_v2(pg_temp.id('lap1'), pg_temp.id('emp2'), null, null, 1, 'Reallocation')); end $$;
select test.eq((select count(*) from public.hr_asset_assignments where asset_id = pg_temp.id('lap1')), 2::bigint, 'previous assignment kept on reassignment');
select test.ok((select status = 'returned' and employee_id = pg_temp.id('emp1') from public.hr_asset_assignments where id = pg_temp.id('a1')), 'historical assignment unchanged');

-- ---- return to repair, and bulk write-off
select pg_temp.as_k('emp2');
do $$ begin insert into t_ids values ('r2', public.hr_request_asset_return(pg_temp.id('a1b'), 'Keyboard keys stuck')); end $$;
select public.hr_cancel_asset_return(pg_temp.id('r2'));
select test.eq((select status from public.hr_asset_returns where id = pg_temp.id('r2')), 'cancelled', 'employee cancels own requested return');
select pg_temp.as_k('hr');
do $$ begin insert into t_ids values ('r3', public.hr_request_asset_return(pg_temp.id('a1b'), 'Keyboard keys stuck')); end $$;
select test.eq((select status from public.hr_asset_returns where id = pg_temp.id('r3')), 'pending_handover', 'HR-started return starts as Pending Handover');
select public.hr_receive_asset_return(pg_temp.id('r3'));
select public.hr_inspect_asset_return(pg_temp.id('r3'), 'damaged', 'in_repair', 'Keys stuck', null, 'keyboard_input', 'medium');
select test.ok((select damage_report_id is not null from public.hr_asset_returns where id = pg_temp.id('r3')), 'inspection raises a linked damage report');
select test.eq((select d.status from public.hr_asset_damage_reports d join public.hr_asset_returns r on r.damage_report_id = d.id where r.id = pg_temp.id('r3')),
               'under_review', 'inspection damage report starts Under Review');
select public.hr_complete_asset_return(pg_temp.id('r3'));
select test.eq((select status from public.hr_assets where id = pg_temp.id('lap1')), 'in_repair', 'completion with in_repair outcome moves asset to repair');

do $$ begin insert into t_ids values ('rh', public.hr_request_asset_return(pg_temp.id('ah'), 'Broken headsets')); end $$;
select public.hr_receive_asset_return(pg_temp.id('rh'));
select test.throws($q$select public.hr_inspect_asset_return(pg_temp.id('rh'), 'poor', 'in_repair')$q$, 'bulk items cannot go to repair', 'Quantity-tracked');
select test.throws($q$select public.hr_assign_asset_v2(pg_temp.id('head'), pg_temp.id('emp2'), null, null, 3)$q$, 'units awaiting inspection are not available', 'Only 2');
select public.hr_inspect_asset_return(pg_temp.id('rh'), 'poor', 'retired', 'Worn out');
select public.hr_complete_asset_return(pg_temp.id('rh'));
select test.ok((select quantity = 2 and status = 'available' from public.hr_assets where id = pg_temp.id('head')), 'bulk write-off reduces stock quantity');

-- =====================================================================
-- History
-- =====================================================================
select test.ok((select count(distinct event_type) >= 12 from public.hr_asset_events where asset_id = pg_temp.id('lap1')), 'chronological history covers the workflow');
select test.ok((select array_agg(event_type order by id) @> array['purchase','assignment','handover_acknowledged','handover_confirmed','damage',
                'damage_resolved','return_requested','return_received','return_inspected','return_completed']
                from public.hr_asset_events where asset_id = pg_temp.id('lap1')), 'history includes registration, handover, damage, return steps');
select test.as_owner();
select test.throws($q$update public.hr_asset_events set details = 'x' where asset_id = pg_temp.id('lap1')$q$, 'history entries cannot be edited', 'cannot be changed');
select test.throws($q$delete from public.hr_asset_events where asset_id = pg_temp.id('lap1')$q$, 'history entries cannot be deleted', 'cannot be changed');
select test.throws($q$delete from public.hr_asset_assignments where id = pg_temp.id('a1')$q$, 'assignments cannot be deleted', 'cannot be deleted');
select test.throws($q$delete from public.hr_assets where id = pg_temp.id('lap2')$q$, 'assets cannot be deleted', 'cannot be deleted');
select pg_temp.as_k('hr');
select public.hr_set_asset_status(pg_temp.id('lap2'), 'retired', 'End of life');
select test.ok(exists (select 1 from public.hr_asset_events where asset_id = pg_temp.id('lap2') and event_type = 'purchase'), 'history kept after retirement');
select pg_temp.as_k('emp1');
select test.ok((select count(*) > 0 and bool_and(assignment_id in (pg_temp.id('a1'), pg_temp.id('ah'))) from public.hr_asset_events),
               'employee history limited to own assignments');

-- =====================================================================
-- Overview
-- =====================================================================
select pg_temp.as_k('hr');
do $$ declare o jsonb; begin
  o := public.hr_asset_overview();
  perform test.eq((o ->> 'total_assets')::int, (select count(*)::int from public.hr_assets), 'overview total matches records');
  perform test.eq((o ->> 'under_repair')::int, (select count(*)::int from public.hr_assets where status = 'in_repair'), 'overview under repair matches');
  perform test.eq((o ->> 'assigned_assets')::int, (select count(distinct asset_id)::int from public.hr_asset_assignments where status = 'active'), 'overview assigned matches');
  perform test.eq((o ->> 'pending_handovers')::int, (select count(*)::int from public.hr_asset_handovers h join public.hr_asset_assignments x on x.id = h.assignment_id
                                                     where x.status = 'active' and h.status in ('pending_acknowledgement','acknowledged')), 'overview pending handovers matches');
  o := public.hr_asset_overview(p_category => 'Laptop');
  perform test.eq((o ->> 'total_assets')::int, (select count(*)::int from public.hr_assets where asset_type = 'Laptop'), 'category filter applied');
  o := public.hr_asset_overview(p_employee => pg_temp.id('emp2'));
  perform test.eq((o ->> 'assigned_assets')::int, 1, 'employee filter applied');
end $$;

-- ---- overdue returns
select test.as_owner();
select set_config('hr.asset_workflow', 'on', true);
update public.hr_asset_assignments set expected_return_date = current_date - 3 where id = pg_temp.id('am');
select set_config('hr.asset_workflow', 'off', true);
select pg_temp.as_k('hr');
select test.ok((public.hr_asset_overview() ->> 'overdue_returns')::int >= 1, 'overdue return counted');

-- =====================================================================
-- Exit clearance + onboarding
-- =====================================================================
select pg_temp.as_k('hr');
do $$ begin
  insert into t_ids values ('al', public.hr_assign_asset_v2(pg_temp.id('mon1'), pg_temp.id('leaver'), null, null, 1, 'Onboarding', array['HDMI cable']));
exception when others then
  -- mon1 is with emp2: use a fresh asset instead
  insert into public.hr_assets (asset_tag, asset_type, serial_number) values ('M11-MON-2', 'Monitor', 'M11-SN-4');
  insert into t_ids values ('al', public.hr_assign_asset_v2((select id from public.hr_assets where asset_tag = 'M11-MON-2'), pg_temp.id('leaver'),
                                                            null, null, 1, 'Onboarding', array['HDMI cable']));
end $$;
select test.eq((select handover_status from public.hr_employee_asset_handovers(pg_temp.id('leaver'))), 'pending_acknowledgement', 'onboarding sees pending handover');
select pg_temp.as_k('leaver');
select public.hr_acknowledge_asset(pg_temp.id('al'));
select test.eq((select handover_status from public.hr_employee_asset_handovers(pg_temp.id('leaver'))), 'acknowledged', 'onboarding sees acknowledged handover');
select test.as_owner();
insert into public.hr_exits (employee_id, initiated_by, exit_type, status, approved_last_working_day)
values (pg_temp.id('leaver'), 'hr', 'resignation', 'clearance', current_date + 10);
insert into t_ids select 'exit', id from public.hr_exits where employee_id = pg_temp.id('leaver');
select pg_temp.as_k('hr');
select test.ok(not (public.hr_employee_asset_clearance(pg_temp.id('leaver')) ->> 'all_returned')::boolean, 'clearance shows outstanding assets');
select test.throws($q$select public.hr_record_asset_clearance(pg_temp.id('leaver'), pg_temp.id('exit'))$q$, 'clearance refused while assets outstanding', 'still assigned');
select test.eq(public.hr_start_exit_asset_returns(pg_temp.id('leaver'), pg_temp.id('exit')), 1, 'exit generates the return checklist');
select test.eq(public.hr_start_exit_asset_returns(pg_temp.id('leaver'), pg_temp.id('exit')), 0, 'return checklist generation is idempotent');
do $$ begin insert into t_ids values ('rl', (select id from public.hr_asset_returns where employee_id = pg_temp.id('leaver') and status = 'pending_handover')); end $$;
select test.ok((select requested_return_date = current_date + 10 and source = 'exit' and exit_id = pg_temp.id('exit') from public.hr_asset_returns where id = pg_temp.id('rl')),
               'exit return due on last working day');
select public.hr_receive_asset_return(pg_temp.id('rl'), array[]::text[]);
select test.throws($q$select public.hr_record_asset_clearance(pg_temp.id('leaver'), pg_temp.id('exit'))$q$, 'clearance refused while return awaits inspection', 'awaiting return inspection');
select public.hr_inspect_asset_return(pg_temp.id('rl'), 'good', 'available');
select public.hr_complete_asset_return(pg_temp.id('rl'));
select test.ok((public.hr_employee_asset_clearance(pg_temp.id('leaver')) -> 'missing_accessories') @> '[{"missing":["HDMI cable"]}]'::jsonb, 'clearance lists missing accessories');
select test.throws($q$select public.hr_record_asset_clearance(pg_temp.id('leaver'), pg_temp.id('exit'))$q$, 'missing accessories must be acknowledged', 'Acknowledge');
select public.hr_record_asset_clearance(pg_temp.id('leaver'), pg_temp.id('exit'), 'HDMI cable not returned; handled per policy', true);
select test.ok((public.hr_employee_asset_clearance(pg_temp.id('leaver')) ->> 'cleared')::boolean, 'asset clearance recorded');
select test.eq(test.count_rows($q$select 1 from public.hr_employee_open_assets(pg_temp.id('leaver'))$q$), 0::bigint, 'no open assets after completed return');
select pg_temp.as_k('leaver');
select test.throws($q$select public.hr_record_asset_clearance(pg_temp.id('leaver'))$q$, 'employee cannot clear own assets', 'not allowed');

-- =====================================================================
-- Requests (new / replacement)
-- =====================================================================
select pg_temp.as_k('emp2');
select test.throws($q$select public.hr_request_asset('Laptop', 'Replace it', 'replacement', pg_temp.id('a1'))$q$, 'replacement must refer to own active asset', 'needs replacing');
do $$ begin insert into t_ids values ('rq', public.hr_request_asset('Monitor', 'Flickering display', 'replacement', pg_temp.id('am'))); end $$;
select test.ok((select request_kind = 'replacement' and replaces_assignment = pg_temp.id('am') from public.hr_asset_requests where id = pg_temp.id('rq')), 'replacement request recorded');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications where type = 'asset_request_submitted' and recipient_user_id = test.user_of(pg_temp.id('hr'))), 'asset managers notified of request');
select test.ok(exists (select 1 from public.hr_audit_log where table_name = 'hr_asset_returns'), 'returns are audited');
select test.ok(exists (select 1 from public.hr_audit_log where table_name = 'hr_asset_handovers'), 'handovers are audited');
select test.ok(exists (select 1 from public.hr_audit_log where table_name = 'hr_asset_damage_reports'), 'damage reports are audited');

-- ---- anon
select test.as_anon();
select test.throws($q$select * from public.hr_asset_overview()$q$, 'anon cannot call the overview', 'permission denied');
select test.throws($q$select 1 from public.hr_asset_returns$q$, 'anon cannot read returns', 'permission denied');
select test.as_owner();
