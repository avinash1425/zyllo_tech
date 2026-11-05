-- 143: setting / clearing purchase cost (synthetic, rolled back).
create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated, anon, service_role;
create function pg_temp.as_k(p_k text) returns void language plpgsql as $$
begin perform test.as_owner(); perform test.as_user(test.user_of((select v from t_ids where k = p_k))); end $$;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;
create function pg_temp.cost(p_tag text) returns numeric language sql security definer as $$
  select f.purchase_cost from public.hr_asset_financials f join public.hr_assets a on a.id = f.asset_id where a.asset_tag = p_tag $$;

do $$ begin
  insert into t_ids values ('hr',  test.make_employee('cost.hr@test.local', 'Cora', null, array['hr_admin']));
  insert into t_ids values ('emp', test.make_employee('cost.emp@test.local', 'Eli', null));
  insert into t_ids values ('it',  test.make_employee('cost.it@test.local', 'Ike', null, array['employee']));
end $$;
select test.as_owner();
insert into public.hr_roles (key, name, description, is_system) values ('test_it_cost', 'IT (test)', 'test', false);
insert into public.hr_role_permissions values ('test_it_cost', 'assets.view'), ('test_it_cost', 'assets.manage');
insert into public.hr_user_roles (user_id, role_key) values (test.user_of(pg_temp.id('it')), 'test_it_cost');

select pg_temp.as_k('hr');
insert into public.hr_assets (asset_tag, asset_type, purchase_cost) values ('COST-1', 'Laptop', 5000);
insert into public.hr_assets (asset_tag, asset_type) values ('COST-2', 'Monitor');
select test.as_owner();
insert into t_ids select 'c1', id from public.hr_assets where asset_tag = 'COST-1';
insert into t_ids select 'c2', id from public.hr_assets where asset_tag = 'COST-2';

-- existing behaviour preserved
select pg_temp.as_k('hr');
update public.hr_assets set notes = 'no cost in this update' where asset_tag = 'COST-1';
select test.eq(pg_temp.cost('COST-1'), 5000.00::numeric, 'omitting the cost keeps it');
update public.hr_assets set purchase_cost = null where asset_tag = 'COST-1';
select test.eq(pg_temp.cost('COST-1'), 5000.00::numeric, 'legacy NULL column write still never wipes a cost');

-- explicit set / clear
select public.hr_set_asset_cost(pg_temp.id('c1'), 4200);
select test.eq(pg_temp.cost('COST-1'), 4200.00::numeric, 'HR sets a new cost');
select public.hr_set_asset_cost(pg_temp.id('c1'), null);
select test.eq(pg_temp.cost('COST-1'), null::numeric, 'HR clears the cost');
select test.eq((select purchase_cost from public.hr_asset_costs(array[pg_temp.id('c1')])), null::numeric, 'cleared cost reads back as empty');
select public.hr_set_asset_cost(pg_temp.id('c2'), 0);
select test.eq(pg_temp.cost('COST-2'), 0.00::numeric, 'zero is a valid cost (distinct from cleared)');
select test.throws($q$select public.hr_set_asset_cost(pg_temp.id('c2'), -1)$q$, 'negative cost refused', 'zero or more');
select test.throws($q$select public.hr_set_asset_cost(gen_random_uuid(), 1)$q$, 'unknown asset refused', 'not found');
select test.eq((select count(*) from public.hr_assets where purchase_cost is not null), 0::bigint, 'hr_assets.purchase_cost still never holds a value');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_audit_log where table_name = 'hr_asset_financials' and action ilike 'update%'
                       and (old_data ->> 'purchase_cost') = '4200.00' and (new_data ->> 'purchase_cost') is null), 'clearing is audited');

-- permissions
select pg_temp.as_k('it');
select test.throws($q$select public.hr_set_asset_cost(pg_temp.id('c2'), 99)$q$, 'assets.manage without view_cost cannot set', 'not allowed');
select test.throws($q$select public.hr_set_asset_cost(pg_temp.id('c2'), null)$q$, 'assets.manage without view_cost cannot clear', 'not allowed');
select pg_temp.as_k('emp');
select test.throws($q$select public.hr_set_asset_cost(pg_temp.id('c2'), null)$q$, 'employee cannot clear', 'not allowed');
select test.as_anon();
select test.throws($q$select public.hr_set_asset_cost(gen_random_uuid(), null)$q$, 'anon cannot call', 'permission denied');
select test.as_owner();
select test.eq(pg_temp.cost('COST-2'), 0.00::numeric, 'refused calls changed nothing');
