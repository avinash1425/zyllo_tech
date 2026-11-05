-- 142: Module 4 exit clearance x Module 11 asset clearance (synthetic, rolled back).
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
select test.throws($q$select public.hr_complete_clearance_item(pg_temp.id('item'), 'completed', 'x')$q$, 'blocked while awaiting inspection', 'still assigned');
select public.hr_inspect_asset_return((select id from public.hr_asset_returns where assignment_id = pg_temp.id('a')), 'good', 'available');
select test.throws($q$select public.hr_complete_clearance_item(pg_temp.id('item'), 'completed', 'x')$q$, 'blocked while inspected but not completed', 'still assigned');
select public.hr_complete_asset_return((select id from public.hr_asset_returns where assignment_id = pg_temp.id('a')));
select test.throws($q$select public.hr_complete_clearance_item(pg_temp.id('item'), 'completed', 'x')$q$, 'blocked without asset-clearance sign-off', 'Record the asset clearance');
select test.throws($q$select public.hr_record_asset_clearance(pg_temp.id('lv'), pg_temp.id('x'))$q$, 'sign-off needs missing charger acknowledged', 'Acknowledge');
select public.hr_record_asset_clearance(pg_temp.id('lv'), pg_temp.id('x'), 'Charger not returned; per policy', true);
select public.hr_complete_clearance_item(pg_temp.id('item'), 'completed', 'All equipment returned');
select test.eq((select status from public.hr_exit_clearance_items where id = pg_temp.id('item')), 'completed', 'asset_return completes after inspection, completion and sign-off');

-- ---- table-level enforcement (independent of Module 4's RPC bodies)
select test.as_owner();
do $$ begin
  insert into t_ids values ('lv2', test.make_employee('g.lv2@test.local', 'Lia', null));
  insert into t_ids values ('nev', test.make_employee('g.nev@test.local', 'Ned', null));
end $$;
select pg_temp.as_k('hr');
insert into public.hr_assets (asset_tag, asset_type) values ('G-LAP-2', 'Laptop');
do $$ begin insert into t_ids values ('a2', public.hr_assign_asset_v2((select id from public.hr_assets where asset_tag='G-LAP-2'), pg_temp.id('lv2'))); end $$;
select test.as_owner();
insert into public.hr_exits (employee_id, initiated_by, exit_type, status) values (pg_temp.id('lv2'), 'hr', 'resignation', 'clearance'), (pg_temp.id('nev'), 'hr', 'resignation', 'clearance');
insert into public.hr_exit_clearance_items (exit_id, item_key, owner_role, sort_order, status)
  select id, 'asset_return', 'hr_admin', 1, 'pending' from public.hr_exits where employee_id in (pg_temp.id('lv2'), pg_temp.id('nev'));
insert into t_ids select 'i2', i.id from public.hr_exit_clearance_items i join public.hr_exits x on x.id = i.exit_id where x.employee_id = pg_temp.id('lv2');
insert into t_ids select 'inev', i.id from public.hr_exit_clearance_items i join public.hr_exits x on x.id = i.exit_id where x.employee_id = pg_temp.id('nev');
-- even the table owner cannot complete asset_return directly while equipment is held
select test.throws($q$update public.hr_exit_clearance_items set status = 'completed' where id = pg_temp.id('i2')$q$, 'direct completion refused while held (trigger)', 'still assigned');
select test.throws($q$update public.hr_exit_clearance_items set status = 'not_applicable' where id = pg_temp.id('i2')$q$, 'direct not-applicable refused while held (trigger)', 'still assigned');
update public.hr_exit_clearance_items set status = 'waived' where id = pg_temp.id('i2');
select test.eq((select status from public.hr_exit_clearance_items where id = pg_temp.id('i2')), 'waived', 'waived (audited exception path) is not blocked by 142');
update public.hr_exit_clearance_items set status = 'pending' where id = pg_temp.id('i2');
update public.hr_exit_clearance_items set status = 'completed' where id = pg_temp.id('inev');
select test.eq((select status from public.hr_exit_clearance_items where id = pg_temp.id('inev')), 'completed', 'leaver who never held equipment needs no asset sign-off');
-- returned and completed, but no sign-off: still refused directly
select pg_temp.as_k('hr');
select public.hr_return_asset(pg_temp.id('a2'), 'good');
select test.as_owner();
select test.throws($q$update public.hr_exit_clearance_items set status = 'completed' where id = pg_temp.id('i2')$q$, 'direct completion refused without sign-off (trigger)', 'Record the asset clearance');
-- other clearance items are untouched by 142
insert into public.hr_exit_clearance_items (exit_id, item_key, owner_role, sort_order, status)
  select exit_id, 'hr_clearance', 'hr_admin', 2, 'pending' from public.hr_exit_clearance_items where id = pg_temp.id('i2');
update public.hr_exit_clearance_items set status = 'completed'
 where item_key = 'hr_clearance' and exit_id = (select exit_id from public.hr_exit_clearance_items where id = pg_temp.id('i2'));
select test.eq((select status from public.hr_exit_clearance_items where item_key = 'hr_clearance' and exit_id = (select exit_id from public.hr_exit_clearance_items where id = pg_temp.id('i2'))),
               'completed', 'non-asset clearance items are not gated');

-- ---- onboarding gate at table level
select pg_temp.as_k('hr');
insert into public.hr_assets (asset_tag, asset_type) values ('G-LAP-3', 'Laptop');
do $$ begin insert into t_ids values ('a3', public.hr_assign_asset_v2((select id from public.hr_assets where asset_tag='G-LAP-3'), pg_temp.id('nev'))); end $$;
select test.as_owner();
create temp table t_task as select gen_random_uuid() id;
do $$ declare c uuid; begin
  insert into public.hr_onboarding_cases (employee_id, status) values (pg_temp.id('nev'), 'open') returning id into c;
  insert into public.hr_onboarding_tasks (id, case_id, title, task_kind, status, asset_assignment_id)
    values ((select id from t_task), c, 'Equipment allocation', 'asset', 'in_progress', pg_temp.id('a3'));
exception when others then raise notice 'onboarding fixture: %', sqlerrm; end $$;
select test.ok(exists (select 1 from public.hr_onboarding_tasks where id = (select id from t_task)), 'onboarding fixture created');
select test.throws($q$update public.hr_onboarding_tasks set status = 'completed' where id = (select id from t_task)$q$, 'asset task cannot complete before acknowledgement (trigger)', 'not acknowledged the equipment handover');
update public.hr_onboarding_tasks set status = 'waived' where id = (select id from t_task);
select test.eq((select status from public.hr_onboarding_tasks where id = (select id from t_task)), 'waived', 'waiving an asset task is not blocked');
update public.hr_onboarding_tasks set status = 'in_progress' where id = (select id from t_task);
select pg_temp.as_k('nev');
select public.hr_acknowledge_asset(pg_temp.id('a3'));
select test.as_owner();
update public.hr_onboarding_tasks set status = 'completed' where id = (select id from t_task);
select test.eq((select status from public.hr_onboarding_tasks where id = (select id from t_task)), 'completed', 'asset task completes after the handover is acknowledged');
