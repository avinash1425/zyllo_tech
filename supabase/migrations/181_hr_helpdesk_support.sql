-- =====================================================================
-- 181_hr_helpdesk_support.sql — Helpdesk & Support
-- =====================================================================
-- Extends the single HR request system (111 + 180). Helpdesk tickets stay
-- hr_requests rows with workflow = 'helpdesk'; nothing here creates a second
-- ticket table or conversation engine.
--
--   * Support areas: every category gets `support_area` (hr | it |
--     workplace). New IT categories (hardware, software, network / email)
--     and workplace categories (facilities, health & safety, harassment or
--     misconduct — confidential) are seeded; it_access moves to IT and
--     grievance to Workplace.
--   * IT support desk: new permission helpdesk.it (granted to the it_admin
--     role from 197 and super_admin). Holders see and handle ONLY
--     non-confidential tickets in IT categories — no HR, payroll, workplace
--     or confidential tickets, and no employee master access. Requester
--     names reach them through the helpdesk RPCs below, not hr_employees.
--   * Ticket numbers (HD-00001), first response time, reopen count,
--     requester satisfaction rating (1–5) and a complete history: assignment,
--     re-prioritisation, re-categorisation, status changes, requester close,
--     reopen and rating are written to hr_request_events (180).
--   * Notification links for helpdesk tickets point to /hr/helpdesk/<id> and
--     /employee/helpdesk/<id>.
--
-- Depends on: 100, 111, 116, 180. 197 creates it_admin too (idempotent).
-- Write helpers and trigger functions live in hr_internal (no API usage).
-- Apply ONLY to the local test cluster or the isolated dev project.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Permission + IT role
-- ---------------------------------------------------------------------
insert into public.hr_permissions (key, module, action, description) values
  ('helpdesk.it', 'helpdesk', 'it', 'IT support desk: see and handle non-confidential IT support tickets only')
on conflict (key) do nothing;

insert into public.hr_roles (key, name, description, is_system) values
  ('it_admin', 'IT Admin', 'Completes IT clearance and sign-in access revocation items of employee exits. No other HR access.', true)
on conflict do nothing;
update public.hr_roles
   set description = 'Handles IT support tickets and completes IT clearance / access revocation items of employee exits. No other HR access.'
 where key = 'it_admin';

insert into public.hr_role_permissions (role_key, permission_key) values
  ('it_admin',    'helpdesk.it'),
  ('super_admin', 'helpdesk.it')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 2. Categories: support area + new IT / workplace categories
-- ---------------------------------------------------------------------
alter table public.hr_request_categories
  add column support_area text not null default 'hr' check (support_area in ('hr','it','workplace'));

update public.hr_request_categories
   set support_area = 'it', default_assignee_role = 'it_admin', name = 'Accounts & access',
       description = 'Sign-in, password, account or tool access problems'
 where code = 'it_access';
update public.hr_request_categories set support_area = 'workplace' where code = 'grievance';

insert into public.hr_request_categories (code, name, description, default_assignee_role, sla_hours, is_confidential, active, sort_order, support_area) values
  ('it_hardware',          'Laptop & hardware',        'Laptop, monitor, keyboard, headset or other equipment faults',          'it_admin', 24, false, true, 20, 'it'),
  ('it_software',          'Software & tools',         'Installing, licensing or fixing software and work tools',               'it_admin', 24, false, true, 21, 'it'),
  ('it_network',           'Network, email & VPN',     'Wi-Fi, internet, VPN, company email or calendar problems',              'it_admin', 8,  false, true, 22, 'it'),
  ('workplace_facilities', 'Facilities & workspace',   'Desk, seating, power, air conditioning, cleanliness or office access',  'hr_admin', 48, false, true, 30, 'workplace'),
  ('workplace_safety',     'Health & safety',          'A hazard, injury, near miss or other safety concern at work',           'hr_admin', 24, false, true, 31, 'workplace'),
  ('workplace_conduct',    'Harassment or misconduct', 'Confidential report of harassment, discrimination or misconduct',       'hr_admin', 48, true,  true, 32, 'workplace')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- 3. Ticket columns
-- ---------------------------------------------------------------------
create sequence public.hr_helpdesk_ticket_seq;
revoke all on sequence public.hr_helpdesk_ticket_seq from public, anon, authenticated;

alter table public.hr_requests
  add column ticket_no            text unique check (ticket_no is null or ticket_no ~ '^HD-[0-9]{5,}$'),
  add column first_response_at    timestamptz,
  add column reopen_count         smallint not null default 0 check (reopen_count >= 0),
  add column satisfaction_rating  smallint check (satisfaction_rating is null or satisfaction_rating between 1 and 5),
  add column satisfaction_comment text check (satisfaction_comment is null or length(satisfaction_comment) <= 1000),
  add column rated_at             timestamptz;
alter table public.hr_requests add constraint hr_requests_ticket_helpdesk check (ticket_no is null or workflow = 'helpdesk');

