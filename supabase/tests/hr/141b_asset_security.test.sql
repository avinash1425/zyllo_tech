-- Module 11 integration-readiness security checks (synthetic data, rolled back):
--   A. purchase cost is only reachable with assets.view_cost (no indirect path
--      through events, audit log, reports, overview or hr_assets);
--   B. an employee cannot reach another employee's assets, assignments,
--      handovers, damage reports, returns, document links, evidence documents,
--      document versions or stored files, and cannot act on them via RPCs.

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
  insert into t_ids values ('hr',    test.make_employee('sec.hr@test.local', 'Hedda', null, array['hr_admin']));
  insert into t_ids values ('it',    test.make_employee('sec.it@test.local', 'Ivan', null, array['employee']));
  insert into t_ids values ('mgr',   test.make_employee('sec.mgr@test.local', 'Mira', null, array['manager','employee']));
  insert into t_ids values ('alice', test.make_employee('sec.alice@test.local', 'Alice', (select v from t_ids where k = 'mgr')));
  insert into t_ids values ('bob',   test.make_employee('sec.bob@test.local', 'Bob', null));
end $$;
-- Proposed IT / Asset Manager role WITHOUT assets.view_cost.
select test.as_owner();
insert into public.hr_roles (key, name, description, is_system) values ('test_it_asset_manager', 'IT asset manager (test)', 'test', false);
insert into public.hr_role_permissions values ('test_it_asset_manager', 'assets.view'), ('test_it_asset_manager', 'assets.manage');
insert into public.hr_user_roles (user_id, role_key) values (test.user_of(pg_temp.id('it')), 'test_it_asset_manager');

-- ---- fixtures: HR registers with cost, assigns to Alice; Alice reports damage with evidence
select pg_temp.as_k('hr');
insert into public.hr_assets (asset_tag, asset_type, serial_number, purchase_cost) values ('SEC-LAP-1', 'Laptop', 'SEC-SN-1', 99000);
insert into public.hr_assets (asset_tag, asset_type) values ('SEC-LAP-2', 'Laptop');
select test.as_owner();
insert into t_ids select 'lap1', id from public.hr_assets where asset_tag = 'SEC-LAP-1';
insert into t_ids select 'lap2', id from public.hr_assets where asset_tag = 'SEC-LAP-2';
select pg_temp.as_k('hr');
update public.hr_assets set purchase_cost = 98000 where asset_tag = 'SEC-LAP-1';   -- cost change is audited
do $$ begin
  insert into t_ids values ('a1', public.hr_assign_asset_v2(pg_temp.id('lap1'), pg_temp.id('alice'), null, null, 1, 'Onboarding', array['Charger']));
  insert into t_ids values ('h1', (select id from public.hr_asset_handovers where assignment_id = pg_temp.id('a1')));
end $$;
select pg_temp.as_k('alice');
do $$ declare r jsonb; begin
  insert into t_ids values ('d1', public.hr_submit_asset_damage_report(pg_temp.id('a1'), null, current_date, 'screen', 'medium', 'Cracked corner'));
  r := public.hr_register_document_upload(pg_temp.id('alice'), 'asset_damage_evidence', 'Corner photo', 'corner.jpg', 'image/jpeg', 4096);
  insert into t_ids values ('doc', (r ->> 'document_id')::uuid);
  insert into t_ids values ('ver', (r ->> 'version_id')::uuid);
  perform public.hr_link_asset_document((r ->> 'document_id')::uuid, 'damage_evidence', pg_temp.id('d1'));
  insert into t_ids values ('r1', public.hr_request_asset_return(pg_temp.id('a1'), 'Going on sabbatical'));
end $$;
select test.as_owner();
create temp table t_paths as select storage_path from public.hr_document_versions where id = pg_temp.id('ver');
grant select on t_paths to authenticated;

-- =====================================================================
-- A. Purchase cost
-- =====================================================================
select test.eq((select purchase_cost from public.hr_asset_financials where asset_id = pg_temp.id('lap1')), 98000.00::numeric, 'cost (incl. later change) stored in hr_asset_financials');
select test.eq((select count(*) from public.hr_assets where purchase_cost is not null), 0::bigint, 'hr_assets.purchase_cost never holds a value');
select test.eq((select count(*) from public.hr_asset_events where cost is not null and event_type = 'purchase'), 0::bigint, 'registration events carry no cost');

