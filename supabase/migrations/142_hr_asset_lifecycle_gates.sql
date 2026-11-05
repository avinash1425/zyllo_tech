-- =====================================================================
-- 142_hr_asset_lifecycle_gates.sql — Module 4 x Module 11 integration
-- =====================================================================
-- Depends on 130_hr_onboarding_exit.sql (Module 4: hr_onboarding_tasks,
-- hr_exit_clearance_items) and 141_hr_asset_allocation.sql (Module 11:
-- hr_asset_handovers, hr_asset_clearances, hr_asset_returns).
--
-- 130 is NOT modified and none of its functions are re-created: the rules
-- are row triggers on 130's tables, so they keep working when Module 4
-- changes its function bodies or helper schemas. Every 130 RPC that
-- completes these rows surfaces the error message unchanged.
--
--   * Onboarding: an 'asset' task linked to an asset assignment can only
--     become 'completed' after the joiner acknowledged the Module 11 handover
--     (or HR/IT confirmed it). Pre-141 assignments (no handover row) count if
--     the assignment's acknowledged_at is set. Unlinked asset tasks keep 130's
--     evidence-note rule; 'waived' is unaffected.
--   * Exit: the 'asset_return' clearance item can only become 'completed' or
--     'not_applicable' when nothing is held or awaiting return inspection and,
--     if the leaver ever held equipment, after an authorised asset clearance
--     (hr_record_asset_clearance) dated after the latest assignment.
--     'waived' (hr_grant_clearance_exception: exit.override, audited, already
--     refused by 130 while assets are open) is unaffected.
-- No data is changed. Apply ONLY to the local test cluster or the isolated
-- dev project.
-- =====================================================================

create or replace function hr_private.asset_onboarding_task_gate()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.task_kind = 'asset' and new.status = 'completed' and old.status is distinct from 'completed'
     and new.asset_assignment_id is not null
     and not exists (select 1 from public.hr_asset_handovers h
                      where h.assignment_id = new.asset_assignment_id and h.status in ('acknowledged','confirmed'))
     and not exists (select 1 from public.hr_asset_assignments a
                      where a.id = new.asset_assignment_id and a.acknowledged_at is not null
                        and not exists (select 1 from public.hr_asset_handovers h2 where h2.assignment_id = a.id)) then
    perform hr_private.fail('The joiner has not acknowledged the equipment handover yet.', 'handover_pending');
  end if;
  return new;
end $$;

create or replace function hr_private.asset_exit_clearance_gate()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_emp uuid;
begin
  if new.item_key <> 'asset_return' or new.status not in ('completed','not_applicable')
     or old.status is not distinct from new.status then
    return new;
  end if;
  select employee_id into v_emp from public.hr_exits where id = new.exit_id;
  if exists (select 1 from public.hr_asset_assignments x
              where x.employee_id = v_emp
                and (x.status = 'active'
                     or exists (select 1 from public.hr_asset_returns r
                                 where r.assignment_id = x.id and r.status in ('received','inspected')))) then
    perform hr_private.fail('Assets are still assigned or awaiting return inspection. Complete their returns in Assets first.', 'open_assets');
  end if;
  if exists (select 1 from public.hr_asset_assignments a0 where a0.employee_id = v_emp)
     and not exists (
       select 1 from public.hr_asset_clearances c
        where c.employee_id = v_emp
          and (c.exit_id = new.exit_id or c.exit_id is null)
          and c.cleared_at >= coalesce((select max(a.assigned_at) from public.hr_asset_assignments a
                                        where a.employee_id = v_emp), '-infinity')) then
    perform hr_private.fail('Record the asset clearance in Assets (missing or damaged items must be acknowledged) first.', 'asset_clearance_required');
  end if;
  return new;
end $$;

create trigger hr_onboarding_tasks_asset_gate before update of status on public.hr_onboarding_tasks
  for each row execute function hr_private.asset_onboarding_task_gate();
create trigger hr_exit_clearance_items_asset_gate before update of status on public.hr_exit_clearance_items
  for each row execute function hr_private.asset_exit_clearance_gate();

-- Trigger functions are never callable directly.
revoke execute on function hr_private.asset_onboarding_task_gate(), hr_private.asset_exit_clearance_gate()
  from anon, public, authenticated;