-- Backfill: existing helpdesk requests in creation order; first response = first public staff reply.
with t as (select id, row_number() over (order by created_at, id) n from public.hr_requests where workflow = 'helpdesk')
update public.hr_requests r set ticket_no = 'HD-' || lpad(t.n::text, 5, '0') from t where t.id = r.id;
select setval('public.hr_helpdesk_ticket_seq', greatest((select count(*) from public.hr_requests where workflow = 'helpdesk'), 1),
              (select count(*) from public.hr_requests where workflow = 'helpdesk') > 0);
update public.hr_requests r
   set first_response_at = (select min(c.created_at) from public.hr_request_comments c
                            where c.request_id = r.id and not c.is_internal and c.author_employee_id is distinct from r.employee_id)
 where r.workflow = 'helpdesk';

create or replace function hr_internal.helpdesk_ticket_no()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.workflow = 'helpdesk' and new.ticket_no is null then
    new.ticket_no := 'HD-' || lpad(nextval('public.hr_helpdesk_ticket_seq')::text, 5, '0');
  end if;
  return new;
end $$;
create trigger hr_requests_ticket_no before insert on public.hr_requests
  for each row execute function hr_internal.helpdesk_ticket_no();

-- First response: the first public reply by someone other than the requester.
create or replace function hr_internal.helpdesk_first_response()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not new.is_internal then
    update public.hr_requests
       set first_response_at = new.created_at
     where id = new.request_id and workflow = 'helpdesk' and first_response_at is null
       and employee_id is distinct from new.author_employee_id;
  end if;
  return null;
end $$;
create trigger hr_request_comments_first_response after insert on public.hr_request_comments
  for each row execute function hr_internal.helpdesk_first_response();

-- History actions used by the helpdesk.
alter table public.hr_request_events drop constraint hr_request_events_action_check;
alter table public.hr_request_events add constraint hr_request_events_action_check check (action in (
  'created','updated','submitted','resubmitted','stage_approved','stage_rejected','stage_returned','delegated',
  'approved','rejected','returned','cancelled','completed','letter_issued','profile_applied','claim_recorded',
  'payment_status','agreement_accepted','disbursement_recorded','disbursement_verified','repayment_recorded',
  'attachment_added','attachment_removed',
  'assigned','unassigned','priority_changed','category_changed','closed','reopened','rated'));

-- Satisfaction comments are personal opinions: keep them out of the audit log too.
select hr_private.enable_audit('public.hr_requests', array['description','resolution','details','satisfaction_comment']);

create index hr_requests_helpdesk_queue on public.hr_requests(status, priority, sla_due_at) where workflow = 'helpdesk';

-- ---------------------------------------------------------------------
-- 4. Visibility (replaces the 180 versions; adds the IT support desk)
-- ---------------------------------------------------------------------
-- Non-confidential helpdesk ticket in an IT category?
create or replace function hr_private.request_it_ticket(p_request uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select r.workflow = 'helpdesk' and not r.is_confidential and c.support_area = 'it'
                   from public.hr_requests r join public.hr_request_categories c on c.id = r.category_id
                   where r.id = p_request), false)
$$;
revoke execute on function hr_private.request_it_ticket(uuid) from anon, public;
grant execute on function hr_private.request_it_ticket(uuid) to authenticated, service_role;

