-- =====================================================================
-- 141_hr_asset_allocation.sql — HRMS Module 11: Asset Allocation
-- =====================================================================
-- Depends on 100 (foundation), 103 (notify_permission_holders),
-- 107 (documents), 109 (assets) and 110 (exit).
--
-- Extends the existing 109 asset module IN PLACE. No table is dropped and
-- no existing row is rewritten. Every RPC used by the UI, by exit
-- clearance (110 / 130) and by onboarding (130) keeps its signature.
--
-- Adds
--   * Register: storage location, purchase cost moved to hr_asset_financials
--     (RLS: new permission assets.view_cost; writes to hr_assets.purchase_cost
--     are permission-checked and redirected there), new asset status
--     'in_inspection' (returned, awaiting inspection).
--   * Assignment: reason, accessories, issued condition.
--   * Handover: one record per assignment (issued condition, accessories,
--     checklist, notes, terms version). Employee acknowledgement records
--     timestamp + the terms version shown; HR/IT confirmation afterwards.
--     The acknowledgement is an in-app confirmation of receipt, NOT a
--     legally valid digital signature.
--   * Damage reports: Reported -> Under Review -> Under Repair -> Resolved
--     (Under Review -> Resolved allowed when no repair is needed). Resolved
--     reports are immutable. No salary deduction is ever created here.
--   * Returns: Requested -> Pending Handover -> Received -> Inspected ->
--     Completed (+ Cancelled before receipt). Receipt closes the assignment;
--     the asset is NOT available again until the inspection outcome is
--     applied at completion (available / in repair / retired).
--   * Documents: handover records, damage evidence and return confirmations
--     are Module 9 hr_documents (private bucket, signed URLs) linked to the
--     asset record through hr_asset_document_links.
--   * Exit: hr_employee_open_assets now also lists returns that are received
--     but not yet inspected/completed (so exit clearance cannot bypass the
--     inspection); hr_employee_asset_clearance + hr_record_asset_clearance
--     give an explicit, authorised asset-clearance sign-off;
--     hr_start_exit_asset_returns generates the return checklist.
--   * Overview counts (hr_asset_overview) computed from live records.
--   * History: every workflow step writes an immutable hr_asset_events row.
-- Apply ONLY to the local test cluster or the isolated dev project.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Settings, permission, document categories
-- ---------------------------------------------------------------------
insert into public.hr_settings (key, value, description) values
  ('assets', jsonb_build_object(
      'handover_terms_version', '2026-11-v1',
      'handover_terms', 'I confirm that I have received the company equipment listed above in the stated condition, '
        || 'that it remains company property, that I will use it for work purposes and take reasonable care of it, '
        || 'and that I will return it with all listed accessories when asked or when I leave the company.',
      'handover_checklist', jsonb_build_array('Device powers on and works', 'Accessories listed are included',
        'Asset tag / serial number verified', 'Physical condition recorded', 'Login / access set up (if applicable)'),
      'categories', jsonb_build_array('Laptop', 'Desktop', 'Monitor', 'Keyboard', 'Mouse', 'Charger', 'Headset',
        'Mobile Phone', 'Docking Station', 'Other Accessory')),
   'Asset allocation: handover acknowledgement text and version, default handover checklist, suggested asset categories')
on conflict (key) do nothing;

insert into public.hr_permissions (key, module, action, description) values
  ('assets.view_cost', 'assets', 'view_cost', 'View and edit asset purchase cost')
on conflict (key) do nothing;
insert into public.hr_role_permissions (role_key, permission_key) values ('hr_admin', 'assets.view_cost')
on conflict do nothing;

insert into public.hr_document_categories
  (code, name, description, requires_expiry, employee_can_upload, employee_can_view, is_confidential, checklist_required, sort_order) values
  ('asset_handover',        'Asset handover record',     'Signed / scanned asset handover form or acknowledgement record', false, false, true, false, false, 30),
  ('asset_damage_evidence', 'Asset damage evidence',     'Photos or files supporting an asset damage report',              false, true,  true, false, false, 31),
  ('asset_return',          'Asset return confirmation', 'Asset return / inspection confirmation',                         false, false, true, false, false, 32)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- Register / assignment columns
-- ---------------------------------------------------------------------
alter table public.hr_assets
  add column storage_location text check (storage_location is null or length(btrim(storage_location)) between 1 and 120);

alter table public.hr_assets drop constraint hr_assets_status_check;
alter table public.hr_assets add constraint hr_assets_status_check
  check (status in ('available','assigned','in_repair','in_inspection','retired','lost','disposed'));
create index hr_assets_type on public.hr_assets(asset_type);

alter table public.hr_asset_assignments
  add column assignment_reason text check (assignment_reason is null or length(assignment_reason) <= 500),
  add column accessories       text[] not null default '{}' check (cardinality(accessories) <= 30),
  add column issued_condition  text check (issued_condition is null or issued_condition in ('new','good','fair','poor','damaged'));

-- Purchase cost lives in its own table, readable only with assets.view_cost.
-- hr_assets.purchase_cost stays for backward-compatible writes: a trigger
-- checks the permission, moves the value here and leaves the column null.
create table public.hr_asset_financials (
  asset_id      uuid primary key references public.hr_assets(id) on delete restrict deferrable initially deferred,
  purchase_cost numeric(12,2) check (purchase_cost is null or purchase_cost >= 0),
  updated_by    uuid,
  updated_at    timestamptz not null default now()
);
select hr_private.secure_table('public.hr_asset_financials');
create policy hr_asset_financials_read on public.hr_asset_financials for select to authenticated
  using (hr_private.has_permission('assets.view_cost'));
-- No write policies: written only by the trigger below (SECURITY DEFINER).
select hr_private.enable_audit('public.hr_asset_financials');
insert into public.hr_asset_financials (asset_id, purchase_cost)
  select id, purchase_cost from public.hr_assets where purchase_cost is not null;

create or replace function hr_private.assets_cost_split()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.purchase_cost is not distinct from old.purchase_cost then
    return new;
  end if;
  if new.purchase_cost is not null then
    if auth.uid() is not null and current_setting('hr.asset_workflow', true) is distinct from 'on'
       and not hr_private.has_permission('assets.view_cost') then
      perform hr_private.fail('You are not allowed to record the purchase cost.', 'forbidden');
    end if;
    insert into public.hr_asset_financials (asset_id, purchase_cost, updated_by)
    values (new.id, new.purchase_cost, auth.uid())
    on conflict (asset_id) do update set purchase_cost = excluded.purchase_cost, updated_by = excluded.updated_by, updated_at = now();
    new.purchase_cost := null;
  end if;
  return new;
end $$;
-- Fires before hr_assets_guard (trigger names run alphabetically).
create trigger hr_assets_cost_split before insert or update on public.hr_assets
  for each row execute function hr_private.assets_cost_split();
select set_config('hr.asset_workflow', 'on', true);
update public.hr_assets set purchase_cost = null where purchase_cost is not null;
select set_config('hr.asset_workflow', 'off', true);

-- ---------------------------------------------------------------------
-- New tables
-- ---------------------------------------------------------------------
create table public.hr_asset_handovers (
  id                        uuid primary key default gen_random_uuid(),
  assignment_id             uuid not null unique references public.hr_asset_assignments(id) on delete restrict,
  asset_id                  uuid not null references public.hr_assets(id) on delete restrict,
  employee_id               uuid not null references public.hr_employees(id) on delete restrict,
  handover_date             date not null,
  issued_condition          text not null check (issued_condition in ('new','good','fair','poor','damaged')),
  accessories               text[] not null default '{}' check (cardinality(accessories) <= 30),
  checklist                 jsonb not null default '[]' check (jsonb_typeof(checklist) = 'array'),
  notes                     text check (notes is null or length(notes) <= 2000),
  terms_version             text not null check (length(terms_version) between 1 and 40),
  terms_text                text not null check (length(terms_text) <= 4000),
  status                    text not null default 'pending_acknowledgement'
                            check (status in ('pending_acknowledgement','acknowledged','confirmed','cancelled')),
  acknowledged_at           timestamptz,
  acknowledged_by           uuid,
  acknowledged_terms_version text,
  confirmed_at              timestamptz,
  confirmed_by              uuid,
  confirmation_note         text check (confirmation_note is null or length(confirmation_note) <= 2000),
  created_by                uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  check (status = 'pending_acknowledgement' or status = 'cancelled' or acknowledged_at is not null),
  check (status <> 'confirmed' or confirmed_at is not null)
);
create index hr_asset_handovers_status on public.hr_asset_handovers(status);
create index hr_asset_handovers_employee on public.hr_asset_handovers(employee_id);

create table public.hr_asset_damage_reports (
  id                   uuid primary key default gen_random_uuid(),
  asset_id             uuid not null references public.hr_assets(id) on delete restrict,
  assignment_id        uuid references public.hr_asset_assignments(id) on delete restrict,
  employee_id          uuid references public.hr_employees(id) on delete restrict,   -- holder at the time
  reported_by          uuid,
  reporter_employee_id uuid references public.hr_employees(id) on delete restrict,
  incident_date        date not null,
  description          text not null check (length(btrim(description)) between 3 and 2000),
  damage_category      text not null check (damage_category in ('physical','screen','liquid','battery','keyboard_input',
                                                                'malfunction','missing_part','other')),
  severity             text not null check (severity in ('low','medium','high','critical')),
  status               text not null default 'reported' check (status in ('reported','under_review','under_repair','resolved')),
  review_notes         text check (review_notes is null or length(review_notes) <= 2000),
  reviewed_by          uuid,
  reviewed_at          timestamptz,
  repair_details       text check (repair_details is null or length(repair_details) <= 2000),
  repair_started_at    timestamptz,
  repair_cost          numeric(12,2) check (repair_cost is null or repair_cost >= 0),
  resolution_date      date,
  resolution_notes     text check (resolution_notes is null or length(resolution_notes) <= 2000),
  resolved_by          uuid,
  condition_after      text check (condition_after is null or condition_after in ('new','good','fair','poor','damaged')),
  return_id            uuid,   -- FK added after hr_asset_returns exists
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (status <> 'resolved' or (resolution_date is not null and resolution_notes is not null))
);
create index hr_asset_damage_reports_asset on public.hr_asset_damage_reports(asset_id, created_at desc);
create index hr_asset_damage_reports_status on public.hr_asset_damage_reports(status);
create index hr_asset_damage_reports_employee on public.hr_asset_damage_reports(employee_id);

create table public.hr_asset_returns (
  id                      uuid primary key default gen_random_uuid(),
  assignment_id           uuid not null references public.hr_asset_assignments(id) on delete restrict,
  asset_id                uuid not null references public.hr_assets(id) on delete restrict,
  employee_id             uuid not null references public.hr_employees(id) on delete restrict,
  source                  text not null check (source in ('employee','hr','exit','quick')),
  exit_id                 uuid references public.hr_exits(id) on delete restrict,
  reason                  text not null check (length(btrim(reason)) between 3 and 2000),
  requested_by            uuid,
  requested_at            timestamptz not null default now(),
  requested_return_date   date,
  status                  text not null default 'requested'
                          check (status in ('requested','pending_handover','received','inspected','completed','cancelled')),
  scheduled_by            uuid,
  scheduled_at            timestamptz,
  accessories_expected    text[] not null default '{}',
  accessories_returned    text[] not null default '{}',
  missing_accessories     text[] not null default '{}',
  received_at             timestamptz,
  received_by             uuid,
  receipt_notes           text check (receipt_notes is null or length(receipt_notes) <= 2000),
  return_condition        text check (return_condition is null or return_condition in ('new','good','fair','poor','damaged')),
  inspection_notes        text check (inspection_notes is null or length(inspection_notes) <= 2000),
  inspected_by            uuid,
  inspected_at            timestamptz,
  outcome                 text check (outcome is null or outcome in ('available','in_repair','retired')),
  damage_report_id        uuid references public.hr_asset_damage_reports(id) on delete restrict,
  employee_acknowledged_at timestamptz,
  completed_by            uuid,
  completed_at            timestamptz,
  completion_note         text check (completion_note is null or length(completion_note) <= 2000),
  cancelled_by            uuid,
  cancelled_at            timestamptz,
  cancel_reason           text check (cancel_reason is null or length(cancel_reason) <= 2000),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (status not in ('received','inspected','completed') or received_at is not null),
  check (status not in ('inspected','completed') or (inspected_at is not null and return_condition is not null and outcome is not null)),
  check (status <> 'completed' or completed_at is not null)
);
-- At most one open return per assignment.
create unique index hr_asset_returns_one_open on public.hr_asset_returns(assignment_id)
  where status not in ('completed','cancelled');
