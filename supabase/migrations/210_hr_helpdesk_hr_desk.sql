-- =====================================================================
-- 210_hr_helpdesk_hr_desk.sql — restricted HR / workplace support desk
-- =====================================================================
-- Until now the only key that let someone be assigned to and resolve HR or
-- workplace helpdesk tickets was hr_requests.manage, which also exposes every
-- confidential grievance / misconduct ticket and every request workflow.
-- This adds helpdesk.hr, modelled on helpdesk.it (181):
--
--   An HR-desk ticket is: workflow = 'helpdesk', NOT confidential (ticket and
--   category), support area 'hr' or 'workplace', NOT payroll-routed (payroll
--   queries stay with Payroll), and never in the grievance / workplace_conduct
--   categories (hard backstop even if someone unticks "confidential" on them).
--
--   helpdesk.hr holders see, reply to (incl. internal notes), assign,
--   re-prioritise, re-categorise and resolve HR-desk tickets only. They do NOT
--   see: confidential tickets, grievances, misconduct cases, their attachments
--   or comments, IT tickets, payroll queries, letters, profile changes,
--   reimbursements, salary advances, attendance corrections or the audit log.
--   Being assigned grants nothing extra (assignment is limited to handlers).
--
-- Every read path already funnels through request_row_visible /
-- request_can_handle / request_handler_users (RLS on hr_requests, comments,
-- events, attachments, the hr-request-files bucket, helpdesk queue / ticket /
-- assignees / summary, approval inbox), so extending those three plus the
-- notification role filter covers them. hr_requests.manage is NOT changed.
--
-- Role defaults: super_admin only (like helpdesk.it). No other role, and no
-- employee, receives helpdesk.hr; assign it deliberately in HR Settings > Roles.
--
-- Data: only the permission catalog and the super_admin grant are written.
-- Depends on: 100, 111, 180, 181. Idempotent (safe to re-run).
-- Apply ONLY to the local test cluster or the isolated dev project.
-- =====================================================================

insert into public.hr_permissions (key, module, action, description) values
  ('helpdesk.hr', 'helpdesk', 'hr', 'HR / workplace support desk: see and handle non-confidential HR and workplace helpdesk tickets only (no grievances, misconduct, payroll queries or other request types)')
on conflict (key) do update set module = excluded.module, action = excluded.action, description = excluded.description;

insert into public.hr_role_permissions (role_key, permission_key)
select 'super_admin', 'helpdesk.hr' where exists (select 1 from public.hr_roles where key = 'super_admin')
on conflict do nothing;

-- Non-confidential helpdesk ticket for the HR / workplace desk?
create or replace function hr_private.request_hr_desk_ticket(p_request uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select r.workflow = 'helpdesk'
                          and not r.is_confidential and not c.is_confidential
                          and c.support_area in ('hr','workplace')
                          and c.code not in ('grievance','workplace_conduct')
                          and not hr_private.request_payroll_routed(r.id)
                   from public.hr_requests r join public.hr_request_categories c on c.id = r.category_id
                   where r.id = p_request), false)
$$;
revoke execute on function hr_private.request_hr_desk_ticket(uuid) from anon, public;
grant execute on function hr_private.request_hr_desk_ticket(uuid) to authenticated, service_role;

-- HR-desk staff read the categories (ticket forms, filters). Same as 181 plus helpdesk.hr.
drop policy if exists hr_request_categories_read on public.hr_request_categories;
create policy hr_request_categories_read on public.hr_request_categories for select to authenticated
  using (hr_private.current_employee_id() is not null or hr_private.has_permission('hr_requests.view')
         or hr_private.has_permission('hr_requests.manage') or hr_private.has_permission('helpdesk.it')
         or hr_private.has_permission('helpdesk.hr'));

