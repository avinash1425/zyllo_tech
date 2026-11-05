-- =====================================================================
-- 109_hr_assets.sql — Asset inventory, assignments, maintenance history
--                      and employee asset requests
-- =====================================================================
-- Depends on 100_hr_foundation.sql.
--
-- Writes:
--   * hr_assets master data (tag, brand, model, cost, notes, ...) may be
--     inserted/updated directly by assets.manage holders, but status and
--     bulk/quantity consistency are guarded: status changes go through the
--     RPCs (assign / transfer / return / maintenance / set status).
--   * assignments, events and requests are RPC-only.
-- Reads: assets.view / assets.manage see everything; an employee sees their
-- own assignments, the assets they hold or held, and those events.
-- Apply ONLY to the local test cluster or the isolated dev project.
-- =====================================================================

create table public.hr_assets (
  id              uuid primary key default gen_random_uuid(),
  asset_tag       text not null unique check (asset_tag ~ '^[A-Za-z0-9][A-Za-z0-9_./-]{1,39}$'),
  asset_type      text not null check (length(btrim(asset_type)) between 2 and 60),
  category        text check (category is null or length(category) <= 60),
  brand           text check (brand is null or length(brand) <= 80),
  model           text check (model is null or length(model) <= 120),
  serial_number   text unique check (serial_number is null or length(btrim(serial_number)) between 1 and 120),
  purchase_date   date,
  purchase_cost   numeric(12,2) check (purchase_cost is null or purchase_cost >= 0),
  warranty_expiry date,
  status          text not null default 'available'
                  check (status in ('available','assigned','in_repair','retired','lost','disposed')),
  condition       text not null default 'new' check (condition in ('new','good','fair','poor','damaged')),
  location_id     uuid references public.hr_locations(id) on delete restrict,
  notes           text check (notes is null or length(notes) <= 2000),
  is_bulk         boolean not null default false,
  quantity        int not null default 1 check (quantity >= 1),
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (is_bulk or quantity = 1),
  check (warranty_expiry is null or purchase_date is null or warranty_expiry >= purchase_date)
);
create index hr_assets_status on public.hr_assets(status);

create table public.hr_asset_assignments (
  id                   uuid primary key default gen_random_uuid(),
  asset_id             uuid not null references public.hr_assets(id) on delete restrict,
  employee_id          uuid not null references public.hr_employees(id) on delete restrict,
  is_bulk              boolean not null default false,       -- copied from the asset at assignment time
  quantity             int not null default 1 check (quantity >= 1),
  assigned_at          timestamptz not null default now(),
  assigned_by          uuid,
  expected_return_date date,
  returned_at          timestamptz,
  return_condition     text check (return_condition is null or return_condition in ('new','good','fair','poor','damaged')),
  return_notes         text check (return_notes is null or length(return_notes) <= 2000),
  acknowledged_at      timestamptz,
  status               text not null default 'active' check (status in ('active','returned','lost')),
  notes                text check (notes is null or length(notes) <= 2000),
  transferred_from     uuid references public.hr_asset_assignments(id) on delete restrict,
  check (status <> 'returned' or returned_at is not null),
  check (is_bulk or quantity = 1)
);
-- At most one active assignment per individually tracked asset.
create unique index hr_asset_assignments_one_active on public.hr_asset_assignments(asset_id)
  where status = 'active' and not is_bulk;
create index hr_asset_assignments_employee on public.hr_asset_assignments(employee_id, status);
create index hr_asset_assignments_asset on public.hr_asset_assignments(asset_id, status);

create table public.hr_asset_events (
  id            bigint generated always as identity primary key,
  asset_id      uuid not null references public.hr_assets(id) on delete restrict,
  assignment_id uuid references public.hr_asset_assignments(id) on delete restrict,
  employee_id   uuid references public.hr_employees(id) on delete restrict,
  event_type    text not null check (event_type in ('purchase','assignment','transfer','return','damage','maintenance',
                                                    'repair_complete','retire','lost','dispose','status_change')),
  details       text check (details is null or length(details) <= 2000),
  cost          numeric(12,2) check (cost is null or cost >= 0),
  occurred_at   timestamptz not null default now(),
  recorded_by   uuid
);
create index hr_asset_events_asset on public.hr_asset_events(asset_id, occurred_at desc);

