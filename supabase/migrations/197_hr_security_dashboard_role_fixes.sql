-- =====================================================================
-- 197_hr_security_dashboard_role_fixes.sql — integration fixes after
-- Modules 4–10 (runs after 190; 190 stays the last migration to redefine
-- scoped_employees / hr_report).
--
--   1. hr_private write helpers: undo the blanket
--      `grant execute on all functions in schema hr_private to authenticated`
--      of 170 / 171 / 190 for every helper that writes data, every trigger
--      function and every helper an earlier module deliberately revoked.
--   2. HR Dashboard: request counts / approvals card / SLA alert understand
--      Module 10 statuses and approval stages.
--   3. Default roles for permissions that only super_admin held.
--
-- Apply ONLY to the local test cluster or the isolated dev project.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1a. hr_report_export (190) is SECURITY INVOKER (it reads under the
-- caller's RLS) and was the only invoker-context caller of
-- hr_private.audit_event. It now audits through a narrow SECURITY DEFINER
-- helper that can only write a 'report_export' row and re-checks the
-- export permissions, so audit_event itself can be revoked. Body otherwise
-- identical to 190.
-- ---------------------------------------------------------------------
create or replace function hr_private.audit_report_export(p_key text, p_payroll boolean, p_context jsonb)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null or not hr_private.has_permission('reports.export')
     or (coalesce(p_payroll, false) and not hr_private.has_permission('payroll.export')) then
    perform hr_private.fail('You do not have permission to export reports.', 'forbidden');
  end if;
  insert into public.hr_audit_log (actor_user_id, actor_employee_id, action, table_name, record_id, context)
  values (auth.uid(), hr_private.current_employee_id(), 'report_export',
          case when p_payroll then 'hr_payroll_report' else 'hr_report' end, left(p_key, 200), p_context);
end $$;
revoke execute on function hr_private.audit_report_export(text, boolean, jsonb) from anon, public;
grant execute on function hr_private.audit_report_export(text, boolean, jsonb) to authenticated, service_role;

create or replace function public.hr_report_export(
  p_source text, p_key text, p_format text, p_from date default null, p_to date default null,
  p_department uuid default null, p_manager uuid default null, p_employment_type text default null,
  p_legal_entity uuid default null, p_employee uuid default null, p_location uuid default null, p_status text default null)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_max constant int := 50000;
  v_payroll boolean := (p_source = 'analytics' and p_key = 'payroll') or (p_source = 'report' and p_key like 'payroll%');
  r jsonb; v_rows int;
begin
  if p_source not in ('report','analytics') then perform hr_private.fail('Unknown export source.', 'invalid_filter'); end if;
  if p_format not in ('csv','xlsx','pdf') then perform hr_private.fail('Unsupported export format.', 'invalid_filter'); end if;
  if not hr_private.has_permission('reports.export') then
    perform hr_private.fail('You do not have permission to export reports.', 'forbidden');
  end if;
  if v_payroll and not hr_private.has_permission('payroll.export') then
    perform hr_private.fail('Exporting payroll data needs payroll export permission.', 'forbidden');
  end if;
  if ((p_source = 'analytics' and p_key = 'performance') or (p_source = 'report' and p_key = 'performance_summary'))
     and not hr_private.any_permission(array['performance.view','performance.view_team','performance.manage']) then
    perform hr_private.fail('Exporting performance data needs performance access.', 'forbidden');
  end if;

  if p_source = 'report' then
    r := hr_private.ra_report_full(p_key, p_from, p_to, p_department, p_manager, p_employment_type, p_legal_entity, p_employee, p_location, p_status);
    v_rows := (r ->> 'total')::int;
  else
    r := public.hr_report_analytics(p_key, p_from, p_to, p_department, p_manager, p_employment_type, p_legal_entity, p_employee, p_location);
    select coalesce(sum(jsonb_array_length(s -> 'rows')), 0) into v_rows from jsonb_array_elements(r -> 'sections') s;
  end if;
  if v_rows > v_max then
    perform hr_private.fail(format('This export has %s rows (limit %s). Narrow the filters or the date range.', v_rows, v_max), 'too_many_rows');
  end if;

  -- Audit WHO exported WHAT and with which filters — never the row data.
  perform hr_private.audit_report_export(p_key, v_payroll,
    jsonb_strip_nulls(jsonb_build_object('source', p_source, 'format', p_format, 'rows', v_rows, 'from', r ->> 'from', 'to', r ->> 'to',
      'department', p_department, 'manager', p_manager, 'employment_type', p_employment_type, 'legal_entity', p_legal_entity,
      'employee', p_employee, 'location', p_location, 'status', p_status, 'scope', r ->> 'scope')));
  return r || jsonb_build_object('export', jsonb_build_object('format', p_format, 'rows', v_rows, 'exported_at', now()));
end $$;
revoke execute on function public.hr_report_export(text, text, text, date, date, uuid, uuid, text, uuid, uuid, uuid, text) from anon, public;
grant execute on function public.hr_report_export(text, text, text, date, date, uuid, uuid, text, uuid, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 1b. Revoke write helpers and the intended-revoked set.
-- Every remaining caller of these is SECURITY DEFINER code (runs as the
-- owner) or a trigger (EXECUTE is not checked when a trigger fires).
-- RLS / view / invoker helpers (has_permission, current_employee_id,
-- request_row_visible, asset_is_mine, ra_*, load_x_emp, ...) keep the
-- default-privilege grant from 100. service_role grants are unchanged.
-- ---------------------------------------------------------------------
revoke execute on function
  -- notifications / outbox / audit (100, 108)
  hr_private.audit_event(text, text, text, jsonb),
  hr_private.notify_user(uuid, text, text, text, text, text, text),
  hr_private.notify_employee(uuid, text, text, text, text, text, text),
  hr_private.notify_permission_holders(text, text, text, text, text, text, text, uuid),
  hr_private.queue_email(text, text, text, text, text, text),
  hr_private.announcement_publish_now(uuid),
  hr_private.next_employee_code(),
  -- attendance (101 / 125)
  hr_private.attendance_write(uuid, date, timestamptz, timestamptz, text, text, text, text, text, text),
  hr_private.correction_event(uuid, text, text, text),
  -- leave (103 / 160)
  hr_private.ensure_leave_balance(uuid, uuid, int),
  hr_private.leave_event(uuid, text, text, text, text, text),
  hr_private.leave_type_eligibility(uuid, uuid, date, date),
  hr_private.leave_policy_fields(),
  hr_private.leave_year_closed(int),
  hr_private.leave_cf_expiry_date(uuid, int),
  hr_private.leave_is_weekly_off(uuid, date),
  hr_private.leave_day_rows(uuid, uuid, date, date, boolean, boolean),
  hr_private.leave_portion_on(uuid, date),
  hr_private.leave_scope(uuid, uuid, uuid),
  hr_private.leave_holiday_occurrences(date, date),
  -- recruitment (104 / 120)
  hr_private.generate_offer_letter(uuid, uuid),
  hr_private.issue_offer(uuid, boolean),
  hr_private.hold_application(uuid, text),
  hr_private.reject_application(uuid, text),
  hr_private.set_candidate_stage(uuid, text, text),
  hr_private.publish_opening_posting(uuid),
  -- payroll (170)
  hr_private.payroll_post_correction(uuid, uuid, numeric, text, uuid, uuid, uuid),
  hr_private.payroll_refresh_payment_status(uuid),
  -- documents (129)
  hr_private.doc_apply_details(uuid, jsonb),
  hr_private.doc_supersede(uuid, uuid),
  -- exit (110 / 130)
  hr_private.exit_log(uuid, text, text, text, text),
  hr_private.exit_notify(uuid, text, text, boolean),
  -- assets (109 / 141)
  hr_private.asset_assign(uuid, uuid, date, text, int, uuid),
  hr_private.asset_assign_full(uuid, uuid, date, text, int, uuid, text, text[], jsonb, text),
  hr_private.asset_set_state(uuid, text, text),
  hr_private.asset_event(uuid, text, text, uuid, uuid, numeric, uuid, uuid, uuid),
  hr_private.asset_close_handover(uuid),
  hr_private.asset_damage_create(uuid, uuid, uuid, date, text, text, text, text, uuid),
  hr_private.asset_open_return(uuid),
  hr_private.asset_require_manage(),
  hr_private.asset_units_held(uuid),
  hr_private.asset_clean_list(text[]),
  hr_private.asset_checklist(jsonb)
from public, anon, authenticated;

-- Trigger functions are never meant to be called directly (100–171 each
-- revoked some; blanket grants re-exposed all of them).
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'hr_private' and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. HR Dashboard — Module 10 request statuses and approval stages.
-- Same pattern as 116/117: 117's hr_dashboard moves to hr_private
-- unchanged (hr_dashboard_v117) and the public function becomes a thin
-- wrapper that replaces three request-related values:
--   kpis.pending_hr_requests  open | in_progress | waiting_on_employee |
--                             pending_approval | approved (awaiting fulfilment)
--   my_approvals 'hr_requests' (HR / payroll / finance desks) or
--               'team_requests' (manager-stage approvers only): number of
--               non-attendance inbox items awaiting the caller — the same
--               rule as the approval inbox (hr_requests_overview.awaiting_me:
--               pending stages the caller may decide, helpdesk tickets to
--               respond to, approved requests awaiting the caller's
--               fulfilment step). Attendance corrections keep their own card.
--   alerts 'hr_request_sla'   same status list; request viewers count every
--               visible overdue/urgent request, scoped approvers count the
--               overdue items awaiting them.
-- ---------------------------------------------------------------------
alter function public.hr_dashboard(date, date, uuid, text, uuid, text, uuid) set schema hr_private;
alter function hr_private.hr_dashboard(date, date, uuid, text, uuid, text, uuid) rename to hr_dashboard_v117;

create or replace function public.hr_dashboard(
  p_from date default null, p_to date default null, p_department uuid default null,
  p_employment_type text default null, p_manager uuid default null, p_status text default null,
  p_legal_entity uuid default null)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare
  r jsonb; k jsonb; v_appr jsonb; v_alerts jsonb; v_item jsonb; v_idx int; v_n bigint;
  v_open constant text[] := array['open','in_progress','waiting_on_employee','pending_approval','approved'];
  v_view boolean := hr_private.any_permission(array['hr_requests.view','hr_requests.manage']);
  v_desk boolean := hr_private.any_permission(array['hr_requests.manage','hr_requests.payroll','hr_requests.finance']);
  v_team boolean := hr_private.has_permission('hr_requests.approve_team');
begin
  r := hr_private.hr_dashboard_v117(p_from, p_to, p_department, p_employment_type, p_manager, p_status, p_legal_entity);
  k := r -> 'kpis';
  v_appr := coalesce(r -> 'my_approvals', '[]'::jsonb);
  v_alerts := coalesce(r -> 'alerts', '[]'::jsonb);

  -- KPI (gate unchanged from 112: request viewers; counted under RLS)
  if v_view then
    k := k || jsonb_build_object('pending_hr_requests', (select count(*) from public.hr_requests q where q.status = any (v_open)));
  end if;

  -- Approvals card
  select o::int - 1 into v_idx from jsonb_array_elements(v_appr) with ordinality t(a, o) where a ->> 'key' = 'hr_requests' limit 1;
  if v_desk or v_team then
    v_n := coalesce((public.hr_requests_overview('{}'::jsonb) ->> 'awaiting_me')::bigint, 0)
         - coalesce((public.hr_requests_overview('{"workflow":"attendance_correction"}'::jsonb) ->> 'awaiting_me')::bigint, 0);
    v_item := case when v_desk
      then jsonb_build_object('key', 'hr_requests', 'label', 'HR requests awaiting your action', 'path', '/hr/requests?tab=inbox&box=assigned', 'count', v_n)
      else jsonb_build_object('key', 'team_requests', 'label', 'Team requests to approve', 'path', '/hr/requests?tab=inbox&box=assigned', 'count', v_n) end;
    if v_idx is not null then v_appr := jsonb_set(v_appr, array[v_idx::text], v_item);
    else v_appr := v_appr || jsonb_build_array(v_item); end if;
  elsif v_idx is not null then
    v_appr := v_appr - v_idx;
  end if;

  -- SLA alert
  v_alerts := coalesce((select jsonb_agg(a) from jsonb_array_elements(v_alerts) a where a ->> 'type' <> 'hr_request_sla'), '[]'::jsonb);
  v_n := 0;
  if v_view then
    select count(*) into v_n from public.hr_requests q
      where q.status = any (v_open) and (q.sla_due_at < now() or q.priority = 'urgent');
    if v_n > 0 then
      v_alerts := v_alerts || jsonb_build_object('type', 'hr_request_sla', 'priority', 'high', 'title', 'HR requests overdue or urgent',
        'detail', v_n || ' open request(s) past their SLA or marked urgent', 'count', v_n, 'path', '/hr/requests?tab=inbox&box=overdue');
    end if;
  elsif v_desk or v_team then
    select count(*) into v_n from jsonb_array_elements(public.hr_approval_inbox('overdue', '{}'::jsonb)) x
      where x ->> 'source' = 'request' and x ->> 'next_action' is not null;
    if v_n > 0 then
      v_alerts := v_alerts || jsonb_build_object('type', 'hr_request_sla', 'priority', 'high', 'title', 'Requests awaiting you are overdue',
        'detail', v_n || ' request(s) awaiting your action are past their SLA', 'count', v_n, 'path', '/hr/requests?tab=inbox&box=overdue');
    end if;
  end if;

  return r || jsonb_build_object('kpis', k, 'my_approvals', v_appr, 'alerts', (
    select coalesce(jsonb_agg(a order by case a ->> 'priority' when 'high' then 0 when 'medium' then 1 else 2 end,
                                         a ->> 'date' nulls last, a ->> 'title'), '[]'::jsonb)
    from jsonb_array_elements(v_alerts) a));
end $$;

revoke execute on function public.hr_dashboard(date, date, uuid, text, uuid, text, uuid) from anon, public;
grant execute on function public.hr_dashboard(date, date, uuid, text, uuid, text, uuid) to authenticated;
revoke execute on function hr_private.hr_dashboard_v117(date, date, uuid, text, uuid, text, uuid) from anon, public;
grant execute on function hr_private.hr_dashboard_v117(date, date, uuid, text, uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Default roles for permissions only super_admin held.
--   hr_requests.payroll      -> payroll_admin   (already seeded by 180; kept idempotent)
--   hr_requests.finance      -> payroll_admin   (no finance role exists)
--   hr_requests.approve_team -> manager         (already seeded by 180)
--   exit.clearance_it        -> new system role it_admin ("IT Admin")
--   exit.override            -> super_admin only (break-glass override of
--                               mandatory clearance / failed access revocation;
--                               assign deliberately in HR Settings > Roles)
-- Payroll Admin deliberately gets no dashboard access (owner decision).
-- ---------------------------------------------------------------------
insert into public.hr_roles (key, name, description, is_system) values
  ('it_admin', 'IT Admin', 'Completes IT clearance and sign-in access revocation items of employee exits. No other HR access.', true)
on conflict do nothing;

insert into public.hr_role_permissions (role_key, permission_key) values
  ('payroll_admin', 'hr_requests.payroll'),
  ('payroll_admin', 'hr_requests.finance'),
  ('manager',       'hr_requests.approve_team'),
  ('it_admin',      'exit.clearance_it')
on conflict do nothing;

-- The clearance page lists exits in clearance with the employee's name,
-- code and sign-in account. 130 already lets exit.clearance_it holders read
-- those exits, their clearance items and access-revocation attempts; this
-- adds the matching employee rows (only employees with an exit from the
-- clearance stage on — the same window as hr_exits_read_clearance_owners).
-- hr_exits policies do not read hr_employees, so there is no recursion.
create policy hr_employees_read_it_clearance on public.hr_employees for select to authenticated
  using (hr_private.has_permission('exit.clearance_it')
         and exists (select 1 from public.hr_exits x
                     where x.employee_id = hr_employees.id and x.status in ('clearance','final_settlement','closed')));

-- ---------------------------------------------------------------------
-- 4. Guard: fail the migration if any helper above is still executable by
-- an API role (e.g. a later edit re-adds a blanket grant before this file).
-- Future migrations must NOT run
--   grant execute on all functions in schema hr_private to authenticated;
-- grant new RLS helpers individually instead.
-- ---------------------------------------------------------------------
do $$
declare v text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'hr_private'
    and (p.prorettype = 'trigger'::regtype or p.proname = any (array[
      'audit_event','notify_user','notify_employee','notify_permission_holders','queue_email','announcement_publish_now',
      'next_employee_code','attendance_write','correction_event','ensure_leave_balance','leave_event','leave_type_eligibility',
      'leave_policy_fields','leave_year_closed','leave_cf_expiry_date','leave_is_weekly_off','leave_day_rows','leave_portion_on',
      'leave_scope','leave_holiday_occurrences','generate_offer_letter','issue_offer','hold_application','reject_application',
      'set_candidate_stage','publish_opening_posting','payroll_post_correction','payroll_refresh_payment_status',
      'doc_apply_details','doc_supersede','exit_log','exit_notify','asset_assign','asset_assign_full','asset_set_state',
      'asset_event','asset_close_handover','asset_damage_create','asset_open_return','asset_require_manage',
      'asset_units_held','asset_clean_list','asset_checklist']))
    and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE'));
  if v is not null then
    raise exception '197: hr_private helpers still executable by API roles: %', v;
  end if;
end $$;