create index hr_asset_returns_status on public.hr_asset_returns(status);
create index hr_asset_returns_employee on public.hr_asset_returns(employee_id, status);
alter table public.hr_asset_damage_reports
  add constraint hr_asset_damage_reports_return_id_fkey foreign key (return_id) references public.hr_asset_returns(id) on delete restrict;

create table public.hr_asset_document_links (
  id               uuid primary key default gen_random_uuid(),
  document_id      uuid not null unique references public.hr_documents(id) on delete restrict,
  asset_id         uuid not null references public.hr_assets(id) on delete restrict,
  employee_id      uuid not null references public.hr_employees(id) on delete restrict,
  kind             text not null check (kind in ('handover','damage_evidence','return_confirmation')),
  handover_id      uuid references public.hr_asset_handovers(id) on delete restrict,
  damage_report_id uuid references public.hr_asset_damage_reports(id) on delete restrict,
  return_id        uuid references public.hr_asset_returns(id) on delete restrict,
  linked_by        uuid,
  linked_at        timestamptz not null default now(),
  check (num_nonnulls(handover_id, damage_report_id, return_id) = 1),
  check ((kind = 'handover') = (handover_id is not null)
     and (kind = 'damage_evidence') = (damage_report_id is not null)
     and (kind = 'return_confirmation') = (return_id is not null))
);
create index hr_asset_document_links_asset on public.hr_asset_document_links(asset_id);

-- Explicit, authorised asset clearance for an employee (exit).
create table public.hr_asset_clearances (
  id                 uuid primary key default gen_random_uuid(),
  employee_id        uuid not null references public.hr_employees(id) on delete restrict,
  exit_id            uuid references public.hr_exits(id) on delete restrict,
  cleared_by         uuid not null,
  cleared_at         timestamptz not null default now(),
  notes              text check (notes is null or length(notes) <= 2000),
  issues_acknowledged boolean not null default false,
  snapshot           jsonb not null
);
create index hr_asset_clearances_employee on public.hr_asset_clearances(employee_id, cleared_at desc);

-- History rows can reference the new records.
alter table public.hr_asset_events
  add column handover_id      uuid references public.hr_asset_handovers(id) on delete restrict,
  add column damage_report_id uuid references public.hr_asset_damage_reports(id) on delete restrict,
  add column return_id        uuid references public.hr_asset_returns(id) on delete restrict;
alter table public.hr_asset_events drop constraint hr_asset_events_event_type_check;
alter table public.hr_asset_events add constraint hr_asset_events_event_type_check
  check (event_type in ('purchase','assignment','transfer','return','damage','maintenance','repair_complete','retire','lost',
                        'dispose','status_change','handover_updated','handover_acknowledged','handover_confirmed',
                        'damage_review','damage_repair','damage_resolved','return_requested','return_scheduled',
                        'return_received','return_inspected','return_completed','return_cancelled','return_acknowledged',
                        'document_attached','clearance'));

create trigger hr_asset_handovers_touch before update on public.hr_asset_handovers
  for each row execute function hr_private.touch_updated_at();
create trigger hr_asset_damage_reports_touch before update on public.hr_asset_damage_reports
  for each row execute function hr_private.touch_updated_at();
create trigger hr_asset_returns_touch before update on public.hr_asset_returns
  for each row execute function hr_private.touch_updated_at();

-- ---------------------------------------------------------------------
-- History protection
-- ---------------------------------------------------------------------
create or replace function hr_private.asset_history_no_delete()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform hr_private.fail('Asset history cannot be deleted.', 'immutable');
  return null;
end $$;
create or replace function hr_private.asset_events_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform hr_private.fail('Asset history entries cannot be changed or deleted.', 'immutable');
  return null;
end $$;
create trigger hr_asset_events_immutable before update or delete on public.hr_asset_events
  for each row execute function hr_private.asset_events_immutable();
create trigger hr_assets_no_delete before delete on public.hr_assets
  for each row execute function hr_private.asset_history_no_delete();
create trigger hr_asset_assignments_no_delete before delete on public.hr_asset_assignments
  for each row execute function hr_private.asset_history_no_delete();
create trigger hr_asset_handovers_no_delete before delete on public.hr_asset_handovers
  for each row execute function hr_private.asset_history_no_delete();
create trigger hr_asset_damage_reports_no_delete before delete on public.hr_asset_damage_reports
  for each row execute function hr_private.asset_history_no_delete();
create trigger hr_asset_returns_no_delete before delete on public.hr_asset_returns
  for each row execute function hr_private.asset_history_no_delete();
create trigger hr_asset_document_links_no_delete before delete on public.hr_asset_document_links
  for each row execute function hr_private.asset_history_no_delete();
create trigger hr_asset_clearances_no_delete before delete on public.hr_asset_clearances
  for each row execute function hr_private.asset_history_no_delete();

-- Resolved damage reports are final.
create or replace function hr_private.asset_damage_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'resolved' then
    perform hr_private.fail('A resolved damage report cannot be changed.', 'immutable');
  end if;
  return new;
end $$;
create trigger hr_asset_damage_reports_guard before update on public.hr_asset_damage_reports
  for each row execute function hr_private.asset_damage_guard();

-- Completed / cancelled returns are final (only the employee's own return
-- confirmation timestamp may still be recorded on a completed return).
create or replace function hr_private.asset_return_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status in ('completed','cancelled')
     and (to_jsonb(new) - 'employee_acknowledged_at' - 'updated_at') is distinct from (to_jsonb(old) - 'employee_acknowledged_at' - 'updated_at') then
    perform hr_private.fail('A completed or cancelled return cannot be changed.', 'immutable');
  end if;
  return new;
end $$;
create trigger hr_asset_returns_guard before update on public.hr_asset_returns
  for each row execute function hr_private.asset_return_guard();

-- ---------------------------------------------------------------------
-- Helpers (replace 109 versions where noted)
-- ---------------------------------------------------------------------
-- Units held: active assignments + returned units still awaiting inspection.
create or replace function hr_private.asset_units_held(p_asset uuid)
returns int language sql stable security definer set search_path = '' as $$
  select (coalesce((select sum(x.quantity) from public.hr_asset_assignments x
                    where x.asset_id = p_asset and x.status = 'active'), 0)
        + coalesce((select sum(x.quantity) from public.hr_asset_returns r
                    join public.hr_asset_assignments x on x.id = r.assignment_id
                    where r.asset_id = p_asset and r.status in ('received','inspected')), 0))::int
$$;