create table public.hr_asset_requests (
  id                   uuid primary key default gen_random_uuid(),
  employee_id          uuid not null references public.hr_employees(id) on delete restrict,
  asset_type           text not null check (length(btrim(asset_type)) between 2 and 60),
  reason               text not null check (length(btrim(reason)) between 3 and 2000),
  status               text not null default 'pending' check (status in ('pending','approved','rejected','fulfilled','cancelled')),
  decided_by           uuid,
  decided_at           timestamptz,
  decision_note        text check (decision_note is null or length(decision_note) <= 2000),
  fulfilled_assignment uuid references public.hr_asset_assignments(id) on delete restrict,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index hr_asset_requests_employee on public.hr_asset_requests(employee_id, status);

create trigger hr_assets_touch before update on public.hr_assets
  for each row execute function hr_private.touch_updated_at();
create trigger hr_asset_requests_touch before update on public.hr_asset_requests
  for each row execute function hr_private.touch_updated_at();

-- ---------------------------------------------------------------------
-- Guards & helpers
-- ---------------------------------------------------------------------
-- Direct client writes may edit master data, but not the workflow state.
create or replace function hr_private.assets_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_used int;
begin
  if current_setting('hr.asset_workflow', true) = 'on' or auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status not in ('available','in_repair') then
      perform hr_private.fail('New assets start as available or in repair.', 'use_asset_workflow');
    end if;
    new.created_by := auth.uid();
    return new;
  end if;
  if new.status is distinct from old.status then
    perform hr_private.fail('Asset status changes go through the asset workflow (assign, return, maintenance, retire).', 'use_asset_workflow');
  end if;
  select coalesce(sum(quantity), 0) into v_used from public.hr_asset_assignments where asset_id = old.id and status = 'active';
  if new.is_bulk is distinct from old.is_bulk and v_used > 0 then
    perform hr_private.fail('Bulk mode cannot be changed while the asset is assigned.', 'invalid_state');
  end if;
  if new.quantity < v_used then
    perform hr_private.fail(format('Quantity cannot be lower than the %s currently assigned.', v_used), 'invalid_quantity');
  end if;
  return new;
end $$;
create trigger hr_assets_guard before insert or update on public.hr_assets
  for each row execute function hr_private.assets_guard();

create or replace function hr_private.assets_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.hr_asset_events (asset_id, event_type, details, cost, occurred_at, recorded_by)
  values (new.id, 'purchase', 'Asset registered' || coalesce(' (purchased ' || to_char(new.purchase_date, 'DD Mon YYYY') || ')', ''),
          new.purchase_cost, now(), auth.uid());
  return new;
end $$;
create trigger hr_assets_after_insert after insert on public.hr_assets
  for each row execute function hr_private.assets_after_insert();

-- 'assigned' when fully allocated, otherwise 'available'.
create or replace function hr_private.asset_occupancy_status(p_asset uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case when coalesce((select sum(x.quantity) from public.hr_asset_assignments x
                             where x.asset_id = a.id and x.status = 'active'), 0) >= a.quantity
              then 'assigned' else 'available' end
  from public.hr_assets a where a.id = p_asset
$$;

-- Workflow-only update of status / condition.
create or replace function hr_private.asset_set_state(p_asset uuid, p_status text, p_condition text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('hr.asset_workflow', 'on', true);
  update public.hr_assets set status = coalesce(p_status, status), condition = coalesce(p_condition, condition) where id = p_asset;
  perform set_config('hr.asset_workflow', 'off', true);
end $$;

create or replace function hr_private.asset_is_mine(p_asset uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select hr_private.current_employee_id() is not null and exists (
    select 1 from public.hr_asset_assignments x where x.asset_id = p_asset and x.employee_id = hr_private.current_employee_id())
$$;

create or replace function hr_private.asset_assignment_is_mine(p_assignment uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_assignment is not null and hr_private.current_employee_id() is not null and exists (
    select 1 from public.hr_asset_assignments x where x.id = p_assignment and x.employee_id = hr_private.current_employee_id())
$$;

create or replace function hr_private.asset_require_manage()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not hr_private.has_permission('assets.manage') then
    perform hr_private.fail('You are not allowed to manage assets.', 'forbidden');
  end if;
end $$;

-- Core assignment (permission checks are done by the callers).
create or replace function hr_private.asset_assign(p_asset uuid, p_employee uuid, p_expected_return date, p_notes text,
                                                   p_quantity int, p_transferred_from uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_asset public.hr_assets;
  v_emp   public.hr_employees;
  v_qty   int := coalesce(p_quantity, 1);
  v_used  int;
  v_id    uuid;
begin
  select * into v_asset from public.hr_assets where id = p_asset for update;
  if v_asset.id is null then perform hr_private.fail('Asset not found.', 'not_found'); end if;
  if v_asset.status in ('retired','lost','disposed','in_repair') then
    perform hr_private.fail(format('This asset cannot be assigned while it is %s.', replace(v_asset.status, '_', ' ')), 'asset_unavailable');
  end if;
  select * into v_emp from public.hr_employees where id = p_employee;
  if v_emp.id is null or v_emp.status in ('exited','archived','suspended') then
    perform hr_private.fail('Assets can only be assigned to current employees.', 'invalid_employee');
  end if;
  if v_qty < 1 then perform hr_private.fail('Quantity must be at least 1.', 'invalid_quantity'); end if;
  if p_expected_return is not null and p_expected_return < hr_private.business_today() then
    perform hr_private.fail('The expected return date is in the past.', 'invalid_date');
  end if;
  select coalesce(sum(quantity), 0) into v_used from public.hr_asset_assignments where asset_id = p_asset and status = 'active';
  if not v_asset.is_bulk then
    if v_qty <> 1 then perform hr_private.fail('Individually tracked assets are assigned one at a time.', 'invalid_quantity'); end if;
    if v_used > 0 then perform hr_private.fail('This asset is already assigned.', 'already_assigned'); end if;
  elsif v_used + v_qty > v_asset.quantity then
    perform hr_private.fail(format('Only %s of this item are available.', v_asset.quantity - v_used), 'insufficient_quantity');
  end if;

  insert into public.hr_asset_assignments (asset_id, employee_id, is_bulk, quantity, assigned_by, expected_return_date, notes, transferred_from)
  values (p_asset, p_employee, v_asset.is_bulk, v_qty, auth.uid(), p_expected_return, nullif(btrim(p_notes), ''), p_transferred_from)
  returning id into v_id;
  perform hr_private.asset_set_state(p_asset, hr_private.asset_occupancy_status(p_asset));
  if p_transferred_from is null then
    insert into public.hr_asset_events (asset_id, assignment_id, employee_id, event_type, details, recorded_by)
    values (p_asset, v_id, p_employee, 'assignment', nullif(btrim(p_notes), ''), auth.uid());
  end if;
  perform hr_private.notify_employee(p_employee, 'asset_assigned', 'Asset assigned to you',
    coalesce(v_asset.brand || ' ', '') || coalesce(v_asset.model || ' ', '') || '(' || v_asset.asset_tag || ')'
      || case when v_qty > 1 then ' x' || v_qty else '' end || '. Please acknowledge receipt.',
    '/employee/assets', 'hr_asset_assignment', v_id::text);
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
select hr_private.secure_table('public.hr_assets');
select hr_private.secure_table('public.hr_asset_assignments');
select hr_private.secure_table('public.hr_asset_events');
select hr_private.secure_table('public.hr_asset_requests');

create policy hr_assets_read on public.hr_assets for select to authenticated
  using (hr_private.has_permission('assets.view') or hr_private.has_permission('assets.manage') or hr_private.asset_is_mine(id));
create policy hr_assets_insert on public.hr_assets for insert to authenticated
  with check (hr_private.has_permission('assets.manage'));
create policy hr_assets_update on public.hr_assets for update to authenticated
  using (hr_private.has_permission('assets.manage')) with check (hr_private.has_permission('assets.manage'));
-- No delete: assets are retired / disposed, history is kept.

create policy hr_asset_assignments_read on public.hr_asset_assignments for select to authenticated
  using (employee_id = hr_private.current_employee_id()
         or hr_private.has_permission('assets.view') or hr_private.has_permission('assets.manage'));

create policy hr_asset_events_read on public.hr_asset_events for select to authenticated
  using (hr_private.has_permission('assets.view') or hr_private.has_permission('assets.manage')
         or hr_private.asset_assignment_is_mine(assignment_id));

create policy hr_asset_requests_read on public.hr_asset_requests for select to authenticated
  using (employee_id = hr_private.current_employee_id()
         or hr_private.has_permission('assets.view') or hr_private.has_permission('assets.manage'));

select hr_private.enable_audit('public.hr_assets');
select hr_private.enable_audit('public.hr_asset_assignments');
select hr_private.enable_audit('public.hr_asset_requests');

-- ---------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------
create or replace function public.hr_assign_asset(p_asset uuid, p_employee uuid, p_expected_return date default null,
                                                  p_notes text default null, p_quantity int default 1)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform hr_private.asset_require_manage();
  return hr_private.asset_assign(p_asset, p_employee, p_expected_return, p_notes, p_quantity, null);
end $$;

create or replace function public.hr_transfer_asset(p_assignment uuid, p_to_employee uuid, p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_asg public.hr_asset_assignments; v_asset public.hr_assets; v_new uuid; v_from text; v_to text;
begin
  perform hr_private.asset_require_manage();
  select * into v_asg from public.hr_asset_assignments where id = p_assignment for update;
  if v_asg.id is null then perform hr_private.fail('Assignment not found.', 'not_found'); end if;
  if v_asg.status <> 'active' then perform hr_private.fail('Only active assignments can be transferred.', 'invalid_state'); end if;
  if v_asg.employee_id = p_to_employee then perform hr_private.fail('The asset is already with this employee.', 'invalid'); end if;
  select * into v_asset from public.hr_assets where id = v_asg.asset_id for update;
  select employee_code into v_from from public.hr_employees where id = v_asg.employee_id;
  select employee_code into v_to from public.hr_employees where id = p_to_employee;

  update public.hr_asset_assignments
     set status = 'returned', returned_at = now(), return_condition = v_asset.condition,
         return_notes = 'Transferred to ' || coalesce(v_to, 'another employee')
   where id = v_asg.id;
  perform hr_private.asset_set_state(v_asset.id, hr_private.asset_occupancy_status(v_asset.id));
  v_new := hr_private.asset_assign(v_asset.id, p_to_employee,
             case when v_asg.expected_return_date >= hr_private.business_today() then v_asg.expected_return_date end,
             p_notes, v_asg.quantity, v_asg.id);
  insert into public.hr_asset_events (asset_id, assignment_id, employee_id, event_type, details, recorded_by)
  values (v_asset.id, v_new, p_to_employee, 'transfer',
          'From ' || coalesce(v_from, '?') || ' to ' || coalesce(v_to, '?') || coalesce(': ' || nullif(btrim(p_notes), ''), ''), auth.uid());
  perform hr_private.notify_employee(v_asg.employee_id, 'asset_transferred', 'Asset transferred',
    v_asset.asset_tag || ' has been transferred to a colleague.', '/employee/assets', 'hr_asset_assignment', v_asg.id::text);
  return v_new;
end $$;

create or replace function public.hr_return_asset(p_assignment uuid, p_condition text, p_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_asg public.hr_asset_assignments; v_asset public.hr_assets; v_status text;
begin
  perform hr_private.asset_require_manage();
  if p_condition is null or p_condition not in ('new','good','fair','poor','damaged') then
    perform hr_private.fail('Record the condition of the returned asset.', 'invalid_condition');
  end if;
  select * into v_asg from public.hr_asset_assignments where id = p_assignment for update;
  if v_asg.id is null then perform hr_private.fail('Assignment not found.', 'not_found'); end if;
  if v_asg.status <> 'active' then perform hr_private.fail('This assignment is already closed.', 'invalid_state'); end if;
  select * into v_asset from public.hr_assets where id = v_asg.asset_id for update;

  update public.hr_asset_assignments
     set status = 'returned', returned_at = now(), return_condition = p_condition, return_notes = nullif(btrim(p_notes), '')
   where id = v_asg.id;
  v_status := hr_private.asset_occupancy_status(v_asset.id);
  if p_condition = 'damaged' and not v_asset.is_bulk then v_status := 'in_repair'; end if;
  perform hr_private.asset_set_state(v_asset.id, v_status, case when v_asset.is_bulk then null else p_condition end);
  insert into public.hr_asset_events (asset_id, assignment_id, employee_id, event_type, details, recorded_by)
  values (v_asset.id, v_asg.id, v_asg.employee_id, 'return',
          'Returned in ' || p_condition || ' condition' || coalesce(': ' || nullif(btrim(p_notes), ''), ''), auth.uid());
  perform hr_private.notify_employee(v_asg.employee_id, 'asset_returned', 'Asset return recorded',
    v_asset.asset_tag || ' has been checked in.', '/employee/assets', 'hr_asset_assignment', v_asg.id::text);
end $$;

-- Damage report: the assignee on their own active assignment, or HR on any
-- assignment / asset. Pass either p_assignment or p_asset.
create or replace function public.hr_report_asset_damage(p_assignment uuid, p_asset uuid, p_details text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_asg public.hr_asset_assignments; v_asset_id uuid := p_asset; v_emp uuid; v_id bigint;
        v_is_hr boolean := hr_private.has_permission('assets.manage');
begin
  if nullif(btrim(p_details), '') is null then perform hr_private.fail('Describe the damage.', 'details_required'); end if;
  if p_assignment is not null then
    select * into v_asg from public.hr_asset_assignments where id = p_assignment;
    if v_asg.id is null or not (v_is_hr or v_asg.employee_id = hr_private.current_employee_id()) then
      perform hr_private.fail('Assignment not found.', 'not_found');
    end if;
    if v_asg.status <> 'active' and not v_is_hr then
      perform hr_private.fail('You can only report damage on an asset currently assigned to you.', 'invalid_state');
    end if;
    v_asset_id := v_asg.asset_id;
    v_emp := v_asg.employee_id;
  elsif not v_is_hr then
    perform hr_private.fail('You are not allowed to manage assets.', 'forbidden');
  end if;
  perform 1 from public.hr_assets where id = v_asset_id for update;
  if not found then perform hr_private.fail('Asset not found.', 'not_found'); end if;
  perform hr_private.asset_set_state(v_asset_id, null, 'damaged');
  insert into public.hr_asset_events (asset_id, assignment_id, employee_id, event_type, details, recorded_by)
  values (v_asset_id, v_asg.id, v_emp, 'damage', btrim(p_details), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Maintenance log. p_complete = false: work started / logged (an available
-- asset goes to in_repair). p_complete = true: repair completed (in_repair
-- asset returns to available/assigned; condition updated).
create or replace function public.hr_log_asset_maintenance(p_asset uuid, p_details text, p_cost numeric default null,
                                                           p_complete boolean default false, p_condition text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_asset public.hr_assets; v_id bigint; v_status text; v_cond text;
begin
  perform hr_private.asset_require_manage();
  if nullif(btrim(p_details), '') is null then perform hr_private.fail('Describe the maintenance work.', 'details_required'); end if;
  if p_cost is not null and p_cost < 0 then perform hr_private.fail('Cost cannot be negative.', 'invalid'); end if;
  if p_condition is not null and p_condition not in ('new','good','fair','poor','damaged') then
    perform hr_private.fail('Unknown condition.', 'invalid_condition');
  end if;
  select * into v_asset from public.hr_assets where id = p_asset for update;
  if v_asset.id is null then perform hr_private.fail('Asset not found.', 'not_found'); end if;
  if v_asset.status in ('retired','lost','disposed') then
    perform hr_private.fail('Maintenance cannot be logged for a retired, lost or disposed asset.', 'invalid_state');
  end if;
  if coalesce(p_complete, false) then
    v_status := case when v_asset.status = 'in_repair' then hr_private.asset_occupancy_status(v_asset.id) else v_asset.status end;
    v_cond := coalesce(p_condition, case when v_asset.condition = 'damaged' then 'good' else v_asset.condition end);
  else
    v_status := case when v_asset.status = 'available' then 'in_repair' else v_asset.status end;
    v_cond := coalesce(p_condition, v_asset.condition);
  end if;
  perform hr_private.asset_set_state(v_asset.id, v_status, v_cond);
  insert into public.hr_asset_events (asset_id, event_type, details, cost, recorded_by)
  values (v_asset.id, case when coalesce(p_complete, false) then 'repair_complete' else 'maintenance' end, btrim(p_details), p_cost, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Retire / lose / dispose / bring back an asset.
create or replace function public.hr_set_asset_status(p_asset uuid, p_status text, p_details text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_asset public.hr_assets; v_active int; v_asg public.hr_asset_assignments;
begin
  perform hr_private.asset_require_manage();
  if p_status is null or p_status not in ('available','retired','lost','disposed') then
    perform hr_private.fail('Status must be available, retired, lost or disposed.', 'invalid_status');
  end if;
  select * into v_asset from public.hr_assets where id = p_asset for update;
  if v_asset.id is null then perform hr_private.fail('Asset not found.', 'not_found'); end if;
  if v_asset.status = p_status then return; end if;
  select count(*) into v_active from public.hr_asset_assignments where asset_id = v_asset.id and status = 'active';
  if p_status in ('retired','disposed') and v_active > 0 then
    perform hr_private.fail('Record the return of this asset before retiring or disposing of it.', 'asset_assigned');
  end if;
  if p_status = 'lost' and v_active > 0 then
    if v_asset.is_bulk then
      perform hr_private.fail('Record returns for bulk items before marking the stock lost.', 'asset_assigned');
    end if;
    select * into v_asg from public.hr_asset_assignments where asset_id = v_asset.id and status = 'active' for update;
    update public.hr_asset_assignments set status = 'lost', return_notes = nullif(btrim(p_details), '') where id = v_asg.id;
    perform hr_private.notify_employee(v_asg.employee_id, 'asset_lost', 'Asset marked as lost',
      v_asset.asset_tag || ' has been marked as lost.', '/employee/assets', 'hr_asset_assignment', v_asg.id::text);
  end if;
  if p_status = 'available' and v_asset.status not in ('in_repair','lost') then
    perform hr_private.fail('Only assets in repair or lost can be made available again.', 'invalid_state');
  end if;
  perform hr_private.asset_set_state(v_asset.id,
    case when p_status = 'available' then hr_private.asset_occupancy_status(v_asset.id) else p_status end);
  insert into public.hr_asset_events (asset_id, assignment_id, employee_id, event_type, details, recorded_by)
  values (v_asset.id, v_asg.id, v_asg.employee_id,
          case p_status when 'retired' then 'retire' when 'lost' then 'lost' when 'disposed' then 'dispose' else 'status_change' end,
          coalesce(nullif(btrim(p_details), ''), 'Status changed to ' || p_status), auth.uid());
end $$;

create or replace function public.hr_acknowledge_asset(p_assignment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_asg public.hr_asset_assignments;
begin
  select * into v_asg from public.hr_asset_assignments where id = p_assignment for update;
  if v_asg.id is null or v_asg.employee_id is distinct from hr_private.current_employee_id() then
    perform hr_private.fail('Assignment not found.', 'not_found');
  end if;
  if v_asg.status <> 'active' then perform hr_private.fail('This assignment is no longer active.', 'invalid_state'); end if;
  if v_asg.acknowledged_at is null then
    update public.hr_asset_assignments set acknowledged_at = now() where id = v_asg.id;
  end if;
end $$;

create or replace function public.hr_request_asset(p_asset_type text, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid := hr_private.current_employee_id(); v_id uuid;
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  if length(btrim(coalesce(p_asset_type, ''))) < 2 then perform hr_private.fail('Choose the type of asset you need.', 'invalid'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then perform hr_private.fail('Explain why you need it.', 'reason_required'); end if;
  insert into public.hr_asset_requests (employee_id, asset_type, reason)
  values (v_me, btrim(p_asset_type), btrim(p_reason)) returning id into v_id;
  return v_id;
end $$;

create or replace function public.hr_cancel_asset_request(p_request uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_req public.hr_asset_requests;
begin
  select * into v_req from public.hr_asset_requests where id = p_request for update;
  if v_req.id is null or v_req.employee_id is distinct from hr_private.current_employee_id() then
    perform hr_private.fail('Request not found.', 'not_found');
  end if;
  if v_req.status <> 'pending' then perform hr_private.fail('Only pending requests can be cancelled.', 'invalid_state'); end if;
  update public.hr_asset_requests set status = 'cancelled' where id = v_req.id;
end $$;

create or replace function public.hr_decide_asset_request(p_request uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_req public.hr_asset_requests;
begin
  perform hr_private.asset_require_manage();
  select * into v_req from public.hr_asset_requests where id = p_request for update;
  if v_req.id is null then perform hr_private.fail('Request not found.', 'not_found'); end if;
  if v_req.employee_id = hr_private.current_employee_id() then
    perform hr_private.fail('You cannot decide your own request.', 'self_action');
  end if;
  if v_req.status <> 'pending' then perform hr_private.fail('This request has already been decided.', 'invalid_state'); end if;
  if p_approve is null then perform hr_private.fail('Choose approve or reject.', 'invalid'); end if;
  if not p_approve and nullif(btrim(p_note), '') is null then
    perform hr_private.fail('Give a reason when rejecting a request.', 'reason_required');
  end if;
  update public.hr_asset_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_note), '')
   where id = v_req.id;
  perform hr_private.notify_employee(v_req.employee_id, 'asset_request_decided',
    case when p_approve then 'Asset request approved' else 'Asset request rejected' end,
    v_req.asset_type || coalesce(': ' || nullif(btrim(p_note), ''), ''), '/employee/assets', 'hr_asset_request', v_req.id::text);
end $$;

-- Fulfil an approved request by assigning a concrete asset.
create or replace function public.hr_fulfill_asset_request(p_request uuid, p_asset uuid, p_expected_return date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_req public.hr_asset_requests; v_asg uuid;
begin
  perform hr_private.asset_require_manage();
  select * into v_req from public.hr_asset_requests where id = p_request for update;
  if v_req.id is null then perform hr_private.fail('Request not found.', 'not_found'); end if;
  if v_req.status <> 'approved' then perform hr_private.fail('Only approved requests can be fulfilled.', 'invalid_state'); end if;
  v_asg := hr_private.asset_assign(p_asset, v_req.employee_id, p_expected_return, 'Fulfils asset request', 1, null);
  update public.hr_asset_requests set status = 'fulfilled', fulfilled_assignment = v_asg where id = v_req.id;
  return v_asg;
end $$;

-- Active assignments of an employee (used by exit clearance).
create or replace function public.hr_employee_open_assets(p_employee uuid)
returns table (assignment_id uuid, asset_id uuid, asset_tag text, asset_type text, brand text, model text,
               serial_number text, quantity int, assigned_at timestamptz, expected_return_date date, acknowledged_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not (p_employee = hr_private.current_employee_id()
          or hr_private.has_permission('assets.view') or hr_private.has_permission('assets.manage')
          or hr_private.has_permission('exit.view') or hr_private.has_permission('exit.manage')) then
    perform hr_private.fail('You are not allowed to view this employee''s assets.', 'forbidden');
  end if;
  return query
  select x.id, a.id, a.asset_tag, a.asset_type, a.brand, a.model, a.serial_number, x.quantity, x.assigned_at,
         x.expected_return_date, x.acknowledged_at
  from public.hr_asset_assignments x
  join public.hr_assets a on a.id = x.asset_id
  where x.employee_id = p_employee and x.status = 'active'
  order by x.assigned_at;
end $$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke execute on function
  hr_private.assets_guard(), hr_private.assets_after_insert(),
  hr_private.asset_occupancy_status(uuid), hr_private.asset_set_state(uuid, text, text),
  hr_private.asset_is_mine(uuid), hr_private.asset_assignment_is_mine(uuid), hr_private.asset_require_manage(),
  hr_private.asset_assign(uuid, uuid, date, text, int, uuid)
from anon, public, authenticated;
grant execute on function
  hr_private.asset_occupancy_status(uuid), hr_private.asset_is_mine(uuid), hr_private.asset_assignment_is_mine(uuid)
to authenticated, service_role;

revoke execute on function
  public.hr_assign_asset(uuid, uuid, date, text, int),
  public.hr_transfer_asset(uuid, uuid, text),
  public.hr_return_asset(uuid, text, text),
  public.hr_report_asset_damage(uuid, uuid, text),
  public.hr_log_asset_maintenance(uuid, text, numeric, boolean, text),
  public.hr_set_asset_status(uuid, text, text),
  public.hr_acknowledge_asset(uuid),
  public.hr_request_asset(text, text),
  public.hr_cancel_asset_request(uuid),
  public.hr_decide_asset_request(uuid, boolean, text),
  public.hr_fulfill_asset_request(uuid, uuid, date),
  public.hr_employee_open_assets(uuid)
from anon, public;
grant execute on function
  public.hr_assign_asset(uuid, uuid, date, text, int),
  public.hr_transfer_asset(uuid, uuid, text),
  public.hr_return_asset(uuid, text, text),
  public.hr_report_asset_damage(uuid, uuid, text),
  public.hr_log_asset_maintenance(uuid, text, numeric, boolean, text),
  public.hr_set_asset_status(uuid, text, text),
  public.hr_acknowledge_asset(uuid),
  public.hr_request_asset(text, text),
  public.hr_cancel_asset_request(uuid),
  public.hr_decide_asset_request(uuid, boolean, text),
  public.hr_fulfill_asset_request(uuid, uuid, date),
  public.hr_employee_open_assets(uuid)
to authenticated;