create or replace function hr_private.request_row_visible(p_request uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select r.employee_id = hr_private.current_employee_id()
        or (r.status <> 'draft' and (
              hr_private.has_permission('hr_requests.manage')
           or (not r.is_confidential and r.workflow in ('helpdesk','hr_letter') and hr_private.has_permission('hr_requests.view'))
           -- IT support desk: non-confidential IT tickets only.
           or (hr_private.has_permission('helpdesk.it') and hr_private.request_it_ticket(r.id))
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
$$;

create or replace function hr_private.request_can_handle(p_request uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select r.employee_id is distinct from hr_private.current_employee_id()
       and r.status <> 'draft'
       and (hr_private.has_permission('hr_requests.manage')
            or (hr_private.has_permission('helpdesk.it') and hr_private.request_it_ticket(r.id))
            or ((not r.is_confidential or r.workflow <> 'helpdesk')
                and hr_private.has_permission('hr_requests.payroll') and hr_private.request_payroll_routed(r.id)))
    from public.hr_requests r where r.id = p_request), false)
$$;

create or replace function hr_internal.request_handler_users(p_request uuid)
returns setof uuid language plpgsql stable security definer set search_path = '' as $$
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
end $$;

-- Notification links: helpdesk tickets open in the Helpdesk module.
create or replace function hr_internal.request_link(p_request uuid, p_staff boolean)
returns text language sql stable security definer set search_path = '' as $$
  select case when r.workflow = 'helpdesk' then case when p_staff then '/hr/helpdesk/' else '/employee/helpdesk/' end
              else case when p_staff then '/hr/requests/' else '/employee/requests/' end end || r.id
  from public.hr_requests r where r.id = p_request
$$;

create or replace function hr_internal.request_notify_staff(p_request uuid, p_title text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
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
  loop
    perform hr_private.notify_user(v_user, 'hr_request', p_title, p_body, v_link, 'hr_request', r.id::text);
    v_any := true;
  end loop;
  if not v_any then
    for v_user in select distinct h from hr_internal.request_handler_users(r.id) h loop
      perform hr_private.notify_user(v_user, 'hr_request', p_title, p_body, v_link, 'hr_request', r.id::text);
    end loop;
  end if;
end $$;

create or replace function hr_internal.notify_requester(p_request uuid, p_type text, p_title text, p_body text)
returns void language sql security definer set search_path = '' as $$
  select hr_private.notify_employee(r.employee_id, p_type, p_title, p_body, hr_internal.request_link(r.id, false), 'hr_request', r.id::text)
  from public.hr_requests r where r.id = p_request
$$;

create or replace function hr_internal.employee_name(p_employee uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(e.display_name, ''), btrim(e.first_name || ' ' || e.last_name)) from public.hr_employees e where e.id = p_employee
$$;

-- Ticket label used in notification titles.
create or replace function hr_internal.ticket_label(p_request uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(r.ticket_no || ' ', '') || r.subject from public.hr_requests r where r.id = p_request
$$;

-- ---------------------------------------------------------------------
-- 5. Helpdesk RPCs (same signatures as 111 / 180, plus history)
-- ---------------------------------------------------------------------
create or replace function public.hr_create_hr_request(p_category text, p_subject text, p_description text,
                                                       p_priority text default 'medium')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid := hr_private.current_employee_id(); v_cat public.hr_request_categories; v_id uuid; v_no text;
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  select * into v_cat from public.hr_request_categories where code = p_category and active;
  if v_cat.id is null then perform hr_private.fail('Choose a request category.', 'invalid_category'); end if;
  if v_cat.workflow <> 'helpdesk' then
    perform hr_private.fail('Use the "' || v_cat.name || '" form for this request type.', 'use_workflow');
  end if;
  if length(btrim(coalesce(p_subject, ''))) not between 3 and 200 then
    perform hr_private.fail('Enter a subject (3 to 200 characters).', 'invalid_subject');
  end if;
  if nullif(btrim(p_description), '') is null then perform hr_private.fail('Describe your request.', 'invalid_description'); end if;
  if length(btrim(p_description)) > 8000 then perform hr_private.fail('8000 characters maximum.', 'invalid_description'); end if;
  if coalesce(p_priority, 'medium') not in ('low','medium','high','urgent') then
    perform hr_private.fail('Unknown priority.', 'invalid_priority');
  end if;
  insert into public.hr_requests (employee_id, category_id, subject, description, priority, is_confidential, sla_due_at, created_by, submitted_at)
  values (v_me, v_cat.id, btrim(p_subject), btrim(p_description), coalesce(p_priority, 'medium'), v_cat.is_confidential,
          now() + make_interval(hours => v_cat.sla_hours), auth.uid(), now())
  returning id, ticket_no into v_id, v_no;
  perform hr_internal.request_event(v_id, 'submitted', null, null, null, 'open');
  perform hr_internal.request_notify_staff(v_id, 'New support ticket ' || v_no || ': ' || v_cat.name,
    case when v_cat.is_confidential then 'A confidential request was submitted.' else btrim(p_subject) end);
  return v_id;
end $$;

create or replace function public.hr_assign_hr_request(p_request uuid, p_assignee uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.hr_requests; v_user uuid;
begin
  select * into v_r from public.hr_requests where id = p_request for update;
  if v_r.id is null or not hr_private.request_row_visible(v_r.id) then perform hr_private.fail('Request not found.', 'not_found'); end if;
  if v_r.employee_id = hr_private.current_employee_id() then
    perform hr_private.fail('You cannot handle your own request.', 'self_action');
  end if;
  if not hr_private.request_can_handle(v_r.id) then
    perform hr_private.fail('You are not allowed to manage HR requests.', 'forbidden');
  end if;
  if v_r.status in ('closed','cancelled','completed','rejected') then perform hr_private.fail('This request is closed.', 'invalid_state'); end if;
  if p_assignee is not null then
    if p_assignee = v_r.employee_id then perform hr_private.fail('A request cannot be assigned to the requester.', 'invalid_assignee'); end if;
    v_user := hr_private.employee_user_id(p_assignee);
    if v_user is null or not exists (select 1 from hr_internal.request_handler_users(v_r.id) u where u = v_user) then
      perform hr_private.fail('Requests can only be assigned to HR staff who handle this type of request.', 'invalid_assignee');
    end if;
  end if;
  if p_assignee is not distinct from v_r.assigned_to then return; end if;
  update public.hr_requests
     set assigned_to = p_assignee, last_activity_at = now(),
         status = case when p_assignee is not null and status = 'open' then 'in_progress' else status end
   where id = v_r.id;
  if v_r.workflow = 'helpdesk' then
    perform hr_internal.request_event(v_r.id, case when p_assignee is null then 'unassigned' else 'assigned' end,
      case when p_assignee is null then null else 'Assigned to ' || hr_internal.employee_name(p_assignee) end, null,
      v_r.status, case when p_assignee is not null and v_r.status = 'open' then 'in_progress' else v_r.status end);
  end if;
  if p_assignee is not null then
    perform hr_private.notify_employee(p_assignee, 'hr_request',
      case when v_r.workflow = 'helpdesk' then 'Ticket assigned to you' else 'HR request assigned to you' end,
      hr_internal.ticket_label(v_r.id), hr_internal.request_link(v_r.id, true), 'hr_request', v_r.id::text);
  end if;
end $$;

create or replace function public.hr_update_hr_request_status(p_request uuid, p_status text, p_resolution text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.hr_requests; v_res text := nullif(btrim(p_resolution), '');
begin
  select * into v_r from public.hr_requests where id = p_request for update;
  if v_r.id is null or not hr_private.request_row_visible(v_r.id) then perform hr_private.fail('Request not found.', 'not_found'); end if;
  if v_r.employee_id = hr_private.current_employee_id() then
    perform hr_private.fail('You cannot handle your own request.', 'self_action');
  end if;
  if not hr_private.request_can_handle(v_r.id) then
    perform hr_private.fail('You are not allowed to manage HR requests.', 'forbidden');
  end if;
  if v_r.workflow <> 'helpdesk' then
    perform hr_private.fail('This request follows an approval workflow. Use approve, reject or return instead.', 'use_workflow');
  end if;
  if p_status is null or p_status not in ('open','in_progress','waiting_on_employee','resolved','closed') then
    perform hr_private.fail('Unknown status.', 'invalid_status');
  end if;
  if v_r.status in ('closed','cancelled') then
    perform hr_private.fail('This request is closed.', 'invalid_state');
  end if;
  if v_res is not null and length(v_res) > 8000 then perform hr_private.fail('8000 characters maximum.', 'invalid'); end if;
  if p_status = 'resolved' and v_res is null then
    perform hr_private.fail('Describe the resolution before resolving the request.', 'resolution_required');
  end if;
  if p_status = 'closed' and coalesce(v_res, v_r.resolution) is null then
    perform hr_private.fail('Describe the resolution before closing the request.', 'resolution_required');
  end if;
  if p_status = v_r.status and v_res is not distinct from v_r.resolution then return; end if;
  update public.hr_requests
     set status = p_status,
         resolution = coalesce(v_res, resolution),
         resolved_at = case when p_status = 'resolved' then case when status = 'resolved' then resolved_at else now() end
                            when p_status = 'closed' then coalesce(resolved_at, now())
                            else null end,
         closed_at = case when p_status = 'closed' then now() else null end,
         -- Asking the requester for information or resolving counts as a response.
         first_response_at = case when p_status in ('waiting_on_employee','resolved','closed') then coalesce(first_response_at, now())
                                  else first_response_at end,
         last_activity_at = now()
   where id = v_r.id;
  if p_status is distinct from v_r.status then
    perform hr_internal.request_event(v_r.id, 'updated', case when p_status in ('resolved','closed') then v_res end, null, v_r.status, p_status);
    perform hr_internal.notify_requester(v_r.id, 'hr_request',
      'Your ticket is now ' || replace(p_status, '_', ' '), hr_internal.ticket_label(v_r.id));
  else
    perform hr_internal.request_event(v_r.id, 'updated', 'Resolution updated: ' || v_res, null, v_r.status, p_status);
  end if;
end $$;

create or replace function public.hr_close_hr_request(p_request uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.hr_requests;
begin
  select * into v_r from public.hr_requests where id = p_request for update;
  if v_r.id is null or v_r.employee_id is distinct from hr_private.current_employee_id() then
    perform hr_private.fail('Request not found.', 'not_found');
  end if;
  if v_r.workflow <> 'helpdesk' or v_r.status <> 'resolved' then perform hr_private.fail('Only resolved requests can be closed.', 'invalid_state'); end if;
  update public.hr_requests set status = 'closed', closed_at = now(), last_activity_at = now() where id = v_r.id;
  perform hr_internal.request_event(v_r.id, 'closed', 'Confirmed resolved by the requester', null, 'resolved', 'closed');
end $$;

create or replace function public.hr_reopen_hr_request(p_request uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.hr_requests; v_sla int;
        v_days int := coalesce((hr_private.setting('hr_requests') ->> 'reopen_window_days')::int, 7);
begin
  select * into v_r from public.hr_requests where id = p_request for update;
  if v_r.id is null or v_r.employee_id is distinct from hr_private.current_employee_id() then
    perform hr_private.fail('Request not found.', 'not_found');
  end if;
  if v_r.workflow <> 'helpdesk' or v_r.status not in ('resolved','closed') or v_r.resolved_at is null then
    perform hr_private.fail('Only resolved or closed requests can be reopened.', 'invalid_state');
  end if;
  if v_r.resolved_at < now() - make_interval(days => v_days) then
    perform hr_private.fail(format('Requests can only be reopened within %s days of resolution. Please raise a new request.', v_days), 'reopen_window_passed');
  end if;
  if length(btrim(coalesce(p_reason, ''))) > 2000 then perform hr_private.fail('2000 characters maximum.', 'invalid'); end if;
  select sla_hours into v_sla from public.hr_request_categories where id = v_r.category_id;
  -- A reopened ticket keeps its assignee (who is notified) and gets a fresh response target; the earlier rating no longer applies.
  update public.hr_requests
     set status = 'open',
         resolved_at = null, closed_at = null, last_activity_at = now(),
         reopen_count = reopen_count + 1,
         sla_due_at = now() + make_interval(hours => coalesce(v_sla, 48)),
         satisfaction_rating = null, satisfaction_comment = null, rated_at = null
   where id = v_r.id;
  insert into public.hr_request_comments (request_id, author_user_id, author_employee_id, body, is_internal)
  values (v_r.id, auth.uid(), v_r.employee_id, 'Request reopened' || coalesce(': ' || nullif(btrim(p_reason), ''), '.'), false);
  perform hr_internal.request_event(v_r.id, 'reopened', nullif(btrim(p_reason), ''), null, v_r.status, 'open');
  perform hr_internal.request_notify_staff(v_r.id, 'Ticket reopened: ' || hr_internal.ticket_label(v_r.id), nullif(btrim(p_reason), ''));
end $$;

-- Requester rates a resolved / closed ticket (once per resolution; reopening clears it).
create or replace function public.hr_rate_helpdesk_ticket(p_request uuid, p_rating int, p_comment text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.hr_requests; v_note text := nullif(btrim(p_comment), '');
begin
  select * into v_r from public.hr_requests where id = p_request for update;
  if v_r.id is null or v_r.employee_id is distinct from hr_private.current_employee_id() then
    perform hr_private.fail('Ticket not found.', 'not_found');
  end if;
  if v_r.workflow <> 'helpdesk' or v_r.status not in ('resolved','closed') then
    perform hr_private.fail('You can rate a ticket once it has been resolved.', 'invalid_state');
  end if;
  if v_r.satisfaction_rating is not null then perform hr_private.fail('You have already rated this ticket.', 'already_rated'); end if;
  if p_rating is null or p_rating not between 1 and 5 then perform hr_private.fail('Choose a rating from 1 to 5.', 'invalid_rating'); end if;
  if v_note is not null and length(v_note) > 1000 then perform hr_private.fail('1000 characters maximum.', 'invalid'); end if;
  update public.hr_requests set satisfaction_rating = p_rating, satisfaction_comment = v_note, rated_at = now() where id = v_r.id;
  perform hr_internal.request_event(v_r.id, 'rated', p_rating || ' / 5');
  if v_r.assigned_to is not null then
    perform hr_private.notify_employee(v_r.assigned_to, 'hr_request', 'Ticket rated ' || p_rating || ' / 5',
      hr_internal.ticket_label(v_r.id), hr_internal.request_link(v_r.id, true), 'hr_request', v_r.id::text);
  end if;
end $$;

-- Handler changes priority and / or category (e.g. an IT problem raised under HR).
-- A confidential ticket stays confidential; a ticket moved into a confidential
-- category becomes confidential. The assignee is cleared when they cannot
-- handle the new category.
create or replace function public.hr_update_helpdesk_ticket(p_request uuid, p_priority text default null, p_category text default null,
                                                            p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.hr_requests; v_old public.hr_request_categories; v_cat public.hr_request_categories; v_user uuid;
        v_pri text := nullif(btrim(p_priority), ''); v_note text := nullif(btrim(p_note), '');
begin
  select * into v_r from public.hr_requests where id = p_request for update;
  if v_r.id is null or not hr_private.request_row_visible(v_r.id) or v_r.workflow <> 'helpdesk' then
    perform hr_private.fail('Ticket not found.', 'not_found');
  end if;
  if v_r.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot handle your own request.', 'self_action'); end if;
  if not hr_private.request_can_handle(v_r.id) then perform hr_private.fail('You are not allowed to manage this ticket.', 'forbidden'); end if;
  if v_r.status in ('closed','cancelled') then perform hr_private.fail('This ticket is closed.', 'invalid_state'); end if;
  if v_note is not null and length(v_note) > 1000 then perform hr_private.fail('1000 characters maximum.', 'invalid'); end if;
  select * into v_old from public.hr_request_categories where id = v_r.category_id;

  if v_pri is not null and v_pri is distinct from v_r.priority then
    if v_pri not in ('low','medium','high','urgent') then perform hr_private.fail('Unknown priority.', 'invalid_priority'); end if;
    update public.hr_requests set priority = v_pri, last_activity_at = now() where id = v_r.id;
    perform hr_internal.request_event(v_r.id, 'priority_changed', v_r.priority || ' → ' || v_pri || coalesce(' — ' || v_note, ''));
  end if;

  if nullif(btrim(p_category), '') is not null and btrim(p_category) is distinct from v_old.code then
    select * into v_cat from public.hr_request_categories where code = btrim(p_category) and active;
    if v_cat.id is null or v_cat.workflow <> 'helpdesk' then perform hr_private.fail('Choose a helpdesk category.', 'invalid_category'); end if;
    if v_r.is_confidential and not v_cat.is_confidential then
      perform hr_private.fail('A confidential ticket can only be moved to another confidential category.', 'confidential');
    end if;
    update public.hr_requests
       set category_id = v_cat.id,
           is_confidential = v_r.is_confidential or v_cat.is_confidential,
           sla_due_at = case when status in ('resolved','closed') then sla_due_at
                             else greatest(created_at + make_interval(hours => v_cat.sla_hours), now() + interval '1 hour') end,
           last_activity_at = now()
     where id = v_r.id;
    perform hr_internal.request_event(v_r.id, 'category_changed', v_old.name || ' → ' || v_cat.name || coalesce(' — ' || v_note, ''));
    if v_r.assigned_to is not null then
      v_user := hr_private.employee_user_id(v_r.assigned_to);
      if v_user is null or not exists (select 1 from hr_internal.request_handler_users(v_r.id) u where u = v_user) then
        update public.hr_requests set assigned_to = null, status = case when status = 'in_progress' then 'open' else status end where id = v_r.id;
        perform hr_internal.request_event(v_r.id, 'unassigned', 'The previous assignee does not handle ' || v_cat.name || ' tickets');
      end if;
    end if;
    perform hr_internal.request_notify_staff(v_r.id, 'Ticket moved to ' || v_cat.name || ': ' || hr_internal.ticket_label(v_r.id),
      case when v_r.is_confidential or v_cat.is_confidential then 'A confidential ticket was moved to your desk.' else null end);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. Read RPCs (names of requesters / staff without employee-master access)
-- ---------------------------------------------------------------------
create or replace function hr_internal.helpdesk_row(r public.hr_requests)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'ticket_no', r.ticket_no, 'subject', r.subject, 'status', r.status, 'priority', r.priority,
    'is_confidential', r.is_confidential, 'category_id', c.id, 'category_code', c.code, 'category', c.name, 'support_area', c.support_area,
    'employee_id', e.id, 'employee_code', e.employee_code,
    'employee_name', coalesce(nullif(e.display_name, ''), btrim(e.first_name || ' ' || e.last_name)),
    'department', d.name,
    'assigned_to', r.assigned_to, 'assignee_name', hr_internal.employee_name(r.assigned_to),
    'created_at', r.created_at, 'last_activity_at', r.last_activity_at, 'sla_due_at', r.sla_due_at,
    'first_response_at', r.first_response_at, 'resolved_at', r.resolved_at, 'closed_at', r.closed_at,
    'reopen_count', r.reopen_count, 'satisfaction_rating', r.satisfaction_rating,
    'overdue', coalesce(r.sla_due_at < now() and r.status in ('open','in_progress','waiting_on_employee'), false))
  from public.hr_request_categories c, public.hr_employees e left join public.hr_departments d on d.id = e.department_id
  where c.id = r.category_id and e.id = r.employee_id
$$;

-- Staff queue. Filters: area, status ('active' | 'all' | a status), priority,
-- category (code), assigned ('me' | 'unassigned' | employee id), overdue, search, from, to.
create or replace function public.hr_helpdesk_queue(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_me uuid := hr_private.current_employee_id();
  v_area text := nullif(f ->> 'area', '');
  v_status text := coalesce(nullif(f ->> 'status', ''), 'active');
  v_pri text := nullif(f ->> 'priority', '');
  v_cat text := nullif(f ->> 'category', '');
  v_asg text := nullif(f ->> 'assigned', '');
  v_overdue boolean := coalesce((f ->> 'overdue')::boolean, false);
  v_from date := nullif(f ->> 'from', '')::date;
  v_to date := nullif(f ->> 'to', '')::date;
  v_search text := nullif(btrim(regexp_replace(coalesce(f ->> 'search', ''), '[%_\\]', ' ', 'g')), '');
begin
  if auth.uid() is null then perform hr_private.fail('Sign in first.', 'not_authenticated'); end if;
  if v_asg = 'me' and v_me is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(x order by (x ->> 'overdue')::boolean desc,
                     array_position(array['urgent','high','medium','low'], x ->> 'priority'),
                     x ->> 'sla_due_at' nulls last, x ->> 'created_at' desc)
    from (
      select hr_internal.helpdesk_row(r) x
      from public.hr_requests r
      join public.hr_request_categories c on c.id = r.category_id
      join public.hr_employees e on e.id = r.employee_id
      where r.workflow = 'helpdesk' and r.employee_id is distinct from v_me
        and hr_private.request_row_visible(r.id)
        and (v_area is null or c.support_area = v_area)
        and (case v_status when 'active' then r.status in ('open','in_progress','waiting_on_employee')
                           when 'all' then true else r.status = v_status end)
        and (v_pri is null or r.priority = v_pri)
        and (v_cat is null or c.code = v_cat)
        and (v_asg is null or (v_asg = 'me' and r.assigned_to = v_me) or (v_asg = 'unassigned' and r.assigned_to is null)
             or (v_asg not in ('me','unassigned') and r.assigned_to::text = v_asg))
        and (not v_overdue or (r.sla_due_at < now() and r.status in ('open','in_progress','waiting_on_employee')))
        and (v_from is null or r.created_at >= v_from::timestamptz)
        and (v_to is null or r.created_at < (v_to + 1)::timestamptz)
        and (v_search is null or r.subject ilike '%' || v_search || '%' or r.ticket_no ilike '%' || v_search || '%'
             or e.employee_code ilike '%' || v_search || '%' or (e.first_name || ' ' || e.last_name) ilike '%' || v_search || '%')
      limit 2000) s), '[]'::jsonb);
end $$;

-- One ticket with conversation, history and files, for the requester or a staff viewer.
create or replace function public.hr_helpdesk_ticket(p_request uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.hr_requests; c public.hr_request_categories; v_me uuid := hr_private.current_employee_id(); v_req boolean; v_handle boolean;
        v_days int := coalesce((hr_private.setting('hr_requests') ->> 'reopen_window_days')::int, 7);
begin
  select * into r from public.hr_requests where id = p_request;
  if r.id is null or r.workflow <> 'helpdesk' or not hr_private.request_row_visible(r.id) then
    perform hr_private.fail('Ticket not found.', 'not_found');
  end if;
  select * into c from public.hr_request_categories where id = r.category_id;
  v_req := coalesce(r.employee_id = v_me, false);
  v_handle := hr_private.request_can_handle(r.id);
  return hr_internal.helpdesk_row(r) || jsonb_build_object(
    'description', r.description, 'resolution', r.resolution, 'cancelled_at', r.cancelled_at,
    'satisfaction_comment', r.satisfaction_comment, 'rated_at', r.rated_at,
    'category_description', c.description, 'sla_hours', c.sla_hours,
    'is_requester', v_req, 'can_handle', v_handle,
    'can_reply', (v_req or v_handle) and r.status not in ('closed','cancelled'),
    'can_attach', (v_req or v_handle) and r.status in ('open','in_progress','waiting_on_employee'),
    'can_cancel', v_req and r.status = 'open',
    'can_close', v_req and r.status = 'resolved',
    'can_rate', v_req and r.status in ('resolved','closed') and r.satisfaction_rating is null,
    'can_reopen', v_req and r.status in ('resolved','closed') and r.resolved_at is not null and r.resolved_at >= now() - make_interval(days => v_days),
    'reopen_window_days', v_days,
    'comments', coalesce((select jsonb_agg(jsonb_build_object(
                   'id', m.id, 'body', m.body, 'is_internal', m.is_internal, 'created_at', m.created_at,
                   'from_requester', m.author_employee_id is not distinct from r.employee_id,
                   'mine', m.author_user_id = auth.uid(),
                   'author', coalesce(hr_internal.employee_name(m.author_employee_id), 'Support team'))
                 order by m.created_at, m.id)
               from public.hr_request_comments m
               where m.request_id = r.id and hr_private.request_comment_visible(r.id, m.is_internal)), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', ev.id, 'action', ev.action, 'from_status', ev.from_status,
                   'to_status', ev.to_status, 'note', ev.note, 'created_at', ev.created_at,
                   'actor', hr_internal.employee_name(ev.actor_employee_id))
                 order by ev.created_at, ev.id)
               from public.hr_request_events ev where ev.request_id = r.id), '[]'::jsonb),
    'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'file_name', a.file_name, 'mime_type', a.mime_type,
                   'size_bytes', a.size_bytes, 'storage_path', a.storage_path, 'created_at', a.created_at, 'mine', a.uploaded_by = auth.uid(),
                   'uploaded', exists (select 1 from storage.objects o where o.bucket_id = 'hr-request-files' and o.name = a.storage_path))
                 order by a.created_at)
               from public.hr_request_attachments a where a.request_id = r.id and hr_private.request_attachment_visible(a.id)), '[]'::jsonb));
end $$;

-- Staff who can be assigned this ticket.
create or replace function public.hr_helpdesk_assignees(p_request uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not hr_private.request_can_handle(p_request) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'employee_code', e.employee_code,
                     'name', coalesce(nullif(e.display_name, ''), btrim(e.first_name || ' ' || e.last_name))) order by e.first_name, e.last_name)
                   from public.hr_employees e
                   where e.user_id in (select u from hr_internal.request_handler_users(p_request) u)), '[]'::jsonb);
