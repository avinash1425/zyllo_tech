-- =====================================================================
-- 110_hr_exit.sql — Exit management (resignation / termination / ...)
-- =====================================================================
-- Depends on 100_hr_foundation.sql and 109_hr_assets.sql
-- (hr_employee_open_assets gates the asset_return clearance item).
--
-- Lifecycle:
--   employee resignation: hr_submit_resignation -> manager_review (when the
--     employee has a current manager) or hr_review
--   HR-initiated exit:    hr_initiate_exit -> notice_period directly
--   manager_review --hr_manager_review_exit--> hr_review
--     (the manager's decision is recorded; HR makes the final decision)
--   hr_review --hr_hr_review_exit--> notice_period | rejected
--   notice_period --hr_start_exit_clearance--> clearance (items created)
--   clearance --hr_move_exit_to_settlement--> final_settlement
--   final_settlement --hr_close_exit--> closed (employee exited, access off)
--   withdrawn: by the employee before HR approval, or by HR until closure.
-- All RPC-only; nothing is ever deleted (history is kept).
-- Apply ONLY to the local test cluster or the isolated dev project.
-- =====================================================================

insert into public.hr_settings (key, value, description) values
  ('exit', jsonb_build_object('notice_period_days', 30,
                              'notice_period_days_by_type', jsonb_build_object('intern', 15, 'contract', 15)),
   'Exit management: default notice period (days) and overrides by employment type code')
on conflict (key) do nothing;

create table public.hr_exits (
  id                         uuid primary key default gen_random_uuid(),
  employee_id                uuid not null references public.hr_employees(id) on delete restrict,
  initiated_by               text not null check (initiated_by in ('employee','hr')),
  initiated_by_user          uuid,
  exit_type                  text not null check (exit_type in ('resignation','termination','retirement','contract_end','other')),
  resignation_date           date,
  reason                     text check (reason is null or length(reason) <= 4000),
  notice_period_days         int check (notice_period_days is null or notice_period_days between 0 and 365),
  proposed_last_working_day  date,
  approved_last_working_day  date,
  status                     text not null default 'submitted'
                             check (status in ('submitted','manager_review','hr_review','notice_period','clearance',
                                               'final_settlement','closed','withdrawn','rejected')),
  employee_status_before     text,
  manager_decision           text check (manager_decision is null or manager_decision in ('approved','rejected')),
  manager_note               text check (manager_note is null or length(manager_note) <= 2000),
  manager_decided_by         uuid,
  manager_decided_at         timestamptz,
  hr_decision                text check (hr_decision is null or hr_decision in ('approved','rejected')),
  hr_note                    text check (hr_note is null or length(hr_note) <= 2000),
  hr_decided_by              uuid,
  hr_decided_at              timestamptz,
  auth_access_revoked_at     timestamptz,
  settlement_notes           text check (settlement_notes is null or length(settlement_notes) <= 4000),
  relieving_letter_issued_at timestamptz,
  experience_letter_issued_at timestamptz,
  closed_at                  timestamptz,
  closed_by                  uuid,
  withdrawn_at               timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  check (approved_last_working_day is null or resignation_date is null or approved_last_working_day >= resignation_date)
);
-- One open exit case per employee (closed / withdrawn / rejected are history).
create unique index hr_exits_one_open on public.hr_exits(employee_id)
  where status not in ('closed','withdrawn','rejected');
create index hr_exits_status on public.hr_exits(status);

create table public.hr_exit_events (
  id            bigint generated always as identity primary key,
  exit_id       uuid not null references public.hr_exits(id) on delete restrict,
  event_type    text not null,
  from_status   text,
  to_status     text,
  note          text,
  actor_user_id uuid,
  created_at    timestamptz not null default now()
);
create index hr_exit_events_exit on public.hr_exit_events(exit_id, created_at);

create table public.hr_exit_clearance_items (
  id           uuid primary key default gen_random_uuid(),
  exit_id      uuid not null references public.hr_exits(id) on delete restrict,
  item_key     text not null check (item_key in ('asset_return','access_revocation','document_handover','project_handover',
                                                 'hr_clearance','payroll_clearance','final_settlement','relieving_letter')),
  owner_role   text not null,
  status       text not null default 'pending' check (status in ('pending','completed','not_applicable')),
  completed_by uuid,
  completed_at timestamptz,
  note         text check (note is null or length(note) <= 2000),
  sort_order   smallint not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (exit_id, item_key)
);

create trigger hr_exits_touch before update on public.hr_exits
  for each row execute function hr_private.touch_updated_at();
create trigger hr_exit_clearance_items_touch before update on public.hr_exit_clearance_items
  for each row execute function hr_private.touch_updated_at();

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function hr_private.exit_can_view(p_employee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select hr_private.can_access_employee(p_employee, 'exit') or hr_private.has_permission('exit.manage')
$$;

create or replace function hr_private.exit_can_view_id(p_exit uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select hr_private.exit_can_view(x.employee_id) from public.hr_exits x where x.id = p_exit), false)
$$;

create or replace function hr_private.exit_notice_days(p_employee uuid)
returns int language sql stable security definer set search_path = '' as $$
  select coalesce(
    (hr_private.setting('exit') -> 'notice_period_days_by_type' ->> e.employment_type)::int,
    (hr_private.setting('exit') ->> 'notice_period_days')::int,
    30)
  from public.hr_employees e where e.id = p_employee
$$;

create or replace function hr_private.exit_log(p_exit uuid, p_event text, p_from text, p_to text, p_note text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.hr_exit_events (exit_id, event_type, from_status, to_status, note, actor_user_id)
  values (p_exit, p_event, p_from, p_to, p_note, auth.uid())
$$;

-- Notify the employee and their manager (if any) about an exit case.
create or replace function hr_private.exit_notify(p_exit uuid, p_title text, p_body text default null,
                                                  p_employee_too boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
declare v_emp uuid; v_mgr uuid; v_name text;
begin
  select x.employee_id, e.manager_id, coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name))
    into v_emp, v_mgr, v_name
    from public.hr_exits x join public.hr_employees e on e.id = x.employee_id where x.id = p_exit;
  if p_employee_too then
    perform hr_private.notify_employee(v_emp, 'exit_update', p_title, p_body, '/employee/exit', 'hr_exit', p_exit::text);
  end if;
  if v_mgr is not null then
    perform hr_private.notify_employee(v_mgr, 'exit_update', p_title || ': ' || v_name, p_body, '/employee/team/exits', 'hr_exit', p_exit::text);
  end if;
end $$;

create or replace function hr_private.exit_require_manage()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not hr_private.has_permission('exit.manage') then
    perform hr_private.fail('You are not allowed to manage exits.', 'forbidden');
  end if;
end $$;

-- Open (pending) clearance items, optionally excluding some keys.
create or replace function hr_private.exit_pending_items(p_exit uuid, p_exclude text[] default '{}')
returns text language sql stable security definer set search_path = '' as $$
  select string_agg(replace(item_key, '_', ' '), ', ' order by sort_order)
  from public.hr_exit_clearance_items
  where exit_id = p_exit and status = 'pending' and not (item_key = any (p_exclude))
$$;

-- ---------------------------------------------------------------------
-- RLS (read-only for clients; all writes through RPCs)
-- ---------------------------------------------------------------------
select hr_private.secure_table('public.hr_exits');
select hr_private.secure_table('public.hr_exit_events');
select hr_private.secure_table('public.hr_exit_clearance_items');

create policy hr_exits_read on public.hr_exits for select to authenticated
  using (hr_private.exit_can_view(employee_id));
create policy hr_exit_events_read on public.hr_exit_events for select to authenticated
  using (hr_private.exit_can_view_id(exit_id));
create policy hr_exit_clearance_items_read on public.hr_exit_clearance_items for select to authenticated
  using (hr_private.exit_can_view_id(exit_id));

select hr_private.enable_audit('public.hr_exits');
select hr_private.enable_audit('public.hr_exit_clearance_items');

-- ---------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------
create or replace function public.hr_submit_resignation(p_reason text, p_proposed_lwd date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me     uuid := hr_private.current_employee_id();
  v_emp    public.hr_employees;
  v_today  date := hr_private.business_today();
  v_notice int;
  v_lwd    date;
  v_status text;
  v_id     uuid;
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  select * into v_emp from public.hr_employees where id = v_me for update;
  if v_emp.status not in ('onboarding','probation','active') then
    perform hr_private.fail('A resignation cannot be submitted in your current employment status.', 'invalid_state');
  end if;
  if exists (select 1 from public.hr_exits where employee_id = v_me and status not in ('closed','withdrawn','rejected')) then
    perform hr_private.fail('You already have an open exit request.', 'exit_exists');
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    perform hr_private.fail('Please give a reason for your resignation.', 'reason_required');
  end if;
  v_notice := hr_private.exit_notice_days(v_me);
  v_lwd := coalesce(p_proposed_lwd, v_today + v_notice);
  if v_lwd < v_today then perform hr_private.fail('The proposed last working day is in the past.', 'invalid_date'); end if;
  v_status := case when v_emp.manager_id is not null and exists (
                     select 1 from public.hr_employees m where m.id = v_emp.manager_id and m.status not in ('exited','archived'))
                   then 'manager_review' else 'hr_review' end;

  insert into public.hr_exits (employee_id, initiated_by, initiated_by_user, exit_type, resignation_date, reason,
                               notice_period_days, proposed_last_working_day, status, employee_status_before)
  values (v_me, 'employee', auth.uid(), 'resignation', v_today, btrim(p_reason), v_notice, v_lwd, v_status, v_emp.status)
  returning id into v_id;
  perform hr_private.exit_log(v_id, 'submitted', null, v_status, btrim(p_reason));
  perform hr_private.exit_notify(v_id, 'Resignation submitted',
    'Proposed last working day: ' || to_char(v_lwd, 'DD Mon YYYY') || ' (notice period ' || v_notice || ' days).');
  return v_id;
end $$;

create or replace function public.hr_initiate_exit(p_employee uuid, p_exit_type text, p_reason text, p_lwd date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_emp public.hr_employees; v_today date := hr_private.business_today(); v_id uuid; v_resig date;
begin
  perform hr_private.exit_require_manage();
  if p_employee = hr_private.current_employee_id() then
    perform hr_private.fail('You cannot initiate your own exit.', 'self_action');
  end if;
  select * into v_emp from public.hr_employees where id = p_employee for update;
  if v_emp.id is null then perform hr_private.fail('Employee not found.', 'not_found'); end if;
  if v_emp.status in ('exited','archived') then perform hr_private.fail('This employee has already exited.', 'invalid_state'); end if;
  if p_exit_type is null or p_exit_type not in ('resignation','termination','retirement','contract_end','other') then
    perform hr_private.fail('Unknown exit type.', 'invalid');
  end if;
  if p_lwd is null then perform hr_private.fail('Set the last working day.', 'invalid_date'); end if;
  if v_emp.joining_date is not null and p_lwd < v_emp.joining_date then
    perform hr_private.fail('The last working day is before the joining date.', 'invalid_date');
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then perform hr_private.fail('Record the reason for the exit.', 'reason_required'); end if;
  if exists (select 1 from public.hr_exits where employee_id = p_employee and status not in ('closed','withdrawn','rejected')) then
    perform hr_private.fail('This employee already has an open exit case.', 'exit_exists');
  end if;
  v_resig := case when p_exit_type = 'resignation' then least(v_today, p_lwd) end;

  insert into public.hr_exits (employee_id, initiated_by, initiated_by_user, exit_type, resignation_date, reason,
                               notice_period_days, proposed_last_working_day, approved_last_working_day, status,
                               employee_status_before, hr_decision, hr_decided_by, hr_decided_at)
  values (p_employee, 'hr', auth.uid(), p_exit_type, v_resig, btrim(p_reason), greatest(p_lwd - v_today, 0),
          p_lwd, p_lwd, 'notice_period', v_emp.status, 'approved', auth.uid(), now())
  returning id into v_id;
  update public.hr_employees set status = 'notice_period', resignation_date = v_resig, last_working_date = p_lwd
   where id = p_employee;
  perform hr_private.exit_log(v_id, 'initiated', null, 'notice_period', p_exit_type || ': ' || btrim(p_reason));
  perform hr_private.exit_notify(v_id, 'Exit initiated',
    'Last working day: ' || to_char(p_lwd, 'DD Mon YYYY') || '.');
  return v_id;
end $$;

create or replace function public.hr_manager_review_exit(p_exit uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_x public.hr_exits;
begin
  select * into v_x from public.hr_exits where id = p_exit for update;
  if v_x.id is null or not hr_private.exit_can_view(v_x.employee_id) then
    perform hr_private.fail('Exit case not found.', 'not_found');
  end if;
  if not (hr_private.has_permission('exit.approve_team') and hr_private.is_manager_of(v_x.employee_id)) then
    perform hr_private.fail('Only the employee''s reporting manager can review this resignation.', 'forbidden');
  end if;
  if v_x.status <> 'manager_review' then
    perform hr_private.fail('This exit case is not awaiting manager review.', 'invalid_state');
  end if;
  if p_approve is null then perform hr_private.fail('Choose approve or reject.', 'invalid'); end if;
  if not p_approve and nullif(btrim(p_note), '') is null then
    perform hr_private.fail('Add a note explaining your concerns.', 'reason_required');
  end if;
  update public.hr_exits
     set manager_decision = case when p_approve then 'approved' else 'rejected' end,
         manager_note = nullif(btrim(p_note), ''), manager_decided_by = auth.uid(), manager_decided_at = now(),
         status = 'hr_review'
   where id = v_x.id;
  perform hr_private.exit_log(v_x.id, case when p_approve then 'manager_approved' else 'manager_rejected' end,
                              'manager_review', 'hr_review', nullif(btrim(p_note), ''));
  perform hr_private.notify_employee(v_x.employee_id, 'exit_update', 'Resignation reviewed by your manager',
    'Your resignation has moved to HR review.', '/employee/exit', 'hr_exit', v_x.id::text);
end $$;

create or replace function public.hr_hr_review_exit(p_exit uuid, p_approve boolean, p_approved_lwd date default null,
                                                    p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_x public.hr_exits; v_lwd date;
begin
  perform hr_private.exit_require_manage();
  select * into v_x from public.hr_exits where id = p_exit for update;
  if v_x.id is null then perform hr_private.fail('Exit case not found.', 'not_found'); end if;
  if v_x.employee_id = hr_private.current_employee_id() then
    perform hr_private.fail('You cannot decide your own exit.', 'self_action');
  end if;
  if v_x.status not in ('submitted','manager_review','hr_review') then
    perform hr_private.fail('This exit case is not awaiting HR review.', 'invalid_state');
  end if;
  if p_approve is null then perform hr_private.fail('Choose approve or reject.', 'invalid'); end if;
  if p_approve then
    v_lwd := coalesce(p_approved_lwd, v_x.proposed_last_working_day);
    if v_lwd is null then perform hr_private.fail('Set the approved last working day.', 'invalid_date'); end if;
    if v_x.resignation_date is not null and v_lwd < v_x.resignation_date then
      perform hr_private.fail('The last working day cannot be before the resignation date.', 'invalid_date');
    end if;
    update public.hr_exits
       set hr_decision = 'approved', hr_note = nullif(btrim(p_note), ''), hr_decided_by = auth.uid(), hr_decided_at = now(),
           approved_last_working_day = v_lwd, status = 'notice_period'
     where id = v_x.id;
    update public.hr_employees set status = 'notice_period', resignation_date = v_x.resignation_date, last_working_date = v_lwd
     where id = v_x.employee_id;
    perform hr_private.exit_log(v_x.id, 'hr_approved', v_x.status, 'notice_period', nullif(btrim(p_note), ''));
    perform hr_private.exit_notify(v_x.id, 'Resignation accepted',
      'Approved last working day: ' || to_char(v_lwd, 'DD Mon YYYY') || '.');
  else
    if nullif(btrim(p_note), '') is null then perform hr_private.fail('Add a note explaining the decision.', 'reason_required'); end if;
    update public.hr_exits
       set hr_decision = 'rejected', hr_note = btrim(p_note), hr_decided_by = auth.uid(), hr_decided_at = now(), status = 'rejected'
     where id = v_x.id;
    perform hr_private.exit_log(v_x.id, 'hr_rejected', v_x.status, 'rejected', btrim(p_note));
    perform hr_private.exit_notify(v_x.id, 'Resignation not accepted', btrim(p_note));
  end if;
end $$;

create or replace function public.hr_start_exit_clearance(p_exit uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_x public.hr_exits; v_user uuid;
begin
  perform hr_private.exit_require_manage();
  select * into v_x from public.hr_exits where id = p_exit for update;
  if v_x.id is null then perform hr_private.fail('Exit case not found.', 'not_found'); end if;
  if v_x.employee_id = hr_private.current_employee_id() then
    perform hr_private.fail('You cannot process your own exit.', 'self_action');
  end if;
  if v_x.status <> 'notice_period' then
    perform hr_private.fail('Clearance starts from the notice period stage.', 'invalid_state');
  end if;
  v_user := hr_private.employee_user_id(v_x.employee_id);
  insert into public.hr_exit_clearance_items (exit_id, item_key, owner_role, sort_order, status, note, completed_at) values
    (v_x.id, 'asset_return',      'hr_admin',      1, 'pending', null, null),
    (v_x.id, 'access_revocation', 'hr_admin',      2,
       case when v_user is null then 'not_applicable' else 'pending' end,
       case when v_user is null then 'No portal account linked.' end,
       case when v_user is null then now() end),
    (v_x.id, 'document_handover', 'manager',       3, 'pending', null, null),
    (v_x.id, 'project_handover',  'manager',       4, 'pending', null, null),
    (v_x.id, 'hr_clearance',      'hr_admin',      5, 'pending', null, null),
    (v_x.id, 'payroll_clearance', 'payroll_admin', 6, 'pending', null, null),
    (v_x.id, 'final_settlement',  'payroll_admin', 7, 'pending', null, null),
    (v_x.id, 'relieving_letter',  'hr_admin',      8, 'pending', null, null)
  on conflict (exit_id, item_key) do nothing;
  update public.hr_exits set status = 'clearance' where id = v_x.id;
  perform hr_private.exit_log(v_x.id, 'clearance_started', 'notice_period', 'clearance');
  perform hr_private.exit_notify(v_x.id, 'Exit clearance started',
    'Please return company assets and complete your handovers.');
end $$;

create or replace function public.hr_complete_clearance_item(p_item uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_item public.hr_exit_clearance_items; v_x public.hr_exits;
begin
  perform hr_private.exit_require_manage();
  select * into v_item from public.hr_exit_clearance_items where id = p_item for update;
  if v_item.id is null then perform hr_private.fail('Clearance item not found.', 'not_found'); end if;
  select * into v_x from public.hr_exits where id = v_item.exit_id for update;
  if v_x.employee_id = hr_private.current_employee_id() then
    perform hr_private.fail('You cannot process your own exit.', 'self_action');
  end if;
  if p_status is null or p_status not in ('completed','not_applicable','pending') then
    perform hr_private.fail('Status must be completed, not applicable or pending.', 'invalid_status');
  end if;
  if v_x.status not in ('clearance','final_settlement')
     or (p_status = 'pending' and v_x.status <> 'clearance') then
    perform hr_private.fail('Clearance items can only be changed while the exit is in clearance or final settlement.', 'invalid_state');
  end if;
  if v_x.status = 'final_settlement' and v_item.item_key not in ('final_settlement','relieving_letter') then
    perform hr_private.fail('Only settlement items can be changed at the final settlement stage.', 'invalid_state');
  end if;
  if p_status = 'not_applicable' and nullif(btrim(p_note), '') is null then
    perform hr_private.fail('Add a note explaining why this item does not apply.', 'reason_required');
  end if;
  if v_item.item_key = 'asset_return' and p_status <> 'pending'
     and exists (select 1 from public.hr_employee_open_assets(v_x.employee_id)) then
    perform hr_private.fail('Assets are still assigned to this employee. Record their return first.', 'open_assets');
  end if;
  if v_item.item_key = 'access_revocation' and p_status = 'completed'
     and hr_private.employee_user_id(v_x.employee_id) is not null and v_x.auth_access_revoked_at is null then
    perform hr_private.fail('Sign-in access has not been revoked yet. Run the access revocation first.', 'access_not_revoked');
  end if;
  update public.hr_exit_clearance_items
     set status = p_status,
         completed_by = case when p_status = 'pending' then null else auth.uid() end,
         completed_at = case when p_status = 'pending' then null else now() end,
         note = coalesce(nullif(btrim(p_note), ''), note)
   where id = v_item.id;
  perform hr_private.exit_log(v_x.id, 'clearance_item', v_item.status, p_status,
                              v_item.item_key || coalesce(': ' || nullif(btrim(p_note), ''), ''));
end $$;

-- Pre-flight for the access-revocation Edge Function (called with the HR
-- user's JWT): returns the auth user to ban.
create or replace function public.hr_can_revoke_exit_access(p_exit uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_x public.hr_exits;
begin
  perform hr_private.exit_require_manage();
  select * into v_x from public.hr_exits where id = p_exit;
  if v_x.id is null then perform hr_private.fail('Exit case not found.', 'not_found'); end if;
  if v_x.employee_id = hr_private.current_employee_id() then
    perform hr_private.fail('You cannot process your own exit.', 'self_action');
  end if;
  if v_x.status not in ('clearance','final_settlement','closed') then
    perform hr_private.fail('Access is revoked from the clearance stage onwards.', 'invalid_state');
  end if;
  return jsonb_build_object('exit_id', v_x.id, 'employee_id', v_x.employee_id,
                            'user_id', hr_private.employee_user_id(v_x.employee_id));
end $$;

-- Called ONLY by the access-revocation Edge Function (service role) after it
-- has banned the Supabase Auth user. HR then completes the clearance item.
create or replace function public.hr_record_auth_access_revoked(p_exit uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_x public.hr_exits;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    perform hr_private.fail('This operation is reserved for the access revocation service.', 'forbidden');
  end if;
  select * into v_x from public.hr_exits where id = p_exit for update;
  if v_x.id is null then perform hr_private.fail('Exit case not found.', 'not_found'); end if;
  if v_x.status not in ('clearance','final_settlement','closed') then
    perform hr_private.fail('Access is revoked from the clearance stage onwards.', 'invalid_state');
  end if;
  update public.hr_exits set auth_access_revoked_at = coalesce(auth_access_revoked_at, now()) where id = v_x.id;
  update public.hr_exit_clearance_items
     set note = 'Sign-in access revoked by the access service at ' || to_char(now() at time zone hr_private.business_timezone(), 'YYYY-MM-DD HH24:MI')
   where exit_id = v_x.id and item_key = 'access_revocation' and status = 'pending';
  perform hr_private.exit_log(v_x.id, 'auth_access_revoked', v_x.status, v_x.status, null);
end $$;

create or replace function public.hr_move_exit_to_settlement(p_exit uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_x public.hr_exits; v_pending text;
begin
  perform hr_private.exit_require_manage();
  select * into v_x from public.hr_exits where id = p_exit for update;
  if v_x.id is null then perform hr_private.fail('Exit case not found.', 'not_found'); end if;
  if v_x.employee_id = hr_private.current_employee_id() then
    perform hr_private.fail('You cannot process your own exit.', 'self_action');
  end if;
  if v_x.status <> 'clearance' then perform hr_private.fail('This exit case is not in clearance.', 'invalid_state'); end if;
  v_pending := hr_private.exit_pending_items(v_x.id, array['final_settlement','relieving_letter']);
  if v_pending is not null then
    perform hr_private.fail('Complete these clearance items first: ' || v_pending || '.', 'clearance_pending');
  end if;
  update public.hr_exits set status = 'final_settlement' where id = v_x.id;
  perform hr_private.exit_log(v_x.id, 'settlement_started', 'clearance', 'final_settlement');
  perform hr_private.exit_notify(v_x.id, 'Exit clearance complete', 'Your final settlement is being prepared.');
end $$;

create or replace function public.hr_record_exit_letter(p_exit uuid, p_letter text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_x public.hr_exits;
begin
  perform hr_private.exit_require_manage();
  if p_letter is null or p_letter not in ('relieving','experience') then
    perform hr_private.fail('Letter must be relieving or experience.', 'invalid');
  end if;
  select * into v_x from public.hr_exits where id = p_exit for update;
  if v_x.id is null then perform hr_private.fail('Exit case not found.', 'not_found'); end if;
  if v_x.employee_id = hr_private.current_employee_id() then
    perform hr_private.fail('You cannot process your own exit.', 'self_action');
  end if;
  if v_x.status not in ('final_settlement','closed') then
    perform hr_private.fail('Letters are issued at the final settlement stage.', 'invalid_state');
  end if;
  if p_letter = 'relieving' then
    update public.hr_exits set relieving_letter_issued_at = coalesce(relieving_letter_issued_at, now()) where id = v_x.id;
  else
    update public.hr_exits set experience_letter_issued_at = coalesce(experience_letter_issued_at, now()) where id = v_x.id;
  end if;
  perform hr_private.exit_log(v_x.id, p_letter || '_letter_issued', v_x.status, v_x.status);
  perform hr_private.notify_employee(v_x.employee_id, 'exit_update', initcap(p_letter) || ' letter issued', null,
    '/employee/documents', 'hr_exit', v_x.id::text);
end $$;

create or replace function public.hr_close_exit(p_exit uuid, p_settlement_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_x public.hr_exits; v_emp public.hr_employees; v_pending text; v_role text;
begin
  perform hr_private.exit_require_manage();
  select * into v_x from public.hr_exits where id = p_exit for update;
  if v_x.id is null then perform hr_private.fail('Exit case not found.', 'not_found'); end if;
  if v_x.employee_id = hr_private.current_employee_id() then
    perform hr_private.fail('You cannot process your own exit.', 'self_action');
  end if;
  if v_x.status <> 'final_settlement' then
    perform hr_private.fail('The exit can only be closed at the final settlement stage.', 'invalid_state');
  end if;
  v_pending := hr_private.exit_pending_items(v_x.id);
  if v_pending is not null then
    perform hr_private.fail('Complete these clearance items first: ' || v_pending || '.', 'clearance_pending');
  end if;
  if v_x.approved_last_working_day > hr_private.business_today() then
    perform hr_private.fail('The exit can be closed on or after the last working day ('
      || to_char(v_x.approved_last_working_day, 'DD Mon YYYY') || ').', 'before_last_working_day');
  end if;
  if exists (select 1 from public.hr_employee_open_assets(v_x.employee_id)) then
    perform hr_private.fail('Assets are still assigned to this employee.', 'open_assets');
  end if;
  select * into v_emp from public.hr_employees where id = v_x.employee_id for update;
  if v_emp.user_id is not null
     and exists (select 1 from public.hr_user_roles where user_id = v_emp.user_id and role_key = 'super_admin')
     and (select count(*) from public.hr_user_roles where role_key = 'super_admin') <= 1 then
    perform hr_private.fail('This employee is the last Super Admin. Assign another Super Admin before closing the exit.', 'last_super_admin');
  end if;

  perform set_config('hr.privileged_write', 'on', true);
  update public.hr_employees
     set status = 'exited', last_working_date = v_x.approved_last_working_day, portal_access = false
   where id = v_emp.id;
  perform set_config('hr.privileged_write', 'off', true);

  if v_emp.user_id is not null then
    for v_role in select role_key from public.hr_user_roles where user_id = v_emp.user_id order by role_key loop
      insert into public.hr_employee_history (employee_id, change_type, new_value, note, changed_by)
      values (v_emp.id, 'role', '-' || v_role, 'Revoked on exit', auth.uid());
    end loop;
    delete from public.hr_user_roles where user_id = v_emp.user_id;
  end if;

  update public.hr_exits
     set status = 'closed', closed_at = now(), closed_by = auth.uid(),
         settlement_notes = coalesce(nullif(btrim(p_settlement_notes), ''), settlement_notes)
   where id = v_x.id;
  perform hr_private.exit_log(v_x.id, 'closed', 'final_settlement', 'closed', nullif(btrim(p_settlement_notes), ''));
  perform hr_private.audit_event('EXIT_CLOSED', 'hr_exits', v_x.id::text,
    jsonb_build_object('employee_id', v_emp.id, 'last_working_day', v_x.approved_last_working_day));
  perform hr_private.exit_notify(v_x.id, 'Exit completed',
    'Last working day: ' || to_char(v_x.approved_last_working_day, 'DD Mon YYYY') || '. Thank you for your contributions.');
end $$;

-- Employee: withdraw own resignation before HR approval.
-- HR (exit.manage): withdraw/cancel any open case until closure; the
-- employee's previous status is restored.
create or replace function public.hr_withdraw_resignation(p_exit uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_x public.hr_exits; v_me uuid := hr_private.current_employee_id(); v_by_hr boolean := false;
begin
  select * into v_x from public.hr_exits where id = p_exit for update;
  if v_x.id is null or not hr_private.exit_can_view(v_x.employee_id) then
    perform hr_private.fail('Exit case not found.', 'not_found');
  end if;
  if v_x.employee_id = v_me then
    if v_x.initiated_by <> 'employee' or v_x.status not in ('submitted','manager_review','hr_review') then
      perform hr_private.fail('Your resignation can no longer be withdrawn here. Please contact HR.', 'invalid_state');
    end if;
  elsif hr_private.has_permission('exit.manage') then
    v_by_hr := true;
    if v_x.status not in ('submitted','manager_review','hr_review','notice_period','clearance') then
      perform hr_private.fail('This exit case can no longer be withdrawn.', 'invalid_state');
    end if;
  else
    perform hr_private.fail('You are not allowed to withdraw this exit.', 'forbidden');
  end if;
  update public.hr_exits set status = 'withdrawn', withdrawn_at = now() where id = v_x.id;
  if v_x.status in ('notice_period','clearance') then
    update public.hr_employees
       set status = coalesce(nullif(v_x.employee_status_before, 'notice_period'), 'active'),
           resignation_date = null, last_working_date = null
     where id = v_x.employee_id and status = 'notice_period';
  end if;
  perform hr_private.exit_log(v_x.id, case when v_by_hr then 'withdrawn_by_hr' else 'withdrawn' end,
                              v_x.status, 'withdrawn', nullif(btrim(p_note), ''));
  perform hr_private.exit_notify(v_x.id, 'Resignation withdrawn', nullif(btrim(p_note), ''));
end $$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke execute on function
  hr_private.exit_can_view(uuid), hr_private.exit_can_view_id(uuid), hr_private.exit_notice_days(uuid),
  hr_private.exit_log(uuid, text, text, text, text), hr_private.exit_notify(uuid, text, text, boolean),
  hr_private.exit_require_manage(), hr_private.exit_pending_items(uuid, text[])
from anon, public;
revoke execute on function
  hr_private.exit_log(uuid, text, text, text, text), hr_private.exit_notify(uuid, text, text, boolean)
from authenticated;
grant execute on function
  hr_private.exit_can_view(uuid), hr_private.exit_can_view_id(uuid), hr_private.exit_notice_days(uuid),
  hr_private.exit_pending_items(uuid, text[])
to authenticated, service_role;

revoke execute on function
  public.hr_submit_resignation(text, date),
  public.hr_initiate_exit(uuid, text, text, date),
  public.hr_manager_review_exit(uuid, boolean, text),
  public.hr_hr_review_exit(uuid, boolean, date, text),
  public.hr_start_exit_clearance(uuid),
  public.hr_complete_clearance_item(uuid, text, text),
  public.hr_can_revoke_exit_access(uuid),
  public.hr_move_exit_to_settlement(uuid),
  public.hr_record_exit_letter(uuid, text),
  public.hr_close_exit(uuid, text),
  public.hr_withdraw_resignation(uuid, text)
from anon, public;
grant execute on function
  public.hr_submit_resignation(text, date),
  public.hr_initiate_exit(uuid, text, text, date),
  public.hr_manager_review_exit(uuid, boolean, text),
  public.hr_hr_review_exit(uuid, boolean, date, text),
  public.hr_start_exit_clearance(uuid),
  public.hr_complete_clearance_item(uuid, text, text),
  public.hr_can_revoke_exit_access(uuid),
  public.hr_move_exit_to_settlement(uuid),
  public.hr_record_exit_letter(uuid, text),
  public.hr_close_exit(uuid, text),
  public.hr_withdraw_resignation(uuid, text)
to authenticated;

revoke execute on function public.hr_record_auth_access_revoked(uuid) from anon, public, authenticated;
grant execute on function public.hr_record_auth_access_revoked(uuid) to service_role;
