-- For Module 4: add to supabase/tests/hr/ (e.g. as part of 130_onboarding_exit.test.sql or a test numbered after the
-- migration that applies the §5 patch). Validated in a scratch copy with 129 + 130(patched) + 141: 6/6 pass.
-- SCRATCH ONLY: validates the proposed M4 patches (doc §4, §5) with 141.
create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated, anon, service_role;
create function pg_temp.as_k(p_k text) returns void language plpgsql as $$
begin perform test.as_owner(); perform test.as_user(test.user_of((select v from t_ids where k = p_k))); end $$;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;
do $$ begin
  insert into t_ids values ('hr', test.make_employee('g.hr@test.local', 'Gia', null, array['hr_admin','employee']));
  insert into t_ids values ('hr2', test.make_employee('g.hr2@test.local', 'Gus', null, array['hr_admin','employee']));
  insert into t_ids values ('lv', test.make_employee('g.lv@test.local', 'Leo', null));
end $$;
select pg_temp.as_k('hr');
insert into public.hr_assets (asset_tag, asset_type) values ('G-LAP-1', 'Laptop');
do $$ begin insert into t_ids values ('a', public.hr_assign_asset_v2((select id from public.hr_assets where asset_tag='G-LAP-1'), pg_temp.id('lv'), null, null, 1, null, array['Charger'])); end $$;
-- exit case straight into clearance (owner inserts, then items via M4 RPC path is out of scope: use direct item rows)
select test.as_owner();
insert into public.hr_exits (employee_id, initiated_by, exit_type, status, approved_last_working_day) values (pg_temp.id('lv'), 'hr', 'resignation', 'clearance', current_date + 5);
insert into t_ids select 'x', id from public.hr_exits where employee_id = pg_temp.id('lv');
insert into public.hr_exit_clearance_items (exit_id, item_key, owner_role, sort_order, status)
  select pg_temp.id('x'), 'asset_return', 'hr_admin', 1, 'pending';
insert into t_ids select 'item', id from public.hr_exit_clearance_items where exit_id = pg_temp.id('x') and item_key = 'asset_return';
select pg_temp.as_k('hr');
select test.throws($q$select public.hr_complete_clearance_item(pg_temp.id('item'), 'completed', 'x')$q$, 'blocked while asset held', 'still assigned');
select public.hr_start_exit_asset_returns(pg_temp.id('lv'), pg_temp.id('x'));
select public.hr_receive_asset_return((select id from public.hr_asset_returns where assignment_id = pg_temp.id('a') and status = 'pending_handover'), array[]::text[]);
select test.throws($q$select public.hr_complete_clearance_item(pg_temp.id('item'), 'completed', 'x')$q$, 'blocked while awaiting inspection', 'awaiting return inspection');
select public.hr_inspect_asset_return((select id from public.hr_asset_returns where assignment_id = pg_temp.id('a')), 'good', 'available');
select test.throws($q$select public.hr_complete_clearance_item(pg_temp.id('item'), 'completed', 'x')$q$, 'blocked while inspected but not completed', 'awaiting return inspection');
select public.hr_complete_asset_return((select id from public.hr_asset_returns where assignment_id = pg_temp.id('a')));
select test.throws($q$select public.hr_complete_clearance_item(pg_temp.id('item'), 'completed', 'x')$q$, 'blocked without asset-clearance sign-off', 'Record the asset clearance');
select test.throws($q$select public.hr_record_asset_clearance(pg_temp.id('lv'), pg_temp.id('x'))$q$, 'sign-off needs missing charger acknowledged', 'Acknowledge');
select public.hr_record_asset_clearance(pg_temp.id('lv'), pg_temp.id('x'), 'Charger not returned; per policy', true);
select public.hr_complete_clearance_item(pg_temp.id('item'), 'completed', 'All equipment returned');
select test.eq((select status from public.hr_exit_clearance_items where id = pg_temp.id('item')), 'completed', 'asset_return completes after inspection, completion and sign-off');