-- ---------------------------------------------------------------------
-- Functions (CREATE OR REPLACE keeps existing grants; bodies copied from 181,
-- only the helpdesk.hr branch is added)
-- ---------------------------------------------------------------------
-- Ticket visibility: helpdesk.hr sees non-confidential HR / workplace helpdesk tickets only (comments, events, attachments, storage, queue, summary and inbox all reuse this).
CREATE OR REPLACE FUNCTION hr_private.request_row_visible(p_request uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((
    select r.employee_id = hr_private.current_employee_id()
        or (r.status <> 'draft' and (
              hr_private.has_permission('hr_requests.manage')
           or (not r.is_confidential and r.workflow in ('helpdesk','hr_letter') and hr_private.has_permission('hr_requests.view'))
           -- IT support desk: non-confidential IT tickets only.
           or (hr_private.has_permission('helpdesk.it') and hr_private.request_it_ticket(r.id))
           -- HR / workplace support desk (210): non-confidential HR and workplace tickets only.
           or (hr_private.has_permission('helpdesk.hr') and hr_private.request_hr_desk_ticket(r.id))
           -- Routed access. A confidential helpdesk request (grievance) is never routed; workflow
           -- requests (e.g. salary advances, confidential by default) are visible only along their route.
           or ((not r.is_confidential or r.workflow <> 'helpdesk') and (
                  (hr_private.has_permission('hr_requests.payroll') and hr_private.request_payroll_routed(r.id))
               or (hr_private.has_permission('hr_requests.finance')
                   and exists (select 1 from public.hr_request_approvals a where a.request_id = r.id and a.stage_role = 'finance'))
               or (hr_private.has_permission('hr_requests.approve_team')
                   and exists (select 1 from public.hr_request_approvals a
                               where a.request_id = r.id and a.stage_role = 'manager'
                                 and hr_private.current_employee_id() in (a.approver_employee_id, a.delegate_employee_id)))))))
    from public.hr_requests r where r.id = p_request), false)
$function$;

-- Reply / internal notes / assign / status / re-categorise: same scope as visibility.
CREATE OR REPLACE FUNCTION hr_private.request_can_handle(p_request uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((
    select r.employee_id is distinct from hr_private.current_employee_id()
       and r.status <> 'draft'
       and (hr_private.has_permission('hr_requests.manage')
            or (hr_private.has_permission('helpdesk.it') and hr_private.request_it_ticket(r.id))
            or (hr_private.has_permission('helpdesk.hr') and hr_private.request_hr_desk_ticket(r.id))
            or ((not r.is_confidential or r.workflow <> 'helpdesk')
                and hr_private.has_permission('hr_requests.payroll') and hr_private.request_payroll_routed(r.id)))
    from public.hr_requests r where r.id = p_request), false)
$function$;

-- Assignable handlers and notification recipients: helpdesk.hr holders only for HR-desk tickets.
CREATE OR REPLACE FUNCTION hr_internal.request_handler_users(p_request uuid)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.hr_requests;
begin
  select * into r from public.hr_requests where id = p_request;
  return query select u from hr_internal.permission_users('hr_requests.manage', r.employee_id) u;
  if (not r.is_confidential or r.workflow <> 'helpdesk') and hr_private.request_payroll_routed(r.id) then
    return query select u from hr_internal.permission_users('hr_requests.payroll', r.employee_id) u;
  end if;
  if hr_private.request_it_ticket(r.id) then
    return query select u from hr_internal.permission_users('helpdesk.it', r.employee_id) u;
  end if;
  if hr_private.request_hr_desk_ticket(r.id) then
    return query select u from hr_internal.permission_users('helpdesk.hr', r.employee_id) u;
  end if;
end $function$;

-- New / moved HR-desk tickets also notify helpdesk.hr holders (they do not hold the category's default role, e.g. hr_admin). Recipients still come only from request_handler_users, so confidential tickets never reach them.
CREATE OR REPLACE FUNCTION hr_internal.request_notify_staff(p_request uuid, p_title text, p_body text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.hr_requests; v_role text; v_user uuid; v_any boolean := false; v_link text := hr_internal.request_link(p_request, true);
begin
  select * into r from public.hr_requests where id = p_request;
  if r.assigned_to is not null then
    perform hr_private.notify_employee(r.assigned_to, 'hr_request', p_title, p_body, v_link, 'hr_request', r.id::text);
    return;
  end if;
  select default_assignee_role into v_role from public.hr_request_categories where id = r.category_id;
  for v_user in
    select distinct h from hr_internal.request_handler_users(r.id) h
    where v_role is null or exists (select 1 from public.hr_user_roles ur where ur.user_id = h and ur.role_key = v_role)
       or (hr_private.request_hr_desk_ticket(r.id) and hr_internal.user_has_permission(h, 'helpdesk.hr'))
  loop
    perform hr_private.notify_user(v_user, 'hr_request', p_title, p_body, v_link, 'hr_request', r.id::text);
    v_any := true;
  end loop;
  if not v_any then
    for v_user in select distinct h from hr_internal.request_handler_users(r.id) h loop
      perform hr_private.notify_user(v_user, 'hr_request', p_title, p_body, v_link, 'hr_request', r.id::text);
    end loop;
  end if;
end $function$;

-- End of 210.
