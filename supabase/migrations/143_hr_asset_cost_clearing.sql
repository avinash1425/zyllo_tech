-- =====================================================================
-- 143_hr_asset_cost_clearing.sql — Module 11: set or clear purchase cost
-- =====================================================================
-- Depends on 141_hr_asset_allocation.sql. Does not modify 141.
--
-- Why: writes to hr_assets.purchase_cost are redirected to
-- hr_asset_financials by the hr_assets_cost_split trigger, which can only
-- act on non-null values — an UPDATE that sets the column to NULL is
-- indistinguishable from one that does not mention it (the column always
-- reads NULL). Clearing a cost therefore needs an explicit call.
--
-- hr_set_asset_cost(asset, cost): assets.view_cost only; cost >= 0, or NULL
-- to clear. The financial row is kept (with NULL) so the audit log shows
-- the change. The legacy column write path (insert / update with a value)
-- is unchanged.
-- Apply ONLY to the local test cluster or the isolated dev project.
-- =====================================================================

create or replace function public.hr_set_asset_cost(p_asset uuid, p_cost numeric)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not hr_private.has_permission('assets.view_cost') then
    perform hr_private.fail('You are not allowed to change asset purchase costs.', 'forbidden');
  end if;
  if p_cost is not null and p_cost < 0 then
    perform hr_private.fail('Cost must be zero or more.', 'invalid');
  end if;
  if p_cost is not null and p_cost >= 10000000000 then
    perform hr_private.fail('Cost is too large.', 'invalid');
  end if;
  perform 1 from public.hr_assets where id = p_asset for update;
  if not found then perform hr_private.fail('Asset not found.', 'not_found'); end if;
  insert into public.hr_asset_financials (asset_id, purchase_cost, updated_by)
  values (p_asset, p_cost, auth.uid())
  on conflict (asset_id) do update
    set purchase_cost = excluded.purchase_cost, updated_by = excluded.updated_by, updated_at = now()
  where public.hr_asset_financials.purchase_cost is distinct from excluded.purchase_cost;
end $$;

revoke execute on function public.hr_set_asset_cost(uuid, numeric) from anon, public;
grant execute on function public.hr_set_asset_cost(uuid, numeric) to authenticated;