end $$;

-- KPIs over the tickets the caller can see (never their own). Filters: area, from, to.
-- Period figures (created / resolved / response times / SLA / rating) use the
-- from-to window; queue figures (active / overdue / unassigned) are current.
create or replace function public.hr_helpdesk_summary(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_me uuid := hr_private.current_employee_id();
  v_area text := nullif(f ->> 'area', '');
  v_from date := coalesce(nullif(f ->> 'from', '')::date, current_date - 29);
  v_to date := coalesce(nullif(f ->> 'to', '')::date, current_date);
  v_a timestamptz; v_b timestamptz;
begin
  if auth.uid() is null then perform hr_private.fail('Sign in first.', 'not_authenticated'); end if;
  if v_to < v_from then perform hr_private.fail('The end date is before the start date.', 'invalid'); end if;
  v_a := v_from::timestamptz; v_b := (v_to + 1)::timestamptz;
  return (
    with t as (
      select r.status, r.priority, r.assigned_to, r.sla_due_at, r.created_at, r.first_response_at, r.resolved_at,
             r.reopen_count, r.satisfaction_rating, r.rated_at, c.support_area area, c.name category,
             r.status in ('open','in_progress','waiting_on_employee') active,
             r.created_at >= v_a and r.created_at < v_b in_created,
             coalesce(r.resolved_at >= v_a and r.resolved_at < v_b, false) in_resolved,
             coalesce(r.rated_at >= v_a and r.rated_at < v_b, false) in_rated
      from public.hr_requests r join public.hr_request_categories c on c.id = r.category_id
      where r.workflow = 'helpdesk' and r.employee_id is distinct from v_me
        and (v_area is null or c.support_area = v_area)
        and hr_private.request_row_visible(r.id))
    select jsonb_build_object(
      'from', v_from, 'to', v_to,
      'open', (select count(*) from t where status = 'open'),
      'in_progress', (select count(*) from t where status = 'in_progress'),
      'waiting_on_employee', (select count(*) from t where status = 'waiting_on_employee'),
      'active', (select count(*) from t where active),
      'overdue', (select count(*) from t where active and sla_due_at < now()),
      'unassigned', (select count(*) from t where active and assigned_to is null),
      'assigned_to_me', (select count(*) from t where active and assigned_to = v_me),
      'urgent', (select count(*) from t where active and priority in ('urgent','high')),
      'created', (select count(*) from t where in_created),
      'resolved', (select count(*) from t where in_resolved),
      'reopened', (select count(*) from t where in_created and reopen_count > 0),
      'avg_first_response_hours', (select round((avg(extract(epoch from (first_response_at - created_at))) / 3600)::numeric, 1)
                                   from t where in_created and first_response_at is not null),
      'avg_resolution_hours', (select round((avg(extract(epoch from (resolved_at - created_at))) / 3600)::numeric, 1) from t where in_resolved),
      'sla_met_percent', (select round(100.0 * count(*) filter (where resolved_at <= sla_due_at) / nullif(count(*), 0), 0)
                          from t where in_resolved and sla_due_at is not null),
      'csat_average', (select round(avg(satisfaction_rating)::numeric, 1) from t where in_rated),
      'csat_count', (select count(*) from t where in_rated),
      'by_area', coalesce((select jsonb_agg(jsonb_build_object('area', a.area, 'active', a.active, 'resolved', a.resolved) order by a.area)
                           from (select area, count(*) filter (where active) active, count(*) filter (where in_resolved) resolved
                                 from t group by area) a), '[]'::jsonb),
      'by_category', coalesce((select jsonb_agg(jsonb_build_object('category', k.category, 'area', k.area, 'created', k.created, 'active', k.active)
                                                order by k.created desc, k.active desc, k.category)
                               from (select category, area, count(*) filter (where in_created) created, count(*) filter (where active) active
                                     from t group by category, area) k
                               where k.created > 0 or k.active > 0), '[]'::jsonb)));
end $$;

-- ---------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------
revoke execute on function
  public.hr_rate_helpdesk_ticket(uuid, int, text),
  public.hr_update_helpdesk_ticket(uuid, text, text, text),
  public.hr_helpdesk_queue(jsonb),
  public.hr_helpdesk_ticket(uuid),
  public.hr_helpdesk_assignees(uuid),
  public.hr_helpdesk_summary(jsonb)
from anon, public;
grant execute on function
  public.hr_rate_helpdesk_ticket(uuid, int, text),
  public.hr_update_helpdesk_ticket(uuid, text, text, text),
  public.hr_helpdesk_queue(jsonb),
  public.hr_helpdesk_ticket(uuid),
  public.hr_helpdesk_assignees(uuid),
  public.hr_helpdesk_summary(jsonb)
to authenticated;
-- create or replace kept the existing grants of the redefined 111 / 180 RPCs.
-- Global default privileges give PUBLIC execute on new functions, which a
-- schema-level default cannot take away: lock hr_internal down explicitly (as 180 does).
revoke execute on all functions in schema hr_internal from public;
revoke execute on all functions in schema hr_internal from anon;
revoke execute on all functions in schema hr_internal from authenticated;

-- IT staff read the categories (ticket forms, filters).
drop policy if exists hr_request_categories_read on public.hr_request_categories;
create policy hr_request_categories_read on public.hr_request_categories for select to authenticated
  using (hr_private.current_employee_id() is not null or hr_private.has_permission('hr_requests.view')
         or hr_private.has_permission('hr_requests.manage') or hr_private.has_permission('helpdesk.it'));
