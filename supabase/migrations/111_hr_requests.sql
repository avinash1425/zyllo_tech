-- =====================================================================
-- 111_hr_requests.sql — Employee HR helpdesk (requests + comments)
-- =====================================================================
-- Depends on 100_hr_foundation.sql.
--
-- Privacy: managers do NOT see their team's HR requests. Visible to the
-- requester, hr_requests.view (non-confidential only) and
-- hr_requests.manage (all, including confidential e.g. grievances).
-- Internal comments are hidden from the requester.
-- All writes are RPC-only. Categories are master data (direct writes with
-- hr_requests.manage or settings.manage).
-- Apply ONLY to the local test cluster or the isolated dev project.
-- =====================================================================

insert into public.hr_settings (key, value, description) values
  ('hr_requests', jsonb_build_object('reopen_window_days', 7),
   'HR helpdesk: number of days after resolution during which the requester may reopen a request')
on conflict (key) do nothing;

create table public.hr_request_categories (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  name                  text not null check (length(btrim(name)) between 2 and 120),
  description           text check (description is null or length(description) <= 1000),
  default_assignee_role text references public.hr_roles(key) on delete set null,
  sla_hours             int not null default 48 check (sla_hours between 1 and 2160),
  is_confidential       boolean not null default false,
  active                boolean not null default true,
  sort_order            smallint not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

insert into public.hr_request_categories (code, name, description, default_assignee_role, sla_hours, is_confidential, sort_order) values
  ('general',          'General query',        'Any general HR question',                         'hr_admin',      48, false, 1),
  ('payroll_query',    'Payroll query',        'Salary, payslip or deduction questions',         'payroll_admin', 48, false, 2),
  ('leave_query',      'Leave query',          'Leave balance or policy questions',              'hr_admin',      24, false, 3),
  ('document_request', 'Document request',     'Request a letter or certificate from HR',        'hr_admin',      72, false, 4),
  ('it_access',        'IT / access',          'Accounts, tools and access problems',            'super_admin',   24, false, 5),
  ('grievance',        'Grievance',            'Confidential concern or complaint',              'hr_admin',      72, true,  6),
  ('other',            'Other',                'Anything else',                                   'hr_admin',      72, false, 7)
on conflict (code) do nothing;

create table public.hr_requests (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references public.hr_employees(id) on delete restrict,
  category_id      uuid not null references public.hr_request_categories(id) on delete restrict,
  subject          text not null check (length(btrim(subject)) between 3 and 200),
  description      text not null check (length(btrim(description)) between 1 and 8000),
  priority         text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  status           text not null default 'open'
                   check (status in ('open','in_progress','waiting_on_employee','resolved','closed','cancelled')),
  assigned_to      uuid references public.hr_employees(id) on delete set null,
  is_confidential  boolean not null default false,
  resolution       text check (resolution is null or length(resolution) <= 8000),
  resolved_at      timestamptz,
  closed_at        timestamptz,
  cancelled_at     timestamptz,
  sla_due_at       timestamptz,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);
create index hr_requests_employee on public.hr_requests(employee_id, created_at desc);
create index hr_requests_queue on public.hr_requests(status, sla_due_at);
create index hr_requests_assignee on public.hr_requests(assigned_to, status);

create table public.hr_request_comments (
  id                 uuid primary key default gen_random_uuid(),
  request_id         uuid not null references public.hr_requests(id) on delete restrict,
  author_user_id     uuid,
  author_employee_id uuid references public.hr_employees(id) on delete set null,
  body               text not null check (length(btrim(body)) between 1 and 8000),
  is_internal        boolean not null default false,
  created_at         timestamptz not null default now()
);
create index hr_request_comments_request on public.hr_request_comments(request_id, created_at);

create trigger hr_request_categories_touch before update on public.hr_request_categories
  for each row execute function hr_private.touch_updated_at();
create trigger hr_requests_touch before update on public.hr_requests
  for each row execute function hr_private.touch_updated_at();

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function hr_private.request_can_view(p_employee uuid, p_confidential boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select (p_employee = hr_private.current_employee_id())
      or hr_private.has_permission('hr_requests.manage')
      or (not p_confidential and hr_private.has_permission('hr_requests.view'))
$$;

-- Comment visibility: request visible AND (public comment, or caller is HR
-- staff for this request and not the requester).
create or replace function hr_private.request_comment_visible(p_request uuid, p_internal boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.hr_requests r
    where r.id = p_request
      and hr_private.request_can_view(r.employee_id, r.is_confidential)
      and (not p_internal
           or (r.employee_id is distinct from hr_private.current_employee_id()
               and (hr_private.has_permission('hr_requests.manage')
                    or (not r.is_confidential and hr_private.has_permission('hr_requests.view'))))))
$$;

-- Active portal users holding hr_requests.manage (optionally only those with
-- a given role). Used for routing notifications.
create or replace function hr_private.request_staff_users(p_role text default null)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select distinct ur.user_id
  from public.hr_user_roles ur
  join public.hr_employees e on e.user_id = ur.user_id and e.portal_access and e.status not in ('exited','archived','suspended')
  where (p_role is null or ur.role_key = p_role)
    and exists (select 1 from public.hr_user_roles ur2
                where ur2.user_id = ur.user_id
                  and (ur2.role_key = 'super_admin'
                       or exists (select 1 from public.hr_role_permissions rp
                                  where rp.role_key = ur2.role_key and rp.permission_key = 'hr_requests.manage')))
$$;

create or replace function hr_private.request_notify_staff(p_request uuid, p_title text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.hr_requests; v_role text; v_user uuid; v_requester uuid; v_any boolean := false;
begin
  select * into v_r from public.hr_requests where id = p_request;
  v_requester := hr_private.employee_user_id(v_r.employee_id);
  if v_r.assigned_to is not null then
    perform hr_private.notify_employee(v_r.assigned_to, 'hr_request', p_title, p_body, '/hr/requests', 'hr_request', p_request::text);
    return;
  end if;
  select default_assignee_role into v_role from public.hr_request_categories where id = v_r.category_id;
  for v_user in select u from hr_private.request_staff_users(v_role) u where u is distinct from v_requester loop
    perform hr_private.notify_user(v_user, 'hr_request', p_title, p_body, '/hr/requests', 'hr_request', p_request::text);
    v_any := true;
  end loop;
  if not v_any then
    for v_user in select u from hr_private.request_staff_users(null) u where u is distinct from v_requester loop
      perform hr_private.notify_user(v_user, 'hr_request', p_title, p_body, '/hr/requests', 'hr_request', p_request::text);
    end loop;
  end if;
end $$;

create or replace function hr_private.request_require_manage()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not hr_private.has_permission('hr_requests.manage') then
    perform hr_private.fail('You are not allowed to manage HR requests.', 'forbidden');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
select hr_private.secure_table('public.hr_request_categories');
select hr_private.secure_table('public.hr_requests');
select hr_private.secure_table('public.hr_request_comments');

create policy hr_request_categories_read on public.hr_request_categories for select to authenticated
  using (hr_private.current_employee_id() is not null or hr_private.has_permission('hr_requests.view')
         or hr_private.has_permission('hr_requests.manage'));
create policy hr_request_categories_insert on public.hr_request_categories for insert to authenticated
  with check (hr_private.has_permission('hr_requests.manage') or hr_private.has_permission('settings.manage'));
create policy hr_request_categories_update on public.hr_request_categories for update to authenticated
  using (hr_private.has_permission('hr_requests.manage') or hr_private.has_permission('settings.manage'))
  with check (hr_private.has_permission('hr_requests.manage') or hr_private.has_permission('settings.manage'));

create policy hr_requests_read on public.hr_requests for select to authenticated
  using (hr_private.request_can_view(employee_id, is_confidential));
create policy hr_request_comments_read on public.hr_request_comments for select to authenticated
  using (hr_private.request_comment_visible(request_id, is_internal));

select hr_private.enable_audit('public.hr_request_categories');
-- Request text can be sensitive (grievances): keep it out of the audit log.
select hr_private.enable_audit('public.hr_requests', array['description','resolution']);

-- ---------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------
create or replace function public.hr_create_hr_request(p_category text, p_subject text, p_description text,
                                                       p_priority text default 'medium')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid := hr_private.current_employee_id(); v_cat public.hr_request_categories; v_id uuid;
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  select * into v_cat from public.hr_request_categories where code = p_category and active;
  if v_cat.id is null then perform hr_private.fail('Choose a request category.', 'invalid_category'); end if;
  if length(btrim(coalesce(p_subject, ''))) not between 3 and 200 then
    perform hr_private.fail('Enter a subject (3 to 200 characters).', 'invalid_subject');
  end if;
  if nullif(btrim(p_description), '') is null then perform hr_private.fail('Describe your request.', 'invalid_description'); end if;
  if coalesce(p_priority, 'medium') not in ('low','medium','high','urgent') then
    perform hr_private.fail('Unknown priority.', 'invalid_priority');
  end if;
  insert into public.hr_requests (employee_id, category_id, subject, description, priority, is_confidential, sla_due_at, created_by)
  values (v_me, v_cat.id, btrim(p_subject), btrim(p_description), coalesce(p_priority, 'medium'), v_cat.is_confidential,
          now() + make_interval(hours => v_cat.sla_hours), auth.uid())
  returning id into v_id;
  perform hr_private.request_notify_staff(v_id, 'New HR request: ' || v_cat.name,
    case when v_cat.is_confidential then 'A confidential request was submitted.' else btrim(p_subject) end);
  return v_id;
end $$;

create or replace function public.hr_comment_hr_request(p_request uuid, p_body text, p_internal boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_r     public.hr_requests;
  v_me    uuid := hr_private.current_employee_id();
  v_staff boolean := hr_private.has_permission('hr_requests.manage');
  v_req   boolean;
  v_id    uuid;
begin
  select * into v_r from public.hr_requests where id = p_request for update;
  if v_r.id is null or not hr_private.request_can_view(v_r.employee_id, v_r.is_confidential) then
    perform hr_private.fail('Request not found.', 'not_found');
  end if;
  v_req := v_r.employee_id = v_me;
  if nullif(btrim(p_body), '') is null then perform hr_private.fail('Write a comment.', 'invalid'); end if;
  if coalesce(p_internal, false) and (v_req or not v_staff) then
    perform hr_private.fail('Only HR staff can add internal notes on requests they handle.', 'forbidden');
  end if;
  if not v_req and not v_staff then
    perform hr_private.fail('You are not allowed to respond to HR requests.', 'forbidden');
  end if;
  if v_r.status in ('closed','cancelled') and not coalesce(p_internal, false) then
    perform hr_private.fail('This request is closed. Reopen it to continue the conversation.', 'invalid_state');
  end if;
  insert into public.hr_request_comments (request_id, author_user_id, author_employee_id, body, is_internal)
  values (v_r.id, auth.uid(), v_me, btrim(p_body), coalesce(p_internal, false))
  returning id into v_id;
  update public.hr_requests
     set last_activity_at = now(),
         status = case when v_req and status = 'waiting_on_employee' then 'in_progress' else status end
   where id = v_r.id;
  if v_req then
    perform hr_private.request_notify_staff(v_r.id, 'Requester replied: ' || v_r.subject, null);
  elsif not coalesce(p_internal, false) then
    perform hr_private.notify_employee(v_r.employee_id, 'hr_request', 'HR responded to your request', v_r.subject,
      '/employee/requests', 'hr_request', v_r.id::text);
  end if;
  return v_id;
end $$;

create or replace function public.hr_assign_hr_request(p_request uuid, p_assignee uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.hr_requests; v_user uuid;
begin
  perform hr_private.request_require_manage();
  select * into v_r from public.hr_requests where id = p_request for update;
  if v_r.id is null then perform hr_private.fail('Request not found.', 'not_found'); end if;
  if v_r.employee_id = hr_private.current_employee_id() then
    perform hr_private.fail('You cannot handle your own request.', 'self_action');
  end if;
  if v_r.status in ('closed','cancelled') then perform hr_private.fail('This request is closed.', 'invalid_state'); end if;
  if p_assignee is not null then
    if p_assignee = v_r.employee_id then perform hr_private.fail('A request cannot be assigned to the requester.', 'invalid_assignee'); end if;
    v_user := hr_private.employee_user_id(p_assignee);
    if v_user is null or not exists (select 1 from hr_private.request_staff_users(null) u where u = v_user) then
      perform hr_private.fail('Requests can only be assigned to HR staff who handle requests.', 'invalid_assignee');
    end if;
  end if;
  update public.hr_requests
     set assigned_to = p_assignee, last_activity_at = now(),
         status = case when p_assignee is not null and status = 'open' then 'in_progress' else status end
   where id = v_r.id;
  if p_assignee is not null then
    perform hr_private.notify_employee(p_assignee, 'hr_request', 'HR request assigned to you', v_r.subject,
      '/hr/requests', 'hr_request', v_r.id::text);
  end if;
end $$;

create or replace function public.hr_update_hr_request_status(p_request uuid, p_status text, p_resolution text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.hr_requests; v_res text := nullif(btrim(p_resolution), '');
begin
  perform hr_private.request_require_manage();
  select * into v_r from public.hr_requests where id = p_request for update;
  if v_r.id is null then perform hr_private.fail('Request not found.', 'not_found'); end if;
  if v_r.employee_id = hr_private.current_employee_id() then
    perform hr_private.fail('You cannot handle your own request.', 'self_action');
  end if;
  if p_status is null or p_status not in ('open','in_progress','waiting_on_employee','resolved','closed') then
    perform hr_private.fail('Unknown status.', 'invalid_status');
  end if;
  if v_r.status in ('closed','cancelled') then
    perform hr_private.fail('This request is closed.', 'invalid_state');
  end if;
  if p_status = 'resolved' and v_res is null then
    perform hr_private.fail('Describe the resolution before resolving the request.', 'resolution_required');
  end if;
  if p_status = 'closed' and coalesce(v_res, v_r.resolution) is null then
    perform hr_private.fail('Describe the resolution before closing the request.', 'resolution_required');
  end if;
  update public.hr_requests
     set status = p_status,
         resolution = coalesce(v_res, resolution),
         resolved_at = case when p_status = 'resolved' then now()
                            when p_status = 'closed' then coalesce(resolved_at, now())
                            else null end,
         closed_at = case when p_status = 'closed' then now() else null end,
         last_activity_at = now()
   where id = v_r.id;
  if p_status is distinct from v_r.status then
    perform hr_private.notify_employee(v_r.employee_id, 'hr_request',
      'Your HR request is now ' || replace(p_status, '_', ' '), v_r.subject, '/employee/requests', 'hr_request', v_r.id::text);
  end if;
end $$;

-- Requester confirms a resolved request.
create or replace function public.hr_close_hr_request(p_request uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.hr_requests;
begin
  select * into v_r from public.hr_requests where id = p_request for update;
  if v_r.id is null or v_r.employee_id is distinct from hr_private.current_employee_id() then
    perform hr_private.fail('Request not found.', 'not_found');
  end if;
  if v_r.status <> 'resolved' then perform hr_private.fail('Only resolved requests can be closed.', 'invalid_state'); end if;
  update public.hr_requests set status = 'closed', closed_at = now(), last_activity_at = now() where id = v_r.id;
end $$;

-- Requester reopens within the configured window after resolution.
create or replace function public.hr_reopen_hr_request(p_request uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.hr_requests;
        v_days int := coalesce((hr_private.setting('hr_requests') ->> 'reopen_window_days')::int, 7);
begin
  select * into v_r from public.hr_requests where id = p_request for update;
  if v_r.id is null or v_r.employee_id is distinct from hr_private.current_employee_id() then
    perform hr_private.fail('Request not found.', 'not_found');
  end if;
  if v_r.status not in ('resolved','closed') or v_r.resolved_at is null then
    perform hr_private.fail('Only resolved or closed requests can be reopened.', 'invalid_state');
  end if;
  if v_r.resolved_at < now() - make_interval(days => v_days) then
    perform hr_private.fail(format('Requests can only be reopened within %s days of resolution. Please raise a new request.', v_days), 'reopen_window_passed');
  end if;
  update public.hr_requests
     set status = 'open', resolved_at = null, closed_at = null, last_activity_at = now()
   where id = v_r.id;
  insert into public.hr_request_comments (request_id, author_user_id, author_employee_id, body, is_internal)
  values (v_r.id, auth.uid(), v_r.employee_id, 'Request reopened' || coalesce(': ' || nullif(btrim(p_reason), ''), '.'), false);
  perform hr_private.request_notify_staff(v_r.id, 'HR request reopened: ' || v_r.subject, nullif(btrim(p_reason), ''));
end $$;

create or replace function public.hr_cancel_hr_request(p_request uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.hr_requests;
begin
  select * into v_r from public.hr_requests where id = p_request for update;
  if v_r.id is null or v_r.employee_id is distinct from hr_private.current_employee_id() then
    perform hr_private.fail('Request not found.', 'not_found');
  end if;
  if v_r.status <> 'open' then perform hr_private.fail('Only open requests can be cancelled.', 'invalid_state'); end if;
  update public.hr_requests set status = 'cancelled', cancelled_at = now(), last_activity_at = now() where id = v_r.id;
end $$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke execute on function
  hr_private.request_can_view(uuid, boolean), hr_private.request_comment_visible(uuid, boolean),
  hr_private.request_staff_users(text), hr_private.request_notify_staff(uuid, text, text),
  hr_private.request_require_manage()
from anon, public;
revoke execute on function hr_private.request_notify_staff(uuid, text, text), hr_private.request_staff_users(text) from authenticated;
grant execute on function hr_private.request_can_view(uuid, boolean), hr_private.request_comment_visible(uuid, boolean)
to authenticated, service_role;

revoke execute on function
  public.hr_create_hr_request(text, text, text, text),
  public.hr_comment_hr_request(uuid, text, boolean),
  public.hr_assign_hr_request(uuid, uuid),
  public.hr_update_hr_request_status(uuid, text, text),
  public.hr_close_hr_request(uuid),
  public.hr_reopen_hr_request(uuid, text),
  public.hr_cancel_hr_request(uuid)
from anon, public;
grant execute on function
  public.hr_create_hr_request(text, text, text, text),
  public.hr_comment_hr_request(uuid, text, boolean),
  public.hr_assign_hr_request(uuid, uuid),
  public.hr_update_hr_request_status(uuid, text, text),
  public.hr_close_hr_request(uuid),
  public.hr_reopen_hr_request(uuid, text),
  public.hr_cancel_hr_request(uuid)
to authenticated;