-- REPLACES 109: units awaiting inspection are not available; an individually
-- tracked asset awaiting inspection is 'in_inspection'.
create or replace function hr_private.asset_occupancy_status(p_asset uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
           when hr_private.asset_units_held(a.id) < a.quantity then 'available'
           when not a.is_bulk and not exists (select 1 from public.hr_asset_assignments x where x.asset_id = a.id and x.status = 'active')
             then 'in_inspection'
           else 'assigned' end
  from public.hr_assets a where a.id = p_asset
$$;

-- REPLACES 109: quantity check counts units awaiting inspection (purchase
-- cost is handled by hr_assets_cost_split).
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
  v_used := hr_private.asset_units_held(old.id);
  if new.is_bulk is distinct from old.is_bulk and v_used > 0 then
    perform hr_private.fail('Bulk mode cannot be changed while the asset is assigned.', 'invalid_state');
  end if;
  if new.quantity < v_used then
    perform hr_private.fail(format('Quantity cannot be lower than the %s currently assigned.', v_used), 'invalid_quantity');
  end if;
  return new;
end $$;

-- REPLACES 109: registration event no longer copies the purchase cost
-- (events are readable by assets.view holders without assets.view_cost).
create or replace function hr_private.assets_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.hr_asset_events (asset_id, event_type, details, occurred_at, recorded_by)
  values (new.id, 'purchase', 'Asset registered' || coalesce(' (purchased ' || to_char(new.purchase_date, 'DD Mon YYYY') || ')', ''),
          now(), auth.uid());
  return new;
end $$;

create or replace function hr_private.asset_event(p_asset uuid, p_type text, p_details text, p_assignment uuid default null,
                                                  p_employee uuid default null, p_cost numeric default null,
                                                  p_handover uuid default null, p_damage uuid default null, p_return uuid default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.hr_asset_events (asset_id, assignment_id, employee_id, event_type, details, cost, recorded_by,
                                      handover_id, damage_report_id, return_id)
  values (p_asset, p_assignment, p_employee, p_type, left(nullif(btrim(p_details), ''), 2000), p_cost, auth.uid(),
          p_handover, p_damage, p_return)
$$;

create or replace function hr_private.asset_clean_list(p_items text[])
returns text[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct left(btrim(i), 80) order by left(btrim(i), 80)), '{}')
  from unnest(coalesce(p_items, '{}')) i where nullif(btrim(i), '') is not null
$$;

create or replace function hr_private.asset_checklist(p_items jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb := '[]'; e jsonb;
begin
  if p_items is null then
    select coalesce(jsonb_agg(jsonb_build_object('item', t, 'done', false)), '[]')
      into v from jsonb_array_elements_text(coalesce(hr_private.setting('assets') -> 'handover_checklist', '[]')) t;
    return v;
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 30 then
    perform hr_private.fail('The handover checklist must be a list of at most 30 items.', 'invalid');
  end if;
  for e in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(e) = 'string' then
      e := jsonb_build_object('item', e #>> '{}', 'done', false);
    end if;
    if nullif(btrim(e ->> 'item'), '') is null or length(e ->> 'item') > 200 then
      perform hr_private.fail('Each checklist item needs a label (200 characters maximum).', 'invalid');
    end if;
    v := v || jsonb_build_array(jsonb_build_object('item', btrim(e ->> 'item'), 'done', coalesce((e ->> 'done')::boolean, false)));
  end loop;
  return v;
end $$;

-- Core assignment with handover (permission checks are done by the callers).
create or replace function hr_private.asset_assign_full(p_asset uuid, p_employee uuid, p_expected_return date, p_notes text,
                                                        p_quantity int, p_transferred_from uuid, p_reason text,
                                                        p_accessories text[], p_checklist jsonb, p_issued_condition text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_asset public.hr_assets;
  v_emp   public.hr_employees;
  v_qty   int := coalesce(p_quantity, 1);
  v_used  int;
  v_id    uuid;
  v_cond  text;
  v_acc   text[] := hr_private.asset_clean_list(p_accessories);
  v_set   jsonb := coalesce(hr_private.setting('assets'), '{}');
begin
  select * into v_asset from public.hr_assets where id = p_asset for update;
  if v_asset.id is null then perform hr_private.fail('Asset not found.', 'not_found'); end if;
  if v_asset.status in ('retired','lost','disposed','in_repair','in_inspection') then
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
  if length(p_reason) > 500 then perform hr_private.fail('The assignment reason is too long (500 characters maximum).', 'invalid'); end if;
  if p_issued_condition is not null and p_issued_condition not in ('new','good','fair','poor','damaged') then
    perform hr_private.fail('Unknown condition.', 'invalid_condition');
  end if;
  if cardinality(v_acc) > 30 then perform hr_private.fail('List at most 30 accessories.', 'invalid'); end if;
  v_used := hr_private.asset_units_held(p_asset);
  if not v_asset.is_bulk then
    if v_qty <> 1 then perform hr_private.fail('Individually tracked assets are assigned one at a time.', 'invalid_quantity'); end if;
    if v_used > 0 then perform hr_private.fail('This asset is already assigned.', 'already_assigned'); end if;
  elsif v_used + v_qty > v_asset.quantity then
    perform hr_private.fail(format('Only %s of this item are available.', v_asset.quantity - v_used), 'insufficient_quantity');
  end if;
  v_cond := coalesce(p_issued_condition, v_asset.condition);

  insert into public.hr_asset_assignments (asset_id, employee_id, is_bulk, quantity, assigned_by, expected_return_date, notes,
                                           transferred_from, assignment_reason, accessories, issued_condition)
  values (p_asset, p_employee, v_asset.is_bulk, v_qty, auth.uid(), p_expected_return, nullif(btrim(p_notes), ''),
          p_transferred_from, nullif(btrim(p_reason), ''), v_acc, v_cond)
  returning id into v_id;
  insert into public.hr_asset_handovers (assignment_id, asset_id, employee_id, handover_date, issued_condition, accessories,
                                         checklist, notes, terms_version, terms_text, created_by)
  values (v_id, p_asset, p_employee, hr_private.business_today(), v_cond, v_acc, hr_private.asset_checklist(p_checklist),
          nullif(btrim(p_notes), ''), coalesce(v_set ->> 'handover_terms_version', 'v1'),
          coalesce(v_set ->> 'handover_terms', 'I confirm that I have received the equipment listed above.'), auth.uid());
  perform hr_private.asset_set_state(p_asset, hr_private.asset_occupancy_status(p_asset));
  if p_transferred_from is null then
    perform hr_private.asset_event(p_asset, 'assignment',
      concat_ws(' · ', nullif(btrim(p_reason), ''), nullif(btrim(p_notes), ''),
                case when cardinality(v_acc) > 0 then 'Accessories: ' || array_to_string(v_acc, ', ') end), v_id, p_employee);
  end if;
  perform hr_private.notify_employee(p_employee, 'asset_assigned', 'Asset assigned to you',
    coalesce(v_asset.brand || ' ', '') || coalesce(v_asset.model || ' ', '') || '(' || v_asset.asset_tag || ')'
      || case when v_qty > 1 then ' x' || v_qty else '' end || '. Please acknowledge the handover.',
    '/employee/assets', 'hr_asset_assignment', v_id::text);
  return v_id;
end $$;

-- REPLACES 109 (same signature, now also creates the handover record).
create or replace function hr_private.asset_assign(p_asset uuid, p_employee uuid, p_expected_return date, p_notes text,
                                                   p_quantity int, p_transferred_from uuid)
returns uuid language sql security definer set search_path = '' as $$
  select hr_private.asset_assign_full(p_asset, p_employee, p_expected_return, p_notes, p_quantity, p_transferred_from,
                                      null, null, null, null)
$$;

-- Open (not completed / cancelled) return of an assignment, if any.
create or replace function hr_private.asset_open_return(p_assignment uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select r.id from public.hr_asset_returns r where r.assignment_id = p_assignment and r.status not in ('completed','cancelled') limit 1
$$;

-- Cancel the pending handover of an assignment that is being closed.
create or replace function hr_private.asset_close_handover(p_assignment uuid)
returns void language sql security definer set search_path = '' as $$
  update public.hr_asset_handovers set status = 'cancelled' where assignment_id = p_assignment and status = 'pending_acknowledgement'
$$;

-- ---------------------------------------------------------------------
-- RLS for new tables
-- ---------------------------------------------------------------------
select hr_private.secure_table('public.hr_asset_handovers');
select hr_private.secure_table('public.hr_asset_damage_reports');
select hr_private.secure_table('public.hr_asset_returns');
select hr_private.secure_table('public.hr_asset_document_links');
select hr_private.secure_table('public.hr_asset_clearances');

create policy hr_asset_handovers_read on public.hr_asset_handovers for select to authenticated
  using (employee_id = hr_private.current_employee_id()
         or hr_private.has_permission('assets.view') or hr_private.has_permission('assets.manage'));
create policy hr_asset_damage_reports_read on public.hr_asset_damage_reports for select to authenticated
  using ((employee_id is not null and employee_id = hr_private.current_employee_id())
         or (reporter_employee_id is not null and reporter_employee_id = hr_private.current_employee_id())
         or hr_private.has_permission('assets.view') or hr_private.has_permission('assets.manage'));
create policy hr_asset_returns_read on public.hr_asset_returns for select to authenticated
  using (employee_id = hr_private.current_employee_id()
         or hr_private.has_permission('assets.view') or hr_private.has_permission('assets.manage')
         or hr_private.has_permission('exit.view') or hr_private.has_permission('exit.manage'));
create policy hr_asset_document_links_read on public.hr_asset_document_links for select to authenticated
  using (employee_id = hr_private.current_employee_id()
         or hr_private.has_permission('assets.view') or hr_private.has_permission('assets.manage'));
create policy hr_asset_clearances_read on public.hr_asset_clearances for select to authenticated
  using (hr_private.has_permission('assets.view') or hr_private.has_permission('assets.manage')
         or hr_private.has_permission('exit.view') or hr_private.has_permission('exit.manage'));
-- No insert / update / delete policies: all writes go through the RPCs below.

select hr_private.enable_audit('public.hr_asset_handovers');
select hr_private.enable_audit('public.hr_asset_damage_reports');
select hr_private.enable_audit('public.hr_asset_returns');
select hr_private.enable_audit('public.hr_asset_document_links');
select hr_private.enable_audit('public.hr_asset_clearances');

-- ---------------------------------------------------------------------
-- Register: purchase cost (restricted)
-- ---------------------------------------------------------------------
create or replace function public.hr_asset_costs(p_assets uuid[])
returns table (asset_id uuid, purchase_cost numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not hr_private.has_permission('assets.view_cost') then
    perform hr_private.fail('You are not allowed to view asset purchase costs.', 'forbidden');
  end if;
  if cardinality(p_assets) > 5000 then perform hr_private.fail('Too many assets requested.', 'invalid'); end if;
  return query select a.id, f.purchase_cost from public.hr_assets a
               left join public.hr_asset_financials f on f.asset_id = a.id where a.id = any (p_assets);
end $$;

-- ---------------------------------------------------------------------
-- Assignment
-- ---------------------------------------------------------------------
create or replace function public.hr_assign_asset_v2(p_asset uuid, p_employee uuid, p_expected_return date default null,
                                                     p_notes text default null, p_quantity int default 1, p_reason text default null,
                                                     p_accessories text[] default null, p_checklist jsonb default null,
                                                     p_issued_condition text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform hr_private.asset_require_manage();
  if p_employee = hr_private.current_employee_id() then
    perform hr_private.fail('Ask another asset manager to assign equipment to you.', 'self_action');
  end if;
  return hr_private.asset_assign_full(p_asset, p_employee, p_expected_return, p_notes, p_quantity, null, p_reason,
                                      p_accessories, p_checklist, p_issued_condition);
end $$;

-- REPLACES 109: a transfer is blocked while a return is open on the assignment.
create or replace function public.hr_transfer_asset(p_assignment uuid, p_to_employee uuid, p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_asg public.hr_asset_assignments; v_asset public.hr_assets; v_new uuid; v_from text; v_to text;
begin
  perform hr_private.asset_require_manage();
  select * into v_asg from public.hr_asset_assignments where id = p_assignment for update;
  if v_asg.id is null then perform hr_private.fail('Assignment not found.', 'not_found'); end if;
  if v_asg.status <> 'active' then perform hr_private.fail('Only active assignments can be transferred.', 'invalid_state'); end if;
  if v_asg.employee_id = p_to_employee then perform hr_private.fail('The asset is already with this employee.', 'invalid'); end if;
  if hr_private.asset_open_return(v_asg.id) is not null then
    perform hr_private.fail('A return is in progress for this assignment. Complete or cancel it first.', 'return_open');
  end if;
  select * into v_asset from public.hr_assets where id = v_asg.asset_id for update;
  select employee_code into v_from from public.hr_employees where id = v_asg.employee_id;
  select employee_code into v_to from public.hr_employees where id = p_to_employee;

  update public.hr_asset_assignments
     set status = 'returned', returned_at = now(), return_condition = v_asset.condition,
         return_notes = 'Transferred to ' || coalesce(v_to, 'another employee')
   where id = v_asg.id;
  perform hr_private.asset_close_handover(v_asg.id);
  perform hr_private.asset_set_state(v_asset.id, hr_private.asset_occupancy_status(v_asset.id));
  v_new := hr_private.asset_assign_full(v_asset.id, p_to_employee,
             case when v_asg.expected_return_date >= hr_private.business_today() then v_asg.expected_return_date end,
             p_notes, v_asg.quantity, v_asg.id, 'Transfer', v_asg.accessories, null, v_asset.condition);
  perform hr_private.asset_event(v_asset.id, 'transfer',
    'From ' || coalesce(v_from, '?') || ' to ' || coalesce(v_to, '?') || coalesce(': ' || nullif(btrim(p_notes), ''), ''),
    v_new, p_to_employee);
  perform hr_private.notify_employee(v_asg.employee_id, 'asset_transferred', 'Asset transferred',
    v_asset.asset_tag || ' has been transferred to a colleague.', '/employee/assets', 'hr_asset_assignment', v_asg.id::text);
  return v_new;
end $$;

-- ---------------------------------------------------------------------
-- Handover
-- ---------------------------------------------------------------------
create or replace function public.hr_update_asset_handover(p_handover uuid, p_issued_condition text default null,
                                                           p_accessories text[] default null, p_checklist jsonb default null,
                                                           p_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_h public.hr_asset_handovers;
begin
  perform hr_private.asset_require_manage();
  select * into v_h from public.hr_asset_handovers where id = p_handover for update;
  if v_h.id is null then perform hr_private.fail('Handover not found.', 'not_found'); end if;
  if v_h.status <> 'pending_acknowledgement' then
    perform hr_private.fail('The handover can only be edited before the employee acknowledges it.', 'invalid_state');
  end if;
  if p_issued_condition is not null and p_issued_condition not in ('new','good','fair','poor','damaged') then
    perform hr_private.fail('Unknown condition.', 'invalid_condition');
  end if;
  if length(p_notes) > 2000 then perform hr_private.fail('Notes are too long (2000 characters maximum).', 'invalid'); end if;
  update public.hr_asset_handovers
     set issued_condition = coalesce(p_issued_condition, issued_condition),
         accessories = case when p_accessories is null then accessories else hr_private.asset_clean_list(p_accessories) end,
         checklist = case when p_checklist is null then checklist else hr_private.asset_checklist(p_checklist) end,
         notes = case when p_notes is null then notes else nullif(btrim(p_notes), '') end
   where id = v_h.id;
  update public.hr_asset_assignments
     set accessories = case when p_accessories is null then accessories else hr_private.asset_clean_list(p_accessories) end,
         issued_condition = coalesce(p_issued_condition, issued_condition)
   where id = v_h.assignment_id;
  perform hr_private.asset_event(v_h.asset_id, 'handover_updated', 'Handover details updated before acknowledgement',
                                 v_h.assignment_id, v_h.employee_id, null, v_h.id);
end $$;

-- Employee acknowledges receipt. p_terms_version must match the version the
-- handover was issued with (the client shows that exact text).
create or replace function public.hr_acknowledge_asset_handover(p_handover uuid, p_terms_version text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_h public.hr_asset_handovers; v_asg public.hr_asset_assignments;
begin
  select * into v_h from public.hr_asset_handovers where id = p_handover for update;
  if v_h.id is null or v_h.employee_id is distinct from hr_private.current_employee_id() then
    perform hr_private.fail('Handover not found.', 'not_found');
  end if;
  select * into v_asg from public.hr_asset_assignments where id = v_h.assignment_id for update;
  if v_asg.status <> 'active' then perform hr_private.fail('This assignment is no longer active.', 'invalid_state'); end if;
  if v_h.status <> 'pending_acknowledgement' then return; end if;
  if p_terms_version is distinct from v_h.terms_version then
    perform hr_private.fail('The handover terms have changed. Reload the page and review them again.', 'terms_changed');
  end if;
  update public.hr_asset_handovers
     set status = 'acknowledged', acknowledged_at = now(), acknowledged_by = auth.uid(), acknowledged_terms_version = p_terms_version
   where id = v_h.id;
  update public.hr_asset_assignments set acknowledged_at = coalesce(acknowledged_at, now()) where id = v_asg.id;
  perform hr_private.asset_event(v_h.asset_id, 'handover_acknowledged', 'Employee acknowledged receipt (terms ' || p_terms_version || ')',
                                 v_h.assignment_id, v_h.employee_id, null, v_h.id);
  perform hr_private.notify_permission_holders('assets.manage', 'asset_handover_acknowledged', 'Asset handover acknowledged',
    'An employee acknowledged receipt of equipment. Confirm the handover.', '/hr/assets?tab=handovers', 'hr_asset_handover', v_h.id::text,
    v_h.employee_id);
end $$;

-- REPLACES 109 (same signature): acknowledges through the handover record.
create or replace function public.hr_acknowledge_asset(p_assignment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_asg public.hr_asset_assignments; v_h public.hr_asset_handovers;
begin
  select * into v_asg from public.hr_asset_assignments where id = p_assignment for update;
  if v_asg.id is null or v_asg.employee_id is distinct from hr_private.current_employee_id() then
    perform hr_private.fail('Assignment not found.', 'not_found');
  end if;
  if v_asg.status <> 'active' then perform hr_private.fail('This assignment is no longer active.', 'invalid_state'); end if;
  select * into v_h from public.hr_asset_handovers where assignment_id = v_asg.id;
  if v_h.id is not null then
    perform public.hr_acknowledge_asset_handover(v_h.id, v_h.terms_version);
  elsif v_asg.acknowledged_at is null then
    update public.hr_asset_assignments set acknowledged_at = now() where id = v_asg.id;   -- pre-141 assignment
  end if;
end $$;

-- HR/IT confirmation after the employee acknowledged.
create or replace function public.hr_confirm_asset_handover(p_handover uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_h public.hr_asset_handovers;
begin
  perform hr_private.asset_require_manage();
  select * into v_h from public.hr_asset_handovers where id = p_handover for update;
  if v_h.id is null then perform hr_private.fail('Handover not found.', 'not_found'); end if;
  if v_h.employee_id = hr_private.current_employee_id() then
    perform hr_private.fail('Another asset manager must confirm a handover of equipment issued to you.', 'self_action');
  end if;
  if v_h.status = 'pending_acknowledgement' then
    perform hr_private.fail('The employee has not acknowledged receipt yet.', 'not_acknowledged');
  end if;
  if v_h.status <> 'acknowledged' then perform hr_private.fail('This handover is already closed.', 'invalid_state'); end if;
  if length(p_note) > 2000 then perform hr_private.fail('The note is too long (2000 characters maximum).', 'invalid'); end if;
  update public.hr_asset_handovers
     set status = 'confirmed', confirmed_at = now(), confirmed_by = auth.uid(), confirmation_note = nullif(btrim(p_note), '')
   where id = v_h.id;
  perform hr_private.asset_event(v_h.asset_id, 'handover_confirmed', coalesce(nullif(btrim(p_note), ''), 'Handover confirmed by HR/IT'),
                                 v_h.assignment_id, v_h.employee_id, null, v_h.id);
end $$;

-- ---------------------------------------------------------------------
-- Damage reports
-- ---------------------------------------------------------------------
create or replace function hr_private.asset_damage_create(p_asset uuid, p_assignment uuid, p_employee uuid, p_incident date,
                                                          p_category text, p_severity text, p_description text,
                                                          p_status text, p_return uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_tag text; v_bulk boolean;
begin
  if nullif(btrim(p_description), '') is null or length(btrim(p_description)) < 3 then
    perform hr_private.fail('Describe the damage (at least 3 characters).', 'details_required');
  end if;
  if length(p_description) > 2000 then perform hr_private.fail('The description is too long (2000 characters maximum).', 'invalid'); end if;
  if p_category is null or p_category not in ('physical','screen','liquid','battery','keyboard_input','malfunction','missing_part','other') then
    perform hr_private.fail('Choose a damage category.', 'invalid_category');
  end if;
  if p_severity is null or p_severity not in ('low','medium','high','critical') then
    perform hr_private.fail('Choose a severity.', 'invalid_severity');
  end if;
  if p_incident is null or p_incident > hr_private.business_today() then
    perform hr_private.fail('The incident date must be today or earlier.', 'invalid_date');
  end if;
  select asset_tag, is_bulk into v_tag, v_bulk from public.hr_assets where id = p_asset for update;
  if v_tag is null then perform hr_private.fail('Asset not found.', 'not_found'); end if;
  insert into public.hr_asset_damage_reports (asset_id, assignment_id, employee_id, reported_by, reporter_employee_id, incident_date,
                                              description, damage_category, severity, status, return_id,
                                              reviewed_by, reviewed_at)
  values (p_asset, p_assignment, p_employee, auth.uid(), hr_private.current_employee_id(), p_incident,
          btrim(p_description), p_category, p_severity, p_status, p_return,
          case when p_status = 'under_review' then auth.uid() end, case when p_status = 'under_review' then now() end)
  returning id into v_id;
  -- A quantity-tracked stock is not marked damaged as a whole.
  if not v_bulk then perform hr_private.asset_set_state(p_asset, null, 'damaged'); end if;
  perform hr_private.asset_event(p_asset, 'damage', p_severity || ' / ' || replace(p_category, '_', ' ') || ': ' || btrim(p_description),
                                 p_assignment, p_employee, null, null, v_id);
  perform hr_private.notify_permission_holders('assets.manage', 'asset_damage_reported', 'Asset damage reported',
    v_tag || ' — ' || p_severity || ' severity', '/hr/assets?tab=damage', 'hr_asset_damage_report', v_id::text,
    hr_private.current_employee_id());
  return v_id;
end $$;

-- Employee: on their own active assignment. HR (assets.manage): any asset.
create or replace function public.hr_submit_asset_damage_report(p_assignment uuid, p_asset uuid, p_incident_date date,
                                                                p_category text, p_severity text, p_description text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_asg public.hr_asset_assignments; v_asset uuid := p_asset; v_emp uuid;
        v_is_hr boolean := hr_private.has_permission('assets.manage');
begin
  if p_assignment is not null then
    select * into v_asg from public.hr_asset_assignments where id = p_assignment;
    if v_asg.id is null or not (v_is_hr or v_asg.employee_id = hr_private.current_employee_id()) then
      perform hr_private.fail('Assignment not found.', 'not_found');
    end if;
    if v_asg.status <> 'active' and not v_is_hr then
      perform hr_private.fail('You can only report damage on an asset currently assigned to you.', 'invalid_state');
    end if;
    v_asset := v_asg.asset_id;
    v_emp := v_asg.employee_id;
  elsif not v_is_hr then
    perform hr_private.fail('You are not allowed to manage assets.', 'forbidden');
  else
    select x.id, x.employee_id into v_asg.id, v_emp from public.hr_asset_assignments x
     where x.asset_id = p_asset and x.status = 'active' and not x.is_bulk;
  end if;
  return hr_private.asset_damage_create(v_asset, v_asg.id, v_emp, p_incident_date, p_category, p_severity, p_description,
                                        'reported', null);
end $$;

-- REPLACES 109 (same signature, returns the history event id): creates a
-- damage report with default category / severity.
create or replace function public.hr_report_asset_damage(p_assignment uuid, p_asset uuid, p_details text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_event bigint;
begin
  if nullif(btrim(p_details), '') is null then perform hr_private.fail('Describe the damage.', 'details_required'); end if;
  v_id := public.hr_submit_asset_damage_report(p_assignment, p_asset, hr_private.business_today(), 'other', 'medium', p_details);
  select max(id) into v_event from public.hr_asset_events where damage_report_id = v_id;
  return v_event;
end $$;

-- Reporter (while Reported) or HR (until Resolved) corrects the details.
create or replace function public.hr_update_asset_damage_report(p_report uuid, p_incident_date date, p_category text,
                                                                p_severity text, p_description text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.hr_asset_damage_reports; v_is_hr boolean := hr_private.has_permission('assets.manage');
begin
  select * into v_r from public.hr_asset_damage_reports where id = p_report for update;
  if v_r.id is null or not (v_is_hr or v_r.reported_by = auth.uid()) then
    perform hr_private.fail('Damage report not found.', 'not_found');
  end if;
  if v_r.status = 'resolved' then perform hr_private.fail('A resolved damage report cannot be changed.', 'immutable'); end if;
  if not v_is_hr and v_r.status <> 'reported' then
    perform hr_private.fail('The report is already being reviewed and can no longer be edited.', 'invalid_state');
  end if;
  if p_category not in ('physical','screen','liquid','battery','keyboard_input','malfunction','missing_part','other') then
    perform hr_private.fail('Choose a damage category.', 'invalid_category');
  end if;
  if p_severity not in ('low','medium','high','critical') then perform hr_private.fail('Choose a severity.', 'invalid_severity'); end if;
  if p_incident_date is null or p_incident_date > hr_private.business_today() then
    perform hr_private.fail('The incident date must be today or earlier.', 'invalid_date');
  end if;
  if length(btrim(coalesce(p_description, ''))) < 3 or length(p_description) > 2000 then
    perform hr_private.fail('Describe the damage (3–2000 characters).', 'details_required');
  end if;
  update public.hr_asset_damage_reports
     set incident_date = p_incident_date, damage_category = p_category, severity = p_severity, description = btrim(p_description)
   where id = v_r.id;
end $$;

-- HR/IT moves a report through its workflow and records repair / resolution.
create or replace function public.hr_advance_asset_damage_report(p_report uuid, p_status text, p_notes text default null,
                                                                 p_repair_details text default null, p_repair_cost numeric default null,
                                                                 p_condition_after text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.hr_asset_damage_reports; v_asset public.hr_assets; v_active boolean; v_other int; v_status text; v_tag text;
begin
  perform hr_private.asset_require_manage();
  select * into v_r from public.hr_asset_damage_reports where id = p_report for update;
  if v_r.id is null then perform hr_private.fail('Damage report not found.', 'not_found'); end if;
  if v_r.employee_id is not null and v_r.employee_id = hr_private.current_employee_id() then
    perform hr_private.fail('Another asset manager must handle damage on equipment assigned to you.', 'self_action');
  end if;
  if not ((v_r.status = 'reported' and p_status = 'under_review')
       or (v_r.status = 'under_review' and p_status in ('under_repair','resolved'))
       or (v_r.status = 'under_repair' and p_status = 'resolved')) then
    perform hr_private.fail(format('A damage report cannot move from %s to %s.', replace(v_r.status, '_', ' '),
                                   replace(coalesce(p_status, '?'), '_', ' ')), 'invalid_transition');
  end if;
  if p_repair_cost is not null and p_repair_cost < 0 then perform hr_private.fail('Repair cost cannot be negative.', 'invalid'); end if;
  if p_condition_after is not null and p_condition_after not in ('new','good','fair','poor','damaged') then
    perform hr_private.fail('Unknown condition.', 'invalid_condition');
  end if;
  if length(p_notes) > 2000 or length(p_repair_details) > 2000 then
    perform hr_private.fail('Notes are too long (2000 characters maximum).', 'invalid');
  end if;
  select * into v_asset from public.hr_assets where id = v_r.asset_id for update;
  v_tag := v_asset.asset_tag;
  v_active := exists (select 1 from public.hr_asset_assignments x where x.asset_id = v_asset.id and x.status = 'active');

  if p_status = 'under_review' then
    update public.hr_asset_damage_reports set status = 'under_review', reviewed_by = auth.uid(), reviewed_at = now(),
           review_notes = nullif(btrim(p_notes), '') where id = v_r.id;
    perform hr_private.asset_event(v_asset.id, 'damage_review', coalesce(nullif(btrim(p_notes), ''), 'Damage report under review'),
                                   v_r.assignment_id, v_r.employee_id, null, null, v_r.id);
  elsif p_status = 'under_repair' then
    update public.hr_asset_damage_reports set status = 'under_repair', repair_started_at = now(),
           repair_details = coalesce(nullif(btrim(p_repair_details), ''), repair_details),
           review_notes = coalesce(nullif(btrim(p_notes), ''), review_notes) where id = v_r.id;
    -- An unassigned asset goes to repair; an assigned one stays with the employee
    -- (or is recalled through a return); one awaiting inspection is decided there.
    if v_asset.status = 'available' and not v_asset.is_bulk and not v_active then
      perform hr_private.asset_set_state(v_asset.id, 'in_repair');
    end if;
    perform hr_private.asset_event(v_asset.id, 'damage_repair', coalesce(nullif(btrim(p_repair_details), ''), 'Repair started'),
                                   v_r.assignment_id, v_r.employee_id, null, null, v_r.id);
  else  -- resolved
    if nullif(btrim(p_notes), '') is null then
      perform hr_private.fail('Record resolution notes.', 'notes_required');
    end if;
    update public.hr_asset_damage_reports set status = 'resolved', resolution_date = hr_private.business_today(),
           resolution_notes = btrim(p_notes), resolved_by = auth.uid(),
           repair_details = coalesce(nullif(btrim(p_repair_details), ''), repair_details),
           repair_cost = coalesce(p_repair_cost, repair_cost),
           condition_after = coalesce(p_condition_after, case when v_r.status = 'under_repair' then 'good' end)
     where id = v_r.id;
    select count(*) into v_other from public.hr_asset_damage_reports
     where asset_id = v_asset.id and id <> v_r.id and status in ('under_repair');
    v_status := case when v_asset.status = 'in_repair' and v_other = 0 then hr_private.asset_occupancy_status(v_asset.id) else null end;
    perform hr_private.asset_set_state(v_asset.id, v_status,
      coalesce(p_condition_after, case when v_r.status = 'under_repair' and v_asset.condition = 'damaged' then 'good' end));
    perform hr_private.asset_event(v_asset.id, 'damage_resolved', btrim(p_notes)
                                   || coalesce(' · Repair: ' || nullif(btrim(p_repair_details), ''), ''),
                                   v_r.assignment_id, v_r.employee_id, coalesce(p_repair_cost, v_r.repair_cost), null, v_r.id);
  end if;
  if v_r.employee_id is not null then
    perform hr_private.notify_employee(v_r.employee_id, 'asset_damage_updated', 'Damage report updated',
      v_tag || ': ' || replace(p_status, '_', ' '), '/employee/assets', 'hr_asset_damage_report', v_r.id::text);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Returns
-- ---------------------------------------------------------------------
-- Employee: request return of their own active assignment (status requested).
-- HR: start a return (status pending_handover).
create or replace function public.hr_request_asset_return(p_assignment uuid, p_reason text, p_requested_date date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_asg public.hr_asset_assignments; v_is_hr boolean := hr_private.has_permission('assets.manage');
        v_mine boolean; v_id uuid; v_tag text;
begin
  select * into v_asg from public.hr_asset_assignments where id = p_assignment for update;
  v_mine := v_asg.id is not null and v_asg.employee_id = hr_private.current_employee_id();
  if v_asg.id is null or not (v_is_hr or v_mine) then perform hr_private.fail('Assignment not found.', 'not_found'); end if;
  if v_asg.status <> 'active' then perform hr_private.fail('Only active assignments can be returned.', 'invalid_state'); end if;
  if hr_private.asset_open_return(v_asg.id) is not null then
    perform hr_private.fail('A return is already in progress for this asset.', 'return_open');
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 or length(p_reason) > 2000 then
    perform hr_private.fail('Give a reason for the return (3–2000 characters).', 'reason_required');
  end if;
  if p_requested_date is not null and p_requested_date < hr_private.business_today() then
    perform hr_private.fail('The requested return date is in the past.', 'invalid_date');
  end if;
  insert into public.hr_asset_returns (assignment_id, asset_id, employee_id, source, reason, requested_by, requested_return_date,
                                       status, accessories_expected, scheduled_by, scheduled_at)
  values (v_asg.id, v_asg.asset_id, v_asg.employee_id, case when v_mine then 'employee' else 'hr' end, btrim(p_reason), auth.uid(),
          p_requested_date, case when v_mine then 'requested' else 'pending_handover' end, v_asg.accessories,
          case when not v_mine then auth.uid() end, case when not v_mine then now() end)
  returning id into v_id;
  select asset_tag into v_tag from public.hr_assets where id = v_asg.asset_id;
  perform hr_private.asset_event(v_asg.asset_id, 'return_requested', btrim(p_reason), v_asg.id, v_asg.employee_id, null, null, null, v_id);
  if v_mine then
    perform hr_private.notify_permission_holders('assets.manage', 'asset_return_requested', 'Asset return requested',
      v_tag || ': ' || btrim(p_reason), '/hr/assets?tab=returns', 'hr_asset_return', v_id::text, v_asg.employee_id);
  else
    perform hr_private.notify_employee(v_asg.employee_id, 'asset_return_requested', 'Please return company equipment',
      v_tag || coalesce(' by ' || to_char(p_requested_date, 'DD Mon YYYY'), '') || ': ' || btrim(p_reason),
      '/employee/assets', 'hr_asset_return', v_id::text);
  end if;
  return v_id;
end $$;

-- HR accepts an employee's request and schedules the handover.
create or replace function public.hr_schedule_asset_return(p_return uuid, p_return_date date default null, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.hr_asset_returns;
begin
  perform hr_private.asset_require_manage();
  select * into v_r from public.hr_asset_returns where id = p_return for update;
  if v_r.id is null then perform hr_private.fail('Return not found.', 'not_found'); end if;
  if v_r.status <> 'requested' then perform hr_private.fail('Only requested returns can be scheduled.', 'invalid_transition'); end if;
  if p_return_date is not null and p_return_date < hr_private.business_today() then
    perform hr_private.fail('The return date is in the past.', 'invalid_date');
  end if;
  update public.hr_asset_returns set status = 'pending_handover', scheduled_by = auth.uid(), scheduled_at = now(),
         requested_return_date = coalesce(p_return_date, requested_return_date) where id = v_r.id;
  perform hr_private.asset_event(v_r.asset_id, 'return_scheduled',
    coalesce('Hand over on ' || to_char(coalesce(p_return_date, v_r.requested_return_date), 'DD Mon YYYY'), 'Return accepted')
      || coalesce(': ' || nullif(btrim(p_note), ''), ''), v_r.assignment_id, v_r.employee_id, null, null, null, v_r.id);
  perform hr_private.notify_employee(v_r.employee_id, 'asset_return_scheduled', 'Asset return accepted',
    'Please hand the equipment over to HR/IT' || coalesce(' on ' || to_char(coalesce(p_return_date, v_r.requested_return_date), 'DD Mon YYYY'), '') || '.',
    '/employee/assets', 'hr_asset_return', v_r.id::text);
end $$;

-- HR/IT physically receives the asset. Closes the assignment (the employee
-- no longer holds it); the asset waits for inspection.
create or replace function public.hr_receive_asset_return(p_return uuid, p_accessories_returned text[] default null,
                                                          p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.hr_asset_returns; v_ret text[]; v_missing text[];
begin
  perform hr_private.asset_require_manage();
  select * into v_r from public.hr_asset_returns where id = p_return for update;
  if v_r.id is null then perform hr_private.fail('Return not found.', 'not_found'); end if;
  if v_r.status not in ('requested','pending_handover') then
    perform hr_private.fail('This return has already been received.', 'invalid_transition');
  end if;
  if v_r.employee_id = hr_private.current_employee_id() then
    perform hr_private.fail('Another asset manager must receive equipment you are returning.', 'self_action');
  end if;
  if length(p_note) > 2000 then perform hr_private.fail('The note is too long (2000 characters maximum).', 'invalid'); end if;
  perform 1 from public.hr_assets where id = v_r.asset_id for update;
  v_ret := case when p_accessories_returned is null then v_r.accessories_expected else hr_private.asset_clean_list(p_accessories_returned) end;
  select coalesce(array_agg(e order by e), '{}') into v_missing
    from unnest(v_r.accessories_expected) e where not (e = any (v_ret));
  update public.hr_asset_assignments
     set status = 'returned', returned_at = now(), return_notes = coalesce(nullif(btrim(p_note), ''), 'Returned — awaiting inspection')
   where id = v_r.assignment_id and status = 'active';
  if not found then perform hr_private.fail('The assignment is no longer active.', 'invalid_state'); end if;
  perform hr_private.asset_close_handover(v_r.assignment_id);
  update public.hr_asset_returns
     set status = 'received', received_at = now(), received_by = auth.uid(), receipt_notes = nullif(btrim(p_note), ''),
         accessories_returned = v_ret, missing_accessories = v_missing,
         scheduled_by = coalesce(scheduled_by, auth.uid()), scheduled_at = coalesce(scheduled_at, now())
   where id = v_r.id;
  perform hr_private.asset_set_state(v_r.asset_id, hr_private.asset_occupancy_status(v_r.asset_id));
  perform hr_private.asset_event(v_r.asset_id, 'return_received',
    'Received' || case when cardinality(v_missing) > 0 then ' · Missing: ' || array_to_string(v_missing, ', ') else '' end
      || coalesce(' · ' || nullif(btrim(p_note), ''), ''), v_r.assignment_id, v_r.employee_id, null, null, null, v_r.id);
  perform hr_private.notify_employee(v_r.employee_id, 'asset_returned', 'Asset return received',
    'HR/IT has received the equipment. Please confirm the return in your portal.', '/employee/assets', 'hr_asset_return', v_r.id::text);
end $$;

-- Inspection: condition, missing accessories, outcome. Optionally raises a
-- damage report (required when the condition is damaged).
create or replace function public.hr_inspect_asset_return(p_return uuid, p_condition text, p_outcome text, p_notes text default null,
                                                          p_missing_accessories text[] default null,
                                                          p_damage_category text default null, p_damage_severity text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.hr_asset_returns; v_asset public.hr_assets; v_damage uuid; v_missing text[];
begin
  perform hr_private.asset_require_manage();
  select * into v_r from public.hr_asset_returns where id = p_return for update;
  if v_r.id is null then perform hr_private.fail('Return not found.', 'not_found'); end if;
  if v_r.status <> 'received' then perform hr_private.fail('Only received returns can be inspected.', 'invalid_transition'); end if;
  if v_r.employee_id = hr_private.current_employee_id() then
    perform hr_private.fail('Another asset manager must inspect equipment you returned.', 'self_action');
  end if;
  if p_condition is null or p_condition not in ('new','good','fair','poor','damaged') then
    perform hr_private.fail('Record the condition of the returned asset.', 'invalid_condition');
  end if;
  if p_outcome is null or p_outcome not in ('available','in_repair','retired') then
    perform hr_private.fail('Choose the outcome: available, in repair or retired.', 'invalid_outcome');
  end if;
  select * into v_asset from public.hr_assets where id = v_r.asset_id for update;
  if v_asset.is_bulk and p_outcome = 'in_repair' then
    perform hr_private.fail('Quantity-tracked items go back to stock or are written off (retired).', 'invalid_outcome');
  end if;
  if p_condition = 'damaged' and p_outcome = 'available' then
    perform hr_private.fail('A damaged asset cannot go straight back into stock. Send it to repair or retire it.', 'invalid_outcome');
  end if;
  if length(p_notes) > 2000 then perform hr_private.fail('Notes are too long (2000 characters maximum).', 'invalid'); end if;
  v_missing := case when p_missing_accessories is null then v_r.missing_accessories else hr_private.asset_clean_list(p_missing_accessories) end;
  if p_condition = 'damaged' or p_damage_category is not null then
    v_damage := hr_private.asset_damage_create(v_asset.id, v_r.assignment_id, v_r.employee_id, hr_private.business_today(),
                  coalesce(p_damage_category, 'other'), coalesce(p_damage_severity, 'medium'),
                  coalesce(nullif(btrim(p_notes), ''), 'Damage found during return inspection'), 'under_review', v_r.id);
  end if;
  update public.hr_asset_returns
     set status = 'inspected', return_condition = p_condition, outcome = p_outcome, inspection_notes = nullif(btrim(p_notes), ''),
         missing_accessories = v_missing, inspected_by = auth.uid(), inspected_at = now(), damage_report_id = v_damage
   where id = v_r.id;
  perform hr_private.asset_event(v_asset.id, 'return_inspected',
    'Condition ' || p_condition || ' · outcome ' || replace(p_outcome, '_', ' ')
      || case when cardinality(v_missing) > 0 then ' · Missing: ' || array_to_string(v_missing, ', ') else '' end
      || coalesce(' · ' || nullif(btrim(p_notes), ''), ''), v_r.assignment_id, v_r.employee_id, null, null, v_damage, v_r.id);
end $$;

-- Completion applies the inspection outcome to the asset.
create or replace function public.hr_complete_asset_return(p_return uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.hr_asset_returns; v_asset public.hr_assets; v_qty int; v_status text;
begin
  perform hr_private.asset_require_manage();
  select * into v_r from public.hr_asset_returns where id = p_return for update;
  if v_r.id is null then perform hr_private.fail('Return not found.', 'not_found'); end if;
  if v_r.status <> 'inspected' then perform hr_private.fail('Inspect the returned asset before completing the return.', 'invalid_transition'); end if;
  if v_r.employee_id = hr_private.current_employee_id() then
    perform hr_private.fail('Another asset manager must complete the return of your equipment.', 'self_action');
  end if;
  if length(p_note) > 2000 then perform hr_private.fail('The note is too long (2000 characters maximum).', 'invalid'); end if;
  select * into v_asset from public.hr_assets where id = v_r.asset_id for update;
  select quantity into v_qty from public.hr_asset_assignments where id = v_r.assignment_id;
  update public.hr_asset_returns set status = 'completed', completed_by = auth.uid(), completed_at = now(),
         completion_note = nullif(btrim(p_note), '') where id = v_r.id;
  update public.hr_asset_assignments set return_condition = v_r.return_condition,
         return_notes = left(concat_ws(' · ', return_notes, v_r.inspection_notes), 2000)
   where id = v_r.assignment_id;
  if v_asset.is_bulk then
    if v_r.outcome = 'retired' then
      perform set_config('hr.asset_workflow', 'on', true);
      if v_asset.quantity - v_qty >= 1 then
        update public.hr_assets set quantity = quantity - v_qty where id = v_asset.id;
      end if;
      perform set_config('hr.asset_workflow', 'off', true);
      if v_asset.quantity - v_qty < 1 then perform hr_private.asset_set_state(v_asset.id, 'retired'); end if;
    end if;
    select status into v_status from public.hr_assets where id = v_asset.id;
    if v_status <> 'retired' then perform hr_private.asset_set_state(v_asset.id, hr_private.asset_occupancy_status(v_asset.id)); end if;
  else
    v_status := case v_r.outcome when 'available' then hr_private.asset_occupancy_status(v_asset.id) else v_r.outcome end;
    perform hr_private.asset_set_state(v_asset.id, v_status, v_r.return_condition);
  end if;
  perform hr_private.asset_event(v_asset.id, 'return_completed',
    'Return completed · asset ' || replace(v_r.outcome, '_', ' ') || coalesce(' · ' || nullif(btrim(p_note), ''), ''),
    v_r.assignment_id, v_r.employee_id, null, null, v_r.damage_report_id, v_r.id);
  if v_r.outcome = 'retired' then
    perform hr_private.asset_event(v_asset.id, 'retire',
      case when v_asset.is_bulk then format('%s unit(s) written off after return inspection', v_qty) else 'Retired after return inspection' end,
      v_r.assignment_id, v_r.employee_id, null, null, null, v_r.id);
  end if;
  perform hr_private.notify_employee(v_r.employee_id, 'asset_return_completed', 'Asset return completed',
    v_asset.asset_tag || ' has been checked in.', '/employee/assets', 'hr_asset_return', v_r.id::text);
end $$;

create or replace function public.hr_cancel_asset_return(p_return uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.hr_asset_returns; v_is_hr boolean := hr_private.has_permission('assets.manage'); v_mine boolean;
begin
  select * into v_r from public.hr_asset_returns where id = p_return for update;
  v_mine := v_r.id is not null and v_r.employee_id = hr_private.current_employee_id();
  if v_r.id is null or not (v_is_hr or v_mine) then perform hr_private.fail('Return not found.', 'not_found'); end if;
  if v_r.status not in ('requested','pending_handover') then
    perform hr_private.fail('A return can only be cancelled before the asset is received.', 'invalid_transition');
  end if;
  if not v_is_hr and (v_r.status <> 'requested' or v_r.source <> 'employee') then
    perform hr_private.fail('Only HR can cancel this return.', 'forbidden');
  end if;
  if v_is_hr and not v_mine and nullif(btrim(p_reason), '') is null then
    perform hr_private.fail('Give a reason for cancelling.', 'reason_required');
  end if;
  update public.hr_asset_returns set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(),
         cancel_reason = nullif(btrim(p_reason), '') where id = v_r.id;
  perform hr_private.asset_event(v_r.asset_id, 'return_cancelled', coalesce(nullif(btrim(p_reason), ''), 'Return cancelled'),
                                 v_r.assignment_id, v_r.employee_id, null, null, null, v_r.id);
end $$;

-- Employee confirms they handed the equipment over (after receipt).
create or replace function public.hr_acknowledge_asset_return(p_return uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.hr_asset_returns;
begin
  select * into v_r from public.hr_asset_returns where id = p_return for update;
  if v_r.id is null or v_r.employee_id is distinct from hr_private.current_employee_id() then
    perform hr_private.fail('Return not found.', 'not_found');
  end if;
  if v_r.status not in ('received','inspected','completed') then
    perform hr_private.fail('You can confirm the return after HR/IT has received the equipment.', 'invalid_state');
  end if;
  if v_r.employee_acknowledged_at is not null then return; end if;
  update public.hr_asset_returns set employee_acknowledged_at = now() where id = v_r.id;
  perform hr_private.asset_event(v_r.asset_id, 'return_acknowledged', 'Employee confirmed the return',
                                 v_r.assignment_id, v_r.employee_id, null, null, null, v_r.id);
end $$;

-- REPLACES 109 (same signature): one-step return by HR = receipt + inspection
-- + completion recorded together. A damaged individual asset goes to repair
-- with a damage report; nothing becomes available without the condition
-- being recorded.
create or replace function public.hr_return_asset(p_assignment uuid, p_condition text, p_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_asg public.hr_asset_assignments; v_asset public.hr_assets; v_ret uuid;
begin
  perform hr_private.asset_require_manage();
  if p_condition is null or p_condition not in ('new','good','fair','poor','damaged') then
    perform hr_private.fail('Record the condition of the returned asset.', 'invalid_condition');
  end if;
  select * into v_asg from public.hr_asset_assignments where id = p_assignment for update;
  if v_asg.id is null then perform hr_private.fail('Assignment not found.', 'not_found'); end if;
  if v_asg.status <> 'active' then perform hr_private.fail('This assignment is already closed.', 'invalid_state'); end if;
  select * into v_asset from public.hr_assets where id = v_asg.asset_id;
  v_ret := hr_private.asset_open_return(v_asg.id);
  if v_ret is null then
    insert into public.hr_asset_returns (assignment_id, asset_id, employee_id, source, reason, requested_by, status,
                                         accessories_expected, scheduled_by, scheduled_at)
    values (v_asg.id, v_asg.asset_id, v_asg.employee_id, 'quick', coalesce(nullif(btrim(p_notes), ''), 'Returned to HR/IT'),
            auth.uid(), 'pending_handover', v_asg.accessories, auth.uid(), now())
    returning id into v_ret;
  end if;
  perform public.hr_receive_asset_return(v_ret, null, p_notes);
  perform public.hr_inspect_asset_return(v_ret, p_condition,
            case when p_condition = 'damaged' and v_asset.is_bulk then 'retired'
                 when p_condition = 'damaged' then 'in_repair' else 'available' end,
            p_notes);
  perform public.hr_complete_asset_return(v_ret, null);
  -- Legacy history entry kept for existing reports / tests.
  perform hr_private.asset_event(v_asg.asset_id, 'return',
    'Returned in ' || p_condition || ' condition' || coalesce(': ' || nullif(btrim(p_notes), ''), ''), v_asg.id, v_asg.employee_id,
    null, null, null, v_ret);
end $$;

-- REPLACES 109: also cancels an open return when an assigned asset is lost,
-- and refuses retire / dispose while a return awaits inspection.
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
  if exists (select 1 from public.hr_asset_returns r where r.asset_id = v_asset.id and r.status in ('received','inspected')) then
    perform hr_private.fail('A returned unit of this asset is awaiting inspection. Complete that return first.', 'return_open');
  end if;
  select count(*) into v_active from public.hr_asset_assignments where asset_id = v_asset.id and status = 'active';
  if p_status in ('retired','disposed') and v_active > 0 then
    perform hr_private.fail('Record the return of this asset before retiring or disposing of it.', 'asset_assigned');
  end if;
  if p_status = 'lost' and v_active > 0 then
    if v_asset.is_bulk then
      perform hr_private.fail('Record returns for bulk items before marking the stock lost.', 'asset_assigned');
    end if;
    select * into v_asg from public.hr_asset_assignments where asset_id = v_asset.id and status = 'active' for update;
    update public.hr_asset_returns set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(),
           cancel_reason = 'Asset marked lost' where assignment_id = v_asg.id and status in ('requested','pending_handover');
    update public.hr_asset_assignments set status = 'lost', return_notes = nullif(btrim(p_details), '') where id = v_asg.id;
    perform hr_private.asset_close_handover(v_asg.id);
    perform hr_private.notify_employee(v_asg.employee_id, 'asset_lost', 'Asset marked as lost',
      v_asset.asset_tag || ' has been marked as lost.', '/employee/assets', 'hr_asset_assignment', v_asg.id::text);
  end if;
  if p_status = 'available' and v_asset.status not in ('in_repair','lost') then
    perform hr_private.fail('Only assets in repair or lost can be made available again.', 'invalid_state');
  end if;
  if p_status = 'available' and exists (select 1 from public.hr_asset_damage_reports d
                                         where d.asset_id = v_asset.id and d.status = 'under_repair') then
    perform hr_private.fail('Resolve the open repair (damage report) before returning the asset to service.', 'repair_open');
  end if;
  perform hr_private.asset_set_state(v_asset.id,
    case when p_status = 'available' then hr_private.asset_occupancy_status(v_asset.id) else p_status end);
  perform hr_private.asset_event(v_asset.id,
    case p_status when 'retired' then 'retire' when 'lost' then 'lost' when 'disposed' then 'dispose' else 'status_change' end,
    coalesce(nullif(btrim(p_details), ''), 'Status changed to ' || p_status), v_asg.id, v_asg.employee_id);
end $$;

-- ---------------------------------------------------------------------
-- Documents (Module 9 reuse)
-- ---------------------------------------------------------------------
-- Link an uploaded hr_documents row to a handover, damage report or return.
-- The document must belong to the same employee and use the matching asset
-- category. Employees may link damage evidence they uploaded themselves to
-- their own report while it is still Reported.
create or replace function public.hr_link_asset_document(p_document uuid, p_kind text, p_record uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_doc public.hr_documents; v_cat text; v_emp uuid; v_asset uuid; v_asg uuid; v_id uuid; v_ok boolean;
        v_is_hr boolean := hr_private.has_permission('assets.manage'); v_status text; v_reporter uuid;
begin
  if p_kind is null or p_kind not in ('handover','damage_evidence','return_confirmation') then
    perform hr_private.fail('Unknown document kind.', 'invalid');
  end if;
  select * into v_doc from public.hr_documents where id = p_document;
  if v_doc.id is null or v_doc.archived_at is not null then perform hr_private.fail('Document not found.', 'not_found'); end if;
  select code into v_cat from public.hr_document_categories where id = v_doc.category_id;
  if v_cat is distinct from (case p_kind when 'handover' then 'asset_handover' when 'damage_evidence' then 'asset_damage_evidence'
                                         else 'asset_return' end) then
    perform hr_private.fail('The document category does not match.', 'invalid_category');
  end if;
  if p_kind = 'handover' then
    select employee_id, asset_id, assignment_id into v_emp, v_asset, v_asg from public.hr_asset_handovers where id = p_record;
    v_ok := v_is_hr;
  elsif p_kind = 'return_confirmation' then
    select employee_id, asset_id, assignment_id into v_emp, v_asset, v_asg from public.hr_asset_returns where id = p_record;
    v_ok := v_is_hr;
  else
    select coalesce(employee_id, reporter_employee_id), asset_id, assignment_id, status, reported_by
      into v_emp, v_asset, v_asg, v_status, v_reporter from public.hr_asset_damage_reports where id = p_record;
    v_ok := (v_is_hr and v_status is distinct from 'resolved')
         or (v_reporter = auth.uid() and v_status = 'reported' and v_doc.uploaded_by = auth.uid());
  end if;
  if v_asset is null then perform hr_private.fail('Record not found.', 'not_found'); end if;
  if not coalesce(v_ok, false) then perform hr_private.fail('You are not allowed to attach documents to this record.', 'forbidden'); end if;
  if v_doc.employee_id is distinct from v_emp then
    perform hr_private.fail('The document belongs to a different employee.', 'invalid');
  end if;
  insert into public.hr_asset_document_links (document_id, asset_id, employee_id, kind, handover_id, damage_report_id, return_id, linked_by)
  values (v_doc.id, v_asset, v_emp, p_kind,
          case when p_kind = 'handover' then p_record end, case when p_kind = 'damage_evidence' then p_record end,
          case when p_kind = 'return_confirmation' then p_record end, auth.uid())
  returning id into v_id;
  perform hr_private.asset_event(v_asset, 'document_attached', replace(p_kind, '_', ' ') || ': ' || v_doc.title, v_asg, v_emp, null,
    case when p_kind = 'handover' then p_record end, case when p_kind = 'damage_evidence' then p_record end,
    case when p_kind = 'return_confirmation' then p_record end);
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Employee exit / onboarding integration
-- ---------------------------------------------------------------------
-- REPLACES 109 (same signature / columns): assets are "open" until their
-- return is inspected and completed, not merely received.
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
  where x.employee_id = p_employee
    and (x.status = 'active'
         or exists (select 1 from public.hr_asset_returns r where r.assignment_id = x.id and r.status in ('received','inspected')))
  order by x.assigned_at;
end $$;

-- Asset clearance status for an employee (exit checklist).
create or replace function public.hr_employee_asset_clearance(p_employee uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_items jsonb; v_missing jsonb; v_damage jsonb; v_last public.hr_asset_clearances; v_open int; v_issues int;
begin
  if not (p_employee = hr_private.current_employee_id()
          or hr_private.has_permission('assets.view') or hr_private.has_permission('assets.manage')
          or hr_private.has_permission('exit.view') or hr_private.has_permission('exit.manage')) then
    perform hr_private.fail('You are not allowed to view this employee''s assets.', 'forbidden');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'assignment_id', x.id, 'asset_id', a.id, 'asset_tag', a.asset_tag, 'asset_type', a.asset_type,
           'name', btrim(coalesce(a.brand, '') || ' ' || coalesce(a.model, '')), 'serial_number', a.serial_number,
           'quantity', x.quantity, 'accessories', to_jsonb(x.accessories), 'assignment_status', x.status,
           'return_id', r.id, 'return_status', coalesce(r.status, 'not_started'),
           'requested_return_date', r.requested_return_date) order by a.asset_tag), '[]')
    into v_items
    from public.hr_asset_assignments x
    join public.hr_assets a on a.id = x.asset_id
    left join public.hr_asset_returns r on r.assignment_id = x.id and r.status not in ('completed','cancelled')
   where x.employee_id = p_employee and (x.status = 'active' or r.status in ('received','inspected'));
  v_open := jsonb_array_length(v_items);
  select coalesce(jsonb_agg(jsonb_build_object('return_id', r.id, 'asset_tag', a.asset_tag, 'missing', to_jsonb(r.missing_accessories))), '[]')
    into v_missing
    from public.hr_asset_returns r join public.hr_assets a on a.id = r.asset_id
   where r.employee_id = p_employee and r.status <> 'cancelled' and cardinality(r.missing_accessories) > 0;
  select coalesce(jsonb_agg(jsonb_build_object('damage_report_id', d.id, 'asset_tag', a.asset_tag, 'status', d.status,
                                               'severity', d.severity)), '[]')
    into v_damage
    from public.hr_asset_damage_reports d join public.hr_assets a on a.id = d.asset_id
   where d.employee_id = p_employee and d.status <> 'resolved';
  v_issues := jsonb_array_length(v_missing) + jsonb_array_length(v_damage);
  select * into v_last from public.hr_asset_clearances where employee_id = p_employee order by cleared_at desc limit 1;
  return jsonb_build_object(
    'employee_id', p_employee,
    'outstanding', v_items,
    'missing_accessories', v_missing,
    'open_damage_reports', v_damage,
    'all_returned', v_open = 0,
    'issues_count', v_issues,
    'can_clear', v_open = 0,
    'cleared', v_last.id is not null and v_open = 0
               and v_last.cleared_at >= coalesce((select max(x.assigned_at) from public.hr_asset_assignments x where x.employee_id = p_employee), '-infinity'),
    'last_clearance', case when v_last.id is null then null else jsonb_build_object(
        'id', v_last.id, 'cleared_at', v_last.cleared_at, 'cleared_by', v_last.cleared_by, 'exit_id', v_last.exit_id,
        'notes', v_last.notes, 'issues_acknowledged', v_last.issues_acknowledged) end);
end $$;

-- Generate the return checklist for a leaver: a pending-handover return for
-- every active assignment that has none.
create or replace function public.hr_start_exit_asset_returns(p_employee uuid, p_exit uuid default null, p_return_date date default null)
returns int language plpgsql security definer set search_path = '' as $$
declare v_x public.hr_asset_assignments; v_n int := 0; v_exit public.hr_exits; v_ret uuid;
begin
  if not (hr_private.has_permission('assets.manage') or hr_private.has_permission('exit.manage')) then
    perform hr_private.fail('You are not allowed to start asset returns.', 'forbidden');
  end if;
  if p_employee = hr_private.current_employee_id() then
    perform hr_private.fail('Another HR user must start the asset returns for your exit.', 'self_action');
  end if;
  if p_exit is not null then
    select * into v_exit from public.hr_exits where id = p_exit;
    if v_exit.id is null or v_exit.employee_id <> p_employee then perform hr_private.fail('Exit case not found.', 'not_found'); end if;
  end if;
  if p_return_date is not null and p_return_date < hr_private.business_today() then
    perform hr_private.fail('The return date is in the past.', 'invalid_date');
  end if;
  for v_x in select * from public.hr_asset_assignments where employee_id = p_employee and status = 'active' for update loop
    continue when hr_private.asset_open_return(v_x.id) is not null;
    insert into public.hr_asset_returns (assignment_id, asset_id, employee_id, source, exit_id, reason, requested_by,
                                         requested_return_date, status, accessories_expected, scheduled_by, scheduled_at)
    values (v_x.id, v_x.asset_id, v_x.employee_id, 'exit', p_exit, 'Employee exit — return of company equipment', auth.uid(),
            coalesce(p_return_date, v_exit.approved_last_working_day, v_exit.proposed_last_working_day), 'pending_handover',
            v_x.accessories, auth.uid(), now())
    returning id into v_ret;
    perform hr_private.asset_event(v_x.asset_id, 'return_requested', 'Employee exit — return of company equipment',
                                   v_x.id, v_x.employee_id, null, null, null, v_ret);
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then
    perform hr_private.notify_employee(p_employee, 'asset_return_requested', 'Please return company equipment',
      format('%s item(s) must be returned before your last working day.', v_n), '/employee/assets', 'hr_employee', p_employee::text);
  end if;
  return v_n;
end $$;

-- Authorised asset clearance sign-off. Refused while anything is still held
-- or awaiting inspection; missing accessories / unresolved damage must be
-- explicitly acknowledged with a note (recovery is a separate, policy-based
-- payroll decision — nothing is deducted here).
create or replace function public.hr_record_asset_clearance(p_employee uuid, p_exit uuid default null, p_note text default null,
                                                            p_acknowledge_issues boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_c jsonb; v_id uuid; v_exit public.hr_exits;
begin
  perform hr_private.asset_require_manage();
  if p_employee = hr_private.current_employee_id() then
    perform hr_private.fail('Another asset manager must clear your assets.', 'self_action');
  end if;
  if p_exit is not null then
    select * into v_exit from public.hr_exits where id = p_exit;
    if v_exit.id is null or v_exit.employee_id <> p_employee then perform hr_private.fail('Exit case not found.', 'not_found'); end if;
  end if;
  v_c := public.hr_employee_asset_clearance(p_employee);
  if not (v_c ->> 'all_returned')::boolean then
    perform hr_private.fail('Assets are still assigned or awaiting return inspection.', 'open_assets');
  end if;
  if (v_c ->> 'issues_count')::int > 0 and not (coalesce(p_acknowledge_issues, false) and nullif(btrim(p_note), '') is not null) then
    perform hr_private.fail('Missing accessories or unresolved damage were found. Acknowledge them with a note to clear.', 'issues_unacknowledged');
  end if;
  if length(p_note) > 2000 then perform hr_private.fail('The note is too long (2000 characters maximum).', 'invalid'); end if;
  insert into public.hr_asset_clearances (employee_id, exit_id, cleared_by, notes, issues_acknowledged, snapshot)
  values (p_employee, p_exit, auth.uid(), nullif(btrim(p_note), ''), coalesce(p_acknowledge_issues, false), v_c)
  returning id into v_id;
  return v_id;
end $$;

-- Handover status per assignment (for onboarding checklists, Module 4).
create or replace function public.hr_employee_asset_handovers(p_employee uuid)
returns table (assignment_id uuid, handover_id uuid, asset_tag text, asset_type text, handover_status text,
               acknowledged_at timestamptz, confirmed_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not (p_employee = hr_private.current_employee_id()
          or hr_private.has_permission('assets.view') or hr_private.has_permission('assets.manage')
          or hr_private.has_permission('employees.view')) then
    perform hr_private.fail('You are not allowed to view this employee''s assets.', 'forbidden');
  end if;
  return query
  select x.id, h.id, a.asset_tag, a.asset_type, coalesce(h.status, case when x.acknowledged_at is null then 'pending_acknowledgement' else 'acknowledged' end),
         coalesce(h.acknowledged_at, x.acknowledged_at), h.confirmed_at
  from public.hr_asset_assignments x
  join public.hr_assets a on a.id = x.asset_id
  left join public.hr_asset_handovers h on h.assignment_id = x.id
  where x.employee_id = p_employee and x.status = 'active'
  order by x.assigned_at;
end $$;

-- ---------------------------------------------------------------------
-- Overview (counts from live records)
-- ---------------------------------------------------------------------
create or replace function public.hr_asset_overview(p_category text default null, p_employee uuid default null,
                                                    p_department uuid default null, p_status text default null,
                                                    p_location uuid default null, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb; v_today date := hr_private.business_today(); v_asg_filter boolean;
begin
  if not (hr_private.has_permission('assets.view') or hr_private.has_permission('assets.manage')) then
    perform hr_private.fail('You are not allowed to view the asset overview.', 'forbidden');
  end if;
  v_asg_filter := p_employee is not null or p_department is not null or p_from is not null or p_to is not null;
  with fa as (     -- filtered active assignments
    select x.* from public.hr_asset_assignments x join public.hr_employees e on e.id = x.employee_id
     where x.status = 'active'
       and (p_employee is null or x.employee_id = p_employee)
       and (p_department is null or e.department_id = p_department)
       and (p_from is null or (x.assigned_at at time zone hr_private.business_timezone())::date >= p_from)
       and (p_to is null or (x.assigned_at at time zone hr_private.business_timezone())::date <= p_to)
  ), a as (        -- filtered assets
    select s.* from public.hr_assets s
     where (p_category is null or s.asset_type = p_category)
       and (p_status is null or s.status = p_status)
       and (p_location is null or s.location_id = p_location)
       and (not v_asg_filter or exists (select 1 from fa where fa.asset_id = s.id))
  ), ax as (       -- filtered assignments of filtered assets
    select fa.* from fa join a on a.id = fa.asset_id
  ), rt as (
    select r.* from public.hr_asset_returns r join a on a.id = r.asset_id
     where r.status in ('requested','pending_handover','received','inspected')
       and (not v_asg_filter or exists (select 1 from public.hr_asset_assignments x join public.hr_employees e on e.id = x.employee_id
                                         where x.id = r.assignment_id
                                           and (p_employee is null or x.employee_id = p_employee)
                                           and (p_department is null or e.department_id = p_department)))
  )
  select jsonb_build_object(
    'total_assets',       (select count(*) from a),
    'total_units',        (select coalesce(sum(quantity), 0) from a),
    'assigned_assets',    (select count(*) from a where exists (select 1 from ax where ax.asset_id = a.id)),
    'assigned_units',     (select coalesce(sum(quantity), 0) from ax),
    'available_assets',   (select count(*) from a where status = 'available'),
    'under_repair',       (select count(*) from a where status = 'in_repair'),
    'in_inspection',      (select count(*) from a where status = 'in_inspection'),
    'damaged_assets',     (select count(*) from a where condition = 'damaged' and status not in ('retired','disposed')),
    'retired_assets',     (select count(*) from a where status in ('retired','disposed')),
    'lost_assets',        (select count(*) from a where status = 'lost'),
    'pending_handovers',  (select count(*) from public.hr_asset_handovers h join ax on ax.id = h.assignment_id
                            where h.status in ('pending_acknowledgement','acknowledged')),
    'pending_acknowledgements', (select count(*) from public.hr_asset_handovers h join ax on ax.id = h.assignment_id
                            where h.status = 'pending_acknowledgement'),
    'pending_returns',    (select count(*) from rt),
    'returns_awaiting_inspection', (select count(*) from rt where status in ('received','inspected')),
    'overdue_returns',    (select count(*) from ax
                            left join public.hr_asset_returns r on r.assignment_id = ax.id and r.status in ('requested','pending_handover')
                            where coalesce(r.requested_return_date, ax.expected_return_date) < v_today),
    'open_damage_reports',(select count(*) from public.hr_asset_damage_reports d join a on a.id = d.asset_id
                            where d.status <> 'resolved'
                              and (not v_asg_filter or d.assignment_id in (select id from ax))),
    'warranty_expiring_30d', (select count(*) from a where warranty_expiry between v_today and v_today + 30
                                and status not in ('retired','disposed','lost')),
    'by_category',        (select coalesce(jsonb_agg(jsonb_build_object('category', t.asset_type, 'total', t.total,
                                                                         'assigned', t.assigned, 'available', t.available)
                                                      order by t.asset_type), '[]')
                             from (select a.asset_type, count(*) total,
                                          count(*) filter (where exists (select 1 from ax where ax.asset_id = a.id)) assigned,
                                          count(*) filter (where a.status = 'available') available
                                     from a group by a.asset_type) t)
  ) into v;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- Asset requests (new / replacement)
-- ---------------------------------------------------------------------
alter table public.hr_asset_requests
  add column request_kind text not null default 'new' check (request_kind in ('new','replacement')),
  add column replaces_assignment uuid references public.hr_asset_assignments(id) on delete restrict;

drop function public.hr_request_asset(text, text);
create function public.hr_request_asset(p_asset_type text, p_reason text, p_kind text default 'new',
                                        p_replaces_assignment uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid := hr_private.current_employee_id(); v_id uuid;
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  if length(btrim(coalesce(p_asset_type, ''))) < 2 then perform hr_private.fail('Choose the type of asset you need.', 'invalid'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then perform hr_private.fail('Explain why you need it.', 'reason_required'); end if;
  if coalesce(p_kind, 'new') not in ('new','replacement') then perform hr_private.fail('Unknown request type.', 'invalid'); end if;
  if coalesce(p_kind, 'new') = 'replacement' then
    if p_replaces_assignment is null or not exists (select 1 from public.hr_asset_assignments x
                                                    where x.id = p_replaces_assignment and x.employee_id = v_me and x.status = 'active') then
      perform hr_private.fail('Choose the asset assigned to you that needs replacing.', 'invalid');
    end if;
  elsif p_replaces_assignment is not null then
    perform hr_private.fail('Only replacement requests refer to an existing asset.', 'invalid');
  end if;
  insert into public.hr_asset_requests (employee_id, asset_type, reason, request_kind, replaces_assignment)
  values (v_me, btrim(p_asset_type), btrim(p_reason), coalesce(p_kind, 'new'), p_replaces_assignment) returning id into v_id;
  perform hr_private.notify_permission_holders('assets.manage', 'asset_request_submitted',
    case when coalesce(p_kind, 'new') = 'replacement' then 'Asset replacement requested' else 'Asset requested' end,
    btrim(p_asset_type) || ': ' || left(btrim(p_reason), 200), '/hr/assets?tab=requests', 'hr_asset_request', v_id::text, v_me);
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke execute on function
  hr_private.assets_cost_split(),
  hr_private.asset_units_held(uuid), hr_private.asset_event(uuid, text, text, uuid, uuid, numeric, uuid, uuid, uuid),
  hr_private.asset_clean_list(text[]), hr_private.asset_checklist(jsonb),
  hr_private.asset_assign_full(uuid, uuid, date, text, int, uuid, text, text[], jsonb, text),
  hr_private.asset_open_return(uuid), hr_private.asset_close_handover(uuid),
  hr_private.asset_damage_create(uuid, uuid, uuid, date, text, text, text, text, uuid),
  hr_private.asset_history_no_delete(), hr_private.asset_events_immutable(),
  hr_private.asset_damage_guard(), hr_private.asset_return_guard()
from anon, public, authenticated;

revoke execute on function
  public.hr_asset_costs(uuid[]),
  public.hr_assign_asset_v2(uuid, uuid, date, text, int, text, text[], jsonb, text),
  public.hr_update_asset_handover(uuid, text, text[], jsonb, text),
  public.hr_acknowledge_asset_handover(uuid, text),
  public.hr_confirm_asset_handover(uuid, text),
  public.hr_submit_asset_damage_report(uuid, uuid, date, text, text, text),
  public.hr_update_asset_damage_report(uuid, date, text, text, text),
  public.hr_advance_asset_damage_report(uuid, text, text, text, numeric, text),
  public.hr_request_asset_return(uuid, text, date),
  public.hr_schedule_asset_return(uuid, date, text),
  public.hr_receive_asset_return(uuid, text[], text),
  public.hr_inspect_asset_return(uuid, text, text, text, text[], text, text),
  public.hr_complete_asset_return(uuid, text),
  public.hr_cancel_asset_return(uuid, text),
  public.hr_acknowledge_asset_return(uuid),
  public.hr_link_asset_document(uuid, text, uuid),
  public.hr_employee_asset_clearance(uuid),
  public.hr_start_exit_asset_returns(uuid, uuid, date),
  public.hr_record_asset_clearance(uuid, uuid, text, boolean),
  public.hr_employee_asset_handovers(uuid),
  public.hr_asset_overview(text, uuid, uuid, text, uuid, date, date),
  public.hr_request_asset(text, text, text, uuid)
from anon, public;
grant execute on function
  public.hr_asset_costs(uuid[]),
  public.hr_assign_asset_v2(uuid, uuid, date, text, int, text, text[], jsonb, text),
  public.hr_update_asset_handover(uuid, text, text[], jsonb, text),
  public.hr_acknowledge_asset_handover(uuid, text),
  public.hr_confirm_asset_handover(uuid, text),
  public.hr_submit_asset_damage_report(uuid, uuid, date, text, text, text),
  public.hr_update_asset_damage_report(uuid, date, text, text, text),
  public.hr_advance_asset_damage_report(uuid, text, text, text, numeric, text),
  public.hr_request_asset_return(uuid, text, date),
  public.hr_schedule_asset_return(uuid, date, text),
  public.hr_receive_asset_return(uuid, text[], text),
  public.hr_inspect_asset_return(uuid, text, text, text, text[], text, text),
  public.hr_complete_asset_return(uuid, text),
  public.hr_cancel_asset_return(uuid, text),
  public.hr_acknowledge_asset_return(uuid),
  public.hr_link_asset_document(uuid, text, uuid),
  public.hr_employee_asset_clearance(uuid),
  public.hr_start_exit_asset_returns(uuid, uuid, date),
  public.hr_record_asset_clearance(uuid, uuid, text, boolean),
  public.hr_employee_asset_handovers(uuid),
  public.hr_asset_overview(text, uuid, uuid, text, uuid, date, date),
  public.hr_request_asset(text, text, text, uuid)
to authenticated;