select pg_temp.as_k('it');
select test.eq(test.count_rows('select 1 from public.hr_assets'), 2::bigint, 'IT asset manager sees the register');
select test.eq(test.count_rows('select 1 from public.hr_asset_financials'), 0::bigint, 'IT asset manager: no rows in hr_asset_financials');
select test.throws($q$select * from public.hr_asset_costs(array[pg_temp.id('lap1')])$q$, 'IT asset manager: cost RPC refused', 'not allowed');
select test.eq(test.count_rows('select 1 from public.hr_asset_events where cost is not null'), 0::bigint, 'IT asset manager: no cost via history events');
select test.eq(test.count_rows($q$select 1 from public.hr_audit_log where table_name in ('hr_assets','hr_asset_financials')$q$), 0::bigint, 'IT asset manager: no cost via audit log (audit.view required)');
select test.ok(public.hr_asset_overview()::text !~* 'cost', 'overview exposes no cost fields');
select test.throws($q$update public.hr_assets set purchase_cost = 1 where asset_tag = 'SEC-LAP-1'$q$, 'IT asset manager cannot change a cost', 'purchase cost');
select test.throws($q$insert into public.hr_assets (asset_tag, asset_type, purchase_cost) values ('SEC-LAP-9', 'Laptop', 5)$q$, 'IT asset manager cannot record a cost', 'purchase cost');
update public.hr_assets set notes = 'Re-imaged' where asset_tag = 'SEC-LAP-1';
select test.as_owner();
select test.eq((select purchase_cost from public.hr_asset_financials where asset_id = pg_temp.id('lap1')), 98000.00::numeric, 'master-data edit without cost permission keeps the cost');
select pg_temp.as_k('alice');
select test.eq(test.count_rows('select 1 from public.hr_asset_financials'), 0::bigint, 'employee: no cost rows');
select test.throws($q$select * from public.hr_asset_costs(array[pg_temp.id('lap1')])$q$, 'employee: cost RPC refused', 'not allowed');
select test.eq((select purchase_cost from public.hr_assets where id = pg_temp.id('lap1')), null::numeric, 'employee reading own asset gets no cost');
select pg_temp.as_k('hr');
select test.eq((select purchase_cost from public.hr_asset_costs(array[pg_temp.id('lap1')])), 98000.00::numeric, 'HR admin (assets.view_cost) reads the cost');
select test.as_anon();
select test.throws($q$select 1 from public.hr_asset_financials$q$, 'anon cannot touch hr_asset_financials', 'permission denied');

-- =====================================================================
-- B. Employee isolation (Bob vs Alice)
-- =====================================================================
select pg_temp.as_k('bob');
select test.eq(test.count_rows('select 1 from public.hr_assets'), 0::bigint, 'Bob sees no assets he never held');
select test.eq(test.count_rows('select 1 from public.hr_asset_assignments'), 0::bigint, 'Bob sees no assignments');
select test.eq(test.count_rows('select 1 from public.hr_asset_handovers'), 0::bigint, 'Bob sees no handovers');
select test.eq(test.count_rows('select 1 from public.hr_asset_damage_reports'), 0::bigint, 'Bob sees no damage reports');
select test.eq(test.count_rows('select 1 from public.hr_asset_returns'), 0::bigint, 'Bob sees no returns');
select test.eq(test.count_rows('select 1 from public.hr_asset_document_links'), 0::bigint, 'Bob sees no asset document links');
select test.eq(test.count_rows('select 1 from public.hr_asset_events'), 0::bigint, 'Bob sees no asset history');
select test.eq(test.count_rows('select 1 from public.hr_asset_clearances'), 0::bigint, 'Bob sees no clearances');
select test.eq(test.count_rows($q$select 1 from public.hr_documents where id = pg_temp.id('doc')$q$), 0::bigint, 'Bob cannot see Alice''s evidence document');
select test.eq(test.count_rows($q$select 1 from public.hr_document_versions where id = pg_temp.id('ver')$q$), 0::bigint, 'Bob cannot see the evidence file version');
select test.ok(not hr_private.document_can_read(pg_temp.id('doc')), 'document read check refuses Bob');
select test.ok(not hr_private.document_object_readable((select storage_path from t_paths)), 'storage read check refuses Bob for the evidence file');
select test.throws($q$select public.hr_acknowledge_asset_handover(pg_temp.id('h1'), '2026-11-v1')$q$, 'Bob cannot acknowledge Alice''s handover', 'not found');
select test.throws($q$select public.hr_acknowledge_asset(pg_temp.id('a1'))$q$, 'Bob cannot acknowledge Alice''s assignment', 'not found');
select test.throws($q$select public.hr_submit_asset_damage_report(pg_temp.id('a1'), null, current_date, 'screen', 'low', 'Not mine')$q$, 'Bob cannot report damage on Alice''s asset', 'not found');
select test.throws($q$select public.hr_update_asset_damage_report(pg_temp.id('d1'), current_date, 'screen', 'low', 'Tamper')$q$, 'Bob cannot edit Alice''s damage report', 'not found');
select test.throws($q$select public.hr_link_asset_document(pg_temp.id('doc'), 'damage_evidence', pg_temp.id('d1'))$q$, 'Bob cannot attach to Alice''s report', null);
select test.throws($q$select public.hr_request_asset_return(pg_temp.id('a1'), 'Not mine')$q$, 'Bob cannot request Alice''s return', 'not found');
select test.throws($q$select public.hr_cancel_asset_return(pg_temp.id('r1'))$q$, 'Bob cannot cancel Alice''s return', 'not found');
select test.throws($q$select public.hr_acknowledge_asset_return(pg_temp.id('r1'))$q$, 'Bob cannot confirm Alice''s return', 'not found');
select test.throws($q$select * from public.hr_employee_open_assets(pg_temp.id('alice'))$q$, 'Bob cannot list Alice''s open assets', 'not allowed');
select test.throws($q$select public.hr_employee_asset_clearance(pg_temp.id('alice'))$q$, 'Bob cannot read Alice''s clearance', 'not allowed');
select test.throws($q$select * from public.hr_employee_asset_handovers(pg_temp.id('alice'))$q$, 'Bob cannot read Alice''s handovers', 'not allowed');
do $$ declare r jsonb; begin
  r := public.hr_register_document_upload(pg_temp.id('bob'), 'asset_damage_evidence', 'Bob photo', 'b.jpg', 'image/jpeg', 100);
  insert into t_ids values ('bobdoc', (r ->> 'document_id')::uuid);
end $$;
select test.throws($q$select public.hr_link_asset_document(pg_temp.id('bobdoc'), 'damage_evidence', pg_temp.id('d1'))$q$, 'Bob cannot plant his file on Alice''s report', 'not allowed');
select test.throws($q$select public.hr_register_document_upload(pg_temp.id('alice'), 'asset_damage_evidence', 'x', 'x.jpg', 'image/jpeg', 100)$q$, 'Bob cannot upload evidence to Alice''s profile', 'own profile');

-- Alice still sees her own records; manager (no assets permission) sees none of the asset tables.
select pg_temp.as_k('alice');
select test.eq(test.count_rows('select 1 from public.hr_asset_handovers'), 1::bigint, 'Alice sees her handover');
select test.eq(test.count_rows('select 1 from public.hr_asset_damage_reports'), 1::bigint, 'Alice sees her damage report');
select test.eq(test.count_rows('select 1 from public.hr_asset_document_links'), 1::bigint, 'Alice sees her evidence link');
select test.ok(hr_private.document_can_read(pg_temp.id('doc')), 'Alice can read her evidence document');
select pg_temp.as_k('mgr');
select test.eq(test.count_rows('select 1 from public.hr_asset_assignments') + test.count_rows('select 1 from public.hr_asset_handovers')
               + test.count_rows('select 1 from public.hr_asset_damage_reports') + test.count_rows('select 1 from public.hr_asset_returns'), 0::bigint,
               'line manager without assets.view sees no asset records of the team');
select test.as_owner();
