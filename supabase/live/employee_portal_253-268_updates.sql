-- =====================================================================================
-- Employee Portal + Roles & Permissions — live database update (run in Lovable Cloud -> SQL editor,
-- AFTER employee_portal_schema_229-252.sql). Same as migrations 253 … 268, as ONE transaction.
--   253: the admin can change an employee's Employee ID.
--   254: an employee can cancel a leave request only before anyone approved it.
--   255/257/258: leave order: reporting manager reviews -> admin approves -> manager gives the final
--        approval (the manager is told the admin's decision). Without a manager in the portal the admin decides.
--   256: Admin Notifications inbox.
--   259: ROLES & PERMISSIONS (Settings -> Users & Roles, Roles & Permissions). Existing admins become
--        Super Admin automatically; every admin page, security policy and function then checks the
--        permission of its module. The original policies and is_admin() are saved (rbac_backup).
--   260: Manager and Team Lead are two separate roles.
--   261: permissions per ACTION (view / create / edit / delete / download / approve / export / see passwords).
--   262: permissions per PAGE (Clients, Search Console separate) and any role may get any page.
--   263: one role per person (extra roles removed, highest kept); change my password from My profile.
--   264: no self-approval, admin notifications filtered by page, named approver per employee, approver names shown.
--   265: a daily work report can be submitted without any project ("What did you work on today?").
--   266: daily work report "Send by email" (Resend). Needs pg_net + the Resend key in the Vault (see SETUP.md).
--   267: HR, Manager, Team Lead and Employee need their own real email; Super Admin / Admin may use any email.
--   268: new accounts get their sign-in email + one-time password by email; bounces -> "Mailbox does not exist".
-- No data is copied. Safe to run again.
-- =====================================================================================

begin;

do $$
begin
  if to_regprocedure('public.ep_admin_update_employee(uuid, jsonb)') is null
     or to_regprocedure('public.ep_cancel_leave(uuid)') is null
     or to_regprocedure('public.ep_team_leave()') is null
     or to_regclass('public.ep_employee_documents') is null then
    raise exception 'Employee Portal is not installed here. Run employee_portal_schema_229-252.sql first.';
  end if;
end $$;

-- ===================== 253_employee_edit_id.sql =====================

create or replace function public.ep_admin_update_employee(p_id uuid, p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  f text;
  v_old public.ep_employees;
  v_new public.ep_employees;
  v_mgr uuid;
  v_walk uuid;
  v_depth int := 0;
  v_mgr_name text;
  v_code text;
begin
  perform public.ep_require_admin();
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Invalid employee data.' using errcode = '22023';
  end if;
  for f in select jsonb_object_keys(p) loop
    if f not in ('employee_code', 'full_name', 'department', 'designation', 'reporting_manager_id', 'reporting_manager_name',
                 'date_of_joining', 'employment_type', 'work_location') then
      raise exception 'Field % cannot be changed here.', f using errcode = '42501';
    end if;
  end loop;

  select * into v_old from public.ep_employees where id = p_id for update;
  if v_old.id is null then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;

  if p ? 'full_name' and nullif(btrim(p ->> 'full_name'), '') is null then
    raise exception 'Name cannot be empty.' using errcode = '22023';
  end if;

  -- Employee ID: the admin may change it (sign-in stays the same: it uses the email).
  v_code := case when p ? 'employee_code' then upper(btrim(coalesce(p ->> 'employee_code', ''))) else v_old.employee_code end;
  if v_code !~ '^[A-Z0-9][A-Z0-9-]{1,29}$' then
    raise exception 'Employee ID: use 2-30 letters, numbers or dashes (e.g. ZT-001).' using errcode = '22023';
  end if;
  if v_code <> v_old.employee_code
     and exists (select 1 from public.ep_employees where employee_code = v_code and id <> p_id) then
    raise exception 'Employee ID % is already used by another employee.', v_code using errcode = '23505';
  end if;

  -- Reporting manager: must exist, be active, not the employee, and not create a loop.
  v_mgr := case when p ? 'reporting_manager_id'
                then nullif(btrim(p ->> 'reporting_manager_id'), '')::uuid
                else v_old.reporting_manager_id end;
  if p ? 'reporting_manager_id' and v_mgr is not null
     and v_mgr is distinct from v_old.reporting_manager_id then
    if v_mgr = p_id then
      raise exception 'An employee cannot report to themselves.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.ep_employees where id = v_mgr and is_active) then
      raise exception 'Choose an active employee as reporting manager.' using errcode = '22023';
    end if;
    v_walk := v_mgr;
    while v_walk is not null and v_depth < 100 loop
      if v_walk = p_id then
        raise exception 'That would make a loop: this employee is above the chosen manager.' using errcode = '22023';
      end if;
      select reporting_manager_id into v_walk from public.ep_employees where id = v_walk;
      v_depth := v_depth + 1;
    end loop;
  end if;

  -- Typed manager name (someone who is not in the portal). A portal manager replaces it.
  v_mgr_name := case when p ? 'reporting_manager_name' then nullif(btrim(coalesce(p ->> 'reporting_manager_name', '')), '')
                     else v_old.reporting_manager_name end;
  if v_mgr is not null then
    v_mgr_name := null;
  end if;
  if length(v_mgr_name) > 120 then
    raise exception 'Manager name must be at most 120 characters.' using errcode = '22023';
  end if;

  update public.ep_employees set
    full_name            = case when p ? 'full_name' then btrim(p ->> 'full_name') else full_name end,
    department           = case when p ? 'department' then nullif(btrim(p ->> 'department'), '') else department end,
    designation          = case when p ? 'designation' then nullif(btrim(p ->> 'designation'), '') else designation end,
    employee_code        = v_code,
    reporting_manager_id = v_mgr,
    reporting_manager_name = v_mgr_name,
    date_of_joining      = case when p ? 'date_of_joining' then nullif(btrim(p ->> 'date_of_joining'), '')::date else date_of_joining end,
    employment_type      = case when p ? 'employment_type' then nullif(btrim(p ->> 'employment_type'), '') else employment_type end,
    work_location        = case when p ? 'work_location' then nullif(btrim(p ->> 'work_location'), '') else work_location end,
    updated_at           = now()
  where id = p_id
  returning * into v_new;

  if v_new.employee_code is distinct from v_old.employee_code then
    perform public.ep_notify(
      p_id, 'message', 'Your Employee ID was changed',
      'Your Employee ID is now ' || v_new.employee_code || ' (was ' || v_old.employee_code
        || '). You still sign in with the same email and password.',
      '/employee/profile');
  end if;

  -- Tell the people concerned when the reporting line changes.
  if v_new.reporting_manager_id is distinct from v_old.reporting_manager_id then
    if v_new.reporting_manager_id is not null then
      perform public.ep_notify(
        p_id, 'message', 'Your reporting manager was updated',
        'You now report to ' || (select full_name from public.ep_employees where id = v_new.reporting_manager_id) || '.',
        '/employee/profile');
      perform public.ep_notify(
        v_new.reporting_manager_id, 'message', v_new.full_name || ' now reports to you',
        v_new.full_name || ' (' || v_new.employee_code || ') was added to your team by the admin.',
        null);
    elsif v_new.reporting_manager_name is null then
      perform public.ep_notify(
        p_id, 'message', 'Your reporting manager was removed',
        'No reporting manager is set for you right now.', '/employee/profile');
    end if;
  end if;

  -- A typed (non-portal) manager set or changed: tell the employee.
  if v_new.reporting_manager_id is null and v_new.reporting_manager_name is not null
     and v_new.reporting_manager_name is distinct from v_old.reporting_manager_name then
    perform public.ep_notify(
      p_id, 'message', 'Your reporting manager was updated',
      'You now report to ' || v_new.reporting_manager_name || '.', '/employee/profile');
  end if;

  return public.ep_admin_employee(p_id);
end $$;

-- ===================== 254_employee_cancel_pending_only.sql =====================

create or replace function public.ep_cancel_leave(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp   uuid := public.ep_current_employee_id();
  v_row   public.ep_leave_requests;
  v_name  text;
begin
  select * into v_row from public.ep_leave_requests where id = p_id and employee_id = v_emp for update;
  if v_emp is null or v_row.id is null then
    raise exception 'Leave request not found.' using errcode = '42501';
  end if;
  -- Once the admin has approved or rejected it, the employee can no longer cancel it.
  if v_row.status <> 'pending' then
    raise exception 'This leave was already % by the admin, so it can no longer be cancelled. Please contact the admin.',
      v_row.status using errcode = 'P0001';
  end if;
  update public.ep_leave_requests set status = 'cancelled', updated_at = now() where id = p_id returning * into v_row;
  select full_name into v_name from public.ep_employees where id = v_emp;
  perform public.ep_notify(v_row.approver_id, 'leave',
    v_name || ' cancelled a leave request',
    to_char(v_row.start_date, 'DD Mon YYYY') || case when v_row.end_date <> v_row.start_date then ' – ' || to_char(v_row.end_date, 'DD Mon YYYY') else '' end,
    '/employee/leave/team');
  return public.ep_leave_json(v_row);
end $$;

-- ===================== 255_employee_leave_admin_then_manager.sql =====================

alter table public.ep_leave_requests drop constraint if exists ep_leave_requests_status_check;
alter table public.ep_leave_requests add constraint ep_leave_requests_status_check
  check (status in ('pending', 'manager_pending', 'approved', 'rejected', 'cancelled'));
alter table public.ep_leave_requests
  add column if not exists admin_comment text check (admin_comment is null or length(admin_comment) <= 1000),
  add column if not exists admin_decided_at timestamptz;
comment on column public.ep_leave_requests.admin_comment is 'Feedback the admin wrote at the admin step (step 1).';
comment on column public.ep_leave_requests.admin_decided_at is 'When the admin approved/rejected (step 1).';
-- Requests the admin already decided before this change: keep the admin step filled in.
update public.ep_leave_requests
   set admin_comment = decision_comment, admin_decided_at = decided_at
 where decided_by_admin is not null and admin_decided_at is null;

-- JSON for one request: adds the admin step (admin_comment / admin_decided_at) and the manager.
create or replace function public.ep_leave_json(r public.ep_leave_requests)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'leave_type', r.leave_type, 'leave_name', (select name from public.ep_leave_types where code = r.leave_type),
    'start_date', r.start_date, 'end_date', r.end_date, 'half_day', r.half_day, 'days', r.days,
    'reason', r.reason, 'status', r.status, 'created_at', r.created_at,
    'decided_at', r.decided_at, 'decision_comment', r.decision_comment,
    'decided_by', coalesce((select full_name from public.ep_employees where id = r.decided_by),
                           case when r.decided_by_admin is not null and r.decided_at is not null then 'Admin' end),
    'admin_decided_at', r.admin_decided_at, 'admin_comment', r.admin_comment,
    'manager', case when r.status = 'manager_pending' or r.decided_by is not null
                    then (select full_name from public.ep_employees where id = coalesce(r.decided_by, r.approver_id)) end,
    'approver', coalesce((select full_name from public.ep_employees where id = r.approver_id), r.approver_name),
    'employee', (select jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
                                           'designation', e.designation)
                   from public.ep_employees e where e.id = r.employee_id));
$$;

-- Admin decides FIRST.
--   reject  -> final (reason required)
--   approve -> if the employee has a reporting manager with an active portal account (the profile's
--              reporting manager, else the colleague the employee picked on the form), it goes to that
--              manager for the final decision (status manager_pending); otherwise the admin's approval is final.
--   A request already with the manager can still be decided by the admin as the FINAL decision
--   (e.g. the manager is away).
create or replace function public.ep_admin_decide_leave(p_id uuid, p_action text, p_comment text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_row      public.ep_leave_requests;
  v_comment  text := nullif(btrim(coalesce(p_comment, '')), '');
  v_allowed  numeric;
  v_type     public.ep_leave_types;
  v_mgr      uuid;
  v_what     text;
  v_emp_name text;
  v_final    boolean;
begin
  perform public.ep_require_admin();
  select * into v_row from public.ep_leave_requests where id = p_id for update;
  if v_row.id is null then
    raise exception 'Leave request not found.' using errcode = 'P0002';
  end if;
  if v_row.status not in ('pending', 'manager_pending') then
    raise exception 'This request was already %.', v_row.status using errcode = 'P0001';
  end if;
  if p_action not in ('approved', 'rejected') then
    raise exception 'Invalid action.' using errcode = '22023';
  end if;
  if p_action = 'rejected' and v_comment is null then
    raise exception 'Write a reason for rejecting.' using errcode = '22023';
  end if;
  if coalesce(length(v_comment), 0) > 1000 then
    raise exception 'Comment must be at most 1000 characters.' using errcode = '22023';
  end if;
  select * into v_type from public.ep_leave_types where code = v_row.leave_type;
  if p_action = 'approved' then
    v_allowed := public.ep_leave_allowance(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type);
    if v_type.is_paid and v_allowed is not null
       and public.ep_leave_taken(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type, v_row.id)
           + v_row.days > v_allowed then
      raise exception 'Not enough % balance left to approve this. Increase the balance or ask for Loss of Pay.', v_type.name
        using errcode = '22023';
    end if;
  end if;

  v_what := v_type.name || ' · ' || to_char(v_row.start_date, 'DD Mon YYYY')
    || case when v_row.end_date <> v_row.start_date then ' – ' || to_char(v_row.end_date, 'DD Mon YYYY') else '' end;
  select full_name into v_emp_name from public.ep_employees where id = v_row.employee_id;

  if v_row.status = 'pending' and p_action = 'approved' then
    select m.id into v_mgr
      from public.ep_employees e join public.ep_employees m on m.id = e.reporting_manager_id
     where e.id = v_row.employee_id and m.is_active and m.id <> e.id;
    if v_mgr is null and v_row.approver_id is not null and v_row.approver_id <> v_row.employee_id
       and exists (select 1 from public.ep_employees where id = v_row.approver_id and is_active) then
      v_mgr := v_row.approver_id;
    end if;
  end if;

  if v_mgr is not null then
    -- Step 1 done: the admin approved; now the reporting manager decides.
    update public.ep_leave_requests
       set status = 'manager_pending', approver_id = v_mgr,
           decided_by_admin = auth.uid(), admin_decided_at = now(), admin_comment = v_comment, updated_at = now()
     where id = p_id returning * into v_row;
    perform public.ep_notify(v_row.employee_id, 'leave',
      'Admin approved your leave — waiting for your manager',
      v_what || ' · now with ' || (select full_name from public.ep_employees where id = v_mgr) || ' for the final decision'
        || coalesce(' · Admin: ' || v_comment, ''),
      '/employee/leave', 'normal');
    perform public.ep_notify(v_mgr, 'leave',
      v_emp_name || '''s leave needs your decision',
      v_what || ' · approved by the admin' || coalesce(' (' || v_comment || ')', '') || '. Accept or reject it in Team requests.',
      '/employee/leave/team', 'normal');
  else
    -- Final decision by the admin: reject; approve with no portal manager; or deciding instead of the manager.
    v_final := v_row.status = 'manager_pending';
    update public.ep_leave_requests
       set status = p_action, decided_by = null, decided_by_admin = auth.uid(), decided_at = now(),
           decision_comment = v_comment,
           admin_decided_at = coalesce(admin_decided_at, now()),
           admin_comment = case when v_final then admin_comment else v_comment end,
           updated_at = now()
     where id = p_id returning * into v_row;
    perform public.ep_notify(v_row.employee_id, 'leave',
      'Your leave was ' || p_action,
      v_what || ' · by Admin' || coalesce(' · ' || v_comment, ''),
      '/employee/leave', case when p_action = 'rejected' then 'urgent' else 'normal' end);
    if v_final and v_row.approver_id is not null then
      perform public.ep_notify(v_row.approver_id, 'leave',
        v_emp_name || '''s leave was ' || p_action || ' by the admin',
        v_what || ' · no action needed from you.', '/employee/leave/team', 'normal');
    end if;
  end if;
  return public.ep_leave_json(v_row)
    || jsonb_build_object('balance',
         public.ep_leave_balance_json(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type));
end $$;

-- The reporting manager decides SECOND (final), only after the admin approved (status manager_pending).
create or replace function public.ep_decide_leave(p_id uuid, p_action text, p_comment text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp     uuid := public.ep_current_employee_id();
  v_row     public.ep_leave_requests;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_allowed numeric;
  v_type    public.ep_leave_types;
begin
  select r.* into v_row from public.ep_leave_requests r join public.ep_employees e on e.id = r.employee_id
   where r.id = p_id and (r.approver_id = v_emp or e.reporting_manager_id = v_emp) and r.employee_id <> v_emp
   for update of r;
  if v_emp is null or v_row.id is null then
    raise exception 'Leave request not found.' using errcode = '42501';
  end if;
  if v_row.status = 'pending' then
    raise exception 'The admin has not approved this request yet.' using errcode = 'P0001';
  end if;
  if v_row.status <> 'manager_pending' then
    raise exception 'This request was already %.', v_row.status using errcode = 'P0001';
  end if;
  if p_action not in ('approved', 'rejected') then
    raise exception 'Invalid action.' using errcode = '22023';
  end if;
  if p_action = 'rejected' and v_comment is null then
    raise exception 'Write a reason for rejecting.' using errcode = '22023';
  end if;
  if coalesce(length(v_comment), 0) > 1000 then
    raise exception 'Comment must be at most 1000 characters.' using errcode = '22023';
  end if;
  select * into v_type from public.ep_leave_types where code = v_row.leave_type;
  if p_action = 'approved' then
    -- The balance may have changed since the admin approved; check again without this request.
    v_allowed := public.ep_leave_allowance(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type);
    if v_type.is_paid and v_allowed is not null
       and public.ep_leave_taken(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type, v_row.id)
           + v_row.days > v_allowed then
      raise exception 'Not enough % balance left to approve this.', v_type.name using errcode = '22023';
    end if;
  end if;
  update public.ep_leave_requests
     set status = p_action, decided_by = v_emp, decided_at = now(), decision_comment = v_comment, updated_at = now()
   where id = p_id returning * into v_row;
  perform public.ep_notify(v_row.employee_id, 'leave',
    'Your leave was ' || p_action,
    v_type.name || ' · ' || to_char(v_row.start_date, 'DD Mon YYYY')
      || case when v_row.end_date <> v_row.start_date then ' – ' || to_char(v_row.end_date, 'DD Mon YYYY') else '' end
      || ' · by ' || (select full_name from public.ep_employees where id = v_emp)
      || coalesce(' · ' || v_comment, ''),
    '/employee/leave', case when p_action = 'rejected' then 'urgent' else 'normal' end);
  return public.ep_leave_json(v_row);
end $$;

-- Team requests for a reporting manager: only requests the admin already approved (waiting for them),
-- plus the ones they decided (last 90 days + upcoming). Requests still with the admin are not shown.
create or replace function public.ep_team_leave()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_emp   uuid := public.ep_current_employee_id();
  v_today date := (timezone('Asia/Kolkata', now()))::date;
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'team_size', (select count(*) from public.ep_employees where reporting_manager_id = v_emp and is_active),
    'requests', coalesce((
      select jsonb_agg(public.ep_leave_json(r) order by (r.status = 'manager_pending') desc, r.start_date desc)
      from public.ep_leave_requests r join public.ep_employees e on e.id = r.employee_id
      where r.employee_id <> v_emp
        and (r.approver_id = v_emp or e.reporting_manager_id = v_emp or r.decided_by = v_emp)
        and (r.status = 'manager_pending' or (r.decided_by = v_emp and r.end_date >= v_today - 90))), '[]'::jsonb));
end $$;

-- ---- generated from the current definitions: only the status lists change

CREATE OR REPLACE FUNCTION public.ep_apply_leave(p_type text, p_start date, p_end date, p_half text, p_reason text, p_manager_id uuid, p_manager_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp     uuid := public.ep_current_employee_id();
  v_today   date := (timezone('Asia/Kolkata', now()))::date;
  v_name    text;
  v_type    public.ep_leave_types;
  v_days    numeric;
  v_allowed numeric;
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_half    text := nullif(p_half, '');
  v_mgr     uuid := p_manager_id;
  v_mgrname text := nullif(btrim(coalesce(p_manager_name, '')), '');
  v_row     public.ep_leave_requests;
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  select * into v_type from public.ep_leave_types where code = p_type and is_active;
  if v_type.code is null then
    raise exception 'Choose a leave type.' using errcode = '22023';
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'Choose a valid start and end date.' using errcode = '22023';
  end if;
  if extract(year from p_start) <> extract(year from p_end) then
    raise exception 'A leave request cannot cross into the next year. Apply for each year separately.' using errcode = '22023';
  end if;
  if p_start < v_today - 30 or p_end > v_today + 365 then
    raise exception 'Leave can start at most 30 days ago and end at most one year ahead.' using errcode = '22023';
  end if;
  if v_half is not null and (v_half not in ('first_half', 'second_half') or p_start <> p_end) then
    raise exception 'A half day must be a single date.' using errcode = '22023';
  end if;
  if length(v_reason) not between 1 and 1000 then
    raise exception 'Write a reason (up to 1000 characters).' using errcode = '22023';
  end if;

  -- Reporting manager: a picked colleague (must be active, not yourself) and/or a typed name.
  if v_mgr is not null then
    select full_name into v_mgrname from public.ep_employees where id = v_mgr and is_active and id <> v_emp;
    if v_mgrname is null then
      raise exception 'Choose a valid reporting manager.' using errcode = '22023';
    end if;
  end if;
  if v_mgrname is null then
    raise exception 'Enter your reporting manager.' using errcode = '22023';
  end if;
  if length(v_mgrname) > 120 then
    raise exception 'Reporting manager name must be at most 120 characters.' using errcode = '22023';
  end if;

  select full_name into v_name from public.ep_employees where id = v_emp;

  perform pg_advisory_xact_lock(hashtextextended('leave' || v_emp::text, 0));

  v_days := public.ep_leave_day_count(p_start, p_end, v_half);
  if v_days = 0 then
    raise exception 'These dates are only Sundays or company holidays, so no leave is needed.' using errcode = '22023';
  end if;
  if exists (select 1 from public.ep_leave_requests r
              where r.employee_id = v_emp and r.status in ('pending', 'manager_pending', 'approved')
                and r.start_date <= p_end and r.end_date >= p_start
                and not (r.start_date = r.end_date and p_start = p_end and r.half_day is not null and v_half is not null
                         and r.half_day <> v_half)) then
    raise exception 'You already have leave on some of these dates.' using errcode = '22023';
  end if;
  v_allowed := public.ep_leave_allowance(v_emp, extract(year from p_start)::int, p_type);
  if v_type.is_paid and v_allowed is not null
     and public.ep_leave_taken(v_emp, extract(year from p_start)::int, p_type) + v_days > v_allowed then
    raise exception 'Not enough % balance: % day(s) left, % requested.', v_type.name,
      greatest(v_allowed - public.ep_leave_taken(v_emp, extract(year from p_start)::int, p_type), 0), v_days
      using errcode = '22023';
  end if;

  insert into public.ep_leave_requests
    (employee_id, leave_type, start_date, end_date, half_day, days, reason, approver_id, approver_name)
  values (v_emp, p_type, p_start, p_end, v_half, v_days, v_reason, v_mgr, v_mgrname)
  returning * into v_row;

  -- Only a colleague in the portal can be notified.
  perform public.ep_notify(v_mgr, 'leave',
    v_name || ' applied for ' || v_type.name,
    to_char(p_start, 'DD Mon') || case when p_end <> p_start then ' – ' || to_char(p_end, 'DD Mon YYYY') else to_char(p_start, ' YYYY') end
      || ' · ' || v_days || ' day(s) · ' || left(v_reason, 200)
      || ' · waiting for the admin first; you will be asked to decide after the admin approves.',
    '/employee/leave');
  return public.ep_leave_json(v_row);
end $function$;

CREATE OR REPLACE FUNCTION public.ep_leave_taken(p_emp uuid, p_year integer, p_type text, p_skip uuid DEFAULT NULL::uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(sum(days), 0) from public.ep_leave_requests
   where employee_id = p_emp and leave_type = p_type and extract(year from start_date) = p_year
     and status in ('pending', 'manager_pending', 'approved') and id is distinct from p_skip;
$function$;

CREATE OR REPLACE FUNCTION public.ep_recount_leave_on(p_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.ep_leave_requests;
  v_days numeric;
begin
  for r in select * from public.ep_leave_requests
            where status in ('pending', 'manager_pending', 'approved') and p_date between start_date and end_date for update loop
    v_days := public.ep_leave_day_count(r.start_date, r.end_date, r.half_day);
    if v_days = 0 then
      update public.ep_leave_requests
         set status = 'cancelled', updated_at = now(),
             decision_comment = 'Cancelled automatically: the day is now a company holiday.'
       where id = r.id;
      perform public.ep_notify(r.employee_id, 'leave', 'Leave not needed — company holiday',
        to_char(r.start_date, 'DD Mon YYYY') || ' is now a company holiday, so your leave request was cancelled.',
        '/employee/leave');
    elsif v_days <> r.days then
      update public.ep_leave_requests set days = v_days, updated_at = now() where id = r.id;
    end if;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.ep_leave_balance_json(p_emp uuid, p_year integer, p_type text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'code', t.code, 'name', t.name, 'is_paid', t.is_paid,
    'default', t.yearly_days,
    'allowed', public.ep_leave_allowance(p_emp, p_year, t.code),
    'is_custom', exists (select 1 from public.ep_leave_allocations a
                          where a.employee_id = p_emp and a.year = p_year and a.leave_type = t.code),
    'approved', (select coalesce(sum(days), 0) from public.ep_leave_requests
                  where employee_id = p_emp and leave_type = t.code and status = 'approved'
                    and extract(year from start_date) = p_year),
    'pending', (select coalesce(sum(days), 0) from public.ep_leave_requests
                 where employee_id = p_emp and leave_type = t.code and status in ('pending', 'manager_pending')
                   and extract(year from start_date) = p_year))
  from public.ep_leave_types t where t.code = p_type;
$function$;

CREATE OR REPLACE FUNCTION public.ep_leave_overview(p_year integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp uuid := public.ep_current_employee_id();
  v_mgr uuid;
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if p_year is null or p_year not between 2020 and 2100 then
    raise exception 'Invalid year.' using errcode = '22023';
  end if;
  select reporting_manager_id into v_mgr from public.ep_employees where id = v_emp;
  return jsonb_build_object(
    'year', p_year,
    'manager', coalesce(
      (select jsonb_build_object('id', m.id, 'full_name', m.full_name) from public.ep_employees m where m.id = v_mgr),
      (select jsonb_build_object('id', null, 'full_name', reporting_manager_name)
         from public.ep_employees where id = v_emp and reporting_manager_name is not null)),
    'balances', (
      select jsonb_agg(jsonb_build_object(
               'code', t.code, 'name', t.name, 'is_paid', t.is_paid,
               'allowed', public.ep_leave_allowance(v_emp, p_year, t.code),
               'approved', (select coalesce(sum(days), 0) from public.ep_leave_requests
                             where employee_id = v_emp and leave_type = t.code and status = 'approved'
                               and extract(year from start_date) = p_year),
               'pending', (select coalesce(sum(days), 0) from public.ep_leave_requests
                            where employee_id = v_emp and leave_type = t.code and status in ('pending', 'manager_pending')
                              and extract(year from start_date) = p_year))
             order by t.sort_order)
      from public.ep_leave_types t where t.is_active),
    'requests', coalesce((
      select jsonb_agg(public.ep_leave_json(r) order by r.start_date desc, r.created_at desc)
      from public.ep_leave_requests r
      where r.employee_id = v_emp and extract(year from r.start_date) = p_year), '[]'::jsonb),
    'holidays', coalesce((
      select jsonb_agg(jsonb_build_object('date', h.holiday_date, 'name', h.name) order by h.holiday_date)
      from public.ep_holidays h where extract(year from h.holiday_date) = p_year), '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.ep_admin_leave_requests(p_status text DEFAULT 'pending'::text, p_year integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.ep_require_admin();
  return coalesce((
    select jsonb_agg(public.ep_leave_json(r)
             || jsonb_build_object('balance',
                  public.ep_leave_balance_json(r.employee_id, extract(year from r.start_date)::int, r.leave_type))
             order by case r.status when 'pending' then 0 when 'manager_pending' then 1 else 2 end, r.start_date desc, r.created_at desc)
    from (select * from public.ep_leave_requests
           where (coalesce(p_status, 'all') = 'all' or status = p_status)
             and (p_year is null or extract(year from start_date) = p_year)
           order by start_date desc limit 300) r), '[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.ep_cancel_leave(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp   uuid := public.ep_current_employee_id();
  v_row   public.ep_leave_requests;
  v_name  text;
begin
  select * into v_row from public.ep_leave_requests where id = p_id and employee_id = v_emp for update;
  if v_emp is null or v_row.id is null then
    raise exception 'Leave request not found.' using errcode = '42501';
  end if;
  -- Once the admin has approved or rejected it, the employee can no longer cancel it.
  if v_row.status = 'manager_pending' then
    raise exception 'The admin already approved this leave and it is now with your reporting manager, so it can no longer be cancelled. Please contact the admin.'
      using errcode = 'P0001';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'This leave was already % by the admin, so it can no longer be cancelled. Please contact the admin.',
      v_row.status using errcode = 'P0001';
  end if;
  update public.ep_leave_requests set status = 'cancelled', updated_at = now() where id = p_id returning * into v_row;
  select full_name into v_name from public.ep_employees where id = v_emp;
  perform public.ep_notify(v_row.approver_id, 'leave',
    v_name || ' cancelled a leave request',
    to_char(v_row.start_date, 'DD Mon YYYY') || case when v_row.end_date <> v_row.start_date then ' – ' || to_char(v_row.end_date, 'DD Mon YYYY') else '' end,
    '/employee/leave');
  return public.ep_leave_json(v_row);
end $function$;

-- ===================== 256_employee_admin_inbox.sql =====================

-- ================================================================ tables
create table if not exists public.ep_admin_notifications (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid references public.ep_employees (id) on delete cascade,
  kind        text not null check (kind in ('leave', 'attendance', 'report', 'project', 'profile', 'account')),
  priority    text not null default 'normal' check (priority in ('normal', 'urgent')),
  title       text not null check (length(btrim(title)) between 1 and 200),
  body        text check (body is null or length(body) <= 2000),
  link        text check (link is null or link ~ '^/admin(/|$|\?)'),
  dedupe_key  text,
  created_at  timestamptz not null default now()
);
create index if not exists ep_admin_notifications_created_idx on public.ep_admin_notifications (created_at desc);
create index if not exists ep_admin_notifications_dedupe_idx on public.ep_admin_notifications (dedupe_key, created_at desc)
  where dedupe_key is not null;
comment on table public.ep_admin_notifications is
  'Employee Portal: events for the admin inbox (written by triggers through ep_admin_notify).';

create table if not exists public.ep_admin_notification_reads (
  notification_id uuid not null references public.ep_admin_notifications (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (notification_id, user_id)
);
comment on table public.ep_admin_notification_reads is 'Employee Portal: which admin has read which admin notification.';

alter table public.ep_admin_notifications enable row level security;
alter table public.ep_admin_notification_reads enable row level security;
revoke all on public.ep_admin_notifications, public.ep_admin_notification_reads from anon, authenticated;
-- No policies: read and written only through the security-definer functions below.

-- ================================================================ helpers (internal)
create or replace function public.ep_admin_notify(
  p_emp uuid, p_kind text, p_title text, p_body text, p_link text,
  p_priority text default 'normal', p_dedupe text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  -- Same event again within 2 minutes (e.g. several rows saved at once): one notification is enough.
  if p_dedupe is not null and exists (
       select 1 from public.ep_admin_notifications
        where dedupe_key = p_dedupe and created_at > now() - interval '2 minutes') then
    return;
  end if;
  insert into public.ep_admin_notifications (employee_id, kind, priority, title, body, link, dedupe_key)
  values (p_emp, p_kind, coalesce(p_priority, 'normal'), left(btrim(p_title), 200), left(p_body, 2000), p_link, p_dedupe);
  -- Keep the inbox small: now and then remove events older than 180 days.
  if random() < 0.02 then
    delete from public.ep_admin_notifications where created_at < now() - interval '180 days';
  end if;
end $$;

-- The employee row of the person signed in right now (null for admins, the nightly job, SQL editor).
create or replace function public.ep_actor_employee()
returns public.ep_employees
language sql stable security definer set search_path = ''
as $$
  select e.* from public.ep_employees e where e.user_id = auth.uid() limit 1;
$$;

create or replace function public.ep_admin_fmt_dates(p_start date, p_end date)
returns text
language sql immutable set search_path = ''
as $$
  select to_char(p_start, 'DD Mon YYYY')
         || case when p_end is distinct from p_start then ' – ' || to_char(p_end, 'DD Mon YYYY') else '' end;
$$;

revoke all on function public.ep_admin_notify(uuid, text, text, text, text, text, text),
  public.ep_actor_employee(), public.ep_admin_fmt_dates(date, date) from public, anon, authenticated;

-- ================================================================ triggers
-- Leave: applied / cancelled by the employee; final decision by the reporting manager.
create or replace function public.ep_trg_admin_leave()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor public.ep_employees := public.ep_actor_employee();
  v_emp   public.ep_employees;
  v_type  text;
begin
  begin
    select * into v_emp from public.ep_employees where id = new.employee_id;
    select name into v_type from public.ep_leave_types where code = new.leave_type;
    if tg_op = 'INSERT' and v_actor.id = new.employee_id then
      perform public.ep_admin_notify(new.employee_id, 'leave',
        v_emp.full_name || ' applied for ' || v_type,
        public.ep_admin_fmt_dates(new.start_date, new.end_date) || ' · ' || trim(to_char(new.days, 'FM990.9')) || ' day(s) · '
          || left(new.reason, 200) || ' · waiting for your approval',
        '/admin/leave');
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
      if new.status = 'cancelled' and v_actor.id = new.employee_id then
        perform public.ep_admin_notify(new.employee_id, 'leave',
          v_emp.full_name || ' cancelled a leave request',
          v_type || ' · ' || public.ep_admin_fmt_dates(new.start_date, new.end_date), '/admin/leave');
      elsif old.status = 'manager_pending' and new.status in ('approved', 'rejected')
            and new.decided_by is not null and v_actor.id = new.decided_by then
        perform public.ep_admin_notify(new.employee_id, 'leave',
          v_actor.full_name || case when new.status = 'approved' then ' accepted ' else ' rejected ' end
            || v_emp.full_name || '''s leave',
          v_type || ' · ' || public.ep_admin_fmt_dates(new.start_date, new.end_date)
            || ' · final decision by the reporting manager' || coalesce(' · ' || new.decision_comment, ''),
          '/admin/leave?tab=requests');
      end if;
    end if;
  exception when others then
    raise warning 'admin notification (leave) skipped: %', sqlerrm;
  end;
  return null;
end $$;

-- Attendance: late first punch-in (by the employee); auto punch-out (nightly job).
create or replace function public.ep_trg_admin_attendance()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor public.ep_employees := public.ep_actor_employee();
  v_emp   public.ep_employees;
  v_late  time;
  v_in    time;
begin
  begin
    select * into v_emp from public.ep_employees where id = new.employee_id;
    if tg_op = 'INSERT' and v_actor.id = new.employee_id then
      v_late := coalesce((public.ep_attendance_rules() ->> 'late_after')::time, time '09:40');
      v_in := (new.punch_in_at at time zone 'Asia/Kolkata')::time;
      if v_in > v_late and not exists (
           select 1 from public.ep_attendance a
            where a.employee_id = new.employee_id and a.work_date = new.work_date and a.id <> new.id) then
        perform public.ep_admin_notify(new.employee_id, 'attendance',
          v_emp.full_name || ' punched in late at ' || to_char(new.punch_in_at at time zone 'Asia/Kolkata', 'HH12:MI am'),
          to_char(new.work_date, 'Dy DD Mon YYYY') || ' · late after ' || to_char(v_late, 'HH12:MI am'),
          '/admin/attendance?tab=late');
      end if;
    elsif tg_op = 'UPDATE' and new.auto_punched_out and not coalesce(old.auto_punched_out, false) then
      perform public.ep_admin_notify(new.employee_id, 'attendance',
        v_emp.full_name || ' forgot to punch out',
        to_char(new.work_date, 'Dy DD Mon YYYY') || ' · punched out automatically at '
          || to_char(new.punch_out_at at time zone 'Asia/Kolkata', 'HH12:MI am'),
        '/admin/attendance?tab=missing');
    end if;
  exception when others then
    raise warning 'admin notification (attendance) skipped: %', sqlerrm;
  end;
  return null;
end $$;

-- Attendance corrections: requested / withdrawn by the employee.
create or replace function public.ep_trg_admin_correction()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor public.ep_employees := public.ep_actor_employee();
  v_emp   public.ep_employees;
begin
  begin
    if v_actor.id is distinct from new.employee_id then
      return null;
    end if;
    select * into v_emp from public.ep_employees where id = new.employee_id;
    if tg_op = 'INSERT' then
      perform public.ep_admin_notify(new.employee_id, 'attendance',
        v_emp.full_name || ' requested an attendance correction',
        to_char(new.work_date, 'Dy DD Mon YYYY') || ' · ' || left(coalesce(new.reason, ''), 200) || ' · waiting for your decision',
        '/admin/attendance?tab=corrections');
    elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' then
      perform public.ep_admin_notify(new.employee_id, 'attendance',
        v_emp.full_name || ' withdrew an attendance correction',
        to_char(new.work_date, 'Dy DD Mon YYYY'), '/admin/attendance?tab=corrections');
    end if;
  exception when others then
    raise warning 'admin notification (correction) skipped: %', sqlerrm;
  end;
  return null;
end $$;

-- Daily work report submitted by the employee.
create or replace function public.ep_trg_admin_report()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor public.ep_employees := public.ep_actor_employee();
  v_emp   public.ep_employees;
begin
  begin
    if v_actor.id is distinct from new.employee_id or new.status <> 'submitted'
       or (tg_op = 'UPDATE' and old.status = 'submitted') then
      return null;
    end if;
    select * into v_emp from public.ep_employees where id = new.employee_id;
    perform public.ep_admin_notify(new.employee_id, 'report',
      v_emp.full_name || ' submitted the daily report',
      'Report for ' || to_char(new.report_date, 'Dy DD Mon YYYY')
        || case when new.submitted_to is null then ' · waiting for your review' else '' end,
      '/admin/reports');
  exception when others then
    raise warning 'admin notification (report) skipped: %', sqlerrm;
  end;
  return null;
end $$;

-- Profile: personal / contact details and emergency contacts changed by the employee.
create or replace function public.ep_trg_admin_profile()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor public.ep_employees := public.ep_actor_employee();
  v_emp_id uuid := case when tg_op = 'DELETE' then old.employee_id else new.employee_id end;
  v_what   text := case when tg_table_name = 'ep_emergency_contacts' then 'emergency contacts' else 'personal / contact details' end;
begin
  begin
    if v_actor.id is distinct from v_emp_id then
      return null;
    end if;
    perform public.ep_admin_notify(v_emp_id, 'profile',
      v_actor.full_name || ' updated their ' || v_what,
      'Open their profile to see the details.', '/admin/employees/' || v_emp_id,
      'normal', tg_table_name || ':' || v_emp_id);
  exception when others then
    raise warning 'admin notification (profile) skipped: %', sqlerrm;
  end;
  return null;
end $$;

-- Documents uploaded / deleted by the employee.
create or replace function public.ep_trg_admin_document()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor public.ep_employees := public.ep_actor_employee();
  v_row   public.ep_employee_documents := case when tg_op = 'DELETE' then old else new end;
begin
  begin
    if v_actor.id is distinct from v_row.employee_id then
      return null;
    end if;
    perform public.ep_admin_notify(v_row.employee_id, 'profile',
      v_actor.full_name || case when tg_op = 'DELETE' then ' deleted a document' else ' uploaded a document' end,
      v_row.title || ' · ' || v_row.file_name, '/admin/employees/' || v_row.employee_id);
  exception when others then
    raise warning 'admin notification (document) skipped: %', sqlerrm;
  end;
  return null;
end $$;

-- Projects: task added / status changed / delay reason by an employee; project update posted;
-- project delay reason given.
create or replace function public.ep_trg_admin_task()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor public.ep_employees := public.ep_actor_employee();
  v_proj  text;
  v_label text;
begin
  begin
    if v_actor.id is null then
      return null;
    end if;
    select coalesce(project_code || ' · ', '') || name into v_proj from public.pt_projects where id = new.project_id;
    if tg_op = 'INSERT' then
      perform public.ep_admin_notify(v_actor.id, 'project',
        v_actor.full_name || ' added a task',
        '“' || new.title || '” · ' || v_proj, '/admin/project-management/' || new.project_id);
    else
      if new.status is distinct from old.status then
        v_label := case new.status when 'done' then 'Done' when 'in_progress' then 'In progress' when 'todo' then 'To do' else new.status end;
        perform public.ep_admin_notify(v_actor.id, 'project',
          v_actor.full_name || ' marked a task as ' || v_label,
          '“' || new.title || '” · ' || v_proj, '/admin/project-management/' || new.project_id,
          'normal', 'task:' || new.id || ':' || new.status);
      end if;
      if new.delay_reason is not null and new.delay_reason is distinct from old.delay_reason then
        perform public.ep_admin_notify(v_actor.id, 'project',
          v_actor.full_name || ' gave a delay reason for a task',
          '“' || new.title || '” · ' || v_proj || ' · ' || left(new.delay_reason, 300),
          '/admin/project-management/' || new.project_id);
      end if;
    end if;
  exception when others then
    raise warning 'admin notification (task) skipped: %', sqlerrm;
  end;
  return null;
end $$;

create or replace function public.ep_trg_admin_project_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor public.ep_employees := public.ep_actor_employee();
  v_proj  text;
begin
  begin
    if v_actor.id is null or v_actor.id is distinct from new.author_id then
      return null;
    end if;
    select coalesce(project_code || ' · ', '') || name into v_proj from public.pt_projects where id = new.project_id;
    perform public.ep_admin_notify(v_actor.id, 'project',
      v_actor.full_name || ' posted a project update',
      v_proj || ' · ' || left(new.body, 300), '/admin/project-management/' || new.project_id);
  exception when others then
    raise warning 'admin notification (project update) skipped: %', sqlerrm;
  end;
  return null;
end $$;

create or replace function public.ep_trg_admin_project_delay()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor public.ep_employees := public.ep_actor_employee();
  v_proj  text;
begin
  begin
    if v_actor.id is distinct from new.employee_id
       or (tg_op = 'UPDATE' and new.reason is not distinct from old.reason) then
      return null;
    end if;
    select coalesce(project_code || ' · ', '') || name into v_proj from public.pt_projects where id = new.project_id;
    perform public.ep_admin_notify(new.employee_id, 'project',
      v_actor.full_name || ' gave a reason for the project delay',
      v_proj || ' · deadline ' || to_char(new.deadline, 'DD Mon YYYY') || ' · ' || left(new.reason, 300),
      '/admin/project-management/' || new.project_id);
  exception when others then
    raise warning 'admin notification (project delay) skipped: %', sqlerrm;
  end;
  return null;
end $$;

-- Account: first sign-in (the employee replaced the temporary password).
create or replace function public.ep_trg_admin_account()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  begin
    if old.must_change_password and not new.must_change_password then
      perform public.ep_admin_notify(new.id, 'account',
        new.full_name || ' signed in for the first time',
        new.employee_code || ' set their own password and can now use the Employee Portal.',
        '/admin/employees/' || new.id);
    end if;
  exception when others then
    raise warning 'admin notification (account) skipped: %', sqlerrm;
  end;
  return null;
end $$;

revoke all on function public.ep_trg_admin_leave(), public.ep_trg_admin_attendance(), public.ep_trg_admin_correction(),
  public.ep_trg_admin_report(), public.ep_trg_admin_profile(), public.ep_trg_admin_document(),
  public.ep_trg_admin_task(), public.ep_trg_admin_project_update(), public.ep_trg_admin_project_delay(),
  public.ep_trg_admin_account() from public, anon, authenticated;

drop trigger if exists ep_admin_leave on public.ep_leave_requests;
create trigger ep_admin_leave after insert or update of status on public.ep_leave_requests
  for each row execute function public.ep_trg_admin_leave();
drop trigger if exists ep_admin_attendance on public.ep_attendance;
create trigger ep_admin_attendance after insert or update of auto_punched_out on public.ep_attendance
  for each row execute function public.ep_trg_admin_attendance();
drop trigger if exists ep_admin_correction on public.ep_attendance_corrections;
create trigger ep_admin_correction after insert or update of status on public.ep_attendance_corrections
  for each row execute function public.ep_trg_admin_correction();
drop trigger if exists ep_admin_report on public.ep_work_reports;
create trigger ep_admin_report after insert or update of status on public.ep_work_reports
  for each row execute function public.ep_trg_admin_report();
drop trigger if exists ep_admin_profile on public.ep_employee_profiles;
create trigger ep_admin_profile after insert or update on public.ep_employee_profiles
  for each row execute function public.ep_trg_admin_profile();
drop trigger if exists ep_admin_contacts on public.ep_emergency_contacts;
create trigger ep_admin_contacts after insert or update or delete on public.ep_emergency_contacts
  for each row execute function public.ep_trg_admin_profile();
drop trigger if exists ep_admin_document on public.ep_employee_documents;
create trigger ep_admin_document after insert or delete on public.ep_employee_documents
  for each row execute function public.ep_trg_admin_document();
drop trigger if exists ep_admin_task on public.ep_project_tasks;
create trigger ep_admin_task after insert or update of status, delay_reason on public.ep_project_tasks
  for each row execute function public.ep_trg_admin_task();
drop trigger if exists ep_admin_project_update on public.ep_project_updates;
create trigger ep_admin_project_update after insert on public.ep_project_updates
  for each row execute function public.ep_trg_admin_project_update();
drop trigger if exists ep_admin_project_delay on public.ep_project_delay_reasons;
create trigger ep_admin_project_delay after insert or update of reason on public.ep_project_delay_reasons
  for each row execute function public.ep_trg_admin_project_delay();
drop trigger if exists ep_admin_account on public.ep_employees;
create trigger ep_admin_account after update of must_change_password on public.ep_employees
  for each row execute function public.ep_trg_admin_account();

-- ================================================================ admin RPCs
create or replace function public.ep_admin_inbox(p_filter text default 'all', p_limit int default 200)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  perform public.ep_require_admin();
  return jsonb_build_object(
    'unread', (select count(*) from public.ep_admin_notifications n
                where not exists (select 1 from public.ep_admin_notification_reads r
                                   where r.notification_id = n.id and r.user_id = v_uid)),
    'counts', coalesce((select jsonb_object_agg(kind, c) from (
                 select kind, count(*) c from public.ep_admin_notifications n
                  where not exists (select 1 from public.ep_admin_notification_reads r
                                     where r.notification_id = n.id and r.user_id = v_uid)
                  group by kind) k), '{}'::jsonb),
    'items', coalesce((
      select jsonb_agg(x.j order by x.created_at desc) from (
        select n.created_at, jsonb_build_object(
                 'id', n.id, 'kind', n.kind, 'priority', n.priority, 'title', n.title, 'body', n.body,
                 'link', n.link, 'created_at', n.created_at,
                 'read', exists (select 1 from public.ep_admin_notification_reads r
                                  where r.notification_id = n.id and r.user_id = v_uid),
                 'employee', (select jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code)
                                from public.ep_employees e where e.id = n.employee_id)) j
          from public.ep_admin_notifications n
         where case coalesce(p_filter, 'all')
                 when 'all' then true
                 when 'unread' then not exists (select 1 from public.ep_admin_notification_reads r
                                                 where r.notification_id = n.id and r.user_id = v_uid)
                 else n.kind = p_filter end
         order by n.created_at desc
         limit least(greatest(coalesce(p_limit, 200), 1), 500)) x), '[]'::jsonb));
end $$;

create or replace function public.ep_admin_inbox_summary()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  perform public.ep_require_admin();
  return jsonb_build_object('unread', (
    select count(*) from public.ep_admin_notifications n
     where not exists (select 1 from public.ep_admin_notification_reads r
                        where r.notification_id = n.id and r.user_id = v_uid)));
end $$;

-- p_ids null = mark everything read (for the signed-in admin only).
create or replace function public.ep_admin_inbox_mark_read(p_ids uuid[] default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  insert into public.ep_admin_notification_reads (notification_id, user_id)
  select n.id, auth.uid() from public.ep_admin_notifications n
   where p_ids is null or n.id = any (p_ids)
  on conflict do nothing;
end $$;

revoke all on function public.ep_admin_inbox(text, int), public.ep_admin_inbox_summary(),
  public.ep_admin_inbox_mark_read(uuid[]) from public, anon;
grant execute on function public.ep_admin_inbox(text, int), public.ep_admin_inbox_summary(),
  public.ep_admin_inbox_mark_read(uuid[]) to authenticated;

-- ===================== 257_employee_leave_manager_review_first.sql =====================

alter table public.ep_leave_requests drop constraint if exists ep_leave_requests_status_check;
alter table public.ep_leave_requests add constraint ep_leave_requests_status_check
  check (status in ('manager_review', 'pending', 'manager_pending', 'approved', 'rejected', 'cancelled'));
alter table public.ep_leave_requests
  add column if not exists manager_review_comment text
    check (manager_review_comment is null or length(manager_review_comment) <= 1000),
  add column if not exists manager_reviewed_at timestamptz,
  add column if not exists manager_reviewed_by uuid references public.ep_employees (id) on delete set null;
comment on column public.ep_leave_requests.manager_review_comment is 'Note the reporting manager wrote when sending the request to the admin (step 1).';

-- JSON for one request: adds the manager review step (step 1).
create or replace function public.ep_leave_json(r public.ep_leave_requests)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'leave_type', r.leave_type, 'leave_name', (select name from public.ep_leave_types where code = r.leave_type),
    'start_date', r.start_date, 'end_date', r.end_date, 'half_day', r.half_day, 'days', r.days,
    'reason', r.reason, 'status', r.status, 'created_at', r.created_at,
    'decided_at', r.decided_at, 'decision_comment', r.decision_comment,
    'decided_by', coalesce((select full_name from public.ep_employees where id = r.decided_by),
                           case when r.decided_by_admin is not null and r.decided_at is not null then 'Admin' end),
    'manager_reviewed_at', r.manager_reviewed_at, 'manager_review_comment', r.manager_review_comment,
    'manager_reviewed_by', (select full_name from public.ep_employees where id = r.manager_reviewed_by),
    'admin_decided_at', r.admin_decided_at, 'admin_comment', r.admin_comment,
    'manager', (select full_name from public.ep_employees
                 where id = coalesce(r.decided_by, r.manager_reviewed_by, r.approver_id)),
    'approver', coalesce((select full_name from public.ep_employees where id = r.approver_id), r.approver_name),
    'employee', (select jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
                                           'designation', e.designation)
                   from public.ep_employees e where e.id = r.employee_id));
$$;

-- The reporting manager acts twice:
--   step 1 (status manager_review): 'forward' -> sends it to the admin (status pending), or 'rejected' (final)
--   step 3 (status manager_pending, after the admin approved): 'approved' (final) or 'rejected' (final)
-- A reason is required to reject.
create or replace function public.ep_decide_leave(p_id uuid, p_action text, p_comment text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp     uuid := public.ep_current_employee_id();
  v_row     public.ep_leave_requests;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_allowed numeric;
  v_type    public.ep_leave_types;
  v_me      text;
  v_what    text;
begin
  select r.* into v_row from public.ep_leave_requests r join public.ep_employees e on e.id = r.employee_id
   where r.id = p_id and (r.approver_id = v_emp or e.reporting_manager_id = v_emp) and r.employee_id <> v_emp
   for update of r;
  if v_emp is null or v_row.id is null then
    raise exception 'Leave request not found.' using errcode = '42501';
  end if;
  if v_row.status = 'pending' then
    raise exception 'This request is with the admin now.' using errcode = 'P0001';
  end if;
  if v_row.status not in ('manager_review', 'manager_pending') then
    raise exception 'This request was already %.', v_row.status using errcode = 'P0001';
  end if;
  if v_row.status = 'manager_review' and p_action not in ('forward', 'rejected') then
    raise exception 'Send it to the admin or reject it.' using errcode = '22023';
  end if;
  if v_row.status = 'manager_pending' and p_action not in ('approved', 'rejected') then
    raise exception 'Invalid action.' using errcode = '22023';
  end if;
  if p_action = 'rejected' and v_comment is null then
    raise exception 'Write a reason for rejecting.' using errcode = '22023';
  end if;
  if coalesce(length(v_comment), 0) > 1000 then
    raise exception 'Comment must be at most 1000 characters.' using errcode = '22023';
  end if;
  select * into v_type from public.ep_leave_types where code = v_row.leave_type;
  select full_name into v_me from public.ep_employees where id = v_emp;
  v_what := v_type.name || ' · ' || to_char(v_row.start_date, 'DD Mon YYYY')
    || case when v_row.end_date <> v_row.start_date then ' – ' || to_char(v_row.end_date, 'DD Mon YYYY') else '' end;

  if p_action = 'forward' then
    update public.ep_leave_requests
       set status = 'pending', approver_id = v_emp, manager_reviewed_by = v_emp, manager_reviewed_at = now(),
           manager_review_comment = v_comment, updated_at = now()
     where id = p_id returning * into v_row;
    perform public.ep_notify(v_row.employee_id, 'leave',
      'Your manager sent your leave to the admin',
      v_what || ' · reviewed by ' || v_me || ' · now waiting for the admin', '/employee/leave', 'normal');
    return public.ep_leave_json(v_row);
  end if;

  if p_action = 'approved' then
    -- The balance may have changed since the admin approved; check again without this request.
    v_allowed := public.ep_leave_allowance(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type);
    if v_type.is_paid and v_allowed is not null
       and public.ep_leave_taken(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type, v_row.id)
           + v_row.days > v_allowed then
      raise exception 'Not enough % balance left to approve this.', v_type.name using errcode = '22023';
    end if;
  end if;
  update public.ep_leave_requests
     set status = p_action, decided_by = v_emp, decided_at = now(), decision_comment = v_comment,
         manager_reviewed_by = coalesce(manager_reviewed_by, v_emp),
         manager_reviewed_at = coalesce(manager_reviewed_at, now()),
         updated_at = now()
   where id = p_id returning * into v_row;
  perform public.ep_notify(v_row.employee_id, 'leave',
    'Your leave was ' || p_action,
    v_what || case when p_action = 'rejected' then coalesce(' · ' || v_comment, '') else '' end,
    '/employee/leave', case when p_action = 'rejected' then 'urgent' else 'normal' end);
  return public.ep_leave_json(v_row);
end $$;

-- Team requests for a reporting manager: waiting for their review (step 1) or their final approval
-- (step 3), the ones they sent to the admin (status pending, read-only) and the ones they decided.
create or replace function public.ep_team_leave()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_emp   uuid := public.ep_current_employee_id();
  v_today date := (timezone('Asia/Kolkata', now()))::date;
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'team_size', (select count(*) from public.ep_employees where reporting_manager_id = v_emp and is_active),
    'requests', coalesce((
      select jsonb_agg(public.ep_leave_json(r)
               order by (r.status in ('manager_review', 'manager_pending')) desc, r.start_date desc)
      from public.ep_leave_requests r join public.ep_employees e on e.id = r.employee_id
      where r.employee_id <> v_emp
        and (r.approver_id = v_emp or e.reporting_manager_id = v_emp or r.decided_by = v_emp or r.manager_reviewed_by = v_emp)
        and (r.status in ('manager_review', 'manager_pending')
             or (r.status = 'pending' and r.manager_reviewed_by = v_emp)
             or ((r.decided_by = v_emp or r.manager_reviewed_by = v_emp) and r.end_date >= v_today - 90))), '[]'::jsonb));
end $$;

-- Admin inbox (256): applied straight to the admin (no portal manager), forwarded by the manager,
-- rejected by the manager at review, cancelled, final decision by the manager.
create or replace function public.ep_trg_admin_leave()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor public.ep_employees := public.ep_actor_employee();
  v_emp   public.ep_employees;
  v_type  text;
begin
  begin
    select * into v_emp from public.ep_employees where id = new.employee_id;
    select name into v_type from public.ep_leave_types where code = new.leave_type;
    if tg_op = 'INSERT' and v_actor.id = new.employee_id and new.status = 'pending' then
      perform public.ep_admin_notify(new.employee_id, 'leave',
        v_emp.full_name || ' applied for ' || v_type,
        public.ep_admin_fmt_dates(new.start_date, new.end_date) || ' · ' || trim(to_char(new.days, 'FM990.9')) || ' day(s) · '
          || left(new.reason, 200) || ' · waiting for your approval',
        '/admin/leave');
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
      if new.status = 'cancelled' and v_actor.id = new.employee_id and old.status <> 'manager_review' then
        perform public.ep_admin_notify(new.employee_id, 'leave',
          v_emp.full_name || ' cancelled a leave request',
          v_type || ' · ' || public.ep_admin_fmt_dates(new.start_date, new.end_date), '/admin/leave');
      elsif old.status = 'manager_review' and new.status = 'pending' and v_actor.id is not null then
        perform public.ep_admin_notify(new.employee_id, 'leave',
          v_actor.full_name || ' sent ' || v_emp.full_name || '''s leave for your approval',
          v_type || ' · ' || public.ep_admin_fmt_dates(new.start_date, new.end_date) || ' · '
            || trim(to_char(new.days, 'FM990.9')) || ' day(s) · ' || left(new.reason, 200)
            || coalesce(' · Manager: ' || new.manager_review_comment, ''),
          '/admin/leave');
      elsif old.status in ('manager_review', 'manager_pending') and new.status in ('approved', 'rejected')
            and new.decided_by is not null and v_actor.id = new.decided_by then
        perform public.ep_admin_notify(new.employee_id, 'leave',
          v_actor.full_name || case when new.status = 'approved' then ' approved ' else ' rejected ' end
            || v_emp.full_name || '''s leave',
          v_type || ' · ' || public.ep_admin_fmt_dates(new.start_date, new.end_date)
            || case when old.status = 'manager_review' then ' · rejected at the manager review'
                    else ' · final decision by the reporting manager' end
            || coalesce(' · ' || new.decision_comment, ''),
          '/admin/leave?tab=requests');
      end if;
    end if;
  exception when others then
    raise warning 'admin notification (leave) skipped: %', sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.ep_trg_admin_leave() from public, anon, authenticated;

-- ---- generated from the current definitions

CREATE OR REPLACE FUNCTION public.ep_apply_leave(p_type text, p_start date, p_end date, p_half text, p_reason text, p_manager_id uuid, p_manager_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp     uuid := public.ep_current_employee_id();
  v_today   date := (timezone('Asia/Kolkata', now()))::date;
  v_name    text;
  v_type    public.ep_leave_types;
  v_days    numeric;
  v_allowed numeric;
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_half    text := nullif(p_half, '');
  v_mgr     uuid := p_manager_id;
  v_mgrname text := nullif(btrim(coalesce(p_manager_name, '')), '');
  v_row     public.ep_leave_requests;
  v_rev     uuid;
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  select * into v_type from public.ep_leave_types where code = p_type and is_active;
  if v_type.code is null then
    raise exception 'Choose a leave type.' using errcode = '22023';
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'Choose a valid start and end date.' using errcode = '22023';
  end if;
  if extract(year from p_start) <> extract(year from p_end) then
    raise exception 'A leave request cannot cross into the next year. Apply for each year separately.' using errcode = '22023';
  end if;
  if p_start < v_today - 30 or p_end > v_today + 365 then
    raise exception 'Leave can start at most 30 days ago and end at most one year ahead.' using errcode = '22023';
  end if;
  if v_half is not null and (v_half not in ('first_half', 'second_half') or p_start <> p_end) then
    raise exception 'A half day must be a single date.' using errcode = '22023';
  end if;
  if length(v_reason) not between 1 and 1000 then
    raise exception 'Write a reason (up to 1000 characters).' using errcode = '22023';
  end if;

  -- Reporting manager: a picked colleague (must be active, not yourself) and/or a typed name.
  if v_mgr is not null then
    select full_name into v_mgrname from public.ep_employees where id = v_mgr and is_active and id <> v_emp;
    if v_mgrname is null then
      raise exception 'Choose a valid reporting manager.' using errcode = '22023';
    end if;
  end if;
  if v_mgrname is null then
    raise exception 'Enter your reporting manager.' using errcode = '22023';
  end if;
  if length(v_mgrname) > 120 then
    raise exception 'Reporting manager name must be at most 120 characters.' using errcode = '22023';
  end if;

  select full_name into v_name from public.ep_employees where id = v_emp;

  perform pg_advisory_xact_lock(hashtextextended('leave' || v_emp::text, 0));

  v_days := public.ep_leave_day_count(p_start, p_end, v_half);
  if v_days = 0 then
    raise exception 'These dates are only Sundays or company holidays, so no leave is needed.' using errcode = '22023';
  end if;
  if exists (select 1 from public.ep_leave_requests r
              where r.employee_id = v_emp and r.status in ('manager_review', 'pending', 'manager_pending', 'approved')
                and r.start_date <= p_end and r.end_date >= p_start
                and not (r.start_date = r.end_date and p_start = p_end and r.half_day is not null and v_half is not null
                         and r.half_day <> v_half)) then
    raise exception 'You already have leave on some of these dates.' using errcode = '22023';
  end if;
  v_allowed := public.ep_leave_allowance(v_emp, extract(year from p_start)::int, p_type);
  if v_type.is_paid and v_allowed is not null
     and public.ep_leave_taken(v_emp, extract(year from p_start)::int, p_type) + v_days > v_allowed then
    raise exception 'Not enough % balance: % day(s) left, % requested.', v_type.name,
      greatest(v_allowed - public.ep_leave_taken(v_emp, extract(year from p_start)::int, p_type), 0), v_days
      using errcode = '22023';
  end if;

  -- Who reviews first: the profile's reporting manager (active portal account), else the colleague
  -- picked on the form. With a reviewing manager the request starts with them (manager_review);
  -- without one it goes straight to the admin (pending).
  select m.id into v_rev
    from public.ep_employees e join public.ep_employees m on m.id = e.reporting_manager_id
   where e.id = v_emp and m.is_active and m.id <> v_emp;
  v_rev := coalesce(v_rev, v_mgr);

  insert into public.ep_leave_requests
    (employee_id, leave_type, start_date, end_date, half_day, days, reason, approver_id, approver_name, status)
  values (v_emp, p_type, p_start, p_end, v_half, v_days, v_reason, coalesce(v_rev, v_mgr), v_mgrname,
          case when v_rev is not null then 'manager_review' else 'pending' end)
  returning * into v_row;

  -- Only a colleague in the portal can be notified.
  perform public.ep_notify(v_rev, 'leave',
    v_name || ' applied for ' || v_type.name || ' — please review',
    to_char(p_start, 'DD Mon') || case when p_end <> p_start then ' – ' || to_char(p_end, 'DD Mon YYYY') else to_char(p_start, ' YYYY') end
      || ' · ' || v_days || ' day(s) · ' || left(v_reason, 200)
      || ' · review it and send it to the admin (or reject it) in Team requests.',
    '/employee/leave/team');
  return public.ep_leave_json(v_row);
end $function$;

CREATE OR REPLACE FUNCTION public.ep_leave_taken(p_emp uuid, p_year integer, p_type text, p_skip uuid DEFAULT NULL::uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(sum(days), 0) from public.ep_leave_requests
   where employee_id = p_emp and leave_type = p_type and extract(year from start_date) = p_year
     and status in ('manager_review', 'pending', 'manager_pending', 'approved') and id is distinct from p_skip;
$function$;

CREATE OR REPLACE FUNCTION public.ep_recount_leave_on(p_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.ep_leave_requests;
  v_days numeric;
begin
  for r in select * from public.ep_leave_requests
            where status in ('manager_review', 'pending', 'manager_pending', 'approved') and p_date between start_date and end_date for update loop
    v_days := public.ep_leave_day_count(r.start_date, r.end_date, r.half_day);
    if v_days = 0 then
      update public.ep_leave_requests
         set status = 'cancelled', updated_at = now(),
             decision_comment = 'Cancelled automatically: the day is now a company holiday.'
       where id = r.id;
      perform public.ep_notify(r.employee_id, 'leave', 'Leave not needed — company holiday',
        to_char(r.start_date, 'DD Mon YYYY') || ' is now a company holiday, so your leave request was cancelled.',
        '/employee/leave');
    elsif v_days <> r.days then
      update public.ep_leave_requests set days = v_days, updated_at = now() where id = r.id;
    end if;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.ep_leave_balance_json(p_emp uuid, p_year integer, p_type text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'code', t.code, 'name', t.name, 'is_paid', t.is_paid,
    'default', t.yearly_days,
    'allowed', public.ep_leave_allowance(p_emp, p_year, t.code),
    'is_custom', exists (select 1 from public.ep_leave_allocations a
                          where a.employee_id = p_emp and a.year = p_year and a.leave_type = t.code),
    'approved', (select coalesce(sum(days), 0) from public.ep_leave_requests
                  where employee_id = p_emp and leave_type = t.code and status = 'approved'
                    and extract(year from start_date) = p_year),
    'pending', (select coalesce(sum(days), 0) from public.ep_leave_requests
                 where employee_id = p_emp and leave_type = t.code and status in ('manager_review', 'pending', 'manager_pending')
                   and extract(year from start_date) = p_year))
  from public.ep_leave_types t where t.code = p_type;
$function$;

CREATE OR REPLACE FUNCTION public.ep_leave_overview(p_year integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp uuid := public.ep_current_employee_id();
  v_mgr uuid;
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if p_year is null or p_year not between 2020 and 2100 then
    raise exception 'Invalid year.' using errcode = '22023';
  end if;
  select reporting_manager_id into v_mgr from public.ep_employees where id = v_emp;
  return jsonb_build_object(
    'year', p_year,
    'manager', coalesce(
      (select jsonb_build_object('id', m.id, 'full_name', m.full_name) from public.ep_employees m where m.id = v_mgr),
      (select jsonb_build_object('id', null, 'full_name', reporting_manager_name)
         from public.ep_employees where id = v_emp and reporting_manager_name is not null)),
    'balances', (
      select jsonb_agg(jsonb_build_object(
               'code', t.code, 'name', t.name, 'is_paid', t.is_paid,
               'allowed', public.ep_leave_allowance(v_emp, p_year, t.code),
               'approved', (select coalesce(sum(days), 0) from public.ep_leave_requests
                             where employee_id = v_emp and leave_type = t.code and status = 'approved'
                               and extract(year from start_date) = p_year),
               'pending', (select coalesce(sum(days), 0) from public.ep_leave_requests
                            where employee_id = v_emp and leave_type = t.code and status in ('manager_review', 'pending', 'manager_pending')
                              and extract(year from start_date) = p_year))
             order by t.sort_order)
      from public.ep_leave_types t where t.is_active),
    'requests', coalesce((
      select jsonb_agg(public.ep_leave_json(r) order by r.start_date desc, r.created_at desc)
      from public.ep_leave_requests r
      where r.employee_id = v_emp and extract(year from r.start_date) = p_year), '[]'::jsonb),
    'holidays', coalesce((
      select jsonb_agg(jsonb_build_object('date', h.holiday_date, 'name', h.name) order by h.holiday_date)
      from public.ep_holidays h where extract(year from h.holiday_date) = p_year), '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.ep_admin_leave_requests(p_status text DEFAULT 'pending'::text, p_year integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.ep_require_admin();
  return coalesce((
    select jsonb_agg(public.ep_leave_json(r)
             || jsonb_build_object('balance',
                  public.ep_leave_balance_json(r.employee_id, extract(year from r.start_date)::int, r.leave_type))
             order by case r.status when 'pending' then 0 when 'manager_review' then 1 when 'manager_pending' then 2 else 3 end, r.start_date desc, r.created_at desc)
    from (select * from public.ep_leave_requests
           where (coalesce(p_status, 'all') = 'all' or status = p_status)
             and (p_year is null or extract(year from start_date) = p_year)
           order by start_date desc limit 300) r), '[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.ep_cancel_leave(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp   uuid := public.ep_current_employee_id();
  v_row   public.ep_leave_requests;
  v_name  text;
begin
  select * into v_row from public.ep_leave_requests where id = p_id and employee_id = v_emp for update;
  if v_emp is null or v_row.id is null then
    raise exception 'Leave request not found.' using errcode = '42501';
  end if;
  -- Once the admin has approved or rejected it, the employee can no longer cancel it.
  if v_row.status = 'manager_pending' then
    raise exception 'The admin already approved this leave and it is now with your reporting manager, so it can no longer be cancelled. Please contact the admin.'
      using errcode = 'P0001';
  end if;
  if v_row.status not in ('manager_review', 'pending') then
    raise exception 'This leave was already % by the admin, so it can no longer be cancelled. Please contact the admin.',
      v_row.status using errcode = 'P0001';
  end if;
  update public.ep_leave_requests set status = 'cancelled', updated_at = now() where id = p_id returning * into v_row;
  select full_name into v_name from public.ep_employees where id = v_emp;
  perform public.ep_notify(v_row.approver_id, 'leave',
    v_name || ' cancelled a leave request',
    to_char(v_row.start_date, 'DD Mon YYYY') || case when v_row.end_date <> v_row.start_date then ' – ' || to_char(v_row.end_date, 'DD Mon YYYY') else '' end,
    '/employee/leave');
  return public.ep_leave_json(v_row);
end $function$;

CREATE OR REPLACE FUNCTION public.ep_admin_decide_leave(p_id uuid, p_action text, p_comment text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row      public.ep_leave_requests;
  v_comment  text := nullif(btrim(coalesce(p_comment, '')), '');
  v_allowed  numeric;
  v_type     public.ep_leave_types;
  v_mgr      uuid;
  v_what     text;
  v_emp_name text;
  v_final    boolean;
begin
  perform public.ep_require_admin();
  select * into v_row from public.ep_leave_requests where id = p_id for update;
  if v_row.id is null then
    raise exception 'Leave request not found.' using errcode = 'P0002';
  end if;
  if v_row.status not in ('manager_review', 'pending', 'manager_pending') then
    raise exception 'This request was already %.', v_row.status using errcode = 'P0001';
  end if;
  if p_action not in ('approved', 'rejected') then
    raise exception 'Invalid action.' using errcode = '22023';
  end if;
  if p_action = 'rejected' and v_comment is null then
    raise exception 'Write a reason for rejecting.' using errcode = '22023';
  end if;
  if coalesce(length(v_comment), 0) > 1000 then
    raise exception 'Comment must be at most 1000 characters.' using errcode = '22023';
  end if;
  select * into v_type from public.ep_leave_types where code = v_row.leave_type;
  if p_action = 'approved' then
    v_allowed := public.ep_leave_allowance(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type);
    if v_type.is_paid and v_allowed is not null
       and public.ep_leave_taken(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type, v_row.id)
           + v_row.days > v_allowed then
      raise exception 'Not enough % balance left to approve this. Increase the balance or ask for Loss of Pay.', v_type.name
        using errcode = '22023';
    end if;
  end if;

  v_what := v_type.name || ' · ' || to_char(v_row.start_date, 'DD Mon YYYY')
    || case when v_row.end_date <> v_row.start_date then ' – ' || to_char(v_row.end_date, 'DD Mon YYYY') else '' end;
  select full_name into v_emp_name from public.ep_employees where id = v_row.employee_id;

  if v_row.status in ('manager_review', 'pending') and p_action = 'approved' then
    select m.id into v_mgr
      from public.ep_employees e join public.ep_employees m on m.id = e.reporting_manager_id
     where e.id = v_row.employee_id and m.is_active and m.id <> e.id;
    if v_mgr is null and v_row.approver_id is not null and v_row.approver_id <> v_row.employee_id
       and exists (select 1 from public.ep_employees where id = v_row.approver_id and is_active) then
      v_mgr := v_row.approver_id;
    end if;
  end if;

  if v_mgr is not null then
    -- Step 1 done: the admin approved; now the reporting manager decides.
    update public.ep_leave_requests
       set status = 'manager_pending', approver_id = v_mgr,
           decided_by_admin = auth.uid(), admin_decided_at = now(), admin_comment = v_comment, updated_at = now()
     where id = p_id returning * into v_row;
    perform public.ep_notify(v_row.employee_id, 'leave',
      'Admin approved your leave — waiting for your manager',
      v_what || ' · now with ' || (select full_name from public.ep_employees where id = v_mgr) || ' for the final decision'
        || coalesce(' · Admin: ' || v_comment, ''),
      '/employee/leave', 'normal');
    perform public.ep_notify(v_mgr, 'leave',
      v_emp_name || '''s leave needs your decision',
      v_what || ' · approved by the admin' || coalesce(' (' || v_comment || ')', '') || '. Accept or reject it in Team requests.',
      '/employee/leave/team', 'normal');
  else
    -- Final decision by the admin: reject; approve with no portal manager; or deciding instead of the manager.
    v_final := v_row.status = 'manager_pending';
    update public.ep_leave_requests
       set status = p_action, decided_by = null, decided_by_admin = auth.uid(), decided_at = now(),
           decision_comment = v_comment,
           admin_decided_at = coalesce(admin_decided_at, now()),
           admin_comment = case when v_final then admin_comment else v_comment end,
           updated_at = now()
     where id = p_id returning * into v_row;
    perform public.ep_notify(v_row.employee_id, 'leave',
      'Your leave was ' || p_action,
      v_what || ' · by Admin' || coalesce(' · ' || v_comment, ''),
      '/employee/leave', case when p_action = 'rejected' then 'urgent' else 'normal' end);
    if v_final and v_row.approver_id is not null then
      perform public.ep_notify(v_row.approver_id, 'leave',
        v_emp_name || '''s leave was ' || p_action || ' by the admin',
        v_what || ' · no action needed from you.', '/employee/leave/team', 'normal');
    end if;
  end if;
  return public.ep_leave_json(v_row)
    || jsonb_build_object('balance',
         public.ep_leave_balance_json(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type));
end $function$;

-- ===================== 258_employee_leave_notify_manager.sql =====================

CREATE OR REPLACE FUNCTION public.ep_admin_decide_leave(p_id uuid, p_action text, p_comment text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row      public.ep_leave_requests;
  v_comment  text := nullif(btrim(coalesce(p_comment, '')), '');
  v_allowed  numeric;
  v_type     public.ep_leave_types;
  v_mgr      uuid;
  v_what     text;
  v_emp_name text;
  v_final    boolean;
begin
  perform public.ep_require_admin();
  select * into v_row from public.ep_leave_requests where id = p_id for update;
  if v_row.id is null then
    raise exception 'Leave request not found.' using errcode = 'P0002';
  end if;
  if v_row.status not in ('manager_review', 'pending', 'manager_pending') then
    raise exception 'This request was already %.', v_row.status using errcode = 'P0001';
  end if;
  if p_action not in ('approved', 'rejected') then
    raise exception 'Invalid action.' using errcode = '22023';
  end if;
  if p_action = 'rejected' and v_comment is null then
    raise exception 'Write a reason for rejecting.' using errcode = '22023';
  end if;
  if coalesce(length(v_comment), 0) > 1000 then
    raise exception 'Comment must be at most 1000 characters.' using errcode = '22023';
  end if;
  select * into v_type from public.ep_leave_types where code = v_row.leave_type;
  if p_action = 'approved' then
    v_allowed := public.ep_leave_allowance(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type);
    if v_type.is_paid and v_allowed is not null
       and public.ep_leave_taken(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type, v_row.id)
           + v_row.days > v_allowed then
      raise exception 'Not enough % balance left to approve this. Increase the balance or ask for Loss of Pay.', v_type.name
        using errcode = '22023';
    end if;
  end if;

  v_what := v_type.name || ' · ' || to_char(v_row.start_date, 'DD Mon YYYY')
    || case when v_row.end_date <> v_row.start_date then ' – ' || to_char(v_row.end_date, 'DD Mon YYYY') else '' end;
  select full_name into v_emp_name from public.ep_employees where id = v_row.employee_id;

  if v_row.status in ('manager_review', 'pending') and p_action = 'approved' then
    select m.id into v_mgr
      from public.ep_employees e join public.ep_employees m on m.id = e.reporting_manager_id
     where e.id = v_row.employee_id and m.is_active and m.id <> e.id;
    if v_mgr is null and v_row.approver_id is not null and v_row.approver_id <> v_row.employee_id
       and exists (select 1 from public.ep_employees where id = v_row.approver_id and is_active) then
      v_mgr := v_row.approver_id;
    end if;
  end if;

  if v_mgr is not null then
    -- Step 1 done: the admin approved; now the reporting manager decides.
    update public.ep_leave_requests
       set status = 'manager_pending', approver_id = v_mgr,
           decided_by_admin = auth.uid(), admin_decided_at = now(), admin_comment = v_comment, updated_at = now()
     where id = p_id returning * into v_row;
    perform public.ep_notify(v_row.employee_id, 'leave',
      'Admin approved your leave — waiting for your manager',
      v_what || ' · now with ' || (select full_name from public.ep_employees where id = v_mgr) || ' for the final decision'
        || coalesce(' · Admin: ' || v_comment, ''),
      '/employee/leave', 'normal');
    perform public.ep_notify(v_mgr, 'leave',
      'Admin approved ' || v_emp_name || '''s leave — please give your final approval',
      v_what || coalesce(' · Admin: ' || v_comment, '') || ' · Approve or reject it in Team requests.',
      '/employee/leave/team', 'normal');
  else
    -- Final decision by the admin: reject; approve with no portal manager; or deciding instead of the manager.
    v_final := v_row.status = 'manager_pending';
    update public.ep_leave_requests
       set status = p_action, decided_by = null, decided_by_admin = auth.uid(), decided_at = now(),
           decision_comment = v_comment,
           admin_decided_at = coalesce(admin_decided_at, now()),
           admin_comment = case when v_final then admin_comment else v_comment end,
           updated_at = now()
     where id = p_id returning * into v_row;
    perform public.ep_notify(v_row.employee_id, 'leave',
      'Your leave was ' || p_action,
      v_what || ' · by Admin' || coalesce(' · ' || v_comment, ''),
      '/employee/leave', case when p_action = 'rejected' then 'urgent' else 'normal' end);
    -- The reporting manager always learns the admin's decision (approved or rejected).
    if v_row.approver_id is not null and v_row.approver_id <> v_row.employee_id then
      perform public.ep_notify(v_row.approver_id, 'leave',
        'Admin ' || p_action || ' ' || v_emp_name || '''s leave',
        v_what || coalesce(' · Admin: ' || v_comment, '')
          || case when v_final then ' · decided instead of you; no action needed.' else ' · no action needed from you.' end,
        '/employee/leave/team', 'normal');
    end if;
  end if;
  return public.ep_leave_json(v_row)
    || jsonb_build_object('balance',
         public.ep_leave_balance_json(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type));
end $function$;

-- ===================== 259_rbac_roles_permissions.sql =====================

do $$
begin
  if to_regclass('public.ep_employees') is null or to_regclass('public.pt_projects') is null
     or to_regprocedure('public.ep_user_is_admin(uuid)') is null or to_regprocedure('public.is_admin()') is null then
    raise exception 'The Employee Portal and Project Tracker must be installed first.';
  end if;
end $$;

-- ================================================================ tables
create table if not exists public.rbac_roles (
  key          text primary key check (key ~ '^[a-z_]{2,40}$'),
  name         text not null,
  description  text,
  area         text not null check (area in ('admin', 'portal')),
  sort_order   int  not null default 0,
  is_protected boolean not null default true
);
create table if not exists public.rbac_permissions (
  key         text primary key check (key ~ '^[a-z_.]{2,60}$'),
  area        text not null check (area in ('admin', 'portal')),
  grp         text not null,
  label       text not null,
  description text,
  sort_order  int  not null default 0
);
create table if not exists public.rbac_role_permissions (
  role_key       text not null references public.rbac_roles (key) on delete cascade,
  permission_key text not null references public.rbac_permissions (key) on delete cascade,
  primary key (role_key, permission_key)
);
create table if not exists public.rbac_user_roles (
  user_id    uuid not null references auth.users (id) on delete cascade,
  role_key   text not null references public.rbac_roles (key) on delete cascade,
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role_key)
);
-- Original security policies / functions before this migration (used by the rollback).
create table if not exists public.rbac_backup (
  kind       text not null,
  name       text not null,
  definition text not null,
  saved_at   timestamptz not null default now(),
  primary key (kind, name)
);
alter table public.rbac_roles enable row level security;
alter table public.rbac_permissions enable row level security;
alter table public.rbac_role_permissions enable row level security;
alter table public.rbac_user_roles enable row level security;
alter table public.rbac_backup enable row level security;
revoke all on public.rbac_roles, public.rbac_permissions, public.rbac_role_permissions, public.rbac_user_roles,
  public.rbac_backup from anon, authenticated;
-- No policies: read and written only through the functions below.

-- ================================================================ built-in roles + permission catalog
insert into public.rbac_roles (key, name, description, area, sort_order, is_protected) values
  ('super_admin', 'Super Admin', 'Full access to everything. Cannot be changed.', 'admin', 10, true),
  ('admin', 'Admin', 'Runs the website and the Employee Portal.', 'admin', 20, true),
  ('hr', 'HR', 'Employees, attendance, leave, reports and hiring.', 'admin', 30, true),
  ('manager', 'Manager / Team Lead', 'Employee Portal: reviews and approves their team''s leave and reports.', 'portal', 40, true),
  ('employee', 'Employee', 'Everyone with an Employee Portal account (given automatically).', 'portal', 50, true)
on conflict (key) do update
  set name = excluded.name, description = excluded.description, area = excluded.area,
      sort_order = excluded.sort_order, is_protected = true;

insert into public.rbac_permissions (key, area, grp, label, description, sort_order) values
  ('dashboard', 'admin', 'General', 'Website dashboard', 'The admin home page with website activity.', 10),
  ('website.contacts', 'admin', 'Website', 'Contact submissions', 'Read and manage contact form messages.', 20),
  ('website.blog', 'admin', 'Website', 'Blog posts', 'Write, edit and publish blog posts.', 21),
  ('website.portfolio', 'admin', 'Website', 'Portfolio', 'Manage portfolio projects and images.', 22),
  ('website.careers', 'admin', 'Hiring', 'Careers (job postings)', 'Create and edit job postings.', 30),
  ('website.job_applications', 'admin', 'Hiring', 'Job applications & resumes', 'See applicants and download resumes.', 31),
  ('website.seo', 'admin', 'Growth', 'SEO & Search Console', 'SEO tools and Google Search Console.', 40),
  ('projects.tracker', 'admin', 'Projects', 'Project Tracker & Clients', 'Clients, projects, documents and backups.', 50),
  ('projects.logins', 'admin', 'Projects', 'Access & Logins (saved passwords)', 'See, copy and download saved logins and passwords.', 51),
  ('portal.dashboard', 'admin', 'Employee Portal', 'Employee Portal dashboard', 'Overview of employees, attendance and what needs attention.', 60),
  ('portal.employees', 'admin', 'Employee Portal', 'Employee Management', 'Add employees, profiles, documents, certificates, portal access.', 61),
  ('portal.projects', 'admin', 'Employee Portal', 'Project Management', 'Project teams, tasks and deadlines.', 62),
  ('portal.attendance', 'admin', 'Employee Portal', 'Attendance Management', 'Attendance, late arrivals, corrections.', 63),
  ('portal.leave', 'admin', 'Employee Portal', 'Leave Management', 'Approve leave, balances and holidays.', 64),
  ('portal.reports', 'admin', 'Employee Portal', 'Daily Work Reports', 'Read and review daily work reports.', 65),
  ('portal.notifications', 'admin', 'Employee Portal', 'Notifications Management', 'Send messages and manage reminders.', 66),
  ('portal.inbox', 'admin', 'Employee Portal', 'Notifications (admin inbox)', 'Get notified about what employees do.', 67),
  ('settings.users', 'admin', 'Settings', 'Users & Roles', 'Add users and give or remove roles.', 90),
  ('settings.roles', 'admin', 'Settings', 'Roles & Permissions', 'Change what each role is allowed to do.', 91),
  ('emp.attendance', 'portal', 'My work', 'Punch in / out & attendance', 'Punch in and out, see attendance, request corrections.', 110),
  ('emp.leave', 'portal', 'My work', 'Apply for leave', 'Apply for and cancel leave.', 111),
  ('emp.reports', 'portal', 'My work', 'Daily work report', 'Write and submit the daily work report.', 112),
  ('emp.projects', 'portal', 'My work', 'My projects', 'Add tasks, change task status, post updates, give delay reasons.', 113),
  ('emp.documents', 'portal', 'My work', 'My documents', 'Upload and delete their own documents.', 114),
  ('emp.messages', 'portal', 'My work', 'Send messages', 'Send messages to colleagues.', 115),
  ('team.leave', 'portal', 'Team', 'Review & approve team leave', 'Review team leave first and give the final approval.', 120),
  ('team.reports', 'portal', 'Team', 'Review team daily reports', 'Read and review the team''s daily reports.', 121),
  ('team.messages', 'portal', 'Team', 'Message my team', 'Send messages to the whole team.', 122)
on conflict (key) do update
  set area = excluded.area, grp = excluded.grp, label = excluded.label,
      description = excluded.description, sort_order = excluded.sort_order;

-- Defaults, only on the first install (later changes made on the Roles & Permissions page are kept).
insert into public.rbac_role_permissions (role_key, permission_key)
select 'admin', key from public.rbac_permissions where area = 'admin' and key <> 'settings.roles'
   and not exists (select 1 from public.rbac_role_permissions where role_key = 'admin');
insert into public.rbac_role_permissions (role_key, permission_key)
select 'hr', key from public.rbac_permissions
 where key in ('portal.dashboard', 'portal.employees', 'portal.attendance', 'portal.leave', 'portal.reports',
               'portal.notifications', 'portal.inbox', 'website.careers', 'website.job_applications')
   and not exists (select 1 from public.rbac_role_permissions where role_key = 'hr');
insert into public.rbac_role_permissions (role_key, permission_key)
select 'manager', key from public.rbac_permissions where key like 'team.%'
   and not exists (select 1 from public.rbac_role_permissions where role_key = 'manager');
insert into public.rbac_role_permissions (role_key, permission_key)
select 'employee', key from public.rbac_permissions where key like 'emp.%'
   and not exists (select 1 from public.rbac_role_permissions where role_key = 'employee');

-- ================================================================ permission checks
-- Roles of a user: the ones given on the Users & Roles page + 'employee' for an active portal account.
create or replace function public.rbac_roles_of(p_user uuid)
returns text[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(distinct k), '{}') from (
    select ur.role_key as k from public.rbac_user_roles ur where ur.user_id = p_user
    union all
    select 'employee' from public.ep_employees e where e.user_id = p_user and e.is_active
  ) x;
$$;

create or replace function public.rbac_user_can(p_user uuid, p_key text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_user is not null and (
    exists (select 1 from public.rbac_user_roles where user_id = p_user and role_key = 'super_admin')
    or exists (select 1 from public.rbac_role_permissions rp
                where rp.permission_key = p_key and rp.role_key = any (public.rbac_roles_of(p_user))));
$$;

create or replace function public.rbac_can(p_key text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.rbac_user_can(auth.uid(), p_key);
$$;

create or replace function public.rbac_require(p_key text)
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.rbac_can(p_key) then
    raise exception 'You do not have permission for this (%).',
      coalesce((select label from public.rbac_permissions where key = p_key), p_key) using errcode = '42501';
  end if;
end $$;

create or replace function public.rbac_require_any(p_keys text[])
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not exists (select 1 from unnest(p_keys) k where public.rbac_can(k)) then
    raise exception 'You do not have permission for this.' using errcode = '42501';
  end if;
end $$;

-- What the signed-in user may do (menus, pages, buttons).
create or replace function public.rbac_my_access()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_roles text[] := public.rbac_roles_of(auth.uid());
  v_super boolean := 'super_admin' = any (public.rbac_roles_of(auth.uid()));
begin
  if v_uid is null then
    return jsonb_build_object('roles', '[]'::jsonb, 'permissions', '[]'::jsonb, 'is_admin', false, 'is_super_admin', false);
  end if;
  return jsonb_build_object(
    'is_super_admin', v_super,
    'is_admin', exists (select 1 from public.rbac_roles r where r.key = any (v_roles) and r.area = 'admin'),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('key', r.key, 'name', r.name, 'area', r.area) order by r.sort_order)
                         from public.rbac_roles r where r.key = any (v_roles)), '[]'::jsonb),
    'permissions', coalesce((select jsonb_agg(p.key order by p.sort_order) from public.rbac_permissions p
                              where v_super or exists (select 1 from public.rbac_role_permissions rp
                                                        where rp.permission_key = p.key and rp.role_key = any (v_roles))),
                            '[]'::jsonb));
end $$;

revoke all on function public.rbac_roles_of(uuid), public.rbac_user_can(uuid, text) from public, anon, authenticated;
revoke all on function public.rbac_require(text), public.rbac_require_any(text[]) from public, anon;
grant execute on function public.rbac_require(text), public.rbac_require_any(text[]) to authenticated;
-- rbac_can is used inside security policies, which are also evaluated for visitors: it returns false for them.
grant execute on function public.rbac_can(text) to anon, authenticated;
revoke all on function public.rbac_my_access() from public, anon;
grant execute on function public.rbac_my_access() to authenticated;

-- ================================================================ existing admins -> Super Admin
-- ep_user_is_admin (252) recognises both admin models (admin_users / user_roles 'admin').
insert into public.rbac_user_roles (user_id, role_key)
select u.id, 'super_admin' from auth.users u where public.ep_user_is_admin(u.id)
on conflict do nothing;
-- Existing reporting managers -> Manager / Team Lead.
insert into public.rbac_user_roles (user_id, role_key)
select distinct m.user_id, 'manager'
  from public.ep_employees e join public.ep_employees m on m.id = e.reporting_manager_id
on conflict do nothing;

-- "Is this account an admin?" now also knows the new roles.
create or replace function public.ep_user_is_admin(p_user uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_found boolean := false;
begin
  if p_user is null then
    return false;
  end if;
  if exists (select 1 from public.rbac_user_roles ur join public.rbac_roles r on r.key = ur.role_key
              where ur.user_id = p_user and r.area = 'admin') then
    return true;
  end if;
  if to_regclass('public.admin_users') is not null then
    execute 'select exists (select 1 from public.admin_users where user_id = $1)' into v_found using p_user;
    if v_found then
      return true;
    end if;
  end if;
  if to_regclass('public.user_roles') is not null then
    execute 'select exists (select 1 from public.user_roles where user_id = $1 and role::text = ''admin'')' into v_found using p_user;
  end if;
  return coalesce(v_found, false);
end $$;
revoke all on function public.ep_user_is_admin(uuid) from public, anon, authenticated;

-- is_admin() = "has an admin-area role" (keep the old definition for the rollback).
insert into public.rbac_backup (kind, name, definition)
values ('function', 'public.is_admin()', pg_get_functiondef('public.is_admin()'::regprocedure))
on conflict do nothing;
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.rbac_user_roles ur join public.rbac_roles r on r.key = ur.role_key
                  where ur.user_id = auth.uid() and r.area = 'admin');
$$;

-- Setting someone as a reporting manager gives them the Manager / Team Lead role.
create or replace function public.rbac_trg_manager_role()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.reporting_manager_id is not null then
    insert into public.rbac_user_roles (user_id, role_key)
    select user_id, 'manager' from public.ep_employees where id = new.reporting_manager_id
    on conflict do nothing;
  end if;
  return null;
end $$;
revoke all on function public.rbac_trg_manager_role() from public, anon, authenticated;
drop trigger if exists rbac_manager_role on public.ep_employees;
create trigger rbac_manager_role after insert or update of reporting_manager_id on public.ep_employees
  for each row execute function public.rbac_trg_manager_role();

-- ================================================================ Settings pages
-- Roles & Permissions: all roles with their permissions + the catalog.
create or replace function public.rbac_admin_roles()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.rbac_require_any(array['settings.roles', 'settings.users']);
  return jsonb_build_object(
    'can_edit', public.rbac_can('settings.roles'),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', r.key, 'name', r.name, 'description', r.description, 'area', r.area,
               'is_protected', r.is_protected,
               'permissions', case when r.key = 'super_admin'
                                   then (select coalesce(jsonb_agg(p.key order by p.sort_order), '[]'::jsonb)
                                           from public.rbac_permissions p where p.area = 'admin')
                                   else coalesce((select jsonb_agg(rp.permission_key order by p.sort_order)
                                                    from public.rbac_role_permissions rp
                                                    join public.rbac_permissions p on p.key = rp.permission_key
                                                   where rp.role_key = r.key), '[]'::jsonb) end,
               'users', case when r.key = 'employee'
                             then (select count(*) from public.ep_employees where is_active)
                             else (select count(*) from public.rbac_user_roles ur where ur.role_key = r.key) end)
             order by r.sort_order)
        from public.rbac_roles r), '[]'::jsonb),
    'permissions', coalesce((
      select jsonb_agg(jsonb_build_object('key', p.key, 'area', p.area, 'group', p.grp, 'label', p.label,
                                          'description', p.description) order by p.sort_order)
        from public.rbac_permissions p), '[]'::jsonb));
end $$;

create or replace function public.rbac_admin_set_permission(p_role text, p_permission text, p_enabled boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_role public.rbac_roles;
  v_perm public.rbac_permissions;
begin
  perform public.rbac_require('settings.roles');
  select * into v_role from public.rbac_roles where key = p_role;
  select * into v_perm from public.rbac_permissions where key = p_permission;
  if v_role.key is null or v_perm.key is null then
    raise exception 'Unknown role or permission.' using errcode = 'P0002';
  end if;
  if v_role.key = 'super_admin' then
    raise exception 'Super Admin always has every permission.' using errcode = '42501';
  end if;
  if v_role.area <> v_perm.area then
    raise exception '% is an % role; this permission belongs to the %.', v_role.name,
      case v_role.area when 'admin' then 'admin-area' else 'Employee Portal' end,
      case v_perm.area when 'admin' then 'admin area' else 'Employee Portal' end using errcode = '22023';
  end if;
  if p_enabled then
    insert into public.rbac_role_permissions (role_key, permission_key) values (p_role, p_permission) on conflict do nothing;
  else
    delete from public.rbac_role_permissions where role_key = p_role and permission_key = p_permission;
  end if;
end $$;

-- Users & Roles: everyone with a role or an Employee Portal account.
create or replace function public.rbac_admin_users()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.rbac_require('settings.users');
  return coalesce((
    select jsonb_agg(x.j order by x.ord, x.nm) from (
      select (case when exists (select 1 from public.rbac_user_roles ur join public.rbac_roles r on r.key = ur.role_key
                                 where ur.user_id = u.id and r.area = 'admin') then 0 else 1 end) as ord,
             lower(coalesce(e.full_name, u.raw_user_meta_data ->> 'full_name', u.email)) as nm,
             jsonb_build_object(
               'user_id', u.id,
               'sign_in', u.email,
               'full_name', coalesce(e.full_name, nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1)),
               'employee_id', e.id, 'employee_code', e.employee_code, 'employee_active', e.is_active,
               'roles', coalesce((select jsonb_agg(ur.role_key order by r.sort_order)
                                    from public.rbac_user_roles ur join public.rbac_roles r on r.key = ur.role_key
                                   where ur.user_id = u.id), '[]'::jsonb),
               'last_sign_in_at', u.last_sign_in_at, 'created_at', u.created_at,
               'is_self', u.id = auth.uid()) as j
        from auth.users u
        left join public.ep_employees e on e.user_id = u.id
       where e.id is not null or exists (select 1 from public.rbac_user_roles ur where ur.user_id = u.id)) x),
    '[]'::jsonb);
end $$;

create or replace function public.rbac_admin_set_user_roles(p_user uuid, p_roles text[])
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_new   text[] := coalesce((select array_agg(distinct r) from unnest(coalesce(p_roles, '{}')) r), '{}');
  v_old   text[];
  v_super boolean := public.rbac_user_can(auth.uid(), 'settings.users')
                     and exists (select 1 from public.rbac_user_roles where user_id = auth.uid() and role_key = 'super_admin');
  v_bad   text;
begin
  perform public.rbac_require('settings.users');
  if p_user = auth.uid() then
    raise exception 'You cannot change your own roles. Ask another Super Admin.' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'User not found.' using errcode = 'P0002';
  end if;
  select r into v_bad from unnest(v_new) r where r not in (select key from public.rbac_roles) limit 1;
  if v_bad is not null then
    raise exception 'Unknown role %.', v_bad using errcode = '22023';
  end if;
  if 'employee' = any (v_new) then
    raise exception 'Employee is given automatically to everyone with an Employee Portal account.' using errcode = '22023';
  end if;
  if 'manager' = any (v_new) and not exists (select 1 from public.ep_employees where user_id = p_user) then
    raise exception 'Manager / Team Lead is for Employee Portal accounts.' using errcode = '22023';
  end if;
  select coalesce(array_agg(role_key), '{}') into v_old from public.rbac_user_roles where user_id = p_user;
  if (('super_admin' = any (v_new)) <> ('super_admin' = any (v_old))) and not v_super then
    raise exception 'Only a Super Admin can give or remove the Super Admin role.' using errcode = '42501';
  end if;
  delete from public.rbac_user_roles where user_id = p_user and role_key <> all (v_new);
  insert into public.rbac_user_roles (user_id, role_key, granted_by)
  select p_user, r, auth.uid() from unnest(v_new) r on conflict do nothing;
  if not exists (select 1 from public.rbac_user_roles where role_key = 'super_admin') then
    raise exception 'There must always be at least one Super Admin.' using errcode = '22023';
  end if;
  return to_jsonb(coalesce((select array_agg(role_key order by role_key) from public.rbac_user_roles where user_id = p_user), '{}'));
end $$;

-- Add a user who signs in to the admin area (HR, Admin, ...). Employees are added in Employee Management.
create or replace function public.rbac_admin_create_user(p jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p ->> 'email', '')));
  v_name  text := nullif(btrim(coalesce(p ->> 'full_name', '')), '');
  v_pw    text := coalesce(p ->> 'password', '');
  v_roles text[] := coalesce((select array_agg(distinct r) from jsonb_array_elements_text(coalesce(p -> 'roles', '[]'::jsonb)) r), '{}');
  v_user  uuid;
  v_bad   text;
begin
  perform public.rbac_require('settings.users');
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'Enter a valid sign-in email.' using errcode = '22023';
  end if;
  if v_name is null or length(v_name) > 120 then
    raise exception 'Name is required (up to 120 characters).' using errcode = '22023';
  end if;
  if cardinality(v_roles) = 0 then
    raise exception 'Choose at least one role.' using errcode = '22023';
  end if;
  select r into v_bad from unnest(v_roles) r
   where r not in (select key from public.rbac_roles where area = 'admin') limit 1;
  if v_bad is not null then
    raise exception 'Only admin-area roles can be given here (Super Admin, Admin, HR).' using errcode = '22023';
  end if;
  if 'super_admin' = any (v_roles)
     and not exists (select 1 from public.rbac_user_roles where user_id = auth.uid() and role_key = 'super_admin') then
    raise exception 'Only a Super Admin can give the Super Admin role.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rbac_create_user:' || v_email, 0));
  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is not null then
    if exists (select 1 from public.rbac_user_roles where user_id = v_user)
       or exists (select 1 from public.ep_employees where user_id = v_user) then
      raise exception 'This email already has an account. Change its roles in the list instead.' using errcode = '23505';
    end if;
  else
    if public.ep_password_problem(v_pw) is not null then
      raise exception 'Password: %', public.ep_password_problem(v_pw) using errcode = '22023';
    end if;
    v_user := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
      extensions.crypt(v_pw, extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('full_name', v_name), now(), now(),
      '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    values (v_user::text, v_user,
            jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true), 'email', now(), now());
  end if;
  insert into public.rbac_user_roles (user_id, role_key, granted_by)
  select v_user, r, auth.uid() from unnest(v_roles) r on conflict do nothing;
  return v_user;
end $$;

revoke all on function public.rbac_admin_roles(), public.rbac_admin_set_permission(text, text, boolean),
  public.rbac_admin_users(), public.rbac_admin_set_user_roles(uuid, text[]), public.rbac_admin_create_user(jsonb)
  from public, anon;
grant execute on function public.rbac_admin_roles(), public.rbac_admin_set_permission(text, text, boolean),
  public.rbac_admin_users(), public.rbac_admin_set_user_roles(uuid, text[]), public.rbac_admin_create_user(jsonb)
  to authenticated;

do $$
begin
  if not exists (select 1 from public.rbac_user_roles where role_key = 'super_admin') then
    raise warning 'No Super Admin found. Give one account the super_admin role in rbac_user_roles.';
  end if;
end $$;

-- ================================================================ security policies -> module permissions
-- Every policy that checks is_admin() (or the Lovable-style has_role(auth.uid(), 'admin')) is changed to
-- check the permission of its module. The original text is saved in rbac_backup first. Policies on tables
-- that are not listed here keep is_admin() (= any admin-area role). Running this again changes nothing.
do $$
declare
  p       record;
  v_key   text;
  v_both  text;
  v_q     text;
  v_c     text;
  v_pat   text := '(public\.)?is_admin\(\)|(public\.)?has_role\(auth\.uid\(\), ''admin''::(public\.)?app_role\)';
  v_done  int := 0;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
      from pg_policies
     where coalesce(qual, '') ~ v_pat or coalesce(with_check, '') ~ v_pat
  loop
    v_both := coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '');
    v_key := case
      when p.schemaname = 'storage' then case
        when v_both like '%''resumes''%' then 'website.job_applications'
        when v_both like '%''portfolio-images''%' then 'website.portfolio'
        when v_both like '%''pt-company-logos''%' or v_both like '%''pt-project-documents''%' then 'projects.tracker'
        when v_both like '%''ep-certificates''%' or v_both like '%''ep-documents''%' then 'portal.employees'
      end
      when p.schemaname = 'public' then case
        when p.tablename = 'contact_submissions' then 'website.contacts'
        when p.tablename = 'blog_posts' then 'website.blog'
        when p.tablename = 'portfolio_projects' then 'website.portfolio'
        when p.tablename = 'job_postings' then 'website.careers'
        when p.tablename in ('job_applications', 'job_application_views') then 'website.job_applications'
        when p.tablename in ('pt_companies', 'pt_projects', 'pt_documents', 'pt_backups') then 'projects.tracker'
        when p.tablename in ('pt_credentials', 'pt_credential_events') then 'projects.logins'
        when p.tablename in ('ep_employees', 'ep_employee_profiles', 'ep_emergency_contacts', 'ep_employee_documents',
                             'ep_internship_certificates') then 'portal.employees'
        when p.tablename in ('ep_attendance', 'ep_attendance_corrections') then 'portal.attendance'
        when p.tablename in ('ep_leave_requests', 'ep_leave_allocations', 'ep_leave_types', 'ep_holidays') then 'portal.leave'
        when p.tablename in ('ep_work_reports', 'ep_work_report_items') then 'portal.reports'
        when p.tablename in ('ep_project_members', 'ep_project_tasks', 'ep_project_updates', 'ep_project_delay_reasons') then 'portal.projects'
        when p.tablename = 'ep_notifications' then 'portal.notifications'
      end
    end;
    if v_key is null then
      raise notice 'rbac: kept is_admin() on %.% (%)', p.schemaname, p.tablename, p.policyname;
      continue;
    end if;
    insert into public.rbac_backup (kind, name, definition)
    values ('policy', p.schemaname || '.' || p.tablename || '.' || p.policyname,
            jsonb_build_object('schema', p.schemaname, 'table', p.tablename, 'policy', p.policyname,
                               'qual', p.qual, 'with_check', p.with_check)::text)
    on conflict do nothing;
    v_q := regexp_replace(p.qual, v_pat, format('public.rbac_can(%L)', v_key), 'g');
    v_c := regexp_replace(p.with_check, v_pat, format('public.rbac_can(%L)', v_key), 'g');
    execute format('alter policy %I on %I.%I%s%s', p.policyname, p.schemaname, p.tablename,
                   case when p.qual is not null then ' using (' || v_q || ')' else '' end,
                   case when p.with_check is not null then ' with check (' || v_c || ')' else '' end);
    v_done := v_done + 1;
  end loop;
  raise notice 'rbac: % policies now check module permissions', v_done;
end $$;

-- Employees may upload their own documents only with the "My documents" permission.
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
              and policyname = 'ep-documents: employee upload own' and with_check not like '%rbac_can%') then
    insert into public.rbac_backup (kind, name, definition)
    select 'policy', 'storage.objects.ep-documents: employee upload own',
           jsonb_build_object('schema', 'storage', 'table', 'objects', 'policy', policyname, 'qual', qual,
                              'with_check', with_check)::text
      from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'ep-documents: employee upload own'
    on conflict do nothing;
    alter policy "ep-documents: employee upload own" on storage.objects
      with check (bucket_id = 'ep-documents' and public.rbac_can('emp.documents')
                  and (storage.foldername(name))[1] in (
                    select e.id::text from public.ep_employees e where e.user_id = (select auth.uid()) and e.is_active));
  end if;
end $$;

-- ================================================================ functions: permission checks
-- (generated from the current definitions; only the marked '-- rbac' lines change)

-- public.ep_admin_attendance
CREATE OR REPLACE FUNCTION public.ep_admin_attendance(p_from date, p_to date, p_emp uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.attendance'); -- rbac
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Choose a date range of at most 62 days.' using errcode = '22023';
  end if;
  perform public.ep_close_overdue_sessions(p_emp);
  return jsonb_build_object(
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'employee_code', e.employee_code, 'full_name', e.full_name,
               'designation', e.designation, 'department', e.department, 'is_active', e.is_active,
               'start_date', (timezone('Asia/Kolkata', e.created_at))::date) order by e.full_name)
      from public.ep_employees e where p_emp is null or e.id = p_emp), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.work_date desc, x.employee_id)
      from public.ep_attendance_rows(p_from, p_to, p_emp) x), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'employee_id', a.employee_id, 'work_date', a.work_date,
               'punch_in_at', a.punch_in_at, 'punch_out_at', a.punch_out_at,
               'auto_punched_out', a.auto_punched_out, 'corrected_at', a.corrected_at) order by a.punch_in_at)
      from public.ep_attendance a
      where a.work_date between p_from and p_to and (p_emp is null or a.employee_id = p_emp)), '[]'::jsonb),
    'holidays', coalesce((
      select jsonb_agg(jsonb_build_object('date', holiday_date, 'name', name) order by holiday_date)
      from public.ep_holidays where holiday_date between p_from and p_to), '[]'::jsonb),
    'leave', coalesce((
      select jsonb_agg(jsonb_build_object('employee_id', r.employee_id, 'date', g.d::date,
                                          'type', r.leave_type, 'half_day', r.half_day) order by g.d)
      from public.ep_leave_requests r,
           generate_series(greatest(r.start_date, p_from), least(r.end_date, p_to), interval '1 day') g(d)
      where r.status = 'approved' and r.start_date <= p_to and r.end_date >= p_from
        and (p_emp is null or r.employee_id = p_emp)), '[]'::jsonb),
    'pending_corrections', (select count(*) from public.ep_attendance_corrections where status = 'pending'));
end $function$;

-- public.ep_admin_corrections
CREATE OR REPLACE FUNCTION public.ep_admin_corrections(p_status text DEFAULT 'pending'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.attendance'); -- rbac
  return coalesce((
    select jsonb_agg(public.ep_correction_json(c) order by c.created_at desc)
    from (select * from public.ep_attendance_corrections
           where coalesce(p_status, 'all') = 'all' or status = p_status
           order by created_at desc limit 200) c), '[]'::jsonb);
end $function$;

-- public.ep_admin_create_employee
CREATE OR REPLACE FUNCTION public.ep_admin_create_employee(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f          text;
  v_code     text := upper(btrim(coalesce(p ->> 'employee_code', '')));
  v_name     text := btrim(coalesce(p ->> 'full_name', ''));
  v_email    text := lower(btrim(coalesce(p ->> 'email', '')));
  v_password text := coalesce(p ->> 'password', '');
  v_user     uuid;
  v_linked   boolean := false;
  v_emp      uuid;
  v_work     jsonb;
begin
  perform public.rbac_require('portal.employees'); -- rbac
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Invalid employee data.' using errcode = '22023';
  end if;
  for f in select jsonb_object_keys(p) loop
    if f not in ('employee_code', 'full_name', 'email', 'password', 'department', 'designation',
                 'reporting_manager_id', 'reporting_manager_name', 'date_of_joining', 'employment_type', 'work_location') then
      raise exception 'Field % cannot be set here.', f using errcode = '42501';
    end if;
  end loop;

  if v_code !~ '^[A-Z0-9][A-Z0-9-]{1,29}$' then
    raise exception 'Employee ID: use 2-30 letters, numbers or dashes (e.g. ZT-001).' using errcode = '22023';
  end if;
  if length(v_name) not between 1 and 120 then
    raise exception 'Name is required (up to 120 characters).' using errcode = '22023';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'Enter a valid work email.' using errcode = '22023';
  end if;
  if exists (select 1 from public.ep_employees where employee_code = v_code) then
    raise exception 'Employee ID % is already used.', v_code using errcode = '23505';
  end if;

  -- Same email twice at the same moment: serialise.
  perform pg_advisory_xact_lock(hashtextextended('ep_create_employee:' || v_email, 0));

  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is not null then
    if exists (select 1 from public.ep_employees where user_id = v_user) then
      raise exception 'This email already belongs to an employee.' using errcode = '23505';
    end if;
    if public.ep_user_is_admin(v_user) then
      raise exception 'This email is an admin account. Use a separate email for the employee.' using errcode = '22023';
    end if;
    v_linked := true;
  else
    if public.ep_password_problem(v_password) is not null then
      raise exception 'Temporary password: %', public.ep_password_problem(v_password) using errcode = '22023';
    end if;
    v_user := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
      extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('full_name', v_name), now(), now(),
      '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    values (
      v_user::text, v_user,
      jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true),
      'email', now(), now());
  end if;

  -- A new login with a temporary password must be changed at the first sign-in.
  insert into public.ep_employees (user_id, employee_code, full_name, must_change_password)
  values (v_user, v_code, v_name, not v_linked)
  returning id into v_emp;

  -- Work details: only the keys given, with the same checks as editing.
  v_work := p - 'employee_code' - 'full_name' - 'email' - 'password';
  if v_work <> '{}'::jsonb then
    perform public.ep_admin_update_employee(v_emp, v_work);
  end if;

  perform public.ep_notify(
    v_emp, 'message', 'Welcome to the Zyllo Tech Employee Portal',
    'Your account is ready. Please complete your personal details and emergency contacts in My Profile.',
    '/employee/profile');

  return public.ep_admin_employee(v_emp) || jsonb_build_object('linked_existing_account', v_linked);
end $function$;

-- public.ep_admin_custom_reminders
CREATE OR REPLACE FUNCTION public.ep_admin_custom_reminders()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.notifications'); -- rbac
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'title', r.title, 'body', r.body, 'priority', r.priority,
             'audience', r.audience, 'departments', to_jsonb(r.departments), 'project_id', r.project_id,
             'project_name', (select name from public.pt_projects where id = r.project_id),
             'people', to_jsonb(r.people),
             'people_names', (select jsonb_agg(full_name order by full_name) from public.ep_employees where id = any (r.people)),
             'repeat', r.repeat, 'days', to_jsonb(r.days), 'send_date', r.send_date,
             'send_at', to_char(r.send_at, 'HH24:MI'), 'enabled', r.enabled, 'last_run', r.last_run,
             'recipients', (select count(*) from public.ep_custom_reminder_targets(r.id)))
           order by r.enabled desc, r.send_at, r.created_at)
    from public.ep_custom_reminders r), '[]'::jsonb);
end $function$;

-- public.ep_admin_decide_correction
CREATE OR REPLACE FUNCTION public.ep_admin_decide_correction(p_id uuid, p_action text, p_comment text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row public.ep_attendance_corrections;
  v_chk record;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  perform public.rbac_require('portal.attendance'); -- rbac
  if p_action not in ('approved', 'rejected') then
    raise exception 'Invalid action.' using errcode = '22023';
  end if;
  if p_action = 'rejected' and v_comment is null then
    raise exception 'Write a reason for rejecting.' using errcode = '22023';
  end if;
  if coalesce(length(v_comment), 0) > 500 then
    raise exception 'Comment must be at most 500 characters.' using errcode = '22023';
  end if;
  select * into v_row from public.ep_attendance_corrections where id = p_id for update;
  if v_row.id is null then
    raise exception 'Correction request not found.' using errcode = 'P0002';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'This request was already %.', v_row.status using errcode = 'P0001';
  end if;

  if p_action = 'approved' then
    if v_row.old_in is not null and v_row.attendance_id is null then
      raise exception 'The punch session of this request no longer exists.' using errcode = 'P0002';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(v_row.employee_id::text, 0));
    -- Check again: other sessions may have changed since the request.
    select * into v_chk from public.ep_correction_check(
      v_row.employee_id, v_row.work_date, v_row.attendance_id, v_row.requested_in, v_row.requested_out);
    if v_row.attendance_id is not null then
      update public.ep_attendance
         set punch_in_at = v_chk.new_in, punch_out_at = v_chk.new_out,
             auto_punched_out = false, corrected_at = now()
       where id = v_row.attendance_id;
    else
      insert into public.ep_attendance (employee_id, work_date, punch_in_at, punch_out_at, corrected_at)
      values (v_row.employee_id, v_row.work_date, v_chk.new_in, v_chk.new_out, now());
    end if;
  end if;

  update public.ep_attendance_corrections
     set status = p_action, decided_by_admin = auth.uid(), decided_at = now(), decision_comment = v_comment
   where id = p_id returning * into v_row;

  perform public.ep_notify(v_row.employee_id, 'attendance',
    'Attendance correction ' || p_action,
    to_char(v_row.work_date, 'DD Mon YYYY') || coalesce(' · ' || v_comment, ''),
    '/employee/attendance', case when p_action = 'rejected' then 'urgent' else 'normal' end);
  return public.ep_correction_json(v_row);
end $function$;

-- public.ep_admin_decide_leave
CREATE OR REPLACE FUNCTION public.ep_admin_decide_leave(p_id uuid, p_action text, p_comment text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row      public.ep_leave_requests;
  v_comment  text := nullif(btrim(coalesce(p_comment, '')), '');
  v_allowed  numeric;
  v_type     public.ep_leave_types;
  v_mgr      uuid;
  v_what     text;
  v_emp_name text;
  v_final    boolean;
begin
  perform public.rbac_require('portal.leave'); -- rbac
  select * into v_row from public.ep_leave_requests where id = p_id for update;
  if v_row.id is null then
    raise exception 'Leave request not found.' using errcode = 'P0002';
  end if;
  if v_row.status not in ('manager_review', 'pending', 'manager_pending') then
    raise exception 'This request was already %.', v_row.status using errcode = 'P0001';
  end if;
  if p_action not in ('approved', 'rejected') then
    raise exception 'Invalid action.' using errcode = '22023';
  end if;
  if p_action = 'rejected' and v_comment is null then
    raise exception 'Write a reason for rejecting.' using errcode = '22023';
  end if;
  if coalesce(length(v_comment), 0) > 1000 then
    raise exception 'Comment must be at most 1000 characters.' using errcode = '22023';
  end if;
  select * into v_type from public.ep_leave_types where code = v_row.leave_type;
  if p_action = 'approved' then
    v_allowed := public.ep_leave_allowance(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type);
    if v_type.is_paid and v_allowed is not null
       and public.ep_leave_taken(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type, v_row.id)
           + v_row.days > v_allowed then
      raise exception 'Not enough % balance left to approve this. Increase the balance or ask for Loss of Pay.', v_type.name
        using errcode = '22023';
    end if;
  end if;

  v_what := v_type.name || ' · ' || to_char(v_row.start_date, 'DD Mon YYYY')
    || case when v_row.end_date <> v_row.start_date then ' – ' || to_char(v_row.end_date, 'DD Mon YYYY') else '' end;
  select full_name into v_emp_name from public.ep_employees where id = v_row.employee_id;

  if v_row.status in ('manager_review', 'pending') and p_action = 'approved' then
    select m.id into v_mgr
      from public.ep_employees e join public.ep_employees m on m.id = e.reporting_manager_id
     where e.id = v_row.employee_id and m.is_active and m.id <> e.id
       and public.rbac_user_can(m.user_id, 'team.leave');
    if v_mgr is null and v_row.approver_id is not null and v_row.approver_id <> v_row.employee_id
       and exists (select 1 from public.ep_employees where id = v_row.approver_id and is_active
                    and public.rbac_user_can(user_id, 'team.leave')) then
      v_mgr := v_row.approver_id;
    end if;
  end if;

  if v_mgr is not null then
    -- Step 1 done: the admin approved; now the reporting manager decides.
    update public.ep_leave_requests
       set status = 'manager_pending', approver_id = v_mgr,
           decided_by_admin = auth.uid(), admin_decided_at = now(), admin_comment = v_comment, updated_at = now()
     where id = p_id returning * into v_row;
    perform public.ep_notify(v_row.employee_id, 'leave',
      'Admin approved your leave — waiting for your manager',
      v_what || ' · now with ' || (select full_name from public.ep_employees where id = v_mgr) || ' for the final decision'
        || coalesce(' · Admin: ' || v_comment, ''),
      '/employee/leave', 'normal');
    perform public.ep_notify(v_mgr, 'leave',
      'Admin approved ' || v_emp_name || '''s leave — please give your final approval',
      v_what || coalesce(' · Admin: ' || v_comment, '') || ' · Approve or reject it in Team requests.',
      '/employee/leave/team', 'normal');
  else
    -- Final decision by the admin: reject; approve with no portal manager; or deciding instead of the manager.
    v_final := v_row.status = 'manager_pending';
    update public.ep_leave_requests
       set status = p_action, decided_by = null, decided_by_admin = auth.uid(), decided_at = now(),
           decision_comment = v_comment,
           admin_decided_at = coalesce(admin_decided_at, now()),
           admin_comment = case when v_final then admin_comment else v_comment end,
           updated_at = now()
     where id = p_id returning * into v_row;
    perform public.ep_notify(v_row.employee_id, 'leave',
      'Your leave was ' || p_action,
      v_what || ' · by Admin' || coalesce(' · ' || v_comment, ''),
      '/employee/leave', case when p_action = 'rejected' then 'urgent' else 'normal' end);
    -- The reporting manager always learns the admin's decision (approved or rejected).
    if v_row.approver_id is not null and v_row.approver_id <> v_row.employee_id then
      perform public.ep_notify(v_row.approver_id, 'leave',
        'Admin ' || p_action || ' ' || v_emp_name || '''s leave',
        v_what || coalesce(' · Admin: ' || v_comment, '')
          || case when v_final then ' · decided instead of you; no action needed.' else ' · no action needed from you.' end,
        '/employee/leave/team', 'normal');
    end if;
  end if;
  return public.ep_leave_json(v_row)
    || jsonb_build_object('balance',
         public.ep_leave_balance_json(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type));
end $function$;

-- public.ep_admin_delete_custom_reminder
CREATE OR REPLACE FUNCTION public.ep_admin_delete_custom_reminder(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.notifications'); -- rbac
  delete from public.ep_custom_reminders where id = p_id;
  if not found then
    raise exception 'Reminder not found.' using errcode = 'P0002';
  end if;
  return public.ep_admin_custom_reminders();
end $function$;

-- public.ep_admin_delete_holiday
CREATE OR REPLACE FUNCTION public.ep_admin_delete_holiday(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_date date;
begin
  perform public.rbac_require('portal.leave'); -- rbac
  delete from public.ep_holidays where id = p_id returning holiday_date into v_date;
  if v_date is null then
    raise exception 'Holiday not found.' using errcode = 'P0002';
  end if;
  perform public.ep_recount_leave_on(v_date);
  return public.ep_admin_holidays(extract(year from v_date)::int);
end $function$;

-- public.ep_admin_employee
CREATE OR REPLACE FUNCTION public.ep_admin_employee(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v jsonb := public.ep_admin_employee_json(p_id);
begin
  perform public.rbac_require('portal.employees'); -- rbac
  if v is null then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  return v || jsonb_build_object(
    'personal', coalesce((
      select to_jsonb(p) - 'employee_id' from public.ep_employee_profiles p where p.employee_id = p_id
    ), '{}'::jsonb),
    'emergency_contacts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', c.name, 'relationship', c.relationship,
               'phone', c.phone, 'alternate_phone', c.alternate_phone) order by c.sort_order)
      from public.ep_emergency_contacts c where c.employee_id = p_id
    ), '[]'::jsonb),
    'direct_reports', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'full_name', r.full_name, 'employee_code', r.employee_code,
               'designation', r.designation, 'is_active', r.is_active) order by r.full_name)
      from public.ep_employees r where r.reporting_manager_id = p_id
    ), '[]'::jsonb)
  );
end $function$;

-- public.ep_admin_employees
CREATE OR REPLACE FUNCTION public.ep_admin_employees()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require_any(array['portal.employees', 'portal.projects', 'portal.attendance', 'portal.leave', 'portal.reports', 'portal.notifications']); -- rbac
  return coalesce((
    select jsonb_agg(public.ep_admin_employee_json(e.id) order by e.is_active desc, e.employee_code)
    from public.ep_employees e
  ), '[]'::jsonb);
end $function$;

-- public.ep_admin_holidays
CREATE OR REPLACE FUNCTION public.ep_admin_holidays(p_year integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.leave'); -- rbac
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'date', holiday_date, 'name', name) order by holiday_date)
    from public.ep_holidays where extract(year from holiday_date) = p_year), '[]'::jsonb);
end $function$;

-- public.ep_admin_inbox
CREATE OR REPLACE FUNCTION public.ep_admin_inbox(p_filter text DEFAULT 'all'::text, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  perform public.rbac_require('portal.inbox'); -- rbac
  return jsonb_build_object(
    'unread', (select count(*) from public.ep_admin_notifications n
                where not exists (select 1 from public.ep_admin_notification_reads r
                                   where r.notification_id = n.id and r.user_id = v_uid)),
    'counts', coalesce((select jsonb_object_agg(kind, c) from (
                 select kind, count(*) c from public.ep_admin_notifications n
                  where not exists (select 1 from public.ep_admin_notification_reads r
                                     where r.notification_id = n.id and r.user_id = v_uid)
                  group by kind) k), '{}'::jsonb),
    'items', coalesce((
      select jsonb_agg(x.j order by x.created_at desc) from (
        select n.created_at, jsonb_build_object(
                 'id', n.id, 'kind', n.kind, 'priority', n.priority, 'title', n.title, 'body', n.body,
                 'link', n.link, 'created_at', n.created_at,
                 'read', exists (select 1 from public.ep_admin_notification_reads r
                                  where r.notification_id = n.id and r.user_id = v_uid),
                 'employee', (select jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code)
                                from public.ep_employees e where e.id = n.employee_id)) j
          from public.ep_admin_notifications n
         where case coalesce(p_filter, 'all')
                 when 'all' then true
                 when 'unread' then not exists (select 1 from public.ep_admin_notification_reads r
                                                 where r.notification_id = n.id and r.user_id = v_uid)
                 else n.kind = p_filter end
         order by n.created_at desc
         limit least(greatest(coalesce(p_limit, 200), 1), 500)) x), '[]'::jsonb));
end $function$;

-- public.ep_admin_inbox_mark_read
CREATE OR REPLACE FUNCTION public.ep_admin_inbox_mark_read(p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.inbox'); -- rbac
  insert into public.ep_admin_notification_reads (notification_id, user_id)
  select n.id, auth.uid() from public.ep_admin_notifications n
   where p_ids is null or n.id = any (p_ids)
  on conflict do nothing;
end $function$;

-- public.ep_admin_inbox_summary
CREATE OR REPLACE FUNCTION public.ep_admin_inbox_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  perform public.rbac_require('portal.inbox'); -- rbac
  return jsonb_build_object('unread', (
    select count(*) from public.ep_admin_notifications n
     where not exists (select 1 from public.ep_admin_notification_reads r
                        where r.notification_id = n.id and r.user_id = v_uid)));
end $function$;

-- public.ep_admin_leave_balances
CREATE OR REPLACE FUNCTION public.ep_admin_leave_balances(p_year integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.leave'); -- rbac
  if p_year is null or p_year not between 2020 and 2100 then
    raise exception 'Invalid year.' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'year', p_year,
    'types', (select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'is_paid', is_paid, 'default', yearly_days)
                               order by sort_order)
              from public.ep_leave_types where is_active),
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'employee_code', e.employee_code, 'full_name', e.full_name,
               'designation', e.designation, 'is_active', e.is_active,
               'balances', (select jsonb_agg(public.ep_leave_balance_json(e.id, p_year, t.code) order by t.sort_order)
                              from public.ep_leave_types t where t.is_active))
             order by e.is_active desc, e.full_name)
      from public.ep_employees e), '[]'::jsonb));
end $function$;

-- public.ep_admin_leave_requests
CREATE OR REPLACE FUNCTION public.ep_admin_leave_requests(p_status text DEFAULT 'pending'::text, p_year integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.leave'); -- rbac
  return coalesce((
    select jsonb_agg(public.ep_leave_json(r)
             || jsonb_build_object('balance',
                  public.ep_leave_balance_json(r.employee_id, extract(year from r.start_date)::int, r.leave_type))
             order by case r.status when 'pending' then 0 when 'manager_review' then 1 when 'manager_pending' then 2 else 3 end, r.start_date desc, r.created_at desc)
    from (select * from public.ep_leave_requests
           where (coalesce(p_status, 'all') = 'all' or status = p_status)
             and (p_year is null or extract(year from start_date) = p_year)
           order by start_date desc limit 300) r), '[]'::jsonb);
end $function$;

-- public.ep_admin_notification_log
CREATE OR REPLACE FUNCTION public.ep_admin_notification_log(p_kind text DEFAULT 'all'::text, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.notifications'); -- rbac
  return jsonb_build_object(
    'counts', (
      select jsonb_object_agg(k.kind, coalesce(c.n, 0))
      from unnest(array['project', 'leave', 'attendance', 'report', 'message']) k(kind)
      left join (select kind, count(*) as n from public.ep_notifications
                  where created_at > now() - interval '30 days' group by kind) c on c.kind = k.kind),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', n.id, 'kind', n.kind, 'priority', n.priority, 'title', n.title, 'body', n.body,
               'created_at', n.created_at, 'read_at', n.read_at, 'sender', n.sender_label,
               'automatic', n.sender_user_id is null,
               'employee', jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code))
             order by n.created_at desc)
      from (select * from public.ep_notifications
             where case coalesce(p_kind, 'all')
                     when 'all' then true
                     when 'automatic' then sender_user_id is null
                     when 'messages' then message_id is not null
                     else kind = p_kind
                   end
             order by created_at desc
             limit least(greatest(coalesce(p_limit, 100), 1), 300)) n
      join public.ep_employees e on e.id = n.employee_id), '[]'::jsonb));
end $function$;

-- public.ep_admin_notify_options
CREATE OR REPLACE FUNCTION public.ep_admin_notify_options()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.notifications'); -- rbac
  return jsonb_build_object(
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
                                          'designation', e.designation, 'department', e.department) order by e.full_name)
      from public.ep_employees e where e.is_active), '[]'::jsonb),
    'departments', coalesce((
      select jsonb_agg(jsonb_build_object('name', d.department, 'count', d.n) order by d.department)
      from (select department, count(*) as n from public.ep_employees
             where is_active and department is not null group by department) d), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'project_code', p.project_code, 'count', x.n)
                       order by p.name)
      from public.pt_projects p
      join (select m.project_id, count(*) as n from public.ep_project_members m
              join public.ep_employees e on e.id = m.employee_id and e.is_active
             group by m.project_id) x on x.project_id = p.id), '[]'::jsonb));
end $function$;

-- public.ep_admin_pm_delete_task
CREATE OR REPLACE FUNCTION public.ep_admin_pm_delete_task(p_task uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_project uuid;
begin
  perform public.rbac_require('portal.projects'); -- rbac
  delete from public.ep_project_tasks where id = p_task returning project_id into v_project;
  if v_project is null then
    raise exception 'Task not found.' using errcode = 'P0002';
  end if;
  return public.ep_admin_pm_project(v_project);
end $function$;

-- public.ep_admin_pm_project
CREATE OR REPLACE FUNCTION public.ep_admin_pm_project(p_project uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_today date := (timezone('Asia/Kolkata', now()))::date;
  v jsonb;
begin
  perform public.rbac_require('portal.projects'); -- rbac
  select jsonb_build_object(
           'id', p.id, 'project_code', p.project_code, 'name', p.name, 'client', c.name,
           'description', p.description, 'project_type', p.project_type,
           'status', p.status, 'priority', p.priority, 'health', p.health, 'progress', p.progress,
           'start_date', p.start_date, 'end_date', p.end_date, 'completed_date', p.completed_date,
           'project_manager', p.project_manager,
           'overdue', p.end_date < v_today and public.ep_project_is_running(p.status),
           'completed_late', p.completed_date > p.end_date,
           'delay_reasons', public.ep_project_delay_json(p.id))
    into v
  from public.pt_projects p
  left join public.pt_companies c on c.id = p.company_id
  where p.id = p_project;
  if v is null then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;

  return v || jsonb_build_object(
    'team', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'employee_code', e.employee_code, 'full_name', e.full_name,
               'designation', e.designation, 'is_active', e.is_active,
               'project_role', m.project_role, 'is_lead', m.is_lead, 'added_at', m.added_at,
               'tasks_total',       (select count(*) from public.ep_project_tasks t where t.project_id = p_project and t.assignee_id = e.id),
               'tasks_done',        (select count(*) from public.ep_project_tasks t where t.project_id = p_project and t.assignee_id = e.id and t.status = 'done'),
               'tasks_in_progress', (select count(*) from public.ep_project_tasks t where t.project_id = p_project and t.assignee_id = e.id and t.status = 'in_progress'),
               'tasks_overdue',     (select count(*) from public.ep_project_tasks t where t.project_id = p_project and t.assignee_id = e.id
                                       and t.status <> 'done' and t.due_date < v_today),
               'hours_logged', coalesce((
                 select sum(i.hours) from public.ep_work_report_items i
                 join public.ep_work_reports r on r.id = i.report_id
                 where i.project_id = p_project and r.employee_id = e.id and r.status in ('submitted', 'reviewed')), 0),
               'last_report_date', (
                 select max(r.report_date) from public.ep_work_report_items i
                 join public.ep_work_reports r on r.id = i.report_id
                 where i.project_id = p_project and r.employee_id = e.id and r.status in ('submitted', 'reviewed'))
             ) order by m.is_lead desc, e.full_name)
      from public.ep_project_members m join public.ep_employees e on e.id = m.employee_id
      where m.project_id = p_project), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'title', t.title, 'description', t.description, 'status', t.status,
               'priority', t.priority, 'due_date', t.due_date, 'completed_at', t.completed_at,
               'created_at', t.created_at,
               'overdue', t.status <> 'done' and t.due_date < v_today,
               'late', t.due_date < coalesce((timezone('Asia/Kolkata', t.completed_at))::date, v_today),
               'delay_reason', t.delay_reason, 'delay_reason_at', t.delay_reason_at,
               'delay_reason_by', (select full_name from public.ep_employees where id = t.delay_reason_by),
               'assignee', case when a.id is null then null else jsonb_build_object('id', a.id, 'full_name', a.full_name) end,
               'created_by', coalesce(cb.full_name, 'Admin'))
             order by (t.status = 'done'), t.due_date nulls last, t.created_at desc)
      from public.ep_project_tasks t
      left join public.ep_employees a on a.id = t.assignee_id
      left join public.ep_employees cb on cb.id = t.created_by
      where t.project_id = p_project), '[]'::jsonb),
    'updates', coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'body', u.body, 'created_at', u.created_at,
                                          'author', coalesce(au.full_name, 'Admin')) order by u.created_at desc)
      from (select * from public.ep_project_updates where project_id = p_project order by created_at desc limit 20) u
      left join public.ep_employees au on au.id = u.author_id), '[]'::jsonb)
  );
end $function$;

-- public.ep_admin_pm_projects
CREATE OR REPLACE FUNCTION public.ep_admin_pm_projects()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_today date := (timezone('Asia/Kolkata', now()))::date;
begin
  perform public.rbac_require('portal.projects'); -- rbac
  return coalesce((
    select jsonb_agg(x.j order by x.sort_status, x.end_date nulls last, x.name)
    from (
      select p.name, p.end_date,
             case p.status when 'in_progress' then 0 when 'planning' then 1 when 'live' then 2 when 'on_hold' then 3
                           when 'completed' then 4 else 5 end as sort_status,
             jsonb_build_object(
               'id', p.id, 'project_code', p.project_code, 'name', p.name, 'client', c.name,
               'status', p.status, 'priority', p.priority, 'health', p.health,
               'start_date', p.start_date, 'end_date', p.end_date, 'completed_date', p.completed_date,
               'team', coalesce((
                 select jsonb_agg(jsonb_build_object('id', e.id, 'full_name', e.full_name, 'is_lead', m.is_lead)
                                  order by m.is_lead desc, e.full_name)
                 from public.ep_project_members m join public.ep_employees e on e.id = m.employee_id
                 where m.project_id = p.id), '[]'::jsonb),
               'tasks_total',   (select count(*) from public.ep_project_tasks t where t.project_id = p.id),
               'tasks_done',    (select count(*) from public.ep_project_tasks t where t.project_id = p.id and t.status = 'done'),
               'tasks_overdue', (select count(*) from public.ep_project_tasks t where t.project_id = p.id
                                   and t.status <> 'done' and t.due_date < v_today)
             ) as j
      from public.pt_projects p
      left join public.pt_companies c on c.id = p.company_id
    ) x
  ), '[]'::jsonb);
end $function$;

-- public.ep_admin_pm_remove_member
CREATE OR REPLACE FUNCTION public.ep_admin_pm_remove_member(p_project uuid, p_employee uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.projects'); -- rbac
  delete from public.ep_project_members where project_id = p_project and employee_id = p_employee;
  if not found then
    raise exception 'This employee is not on the project.' using errcode = 'P0002';
  end if;
  update public.ep_project_tasks set assignee_id = null, updated_at = now()
   where project_id = p_project and assignee_id = p_employee and status <> 'done';
  return public.ep_admin_pm_project(p_project);
end $function$;

-- public.ep_admin_pm_save_member
CREATE OR REPLACE FUNCTION public.ep_admin_pm_save_member(p_project uuid, p_employee uuid, p_role text DEFAULT NULL::text, p_is_lead boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.projects'); -- rbac
  if not exists (select 1 from public.pt_projects where id = p_project) then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.ep_employees where id = p_employee and is_active) then
    raise exception 'Choose an active employee.' using errcode = '22023';
  end if;
  insert into public.ep_project_members (project_id, employee_id, project_role, is_lead)
  values (p_project, p_employee, nullif(btrim(coalesce(p_role, '')), ''), coalesce(p_is_lead, false))
  on conflict (project_id, employee_id) do update
    set project_role = excluded.project_role, is_lead = excluded.is_lead;
  return public.ep_admin_pm_project(p_project);
end $function$;

-- public.ep_admin_pm_save_task
CREATE OR REPLACE FUNCTION public.ep_admin_pm_save_task(p_project uuid, p_task uuid, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f text;
  v_assignee uuid;
  v_status text;
begin
  perform public.rbac_require('portal.projects'); -- rbac
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Invalid task data.' using errcode = '22023';
  end if;
  for f in select jsonb_object_keys(p) loop
    if f not in ('title', 'description', 'assignee_id', 'priority', 'status', 'due_date') then
      raise exception 'Field % cannot be set here.', f using errcode = '42501';
    end if;
  end loop;
  if not exists (select 1 from public.pt_projects where id = p_project) then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;
  if nullif(btrim(coalesce(p ->> 'title', '')), '') is null then
    raise exception 'Task title is required.' using errcode = '22023';
  end if;
  v_assignee := nullif(btrim(coalesce(p ->> 'assignee_id', '')), '')::uuid;
  -- Checked for new tasks and when the assignee changes (an existing assignee may have left the team).
  if v_assignee is not null
     and (p_task is null or v_assignee is distinct from (select assignee_id from public.ep_project_tasks where id = p_task))
     and not exists (
       select 1 from public.ep_project_members m join public.ep_employees e on e.id = m.employee_id
       where m.project_id = p_project and m.employee_id = v_assignee and e.is_active) then
    raise exception 'Assign the task to an active member of this project.' using errcode = '22023';
  end if;
  v_status := coalesce(nullif(btrim(coalesce(p ->> 'status', '')), ''), 'todo');

  if p_task is null then
    insert into public.ep_project_tasks (project_id, title, description, assignee_id, status, priority, due_date, completed_at)
    values (p_project, btrim(p ->> 'title'), nullif(btrim(coalesce(p ->> 'description', '')), ''), v_assignee, v_status,
            coalesce(nullif(btrim(coalesce(p ->> 'priority', '')), ''), 'medium'),
            nullif(btrim(coalesce(p ->> 'due_date', '')), '')::date,
            case when v_status = 'done' then now() end);
  else
    update public.ep_project_tasks set
      title        = btrim(p ->> 'title'),
      description  = nullif(btrim(coalesce(p ->> 'description', '')), ''),
      assignee_id  = v_assignee,
      status       = v_status,
      priority     = coalesce(nullif(btrim(coalesce(p ->> 'priority', '')), ''), 'medium'),
      due_date     = nullif(btrim(coalesce(p ->> 'due_date', '')), '')::date,
      completed_at = case when v_status = 'done' then coalesce(completed_at, now()) end,
      updated_at   = now()
    where id = p_task and project_id = p_project;
    if not found then
      raise exception 'Task not found.' using errcode = 'P0002';
    end if;
  end if;
  return public.ep_admin_pm_project(p_project);
end $function$;

-- public.ep_admin_pm_set_deadline
CREATE OR REPLACE FUNCTION public.ep_admin_pm_set_deadline(p_project uuid, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_start date;
begin
  perform public.rbac_require('portal.projects'); -- rbac
  select start_date into v_start from public.pt_projects where id = p_project;
  if not found then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;
  if p_date is not null and v_start is not null and p_date < v_start then
    raise exception 'The deadline cannot be before the start date (%).', to_char(v_start, 'DD Mon YYYY') using errcode = '22023';
  end if;
  update public.pt_projects set end_date = p_date, updated_at = now() where id = p_project;
  return public.ep_admin_pm_project(p_project);
end $function$;

-- public.ep_admin_portal_dashboard
CREATE OR REPLACE FUNCTION public.ep_admin_portal_dashboard()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_today   date := (timezone('Asia/Kolkata', now()))::date;
  v_holiday text;
  v_prev    date;
begin
  perform public.rbac_require('portal.dashboard'); -- rbac
  perform public.ep_close_overdue_sessions(null);
  select name into v_holiday from public.ep_holidays where holiday_date = v_today;
  -- Previous working day (skips Sundays and holidays), for "reports not submitted".
  select max(d)::date into v_prev
    from generate_series(v_today - 10, v_today - 1, interval '1 day') d
   where extract(isodow from d) <> 7 and not exists (select 1 from public.ep_holidays h where h.holiday_date = d::date);

  return jsonb_build_object(
    'today', v_today,
    'working_day', extract(isodow from v_today) <> 7 and v_holiday is null,
    'holiday', v_holiday,
    'previous_working_day', v_prev,
    'employees', (select jsonb_build_object(
                    'active', count(*) filter (where is_active),
                    'interns', count(*) filter (where is_active and employment_type = 'intern'),
                    'access_off', count(*) filter (where not is_active))
                  from public.ep_employees),
    'people', coalesce((
      select jsonb_agg(x.j order by x.ord, x.name)
      from (
        select e.full_name as name,
               case when a.open then 0 when a.first_in is not null then 1 when lv.id is not null then 2 else 3 end as ord,
               jsonb_build_object(
                 'id', e.id, 'full_name', e.full_name, 'designation', e.designation,
                 'status', case when a.open then 'in'
                                when a.first_in is not null then 'out'
                                when lv.id is not null then 'leave'
                                when extract(isodow from v_today) = 7 or v_holiday is not null then 'off'
                                else 'not_in' end,
                 'first_in', a.first_in,
                 'late', a.first_in is not null
                         and (a.first_in at time zone 'Asia/Kolkata')::time > (public.ep_attendance_rules() ->> 'late_after')::time,
                 'leave_type', lv.leave_type, 'half_day', lv.half_day) as j
        from public.ep_employees e
        left join lateral (
          select min(punch_in_at) as first_in, bool_or(punch_out_at is null) as open
          from public.ep_attendance where employee_id = e.id and work_date = v_today) a on true
        left join lateral (
          select r.id, r.leave_type, r.half_day from public.ep_leave_requests r
          where r.employee_id = e.id and r.status = 'approved' and v_today between r.start_date and r.end_date
          limit 1) lv on true
        where e.is_active) x), '[]'::jsonb),
    'pending', jsonb_build_object(
      'leave', (select count(*) from public.ep_leave_requests where status = 'pending'),
      'corrections', (select count(*) from public.ep_attendance_corrections where status = 'pending'),
      'reports_to_review', (select count(*) from public.ep_work_reports where status = 'submitted'),
      'reports_missing', (
        select count(*) from (select distinct employee_id from public.ep_attendance where work_date = v_prev) d
        where exists (select 1 from public.ep_project_members m where m.employee_id = d.employee_id)
          and not exists (select 1 from public.ep_work_reports w where w.employee_id = d.employee_id
                           and w.report_date = v_prev and w.status in ('submitted', 'reviewed'))),
      'tasks_overdue_no_reason', (
        select count(*) from public.ep_project_tasks t join public.pt_projects p on p.id = t.project_id
        where t.status <> 'done' and t.due_date < v_today and t.delay_reason is null
          and p.status not in ('completed', 'cancelled')),
      'projects_overdue', (
        select count(*) from public.pt_projects p
        where public.ep_project_is_running(p.status) and p.end_date < v_today
          and exists (select 1 from public.ep_project_members m where m.project_id = p.id))),
    'deadlines', coalesce((
      select jsonb_agg(d.j order by d.due, d.kind desc)
      from (
        select t.due_date as due, 'task' as kind, jsonb_build_object(
                 'kind', 'task', 'title', t.title, 'due_date', t.due_date, 'project_id', p.id, 'project_name', p.name,
                 'who', (select full_name from public.ep_employees where id = t.assignee_id)) as j
        from public.ep_project_tasks t join public.pt_projects p on p.id = t.project_id
        where t.status <> 'done' and t.due_date between v_today and v_today + 7
          and p.status not in ('completed', 'cancelled')
        union all
        select p.end_date, 'project', jsonb_build_object(
                 'kind', 'project', 'title', p.name, 'due_date', p.end_date, 'project_id', p.id, 'project_name', p.name,
                 'who', null)
        from public.pt_projects p
        where public.ep_project_is_running(p.status) and p.end_date between v_today and v_today + 7
        order by 1 limit 8) d), '[]'::jsonb),
    'leave_upcoming', coalesce((
      select jsonb_agg(jsonb_build_object(
               'full_name', e.full_name, 'leave_type', r.leave_type, 'start_date', r.start_date,
               'end_date', r.end_date, 'days', r.days, 'half_day', r.half_day) order by r.start_date)
      from public.ep_leave_requests r join public.ep_employees e on e.id = r.employee_id
      where r.status = 'approved' and r.start_date between v_today + 1 and v_today + 7), '[]'::jsonb),
    'next_holiday', (
      select jsonb_build_object('date', holiday_date, 'name', name)
      from public.ep_holidays where holiday_date > v_today order by holiday_date limit 1)
  );
end $function$;

-- public.ep_admin_reminder_settings
CREATE OR REPLACE FUNCTION public.ep_admin_reminder_settings()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.notifications'); -- rbac
  return (select jsonb_agg(jsonb_build_object(
                   'kind', kind, 'enabled', enabled, 'send_at', to_char(send_at, 'HH24:MI'),
                   'days', to_jsonb(days), 'last_run', last_run,
                   'sent_today', (select count(*) from public.ep_notifications
                                   where dedupe_key like s.kind || ':' || (timezone('Asia/Kolkata', now()))::date || '%'))
                 order by send_at)
          from public.ep_reminder_settings s);
end $function$;

-- public.ep_admin_remove_certificate
CREATE OR REPLACE FUNCTION public.ep_admin_remove_certificate(p_emp uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_old text;
begin
  perform public.rbac_require('portal.employees'); -- rbac
  delete from public.ep_internship_certificates where employee_id = p_emp returning storage_path into v_old;
  if v_old is null then
    raise exception 'There is no certificate to remove.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('old_path', v_old);
end $function$;

-- public.ep_admin_reports
CREATE OR REPLACE FUNCTION public.ep_admin_reports(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_today date := (timezone('Asia/Kolkata', now()))::date;
begin
  perform public.rbac_require('portal.reports'); -- rbac
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'Choose a date range of at most 93 days.' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'reports', coalesce((
      select jsonb_agg(public.ep_report_json(r.id) order by r.report_date desc, r.updated_at desc)
      from public.ep_work_reports r where r.report_date between p_from and p_to), '[]'::jsonb),
    -- Worked that day (punched in, on a project) but no submitted / reviewed report.
    'missing', coalesce((
      select jsonb_agg(jsonb_build_object(
               'employee', jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code),
               'date', d.work_date,
               'status', coalesce(w.status, 'not_started')) order by d.work_date desc, e.full_name)
      from (select distinct employee_id, work_date from public.ep_attendance
             where work_date between p_from and least(p_to, v_today)) d
      join public.ep_employees e on e.id = d.employee_id
      left join public.ep_work_reports w on w.employee_id = d.employee_id and w.report_date = d.work_date
      where exists (select 1 from public.ep_project_members m where m.employee_id = e.id)
        and (w.id is null or w.status in ('draft', 'returned'))), '[]'::jsonb));
end $function$;

-- public.ep_admin_review_report
CREATE OR REPLACE FUNCTION public.ep_admin_review_report(p_report uuid, p_action text, p_comment text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_status  text;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  perform public.rbac_require('portal.reports'); -- rbac
  select status into v_status from public.ep_work_reports where id = p_report for update;
  if v_status is null then
    raise exception 'Report not found.' using errcode = 'P0002';
  end if;
  if v_status <> 'submitted' then
    raise exception 'Only a submitted report can be reviewed (this one is %).', v_status using errcode = 'P0001';
  end if;
  if p_action not in ('reviewed', 'returned') then
    raise exception 'Invalid action.' using errcode = '22023';
  end if;
  if p_action = 'returned' and v_comment is null then
    raise exception 'Write a comment saying what needs to change.' using errcode = '22023';
  end if;
  if coalesce(length(v_comment), 0) > 1000 then
    raise exception 'Comment must be at most 1000 characters.' using errcode = '22023';
  end if;
  update public.ep_work_reports
     set status = p_action, reviewed_by = null, reviewed_by_admin = auth.uid(), reviewed_at = now(),
         review_comment = v_comment, updated_at = now()
   where id = p_report;
  return public.ep_report_json(p_report);
end $function$;

-- public.ep_admin_save_custom_reminder
CREATE OR REPLACE FUNCTION public.ep_admin_save_custom_reminder(p_id uuid, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_title    text := btrim(coalesce(p ->> 'title', ''));
  v_body     text := nullif(btrim(coalesce(p ->> 'body', '')), '');
  v_aud      text := p ->> 'audience';
  v_repeat   text := p ->> 'repeat';
  v_at       time;
  v_date     date := nullif(p ->> 'send_date', '')::date;
  v_days     smallint[];
  v_deps     text[];
  v_people   uuid[];
  v_project  uuid := nullif(p ->> 'project_id', '')::uuid;
  v_today    date := (timezone('Asia/Kolkata', now()))::date;
  v_id       uuid;
begin
  perform public.rbac_require('portal.notifications'); -- rbac
  if length(v_title) not between 1 and 150 then
    raise exception 'Title must be 1 to 150 characters.' using errcode = '22023';
  end if;
  if coalesce(length(v_body), 0) > 2000 then
    raise exception 'Message must be at most 2000 characters.' using errcode = '22023';
  end if;
  begin
    v_at := (p ->> 'send_at')::time;
  exception when others then
    v_at := null;
  end;
  if v_at is null or v_at < time '06:00' or v_at > time '21:55' then
    raise exception 'Choose a time between 6:00 AM and 9:55 PM.' using errcode = '22023';
  end if;
  if v_aud not in ('all', 'department', 'project', 'people') then
    raise exception 'Choose who should get it.' using errcode = '22023';
  end if;
  select array_agg(distinct btrim(x)) into v_deps
    from jsonb_array_elements_text(coalesce(p -> 'departments', '[]'::jsonb)) x where btrim(x) <> '';
  select array_agg(distinct x::uuid) into v_people
    from jsonb_array_elements_text(coalesce(p -> 'people', '[]'::jsonb)) x;
  select array_agg(distinct x::smallint order by x::smallint) into v_days
    from jsonb_array_elements_text(coalesce(p -> 'days', '[]'::jsonb)) x;
  if v_aud = 'department' and v_deps is null then
    raise exception 'Choose at least one department.' using errcode = '22023';
  end if;
  if v_aud = 'project' and (v_project is null or not exists (select 1 from public.pt_projects where id = v_project)) then
    raise exception 'Choose a project team.' using errcode = '22023';
  end if;
  if v_aud = 'people' and v_people is null then
    raise exception 'Choose at least one person.' using errcode = '22023';
  end if;
  if v_repeat = 'weekly' then
    if v_days is null or not (v_days <@ '{1,2,3,4,5,6,7}'::smallint[]) then
      raise exception 'Choose at least one day.' using errcode = '22023';
    end if;
    v_date := null;
  elsif v_repeat = 'once' then
    if v_date is null or v_date < v_today then
      raise exception 'Choose today or a later date.' using errcode = '22023';
    end if;
    v_days := null;
  else
    raise exception 'Choose weekly or one time.' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.ep_custom_reminders
      (title, body, priority, audience, departments, project_id, people, repeat, days, send_date, send_at, enabled, created_by)
    values (v_title, v_body, coalesce(nullif(p ->> 'priority', ''), 'normal'), v_aud,
            case when v_aud = 'department' then v_deps end, case when v_aud = 'project' then v_project end,
            case when v_aud = 'people' then v_people end, v_repeat, v_days, v_date, v_at,
            coalesce((p ->> 'enabled')::boolean, true), auth.uid())
    returning id into v_id;
  else
    update public.ep_custom_reminders set
      title = v_title, body = v_body, priority = coalesce(nullif(p ->> 'priority', ''), 'normal'), audience = v_aud,
      departments = case when v_aud = 'department' then v_deps end,
      project_id  = case when v_aud = 'project' then v_project end,
      people      = case when v_aud = 'people' then v_people end,
      repeat = v_repeat, days = v_days, send_date = v_date, send_at = v_at,
      enabled = coalesce((p ->> 'enabled')::boolean, enabled),
      -- a changed one-time reminder may run again
      last_run = case when v_repeat = 'once' then null else last_run end,
      updated_at = now()
    where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'Reminder not found.' using errcode = 'P0002';
    end if;
  end if;
  return public.ep_admin_custom_reminders();
end $function$;

-- public.ep_admin_save_holiday
CREATE OR REPLACE FUNCTION public.ep_admin_save_holiday(p_id uuid, p_date date, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_old date;
  v_name text := btrim(coalesce(p_name, ''));
begin
  perform public.rbac_require('portal.leave'); -- rbac
  if p_date is null or p_date not between date '2020-01-01' and date '2100-12-31' then
    raise exception 'Choose a valid date.' using errcode = '22023';
  end if;
  if length(v_name) not between 1 and 80 then
    raise exception 'Holiday name is required (up to 80 characters).' using errcode = '22023';
  end if;
  if exists (select 1 from public.ep_holidays where holiday_date = p_date and id is distinct from p_id) then
    raise exception '% is already a holiday.', to_char(p_date, 'DD Mon YYYY') using errcode = '23505';
  end if;
  if p_id is null then
    insert into public.ep_holidays (holiday_date, name) values (p_date, v_name);
  else
    select holiday_date into v_old from public.ep_holidays where id = p_id for update;
    if not found then
      raise exception 'Holiday not found.' using errcode = 'P0002';
    end if;
    update public.ep_holidays set holiday_date = p_date, name = v_name where id = p_id;
    if v_old <> p_date then
      perform public.ep_recount_leave_on(v_old);
    end if;
  end if;
  perform public.ep_recount_leave_on(p_date);
  return public.ep_admin_holidays(extract(year from p_date)::int);
end $function$;

-- public.ep_admin_save_reminder
CREATE OR REPLACE FUNCTION public.ep_admin_save_reminder(p_kind text, p_enabled boolean, p_send_at time without time zone, p_days smallint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.notifications'); -- rbac
  if p_send_at is null or p_send_at < time '06:00' or p_send_at > time '21:55' then
    raise exception 'Choose a time between 6:00 AM and 9:55 PM.' using errcode = '22023';
  end if;
  if p_days is null or cardinality(p_days) = 0 or not (p_days <@ '{1,2,3,4,5,6,7}'::smallint[]) then
    raise exception 'Choose at least one day.' using errcode = '22023';
  end if;
  update public.ep_reminder_settings
     set enabled = coalesce(p_enabled, false), send_at = p_send_at,
         days = (select array_agg(distinct d order by d) from unnest(p_days) d), updated_at = now()
   where kind = p_kind;
  if not found then
    raise exception 'Reminder not found.' using errcode = 'P0002';
  end if;
  return public.ep_admin_reminder_settings();
end $function$;

-- public.ep_admin_send_custom_reminder_now
CREATE OR REPLACE FUNCTION public.ep_admin_send_custom_reminder_now(p_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.notifications'); -- rbac
  if not exists (select 1 from public.ep_custom_reminders where id = p_id) then
    raise exception 'Reminder not found.' using errcode = 'P0002';
  end if;
  return public.ep_send_custom_reminder(p_id);
end $function$;

-- public.ep_admin_send_notification
CREATE OR REPLACE FUNCTION public.ep_admin_send_notification(p_audience text, p_to uuid[], p_departments text[], p_project uuid, p_title text, p_body text, p_priority text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_msg   uuid := gen_random_uuid();
  v_title text := btrim(coalesce(p_title, ''));
  v_body  text := nullif(btrim(coalesce(p_body, '')), '');
  v_n     integer;
begin
  perform public.rbac_require('portal.notifications'); -- rbac
  if length(v_title) not between 1 and 150 then
    raise exception 'Subject must be 1 to 150 characters.' using errcode = '22023';
  end if;
  if coalesce(length(v_body), 0) > 2000 then
    raise exception 'Message must be at most 2000 characters.' using errcode = '22023';
  end if;
  if coalesce(p_priority, '') not in ('normal', 'urgent') then
    raise exception 'Invalid priority.' using errcode = '22023';
  end if;
  if p_audience not in ('all', 'people', 'department', 'project') then
    raise exception 'Invalid audience.' using errcode = '22023';
  end if;
  if p_audience = 'people' and coalesce(cardinality(p_to), 0) = 0 then
    raise exception 'Choose at least one person.' using errcode = '22023';
  end if;
  if p_audience = 'department' and coalesce(cardinality(p_departments), 0) = 0 then
    raise exception 'Choose at least one department.' using errcode = '22023';
  end if;
  if p_audience = 'project' and p_project is null then
    raise exception 'Choose a project team.' using errcode = '22023';
  end if;

  insert into public.ep_notifications
    (employee_id, kind, priority, title, body, sender_employee_id, sender_user_id, sender_label, message_id)
  select e.id, 'message', p_priority, v_title, v_body, null, auth.uid(), 'Admin', v_msg
    from public.ep_employees e
   where e.is_active
     and case p_audience
           when 'all'        then true
           when 'people'     then e.id = any (p_to)
           when 'department' then e.department = any (p_departments)
           else exists (select 1 from public.ep_project_members m where m.project_id = p_project and m.employee_id = e.id)
         end;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Nobody active matches this audience.' using errcode = '22023';
  end if;
  return jsonb_build_object('message_id', v_msg, 'recipients', v_n);
end $function$;

-- public.ep_admin_send_reminder_now
CREATE OR REPLACE FUNCTION public.ep_admin_send_reminder_now(p_kind text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_key    text;
  v_before integer;
  v_after  integer;
begin
  perform public.rbac_require('portal.notifications'); -- rbac
  if p_kind not in ('punch_in', 'report', 'punch_out', 'deadlines') then
    raise exception 'Reminder not found.' using errcode = 'P0002';
  end if;
  v_key := p_kind || ':' || (timezone('Asia/Kolkata', now()))::date || '%';
  select count(*) into v_before from public.ep_notifications where dedupe_key like v_key;
  if p_kind = 'deadlines' then
    perform public.ep_send_deadline_reminders();
  else
    perform public.ep_send_reminders(p_kind);
  end if;
  select count(*) into v_after from public.ep_notifications where dedupe_key like v_key;
  return v_after - v_before;
end $function$;

-- public.ep_admin_set_certificate
CREATE OR REPLACE FUNCTION public.ep_admin_set_certificate(p_emp uuid, p_path text, p_name text, p_size bigint, p_mime text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_type text;
  v_old  text;
begin
  perform public.rbac_require('portal.employees'); -- rbac
  select employment_type into v_type from public.ep_employees where id = p_emp;
  if not found then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  if v_type is distinct from 'intern' then
    raise exception 'Set the employment type to Intern first.' using errcode = '22023';
  end if;
  if p_path is null or p_path not like p_emp::text || '/%' then
    raise exception 'Invalid file location.' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'ep-certificates' and name = p_path) then
    raise exception 'The file was not uploaded.' using errcode = 'P0002';
  end if;
  select storage_path into v_old from public.ep_internship_certificates where employee_id = p_emp for update;
  insert into public.ep_internship_certificates (employee_id, storage_path, file_name, file_size, mime_type, uploaded_by, uploaded_at)
  values (p_emp, p_path, left(btrim(p_name), 255), p_size, p_mime, auth.uid(), now())
  on conflict (employee_id) do update
    set storage_path = excluded.storage_path, file_name = excluded.file_name, file_size = excluded.file_size,
        mime_type = excluded.mime_type, uploaded_by = excluded.uploaded_by, uploaded_at = now();
  perform public.ep_notify(p_emp, 'message',
    case when v_old is null then 'Your internship certificate is ready' else 'Your internship certificate was updated' end,
    'Download it from My Profile.', '/employee/profile');
  return jsonb_build_object('old_path', case when v_old is distinct from p_path then v_old end);
end $function$;

-- public.ep_admin_set_employee_access
CREATE OR REPLACE FUNCTION public.ep_admin_set_employee_access(p_id uuid, p_active boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.employees'); -- rbac
  if p_active is null then
    raise exception 'Choose on or off.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.ep_employees where id = p_id) then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  -- Same lock as punch in / out, so a punch cannot slip in while access is turned off.
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  update public.ep_employees set is_active = p_active, updated_at = now()
   where id = p_id and is_active is distinct from p_active;
  if not p_active then
    update public.ep_attendance set punch_out_at = now()
     where employee_id = p_id and punch_out_at is null;
  end if;
  return public.ep_admin_employee(p_id);
end $function$;

-- public.ep_admin_set_leave_allowance
CREATE OR REPLACE FUNCTION public.ep_admin_set_leave_allowance(p_emp uuid, p_year integer, p_type text, p_days numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_type public.ep_leave_types;
  v_approved numeric;
begin
  perform public.rbac_require('portal.leave'); -- rbac
  select * into v_type from public.ep_leave_types where code = p_type;
  if v_type.code is null or not v_type.is_paid then
    raise exception 'Only paid leave types have a balance.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.ep_employees where id = p_emp) then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  if p_year is null or p_year not between 2020 and 2100 then
    raise exception 'Invalid year.' using errcode = '22023';
  end if;
  if p_days is null then
    delete from public.ep_leave_allocations where employee_id = p_emp and year = p_year and leave_type = p_type;
  else
    if p_days < 0 or p_days > 366 or p_days * 2 <> round(p_days * 2) then
      raise exception 'Days must be between 0 and 366, in steps of 0.5.' using errcode = '22023';
    end if;
    select coalesce(sum(days), 0) into v_approved from public.ep_leave_requests
     where employee_id = p_emp and leave_type = p_type and status = 'approved' and extract(year from start_date) = p_year;
    if p_days < v_approved then
      raise exception '% days of % are already approved this year; the balance cannot be lower.', v_approved, v_type.name
        using errcode = '22023';
    end if;
    insert into public.ep_leave_allocations (employee_id, year, leave_type, days)
    values (p_emp, p_year, p_type, p_days)
    on conflict (employee_id, year, leave_type) do update set days = excluded.days;
  end if;
  return public.ep_leave_balance_json(p_emp, p_year, p_type);
end $function$;

-- public.ep_admin_update_employee
CREATE OR REPLACE FUNCTION public.ep_admin_update_employee(p_id uuid, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f text;
  v_old public.ep_employees;
  v_new public.ep_employees;
  v_mgr uuid;
  v_walk uuid;
  v_depth int := 0;
  v_mgr_name text;
  v_code text;
begin
  perform public.rbac_require('portal.employees'); -- rbac
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Invalid employee data.' using errcode = '22023';
  end if;
  for f in select jsonb_object_keys(p) loop
    if f not in ('employee_code', 'full_name', 'department', 'designation', 'reporting_manager_id', 'reporting_manager_name',
                 'date_of_joining', 'employment_type', 'work_location') then
      raise exception 'Field % cannot be changed here.', f using errcode = '42501';
    end if;
  end loop;

  select * into v_old from public.ep_employees where id = p_id for update;
  if v_old.id is null then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;

  if p ? 'full_name' and nullif(btrim(p ->> 'full_name'), '') is null then
    raise exception 'Name cannot be empty.' using errcode = '22023';
  end if;

  -- Employee ID: the admin may change it (sign-in stays the same: it uses the email).
  v_code := case when p ? 'employee_code' then upper(btrim(coalesce(p ->> 'employee_code', ''))) else v_old.employee_code end;
  if v_code !~ '^[A-Z0-9][A-Z0-9-]{1,29}$' then
    raise exception 'Employee ID: use 2-30 letters, numbers or dashes (e.g. ZT-001).' using errcode = '22023';
  end if;
  if v_code <> v_old.employee_code
     and exists (select 1 from public.ep_employees where employee_code = v_code and id <> p_id) then
    raise exception 'Employee ID % is already used by another employee.', v_code using errcode = '23505';
  end if;

  -- Reporting manager: must exist, be active, not the employee, and not create a loop.
  v_mgr := case when p ? 'reporting_manager_id'
                then nullif(btrim(p ->> 'reporting_manager_id'), '')::uuid
                else v_old.reporting_manager_id end;
  if p ? 'reporting_manager_id' and v_mgr is not null
     and v_mgr is distinct from v_old.reporting_manager_id then
    if v_mgr = p_id then
      raise exception 'An employee cannot report to themselves.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.ep_employees where id = v_mgr and is_active) then
      raise exception 'Choose an active employee as reporting manager.' using errcode = '22023';
    end if;
    v_walk := v_mgr;
    while v_walk is not null and v_depth < 100 loop
      if v_walk = p_id then
        raise exception 'That would make a loop: this employee is above the chosen manager.' using errcode = '22023';
      end if;
      select reporting_manager_id into v_walk from public.ep_employees where id = v_walk;
      v_depth := v_depth + 1;
    end loop;
  end if;

  -- Typed manager name (someone who is not in the portal). A portal manager replaces it.
  v_mgr_name := case when p ? 'reporting_manager_name' then nullif(btrim(coalesce(p ->> 'reporting_manager_name', '')), '')
                     else v_old.reporting_manager_name end;
  if v_mgr is not null then
    v_mgr_name := null;
  end if;
  if length(v_mgr_name) > 120 then
    raise exception 'Manager name must be at most 120 characters.' using errcode = '22023';
  end if;

  update public.ep_employees set
    full_name            = case when p ? 'full_name' then btrim(p ->> 'full_name') else full_name end,
    department           = case when p ? 'department' then nullif(btrim(p ->> 'department'), '') else department end,
    designation          = case when p ? 'designation' then nullif(btrim(p ->> 'designation'), '') else designation end,
    employee_code        = v_code,
    reporting_manager_id = v_mgr,
    reporting_manager_name = v_mgr_name,
    date_of_joining      = case when p ? 'date_of_joining' then nullif(btrim(p ->> 'date_of_joining'), '')::date else date_of_joining end,
    employment_type      = case when p ? 'employment_type' then nullif(btrim(p ->> 'employment_type'), '') else employment_type end,
    work_location        = case when p ? 'work_location' then nullif(btrim(p ->> 'work_location'), '') else work_location end,
    updated_at           = now()
  where id = p_id
  returning * into v_new;

  if v_new.employee_code is distinct from v_old.employee_code then
    perform public.ep_notify(
      p_id, 'message', 'Your Employee ID was changed',
      'Your Employee ID is now ' || v_new.employee_code || ' (was ' || v_old.employee_code
        || '). You still sign in with the same email and password.',
      '/employee/profile');
  end if;

  -- Tell the people concerned when the reporting line changes.
  if v_new.reporting_manager_id is distinct from v_old.reporting_manager_id then
    if v_new.reporting_manager_id is not null then
      perform public.ep_notify(
        p_id, 'message', 'Your reporting manager was updated',
        'You now report to ' || (select full_name from public.ep_employees where id = v_new.reporting_manager_id) || '.',
        '/employee/profile');
      perform public.ep_notify(
        v_new.reporting_manager_id, 'message', v_new.full_name || ' now reports to you',
        v_new.full_name || ' (' || v_new.employee_code || ') was added to your team by the admin.',
        null);
    elsif v_new.reporting_manager_name is null then
      perform public.ep_notify(
        p_id, 'message', 'Your reporting manager was removed',
        'No reporting manager is set for you right now.', '/employee/profile');
    end if;
  end if;

  -- A typed (non-portal) manager set or changed: tell the employee.
  if v_new.reporting_manager_id is null and v_new.reporting_manager_name is not null
     and v_new.reporting_manager_name is distinct from v_old.reporting_manager_name then
    perform public.ep_notify(
      p_id, 'message', 'Your reporting manager was updated',
      'You now report to ' || v_new.reporting_manager_name || '.', '/employee/profile');
  end if;

  return public.ep_admin_employee(p_id);
end $function$;

-- public.ep_message_options
CREATE OR REPLACE FUNCTION public.ep_message_options()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_admin boolean := public.rbac_can('portal.notifications');
  v_emp   uuid    := public.ep_current_employee_id();
begin
  if not v_admin and v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'can_all',  v_admin,
    'can_team', v_emp is not null and exists (select 1 from public.ep_employees where reporting_manager_id = v_emp and is_active),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
                                          'designation', e.designation, 'department', e.department,
                                          'is_my_team', e.reporting_manager_id is not distinct from v_emp and v_emp is not null)
             order by e.full_name)
      from public.ep_employees e where e.is_active and e.id is distinct from v_emp), '[]'::jsonb));
end $function$;

-- public.ep_sent_messages
CREATE OR REPLACE FUNCTION public.ep_sent_messages()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null or (not public.rbac_can('portal.notifications') and public.ep_current_employee_id() is null) then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(m.j order by m.created_at desc)
    from (
      select min(n.created_at) as created_at,
             jsonb_build_object(
               'message_id', n.message_id, 'title', min(n.title), 'body', min(n.body), 'priority', min(n.priority),
               'created_at', min(n.created_at), 'recipients', count(*), 'read', count(n.read_at),
               'to', (array_agg(e.full_name order by e.full_name))[1:5]) as j
      from public.ep_notifications n join public.ep_employees e on e.id = n.employee_id
      where n.sender_user_id = auth.uid() and n.message_id is not null
        and n.created_at > now() - interval '90 days'
      group by n.message_id
      order by min(n.created_at) desc
      limit 100) m), '[]'::jsonb);
end $function$;

-- public.ep_send_message
CREATE OR REPLACE FUNCTION public.ep_send_message(p_audience text, p_to uuid[], p_title text, p_body text, p_priority text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_admin  boolean := public.rbac_can('portal.notifications');
  v_emp    uuid    := public.ep_current_employee_id();
  v_label  text;
  v_msg    uuid    := gen_random_uuid();
  v_title  text    := btrim(coalesce(p_title, ''));
  v_body   text    := nullif(btrim(coalesce(p_body, '')), '');
  v_n      integer;
begin
  if not v_admin and v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if length(v_title) not between 1 and 150 then
    raise exception 'Subject must be 1 to 150 characters.' using errcode = '22023';
  end if;
  if coalesce(length(v_body), 0) > 2000 then
    raise exception 'Message must be at most 2000 characters.' using errcode = '22023';
  end if;
  if coalesce(p_priority, '') not in ('normal', 'urgent') then
    raise exception 'Invalid priority.' using errcode = '22023';
  end if;
  if p_audience = 'all' and not v_admin then
    raise exception 'Only an admin can message everyone.' using errcode = '42501';
  end if;
  if p_audience = 'team' and (v_emp is null
       or not exists (select 1 from public.ep_employees where reporting_manager_id = v_emp and is_active)) then
    raise exception 'You do not have a team to message.' using errcode = '42501';
  end if;
  if p_audience = 'people' and (p_to is null or cardinality(p_to) = 0) then
    raise exception 'Choose at least one person.' using errcode = '22023';
  end if;
  if p_audience = 'people' and cardinality(p_to) > 100 then
    raise exception 'Choose at most 100 people.' using errcode = '22023';
  end if;
  if p_audience not in ('people', 'team', 'all') then
    raise exception 'Invalid audience.' using errcode = '22023';
  end if;
  if not v_admin and p_audience = 'team' and not public.rbac_can('team.messages') then -- rbac
    raise exception 'You do not have permission to message your team.' using errcode = '42501';
  end if;
  if not v_admin and p_audience = 'people' and not public.rbac_can('emp.messages') then -- rbac
    raise exception 'You do not have permission to send messages.' using errcode = '42501';
  end if;

  -- The sender's own employee name when they are an employee, else "Admin".
  select coalesce((select full_name from public.ep_employees where id = v_emp), 'Admin') into v_label;
  if v_admin and v_emp is null then
    v_label := 'Admin';
  end if;

  insert into public.ep_notifications
    (employee_id, kind, priority, title, body, sender_employee_id, sender_user_id, sender_label, message_id)
  select e.id, 'message', p_priority, v_title, v_body, v_emp, auth.uid(), v_label, v_msg
    from public.ep_employees e
   where e.is_active
     and e.id is distinct from v_emp
     and case p_audience
           when 'all'    then true
           when 'team'   then e.reporting_manager_id = v_emp
           else e.id = any (p_to)
         end;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'None of the chosen people can receive messages.' using errcode = '22023';
  end if;
  return jsonb_build_object('message_id', v_msg, 'recipients', v_n);
end $function$;

-- public.ep_punch_in
CREATE OR REPLACE FUNCTION public.ep_punch_in()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp uuid;
  v_row public.ep_attendance;
begin
  perform public.rbac_require('emp.attendance'); -- rbac
  select id into v_emp from public.ep_employees where user_id = auth.uid() and is_active;
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_emp::text, 0));
  perform public.ep_close_overdue_sessions(v_emp);
  if exists (select 1 from public.ep_attendance where employee_id = v_emp and punch_out_at is null) then
    raise exception 'You are already punched in.' using errcode = 'P0001';
  end if;
  insert into public.ep_attendance (employee_id) values (v_emp) returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'punch_in_at', v_row.punch_in_at, 'work_date', v_row.work_date);
end $function$;

-- public.ep_punch_out
CREATE OR REPLACE FUNCTION public.ep_punch_out()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp uuid;
  v_row public.ep_attendance;
begin
  perform public.rbac_require('emp.attendance'); -- rbac
  select id into v_emp from public.ep_employees where user_id = auth.uid() and is_active;
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_emp::text, 0));
  -- Already past the cut-off: keep the automatic punch out time (not now()).
  -- No exception here, it would roll the automatic punch out back.
  if public.ep_close_overdue_sessions(v_emp) > 0 then
    select * into v_row from public.ep_attendance
     where employee_id = v_emp and auto_punched_out order by punch_out_at desc limit 1;
    return jsonb_build_object('id', v_row.id, 'punch_in_at', v_row.punch_in_at, 'punch_out_at', v_row.punch_out_at,
                              'auto_punched_out', true);
  end if;
  update public.ep_attendance
     set punch_out_at = now()
   where employee_id = v_emp and punch_out_at is null
  returning * into v_row;
  if v_row.id is null then
    raise exception 'You are not punched in.' using errcode = 'P0001';
  end if;
  return jsonb_build_object('id', v_row.id, 'punch_in_at', v_row.punch_in_at, 'punch_out_at', v_row.punch_out_at);
end $function$;

-- public.ep_request_correction
CREATE OR REPLACE FUNCTION public.ep_request_correction(p_date date, p_attendance uuid, p_in timestamp with time zone, p_out timestamp with time zone, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp uuid := public.ep_current_employee_id();
  v_chk record;
  v_att public.ep_attendance;
  v_row public.ep_attendance_corrections;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform public.rbac_require('emp.attendance'); -- rbac
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if length(v_reason) not between 1 and 500 then
    raise exception 'Write a reason (up to 500 characters).' using errcode = '22023';
  end if;
  if exists (select 1 from public.ep_attendance_corrections
              where employee_id = v_emp and work_date = p_date and status = 'pending') then
    raise exception 'You already have a pending correction for this day.' using errcode = '23505';
  end if;
  select * into v_chk from public.ep_correction_check(v_emp, p_date, p_attendance, p_in, p_out);
  if p_attendance is not null then
    select * into v_att from public.ep_attendance where id = p_attendance;
  end if;
  insert into public.ep_attendance_corrections
    (employee_id, work_date, attendance_id, requested_in, requested_out, old_in, old_out, reason)
  values (v_emp, p_date, p_attendance,
          case when p_attendance is null or p_in is distinct from v_att.punch_in_at then p_in end,
          case when p_attendance is null or p_out is distinct from v_att.punch_out_at then p_out end,
          v_att.punch_in_at, v_att.punch_out_at, v_reason)
  returning * into v_row;
  if v_row.requested_in is null and v_row.requested_out is null then
    raise exception 'The times are the same as now — nothing to correct.' using errcode = '22023';
  end if;
  return public.ep_correction_json(v_row);
end $function$;

-- public.ep_apply_leave
CREATE OR REPLACE FUNCTION public.ep_apply_leave(p_type text, p_start date, p_end date, p_half text, p_reason text, p_manager_id uuid, p_manager_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp     uuid := public.ep_current_employee_id();
  v_today   date := (timezone('Asia/Kolkata', now()))::date;
  v_name    text;
  v_type    public.ep_leave_types;
  v_days    numeric;
  v_allowed numeric;
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_half    text := nullif(p_half, '');
  v_mgr     uuid := p_manager_id;
  v_mgrname text := nullif(btrim(coalesce(p_manager_name, '')), '');
  v_row     public.ep_leave_requests;
  v_rev     uuid;
begin
  perform public.rbac_require('emp.leave'); -- rbac
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  select * into v_type from public.ep_leave_types where code = p_type and is_active;
  if v_type.code is null then
    raise exception 'Choose a leave type.' using errcode = '22023';
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'Choose a valid start and end date.' using errcode = '22023';
  end if;
  if extract(year from p_start) <> extract(year from p_end) then
    raise exception 'A leave request cannot cross into the next year. Apply for each year separately.' using errcode = '22023';
  end if;
  if p_start < v_today - 30 or p_end > v_today + 365 then
    raise exception 'Leave can start at most 30 days ago and end at most one year ahead.' using errcode = '22023';
  end if;
  if v_half is not null and (v_half not in ('first_half', 'second_half') or p_start <> p_end) then
    raise exception 'A half day must be a single date.' using errcode = '22023';
  end if;
  if length(v_reason) not between 1 and 1000 then
    raise exception 'Write a reason (up to 1000 characters).' using errcode = '22023';
  end if;

  -- Reporting manager: a picked colleague (must be active, not yourself) and/or a typed name.
  if v_mgr is not null then
    select full_name into v_mgrname from public.ep_employees where id = v_mgr and is_active and id <> v_emp;
    if v_mgrname is null then
      raise exception 'Choose a valid reporting manager.' using errcode = '22023';
    end if;
  end if;
  if v_mgrname is null then
    raise exception 'Enter your reporting manager.' using errcode = '22023';
  end if;
  if length(v_mgrname) > 120 then
    raise exception 'Reporting manager name must be at most 120 characters.' using errcode = '22023';
  end if;

  select full_name into v_name from public.ep_employees where id = v_emp;

  perform pg_advisory_xact_lock(hashtextextended('leave' || v_emp::text, 0));

  v_days := public.ep_leave_day_count(p_start, p_end, v_half);
  if v_days = 0 then
    raise exception 'These dates are only Sundays or company holidays, so no leave is needed.' using errcode = '22023';
  end if;
  if exists (select 1 from public.ep_leave_requests r
              where r.employee_id = v_emp and r.status in ('manager_review', 'pending', 'manager_pending', 'approved')
                and r.start_date <= p_end and r.end_date >= p_start
                and not (r.start_date = r.end_date and p_start = p_end and r.half_day is not null and v_half is not null
                         and r.half_day <> v_half)) then
    raise exception 'You already have leave on some of these dates.' using errcode = '22023';
  end if;
  v_allowed := public.ep_leave_allowance(v_emp, extract(year from p_start)::int, p_type);
  if v_type.is_paid and v_allowed is not null
     and public.ep_leave_taken(v_emp, extract(year from p_start)::int, p_type) + v_days > v_allowed then
    raise exception 'Not enough % balance: % day(s) left, % requested.', v_type.name,
      greatest(v_allowed - public.ep_leave_taken(v_emp, extract(year from p_start)::int, p_type), 0), v_days
      using errcode = '22023';
  end if;

  -- Who reviews first: the profile's reporting manager (active portal account), else the colleague
  -- picked on the form. With a reviewing manager the request starts with them (manager_review);
  -- without one it goes straight to the admin (pending).
  select m.id into v_rev
    from public.ep_employees e join public.ep_employees m on m.id = e.reporting_manager_id
   where e.id = v_emp and m.is_active and m.id <> v_emp
     and public.rbac_user_can(m.user_id, 'team.leave');
  if v_rev is null and v_mgr is not null
     and public.rbac_user_can((select user_id from public.ep_employees where id = v_mgr), 'team.leave') then
    v_rev := v_mgr;
  end if;

  insert into public.ep_leave_requests
    (employee_id, leave_type, start_date, end_date, half_day, days, reason, approver_id, approver_name, status)
  values (v_emp, p_type, p_start, p_end, v_half, v_days, v_reason, coalesce(v_rev, v_mgr), v_mgrname,
          case when v_rev is not null then 'manager_review' else 'pending' end)
  returning * into v_row;

  -- Only a colleague in the portal can be notified.
  perform public.ep_notify(v_rev, 'leave',
    v_name || ' applied for ' || v_type.name || ' — please review',
    to_char(p_start, 'DD Mon') || case when p_end <> p_start then ' – ' || to_char(p_end, 'DD Mon YYYY') else to_char(p_start, ' YYYY') end
      || ' · ' || v_days || ' day(s) · ' || left(v_reason, 200)
      || ' · review it and send it to the admin (or reject it) in Team requests.',
    '/employee/leave/team');
  return public.ep_leave_json(v_row);
end $function$;

-- public.ep_cancel_leave
CREATE OR REPLACE FUNCTION public.ep_cancel_leave(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp   uuid := public.ep_current_employee_id();
  v_row   public.ep_leave_requests;
  v_name  text;
begin
  perform public.rbac_require('emp.leave'); -- rbac
  select * into v_row from public.ep_leave_requests where id = p_id and employee_id = v_emp for update;
  if v_emp is null or v_row.id is null then
    raise exception 'Leave request not found.' using errcode = '42501';
  end if;
  -- Once the admin has approved or rejected it, the employee can no longer cancel it.
  if v_row.status = 'manager_pending' then
    raise exception 'The admin already approved this leave and it is now with your reporting manager, so it can no longer be cancelled. Please contact the admin.'
      using errcode = 'P0001';
  end if;
  if v_row.status not in ('manager_review', 'pending') then
    raise exception 'This leave was already % by the admin, so it can no longer be cancelled. Please contact the admin.',
      v_row.status using errcode = 'P0001';
  end if;
  update public.ep_leave_requests set status = 'cancelled', updated_at = now() where id = p_id returning * into v_row;
  select full_name into v_name from public.ep_employees where id = v_emp;
  perform public.ep_notify(v_row.approver_id, 'leave',
    v_name || ' cancelled a leave request',
    to_char(v_row.start_date, 'DD Mon YYYY') || case when v_row.end_date <> v_row.start_date then ' – ' || to_char(v_row.end_date, 'DD Mon YYYY') else '' end,
    '/employee/leave');
  return public.ep_leave_json(v_row);
end $function$;

-- public.ep_save_my_report
CREATE OR REPLACE FUNCTION public.ep_save_my_report(p_date date, p_notes text, p_items jsonb, p_submit boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp    uuid := public.ep_current_employee_id();
  v_today  date := (timezone('Asia/Kolkata', now()))::date;
  v_mgr    uuid;
  v_rep    public.ep_work_reports;
  v_item   jsonb;
  v_pid    uuid;
  v_hours  numeric;
  v_total  numeric := 0;
  v_seen   uuid[] := '{}';
  v_pos    int := 0;
  v_notes  text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  perform public.rbac_require('emp.reports'); -- rbac
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if p_date is null or p_date > v_today then
    raise exception 'You cannot write a report for a future date.' using errcode = '22023';
  end if;
  if p_date < v_today - 7 then
    raise exception 'Reports can only be written for today and the last 7 days.' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Invalid report entries.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 20 then
    raise exception 'A report can have at most 20 project entries.' using errcode = '22023';
  end if;
  if coalesce(length(v_notes), 0) > 2000 then
    raise exception 'Notes must be at most 2000 characters.' using errcode = '22023';
  end if;
  if p_submit and jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one project entry before submitting.' using errcode = '22023';
  end if;

  select reporting_manager_id into v_mgr from public.ep_employees where id = v_emp;
  -- No reporting manager in the portal: the report is submitted to the admin (submitted_to stays null).

  -- Serialise saves of the same report.
  perform pg_advisory_xact_lock(hashtextextended(v_emp::text || p_date::text, 0));
  select * into v_rep from public.ep_work_reports where employee_id = v_emp and report_date = p_date;
  if v_rep.id is not null and v_rep.status in ('submitted', 'reviewed') then
    raise exception 'This report is already submitted and cannot be changed.' using errcode = 'P0001';
  end if;

  -- Validate every entry before writing anything.
  for v_item in select * from jsonb_array_elements(p_items) loop
    begin
      v_pid   := (v_item ->> 'project_id')::uuid;
      v_hours := (v_item ->> 'hours')::numeric;
    exception when others then
      raise exception 'Invalid report entries.' using errcode = '22023';
    end;
    if v_pid is null or not exists (select 1 from public.ep_project_members where project_id = v_pid and employee_id = v_emp) then
      raise exception 'You can only report on projects you are assigned to.' using errcode = '42501';
    end if;
    if v_pid = any (v_seen) then
      raise exception 'Each project can be added only once per report.' using errcode = '22023';
    end if;
    v_seen := v_seen || v_pid;
    if v_hours is null or v_hours <= 0 or v_hours > 24 or v_hours <> round(v_hours, 2) then
      raise exception 'Hours spent must be more than 0 and at most 24 for each project.' using errcode = '22023';
    end if;
    v_total := v_total + v_hours;
    if coalesce(btrim(v_item ->> 'task_updates'), '') = '' and coalesce(btrim(v_item ->> 'completed_work'), '') = ''
       and coalesce(btrim(v_item ->> 'pending_work'), '') = '' then
      raise exception 'Write what you worked on for every project you added.' using errcode = '22023';
    end if;
    if greatest(length(v_item ->> 'task_updates'), length(v_item ->> 'completed_work'), length(v_item ->> 'pending_work')) > 2000 then
      raise exception 'Each text box can have at most 2000 characters.' using errcode = '22023';
    end if;
  end loop;
  if v_total > 24 then
    raise exception 'Total hours for the day cannot be more than 24.' using errcode = '22023';
  end if;

  if v_rep.id is null then
    insert into public.ep_work_reports (employee_id, report_date, notes)
    values (v_emp, p_date, v_notes) returning * into v_rep;
  else
    update public.ep_work_reports set notes = v_notes, updated_at = now() where id = v_rep.id;
  end if;

  delete from public.ep_work_report_items where report_id = v_rep.id;
  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.ep_work_report_items (report_id, project_id, task_updates, completed_work, pending_work, hours, position)
    values (v_rep.id, (v_item ->> 'project_id')::uuid,
            nullif(btrim(coalesce(v_item ->> 'task_updates', '')), ''),
            nullif(btrim(coalesce(v_item ->> 'completed_work', '')), ''),
            nullif(btrim(coalesce(v_item ->> 'pending_work', '')), ''),
            (v_item ->> 'hours')::numeric, v_pos);
    v_pos := v_pos + 1;
  end loop;

  if p_submit then
    update public.ep_work_reports
       set status = 'submitted', submitted_to = v_mgr, submitted_at = now(), updated_at = now(),
           reviewed_by = null, reviewed_at = null, review_comment = null
     where id = v_rep.id;
  end if;

  return public.ep_my_report(p_date);
end $function$;

-- public.ep_add_task
CREATE OR REPLACE FUNCTION public.ep_add_task(p_project uuid, p_title text, p_description text, p_assignee uuid, p_due_date date, p_priority text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp uuid := public.ep_current_employee_id();
  v_id  uuid;
begin
  perform public.rbac_require('emp.projects'); -- rbac
  if v_emp is null or not exists (select 1 from public.ep_project_members where project_id = p_project and employee_id = v_emp) then
    raise exception 'You are not on this project.' using errcode = '42501';
  end if;
  if p_assignee is not null and not exists (select 1 from public.ep_project_members where project_id = p_project and employee_id = p_assignee) then
    raise exception 'The assignee must be on the project team.' using errcode = '22023';
  end if;
  insert into public.ep_project_tasks (project_id, title, description, assignee_id, due_date, priority, created_by)
  values (p_project, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), p_assignee, p_due_date,
          coalesce(nullif(p_priority, ''), 'medium'), v_emp)
  returning id into v_id;
  return v_id;
end $function$;

-- public.ep_set_task_status
CREATE OR REPLACE FUNCTION public.ep_set_task_status(p_task uuid, p_status text, p_delay_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp    uuid := public.ep_current_employee_id();
  v_task   public.ep_project_tasks;
  v_today  date := (timezone('Asia/Kolkata', now()))::date;
  v_reason text := nullif(btrim(coalesce(p_delay_reason, '')), '');
begin
  perform public.rbac_require('emp.projects'); -- rbac
  select * into v_task from public.ep_project_tasks where id = p_task;
  if v_emp is null or v_task.id is null
     or not exists (select 1 from public.ep_project_members where project_id = v_task.project_id and employee_id = v_emp) then
    raise exception 'You are not on this project.' using errcode = '42501';
  end if;
  if coalesce(length(v_reason), 0) > 1000 then
    raise exception 'The reason must be at most 1000 characters.' using errcode = '22023';
  end if;
  if p_status = 'done' and v_task.status <> 'done' and v_task.due_date < v_today
     and v_task.delay_reason is null and v_reason is null then
    raise exception 'This task is past its deadline (%). Write why it is late to mark it done.',
      to_char(v_task.due_date, 'DD Mon YYYY') using errcode = 'P0001', hint = 'delay_reason_required';
  end if;
  update public.ep_project_tasks
     set status = p_status,
         updated_at = now(),
         completed_at = case when p_status = 'done' then coalesce(completed_at, now()) else null end,
         delay_reason    = coalesce(v_reason, delay_reason),
         delay_reason_by = case when v_reason is not null then v_emp else delay_reason_by end,
         delay_reason_at = case when v_reason is not null then now() else delay_reason_at end
   where id = p_task;
end $function$;

-- public.ep_post_update
CREATE OR REPLACE FUNCTION public.ep_post_update(p_project uuid, p_body text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp uuid := public.ep_current_employee_id();
  v_id  uuid;
begin
  perform public.rbac_require('emp.projects'); -- rbac
  if v_emp is null or not exists (select 1 from public.ep_project_members where project_id = p_project and employee_id = v_emp) then
    raise exception 'You are not on this project.' using errcode = '42501';
  end if;
  insert into public.ep_project_updates (project_id, author_id, body)
  values (p_project, v_emp, btrim(p_body))
  returning id into v_id;
  return v_id;
end $function$;

-- public.ep_set_task_delay_reason
CREATE OR REPLACE FUNCTION public.ep_set_task_delay_reason(p_task uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp    uuid := public.ep_current_employee_id();
  v_task   public.ep_project_tasks;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform public.rbac_require('emp.projects'); -- rbac
  select * into v_task from public.ep_project_tasks where id = p_task;
  if v_emp is null or v_task.id is null
     or not exists (select 1 from public.ep_project_members where project_id = v_task.project_id and employee_id = v_emp) then
    raise exception 'You are not on this project.' using errcode = '42501';
  end if;
  if length(v_reason) not between 1 and 1000 then
    raise exception 'Write the reason (up to 1000 characters).' using errcode = '22023';
  end if;
  if v_task.due_date is null
     or v_task.due_date >= coalesce((timezone('Asia/Kolkata', v_task.completed_at))::date,
                                    (timezone('Asia/Kolkata', now()))::date) then
    raise exception 'This task is not late.' using errcode = 'P0001';
  end if;
  update public.ep_project_tasks
     set delay_reason = v_reason, delay_reason_by = v_emp, delay_reason_at = now(), updated_at = now()
   where id = p_task;
end $function$;

-- public.ep_set_project_delay_reason
CREATE OR REPLACE FUNCTION public.ep_set_project_delay_reason(p_project uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp    uuid := public.ep_current_employee_id();
  v_proj   public.pt_projects;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_today  date := (timezone('Asia/Kolkata', now()))::date;
begin
  perform public.rbac_require('emp.projects'); -- rbac
  if v_emp is null or not exists (select 1 from public.ep_project_members where project_id = p_project and employee_id = v_emp) then
    raise exception 'You are not on this project.' using errcode = '42501';
  end if;
  if length(v_reason) not between 1 and 1000 then
    raise exception 'Write the reason (up to 1000 characters).' using errcode = '22023';
  end if;
  select * into v_proj from public.pt_projects where id = p_project;
  if v_proj.end_date is null
     or not coalesce((v_proj.end_date < v_today and public.ep_project_is_running(v_proj.status))
                     or v_proj.completed_date > v_proj.end_date, false) then
    raise exception 'This project has not missed its deadline.' using errcode = 'P0001';
  end if;
  insert into public.ep_project_delay_reasons (project_id, employee_id, deadline, reason)
  values (p_project, v_emp, v_proj.end_date, v_reason)
  on conflict (project_id, employee_id, deadline) do update set reason = excluded.reason, updated_at = now();
end $function$;

-- public.ep_add_my_document
CREATE OR REPLACE FUNCTION public.ep_add_my_document(p_category text, p_title text, p_path text, p_name text, p_size bigint, p_mime text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp uuid := public.ep_current_employee_id();
  v_id  uuid;
begin
  perform public.rbac_require('emp.documents'); -- rbac
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if p_path is null or p_path not like v_emp::text || '/%' then
    raise exception 'Invalid file location.' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'ep-documents' and name = p_path) then
    raise exception 'The file was not uploaded.' using errcode = 'P0002';
  end if;
  if (select count(*) from public.ep_employee_documents where employee_id = v_emp) >= 50 then
    raise exception 'You can keep up to 50 documents. Delete one first.' using errcode = '22023';
  end if;
  insert into public.ep_employee_documents (employee_id, category, title, storage_path, file_name, file_size, mime_type)
  values (v_emp, p_category, left(btrim(coalesce(nullif(btrim(p_title), ''), p_name)), 120),
          p_path, left(btrim(p_name), 255), p_size, p_mime)
  returning id into v_id;
  return v_id;
end $function$;

-- public.ep_delete_my_document
CREATE OR REPLACE FUNCTION public.ep_delete_my_document(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp  uuid := public.ep_current_employee_id();
  v_path text;
begin
  perform public.rbac_require('emp.documents'); -- rbac
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  delete from public.ep_employee_documents where id = p_id and employee_id = v_emp returning storage_path into v_path;
  if v_path is null then
    raise exception 'Document not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('old_path', v_path);
end $function$;

-- public.ep_decide_leave
CREATE OR REPLACE FUNCTION public.ep_decide_leave(p_id uuid, p_action text, p_comment text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp     uuid := public.ep_current_employee_id();
  v_row     public.ep_leave_requests;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_allowed numeric;
  v_type    public.ep_leave_types;
  v_me      text;
  v_what    text;
begin
  perform public.rbac_require('team.leave'); -- rbac
  select r.* into v_row from public.ep_leave_requests r join public.ep_employees e on e.id = r.employee_id
   where r.id = p_id and (r.approver_id = v_emp or e.reporting_manager_id = v_emp) and r.employee_id <> v_emp
   for update of r;
  if v_emp is null or v_row.id is null then
    raise exception 'Leave request not found.' using errcode = '42501';
  end if;
  if v_row.status = 'pending' then
    raise exception 'This request is with the admin now.' using errcode = 'P0001';
  end if;
  if v_row.status not in ('manager_review', 'manager_pending') then
    raise exception 'This request was already %.', v_row.status using errcode = 'P0001';
  end if;
  if v_row.status = 'manager_review' and p_action not in ('forward', 'rejected') then
    raise exception 'Send it to the admin or reject it.' using errcode = '22023';
  end if;
  if v_row.status = 'manager_pending' and p_action not in ('approved', 'rejected') then
    raise exception 'Invalid action.' using errcode = '22023';
  end if;
  if p_action = 'rejected' and v_comment is null then
    raise exception 'Write a reason for rejecting.' using errcode = '22023';
  end if;
  if coalesce(length(v_comment), 0) > 1000 then
    raise exception 'Comment must be at most 1000 characters.' using errcode = '22023';
  end if;
  select * into v_type from public.ep_leave_types where code = v_row.leave_type;
  select full_name into v_me from public.ep_employees where id = v_emp;
  v_what := v_type.name || ' · ' || to_char(v_row.start_date, 'DD Mon YYYY')
    || case when v_row.end_date <> v_row.start_date then ' – ' || to_char(v_row.end_date, 'DD Mon YYYY') else '' end;

  if p_action = 'forward' then
    update public.ep_leave_requests
       set status = 'pending', approver_id = v_emp, manager_reviewed_by = v_emp, manager_reviewed_at = now(),
           manager_review_comment = v_comment, updated_at = now()
     where id = p_id returning * into v_row;
    perform public.ep_notify(v_row.employee_id, 'leave',
      'Your manager sent your leave to the admin',
      v_what || ' · reviewed by ' || v_me || ' · now waiting for the admin', '/employee/leave', 'normal');
    return public.ep_leave_json(v_row);
  end if;

  if p_action = 'approved' then
    -- The balance may have changed since the admin approved; check again without this request.
    v_allowed := public.ep_leave_allowance(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type);
    if v_type.is_paid and v_allowed is not null
       and public.ep_leave_taken(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type, v_row.id)
           + v_row.days > v_allowed then
      raise exception 'Not enough % balance left to approve this.', v_type.name using errcode = '22023';
    end if;
  end if;
  update public.ep_leave_requests
     set status = p_action, decided_by = v_emp, decided_at = now(), decision_comment = v_comment,
         manager_reviewed_by = coalesce(manager_reviewed_by, v_emp),
         manager_reviewed_at = coalesce(manager_reviewed_at, now()),
         updated_at = now()
   where id = p_id returning * into v_row;
  perform public.ep_notify(v_row.employee_id, 'leave',
    'Your leave was ' || p_action,
    v_what || case when p_action = 'rejected' then coalesce(' · ' || v_comment, '') else '' end,
    '/employee/leave', case when p_action = 'rejected' then 'urgent' else 'normal' end);
  return public.ep_leave_json(v_row);
end $function$;

-- public.ep_team_reports
CREATE OR REPLACE FUNCTION public.ep_team_reports()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp   uuid := public.ep_current_employee_id();
  v_today date := (timezone('Asia/Kolkata', now()))::date;
begin
  perform public.rbac_require('team.reports'); -- rbac
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'team', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
                                          'designation', e.designation) order by e.full_name)
      from public.ep_employees e where e.reporting_manager_id = v_emp and e.is_active), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'report_date', r.report_date, 'status', r.status,
               'submitted_at', r.submitted_at, 'reviewed_at', r.reviewed_at,
               'employee', jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code),
               'projects', (select count(*) from public.ep_work_report_items i where i.report_id = r.id),
               'total_hours', coalesce((select sum(i.hours) from public.ep_work_report_items i where i.report_id = r.id), 0))
             order by (r.status = 'submitted') desc, r.report_date desc, e.full_name)
      from public.ep_work_reports r join public.ep_employees e on e.id = r.employee_id
      where r.status <> 'draft'
        and (r.submitted_to = v_emp or e.reporting_manager_id = v_emp)
        and r.report_date >= v_today - 60), '[]'::jsonb)
  );
end $function$;

-- public.ep_team_report
CREATE OR REPLACE FUNCTION public.ep_team_report(p_report uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp uuid := public.ep_current_employee_id();
begin
  perform public.rbac_require('team.reports'); -- rbac
  if v_emp is null or not exists (
       select 1 from public.ep_work_reports r join public.ep_employees e on e.id = r.employee_id
        where r.id = p_report and r.status <> 'draft'
          and (r.submitted_to = v_emp or e.reporting_manager_id = v_emp)) then
    raise exception 'Report not found.' using errcode = '42501';
  end if;
  return public.ep_report_json(p_report);
end $function$;

-- public.ep_review_report
CREATE OR REPLACE FUNCTION public.ep_review_report(p_report uuid, p_action text, p_comment text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp     uuid := public.ep_current_employee_id();
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_status  text;
begin
  perform public.rbac_require('team.reports'); -- rbac
  select r.status into v_status
    from public.ep_work_reports r join public.ep_employees e on e.id = r.employee_id
   where r.id = p_report and r.status <> 'draft'
     and (r.submitted_to = v_emp or e.reporting_manager_id = v_emp)
   for update of r;
  if v_emp is null or v_status is null then
    raise exception 'Report not found.' using errcode = '42501';
  end if;
  if v_status <> 'submitted' then
    raise exception 'Only a submitted report can be reviewed.' using errcode = 'P0001';
  end if;
  if p_action not in ('reviewed', 'returned') then
    raise exception 'Invalid action.' using errcode = '22023';
  end if;
  if p_action = 'returned' and v_comment is null then
    raise exception 'Write a comment saying what needs to change.' using errcode = '22023';
  end if;
  if coalesce(length(v_comment), 0) > 1000 then
    raise exception 'Comment must be at most 1000 characters.' using errcode = '22023';
  end if;
  update public.ep_work_reports
     set status = p_action, reviewed_by = v_emp, reviewed_at = now(), review_comment = v_comment, updated_at = now()
   where id = p_report;
  return public.ep_report_json(p_report);
end $function$;

-- public.ep_team_leave
CREATE OR REPLACE FUNCTION public.ep_team_leave()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp   uuid := public.ep_current_employee_id();
  v_today date := (timezone('Asia/Kolkata', now()))::date;
begin
  if not public.rbac_can('team.leave') then -- rbac
    return jsonb_build_object('team_size', 0, 'requests', '[]'::jsonb);
  end if;
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'team_size', (select count(*) from public.ep_employees where reporting_manager_id = v_emp and is_active),
    'requests', coalesce((
      select jsonb_agg(public.ep_leave_json(r)
               order by (r.status in ('manager_review', 'manager_pending')) desc, r.start_date desc)
      from public.ep_leave_requests r join public.ep_employees e on e.id = r.employee_id
      where r.employee_id <> v_emp
        and (r.approver_id = v_emp or e.reporting_manager_id = v_emp or r.decided_by = v_emp or r.manager_reviewed_by = v_emp)
        and (r.status in ('manager_review', 'manager_pending')
             or (r.status = 'pending' and r.manager_reviewed_by = v_emp)
             or ((r.decided_by = v_emp or r.manager_reviewed_by = v_emp) and r.end_date >= v_today - 90))), '[]'::jsonb));
end $function$;

-- pt_private.require_admin
CREATE OR REPLACE FUNCTION pt_private.require_admin()
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null or not public.rbac_can('projects.logins') then
    raise exception 'PT_NOT_ALLOWED' using errcode = 'P0001';
  end if;
end;
$function$;

-- ===================== 260_rbac_team_lead.sql =====================

update public.rbac_roles
   set name = 'Manager', description = 'Employee Portal: reviews and approves their team''s leave and reports.'
 where key = 'manager';
update public.rbac_roles set sort_order = 60 where key = 'employee';

insert into public.rbac_roles (key, name, description, area, sort_order, is_protected)
values ('team_lead', 'Team Lead', 'Employee Portal: leads a team, reviews its daily reports and messages the team.', 'portal', 50, true)
on conflict (key) do update
  set name = excluded.name, description = excluded.description, area = excluded.area,
      sort_order = excluded.sort_order, is_protected = true;

-- Default permissions only on the first install of the role (later changes are kept).
insert into public.rbac_role_permissions (role_key, permission_key)
select 'team_lead', key from public.rbac_permissions where key in ('team.reports', 'team.messages')
   and not exists (select 1 from public.rbac_role_permissions where role_key = 'team_lead');

create or replace function public.rbac_admin_set_user_roles(p_user uuid, p_roles text[])
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_new   text[] := coalesce((select array_agg(distinct r) from unnest(coalesce(p_roles, '{}')) r), '{}');
  v_old   text[];
  v_super boolean := public.rbac_user_can(auth.uid(), 'settings.users')
                     and exists (select 1 from public.rbac_user_roles where user_id = auth.uid() and role_key = 'super_admin');
  v_bad   text;
begin
  perform public.rbac_require('settings.users');
  if p_user = auth.uid() then
    raise exception 'You cannot change your own roles. Ask another Super Admin.' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'User not found.' using errcode = 'P0002';
  end if;
  select r into v_bad from unnest(v_new) r where r not in (select key from public.rbac_roles) limit 1;
  if v_bad is not null then
    raise exception 'Unknown role %.', v_bad using errcode = '22023';
  end if;
  if 'employee' = any (v_new) then
    raise exception 'Employee is given automatically to everyone with an Employee Portal account.' using errcode = '22023';
  end if;
  if (('manager' = any (v_new)) or ('team_lead' = any (v_new)))
     and not exists (select 1 from public.ep_employees where user_id = p_user) then
    raise exception 'Manager and Team Lead are for Employee Portal accounts.' using errcode = '22023';
  end if;
  select coalesce(array_agg(role_key), '{}') into v_old from public.rbac_user_roles where user_id = p_user;
  if (('super_admin' = any (v_new)) <> ('super_admin' = any (v_old))) and not v_super then
    raise exception 'Only a Super Admin can give or remove the Super Admin role.' using errcode = '42501';
  end if;
  delete from public.rbac_user_roles where user_id = p_user and role_key <> all (v_new);
  insert into public.rbac_user_roles (user_id, role_key, granted_by)
  select p_user, r, auth.uid() from unnest(v_new) r on conflict do nothing;
  if not exists (select 1 from public.rbac_user_roles where role_key = 'super_admin') then
    raise exception 'There must always be at least one Super Admin.' using errcode = '22023';
  end if;
  return to_jsonb(coalesce((select array_agg(role_key order by role_key) from public.rbac_user_roles where user_id = p_user), '{}'));
end $$;

-- ===================== 261_rbac_actions.sql =====================

do $$
begin
  if to_regclass('public.rbac_permissions') is null then
    raise exception 'Roles & permissions (migration 259) must be installed first.';
  end if;
end $$;

-- ================================================================ catalog: module + action
alter table public.rbac_permissions
  add column if not exists module text,
  add column if not exists action text,
  add column if not exists action_label text;
alter table public.rbac_permissions drop constraint if exists rbac_permissions_key_check;
alter table public.rbac_permissions add constraint rbac_permissions_key_check check (key ~ '^[a-z_.]{2,80}$');

-- Keep the module-level catalog and grants for the rollback (first run only).
insert into public.rbac_backup (kind, name, definition)
select 'catalog', 'before 261', coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb)::text
  from public.rbac_permissions p where p.key = any (array['dashboard', 'website.contacts', 'website.blog', 'website.portfolio', 'website.careers', 'website.job_applications', 'website.seo', 'projects.tracker', 'projects.logins', 'portal.dashboard', 'portal.employees', 'portal.projects', 'portal.attendance', 'portal.leave', 'portal.reports', 'portal.notifications', 'portal.inbox', 'settings.users', 'settings.roles', 'emp.attendance', 'emp.leave', 'emp.reports', 'emp.projects', 'emp.documents', 'emp.messages', 'team.leave', 'team.reports', 'team.messages'])
on conflict do nothing;
insert into public.rbac_backup (kind, name, definition)
select 'grants', 'before 261', coalesce(jsonb_agg(to_jsonb(rp)), '[]'::jsonb)::text
  from public.rbac_role_permissions rp where rp.permission_key = any (array['dashboard', 'website.contacts', 'website.blog', 'website.portfolio', 'website.careers', 'website.job_applications', 'website.seo', 'projects.tracker', 'projects.logins', 'portal.dashboard', 'portal.employees', 'portal.projects', 'portal.attendance', 'portal.leave', 'portal.reports', 'portal.notifications', 'portal.inbox', 'settings.users', 'settings.roles', 'emp.attendance', 'emp.leave', 'emp.reports', 'emp.projects', 'emp.documents', 'emp.messages', 'team.leave', 'team.reports', 'team.messages'])
on conflict do nothing;

insert into public.rbac_permissions (key, area, grp, label, description, sort_order, module, action, action_label) values
  ('dashboard.view', 'admin', 'General', 'Website dashboard', 'The admin home page with website activity.', 10, 'dashboard', 'view', 'View'),
  ('website.contacts.view', 'admin', 'Website', 'Contact submissions', 'Messages from the website contact form.', 20, 'website.contacts', 'view', 'View'),
  ('website.contacts.edit', 'admin', 'Website', 'Contact submissions', 'Messages from the website contact form.', 21, 'website.contacts', 'edit', 'Change status'),
  ('website.contacts.delete', 'admin', 'Website', 'Contact submissions', 'Messages from the website contact form.', 22, 'website.contacts', 'delete', 'Delete'),
  ('website.contacts.export', 'admin', 'Website', 'Contact submissions', 'Messages from the website contact form.', 23, 'website.contacts', 'export', 'Export CSV'),
  ('website.blog.view', 'admin', 'Website', 'Blog posts', 'Articles on the website.', 30, 'website.blog', 'view', 'View'),
  ('website.blog.create', 'admin', 'Website', 'Blog posts', 'Articles on the website.', 31, 'website.blog', 'create', 'Create'),
  ('website.blog.edit', 'admin', 'Website', 'Blog posts', 'Articles on the website.', 32, 'website.blog', 'edit', 'Edit & publish'),
  ('website.blog.delete', 'admin', 'Website', 'Blog posts', 'Articles on the website.', 33, 'website.blog', 'delete', 'Delete'),
  ('website.portfolio.view', 'admin', 'Website', 'Portfolio', 'Portfolio projects and images.', 40, 'website.portfolio', 'view', 'View'),
  ('website.portfolio.create', 'admin', 'Website', 'Portfolio', 'Portfolio projects and images.', 41, 'website.portfolio', 'create', 'Create'),
  ('website.portfolio.edit', 'admin', 'Website', 'Portfolio', 'Portfolio projects and images.', 42, 'website.portfolio', 'edit', 'Edit & publish'),
  ('website.portfolio.delete', 'admin', 'Website', 'Portfolio', 'Portfolio projects and images.', 43, 'website.portfolio', 'delete', 'Delete'),
  ('website.careers.view', 'admin', 'Hiring', 'Careers (job postings)', 'Job postings on the website.', 50, 'website.careers', 'view', 'View'),
  ('website.careers.create', 'admin', 'Hiring', 'Careers (job postings)', 'Job postings on the website.', 51, 'website.careers', 'create', 'Create'),
  ('website.careers.edit', 'admin', 'Hiring', 'Careers (job postings)', 'Job postings on the website.', 52, 'website.careers', 'edit', 'Edit & open / close'),
  ('website.careers.delete', 'admin', 'Hiring', 'Careers (job postings)', 'Job postings on the website.', 53, 'website.careers', 'delete', 'Delete'),
  ('website.job_applications.view', 'admin', 'Hiring', 'Job applications & resumes', 'Applicants for the job postings.', 60, 'website.job_applications', 'view', 'View'),
  ('website.job_applications.edit', 'admin', 'Hiring', 'Job applications & resumes', 'Applicants for the job postings.', 61, 'website.job_applications', 'edit', 'Change status & rating'),
  ('website.job_applications.download', 'admin', 'Hiring', 'Job applications & resumes', 'Applicants for the job postings.', 62, 'website.job_applications', 'download', 'Download resumes'),
  ('website.job_applications.export', 'admin', 'Hiring', 'Job applications & resumes', 'Applicants for the job postings.', 63, 'website.job_applications', 'export', 'Export CSV'),
  ('website.seo.view', 'admin', 'Growth', 'SEO & Search Console', 'SEO audit and Google Search Console.', 70, 'website.seo', 'view', 'View'),
  ('projects.tracker.view', 'admin', 'Projects', 'Project Tracker & Clients', 'Clients, projects, documents and backups.', 80, 'projects.tracker', 'view', 'View'),
  ('projects.tracker.create', 'admin', 'Projects', 'Project Tracker & Clients', 'Clients, projects, documents and backups.', 81, 'projects.tracker', 'create', 'Create'),
  ('projects.tracker.edit', 'admin', 'Projects', 'Project Tracker & Clients', 'Clients, projects, documents and backups.', 82, 'projects.tracker', 'edit', 'Edit'),
  ('projects.tracker.delete', 'admin', 'Projects', 'Project Tracker & Clients', 'Clients, projects, documents and backups.', 83, 'projects.tracker', 'delete', 'Delete'),
  ('projects.tracker.download', 'admin', 'Projects', 'Project Tracker & Clients', 'Clients, projects, documents and backups.', 84, 'projects.tracker', 'download', 'Download documents'),
  ('projects.logins.view', 'admin', 'Projects', 'Access & Logins', 'Saved logins of client projects.', 90, 'projects.logins', 'view', 'View (no passwords)'),
  ('projects.logins.create', 'admin', 'Projects', 'Access & Logins', 'Saved logins of client projects.', 91, 'projects.logins', 'create', 'Add logins'),
  ('projects.logins.edit', 'admin', 'Projects', 'Access & Logins', 'Saved logins of client projects.', 92, 'projects.logins', 'edit', 'Edit & set passwords'),
  ('projects.logins.delete', 'admin', 'Projects', 'Access & Logins', 'Saved logins of client projects.', 93, 'projects.logins', 'delete', 'Delete'),
  ('projects.logins.reveal', 'admin', 'Projects', 'Access & Logins', 'Saved logins of client projects.', 94, 'projects.logins', 'reveal', 'See & copy passwords'),
  ('projects.logins.export', 'admin', 'Projects', 'Access & Logins', 'Saved logins of client projects.', 95, 'projects.logins', 'export', 'Download Excel with passwords'),
  ('portal.dashboard.view', 'admin', 'Employee Portal', 'Employee Portal dashboard', 'Overview of employees and what needs attention.', 100, 'portal.dashboard', 'view', 'View'),
  ('portal.employees.view', 'admin', 'Employee Portal', 'Employee Management', 'Employees, profiles, documents and certificates.', 110, 'portal.employees', 'view', 'View'),
  ('portal.employees.create', 'admin', 'Employee Portal', 'Employee Management', 'Employees, profiles, documents and certificates.', 111, 'portal.employees', 'create', 'Add employees'),
  ('portal.employees.edit', 'admin', 'Employee Portal', 'Employee Management', 'Employees, profiles, documents and certificates.', 112, 'portal.employees', 'edit', 'Edit details, access & certificates'),
  ('portal.employees.download', 'admin', 'Employee Portal', 'Employee Management', 'Employees, profiles, documents and certificates.', 113, 'portal.employees', 'download', 'Download documents'),
  ('portal.projects.view', 'admin', 'Employee Portal', 'Project Management', 'Project teams, tasks and deadlines.', 120, 'portal.projects', 'view', 'View'),
  ('portal.projects.edit', 'admin', 'Employee Portal', 'Project Management', 'Project teams, tasks and deadlines.', 121, 'portal.projects', 'edit', 'Teams, tasks & deadlines'),
  ('portal.projects.delete', 'admin', 'Employee Portal', 'Project Management', 'Project teams, tasks and deadlines.', 122, 'portal.projects', 'delete', 'Delete tasks'),
  ('portal.attendance.view', 'admin', 'Employee Portal', 'Attendance Management', 'Attendance, late arrivals and corrections.', 130, 'portal.attendance', 'view', 'View'),
  ('portal.attendance.approve', 'admin', 'Employee Portal', 'Attendance Management', 'Attendance, late arrivals and corrections.', 131, 'portal.attendance', 'approve', 'Approve corrections'),
  ('portal.leave.view', 'admin', 'Employee Portal', 'Leave Management', 'Leave requests, balances and holidays.', 140, 'portal.leave', 'view', 'View'),
  ('portal.leave.approve', 'admin', 'Employee Portal', 'Leave Management', 'Leave requests, balances and holidays.', 141, 'portal.leave', 'approve', 'Approve / reject leave'),
  ('portal.leave.edit', 'admin', 'Employee Portal', 'Leave Management', 'Leave requests, balances and holidays.', 142, 'portal.leave', 'edit', 'Balances & holidays'),
  ('portal.leave.delete', 'admin', 'Employee Portal', 'Leave Management', 'Leave requests, balances and holidays.', 143, 'portal.leave', 'delete', 'Delete holidays'),
  ('portal.reports.view', 'admin', 'Employee Portal', 'Daily Work Reports', 'Employees'' daily work reports.', 150, 'portal.reports', 'view', 'View'),
  ('portal.reports.approve', 'admin', 'Employee Portal', 'Daily Work Reports', 'Employees'' daily work reports.', 151, 'portal.reports', 'approve', 'Review / send back'),
  ('portal.reports.export', 'admin', 'Employee Portal', 'Daily Work Reports', 'Employees'' daily work reports.', 152, 'portal.reports', 'export', 'Export CSV'),
  ('portal.notifications.view', 'admin', 'Employee Portal', 'Notifications Management', 'Messages to employees and reminders.', 160, 'portal.notifications', 'view', 'View'),
  ('portal.notifications.create', 'admin', 'Employee Portal', 'Notifications Management', 'Messages to employees and reminders.', 161, 'portal.notifications', 'create', 'Send messages'),
  ('portal.notifications.edit', 'admin', 'Employee Portal', 'Notifications Management', 'Messages to employees and reminders.', 162, 'portal.notifications', 'edit', 'Change reminders'),
  ('portal.notifications.delete', 'admin', 'Employee Portal', 'Notifications Management', 'Messages to employees and reminders.', 163, 'portal.notifications', 'delete', 'Delete custom reminders'),
  ('portal.inbox.view', 'admin', 'Employee Portal', 'Notifications (admin inbox)', 'What employees do in the portal.', 170, 'portal.inbox', 'view', 'View'),
  ('settings.users.view', 'admin', 'Settings', 'Users & Roles', 'Who can sign in and their roles.', 180, 'settings.users', 'view', 'View'),
  ('settings.users.create', 'admin', 'Settings', 'Users & Roles', 'Who can sign in and their roles.', 181, 'settings.users', 'create', 'Add users'),
  ('settings.users.edit', 'admin', 'Settings', 'Users & Roles', 'Who can sign in and their roles.', 182, 'settings.users', 'edit', 'Change roles'),
  ('settings.roles.view', 'admin', 'Settings', 'Roles & Permissions', 'What each role may do.', 190, 'settings.roles', 'view', 'View'),
  ('settings.roles.edit', 'admin', 'Settings', 'Roles & Permissions', 'What each role may do.', 191, 'settings.roles', 'edit', 'Change permissions'),
  ('emp.attendance.create', 'portal', 'My work', 'Attendance', 'Their own attendance.', 200, 'emp.attendance', 'create', 'Punch in / out'),
  ('emp.attendance.edit', 'portal', 'My work', 'Attendance', 'Their own attendance.', 201, 'emp.attendance', 'edit', 'Request corrections'),
  ('emp.leave.create', 'portal', 'My work', 'Leave', 'Their own leave.', 210, 'emp.leave', 'create', 'Apply'),
  ('emp.leave.delete', 'portal', 'My work', 'Leave', 'Their own leave.', 211, 'emp.leave', 'delete', 'Cancel'),
  ('emp.reports.create', 'portal', 'My work', 'Daily work report', 'Their own daily report.', 220, 'emp.reports', 'create', 'Write & submit'),
  ('emp.projects.create', 'portal', 'My work', 'My projects', 'Projects they are a member of.', 230, 'emp.projects', 'create', 'Add tasks'),
  ('emp.projects.edit', 'portal', 'My work', 'My projects', 'Projects they are a member of.', 231, 'emp.projects', 'edit', 'Task status, updates & delay reasons'),
  ('emp.documents.create', 'portal', 'My work', 'My documents', 'Their own documents.', 240, 'emp.documents', 'create', 'Upload'),
  ('emp.documents.delete', 'portal', 'My work', 'My documents', 'Their own documents.', 241, 'emp.documents', 'delete', 'Delete'),
  ('emp.messages.create', 'portal', 'My work', 'Messages', 'Messages to colleagues.', 250, 'emp.messages', 'create', 'Send messages'),
  ('team.leave.view', 'portal', 'Team', 'Team leave', 'Leave of the people who report to them.', 260, 'team.leave', 'view', 'View'),
  ('team.leave.approve', 'portal', 'Team', 'Team leave', 'Leave of the people who report to them.', 261, 'team.leave', 'approve', 'Review & approve'),
  ('team.reports.view', 'portal', 'Team', 'Team daily reports', 'Daily reports of their team.', 270, 'team.reports', 'view', 'View'),
  ('team.reports.approve', 'portal', 'Team', 'Team daily reports', 'Daily reports of their team.', 271, 'team.reports', 'approve', 'Review'),
  ('team.messages.create', 'portal', 'Team', 'Team messages', 'Messages to their whole team.', 280, 'team.messages', 'create', 'Message the team')
on conflict (key) do update
  set area = excluded.area, grp = excluded.grp, label = excluded.label, description = excluded.description,
      sort_order = excluded.sort_order, module = excluded.module, action = excluded.action, action_label = excluded.action_label;

-- A role that had a module now has every action of that module; then the module-level rows go.
insert into public.rbac_role_permissions (role_key, permission_key)
select rp.role_key, p.key
  from public.rbac_role_permissions rp join public.rbac_permissions p on p.module = rp.permission_key
on conflict do nothing;
delete from public.rbac_permissions where key = any (array['dashboard', 'website.contacts', 'website.blog', 'website.portfolio', 'website.careers', 'website.job_applications', 'website.seo', 'projects.tracker', 'projects.logins', 'portal.dashboard', 'portal.employees', 'portal.projects', 'portal.attendance', 'portal.leave', 'portal.reports', 'portal.notifications', 'portal.inbox', 'settings.users', 'settings.roles', 'emp.attendance', 'emp.leave', 'emp.reports', 'emp.projects', 'emp.documents', 'emp.messages', 'team.leave', 'team.reports', 'team.messages']);

-- Clear messages: "You do not have permission for this (Blog posts: Delete)."
create or replace function public.rbac_require(p_key text)
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.rbac_can(p_key) then
    raise exception 'You do not have permission for this (%).',
      coalesce((select label || ': ' || coalesce(action_label, action) from public.rbac_permissions where key = p_key), p_key)
      using errcode = '42501';
  end if;
end $$;

-- ================================================================ security policies: module -> action
-- SELECT -> view (download for the file buckets resumes / pt-project-documents / ep-documents /
-- ep-certificates), INSERT -> create (files: create or edit), UPDATE -> edit, DELETE -> delete
-- (edit when the module has no delete). A policy FOR ALL is replaced by one policy per command.
-- Policies that already check an action are left alone, so this can run again.
do $$
declare
  p        record;
  v_both   text;
  v_mod    text;
  v_bucket text;
  v_cmds   text[];
  v_cmd    text;
  v_expr   text;
  v_q      text;
  v_c      text;
  v_name   text;
  v_roles  text;
  v_done   int := 0;
  v_split  int := 0;
begin
  for p in
    select schemaname, tablename, policyname, cmd, permissive, roles, qual, with_check
      from pg_policies
     where (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ 'rbac_can\(''[a-z_.]+''(::text)?\)'
  loop
    v_both := coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '');
    v_mod := substring(v_both from 'rbac_can\(''([a-z_.]+)''');
    if not (v_mod = any (array['dashboard', 'website.contacts', 'website.blog', 'website.portfolio', 'website.careers', 'website.job_applications', 'website.seo', 'projects.tracker', 'projects.logins', 'portal.dashboard', 'portal.employees', 'portal.projects', 'portal.attendance', 'portal.leave', 'portal.reports', 'portal.notifications', 'portal.inbox', 'settings.users', 'settings.roles', 'emp.attendance', 'emp.leave', 'emp.reports', 'emp.projects', 'emp.documents', 'emp.messages', 'team.leave', 'team.reports', 'team.messages'])) then
      continue; -- already an action (or not ours)
    end if;
    v_bucket := substring(v_both from 'bucket_id = ''([a-z0-9-]+)''');
    insert into public.rbac_backup (kind, name, definition)
    values ('policy261', p.schemaname || '.' || p.tablename || '.' || p.policyname,
            jsonb_build_object('schema', p.schemaname, 'table', p.tablename, 'policy', p.policyname, 'cmd', p.cmd,
                               'permissive', p.permissive, 'roles', to_jsonb(p.roles), 'qual', p.qual,
                               'with_check', p.with_check)::text)
    on conflict do nothing;

    v_cmds := case when p.cmd = 'ALL' then array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] else array[p.cmd] end;
    foreach v_cmd in array v_cmds loop
      v_expr := case v_cmd
        when 'SELECT' then format('public.rbac_can(%L)', v_mod || case
                             when v_bucket in ('resumes', 'pt-project-documents', 'ep-documents', 'ep-certificates')
                                  and exists (select 1 from public.rbac_permissions where key = v_mod || '.download')
                             then '.download' else '.view' end)
        when 'INSERT' then (select string_agg(format('public.rbac_can(%L)', key), ' or ' order by key)
                              from public.rbac_permissions
                             where key in (v_mod || '.create', v_mod || '.edit')
                               and (v_bucket is not null or key = v_mod || '.create'
                                    or not exists (select 1 from public.rbac_permissions where key = v_mod || '.create')))
        when 'UPDATE' then format('public.rbac_can(%L)', v_mod || '.edit')
        when 'DELETE' then format('public.rbac_can(%L)', v_mod || case
                             when exists (select 1 from public.rbac_permissions where key = v_mod || '.delete')
                             then '.delete' else '.edit' end)
      end;
      v_expr := '(' || coalesce(v_expr, format('public.rbac_can(%L)', v_mod || '.edit')) || ')';
      v_q := regexp_replace(p.qual, 'public\.rbac_can\(''[a-z_.]+''(::text)?\)|rbac_can\(''[a-z_.]+''(::text)?\)', v_expr, 'g');
      v_c := regexp_replace(coalesce(p.with_check, case when v_cmd in ('INSERT', 'UPDATE') then p.qual end),
                            'public\.rbac_can\(''[a-z_.]+''(::text)?\)|rbac_can\(''[a-z_.]+''(::text)?\)', v_expr, 'g');
      if p.cmd <> 'ALL' then
        execute format('alter policy %I on %I.%I%s%s', p.policyname, p.schemaname, p.tablename,
                       case when p.qual is not null then ' using (' || v_q || ')' else '' end,
                       case when p.with_check is not null then ' with check (' || v_c || ')' else '' end);
      else
        v_name := left(p.policyname, 50) || ' (' || lower(v_cmd) || ')';
        select string_agg(case when r = 'public' then 'public' else quote_ident(r) end, ', ') into v_roles from unnest(p.roles) r;
        execute format('drop policy if exists %I on %I.%I', v_name, p.schemaname, p.tablename);
        execute format('create policy %I on %I.%I as %s for %s to %s%s%s', v_name, p.schemaname, p.tablename,
                       lower(p.permissive), lower(v_cmd), v_roles,
                       case when v_cmd <> 'INSERT' and v_q is not null then ' using (' || v_q || ')' else '' end,
                       case when v_cmd in ('INSERT', 'UPDATE') and v_c is not null then ' with check (' || v_c || ')' else '' end);
      end if;
    end loop;
    if p.cmd = 'ALL' then
      execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
      v_split := v_split + 1;
    end if;
    v_done := v_done + 1;
  end loop;
  raise notice 'rbac: % policies now check actions (% "all commands" policies split per command)', v_done, v_split;
end $$;

-- ================================================================ functions: module checks -> action checks

-- pt_private.require_admin
CREATE OR REPLACE FUNCTION pt_private.require_admin()
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null or not public.rbac_can('projects.logins.view') then
    raise exception 'PT_NOT_ALLOWED' using errcode = 'P0001';
  end if;
end;
$function$;

-- public.ep_add_my_document
CREATE OR REPLACE FUNCTION public.ep_add_my_document(p_category text, p_title text, p_path text, p_name text, p_size bigint, p_mime text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp uuid := public.ep_current_employee_id();
  v_id  uuid;
begin
  perform public.rbac_require('emp.documents.create'); -- rbac
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if p_path is null or p_path not like v_emp::text || '/%' then
    raise exception 'Invalid file location.' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'ep-documents' and name = p_path) then
    raise exception 'The file was not uploaded.' using errcode = 'P0002';
  end if;
  if (select count(*) from public.ep_employee_documents where employee_id = v_emp) >= 50 then
    raise exception 'You can keep up to 50 documents. Delete one first.' using errcode = '22023';
  end if;
  insert into public.ep_employee_documents (employee_id, category, title, storage_path, file_name, file_size, mime_type)
  values (v_emp, p_category, left(btrim(coalesce(nullif(btrim(p_title), ''), p_name)), 120),
          p_path, left(btrim(p_name), 255), p_size, p_mime)
  returning id into v_id;
  return v_id;
end $function$;

-- public.ep_add_task
CREATE OR REPLACE FUNCTION public.ep_add_task(p_project uuid, p_title text, p_description text, p_assignee uuid, p_due_date date, p_priority text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp uuid := public.ep_current_employee_id();
  v_id  uuid;
begin
  perform public.rbac_require('emp.projects.create'); -- rbac
  if v_emp is null or not exists (select 1 from public.ep_project_members where project_id = p_project and employee_id = v_emp) then
    raise exception 'You are not on this project.' using errcode = '42501';
  end if;
  if p_assignee is not null and not exists (select 1 from public.ep_project_members where project_id = p_project and employee_id = p_assignee) then
    raise exception 'The assignee must be on the project team.' using errcode = '22023';
  end if;
  insert into public.ep_project_tasks (project_id, title, description, assignee_id, due_date, priority, created_by)
  values (p_project, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), p_assignee, p_due_date,
          coalesce(nullif(p_priority, ''), 'medium'), v_emp)
  returning id into v_id;
  return v_id;
end $function$;

-- public.ep_admin_attendance
CREATE OR REPLACE FUNCTION public.ep_admin_attendance(p_from date, p_to date, p_emp uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.attendance.view'); -- rbac
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Choose a date range of at most 62 days.' using errcode = '22023';
  end if;
  perform public.ep_close_overdue_sessions(p_emp);
  return jsonb_build_object(
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'employee_code', e.employee_code, 'full_name', e.full_name,
               'designation', e.designation, 'department', e.department, 'is_active', e.is_active,
               'start_date', (timezone('Asia/Kolkata', e.created_at))::date) order by e.full_name)
      from public.ep_employees e where p_emp is null or e.id = p_emp), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.work_date desc, x.employee_id)
      from public.ep_attendance_rows(p_from, p_to, p_emp) x), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'employee_id', a.employee_id, 'work_date', a.work_date,
               'punch_in_at', a.punch_in_at, 'punch_out_at', a.punch_out_at,
               'auto_punched_out', a.auto_punched_out, 'corrected_at', a.corrected_at) order by a.punch_in_at)
      from public.ep_attendance a
      where a.work_date between p_from and p_to and (p_emp is null or a.employee_id = p_emp)), '[]'::jsonb),
    'holidays', coalesce((
      select jsonb_agg(jsonb_build_object('date', holiday_date, 'name', name) order by holiday_date)
      from public.ep_holidays where holiday_date between p_from and p_to), '[]'::jsonb),
    'leave', coalesce((
      select jsonb_agg(jsonb_build_object('employee_id', r.employee_id, 'date', g.d::date,
                                          'type', r.leave_type, 'half_day', r.half_day) order by g.d)
      from public.ep_leave_requests r,
           generate_series(greatest(r.start_date, p_from), least(r.end_date, p_to), interval '1 day') g(d)
      where r.status = 'approved' and r.start_date <= p_to and r.end_date >= p_from
        and (p_emp is null or r.employee_id = p_emp)), '[]'::jsonb),
    'pending_corrections', (select count(*) from public.ep_attendance_corrections where status = 'pending'));
end $function$;

-- public.ep_admin_corrections
CREATE OR REPLACE FUNCTION public.ep_admin_corrections(p_status text DEFAULT 'pending'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.attendance.view'); -- rbac
  return coalesce((
    select jsonb_agg(public.ep_correction_json(c) order by c.created_at desc)
    from (select * from public.ep_attendance_corrections
           where coalesce(p_status, 'all') = 'all' or status = p_status
           order by created_at desc limit 200) c), '[]'::jsonb);
end $function$;

-- public.ep_admin_create_employee
CREATE OR REPLACE FUNCTION public.ep_admin_create_employee(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f          text;
  v_code     text := upper(btrim(coalesce(p ->> 'employee_code', '')));
  v_name     text := btrim(coalesce(p ->> 'full_name', ''));
  v_email    text := lower(btrim(coalesce(p ->> 'email', '')));
  v_password text := coalesce(p ->> 'password', '');
  v_user     uuid;
  v_linked   boolean := false;
  v_emp      uuid;
  v_work     jsonb;
begin
  perform public.rbac_require('portal.employees.create'); -- rbac
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Invalid employee data.' using errcode = '22023';
  end if;
  for f in select jsonb_object_keys(p) loop
    if f not in ('employee_code', 'full_name', 'email', 'password', 'department', 'designation',
                 'reporting_manager_id', 'reporting_manager_name', 'date_of_joining', 'employment_type', 'work_location') then
      raise exception 'Field % cannot be set here.', f using errcode = '42501';
    end if;
  end loop;

  if v_code !~ '^[A-Z0-9][A-Z0-9-]{1,29}$' then
    raise exception 'Employee ID: use 2-30 letters, numbers or dashes (e.g. ZT-001).' using errcode = '22023';
  end if;
  if length(v_name) not between 1 and 120 then
    raise exception 'Name is required (up to 120 characters).' using errcode = '22023';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'Enter a valid work email.' using errcode = '22023';
  end if;
  if exists (select 1 from public.ep_employees where employee_code = v_code) then
    raise exception 'Employee ID % is already used.', v_code using errcode = '23505';
  end if;

  -- Same email twice at the same moment: serialise.
  perform pg_advisory_xact_lock(hashtextextended('ep_create_employee:' || v_email, 0));

  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is not null then
    if exists (select 1 from public.ep_employees where user_id = v_user) then
      raise exception 'This email already belongs to an employee.' using errcode = '23505';
    end if;
    if public.ep_user_is_admin(v_user) then
      raise exception 'This email is an admin account. Use a separate email for the employee.' using errcode = '22023';
    end if;
    v_linked := true;
  else
    if public.ep_password_problem(v_password) is not null then
      raise exception 'Temporary password: %', public.ep_password_problem(v_password) using errcode = '22023';
    end if;
    v_user := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
      extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('full_name', v_name), now(), now(),
      '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    values (
      v_user::text, v_user,
      jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true),
      'email', now(), now());
  end if;

  -- A new login with a temporary password must be changed at the first sign-in.
  insert into public.ep_employees (user_id, employee_code, full_name, must_change_password)
  values (v_user, v_code, v_name, not v_linked)
  returning id into v_emp;

  -- Work details: only the keys given, with the same checks as editing.
  v_work := p - 'employee_code' - 'full_name' - 'email' - 'password';
  if v_work <> '{}'::jsonb then
    perform public.ep_admin_update_employee(v_emp, v_work);
  end if;

  perform public.ep_notify(
    v_emp, 'message', 'Welcome to the Zyllo Tech Employee Portal',
    'Your account is ready. Please complete your personal details and emergency contacts in My Profile.',
    '/employee/profile');

  return public.ep_admin_employee(v_emp) || jsonb_build_object('linked_existing_account', v_linked);
end $function$;

-- public.ep_admin_custom_reminders
CREATE OR REPLACE FUNCTION public.ep_admin_custom_reminders()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.notifications.view'); -- rbac
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'title', r.title, 'body', r.body, 'priority', r.priority,
             'audience', r.audience, 'departments', to_jsonb(r.departments), 'project_id', r.project_id,
             'project_name', (select name from public.pt_projects where id = r.project_id),
             'people', to_jsonb(r.people),
             'people_names', (select jsonb_agg(full_name order by full_name) from public.ep_employees where id = any (r.people)),
             'repeat', r.repeat, 'days', to_jsonb(r.days), 'send_date', r.send_date,
             'send_at', to_char(r.send_at, 'HH24:MI'), 'enabled', r.enabled, 'last_run', r.last_run,
             'recipients', (select count(*) from public.ep_custom_reminder_targets(r.id)))
           order by r.enabled desc, r.send_at, r.created_at)
    from public.ep_custom_reminders r), '[]'::jsonb);
end $function$;

-- public.ep_admin_decide_correction
CREATE OR REPLACE FUNCTION public.ep_admin_decide_correction(p_id uuid, p_action text, p_comment text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row public.ep_attendance_corrections;
  v_chk record;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  perform public.rbac_require('portal.attendance.approve'); -- rbac
  if p_action not in ('approved', 'rejected') then
    raise exception 'Invalid action.' using errcode = '22023';
  end if;
  if p_action = 'rejected' and v_comment is null then
    raise exception 'Write a reason for rejecting.' using errcode = '22023';
  end if;
  if coalesce(length(v_comment), 0) > 500 then
    raise exception 'Comment must be at most 500 characters.' using errcode = '22023';
  end if;
  select * into v_row from public.ep_attendance_corrections where id = p_id for update;
  if v_row.id is null then
    raise exception 'Correction request not found.' using errcode = 'P0002';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'This request was already %.', v_row.status using errcode = 'P0001';
  end if;

  if p_action = 'approved' then
    if v_row.old_in is not null and v_row.attendance_id is null then
      raise exception 'The punch session of this request no longer exists.' using errcode = 'P0002';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(v_row.employee_id::text, 0));
    -- Check again: other sessions may have changed since the request.
    select * into v_chk from public.ep_correction_check(
      v_row.employee_id, v_row.work_date, v_row.attendance_id, v_row.requested_in, v_row.requested_out);
    if v_row.attendance_id is not null then
      update public.ep_attendance
         set punch_in_at = v_chk.new_in, punch_out_at = v_chk.new_out,
             auto_punched_out = false, corrected_at = now()
       where id = v_row.attendance_id;
    else
      insert into public.ep_attendance (employee_id, work_date, punch_in_at, punch_out_at, corrected_at)
      values (v_row.employee_id, v_row.work_date, v_chk.new_in, v_chk.new_out, now());
    end if;
  end if;

  update public.ep_attendance_corrections
     set status = p_action, decided_by_admin = auth.uid(), decided_at = now(), decision_comment = v_comment
   where id = p_id returning * into v_row;

  perform public.ep_notify(v_row.employee_id, 'attendance',
    'Attendance correction ' || p_action,
    to_char(v_row.work_date, 'DD Mon YYYY') || coalesce(' · ' || v_comment, ''),
    '/employee/attendance', case when p_action = 'rejected' then 'urgent' else 'normal' end);
  return public.ep_correction_json(v_row);
end $function$;

-- public.ep_admin_decide_leave
CREATE OR REPLACE FUNCTION public.ep_admin_decide_leave(p_id uuid, p_action text, p_comment text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row      public.ep_leave_requests;
  v_comment  text := nullif(btrim(coalesce(p_comment, '')), '');
  v_allowed  numeric;
  v_type     public.ep_leave_types;
  v_mgr      uuid;
  v_what     text;
  v_emp_name text;
  v_final    boolean;
begin
  perform public.rbac_require('portal.leave.approve'); -- rbac
  select * into v_row from public.ep_leave_requests where id = p_id for update;
  if v_row.id is null then
    raise exception 'Leave request not found.' using errcode = 'P0002';
  end if;
  if v_row.status not in ('manager_review', 'pending', 'manager_pending') then
    raise exception 'This request was already %.', v_row.status using errcode = 'P0001';
  end if;
  if p_action not in ('approved', 'rejected') then
    raise exception 'Invalid action.' using errcode = '22023';
  end if;
  if p_action = 'rejected' and v_comment is null then
    raise exception 'Write a reason for rejecting.' using errcode = '22023';
  end if;
  if coalesce(length(v_comment), 0) > 1000 then
    raise exception 'Comment must be at most 1000 characters.' using errcode = '22023';
  end if;
  select * into v_type from public.ep_leave_types where code = v_row.leave_type;
  if p_action = 'approved' then
    v_allowed := public.ep_leave_allowance(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type);
    if v_type.is_paid and v_allowed is not null
       and public.ep_leave_taken(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type, v_row.id)
           + v_row.days > v_allowed then
      raise exception 'Not enough % balance left to approve this. Increase the balance or ask for Loss of Pay.', v_type.name
        using errcode = '22023';
    end if;
  end if;

  v_what := v_type.name || ' · ' || to_char(v_row.start_date, 'DD Mon YYYY')
    || case when v_row.end_date <> v_row.start_date then ' – ' || to_char(v_row.end_date, 'DD Mon YYYY') else '' end;
  select full_name into v_emp_name from public.ep_employees where id = v_row.employee_id;

  if v_row.status in ('manager_review', 'pending') and p_action = 'approved' then
    select m.id into v_mgr
      from public.ep_employees e join public.ep_employees m on m.id = e.reporting_manager_id
     where e.id = v_row.employee_id and m.is_active and m.id <> e.id
       and public.rbac_user_can(m.user_id, 'team.leave.approve');
    if v_mgr is null and v_row.approver_id is not null and v_row.approver_id <> v_row.employee_id
       and exists (select 1 from public.ep_employees where id = v_row.approver_id and is_active
                    and public.rbac_user_can(user_id, 'team.leave.approve')) then
      v_mgr := v_row.approver_id;
    end if;
  end if;

  if v_mgr is not null then
    -- Step 1 done: the admin approved; now the reporting manager decides.
    update public.ep_leave_requests
       set status = 'manager_pending', approver_id = v_mgr,
           decided_by_admin = auth.uid(), admin_decided_at = now(), admin_comment = v_comment, updated_at = now()
     where id = p_id returning * into v_row;
    perform public.ep_notify(v_row.employee_id, 'leave',
      'Admin approved your leave — waiting for your manager',
      v_what || ' · now with ' || (select full_name from public.ep_employees where id = v_mgr) || ' for the final decision'
        || coalesce(' · Admin: ' || v_comment, ''),
      '/employee/leave', 'normal');
    perform public.ep_notify(v_mgr, 'leave',
      'Admin approved ' || v_emp_name || '''s leave — please give your final approval',
      v_what || coalesce(' · Admin: ' || v_comment, '') || ' · Approve or reject it in Team requests.',
      '/employee/leave/team', 'normal');
  else
    -- Final decision by the admin: reject; approve with no portal manager; or deciding instead of the manager.
    v_final := v_row.status = 'manager_pending';
    update public.ep_leave_requests
       set status = p_action, decided_by = null, decided_by_admin = auth.uid(), decided_at = now(),
           decision_comment = v_comment,
           admin_decided_at = coalesce(admin_decided_at, now()),
           admin_comment = case when v_final then admin_comment else v_comment end,
           updated_at = now()
     where id = p_id returning * into v_row;
    perform public.ep_notify(v_row.employee_id, 'leave',
      'Your leave was ' || p_action,
      v_what || ' · by Admin' || coalesce(' · ' || v_comment, ''),
      '/employee/leave', case when p_action = 'rejected' then 'urgent' else 'normal' end);
    -- The reporting manager always learns the admin's decision (approved or rejected).
    if v_row.approver_id is not null and v_row.approver_id <> v_row.employee_id then
      perform public.ep_notify(v_row.approver_id, 'leave',
        'Admin ' || p_action || ' ' || v_emp_name || '''s leave',
        v_what || coalesce(' · Admin: ' || v_comment, '')
          || case when v_final then ' · decided instead of you; no action needed.' else ' · no action needed from you.' end,
        '/employee/leave/team', 'normal');
    end if;
  end if;
  return public.ep_leave_json(v_row)
    || jsonb_build_object('balance',
         public.ep_leave_balance_json(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type));
end $function$;

-- public.ep_admin_delete_custom_reminder
CREATE OR REPLACE FUNCTION public.ep_admin_delete_custom_reminder(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.notifications.delete'); -- rbac
  delete from public.ep_custom_reminders where id = p_id;
  if not found then
    raise exception 'Reminder not found.' using errcode = 'P0002';
  end if;
  return public.ep_admin_custom_reminders();
end $function$;

-- public.ep_admin_delete_holiday
CREATE OR REPLACE FUNCTION public.ep_admin_delete_holiday(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_date date;
begin
  perform public.rbac_require('portal.leave.delete'); -- rbac
  delete from public.ep_holidays where id = p_id returning holiday_date into v_date;
  if v_date is null then
    raise exception 'Holiday not found.' using errcode = 'P0002';
  end if;
  perform public.ep_recount_leave_on(v_date);
  return public.ep_admin_holidays(extract(year from v_date)::int);
end $function$;

-- public.ep_admin_employee
CREATE OR REPLACE FUNCTION public.ep_admin_employee(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v jsonb := public.ep_admin_employee_json(p_id);
begin
  perform public.rbac_require('portal.employees.view'); -- rbac
  if v is null then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  return v || jsonb_build_object(
    'personal', coalesce((
      select to_jsonb(p) - 'employee_id' from public.ep_employee_profiles p where p.employee_id = p_id
    ), '{}'::jsonb),
    'emergency_contacts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', c.name, 'relationship', c.relationship,
               'phone', c.phone, 'alternate_phone', c.alternate_phone) order by c.sort_order)
      from public.ep_emergency_contacts c where c.employee_id = p_id
    ), '[]'::jsonb),
    'direct_reports', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'full_name', r.full_name, 'employee_code', r.employee_code,
               'designation', r.designation, 'is_active', r.is_active) order by r.full_name)
      from public.ep_employees r where r.reporting_manager_id = p_id
    ), '[]'::jsonb)
  );
end $function$;

-- public.ep_admin_employees
CREATE OR REPLACE FUNCTION public.ep_admin_employees()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require_any(array['portal.employees.view', 'portal.projects.view', 'portal.attendance.view', 'portal.leave.view', 'portal.reports.view', 'portal.notifications.view']); -- rbac
  return coalesce((
    select jsonb_agg(public.ep_admin_employee_json(e.id) order by e.is_active desc, e.employee_code)
    from public.ep_employees e
  ), '[]'::jsonb);
end $function$;

-- public.ep_admin_holidays
CREATE OR REPLACE FUNCTION public.ep_admin_holidays(p_year integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.leave.view'); -- rbac
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'date', holiday_date, 'name', name) order by holiday_date)
    from public.ep_holidays where extract(year from holiday_date) = p_year), '[]'::jsonb);
end $function$;

-- public.ep_admin_inbox
CREATE OR REPLACE FUNCTION public.ep_admin_inbox(p_filter text DEFAULT 'all'::text, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  perform public.rbac_require('portal.inbox.view'); -- rbac
  return jsonb_build_object(
    'unread', (select count(*) from public.ep_admin_notifications n
                where not exists (select 1 from public.ep_admin_notification_reads r
                                   where r.notification_id = n.id and r.user_id = v_uid)),
    'counts', coalesce((select jsonb_object_agg(kind, c) from (
                 select kind, count(*) c from public.ep_admin_notifications n
                  where not exists (select 1 from public.ep_admin_notification_reads r
                                     where r.notification_id = n.id and r.user_id = v_uid)
                  group by kind) k), '{}'::jsonb),
    'items', coalesce((
      select jsonb_agg(x.j order by x.created_at desc) from (
        select n.created_at, jsonb_build_object(
                 'id', n.id, 'kind', n.kind, 'priority', n.priority, 'title', n.title, 'body', n.body,
                 'link', n.link, 'created_at', n.created_at,
                 'read', exists (select 1 from public.ep_admin_notification_reads r
                                  where r.notification_id = n.id and r.user_id = v_uid),
                 'employee', (select jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code)
                                from public.ep_employees e where e.id = n.employee_id)) j
          from public.ep_admin_notifications n
         where case coalesce(p_filter, 'all')
                 when 'all' then true
                 when 'unread' then not exists (select 1 from public.ep_admin_notification_reads r
                                                 where r.notification_id = n.id and r.user_id = v_uid)
                 else n.kind = p_filter end
         order by n.created_at desc
         limit least(greatest(coalesce(p_limit, 200), 1), 500)) x), '[]'::jsonb));
end $function$;

-- public.ep_admin_inbox_mark_read
CREATE OR REPLACE FUNCTION public.ep_admin_inbox_mark_read(p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.inbox.view'); -- rbac
  insert into public.ep_admin_notification_reads (notification_id, user_id)
  select n.id, auth.uid() from public.ep_admin_notifications n
   where p_ids is null or n.id = any (p_ids)
  on conflict do nothing;
end $function$;

-- public.ep_admin_inbox_summary
CREATE OR REPLACE FUNCTION public.ep_admin_inbox_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  perform public.rbac_require('portal.inbox.view'); -- rbac
  return jsonb_build_object('unread', (
    select count(*) from public.ep_admin_notifications n
     where not exists (select 1 from public.ep_admin_notification_reads r
                        where r.notification_id = n.id and r.user_id = v_uid)));
end $function$;

-- public.ep_admin_leave_balances
CREATE OR REPLACE FUNCTION public.ep_admin_leave_balances(p_year integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.leave.view'); -- rbac
  if p_year is null or p_year not between 2020 and 2100 then
    raise exception 'Invalid year.' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'year', p_year,
    'types', (select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'is_paid', is_paid, 'default', yearly_days)
                               order by sort_order)
              from public.ep_leave_types where is_active),
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'employee_code', e.employee_code, 'full_name', e.full_name,
               'designation', e.designation, 'is_active', e.is_active,
               'balances', (select jsonb_agg(public.ep_leave_balance_json(e.id, p_year, t.code) order by t.sort_order)
                              from public.ep_leave_types t where t.is_active))
             order by e.is_active desc, e.full_name)
      from public.ep_employees e), '[]'::jsonb));
end $function$;

-- public.ep_admin_leave_requests
CREATE OR REPLACE FUNCTION public.ep_admin_leave_requests(p_status text DEFAULT 'pending'::text, p_year integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.leave.view'); -- rbac
  return coalesce((
    select jsonb_agg(public.ep_leave_json(r)
             || jsonb_build_object('balance',
                  public.ep_leave_balance_json(r.employee_id, extract(year from r.start_date)::int, r.leave_type))
             order by case r.status when 'pending' then 0 when 'manager_review' then 1 when 'manager_pending' then 2 else 3 end, r.start_date desc, r.created_at desc)
    from (select * from public.ep_leave_requests
           where (coalesce(p_status, 'all') = 'all' or status = p_status)
             and (p_year is null or extract(year from start_date) = p_year)
           order by start_date desc limit 300) r), '[]'::jsonb);
end $function$;

-- public.ep_admin_notification_log
CREATE OR REPLACE FUNCTION public.ep_admin_notification_log(p_kind text DEFAULT 'all'::text, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.notifications.view'); -- rbac
  return jsonb_build_object(
    'counts', (
      select jsonb_object_agg(k.kind, coalesce(c.n, 0))
      from unnest(array['project', 'leave', 'attendance', 'report', 'message']) k(kind)
      left join (select kind, count(*) as n from public.ep_notifications
                  where created_at > now() - interval '30 days' group by kind) c on c.kind = k.kind),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', n.id, 'kind', n.kind, 'priority', n.priority, 'title', n.title, 'body', n.body,
               'created_at', n.created_at, 'read_at', n.read_at, 'sender', n.sender_label,
               'automatic', n.sender_user_id is null,
               'employee', jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code))
             order by n.created_at desc)
      from (select * from public.ep_notifications
             where case coalesce(p_kind, 'all')
                     when 'all' then true
                     when 'automatic' then sender_user_id is null
                     when 'messages' then message_id is not null
                     else kind = p_kind
                   end
             order by created_at desc
             limit least(greatest(coalesce(p_limit, 100), 1), 300)) n
      join public.ep_employees e on e.id = n.employee_id), '[]'::jsonb));
end $function$;

-- public.ep_admin_notify_options
CREATE OR REPLACE FUNCTION public.ep_admin_notify_options()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.notifications.create'); -- rbac
  return jsonb_build_object(
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
                                          'designation', e.designation, 'department', e.department) order by e.full_name)
      from public.ep_employees e where e.is_active), '[]'::jsonb),
    'departments', coalesce((
      select jsonb_agg(jsonb_build_object('name', d.department, 'count', d.n) order by d.department)
      from (select department, count(*) as n from public.ep_employees
             where is_active and department is not null group by department) d), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'project_code', p.project_code, 'count', x.n)
                       order by p.name)
      from public.pt_projects p
      join (select m.project_id, count(*) as n from public.ep_project_members m
              join public.ep_employees e on e.id = m.employee_id and e.is_active
             group by m.project_id) x on x.project_id = p.id), '[]'::jsonb));
end $function$;

-- public.ep_admin_pm_delete_task
CREATE OR REPLACE FUNCTION public.ep_admin_pm_delete_task(p_task uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_project uuid;
begin
  perform public.rbac_require('portal.projects.delete'); -- rbac
  delete from public.ep_project_tasks where id = p_task returning project_id into v_project;
  if v_project is null then
    raise exception 'Task not found.' using errcode = 'P0002';
  end if;
  return public.ep_admin_pm_project(v_project);
end $function$;

-- public.ep_admin_pm_project
CREATE OR REPLACE FUNCTION public.ep_admin_pm_project(p_project uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_today date := (timezone('Asia/Kolkata', now()))::date;
  v jsonb;
begin
  perform public.rbac_require('portal.projects.view'); -- rbac
  select jsonb_build_object(
           'id', p.id, 'project_code', p.project_code, 'name', p.name, 'client', c.name,
           'description', p.description, 'project_type', p.project_type,
           'status', p.status, 'priority', p.priority, 'health', p.health, 'progress', p.progress,
           'start_date', p.start_date, 'end_date', p.end_date, 'completed_date', p.completed_date,
           'project_manager', p.project_manager,
           'overdue', p.end_date < v_today and public.ep_project_is_running(p.status),
           'completed_late', p.completed_date > p.end_date,
           'delay_reasons', public.ep_project_delay_json(p.id))
    into v
  from public.pt_projects p
  left join public.pt_companies c on c.id = p.company_id
  where p.id = p_project;
  if v is null then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;

  return v || jsonb_build_object(
    'team', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'employee_code', e.employee_code, 'full_name', e.full_name,
               'designation', e.designation, 'is_active', e.is_active,
               'project_role', m.project_role, 'is_lead', m.is_lead, 'added_at', m.added_at,
               'tasks_total',       (select count(*) from public.ep_project_tasks t where t.project_id = p_project and t.assignee_id = e.id),
               'tasks_done',        (select count(*) from public.ep_project_tasks t where t.project_id = p_project and t.assignee_id = e.id and t.status = 'done'),
               'tasks_in_progress', (select count(*) from public.ep_project_tasks t where t.project_id = p_project and t.assignee_id = e.id and t.status = 'in_progress'),
               'tasks_overdue',     (select count(*) from public.ep_project_tasks t where t.project_id = p_project and t.assignee_id = e.id
                                       and t.status <> 'done' and t.due_date < v_today),
               'hours_logged', coalesce((
                 select sum(i.hours) from public.ep_work_report_items i
                 join public.ep_work_reports r on r.id = i.report_id
                 where i.project_id = p_project and r.employee_id = e.id and r.status in ('submitted', 'reviewed')), 0),
               'last_report_date', (
                 select max(r.report_date) from public.ep_work_report_items i
                 join public.ep_work_reports r on r.id = i.report_id
                 where i.project_id = p_project and r.employee_id = e.id and r.status in ('submitted', 'reviewed'))
             ) order by m.is_lead desc, e.full_name)
      from public.ep_project_members m join public.ep_employees e on e.id = m.employee_id
      where m.project_id = p_project), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'title', t.title, 'description', t.description, 'status', t.status,
               'priority', t.priority, 'due_date', t.due_date, 'completed_at', t.completed_at,
               'created_at', t.created_at,
               'overdue', t.status <> 'done' and t.due_date < v_today,
               'late', t.due_date < coalesce((timezone('Asia/Kolkata', t.completed_at))::date, v_today),
               'delay_reason', t.delay_reason, 'delay_reason_at', t.delay_reason_at,
               'delay_reason_by', (select full_name from public.ep_employees where id = t.delay_reason_by),
               'assignee', case when a.id is null then null else jsonb_build_object('id', a.id, 'full_name', a.full_name) end,
               'created_by', coalesce(cb.full_name, 'Admin'))
             order by (t.status = 'done'), t.due_date nulls last, t.created_at desc)
      from public.ep_project_tasks t
      left join public.ep_employees a on a.id = t.assignee_id
      left join public.ep_employees cb on cb.id = t.created_by
      where t.project_id = p_project), '[]'::jsonb),
    'updates', coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'body', u.body, 'created_at', u.created_at,
                                          'author', coalesce(au.full_name, 'Admin')) order by u.created_at desc)
      from (select * from public.ep_project_updates where project_id = p_project order by created_at desc limit 20) u
      left join public.ep_employees au on au.id = u.author_id), '[]'::jsonb)
  );
end $function$;

-- public.ep_admin_pm_projects
CREATE OR REPLACE FUNCTION public.ep_admin_pm_projects()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_today date := (timezone('Asia/Kolkata', now()))::date;
begin
  perform public.rbac_require('portal.projects.view'); -- rbac
  return coalesce((
    select jsonb_agg(x.j order by x.sort_status, x.end_date nulls last, x.name)
    from (
      select p.name, p.end_date,
             case p.status when 'in_progress' then 0 when 'planning' then 1 when 'live' then 2 when 'on_hold' then 3
                           when 'completed' then 4 else 5 end as sort_status,
             jsonb_build_object(
               'id', p.id, 'project_code', p.project_code, 'name', p.name, 'client', c.name,
               'status', p.status, 'priority', p.priority, 'health', p.health,
               'start_date', p.start_date, 'end_date', p.end_date, 'completed_date', p.completed_date,
               'team', coalesce((
                 select jsonb_agg(jsonb_build_object('id', e.id, 'full_name', e.full_name, 'is_lead', m.is_lead)
                                  order by m.is_lead desc, e.full_name)
                 from public.ep_project_members m join public.ep_employees e on e.id = m.employee_id
                 where m.project_id = p.id), '[]'::jsonb),
               'tasks_total',   (select count(*) from public.ep_project_tasks t where t.project_id = p.id),
               'tasks_done',    (select count(*) from public.ep_project_tasks t where t.project_id = p.id and t.status = 'done'),
               'tasks_overdue', (select count(*) from public.ep_project_tasks t where t.project_id = p.id
                                   and t.status <> 'done' and t.due_date < v_today)
             ) as j
      from public.pt_projects p
      left join public.pt_companies c on c.id = p.company_id
    ) x
  ), '[]'::jsonb);
end $function$;

-- public.ep_admin_pm_remove_member
CREATE OR REPLACE FUNCTION public.ep_admin_pm_remove_member(p_project uuid, p_employee uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.projects.edit'); -- rbac
  delete from public.ep_project_members where project_id = p_project and employee_id = p_employee;
  if not found then
    raise exception 'This employee is not on the project.' using errcode = 'P0002';
  end if;
  update public.ep_project_tasks set assignee_id = null, updated_at = now()
   where project_id = p_project and assignee_id = p_employee and status <> 'done';
  return public.ep_admin_pm_project(p_project);
end $function$;

-- public.ep_admin_pm_save_member
CREATE OR REPLACE FUNCTION public.ep_admin_pm_save_member(p_project uuid, p_employee uuid, p_role text DEFAULT NULL::text, p_is_lead boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.projects.edit'); -- rbac
  if not exists (select 1 from public.pt_projects where id = p_project) then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.ep_employees where id = p_employee and is_active) then
    raise exception 'Choose an active employee.' using errcode = '22023';
  end if;
  insert into public.ep_project_members (project_id, employee_id, project_role, is_lead)
  values (p_project, p_employee, nullif(btrim(coalesce(p_role, '')), ''), coalesce(p_is_lead, false))
  on conflict (project_id, employee_id) do update
    set project_role = excluded.project_role, is_lead = excluded.is_lead;
  return public.ep_admin_pm_project(p_project);
end $function$;

-- public.ep_admin_pm_save_task
CREATE OR REPLACE FUNCTION public.ep_admin_pm_save_task(p_project uuid, p_task uuid, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f text;
  v_assignee uuid;
  v_status text;
begin
  perform public.rbac_require('portal.projects.edit'); -- rbac
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Invalid task data.' using errcode = '22023';
  end if;
  for f in select jsonb_object_keys(p) loop
    if f not in ('title', 'description', 'assignee_id', 'priority', 'status', 'due_date') then
      raise exception 'Field % cannot be set here.', f using errcode = '42501';
    end if;
  end loop;
  if not exists (select 1 from public.pt_projects where id = p_project) then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;
  if nullif(btrim(coalesce(p ->> 'title', '')), '') is null then
    raise exception 'Task title is required.' using errcode = '22023';
  end if;
  v_assignee := nullif(btrim(coalesce(p ->> 'assignee_id', '')), '')::uuid;
  -- Checked for new tasks and when the assignee changes (an existing assignee may have left the team).
  if v_assignee is not null
     and (p_task is null or v_assignee is distinct from (select assignee_id from public.ep_project_tasks where id = p_task))
     and not exists (
       select 1 from public.ep_project_members m join public.ep_employees e on e.id = m.employee_id
       where m.project_id = p_project and m.employee_id = v_assignee and e.is_active) then
    raise exception 'Assign the task to an active member of this project.' using errcode = '22023';
  end if;
  v_status := coalesce(nullif(btrim(coalesce(p ->> 'status', '')), ''), 'todo');

  if p_task is null then
    insert into public.ep_project_tasks (project_id, title, description, assignee_id, status, priority, due_date, completed_at)
    values (p_project, btrim(p ->> 'title'), nullif(btrim(coalesce(p ->> 'description', '')), ''), v_assignee, v_status,
            coalesce(nullif(btrim(coalesce(p ->> 'priority', '')), ''), 'medium'),
            nullif(btrim(coalesce(p ->> 'due_date', '')), '')::date,
            case when v_status = 'done' then now() end);
  else
    update public.ep_project_tasks set
      title        = btrim(p ->> 'title'),
      description  = nullif(btrim(coalesce(p ->> 'description', '')), ''),
      assignee_id  = v_assignee,
      status       = v_status,
      priority     = coalesce(nullif(btrim(coalesce(p ->> 'priority', '')), ''), 'medium'),
      due_date     = nullif(btrim(coalesce(p ->> 'due_date', '')), '')::date,
      completed_at = case when v_status = 'done' then coalesce(completed_at, now()) end,
      updated_at   = now()
    where id = p_task and project_id = p_project;
    if not found then
      raise exception 'Task not found.' using errcode = 'P0002';
    end if;
  end if;
  return public.ep_admin_pm_project(p_project);
end $function$;

-- public.ep_admin_pm_set_deadline
CREATE OR REPLACE FUNCTION public.ep_admin_pm_set_deadline(p_project uuid, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_start date;
begin
  perform public.rbac_require('portal.projects.edit'); -- rbac
  select start_date into v_start from public.pt_projects where id = p_project;
  if not found then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;
  if p_date is not null and v_start is not null and p_date < v_start then
    raise exception 'The deadline cannot be before the start date (%).', to_char(v_start, 'DD Mon YYYY') using errcode = '22023';
  end if;
  update public.pt_projects set end_date = p_date, updated_at = now() where id = p_project;
  return public.ep_admin_pm_project(p_project);
end $function$;

-- public.ep_admin_portal_dashboard
CREATE OR REPLACE FUNCTION public.ep_admin_portal_dashboard()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_today   date := (timezone('Asia/Kolkata', now()))::date;
  v_holiday text;
  v_prev    date;
begin
  perform public.rbac_require('portal.dashboard.view'); -- rbac
  perform public.ep_close_overdue_sessions(null);
  select name into v_holiday from public.ep_holidays where holiday_date = v_today;
  -- Previous working day (skips Sundays and holidays), for "reports not submitted".
  select max(d)::date into v_prev
    from generate_series(v_today - 10, v_today - 1, interval '1 day') d
   where extract(isodow from d) <> 7 and not exists (select 1 from public.ep_holidays h where h.holiday_date = d::date);

  return jsonb_build_object(
    'today', v_today,
    'working_day', extract(isodow from v_today) <> 7 and v_holiday is null,
    'holiday', v_holiday,
    'previous_working_day', v_prev,
    'employees', (select jsonb_build_object(
                    'active', count(*) filter (where is_active),
                    'interns', count(*) filter (where is_active and employment_type = 'intern'),
                    'access_off', count(*) filter (where not is_active))
                  from public.ep_employees),
    'people', coalesce((
      select jsonb_agg(x.j order by x.ord, x.name)
      from (
        select e.full_name as name,
               case when a.open then 0 when a.first_in is not null then 1 when lv.id is not null then 2 else 3 end as ord,
               jsonb_build_object(
                 'id', e.id, 'full_name', e.full_name, 'designation', e.designation,
                 'status', case when a.open then 'in'
                                when a.first_in is not null then 'out'
                                when lv.id is not null then 'leave'
                                when extract(isodow from v_today) = 7 or v_holiday is not null then 'off'
                                else 'not_in' end,
                 'first_in', a.first_in,
                 'late', a.first_in is not null
                         and (a.first_in at time zone 'Asia/Kolkata')::time > (public.ep_attendance_rules() ->> 'late_after')::time,
                 'leave_type', lv.leave_type, 'half_day', lv.half_day) as j
        from public.ep_employees e
        left join lateral (
          select min(punch_in_at) as first_in, bool_or(punch_out_at is null) as open
          from public.ep_attendance where employee_id = e.id and work_date = v_today) a on true
        left join lateral (
          select r.id, r.leave_type, r.half_day from public.ep_leave_requests r
          where r.employee_id = e.id and r.status = 'approved' and v_today between r.start_date and r.end_date
          limit 1) lv on true
        where e.is_active) x), '[]'::jsonb),
    'pending', jsonb_build_object(
      'leave', (select count(*) from public.ep_leave_requests where status = 'pending'),
      'corrections', (select count(*) from public.ep_attendance_corrections where status = 'pending'),
      'reports_to_review', (select count(*) from public.ep_work_reports where status = 'submitted'),
      'reports_missing', (
        select count(*) from (select distinct employee_id from public.ep_attendance where work_date = v_prev) d
        where exists (select 1 from public.ep_project_members m where m.employee_id = d.employee_id)
          and not exists (select 1 from public.ep_work_reports w where w.employee_id = d.employee_id
                           and w.report_date = v_prev and w.status in ('submitted', 'reviewed'))),
      'tasks_overdue_no_reason', (
        select count(*) from public.ep_project_tasks t join public.pt_projects p on p.id = t.project_id
        where t.status <> 'done' and t.due_date < v_today and t.delay_reason is null
          and p.status not in ('completed', 'cancelled')),
      'projects_overdue', (
        select count(*) from public.pt_projects p
        where public.ep_project_is_running(p.status) and p.end_date < v_today
          and exists (select 1 from public.ep_project_members m where m.project_id = p.id))),
    'deadlines', coalesce((
      select jsonb_agg(d.j order by d.due, d.kind desc)
      from (
        select t.due_date as due, 'task' as kind, jsonb_build_object(
                 'kind', 'task', 'title', t.title, 'due_date', t.due_date, 'project_id', p.id, 'project_name', p.name,
                 'who', (select full_name from public.ep_employees where id = t.assignee_id)) as j
        from public.ep_project_tasks t join public.pt_projects p on p.id = t.project_id
        where t.status <> 'done' and t.due_date between v_today and v_today + 7
          and p.status not in ('completed', 'cancelled')
        union all
        select p.end_date, 'project', jsonb_build_object(
                 'kind', 'project', 'title', p.name, 'due_date', p.end_date, 'project_id', p.id, 'project_name', p.name,
                 'who', null)
        from public.pt_projects p
        where public.ep_project_is_running(p.status) and p.end_date between v_today and v_today + 7
        order by 1 limit 8) d), '[]'::jsonb),
    'leave_upcoming', coalesce((
      select jsonb_agg(jsonb_build_object(
               'full_name', e.full_name, 'leave_type', r.leave_type, 'start_date', r.start_date,
               'end_date', r.end_date, 'days', r.days, 'half_day', r.half_day) order by r.start_date)
      from public.ep_leave_requests r join public.ep_employees e on e.id = r.employee_id
      where r.status = 'approved' and r.start_date between v_today + 1 and v_today + 7), '[]'::jsonb),
    'next_holiday', (
      select jsonb_build_object('date', holiday_date, 'name', name)
      from public.ep_holidays where holiday_date > v_today order by holiday_date limit 1)
  );
end $function$;

-- public.ep_admin_reminder_settings
CREATE OR REPLACE FUNCTION public.ep_admin_reminder_settings()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.notifications.view'); -- rbac
  return (select jsonb_agg(jsonb_build_object(
                   'kind', kind, 'enabled', enabled, 'send_at', to_char(send_at, 'HH24:MI'),
                   'days', to_jsonb(days), 'last_run', last_run,
                   'sent_today', (select count(*) from public.ep_notifications
                                   where dedupe_key like s.kind || ':' || (timezone('Asia/Kolkata', now()))::date || '%'))
                 order by send_at)
          from public.ep_reminder_settings s);
end $function$;

-- public.ep_admin_remove_certificate
CREATE OR REPLACE FUNCTION public.ep_admin_remove_certificate(p_emp uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_old text;
begin
  perform public.rbac_require('portal.employees.edit'); -- rbac
  delete from public.ep_internship_certificates where employee_id = p_emp returning storage_path into v_old;
  if v_old is null then
    raise exception 'There is no certificate to remove.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('old_path', v_old);
end $function$;

-- public.ep_admin_reports
CREATE OR REPLACE FUNCTION public.ep_admin_reports(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_today date := (timezone('Asia/Kolkata', now()))::date;
begin
  perform public.rbac_require('portal.reports.view'); -- rbac
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'Choose a date range of at most 93 days.' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'reports', coalesce((
      select jsonb_agg(public.ep_report_json(r.id) order by r.report_date desc, r.updated_at desc)
      from public.ep_work_reports r where r.report_date between p_from and p_to), '[]'::jsonb),
    -- Worked that day (punched in, on a project) but no submitted / reviewed report.
    'missing', coalesce((
      select jsonb_agg(jsonb_build_object(
               'employee', jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code),
               'date', d.work_date,
               'status', coalesce(w.status, 'not_started')) order by d.work_date desc, e.full_name)
      from (select distinct employee_id, work_date from public.ep_attendance
             where work_date between p_from and least(p_to, v_today)) d
      join public.ep_employees e on e.id = d.employee_id
      left join public.ep_work_reports w on w.employee_id = d.employee_id and w.report_date = d.work_date
      where exists (select 1 from public.ep_project_members m where m.employee_id = e.id)
        and (w.id is null or w.status in ('draft', 'returned'))), '[]'::jsonb));
end $function$;

-- public.ep_admin_review_report
CREATE OR REPLACE FUNCTION public.ep_admin_review_report(p_report uuid, p_action text, p_comment text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_status  text;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  perform public.rbac_require('portal.reports.approve'); -- rbac
  select status into v_status from public.ep_work_reports where id = p_report for update;
  if v_status is null then
    raise exception 'Report not found.' using errcode = 'P0002';
  end if;
  if v_status <> 'submitted' then
    raise exception 'Only a submitted report can be reviewed (this one is %).', v_status using errcode = 'P0001';
  end if;
  if p_action not in ('reviewed', 'returned') then
    raise exception 'Invalid action.' using errcode = '22023';
  end if;
  if p_action = 'returned' and v_comment is null then
    raise exception 'Write a comment saying what needs to change.' using errcode = '22023';
  end if;
  if coalesce(length(v_comment), 0) > 1000 then
    raise exception 'Comment must be at most 1000 characters.' using errcode = '22023';
  end if;
  update public.ep_work_reports
     set status = p_action, reviewed_by = null, reviewed_by_admin = auth.uid(), reviewed_at = now(),
         review_comment = v_comment, updated_at = now()
   where id = p_report;
  return public.ep_report_json(p_report);
end $function$;

-- public.ep_admin_save_custom_reminder
CREATE OR REPLACE FUNCTION public.ep_admin_save_custom_reminder(p_id uuid, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_title    text := btrim(coalesce(p ->> 'title', ''));
  v_body     text := nullif(btrim(coalesce(p ->> 'body', '')), '');
  v_aud      text := p ->> 'audience';
  v_repeat   text := p ->> 'repeat';
  v_at       time;
  v_date     date := nullif(p ->> 'send_date', '')::date;
  v_days     smallint[];
  v_deps     text[];
  v_people   uuid[];
  v_project  uuid := nullif(p ->> 'project_id', '')::uuid;
  v_today    date := (timezone('Asia/Kolkata', now()))::date;
  v_id       uuid;
begin
  perform public.rbac_require('portal.notifications.edit'); -- rbac
  if length(v_title) not between 1 and 150 then
    raise exception 'Title must be 1 to 150 characters.' using errcode = '22023';
  end if;
  if coalesce(length(v_body), 0) > 2000 then
    raise exception 'Message must be at most 2000 characters.' using errcode = '22023';
  end if;
  begin
    v_at := (p ->> 'send_at')::time;
  exception when others then
    v_at := null;
  end;
  if v_at is null or v_at < time '06:00' or v_at > time '21:55' then
    raise exception 'Choose a time between 6:00 AM and 9:55 PM.' using errcode = '22023';
  end if;
  if v_aud not in ('all', 'department', 'project', 'people') then
    raise exception 'Choose who should get it.' using errcode = '22023';
  end if;
  select array_agg(distinct btrim(x)) into v_deps
    from jsonb_array_elements_text(coalesce(p -> 'departments', '[]'::jsonb)) x where btrim(x) <> '';
  select array_agg(distinct x::uuid) into v_people
    from jsonb_array_elements_text(coalesce(p -> 'people', '[]'::jsonb)) x;
  select array_agg(distinct x::smallint order by x::smallint) into v_days
    from jsonb_array_elements_text(coalesce(p -> 'days', '[]'::jsonb)) x;
  if v_aud = 'department' and v_deps is null then
    raise exception 'Choose at least one department.' using errcode = '22023';
  end if;
  if v_aud = 'project' and (v_project is null or not exists (select 1 from public.pt_projects where id = v_project)) then
    raise exception 'Choose a project team.' using errcode = '22023';
  end if;
  if v_aud = 'people' and v_people is null then
    raise exception 'Choose at least one person.' using errcode = '22023';
  end if;
  if v_repeat = 'weekly' then
    if v_days is null or not (v_days <@ '{1,2,3,4,5,6,7}'::smallint[]) then
      raise exception 'Choose at least one day.' using errcode = '22023';
    end if;
    v_date := null;
  elsif v_repeat = 'once' then
    if v_date is null or v_date < v_today then
      raise exception 'Choose today or a later date.' using errcode = '22023';
    end if;
    v_days := null;
  else
    raise exception 'Choose weekly or one time.' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.ep_custom_reminders
      (title, body, priority, audience, departments, project_id, people, repeat, days, send_date, send_at, enabled, created_by)
    values (v_title, v_body, coalesce(nullif(p ->> 'priority', ''), 'normal'), v_aud,
            case when v_aud = 'department' then v_deps end, case when v_aud = 'project' then v_project end,
            case when v_aud = 'people' then v_people end, v_repeat, v_days, v_date, v_at,
            coalesce((p ->> 'enabled')::boolean, true), auth.uid())
    returning id into v_id;
  else
    update public.ep_custom_reminders set
      title = v_title, body = v_body, priority = coalesce(nullif(p ->> 'priority', ''), 'normal'), audience = v_aud,
      departments = case when v_aud = 'department' then v_deps end,
      project_id  = case when v_aud = 'project' then v_project end,
      people      = case when v_aud = 'people' then v_people end,
      repeat = v_repeat, days = v_days, send_date = v_date, send_at = v_at,
      enabled = coalesce((p ->> 'enabled')::boolean, enabled),
      -- a changed one-time reminder may run again
      last_run = case when v_repeat = 'once' then null else last_run end,
      updated_at = now()
    where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'Reminder not found.' using errcode = 'P0002';
    end if;
  end if;
  return public.ep_admin_custom_reminders();
end $function$;

-- public.ep_admin_save_holiday
CREATE OR REPLACE FUNCTION public.ep_admin_save_holiday(p_id uuid, p_date date, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_old date;
  v_name text := btrim(coalesce(p_name, ''));
begin
  perform public.rbac_require('portal.leave.edit'); -- rbac
  if p_date is null or p_date not between date '2020-01-01' and date '2100-12-31' then
    raise exception 'Choose a valid date.' using errcode = '22023';
  end if;
  if length(v_name) not between 1 and 80 then
    raise exception 'Holiday name is required (up to 80 characters).' using errcode = '22023';
  end if;
  if exists (select 1 from public.ep_holidays where holiday_date = p_date and id is distinct from p_id) then
    raise exception '% is already a holiday.', to_char(p_date, 'DD Mon YYYY') using errcode = '23505';
  end if;
  if p_id is null then
    insert into public.ep_holidays (holiday_date, name) values (p_date, v_name);
  else
    select holiday_date into v_old from public.ep_holidays where id = p_id for update;
    if not found then
      raise exception 'Holiday not found.' using errcode = 'P0002';
    end if;
    update public.ep_holidays set holiday_date = p_date, name = v_name where id = p_id;
    if v_old <> p_date then
      perform public.ep_recount_leave_on(v_old);
    end if;
  end if;
  perform public.ep_recount_leave_on(p_date);
  return public.ep_admin_holidays(extract(year from p_date)::int);
end $function$;

-- public.ep_admin_save_reminder
CREATE OR REPLACE FUNCTION public.ep_admin_save_reminder(p_kind text, p_enabled boolean, p_send_at time without time zone, p_days smallint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.notifications.edit'); -- rbac
  if p_send_at is null or p_send_at < time '06:00' or p_send_at > time '21:55' then
    raise exception 'Choose a time between 6:00 AM and 9:55 PM.' using errcode = '22023';
  end if;
  if p_days is null or cardinality(p_days) = 0 or not (p_days <@ '{1,2,3,4,5,6,7}'::smallint[]) then
    raise exception 'Choose at least one day.' using errcode = '22023';
  end if;
  update public.ep_reminder_settings
     set enabled = coalesce(p_enabled, false), send_at = p_send_at,
         days = (select array_agg(distinct d order by d) from unnest(p_days) d), updated_at = now()
   where kind = p_kind;
  if not found then
    raise exception 'Reminder not found.' using errcode = 'P0002';
  end if;
  return public.ep_admin_reminder_settings();
end $function$;

-- public.ep_admin_send_custom_reminder_now
CREATE OR REPLACE FUNCTION public.ep_admin_send_custom_reminder_now(p_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.notifications.create'); -- rbac
  if not exists (select 1 from public.ep_custom_reminders where id = p_id) then
    raise exception 'Reminder not found.' using errcode = 'P0002';
  end if;
  return public.ep_send_custom_reminder(p_id);
end $function$;

-- public.ep_admin_send_notification
CREATE OR REPLACE FUNCTION public.ep_admin_send_notification(p_audience text, p_to uuid[], p_departments text[], p_project uuid, p_title text, p_body text, p_priority text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_msg   uuid := gen_random_uuid();
  v_title text := btrim(coalesce(p_title, ''));
  v_body  text := nullif(btrim(coalesce(p_body, '')), '');
  v_n     integer;
begin
  perform public.rbac_require('portal.notifications.create'); -- rbac
  if length(v_title) not between 1 and 150 then
    raise exception 'Subject must be 1 to 150 characters.' using errcode = '22023';
  end if;
  if coalesce(length(v_body), 0) > 2000 then
    raise exception 'Message must be at most 2000 characters.' using errcode = '22023';
  end if;
  if coalesce(p_priority, '') not in ('normal', 'urgent') then
    raise exception 'Invalid priority.' using errcode = '22023';
  end if;
  if p_audience not in ('all', 'people', 'department', 'project') then
    raise exception 'Invalid audience.' using errcode = '22023';
  end if;
  if p_audience = 'people' and coalesce(cardinality(p_to), 0) = 0 then
    raise exception 'Choose at least one person.' using errcode = '22023';
  end if;
  if p_audience = 'department' and coalesce(cardinality(p_departments), 0) = 0 then
    raise exception 'Choose at least one department.' using errcode = '22023';
  end if;
  if p_audience = 'project' and p_project is null then
    raise exception 'Choose a project team.' using errcode = '22023';
  end if;

  insert into public.ep_notifications
    (employee_id, kind, priority, title, body, sender_employee_id, sender_user_id, sender_label, message_id)
  select e.id, 'message', p_priority, v_title, v_body, null, auth.uid(), 'Admin', v_msg
    from public.ep_employees e
   where e.is_active
     and case p_audience
           when 'all'        then true
           when 'people'     then e.id = any (p_to)
           when 'department' then e.department = any (p_departments)
           else exists (select 1 from public.ep_project_members m where m.project_id = p_project and m.employee_id = e.id)
         end;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Nobody active matches this audience.' using errcode = '22023';
  end if;
  return jsonb_build_object('message_id', v_msg, 'recipients', v_n);
end $function$;

-- public.ep_admin_send_reminder_now
CREATE OR REPLACE FUNCTION public.ep_admin_send_reminder_now(p_kind text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_key    text;
  v_before integer;
  v_after  integer;
begin
  perform public.rbac_require('portal.notifications.create'); -- rbac
  if p_kind not in ('punch_in', 'report', 'punch_out', 'deadlines') then
    raise exception 'Reminder not found.' using errcode = 'P0002';
  end if;
  v_key := p_kind || ':' || (timezone('Asia/Kolkata', now()))::date || '%';
  select count(*) into v_before from public.ep_notifications where dedupe_key like v_key;
  if p_kind = 'deadlines' then
    perform public.ep_send_deadline_reminders();
  else
    perform public.ep_send_reminders(p_kind);
  end if;
  select count(*) into v_after from public.ep_notifications where dedupe_key like v_key;
  return v_after - v_before;
end $function$;

-- public.ep_admin_set_certificate
CREATE OR REPLACE FUNCTION public.ep_admin_set_certificate(p_emp uuid, p_path text, p_name text, p_size bigint, p_mime text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_type text;
  v_old  text;
begin
  perform public.rbac_require('portal.employees.edit'); -- rbac
  select employment_type into v_type from public.ep_employees where id = p_emp;
  if not found then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  if v_type is distinct from 'intern' then
    raise exception 'Set the employment type to Intern first.' using errcode = '22023';
  end if;
  if p_path is null or p_path not like p_emp::text || '/%' then
    raise exception 'Invalid file location.' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'ep-certificates' and name = p_path) then
    raise exception 'The file was not uploaded.' using errcode = 'P0002';
  end if;
  select storage_path into v_old from public.ep_internship_certificates where employee_id = p_emp for update;
  insert into public.ep_internship_certificates (employee_id, storage_path, file_name, file_size, mime_type, uploaded_by, uploaded_at)
  values (p_emp, p_path, left(btrim(p_name), 255), p_size, p_mime, auth.uid(), now())
  on conflict (employee_id) do update
    set storage_path = excluded.storage_path, file_name = excluded.file_name, file_size = excluded.file_size,
        mime_type = excluded.mime_type, uploaded_by = excluded.uploaded_by, uploaded_at = now();
  perform public.ep_notify(p_emp, 'message',
    case when v_old is null then 'Your internship certificate is ready' else 'Your internship certificate was updated' end,
    'Download it from My Profile.', '/employee/profile');
  return jsonb_build_object('old_path', case when v_old is distinct from p_path then v_old end);
end $function$;

-- public.ep_admin_set_employee_access
CREATE OR REPLACE FUNCTION public.ep_admin_set_employee_access(p_id uuid, p_active boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.employees.edit'); -- rbac
  if p_active is null then
    raise exception 'Choose on or off.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.ep_employees where id = p_id) then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  -- Same lock as punch in / out, so a punch cannot slip in while access is turned off.
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  update public.ep_employees set is_active = p_active, updated_at = now()
   where id = p_id and is_active is distinct from p_active;
  if not p_active then
    update public.ep_attendance set punch_out_at = now()
     where employee_id = p_id and punch_out_at is null;
  end if;
  return public.ep_admin_employee(p_id);
end $function$;

-- public.ep_admin_set_leave_allowance
CREATE OR REPLACE FUNCTION public.ep_admin_set_leave_allowance(p_emp uuid, p_year integer, p_type text, p_days numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_type public.ep_leave_types;
  v_approved numeric;
begin
  perform public.rbac_require('portal.leave.edit'); -- rbac
  select * into v_type from public.ep_leave_types where code = p_type;
  if v_type.code is null or not v_type.is_paid then
    raise exception 'Only paid leave types have a balance.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.ep_employees where id = p_emp) then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  if p_year is null or p_year not between 2020 and 2100 then
    raise exception 'Invalid year.' using errcode = '22023';
  end if;
  if p_days is null then
    delete from public.ep_leave_allocations where employee_id = p_emp and year = p_year and leave_type = p_type;
  else
    if p_days < 0 or p_days > 366 or p_days * 2 <> round(p_days * 2) then
      raise exception 'Days must be between 0 and 366, in steps of 0.5.' using errcode = '22023';
    end if;
    select coalesce(sum(days), 0) into v_approved from public.ep_leave_requests
     where employee_id = p_emp and leave_type = p_type and status = 'approved' and extract(year from start_date) = p_year;
    if p_days < v_approved then
      raise exception '% days of % are already approved this year; the balance cannot be lower.', v_approved, v_type.name
        using errcode = '22023';
    end if;
    insert into public.ep_leave_allocations (employee_id, year, leave_type, days)
    values (p_emp, p_year, p_type, p_days)
    on conflict (employee_id, year, leave_type) do update set days = excluded.days;
  end if;
  return public.ep_leave_balance_json(p_emp, p_year, p_type);
end $function$;

-- public.ep_admin_update_employee
CREATE OR REPLACE FUNCTION public.ep_admin_update_employee(p_id uuid, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f text;
  v_old public.ep_employees;
  v_new public.ep_employees;
  v_mgr uuid;
  v_walk uuid;
  v_depth int := 0;
  v_mgr_name text;
  v_code text;
begin
  perform public.rbac_require('portal.employees.edit'); -- rbac
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Invalid employee data.' using errcode = '22023';
  end if;
  for f in select jsonb_object_keys(p) loop
    if f not in ('employee_code', 'full_name', 'department', 'designation', 'reporting_manager_id', 'reporting_manager_name',
                 'date_of_joining', 'employment_type', 'work_location') then
      raise exception 'Field % cannot be changed here.', f using errcode = '42501';
    end if;
  end loop;

  select * into v_old from public.ep_employees where id = p_id for update;
  if v_old.id is null then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;

  if p ? 'full_name' and nullif(btrim(p ->> 'full_name'), '') is null then
    raise exception 'Name cannot be empty.' using errcode = '22023';
  end if;

  -- Employee ID: the admin may change it (sign-in stays the same: it uses the email).
  v_code := case when p ? 'employee_code' then upper(btrim(coalesce(p ->> 'employee_code', ''))) else v_old.employee_code end;
  if v_code !~ '^[A-Z0-9][A-Z0-9-]{1,29}$' then
    raise exception 'Employee ID: use 2-30 letters, numbers or dashes (e.g. ZT-001).' using errcode = '22023';
  end if;
  if v_code <> v_old.employee_code
     and exists (select 1 from public.ep_employees where employee_code = v_code and id <> p_id) then
    raise exception 'Employee ID % is already used by another employee.', v_code using errcode = '23505';
  end if;

  -- Reporting manager: must exist, be active, not the employee, and not create a loop.
  v_mgr := case when p ? 'reporting_manager_id'
                then nullif(btrim(p ->> 'reporting_manager_id'), '')::uuid
                else v_old.reporting_manager_id end;
  if p ? 'reporting_manager_id' and v_mgr is not null
     and v_mgr is distinct from v_old.reporting_manager_id then
    if v_mgr = p_id then
      raise exception 'An employee cannot report to themselves.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.ep_employees where id = v_mgr and is_active) then
      raise exception 'Choose an active employee as reporting manager.' using errcode = '22023';
    end if;
    v_walk := v_mgr;
    while v_walk is not null and v_depth < 100 loop
      if v_walk = p_id then
        raise exception 'That would make a loop: this employee is above the chosen manager.' using errcode = '22023';
      end if;
      select reporting_manager_id into v_walk from public.ep_employees where id = v_walk;
      v_depth := v_depth + 1;
    end loop;
  end if;

  -- Typed manager name (someone who is not in the portal). A portal manager replaces it.
  v_mgr_name := case when p ? 'reporting_manager_name' then nullif(btrim(coalesce(p ->> 'reporting_manager_name', '')), '')
                     else v_old.reporting_manager_name end;
  if v_mgr is not null then
    v_mgr_name := null;
  end if;
  if length(v_mgr_name) > 120 then
    raise exception 'Manager name must be at most 120 characters.' using errcode = '22023';
  end if;

  update public.ep_employees set
    full_name            = case when p ? 'full_name' then btrim(p ->> 'full_name') else full_name end,
    department           = case when p ? 'department' then nullif(btrim(p ->> 'department'), '') else department end,
    designation          = case when p ? 'designation' then nullif(btrim(p ->> 'designation'), '') else designation end,
    employee_code        = v_code,
    reporting_manager_id = v_mgr,
    reporting_manager_name = v_mgr_name,
    date_of_joining      = case when p ? 'date_of_joining' then nullif(btrim(p ->> 'date_of_joining'), '')::date else date_of_joining end,
    employment_type      = case when p ? 'employment_type' then nullif(btrim(p ->> 'employment_type'), '') else employment_type end,
    work_location        = case when p ? 'work_location' then nullif(btrim(p ->> 'work_location'), '') else work_location end,
    updated_at           = now()
  where id = p_id
  returning * into v_new;

  if v_new.employee_code is distinct from v_old.employee_code then
    perform public.ep_notify(
      p_id, 'message', 'Your Employee ID was changed',
      'Your Employee ID is now ' || v_new.employee_code || ' (was ' || v_old.employee_code
        || '). You still sign in with the same email and password.',
      '/employee/profile');
  end if;

  -- Tell the people concerned when the reporting line changes.
  if v_new.reporting_manager_id is distinct from v_old.reporting_manager_id then
    if v_new.reporting_manager_id is not null then
      perform public.ep_notify(
        p_id, 'message', 'Your reporting manager was updated',
        'You now report to ' || (select full_name from public.ep_employees where id = v_new.reporting_manager_id) || '.',
        '/employee/profile');
      perform public.ep_notify(
        v_new.reporting_manager_id, 'message', v_new.full_name || ' now reports to you',
        v_new.full_name || ' (' || v_new.employee_code || ') was added to your team by the admin.',
        null);
    elsif v_new.reporting_manager_name is null then
      perform public.ep_notify(
        p_id, 'message', 'Your reporting manager was removed',
        'No reporting manager is set for you right now.', '/employee/profile');
    end if;
  end if;

  -- A typed (non-portal) manager set or changed: tell the employee.
  if v_new.reporting_manager_id is null and v_new.reporting_manager_name is not null
     and v_new.reporting_manager_name is distinct from v_old.reporting_manager_name then
    perform public.ep_notify(
      p_id, 'message', 'Your reporting manager was updated',
      'You now report to ' || v_new.reporting_manager_name || '.', '/employee/profile');
  end if;

  return public.ep_admin_employee(p_id);
end $function$;

-- public.ep_apply_leave
CREATE OR REPLACE FUNCTION public.ep_apply_leave(p_type text, p_start date, p_end date, p_half text, p_reason text, p_manager_id uuid, p_manager_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp     uuid := public.ep_current_employee_id();
  v_today   date := (timezone('Asia/Kolkata', now()))::date;
  v_name    text;
  v_type    public.ep_leave_types;
  v_days    numeric;
  v_allowed numeric;
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_half    text := nullif(p_half, '');
  v_mgr     uuid := p_manager_id;
  v_mgrname text := nullif(btrim(coalesce(p_manager_name, '')), '');
  v_row     public.ep_leave_requests;
  v_rev     uuid;
begin
  perform public.rbac_require('emp.leave.create'); -- rbac
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  select * into v_type from public.ep_leave_types where code = p_type and is_active;
  if v_type.code is null then
    raise exception 'Choose a leave type.' using errcode = '22023';
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'Choose a valid start and end date.' using errcode = '22023';
  end if;
  if extract(year from p_start) <> extract(year from p_end) then
    raise exception 'A leave request cannot cross into the next year. Apply for each year separately.' using errcode = '22023';
  end if;
  if p_start < v_today - 30 or p_end > v_today + 365 then
    raise exception 'Leave can start at most 30 days ago and end at most one year ahead.' using errcode = '22023';
  end if;
  if v_half is not null and (v_half not in ('first_half', 'second_half') or p_start <> p_end) then
    raise exception 'A half day must be a single date.' using errcode = '22023';
  end if;
  if length(v_reason) not between 1 and 1000 then
    raise exception 'Write a reason (up to 1000 characters).' using errcode = '22023';
  end if;

  -- Reporting manager: a picked colleague (must be active, not yourself) and/or a typed name.
  if v_mgr is not null then
    select full_name into v_mgrname from public.ep_employees where id = v_mgr and is_active and id <> v_emp;
    if v_mgrname is null then
      raise exception 'Choose a valid reporting manager.' using errcode = '22023';
    end if;
  end if;
  if v_mgrname is null then
    raise exception 'Enter your reporting manager.' using errcode = '22023';
  end if;
  if length(v_mgrname) > 120 then
    raise exception 'Reporting manager name must be at most 120 characters.' using errcode = '22023';
  end if;

  select full_name into v_name from public.ep_employees where id = v_emp;

  perform pg_advisory_xact_lock(hashtextextended('leave' || v_emp::text, 0));

  v_days := public.ep_leave_day_count(p_start, p_end, v_half);
  if v_days = 0 then
    raise exception 'These dates are only Sundays or company holidays, so no leave is needed.' using errcode = '22023';
  end if;
  if exists (select 1 from public.ep_leave_requests r
              where r.employee_id = v_emp and r.status in ('manager_review', 'pending', 'manager_pending', 'approved')
                and r.start_date <= p_end and r.end_date >= p_start
                and not (r.start_date = r.end_date and p_start = p_end and r.half_day is not null and v_half is not null
                         and r.half_day <> v_half)) then
    raise exception 'You already have leave on some of these dates.' using errcode = '22023';
  end if;
  v_allowed := public.ep_leave_allowance(v_emp, extract(year from p_start)::int, p_type);
  if v_type.is_paid and v_allowed is not null
     and public.ep_leave_taken(v_emp, extract(year from p_start)::int, p_type) + v_days > v_allowed then
    raise exception 'Not enough % balance: % day(s) left, % requested.', v_type.name,
      greatest(v_allowed - public.ep_leave_taken(v_emp, extract(year from p_start)::int, p_type), 0), v_days
      using errcode = '22023';
  end if;

  -- Who reviews first: the profile's reporting manager (active portal account), else the colleague
  -- picked on the form. With a reviewing manager the request starts with them (manager_review);
  -- without one it goes straight to the admin (pending).
  select m.id into v_rev
    from public.ep_employees e join public.ep_employees m on m.id = e.reporting_manager_id
   where e.id = v_emp and m.is_active and m.id <> v_emp
     and public.rbac_user_can(m.user_id, 'team.leave.approve');
  if v_rev is null and v_mgr is not null
     and public.rbac_user_can((select user_id from public.ep_employees where id = v_mgr), 'team.leave.approve') then
    v_rev := v_mgr;
  end if;

  insert into public.ep_leave_requests
    (employee_id, leave_type, start_date, end_date, half_day, days, reason, approver_id, approver_name, status)
  values (v_emp, p_type, p_start, p_end, v_half, v_days, v_reason, coalesce(v_rev, v_mgr), v_mgrname,
          case when v_rev is not null then 'manager_review' else 'pending' end)
  returning * into v_row;

  -- Only a colleague in the portal can be notified.
  perform public.ep_notify(v_rev, 'leave',
    v_name || ' applied for ' || v_type.name || ' — please review',
    to_char(p_start, 'DD Mon') || case when p_end <> p_start then ' – ' || to_char(p_end, 'DD Mon YYYY') else to_char(p_start, ' YYYY') end
      || ' · ' || v_days || ' day(s) · ' || left(v_reason, 200)
      || ' · review it and send it to the admin (or reject it) in Team requests.',
    '/employee/leave/team');
  return public.ep_leave_json(v_row);
end $function$;

-- public.ep_cancel_leave
CREATE OR REPLACE FUNCTION public.ep_cancel_leave(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp   uuid := public.ep_current_employee_id();
  v_row   public.ep_leave_requests;
  v_name  text;
begin
  perform public.rbac_require('emp.leave.delete'); -- rbac
  select * into v_row from public.ep_leave_requests where id = p_id and employee_id = v_emp for update;
  if v_emp is null or v_row.id is null then
    raise exception 'Leave request not found.' using errcode = '42501';
  end if;
  -- Once the admin has approved or rejected it, the employee can no longer cancel it.
  if v_row.status = 'manager_pending' then
    raise exception 'The admin already approved this leave and it is now with your reporting manager, so it can no longer be cancelled. Please contact the admin.'
      using errcode = 'P0001';
  end if;
  if v_row.status not in ('manager_review', 'pending') then
    raise exception 'This leave was already % by the admin, so it can no longer be cancelled. Please contact the admin.',
      v_row.status using errcode = 'P0001';
  end if;
  update public.ep_leave_requests set status = 'cancelled', updated_at = now() where id = p_id returning * into v_row;
  select full_name into v_name from public.ep_employees where id = v_emp;
  perform public.ep_notify(v_row.approver_id, 'leave',
    v_name || ' cancelled a leave request',
    to_char(v_row.start_date, 'DD Mon YYYY') || case when v_row.end_date <> v_row.start_date then ' – ' || to_char(v_row.end_date, 'DD Mon YYYY') else '' end,
    '/employee/leave');
  return public.ep_leave_json(v_row);
end $function$;

-- public.ep_decide_leave
CREATE OR REPLACE FUNCTION public.ep_decide_leave(p_id uuid, p_action text, p_comment text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp     uuid := public.ep_current_employee_id();
  v_row     public.ep_leave_requests;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_allowed numeric;
  v_type    public.ep_leave_types;
  v_me      text;
  v_what    text;
begin
  perform public.rbac_require('team.leave.approve'); -- rbac
  select r.* into v_row from public.ep_leave_requests r join public.ep_employees e on e.id = r.employee_id
   where r.id = p_id and (r.approver_id = v_emp or e.reporting_manager_id = v_emp) and r.employee_id <> v_emp
   for update of r;
  if v_emp is null or v_row.id is null then
    raise exception 'Leave request not found.' using errcode = '42501';
  end if;
  if v_row.status = 'pending' then
    raise exception 'This request is with the admin now.' using errcode = 'P0001';
  end if;
  if v_row.status not in ('manager_review', 'manager_pending') then
    raise exception 'This request was already %.', v_row.status using errcode = 'P0001';
  end if;
  if v_row.status = 'manager_review' and p_action not in ('forward', 'rejected') then
    raise exception 'Send it to the admin or reject it.' using errcode = '22023';
  end if;
  if v_row.status = 'manager_pending' and p_action not in ('approved', 'rejected') then
    raise exception 'Invalid action.' using errcode = '22023';
  end if;
  if p_action = 'rejected' and v_comment is null then
    raise exception 'Write a reason for rejecting.' using errcode = '22023';
  end if;
  if coalesce(length(v_comment), 0) > 1000 then
    raise exception 'Comment must be at most 1000 characters.' using errcode = '22023';
  end if;
  select * into v_type from public.ep_leave_types where code = v_row.leave_type;
  select full_name into v_me from public.ep_employees where id = v_emp;
  v_what := v_type.name || ' · ' || to_char(v_row.start_date, 'DD Mon YYYY')
    || case when v_row.end_date <> v_row.start_date then ' – ' || to_char(v_row.end_date, 'DD Mon YYYY') else '' end;

  if p_action = 'forward' then
    update public.ep_leave_requests
       set status = 'pending', approver_id = v_emp, manager_reviewed_by = v_emp, manager_reviewed_at = now(),
           manager_review_comment = v_comment, updated_at = now()
     where id = p_id returning * into v_row;
    perform public.ep_notify(v_row.employee_id, 'leave',
      'Your manager sent your leave to the admin',
      v_what || ' · reviewed by ' || v_me || ' · now waiting for the admin', '/employee/leave', 'normal');
    return public.ep_leave_json(v_row);
  end if;

  if p_action = 'approved' then
    -- The balance may have changed since the admin approved; check again without this request.
    v_allowed := public.ep_leave_allowance(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type);
    if v_type.is_paid and v_allowed is not null
       and public.ep_leave_taken(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type, v_row.id)
           + v_row.days > v_allowed then
      raise exception 'Not enough % balance left to approve this.', v_type.name using errcode = '22023';
    end if;
  end if;
  update public.ep_leave_requests
     set status = p_action, decided_by = v_emp, decided_at = now(), decision_comment = v_comment,
         manager_reviewed_by = coalesce(manager_reviewed_by, v_emp),
         manager_reviewed_at = coalesce(manager_reviewed_at, now()),
         updated_at = now()
   where id = p_id returning * into v_row;
  perform public.ep_notify(v_row.employee_id, 'leave',
    'Your leave was ' || p_action,
    v_what || case when p_action = 'rejected' then coalesce(' · ' || v_comment, '') else '' end,
    '/employee/leave', case when p_action = 'rejected' then 'urgent' else 'normal' end);
  return public.ep_leave_json(v_row);
end $function$;

-- public.ep_delete_my_document
CREATE OR REPLACE FUNCTION public.ep_delete_my_document(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp  uuid := public.ep_current_employee_id();
  v_path text;
begin
  perform public.rbac_require('emp.documents.delete'); -- rbac
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  delete from public.ep_employee_documents where id = p_id and employee_id = v_emp returning storage_path into v_path;
  if v_path is null then
    raise exception 'Document not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('old_path', v_path);
end $function$;

-- public.ep_message_options
CREATE OR REPLACE FUNCTION public.ep_message_options()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_admin boolean := public.rbac_can('portal.notifications.create');
  v_emp   uuid    := public.ep_current_employee_id();
begin
  if not v_admin and v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'can_all',  v_admin,
    'can_team', v_emp is not null and exists (select 1 from public.ep_employees where reporting_manager_id = v_emp and is_active),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
                                          'designation', e.designation, 'department', e.department,
                                          'is_my_team', e.reporting_manager_id is not distinct from v_emp and v_emp is not null)
             order by e.full_name)
      from public.ep_employees e where e.is_active and e.id is distinct from v_emp), '[]'::jsonb));
end $function$;

-- public.ep_post_update
CREATE OR REPLACE FUNCTION public.ep_post_update(p_project uuid, p_body text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp uuid := public.ep_current_employee_id();
  v_id  uuid;
begin
  perform public.rbac_require('emp.projects.edit'); -- rbac
  if v_emp is null or not exists (select 1 from public.ep_project_members where project_id = p_project and employee_id = v_emp) then
    raise exception 'You are not on this project.' using errcode = '42501';
  end if;
  insert into public.ep_project_updates (project_id, author_id, body)
  values (p_project, v_emp, btrim(p_body))
  returning id into v_id;
  return v_id;
end $function$;

-- public.ep_punch_in
CREATE OR REPLACE FUNCTION public.ep_punch_in()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp uuid;
  v_row public.ep_attendance;
begin
  perform public.rbac_require('emp.attendance.create'); -- rbac
  select id into v_emp from public.ep_employees where user_id = auth.uid() and is_active;
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_emp::text, 0));
  perform public.ep_close_overdue_sessions(v_emp);
  if exists (select 1 from public.ep_attendance where employee_id = v_emp and punch_out_at is null) then
    raise exception 'You are already punched in.' using errcode = 'P0001';
  end if;
  insert into public.ep_attendance (employee_id) values (v_emp) returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'punch_in_at', v_row.punch_in_at, 'work_date', v_row.work_date);
end $function$;

-- public.ep_punch_out
CREATE OR REPLACE FUNCTION public.ep_punch_out()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp uuid;
  v_row public.ep_attendance;
begin
  perform public.rbac_require('emp.attendance.create'); -- rbac
  select id into v_emp from public.ep_employees where user_id = auth.uid() and is_active;
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_emp::text, 0));
  -- Already past the cut-off: keep the automatic punch out time (not now()).
  -- No exception here, it would roll the automatic punch out back.
  if public.ep_close_overdue_sessions(v_emp) > 0 then
    select * into v_row from public.ep_attendance
     where employee_id = v_emp and auto_punched_out order by punch_out_at desc limit 1;
    return jsonb_build_object('id', v_row.id, 'punch_in_at', v_row.punch_in_at, 'punch_out_at', v_row.punch_out_at,
                              'auto_punched_out', true);
  end if;
  update public.ep_attendance
     set punch_out_at = now()
   where employee_id = v_emp and punch_out_at is null
  returning * into v_row;
  if v_row.id is null then
    raise exception 'You are not punched in.' using errcode = 'P0001';
  end if;
  return jsonb_build_object('id', v_row.id, 'punch_in_at', v_row.punch_in_at, 'punch_out_at', v_row.punch_out_at);
end $function$;

-- public.ep_request_correction
CREATE OR REPLACE FUNCTION public.ep_request_correction(p_date date, p_attendance uuid, p_in timestamp with time zone, p_out timestamp with time zone, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp uuid := public.ep_current_employee_id();
  v_chk record;
  v_att public.ep_attendance;
  v_row public.ep_attendance_corrections;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform public.rbac_require('emp.attendance.edit'); -- rbac
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if length(v_reason) not between 1 and 500 then
    raise exception 'Write a reason (up to 500 characters).' using errcode = '22023';
  end if;
  if exists (select 1 from public.ep_attendance_corrections
              where employee_id = v_emp and work_date = p_date and status = 'pending') then
    raise exception 'You already have a pending correction for this day.' using errcode = '23505';
  end if;
  select * into v_chk from public.ep_correction_check(v_emp, p_date, p_attendance, p_in, p_out);
  if p_attendance is not null then
    select * into v_att from public.ep_attendance where id = p_attendance;
  end if;
  insert into public.ep_attendance_corrections
    (employee_id, work_date, attendance_id, requested_in, requested_out, old_in, old_out, reason)
  values (v_emp, p_date, p_attendance,
          case when p_attendance is null or p_in is distinct from v_att.punch_in_at then p_in end,
          case when p_attendance is null or p_out is distinct from v_att.punch_out_at then p_out end,
          v_att.punch_in_at, v_att.punch_out_at, v_reason)
  returning * into v_row;
  if v_row.requested_in is null and v_row.requested_out is null then
    raise exception 'The times are the same as now — nothing to correct.' using errcode = '22023';
  end if;
  return public.ep_correction_json(v_row);
end $function$;

-- public.ep_review_report
CREATE OR REPLACE FUNCTION public.ep_review_report(p_report uuid, p_action text, p_comment text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp     uuid := public.ep_current_employee_id();
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_status  text;
begin
  perform public.rbac_require('team.reports.approve'); -- rbac
  select r.status into v_status
    from public.ep_work_reports r join public.ep_employees e on e.id = r.employee_id
   where r.id = p_report and r.status <> 'draft'
     and (r.submitted_to = v_emp or e.reporting_manager_id = v_emp)
   for update of r;
  if v_emp is null or v_status is null then
    raise exception 'Report not found.' using errcode = '42501';
  end if;
  if v_status <> 'submitted' then
    raise exception 'Only a submitted report can be reviewed.' using errcode = 'P0001';
  end if;
  if p_action not in ('reviewed', 'returned') then
    raise exception 'Invalid action.' using errcode = '22023';
  end if;
  if p_action = 'returned' and v_comment is null then
    raise exception 'Write a comment saying what needs to change.' using errcode = '22023';
  end if;
  if coalesce(length(v_comment), 0) > 1000 then
    raise exception 'Comment must be at most 1000 characters.' using errcode = '22023';
  end if;
  update public.ep_work_reports
     set status = p_action, reviewed_by = v_emp, reviewed_at = now(), review_comment = v_comment, updated_at = now()
   where id = p_report;
  return public.ep_report_json(p_report);
end $function$;

-- public.ep_save_my_report
CREATE OR REPLACE FUNCTION public.ep_save_my_report(p_date date, p_notes text, p_items jsonb, p_submit boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp    uuid := public.ep_current_employee_id();
  v_today  date := (timezone('Asia/Kolkata', now()))::date;
  v_mgr    uuid;
  v_rep    public.ep_work_reports;
  v_item   jsonb;
  v_pid    uuid;
  v_hours  numeric;
  v_total  numeric := 0;
  v_seen   uuid[] := '{}';
  v_pos    int := 0;
  v_notes  text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  perform public.rbac_require('emp.reports.create'); -- rbac
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if p_date is null or p_date > v_today then
    raise exception 'You cannot write a report for a future date.' using errcode = '22023';
  end if;
  if p_date < v_today - 7 then
    raise exception 'Reports can only be written for today and the last 7 days.' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Invalid report entries.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 20 then
    raise exception 'A report can have at most 20 project entries.' using errcode = '22023';
  end if;
  if coalesce(length(v_notes), 0) > 2000 then
    raise exception 'Notes must be at most 2000 characters.' using errcode = '22023';
  end if;
  if p_submit and jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one project entry before submitting.' using errcode = '22023';
  end if;

  select reporting_manager_id into v_mgr from public.ep_employees where id = v_emp;
  -- No reporting manager in the portal: the report is submitted to the admin (submitted_to stays null).

  -- Serialise saves of the same report.
  perform pg_advisory_xact_lock(hashtextextended(v_emp::text || p_date::text, 0));
  select * into v_rep from public.ep_work_reports where employee_id = v_emp and report_date = p_date;
  if v_rep.id is not null and v_rep.status in ('submitted', 'reviewed') then
    raise exception 'This report is already submitted and cannot be changed.' using errcode = 'P0001';
  end if;

  -- Validate every entry before writing anything.
  for v_item in select * from jsonb_array_elements(p_items) loop
    begin
      v_pid   := (v_item ->> 'project_id')::uuid;
      v_hours := (v_item ->> 'hours')::numeric;
    exception when others then
      raise exception 'Invalid report entries.' using errcode = '22023';
    end;
    if v_pid is null or not exists (select 1 from public.ep_project_members where project_id = v_pid and employee_id = v_emp) then
      raise exception 'You can only report on projects you are assigned to.' using errcode = '42501';
    end if;
    if v_pid = any (v_seen) then
      raise exception 'Each project can be added only once per report.' using errcode = '22023';
    end if;
    v_seen := v_seen || v_pid;
    if v_hours is null or v_hours <= 0 or v_hours > 24 or v_hours <> round(v_hours, 2) then
      raise exception 'Hours spent must be more than 0 and at most 24 for each project.' using errcode = '22023';
    end if;
    v_total := v_total + v_hours;
    if coalesce(btrim(v_item ->> 'task_updates'), '') = '' and coalesce(btrim(v_item ->> 'completed_work'), '') = ''
       and coalesce(btrim(v_item ->> 'pending_work'), '') = '' then
      raise exception 'Write what you worked on for every project you added.' using errcode = '22023';
    end if;
    if greatest(length(v_item ->> 'task_updates'), length(v_item ->> 'completed_work'), length(v_item ->> 'pending_work')) > 2000 then
      raise exception 'Each text box can have at most 2000 characters.' using errcode = '22023';
    end if;
  end loop;
  if v_total > 24 then
    raise exception 'Total hours for the day cannot be more than 24.' using errcode = '22023';
  end if;

  if v_rep.id is null then
    insert into public.ep_work_reports (employee_id, report_date, notes)
    values (v_emp, p_date, v_notes) returning * into v_rep;
  else
    update public.ep_work_reports set notes = v_notes, updated_at = now() where id = v_rep.id;
  end if;

  delete from public.ep_work_report_items where report_id = v_rep.id;
  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.ep_work_report_items (report_id, project_id, task_updates, completed_work, pending_work, hours, position)
    values (v_rep.id, (v_item ->> 'project_id')::uuid,
            nullif(btrim(coalesce(v_item ->> 'task_updates', '')), ''),
            nullif(btrim(coalesce(v_item ->> 'completed_work', '')), ''),
            nullif(btrim(coalesce(v_item ->> 'pending_work', '')), ''),
            (v_item ->> 'hours')::numeric, v_pos);
    v_pos := v_pos + 1;
  end loop;

  if p_submit then
    update public.ep_work_reports
       set status = 'submitted', submitted_to = v_mgr, submitted_at = now(), updated_at = now(),
           reviewed_by = null, reviewed_at = null, review_comment = null
     where id = v_rep.id;
  end if;

  return public.ep_my_report(p_date);
end $function$;

-- public.ep_send_message
CREATE OR REPLACE FUNCTION public.ep_send_message(p_audience text, p_to uuid[], p_title text, p_body text, p_priority text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_admin  boolean := public.rbac_can('portal.notifications.create');
  v_emp    uuid    := public.ep_current_employee_id();
  v_label  text;
  v_msg    uuid    := gen_random_uuid();
  v_title  text    := btrim(coalesce(p_title, ''));
  v_body   text    := nullif(btrim(coalesce(p_body, '')), '');
  v_n      integer;
begin
  if not v_admin and v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if length(v_title) not between 1 and 150 then
    raise exception 'Subject must be 1 to 150 characters.' using errcode = '22023';
  end if;
  if coalesce(length(v_body), 0) > 2000 then
    raise exception 'Message must be at most 2000 characters.' using errcode = '22023';
  end if;
  if coalesce(p_priority, '') not in ('normal', 'urgent') then
    raise exception 'Invalid priority.' using errcode = '22023';
  end if;
  if p_audience = 'all' and not v_admin then
    raise exception 'Only an admin can message everyone.' using errcode = '42501';
  end if;
  if p_audience = 'team' and (v_emp is null
       or not exists (select 1 from public.ep_employees where reporting_manager_id = v_emp and is_active)) then
    raise exception 'You do not have a team to message.' using errcode = '42501';
  end if;
  if p_audience = 'people' and (p_to is null or cardinality(p_to) = 0) then
    raise exception 'Choose at least one person.' using errcode = '22023';
  end if;
  if p_audience = 'people' and cardinality(p_to) > 100 then
    raise exception 'Choose at most 100 people.' using errcode = '22023';
  end if;
  if p_audience not in ('people', 'team', 'all') then
    raise exception 'Invalid audience.' using errcode = '22023';
  end if;
  if not v_admin and p_audience = 'team' and not public.rbac_can('team.messages.create') then -- rbac
    raise exception 'You do not have permission to message your team.' using errcode = '42501';
  end if;
  if not v_admin and p_audience = 'people' and not public.rbac_can('emp.messages.create') then -- rbac
    raise exception 'You do not have permission to send messages.' using errcode = '42501';
  end if;

  -- The sender's own employee name when they are an employee, else "Admin".
  select coalesce((select full_name from public.ep_employees where id = v_emp), 'Admin') into v_label;
  if v_admin and v_emp is null then
    v_label := 'Admin';
  end if;

  insert into public.ep_notifications
    (employee_id, kind, priority, title, body, sender_employee_id, sender_user_id, sender_label, message_id)
  select e.id, 'message', p_priority, v_title, v_body, v_emp, auth.uid(), v_label, v_msg
    from public.ep_employees e
   where e.is_active
     and e.id is distinct from v_emp
     and case p_audience
           when 'all'    then true
           when 'team'   then e.reporting_manager_id = v_emp
           else e.id = any (p_to)
         end;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'None of the chosen people can receive messages.' using errcode = '22023';
  end if;
  return jsonb_build_object('message_id', v_msg, 'recipients', v_n);
end $function$;

-- public.ep_sent_messages
CREATE OR REPLACE FUNCTION public.ep_sent_messages()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null or (not public.rbac_can('portal.notifications.view') and public.ep_current_employee_id() is null) then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(m.j order by m.created_at desc)
    from (
      select min(n.created_at) as created_at,
             jsonb_build_object(
               'message_id', n.message_id, 'title', min(n.title), 'body', min(n.body), 'priority', min(n.priority),
               'created_at', min(n.created_at), 'recipients', count(*), 'read', count(n.read_at),
               'to', (array_agg(e.full_name order by e.full_name))[1:5]) as j
      from public.ep_notifications n join public.ep_employees e on e.id = n.employee_id
      where n.sender_user_id = auth.uid() and n.message_id is not null
        and n.created_at > now() - interval '90 days'
      group by n.message_id
      order by min(n.created_at) desc
      limit 100) m), '[]'::jsonb);
end $function$;

-- public.ep_set_project_delay_reason
CREATE OR REPLACE FUNCTION public.ep_set_project_delay_reason(p_project uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp    uuid := public.ep_current_employee_id();
  v_proj   public.pt_projects;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_today  date := (timezone('Asia/Kolkata', now()))::date;
begin
  perform public.rbac_require('emp.projects.edit'); -- rbac
  if v_emp is null or not exists (select 1 from public.ep_project_members where project_id = p_project and employee_id = v_emp) then
    raise exception 'You are not on this project.' using errcode = '42501';
  end if;
  if length(v_reason) not between 1 and 1000 then
    raise exception 'Write the reason (up to 1000 characters).' using errcode = '22023';
  end if;
  select * into v_proj from public.pt_projects where id = p_project;
  if v_proj.end_date is null
     or not coalesce((v_proj.end_date < v_today and public.ep_project_is_running(v_proj.status))
                     or v_proj.completed_date > v_proj.end_date, false) then
    raise exception 'This project has not missed its deadline.' using errcode = 'P0001';
  end if;
  insert into public.ep_project_delay_reasons (project_id, employee_id, deadline, reason)
  values (p_project, v_emp, v_proj.end_date, v_reason)
  on conflict (project_id, employee_id, deadline) do update set reason = excluded.reason, updated_at = now();
end $function$;

-- public.ep_set_task_delay_reason
CREATE OR REPLACE FUNCTION public.ep_set_task_delay_reason(p_task uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp    uuid := public.ep_current_employee_id();
  v_task   public.ep_project_tasks;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform public.rbac_require('emp.projects.edit'); -- rbac
  select * into v_task from public.ep_project_tasks where id = p_task;
  if v_emp is null or v_task.id is null
     or not exists (select 1 from public.ep_project_members where project_id = v_task.project_id and employee_id = v_emp) then
    raise exception 'You are not on this project.' using errcode = '42501';
  end if;
  if length(v_reason) not between 1 and 1000 then
    raise exception 'Write the reason (up to 1000 characters).' using errcode = '22023';
  end if;
  if v_task.due_date is null
     or v_task.due_date >= coalesce((timezone('Asia/Kolkata', v_task.completed_at))::date,
                                    (timezone('Asia/Kolkata', now()))::date) then
    raise exception 'This task is not late.' using errcode = 'P0001';
  end if;
  update public.ep_project_tasks
     set delay_reason = v_reason, delay_reason_by = v_emp, delay_reason_at = now(), updated_at = now()
   where id = p_task;
end $function$;

-- public.ep_set_task_status
CREATE OR REPLACE FUNCTION public.ep_set_task_status(p_task uuid, p_status text, p_delay_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp    uuid := public.ep_current_employee_id();
  v_task   public.ep_project_tasks;
  v_today  date := (timezone('Asia/Kolkata', now()))::date;
  v_reason text := nullif(btrim(coalesce(p_delay_reason, '')), '');
begin
  perform public.rbac_require('emp.projects.edit'); -- rbac
  select * into v_task from public.ep_project_tasks where id = p_task;
  if v_emp is null or v_task.id is null
     or not exists (select 1 from public.ep_project_members where project_id = v_task.project_id and employee_id = v_emp) then
    raise exception 'You are not on this project.' using errcode = '42501';
  end if;
  if coalesce(length(v_reason), 0) > 1000 then
    raise exception 'The reason must be at most 1000 characters.' using errcode = '22023';
  end if;
  if p_status = 'done' and v_task.status <> 'done' and v_task.due_date < v_today
     and v_task.delay_reason is null and v_reason is null then
    raise exception 'This task is past its deadline (%). Write why it is late to mark it done.',
      to_char(v_task.due_date, 'DD Mon YYYY') using errcode = 'P0001', hint = 'delay_reason_required';
  end if;
  update public.ep_project_tasks
     set status = p_status,
         updated_at = now(),
         completed_at = case when p_status = 'done' then coalesce(completed_at, now()) else null end,
         delay_reason    = coalesce(v_reason, delay_reason),
         delay_reason_by = case when v_reason is not null then v_emp else delay_reason_by end,
         delay_reason_at = case when v_reason is not null then now() else delay_reason_at end
   where id = p_task;
end $function$;

-- public.ep_team_leave
CREATE OR REPLACE FUNCTION public.ep_team_leave()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp   uuid := public.ep_current_employee_id();
  v_today date := (timezone('Asia/Kolkata', now()))::date;
begin
  if not public.rbac_can('team.leave.view') then -- rbac
    return jsonb_build_object('team_size', 0, 'requests', '[]'::jsonb);
  end if;
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'team_size', (select count(*) from public.ep_employees where reporting_manager_id = v_emp and is_active),
    'requests', coalesce((
      select jsonb_agg(public.ep_leave_json(r)
               order by (r.status in ('manager_review', 'manager_pending')) desc, r.start_date desc)
      from public.ep_leave_requests r join public.ep_employees e on e.id = r.employee_id
      where r.employee_id <> v_emp
        and (r.approver_id = v_emp or e.reporting_manager_id = v_emp or r.decided_by = v_emp or r.manager_reviewed_by = v_emp)
        and (r.status in ('manager_review', 'manager_pending')
             or (r.status = 'pending' and r.manager_reviewed_by = v_emp)
             or ((r.decided_by = v_emp or r.manager_reviewed_by = v_emp) and r.end_date >= v_today - 90))), '[]'::jsonb));
end $function$;

-- public.ep_team_report
CREATE OR REPLACE FUNCTION public.ep_team_report(p_report uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp uuid := public.ep_current_employee_id();
begin
  perform public.rbac_require('team.reports.view'); -- rbac
  if v_emp is null or not exists (
       select 1 from public.ep_work_reports r join public.ep_employees e on e.id = r.employee_id
        where r.id = p_report and r.status <> 'draft'
          and (r.submitted_to = v_emp or e.reporting_manager_id = v_emp)) then
    raise exception 'Report not found.' using errcode = '42501';
  end if;
  return public.ep_report_json(p_report);
end $function$;

-- public.ep_team_reports
CREATE OR REPLACE FUNCTION public.ep_team_reports()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp   uuid := public.ep_current_employee_id();
  v_today date := (timezone('Asia/Kolkata', now()))::date;
begin
  perform public.rbac_require('team.reports.view'); -- rbac
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'team', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
                                          'designation', e.designation) order by e.full_name)
      from public.ep_employees e where e.reporting_manager_id = v_emp and e.is_active), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'report_date', r.report_date, 'status', r.status,
               'submitted_at', r.submitted_at, 'reviewed_at', r.reviewed_at,
               'employee', jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code),
               'projects', (select count(*) from public.ep_work_report_items i where i.report_id = r.id),
               'total_hours', coalesce((select sum(i.hours) from public.ep_work_report_items i where i.report_id = r.id), 0))
             order by (r.status = 'submitted') desc, r.report_date desc, e.full_name)
      from public.ep_work_reports r join public.ep_employees e on e.id = r.employee_id
      where r.status <> 'draft'
        and (r.submitted_to = v_emp or e.reporting_manager_id = v_emp)
        and r.report_date >= v_today - 60), '[]'::jsonb)
  );
end $function$;

-- public.pt_credentials_export_passwords
CREATE OR REPLACE FUNCTION public.pt_credentials_export_passwords(p_credential_ids uuid[])
 RETURNS TABLE(credential_id uuid, password text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ids    uuid[] := array(select distinct x from unnest(coalesce(p_credential_ids, array[]::uuid[])) as x where x is not null);
  v_count  integer := cardinality(v_ids);
  v_recent integer;
  v_cred   public.pt_credentials;
begin
  perform pt_private.require_admin();
  perform public.rbac_require('projects.logins.export'); -- rbac action
  if not pt_private.signed_in_within(600) then
    raise exception 'PT_REAUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if v_count = 0 then
    return;
  end if;
  if v_count > 500 then
    raise exception 'PT_TOO_MANY' using errcode = 'P0001';
  end if;

  select count(*) into v_recent
    from public.pt_credential_events
   where actor = auth.uid()
     and action = 'password_exported'
     and created_at > now() - interval '10 minutes';
  if v_recent + v_count > 1000 then
    raise exception 'PT_RATE_LIMITED' using errcode = 'P0001';
  end if;

  for v_cred in
    select c.* from public.pt_credentials c
     where c.id = any (v_ids) and c.has_password
  loop
    credential_id := v_cred.id;
    select d.decrypted_secret into password
      from pt_private.credential_secrets s
      join vault.decrypted_secrets d on d.id = s.secret_id
     where s.credential_id = v_cred.id;
    if password is not null then
      perform pt_private.log_credential_event(v_cred, 'password_exported');
      return next;
    end if;
  end loop;
end;
$function$;

-- public.pt_credential_remove_password
CREATE OR REPLACE FUNCTION public.pt_credential_remove_password(p_credential_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_cred public.pt_credentials;
begin
  perform pt_private.require_admin();
  perform public.rbac_require('projects.logins.edit'); -- rbac action
  select * into v_cred from public.pt_credentials where id = p_credential_id for update;
  if not found then
    raise exception 'PT_NOT_FOUND' using errcode = 'P0001';
  end if;
  delete from pt_private.credential_secrets where credential_id = p_credential_id; -- trigger deletes the vault secret

  perform set_config('pt.password_write', 'on', true);
  update public.pt_credentials
     set has_password = false, password_updated_at = now(), password_updated_by = auth.uid()
   where id = p_credential_id;
  perform set_config('pt.password_write', 'off', true);

  if v_cred.has_password then
    perform pt_private.log_credential_event(v_cred, 'password_removed');
  end if;
end;
$function$;

-- public.pt_credential_reveal_password
CREATE OR REPLACE FUNCTION public.pt_credential_reveal_password(p_credential_id uuid, p_purpose text DEFAULT 'view'::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_cred   public.pt_credentials;
  v_secret uuid;
  v_value  text;
  v_recent integer;
begin
  perform pt_private.require_admin();
  perform public.rbac_require('projects.logins.reveal'); -- rbac action
  if not pt_private.signed_in_within(600) then
    raise exception 'PT_REAUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select count(*) into v_recent
    from public.pt_credential_events
   where actor = auth.uid()
     and action in ('password_viewed', 'password_copied')
     and created_at > now() - interval '10 minutes';
  if v_recent >= 30 then
    raise exception 'PT_RATE_LIMITED' using errcode = 'P0001';
  end if;

  select * into v_cred from public.pt_credentials where id = p_credential_id;
  if not found then
    raise exception 'PT_NOT_FOUND' using errcode = 'P0001';
  end if;
  select secret_id into v_secret from pt_private.credential_secrets where credential_id = p_credential_id;
  if v_secret is null then
    raise exception 'PT_NO_PASSWORD' using errcode = 'P0001';
  end if;
  select decrypted_secret into v_value from vault.decrypted_secrets where id = v_secret;
  if v_value is null then
    raise exception 'PT_NO_PASSWORD' using errcode = 'P0001';
  end if;

  perform pt_private.log_credential_event(v_cred, case when p_purpose = 'copy' then 'password_copied' else 'password_viewed' end);
  return v_value;
end;
$function$;

-- public.pt_credential_set_password
CREATE OR REPLACE FUNCTION public.pt_credential_set_password(p_credential_id uuid, p_password text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_cred   public.pt_credentials;
  v_secret uuid;
begin
  perform pt_private.require_admin();
  perform public.rbac_require('projects.logins.edit'); -- rbac action
  if p_password is null or length(p_password) = 0 or length(p_password) > 1000 then
    raise exception 'PT_PASSWORD_INVALID' using errcode = 'P0001';
  end if;
  select * into v_cred from public.pt_credentials where id = p_credential_id for update;
  if not found then
    raise exception 'PT_NOT_FOUND' using errcode = 'P0001';
  end if;

  select secret_id into v_secret from pt_private.credential_secrets where credential_id = p_credential_id;
  if v_secret is null then
    v_secret := vault.create_secret(p_password, 'pt_credential_' || p_credential_id::text, 'Project Tracker login password');
    insert into pt_private.credential_secrets (credential_id, secret_id) values (p_credential_id, v_secret);
  else
    perform vault.update_secret(v_secret, p_password);
  end if;

  perform set_config('pt.password_write', 'on', true);
  update public.pt_credentials
     set has_password = true, password_updated_at = now(), password_updated_by = auth.uid()
   where id = p_credential_id;
  perform set_config('pt.password_write', 'off', true);

  perform pt_private.log_credential_event(v_cred, case when v_cred.has_password then 'password_changed' else 'password_set' end);
end;
$function$;

-- public.rbac_admin_create_user
CREATE OR REPLACE FUNCTION public.rbac_admin_create_user(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_email text := lower(btrim(coalesce(p ->> 'email', '')));
  v_name  text := nullif(btrim(coalesce(p ->> 'full_name', '')), '');
  v_pw    text := coalesce(p ->> 'password', '');
  v_roles text[] := coalesce((select array_agg(distinct r) from jsonb_array_elements_text(coalesce(p -> 'roles', '[]'::jsonb)) r), '{}');
  v_user  uuid;
  v_bad   text;
begin
  perform public.rbac_require('settings.users.create');
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'Enter a valid sign-in email.' using errcode = '22023';
  end if;
  if v_name is null or length(v_name) > 120 then
    raise exception 'Name is required (up to 120 characters).' using errcode = '22023';
  end if;
  if cardinality(v_roles) = 0 then
    raise exception 'Choose at least one role.' using errcode = '22023';
  end if;
  select r into v_bad from unnest(v_roles) r
   where r not in (select key from public.rbac_roles where area = 'admin') limit 1;
  if v_bad is not null then
    raise exception 'Only admin-area roles can be given here (Super Admin, Admin, HR).' using errcode = '22023';
  end if;
  if 'super_admin' = any (v_roles)
     and not exists (select 1 from public.rbac_user_roles where user_id = auth.uid() and role_key = 'super_admin') then
    raise exception 'Only a Super Admin can give the Super Admin role.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rbac_create_user:' || v_email, 0));
  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is not null then
    if exists (select 1 from public.rbac_user_roles where user_id = v_user)
       or exists (select 1 from public.ep_employees where user_id = v_user) then
      raise exception 'This email already has an account. Change its roles in the list instead.' using errcode = '23505';
    end if;
  else
    if public.ep_password_problem(v_pw) is not null then
      raise exception 'Password: %', public.ep_password_problem(v_pw) using errcode = '22023';
    end if;
    v_user := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
      extensions.crypt(v_pw, extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('full_name', v_name), now(), now(),
      '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    values (v_user::text, v_user,
            jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true), 'email', now(), now());
  end if;
  insert into public.rbac_user_roles (user_id, role_key, granted_by)
  select v_user, r, auth.uid() from unnest(v_roles) r on conflict do nothing;
  return v_user;
end $function$;

-- public.rbac_admin_roles
CREATE OR REPLACE FUNCTION public.rbac_admin_roles()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require_any(array['settings.roles.view', 'settings.users.view']);
  return jsonb_build_object(
    'can_edit', public.rbac_can('settings.roles.view'),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', r.key, 'name', r.name, 'description', r.description, 'area', r.area,
               'is_protected', r.is_protected,
               'permissions', case when r.key = 'super_admin'
                                   then (select coalesce(jsonb_agg(p.key order by p.sort_order), '[]'::jsonb)
                                           from public.rbac_permissions p where p.area = 'admin')
                                   else coalesce((select jsonb_agg(rp.permission_key order by p.sort_order)
                                                    from public.rbac_role_permissions rp
                                                    join public.rbac_permissions p on p.key = rp.permission_key
                                                   where rp.role_key = r.key), '[]'::jsonb) end,
               'users', case when r.key = 'employee'
                             then (select count(*) from public.ep_employees where is_active)
                             else (select count(*) from public.rbac_user_roles ur where ur.role_key = r.key) end)
             order by r.sort_order)
        from public.rbac_roles r), '[]'::jsonb),
    'permissions', coalesce((
      select jsonb_agg(jsonb_build_object('key', p.key, 'area', p.area, 'group', p.grp, 'label', p.label,
                                          'description', p.description) order by p.sort_order)
        from public.rbac_permissions p), '[]'::jsonb));
end $function$;

-- public.rbac_admin_set_permission
CREATE OR REPLACE FUNCTION public.rbac_admin_set_permission(p_role text, p_permission text, p_enabled boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role public.rbac_roles;
  v_perm public.rbac_permissions;
begin
  perform public.rbac_require('settings.roles.edit');
  select * into v_role from public.rbac_roles where key = p_role;
  select * into v_perm from public.rbac_permissions where key = p_permission;
  if v_role.key is null or v_perm.key is null then
    raise exception 'Unknown role or permission.' using errcode = 'P0002';
  end if;
  if v_role.key = 'super_admin' then
    raise exception 'Super Admin always has every permission.' using errcode = '42501';
  end if;
  if v_role.area <> v_perm.area then
    raise exception '% is an % role; this permission belongs to the %.', v_role.name,
      case v_role.area when 'admin' then 'admin-area' else 'Employee Portal' end,
      case v_perm.area when 'admin' then 'admin area' else 'Employee Portal' end using errcode = '22023';
  end if;
  if p_enabled then
    insert into public.rbac_role_permissions (role_key, permission_key) values (p_role, p_permission) on conflict do nothing;
  else
    delete from public.rbac_role_permissions where role_key = p_role and permission_key = p_permission;
  end if;
end $function$;

-- public.rbac_admin_set_user_roles
CREATE OR REPLACE FUNCTION public.rbac_admin_set_user_roles(p_user uuid, p_roles text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_new   text[] := coalesce((select array_agg(distinct r) from unnest(coalesce(p_roles, '{}')) r), '{}');
  v_old   text[];
  v_super boolean := public.rbac_user_can(auth.uid(), 'settings.users.edit')
                     and exists (select 1 from public.rbac_user_roles where user_id = auth.uid() and role_key = 'super_admin');
  v_bad   text;
begin
  perform public.rbac_require('settings.users.edit');
  if p_user = auth.uid() then
    raise exception 'You cannot change your own roles. Ask another Super Admin.' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'User not found.' using errcode = 'P0002';
  end if;
  select r into v_bad from unnest(v_new) r where r not in (select key from public.rbac_roles) limit 1;
  if v_bad is not null then
    raise exception 'Unknown role %.', v_bad using errcode = '22023';
  end if;
  if 'employee' = any (v_new) then
    raise exception 'Employee is given automatically to everyone with an Employee Portal account.' using errcode = '22023';
  end if;
  if (('manager' = any (v_new)) or ('team_lead' = any (v_new)))
     and not exists (select 1 from public.ep_employees where user_id = p_user) then
    raise exception 'Manager and Team Lead are for Employee Portal accounts.' using errcode = '22023';
  end if;
  select coalesce(array_agg(role_key), '{}') into v_old from public.rbac_user_roles where user_id = p_user;
  if (('super_admin' = any (v_new)) <> ('super_admin' = any (v_old))) and not v_super then
    raise exception 'Only a Super Admin can give or remove the Super Admin role.' using errcode = '42501';
  end if;
  delete from public.rbac_user_roles where user_id = p_user and role_key <> all (v_new);
  insert into public.rbac_user_roles (user_id, role_key, granted_by)
  select p_user, r, auth.uid() from unnest(v_new) r on conflict do nothing;
  if not exists (select 1 from public.rbac_user_roles where role_key = 'super_admin') then
    raise exception 'There must always be at least one Super Admin.' using errcode = '22023';
  end if;
  return to_jsonb(coalesce((select array_agg(role_key order by role_key) from public.rbac_user_roles where user_id = p_user), '{}'));
end $function$;

-- public.rbac_admin_users
CREATE OR REPLACE FUNCTION public.rbac_admin_users()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('settings.users.view');
  return coalesce((
    select jsonb_agg(x.j order by x.ord, x.nm) from (
      select (case when exists (select 1 from public.rbac_user_roles ur join public.rbac_roles r on r.key = ur.role_key
                                 where ur.user_id = u.id and r.area = 'admin') then 0 else 1 end) as ord,
             lower(coalesce(e.full_name, u.raw_user_meta_data ->> 'full_name', u.email)) as nm,
             jsonb_build_object(
               'user_id', u.id,
               'sign_in', u.email,
               'full_name', coalesce(e.full_name, nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1)),
               'employee_id', e.id, 'employee_code', e.employee_code, 'employee_active', e.is_active,
               'roles', coalesce((select jsonb_agg(ur.role_key order by r.sort_order)
                                    from public.rbac_user_roles ur join public.rbac_roles r on r.key = ur.role_key
                                   where ur.user_id = u.id), '[]'::jsonb),
               'last_sign_in_at', u.last_sign_in_at, 'created_at', u.created_at,
               'is_self', u.id = auth.uid()) as j
        from auth.users u
        left join public.ep_employees e on e.user_id = u.id
       where e.id is not null or exists (select 1 from public.rbac_user_roles ur where ur.user_id = u.id)) x),
    '[]'::jsonb);
end $function$;

-- ================================================================ Roles & Permissions page data (with actions)
create or replace function public.rbac_admin_roles()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.rbac_require_any(array['settings.roles.view', 'settings.users.view']);
  return jsonb_build_object(
    'can_edit', public.rbac_can('settings.roles.edit'),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', r.key, 'name', r.name, 'description', r.description, 'area', r.area,
               'permissions', case when r.key = 'super_admin'
                                   then (select coalesce(jsonb_agg(p.key order by p.sort_order), '[]'::jsonb)
                                           from public.rbac_permissions p where p.area = 'admin')
                                   else coalesce((select jsonb_agg(rp.permission_key order by p.sort_order)
                                                    from public.rbac_role_permissions rp
                                                    join public.rbac_permissions p on p.key = rp.permission_key
                                                   where rp.role_key = r.key), '[]'::jsonb) end,
               'users', case when r.key = 'employee'
                             then (select count(*) from public.ep_employees where is_active)
                             else (select count(*) from public.rbac_user_roles ur where ur.role_key = r.key) end)
             order by r.sort_order)
        from public.rbac_roles r), '[]'::jsonb),
    'permissions', coalesce((
      select jsonb_agg(jsonb_build_object('key', p.key, 'area', p.area, 'group', p.grp, 'label', p.label,
                                          'description', p.description, 'module', p.module, 'action', p.action,
                                          'action_label', p.action_label) order by p.sort_order)
        from public.rbac_permissions p), '[]'::jsonb));
end $$;

-- ===================== 262_rbac_pages.sql =====================

-- ================================================================ catalog
insert into public.rbac_permissions (key, area, grp, label, description, sort_order, module, action, action_label) values
  ('projects.clients.view', 'admin', 'Projects', 'Clients', 'Client companies and their logos.', 86, 'projects.clients', 'view', 'View'),
  ('projects.clients.create', 'admin', 'Projects', 'Clients', 'Client companies and their logos.', 87, 'projects.clients', 'create', 'Add clients'),
  ('projects.clients.edit', 'admin', 'Projects', 'Clients', 'Client companies and their logos.', 88, 'projects.clients', 'edit', 'Edit'),
  ('projects.clients.delete', 'admin', 'Projects', 'Clients', 'Client companies and their logos.', 89, 'projects.clients', 'delete', 'Delete'),
  ('website.search_console.view', 'admin', 'Growth', 'Search Console', 'Google Search Console data.', 85, 'website.search_console', 'view', 'View')
on conflict (key) do update
  set area = excluded.area, grp = excluded.grp, label = excluded.label, description = excluded.description,
      sort_order = excluded.sort_order, module = excluded.module, action = excluded.action, action_label = excluded.action_label;
update public.rbac_permissions set label = 'SEO', description = 'SEO audit of the website pages.' where module = 'website.seo';
update public.rbac_permissions set label = 'Project Tracker', description = 'Projects, documents and backups.' where module = 'projects.tracker';

-- Same access as before: Project Tracker actions -> Clients actions, SEO -> Search Console (first run only).
insert into public.rbac_role_permissions (role_key, permission_key)
select rp.role_key, replace(rp.permission_key, 'projects.tracker.', 'projects.clients.')
  from public.rbac_role_permissions rp
 where rp.permission_key in ('projects.tracker.view', 'projects.tracker.create', 'projects.tracker.edit', 'projects.tracker.delete')
   and not exists (select 1 from public.rbac_role_permissions where permission_key like 'projects.clients.%')
on conflict do nothing;
insert into public.rbac_role_permissions (role_key, permission_key)
select rp.role_key, 'website.search_console.view' from public.rbac_role_permissions rp
 where rp.permission_key = 'website.seo.view'
   and not exists (select 1 from public.rbac_role_permissions where permission_key = 'website.search_console.view')
on conflict do nothing;

-- ================================================================ "may open the admin area"
create or replace function public.rbac_user_has_admin_pages(p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_user is not null and (
    exists (select 1 from public.rbac_user_roles where user_id = p_user and role_key = 'super_admin')
    or exists (select 1 from public.rbac_role_permissions rp join public.rbac_permissions p on p.key = rp.permission_key
                where p.area = 'admin' and rp.role_key = any (public.rbac_roles_of(p_user))));
$$;
revoke all on function public.rbac_user_has_admin_pages(uuid) from public, anon, authenticated;

insert into public.rbac_backup (kind, name, definition)
values ('function262', 'public.is_admin()', pg_get_functiondef('public.is_admin()'::regprocedure))
on conflict do nothing;
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.rbac_user_has_admin_pages(auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.rbac_my_access()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid   uuid := auth.uid();
  v_roles text[] := public.rbac_roles_of(auth.uid());
  v_super boolean := 'super_admin' = any (public.rbac_roles_of(auth.uid()));
begin
  if v_uid is null then
    return jsonb_build_object('roles', '[]'::jsonb, 'permissions', '[]'::jsonb, 'is_admin', false, 'is_super_admin', false);
  end if;
  return jsonb_build_object(
    'is_super_admin', v_super,
    'is_admin', public.rbac_user_has_admin_pages(v_uid),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('key', r.key, 'name', r.name, 'area', r.area) order by r.sort_order)
                         from public.rbac_roles r where r.key = any (v_roles)), '[]'::jsonb),
    'permissions', coalesce((select jsonb_agg(p.key order by p.sort_order) from public.rbac_permissions p
                              where v_super or exists (select 1 from public.rbac_role_permissions rp
                                                        where rp.permission_key = p.key and rp.role_key = any (v_roles))),
                            '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.rbac_admin_set_permission(p_role text, p_permission text, p_enabled boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role public.rbac_roles;
  v_perm public.rbac_permissions;
begin
  perform public.rbac_require('settings.roles.edit');
  select * into v_role from public.rbac_roles where key = p_role;
  select * into v_perm from public.rbac_permissions where key = p_permission;
  if v_role.key is null or v_perm.key is null then
    raise exception 'Unknown role or permission.' using errcode = 'P0002';
  end if;
  if v_role.key = 'super_admin' then
    raise exception 'Super Admin always has every permission.' using errcode = '42501';
  end if;
  -- Any role may get any page (e.g. Employee -> Contact submissions); see migration 262.
  if p_enabled then
    insert into public.rbac_role_permissions (role_key, permission_key) values (p_role, p_permission) on conflict do nothing;
  else
    delete from public.rbac_role_permissions where role_key = p_role and permission_key = p_permission;
  end if;
end $function$;

-- ================================================================ client / project data per page
do $$
declare
  p record;
begin
  for p in select schemaname, tablename, policyname, qual, with_check from pg_policies
            where (tablename in ('pt_companies', 'pt_projects') and policyname like 'pt\_% admin %')
               or policyname like 'pt-company-logos: admin %' loop
    insert into public.rbac_backup (kind, name, definition)
    values ('policy262', p.schemaname || '.' || p.tablename || '.' || p.policyname,
            jsonb_build_object('schema', p.schemaname, 'table', p.tablename, 'policy', p.policyname,
                               'qual', p.qual, 'with_check', p.with_check)::text)
    on conflict do nothing;
  end loop;
end $$;

alter policy "pt_companies admin select" on public.pt_companies using (public.rbac_can('projects.clients.view') or public.rbac_can('projects.tracker.view') or public.rbac_can('projects.logins.view'));
alter policy "pt_companies admin insert" on public.pt_companies with check (public.rbac_can('projects.clients.create'));
alter policy "pt_companies admin update" on public.pt_companies
  using (public.rbac_can('projects.clients.edit')) with check (public.rbac_can('projects.clients.edit'));
alter policy "pt_companies admin delete" on public.pt_companies using (public.rbac_can('projects.clients.delete'));
alter policy "pt_projects admin select" on public.pt_projects using (public.rbac_can('projects.clients.view') or public.rbac_can('projects.tracker.view') or public.rbac_can('projects.logins.view'));
alter policy "pt-company-logos: admin read" on storage.objects
  using (bucket_id = 'pt-company-logos' and (public.rbac_can('projects.clients.view') or public.rbac_can('projects.tracker.view') or public.rbac_can('projects.logins.view')));
alter policy "pt-company-logos: admin upload" on storage.objects
  with check (bucket_id = 'pt-company-logos'
              and (public.rbac_can('projects.clients.create') or public.rbac_can('projects.clients.edit')));
alter policy "pt-company-logos: admin delete" on storage.objects
  using (bucket_id = 'pt-company-logos'
         and (public.rbac_can('projects.clients.edit') or public.rbac_can('projects.clients.delete')));

-- ===================== 263_rbac_one_role_password.sql =====================

-- ================================================================ one role per person
insert into public.rbac_backup (kind, name, definition)
select 'roles263', 'removed extra roles', coalesce(jsonb_agg(to_jsonb(ur)), '[]'::jsonb)::text
  from public.rbac_user_roles ur join public.rbac_roles r on r.key = ur.role_key
 where exists (select 1 from public.rbac_user_roles ur2 join public.rbac_roles r2 on r2.key = ur2.role_key
                where ur2.user_id = ur.user_id and r2.sort_order < r.sort_order)
on conflict do nothing;
delete from public.rbac_user_roles ur using public.rbac_roles r
 where r.key = ur.role_key
   and exists (select 1 from public.rbac_user_roles ur2 join public.rbac_roles r2 on r2.key = ur2.role_key
                where ur2.user_id = ur.user_id and r2.sort_order < r.sort_order);
create unique index if not exists rbac_user_roles_one_per_user on public.rbac_user_roles (user_id);

-- The role of a user: the one given on Users & Roles, else Employee for an active portal account.
create or replace function public.rbac_roles_of(p_user uuid)
returns text[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select array[ur.role_key] from public.rbac_user_roles ur where ur.user_id = p_user limit 1),
    case when exists (select 1 from public.ep_employees e where e.user_id = p_user and e.is_active)
         then array['employee'] else '{}'::text[] end);
$$;
revoke all on function public.rbac_roles_of(uuid) from public, anon, authenticated;

-- Managers / Team Leads keep the employee features (first run only).
insert into public.rbac_backup (kind, name, definition)
select 'perms263', 'employee features copied', coalesce(jsonb_agg(jsonb_build_object('role_key', r, 'permission_key', rp.permission_key)), '[]'::jsonb)::text
  from (values ('manager'), ('team_lead')) v(r)
  join public.rbac_role_permissions rp on rp.role_key = 'employee' and rp.permission_key like 'emp.%'
 where not exists (select 1 from public.rbac_role_permissions x where x.role_key = v.r and x.permission_key like 'emp.%')
on conflict do nothing;
insert into public.rbac_role_permissions (role_key, permission_key)
select v.r, rp.permission_key
  from (values ('manager'), ('team_lead')) v(r)
  join public.rbac_role_permissions rp on rp.role_key = 'employee' and rp.permission_key like 'emp.%'
 where not exists (select 1 from public.rbac_role_permissions x where x.role_key = v.r and x.permission_key like 'emp.%')
on conflict do nothing;

update public.rbac_roles set description = 'Everyone with an Employee Portal account who has no other role.' where key = 'employee';
update public.rbac_roles set description = 'Employee Portal: an employee who also reviews and approves their team''s leave and reports.' where key = 'manager';
update public.rbac_roles set description = 'Employee Portal: an employee who leads a team, reviews its daily reports and messages it.' where key = 'team_lead';

CREATE OR REPLACE FUNCTION public.rbac_admin_set_user_roles(p_user uuid, p_roles text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_new   text[] := coalesce((select array_agg(distinct r) from unnest(coalesce(p_roles, '{}')) r), '{}');
  v_old   text[];
  v_super boolean := public.rbac_user_can(auth.uid(), 'settings.users.edit')
                     and exists (select 1 from public.rbac_user_roles where user_id = auth.uid() and role_key = 'super_admin');
  v_bad   text;
begin
  perform public.rbac_require('settings.users.edit');
  if p_user = auth.uid() then
    raise exception 'You cannot change your own roles. Ask another Super Admin.' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'User not found.' using errcode = 'P0002';
  end if;
  select r into v_bad from unnest(v_new) r where r not in (select key from public.rbac_roles) limit 1;
  if v_bad is not null then
    raise exception 'Unknown role %.', v_bad using errcode = '22023';
  end if;
  -- One role per person (migration 263). "Employee" = no other role (Employee Portal accounts only).
  if 'employee' = any (v_new) then
    if not exists (select 1 from public.ep_employees where user_id = p_user) then
      raise exception 'Employee is only for Employee Portal accounts.' using errcode = '22023';
    end if;
    v_new := array_remove(v_new, 'employee');
  end if;
  if cardinality(v_new) > 1 then
    raise exception 'A person can have only one role at a time. Choose one.' using errcode = '22023';
  end if;
  if cardinality(v_new) = 0 and not exists (select 1 from public.ep_employees where user_id = p_user) then
    raise exception 'Choose a role.' using errcode = '22023';
  end if;
  if (('manager' = any (v_new)) or ('team_lead' = any (v_new)))
     and not exists (select 1 from public.ep_employees where user_id = p_user) then
    raise exception 'Manager and Team Lead are for Employee Portal accounts.' using errcode = '22023';
  end if;
  select coalesce(array_agg(role_key), '{}') into v_old from public.rbac_user_roles where user_id = p_user;
  if (('super_admin' = any (v_new)) <> ('super_admin' = any (v_old))) and not v_super then
    raise exception 'Only a Super Admin can give or remove the Super Admin role.' using errcode = '42501';
  end if;
  delete from public.rbac_user_roles where user_id = p_user and role_key <> all (v_new);
  insert into public.rbac_user_roles (user_id, role_key, granted_by)
  select p_user, r, auth.uid() from unnest(v_new) r on conflict do nothing;
  if not exists (select 1 from public.rbac_user_roles where role_key = 'super_admin') then
    raise exception 'There must always be at least one Super Admin.' using errcode = '22023';
  end if;
  return to_jsonb(coalesce((select array_agg(role_key order by role_key) from public.rbac_user_roles where user_id = p_user), '{}'));
end $function$;

CREATE OR REPLACE FUNCTION public.rbac_admin_create_user(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_email text := lower(btrim(coalesce(p ->> 'email', '')));
  v_name  text := nullif(btrim(coalesce(p ->> 'full_name', '')), '');
  v_pw    text := coalesce(p ->> 'password', '');
  v_roles text[] := coalesce((select array_agg(distinct r) from jsonb_array_elements_text(coalesce(p -> 'roles', '[]'::jsonb)) r), '{}');
  v_user  uuid;
  v_bad   text;
begin
  perform public.rbac_require('settings.users.create');
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'Enter a valid sign-in email.' using errcode = '22023';
  end if;
  if v_name is null or length(v_name) > 120 then
    raise exception 'Name is required (up to 120 characters).' using errcode = '22023';
  end if;
  if cardinality(v_roles) <> 1 then
    raise exception 'Choose one role (a person has one role at a time).' using errcode = '22023';
  end if;
  select r into v_bad from unnest(v_roles) r
   where r not in (select key from public.rbac_roles where area = 'admin') limit 1;
  if v_bad is not null then
    raise exception 'Only admin-area roles can be given here (Super Admin, Admin, HR).' using errcode = '22023';
  end if;
  if 'super_admin' = any (v_roles)
     and not exists (select 1 from public.rbac_user_roles where user_id = auth.uid() and role_key = 'super_admin') then
    raise exception 'Only a Super Admin can give the Super Admin role.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rbac_create_user:' || v_email, 0));
  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is not null then
    if exists (select 1 from public.rbac_user_roles where user_id = v_user)
       or exists (select 1 from public.ep_employees where user_id = v_user) then
      raise exception 'This email already has an account. Change its roles in the list instead.' using errcode = '23505';
    end if;
  else
    if public.ep_password_problem(v_pw) is not null then
      raise exception 'Password: %', public.ep_password_problem(v_pw) using errcode = '22023';
    end if;
    v_user := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
      extensions.crypt(v_pw, extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('full_name', v_name), now(), now(),
      '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    values (v_user::text, v_user,
            jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true), 'email', now(), now());
  end if;
  insert into public.rbac_user_roles (user_id, role_key, granted_by)
  select v_user, r, auth.uid() from unnest(v_roles) r on conflict do nothing;
  return v_user;
end $function$;

-- ================================================================ change my password (My profile)
create or replace function public.rbac_my_change_password(p_current text, p_new text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_hash text;
begin
  if v_uid is null then
    raise exception 'Please sign in again.' using errcode = '42501';
  end if;
  select encrypted_password into v_hash from auth.users where id = v_uid;
  if v_hash is null or v_hash = '' or extensions.crypt(coalesce(p_current, ''), v_hash) <> v_hash then
    perform pg_sleep(1); -- slows down guessing
    raise exception 'Your current password is not correct.' using errcode = '22023';
  end if;
  if public.ep_password_problem(p_new) is not null then
    raise exception 'New password: %', public.ep_password_problem(p_new) using errcode = '22023';
  end if;
  if p_new = p_current then
    raise exception 'The new password must be different from the current one.' using errcode = '22023';
  end if;
  update auth.users set encrypted_password = extensions.crypt(p_new, extensions.gen_salt('bf')), updated_at = now()
   where id = v_uid;
  update public.ep_employees set must_change_password = false where user_id = v_uid and must_change_password;
  return true;
end $$;
revoke all on function public.rbac_my_change_password(text, text) from public, anon;
grant execute on function public.rbac_my_change_password(text, text) to authenticated;

-- ===================== 264_approvals.sql =====================

alter table public.ep_employees
  add column if not exists admin_approver_id uuid references auth.users (id) on delete set null;
comment on column public.ep_employees.admin_approver_id is
  'Who decides this employee''s requests on the admin side (null = anyone with the permission). Migration 264.';

-- ================================================================ helpers (internal)
-- Display name of any account: employee name, else the name given when the user was added, else the email.
create or replace function public.ep_user_display_name(p_user uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select e.full_name from public.ep_employees e where e.user_id = p_user limit 1),
    (select nullif(btrim(u.raw_user_meta_data ->> 'full_name'), '') from auth.users u where u.id = p_user),
    (select split_part(u.email, '@', 1) from auth.users u where u.id = p_user),
    'Admin');
$$;

create or replace function public.ep_is_super_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.rbac_user_roles where user_id = auth.uid() and role_key = 'super_admin');
$$;

-- Refuse when the signed-in person would decide their own request.
create or replace function public.ep_require_not_self(p_emp uuid)
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.ep_employees where id = p_emp and user_id = auth.uid()) then
    raise exception 'You cannot decide your own request. Another admin has to do it.' using errcode = '42501';
  end if;
end $$;

-- Refuse when the employee has a named approver who is someone else (Super Admins may always decide).
create or replace function public.ep_require_approver(p_emp uuid)
returns void
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_appr uuid;
begin
  select admin_approver_id into v_appr from public.ep_employees where id = p_emp;
  if v_appr is not null and v_appr <> auth.uid() and not public.ep_is_super_admin() then
    raise exception 'Only % (the approver set for this employee) or a Super Admin can decide this.',
      public.ep_user_display_name(v_appr) using errcode = '42501';
  end if;
end $$;

-- May the signed-in admin see this notification? (page permission + named approver)
create or replace function public.ep_admin_inbox_visible(p_kind text, p_emp uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.rbac_can(case p_kind
           when 'leave' then 'portal.leave.view'
           when 'attendance' then 'portal.attendance.view'
           when 'report' then 'portal.reports.view'
           when 'project' then 'portal.projects.view'
           else 'portal.employees.view' end)
     and (p_kind not in ('leave', 'attendance', 'report') or p_emp is null or public.ep_is_super_admin()
          or coalesce((select e.admin_approver_id = auth.uid() or e.admin_approver_id is null
                         from public.ep_employees e where e.id = p_emp), true));
$$;

revoke all on function public.ep_user_display_name(uuid), public.ep_is_super_admin(), public.ep_require_not_self(uuid),
  public.ep_require_approver(uuid), public.ep_admin_inbox_visible(text, uuid) from public, anon, authenticated;

-- ================================================================ named approver (Employee Management)
-- People who may be named: everyone whose role may approve leave (and Super Admins).
create or replace function public.ep_admin_approver_options()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.rbac_require('portal.employees.edit');
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', u.id, 'name', public.ep_user_display_name(u.id),
                                        'role', (select r.name from public.rbac_user_roles ur join public.rbac_roles r on r.key = ur.role_key
                                                  where ur.user_id = u.id limit 1))
                     order by public.ep_user_display_name(u.id))
      from auth.users u
     where public.rbac_user_can(u.id, 'portal.leave.approve')), '[]'::jsonb);
end $$;

create or replace function public.ep_admin_set_approver(p_emp uuid, p_user uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp public.ep_employees;
begin
  perform public.rbac_require('portal.employees.edit');
  select * into v_emp from public.ep_employees where id = p_emp for update;
  if v_emp.id is null then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  if p_user is not null then
    if p_user = v_emp.user_id then
      raise exception 'An employee cannot approve their own requests.' using errcode = '22023';
    end if;
    if not public.rbac_user_can(p_user, 'portal.leave.approve') then
      raise exception 'Choose someone whose role may approve leave.' using errcode = '22023';
    end if;
  end if;
  update public.ep_employees set admin_approver_id = p_user, updated_at = now() where id = p_emp;
  return jsonb_build_object('user_id', p_user, 'name', case when p_user is not null then public.ep_user_display_name(p_user) end);
end $$;

revoke all on function public.ep_admin_approver_options(), public.ep_admin_set_approver(uuid, uuid) from public, anon;
grant execute on function public.ep_admin_approver_options(), public.ep_admin_set_approver(uuid, uuid) to authenticated;

-- ================================================================ generated from the current definitions
CREATE OR REPLACE FUNCTION public.ep_admin_decide_leave(p_id uuid, p_action text, p_comment text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row      public.ep_leave_requests;
  v_comment  text := nullif(btrim(coalesce(p_comment, '')), '');
  v_allowed  numeric;
  v_type     public.ep_leave_types;
  v_mgr      uuid;
  v_what     text;
  v_emp_name text;
  v_final    boolean;
begin
  perform public.rbac_require('portal.leave.approve'); -- rbac
  select * into v_row from public.ep_leave_requests where id = p_id for update;
  if v_row.id is null then
    raise exception 'Leave request not found.' using errcode = 'P0002';
  end if;
  perform public.ep_require_not_self(v_row.employee_id); -- 264
  perform public.ep_require_approver(v_row.employee_id); -- 264
  if v_row.status not in ('manager_review', 'pending', 'manager_pending') then
    raise exception 'This request was already %.', v_row.status using errcode = 'P0001';
  end if;
  if p_action not in ('approved', 'rejected') then
    raise exception 'Invalid action.' using errcode = '22023';
  end if;
  if p_action = 'rejected' and v_comment is null then
    raise exception 'Write a reason for rejecting.' using errcode = '22023';
  end if;
  if coalesce(length(v_comment), 0) > 1000 then
    raise exception 'Comment must be at most 1000 characters.' using errcode = '22023';
  end if;
  select * into v_type from public.ep_leave_types where code = v_row.leave_type;
  if p_action = 'approved' then
    v_allowed := public.ep_leave_allowance(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type);
    if v_type.is_paid and v_allowed is not null
       and public.ep_leave_taken(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type, v_row.id)
           + v_row.days > v_allowed then
      raise exception 'Not enough % balance left to approve this. Increase the balance or ask for Loss of Pay.', v_type.name
        using errcode = '22023';
    end if;
  end if;

  v_what := v_type.name || ' · ' || to_char(v_row.start_date, 'DD Mon YYYY')
    || case when v_row.end_date <> v_row.start_date then ' – ' || to_char(v_row.end_date, 'DD Mon YYYY') else '' end;
  select full_name into v_emp_name from public.ep_employees where id = v_row.employee_id;

  if v_row.status in ('manager_review', 'pending') and p_action = 'approved' then
    select m.id into v_mgr
      from public.ep_employees e join public.ep_employees m on m.id = e.reporting_manager_id
     where e.id = v_row.employee_id and m.is_active and m.id <> e.id
       and public.rbac_user_can(m.user_id, 'team.leave.approve');
    if v_mgr is null and v_row.approver_id is not null and v_row.approver_id <> v_row.employee_id
       and exists (select 1 from public.ep_employees where id = v_row.approver_id and is_active
                    and public.rbac_user_can(user_id, 'team.leave.approve')) then
      v_mgr := v_row.approver_id;
    end if;
  end if;

  if v_mgr is not null then
    -- Step 1 done: the admin approved; now the reporting manager decides.
    update public.ep_leave_requests
       set status = 'manager_pending', approver_id = v_mgr,
           decided_by_admin = auth.uid(), admin_decided_at = now(), admin_comment = v_comment, updated_at = now()
     where id = p_id returning * into v_row;
    perform public.ep_notify(v_row.employee_id, 'leave',
      'Admin approved your leave — waiting for your manager',
      v_what || ' · now with ' || (select full_name from public.ep_employees where id = v_mgr) || ' for the final decision'
        || coalesce(' · Admin: ' || v_comment, ''),
      '/employee/leave', 'normal');
    perform public.ep_notify(v_mgr, 'leave',
      'Admin approved ' || v_emp_name || '''s leave — please give your final approval',
      v_what || coalesce(' · Admin: ' || v_comment, '') || ' · Approve or reject it in Team requests.',
      '/employee/leave/team', 'normal');
  else
    -- Final decision by the admin: reject; approve with no portal manager; or deciding instead of the manager.
    v_final := v_row.status = 'manager_pending';
    update public.ep_leave_requests
       set status = p_action, decided_by = null, decided_by_admin = auth.uid(), decided_at = now(),
           decision_comment = v_comment,
           admin_decided_at = coalesce(admin_decided_at, now()),
           admin_comment = case when v_final then admin_comment else v_comment end,
           updated_at = now()
     where id = p_id returning * into v_row;
    perform public.ep_notify(v_row.employee_id, 'leave',
      'Your leave was ' || p_action,
      v_what || ' · by ' || public.ep_user_display_name(auth.uid()) || coalesce(' · ' || v_comment, ''),
      '/employee/leave', case when p_action = 'rejected' then 'urgent' else 'normal' end);
    -- The reporting manager always learns the admin's decision (approved or rejected).
    if v_row.approver_id is not null and v_row.approver_id <> v_row.employee_id then
      perform public.ep_notify(v_row.approver_id, 'leave',
        'Admin ' || p_action || ' ' || v_emp_name || '''s leave',
        v_what || coalesce(' · Admin: ' || v_comment, '')
          || case when v_final then ' · decided instead of you; no action needed.' else ' · no action needed from you.' end,
        '/employee/leave/team', 'normal');
    end if;
  end if;
  return public.ep_leave_json(v_row)
    || jsonb_build_object('balance',
         public.ep_leave_balance_json(v_row.employee_id, extract(year from v_row.start_date)::int, v_row.leave_type));
end $function$;

CREATE OR REPLACE FUNCTION public.ep_admin_decide_correction(p_id uuid, p_action text, p_comment text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row public.ep_attendance_corrections;
  v_chk record;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  perform public.rbac_require('portal.attendance.approve'); -- rbac
  if p_action not in ('approved', 'rejected') then
    raise exception 'Invalid action.' using errcode = '22023';
  end if;
  if p_action = 'rejected' and v_comment is null then
    raise exception 'Write a reason for rejecting.' using errcode = '22023';
  end if;
  if coalesce(length(v_comment), 0) > 500 then
    raise exception 'Comment must be at most 500 characters.' using errcode = '22023';
  end if;
  select * into v_row from public.ep_attendance_corrections where id = p_id for update;
  if v_row.id is null then
    raise exception 'Correction request not found.' using errcode = 'P0002';
  end if;
  perform public.ep_require_not_self(v_row.employee_id); -- 264
  perform public.ep_require_approver(v_row.employee_id); -- 264
  if v_row.status <> 'pending' then
    raise exception 'This request was already %.', v_row.status using errcode = 'P0001';
  end if;

  if p_action = 'approved' then
    if v_row.old_in is not null and v_row.attendance_id is null then
      raise exception 'The punch session of this request no longer exists.' using errcode = 'P0002';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(v_row.employee_id::text, 0));
    -- Check again: other sessions may have changed since the request.
    select * into v_chk from public.ep_correction_check(
      v_row.employee_id, v_row.work_date, v_row.attendance_id, v_row.requested_in, v_row.requested_out);
    if v_row.attendance_id is not null then
      update public.ep_attendance
         set punch_in_at = v_chk.new_in, punch_out_at = v_chk.new_out,
             auto_punched_out = false, corrected_at = now()
       where id = v_row.attendance_id;
    else
      insert into public.ep_attendance (employee_id, work_date, punch_in_at, punch_out_at, corrected_at)
      values (v_row.employee_id, v_row.work_date, v_chk.new_in, v_chk.new_out, now());
    end if;
  end if;

  update public.ep_attendance_corrections
     set status = p_action, decided_by_admin = auth.uid(), decided_at = now(), decision_comment = v_comment
   where id = p_id returning * into v_row;

  perform public.ep_notify(v_row.employee_id, 'attendance',
    'Attendance correction ' || p_action,
    to_char(v_row.work_date, 'DD Mon YYYY') || ' · by ' || public.ep_user_display_name(auth.uid()) || coalesce(' · ' || v_comment, ''),
    '/employee/attendance', case when p_action = 'rejected' then 'urgent' else 'normal' end);
  return public.ep_correction_json(v_row);
end $function$;

CREATE OR REPLACE FUNCTION public.ep_admin_review_report(p_report uuid, p_action text, p_comment text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_status  text;
  v_emp     uuid;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  perform public.rbac_require('portal.reports.approve'); -- rbac
  select status, employee_id into v_status, v_emp from public.ep_work_reports where id = p_report for update;
  if v_status is null then
    raise exception 'Report not found.' using errcode = 'P0002';
  end if;
  perform public.ep_require_not_self(v_emp); -- 264
  perform public.ep_require_approver(v_emp); -- 264
  if v_status <> 'submitted' then
    raise exception 'Only a submitted report can be reviewed (this one is %).', v_status using errcode = 'P0001';
  end if;
  if p_action not in ('reviewed', 'returned') then
    raise exception 'Invalid action.' using errcode = '22023';
  end if;
  if p_action = 'returned' and v_comment is null then
    raise exception 'Write a comment saying what needs to change.' using errcode = '22023';
  end if;
  if coalesce(length(v_comment), 0) > 1000 then
    raise exception 'Comment must be at most 1000 characters.' using errcode = '22023';
  end if;
  update public.ep_work_reports
     set status = p_action, reviewed_by = null, reviewed_by_admin = auth.uid(), reviewed_at = now(),
         review_comment = v_comment, updated_at = now()
   where id = p_report;
  return public.ep_report_json(p_report);
end $function$;

CREATE OR REPLACE FUNCTION public.ep_leave_json(r ep_leave_requests)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id', r.id, 'leave_type', r.leave_type, 'leave_name', (select name from public.ep_leave_types where code = r.leave_type),
    'start_date', r.start_date, 'end_date', r.end_date, 'half_day', r.half_day, 'days', r.days,
    'reason', r.reason, 'status', r.status, 'created_at', r.created_at,
    'decided_at', r.decided_at, 'decision_comment', r.decision_comment,
    'decided_by', coalesce((select full_name from public.ep_employees where id = r.decided_by),
                           case when r.decided_by_admin is not null and r.decided_at is not null
                                then public.ep_user_display_name(r.decided_by_admin) end),
    'decided_by_is_admin', r.decided_by is null and r.decided_by_admin is not null and r.decided_at is not null,
    'admin_decided_by', case when r.admin_decided_at is not null then public.ep_user_display_name(r.decided_by_admin) end,
    'admin_approver', (select case when e.admin_approver_id is not null then jsonb_build_object('user_id', e.admin_approver_id,
                                 'name', public.ep_user_display_name(e.admin_approver_id)) end
                         from public.ep_employees e where e.id = r.employee_id),
    'manager_reviewed_at', r.manager_reviewed_at, 'manager_review_comment', r.manager_review_comment,
    'manager_reviewed_by', (select full_name from public.ep_employees where id = r.manager_reviewed_by),
    'admin_decided_at', r.admin_decided_at, 'admin_comment', r.admin_comment,
    'manager', (select full_name from public.ep_employees
                 where id = coalesce(r.decided_by, r.manager_reviewed_by, r.approver_id)),
    'approver', coalesce((select full_name from public.ep_employees where id = r.approver_id), r.approver_name),
    'employee', (select jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
                                           'designation', e.designation)
                   from public.ep_employees e where e.id = r.employee_id));
$function$;

CREATE OR REPLACE FUNCTION public.ep_report_json(p_report uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id', r.id, 'report_date', r.report_date, 'status', r.status, 'notes', r.notes,
    'submitted_at', r.submitted_at, 'reviewed_at', r.reviewed_at, 'review_comment', r.review_comment,
    'updated_at', r.updated_at,
    'employee', jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
                                   'designation', e.designation),
    'submitted_to', case when st.id is null then null
                         else jsonb_build_object('id', st.id, 'full_name', st.full_name, 'employee_code', st.employee_code) end,
    'reviewed_by', case when rb.id is not null then jsonb_build_object('id', rb.id, 'full_name', rb.full_name)
                        when r.reviewed_by_admin is not null then jsonb_build_object('id', null, 'full_name', public.ep_user_display_name(r.reviewed_by_admin))
                        else null end,
    'total_hours', coalesce((select sum(i.hours) from public.ep_work_report_items i where i.report_id = r.id), 0),
    'worked_minutes', (
      select floor(sum(extract(epoch from (coalesce(a.punch_out_at, now()) - a.punch_in_at))) / 60)::int
      from public.ep_attendance a where a.employee_id = r.employee_id and a.work_date = r.report_date),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'project_id', i.project_id, 'project_code', p.project_code, 'project_name', p.name,
               'task_updates', i.task_updates, 'completed_work', i.completed_work,
               'pending_work', i.pending_work, 'hours', i.hours)
             order by i.position, p.name)
      from public.ep_work_report_items i join public.pt_projects p on p.id = i.project_id
      where i.report_id = r.id), '[]'::jsonb)
  )
  from public.ep_work_reports r
  join public.ep_employees e on e.id = r.employee_id
  left join public.ep_employees st on st.id = r.submitted_to
  left join public.ep_employees rb on rb.id = r.reviewed_by
  where r.id = p_report;
$function$;

CREATE OR REPLACE FUNCTION public.ep_correction_json(c ep_attendance_corrections)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id', c.id, 'work_date', c.work_date, 'attendance_id', c.attendance_id,
    'requested_in', c.requested_in, 'requested_out', c.requested_out,
    'old_in', c.old_in, 'old_out', c.old_out,
    'kind', case when c.old_in is null then 'add' else 'fix' end,
    'reason', c.reason, 'status', c.status, 'created_at', c.created_at,
    'decided_at', c.decided_at, 'decision_comment', c.decision_comment,
    'decided_by', case when c.decided_by_admin is not null then public.ep_user_display_name(c.decided_by_admin) end,
    'employee', (select jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code)
                   from public.ep_employees e where e.id = c.employee_id));
$function$;

CREATE OR REPLACE FUNCTION public.ep_admin_employee_json(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id',              e.id,
    'employee_code',   e.employee_code,
    'full_name',       e.full_name,
    'work_email',      u.email,
    'department',      e.department,
    'designation',     e.designation,
    'date_of_joining', e.date_of_joining,
    'employment_type', e.employment_type,
    'work_location',   e.work_location,
    'is_active',       e.is_active,
    'created_at',      e.created_at,
    'last_sign_in_at', u.last_sign_in_at,
    'manager', case when m.id is null then null else jsonb_build_object(
      'id', m.id, 'full_name', m.full_name, 'employee_code', m.employee_code,
      'designation', m.designation, 'is_active', m.is_active) end,
    'manager_name', case when m.id is null then e.reporting_manager_name end,
    'admin_approver', case when e.admin_approver_id is not null then jsonb_build_object('user_id', e.admin_approver_id,
                         'name', public.ep_user_display_name(e.admin_approver_id)) end,
    'reports_count', (select count(*) from public.ep_employees r where r.reporting_manager_id = e.id),
    'punched_in', exists (select 1 from public.ep_attendance a where a.employee_id = e.id and a.punch_out_at is null)
  )
  from public.ep_employees e
  left join auth.users u on u.id = e.user_id
  left join public.ep_employees m on m.id = e.reporting_manager_id
  where e.id = p_id;
$function$;

CREATE OR REPLACE FUNCTION public.ep_admin_inbox(p_filter text DEFAULT 'all'::text, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  perform public.rbac_require('portal.inbox.view'); -- rbac
  return jsonb_build_object(
    'unread', (select count(*) from public.ep_admin_notifications n
                where public.ep_admin_inbox_visible(n.kind, n.employee_id)
                  and not exists (select 1 from public.ep_admin_notification_reads r
                                   where r.notification_id = n.id and r.user_id = v_uid)),
    'counts', coalesce((select jsonb_object_agg(kind, c) from (
                 select kind, count(*) c from public.ep_admin_notifications n
                  where public.ep_admin_inbox_visible(n.kind, n.employee_id)
                    and not exists (select 1 from public.ep_admin_notification_reads r
                                     where r.notification_id = n.id and r.user_id = v_uid)
                  group by kind) k), '{}'::jsonb),
    'items', coalesce((
      select jsonb_agg(x.j order by x.created_at desc) from (
        select n.created_at, jsonb_build_object(
                 'id', n.id, 'kind', n.kind, 'priority', n.priority, 'title', n.title, 'body', n.body,
                 'link', n.link, 'created_at', n.created_at,
                 'read', exists (select 1 from public.ep_admin_notification_reads r
                                  where r.notification_id = n.id and r.user_id = v_uid),
                 'employee', (select jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code)
                                from public.ep_employees e where e.id = n.employee_id)) j
          from public.ep_admin_notifications n
         where public.ep_admin_inbox_visible(n.kind, n.employee_id)
           and case coalesce(p_filter, 'all')
                 when 'all' then true
                 when 'unread' then not exists (select 1 from public.ep_admin_notification_reads r
                                                 where r.notification_id = n.id and r.user_id = v_uid)
                 else n.kind = p_filter end
         order by n.created_at desc
         limit least(greatest(coalesce(p_limit, 200), 1), 500)) x), '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.ep_admin_inbox_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  perform public.rbac_require('portal.inbox.view'); -- rbac
  return jsonb_build_object('unread', (
    select count(*) from public.ep_admin_notifications n
     where public.ep_admin_inbox_visible(n.kind, n.employee_id)
       and not exists (select 1 from public.ep_admin_notification_reads r
                        where r.notification_id = n.id and r.user_id = v_uid)));
end $function$;

CREATE OR REPLACE FUNCTION public.ep_admin_inbox_mark_read(p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('portal.inbox.view'); -- rbac
  insert into public.ep_admin_notification_reads (notification_id, user_id)
  select n.id, auth.uid() from public.ep_admin_notifications n
   where (p_ids is null or n.id = any (p_ids))
     and public.ep_admin_inbox_visible(n.kind, n.employee_id)
  on conflict do nothing;
end $function$;

-- ===================== 265_report_without_projects.sql =====================

CREATE OR REPLACE FUNCTION public.ep_save_my_report(p_date date, p_notes text, p_items jsonb, p_submit boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp    uuid := public.ep_current_employee_id();
  v_today  date := (timezone('Asia/Kolkata', now()))::date;
  v_mgr    uuid;
  v_rep    public.ep_work_reports;
  v_item   jsonb;
  v_pid    uuid;
  v_hours  numeric;
  v_total  numeric := 0;
  v_seen   uuid[] := '{}';
  v_pos    int := 0;
  v_notes  text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  perform public.rbac_require('emp.reports.create'); -- rbac
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if p_date is null or p_date > v_today then
    raise exception 'You cannot write a report for a future date.' using errcode = '22023';
  end if;
  if p_date < v_today - 7 then
    raise exception 'Reports can only be written for today and the last 7 days.' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Invalid report entries.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 20 then
    raise exception 'A report can have at most 20 project entries.' using errcode = '22023';
  end if;
  if coalesce(length(v_notes), 0) > 2000 then
    raise exception 'Notes must be at most 2000 characters.' using errcode = '22023';
  end if;
  -- A report without any project entry is fine: then "what did you work on today" (notes) is required.
  if p_submit and jsonb_array_length(p_items) = 0 and v_notes is null then
    raise exception 'Write what you worked on today (or add a project entry) before submitting.' using errcode = '22023';
  end if;

  select reporting_manager_id into v_mgr from public.ep_employees where id = v_emp;
  -- No reporting manager in the portal: the report is submitted to the admin (submitted_to stays null).

  -- Serialise saves of the same report.
  perform pg_advisory_xact_lock(hashtextextended(v_emp::text || p_date::text, 0));
  select * into v_rep from public.ep_work_reports where employee_id = v_emp and report_date = p_date;
  if v_rep.id is not null and v_rep.status in ('submitted', 'reviewed') then
    raise exception 'This report is already submitted and cannot be changed.' using errcode = 'P0001';
  end if;

  -- Validate every entry before writing anything.
  for v_item in select * from jsonb_array_elements(p_items) loop
    begin
      v_pid   := (v_item ->> 'project_id')::uuid;
      v_hours := (v_item ->> 'hours')::numeric;
    exception when others then
      raise exception 'Invalid report entries.' using errcode = '22023';
    end;
    if v_pid is null or not exists (select 1 from public.ep_project_members where project_id = v_pid and employee_id = v_emp) then
      raise exception 'You can only report on projects you are assigned to.' using errcode = '42501';
    end if;
    if v_pid = any (v_seen) then
      raise exception 'Each project can be added only once per report.' using errcode = '22023';
    end if;
    v_seen := v_seen || v_pid;
    if v_hours is null or v_hours <= 0 or v_hours > 24 or v_hours <> round(v_hours, 2) then
      raise exception 'Hours spent must be more than 0 and at most 24 for each project.' using errcode = '22023';
    end if;
    v_total := v_total + v_hours;
    if coalesce(btrim(v_item ->> 'task_updates'), '') = '' and coalesce(btrim(v_item ->> 'completed_work'), '') = ''
       and coalesce(btrim(v_item ->> 'pending_work'), '') = '' then
      raise exception 'Write what you worked on for every project you added.' using errcode = '22023';
    end if;
    if greatest(length(v_item ->> 'task_updates'), length(v_item ->> 'completed_work'), length(v_item ->> 'pending_work')) > 2000 then
      raise exception 'Each text box can have at most 2000 characters.' using errcode = '22023';
    end if;
  end loop;
  if v_total > 24 then
    raise exception 'Total hours for the day cannot be more than 24.' using errcode = '22023';
  end if;

  if v_rep.id is null then
    insert into public.ep_work_reports (employee_id, report_date, notes)
    values (v_emp, p_date, v_notes) returning * into v_rep;
  else
    update public.ep_work_reports set notes = v_notes, updated_at = now() where id = v_rep.id;
  end if;

  delete from public.ep_work_report_items where report_id = v_rep.id;
  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.ep_work_report_items (report_id, project_id, task_updates, completed_work, pending_work, hours, position)
    values (v_rep.id, (v_item ->> 'project_id')::uuid,
            nullif(btrim(coalesce(v_item ->> 'task_updates', '')), ''),
            nullif(btrim(coalesce(v_item ->> 'completed_work', '')), ''),
            nullif(btrim(coalesce(v_item ->> 'pending_work', '')), ''),
            (v_item ->> 'hours')::numeric, v_pos);
    v_pos := v_pos + 1;
  end loop;

  if p_submit then
    update public.ep_work_reports
       set status = 'submitted', submitted_to = v_mgr, submitted_at = now(), updated_at = now(),
           reviewed_by = null, reviewed_at = null, review_comment = null
     where id = v_rep.id;
  end if;

  return public.ep_my_report(p_date);
end $function$;

-- ===================== 266_report_email.sql =====================

create table if not exists public.ep_report_emails (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.ep_work_reports (id) on delete cascade,
  employee_id uuid not null references public.ep_employees (id) on delete cascade,
  recipients  text[] not null check (cardinality(recipients) between 1 and 10),
  subject     text not null,
  request_id  bigint,
  status      text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  error       text,
  created_at  timestamptz not null default now()
);
create index if not exists ep_report_emails_emp_idx on public.ep_report_emails (employee_id, created_at desc);
alter table public.ep_report_emails enable row level security;
revoke all on public.ep_report_emails from anon, authenticated;
comment on table public.ep_report_emails is 'Daily work reports sent by email (migration 266). Written by ep_email_my_report.';

-- HTML-escape helper.
create or replace function public.ep_html(p text)
returns text
language sql immutable set search_path = ''
as $$
  select replace(replace(replace(replace(coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;');
$$;
revoke all on function public.ep_html(text) from public, anon, authenticated;

-- People the employee can pick (their sign-in emails).
create or replace function public.ep_report_email_options()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_emp public.ep_employees;
begin
  select * into v_emp from public.ep_employees where id = public.ep_current_employee_id();
  if v_emp.id is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(x.j order by x.ord, x.nm) from (
      select case when e.id = v_emp.reporting_manager_id then 0
                  when u.id = v_emp.admin_approver_id then 1 else 3 end as ord,
             lower(e.full_name) as nm,
             jsonb_build_object('email', u.email, 'name', e.full_name,
               'tag', case when e.id = v_emp.reporting_manager_id then 'Reporting manager'
                           when u.id = v_emp.admin_approver_id then 'Approver'
                           else coalesce(e.designation, 'Colleague') end) as j
        from public.ep_employees e join auth.users u on u.id = e.user_id
       where e.is_active and e.id <> v_emp.id and u.email is not null
      union all
      select case when u.id = v_emp.admin_approver_id then 1 else 2 end, lower(public.ep_user_display_name(u.id)),
             jsonb_build_object('email', u.email, 'name', public.ep_user_display_name(u.id),
               'tag', case when u.id = v_emp.admin_approver_id then 'Approver' else r.name end)
        from public.rbac_user_roles ur join public.rbac_roles r on r.key = ur.role_key and r.area = 'admin'
        join auth.users u on u.id = ur.user_id
       where u.email is not null and not exists (select 1 from public.ep_employees e2 where e2.user_id = u.id)
    ) x), '[]'::jsonb);
end $$;

create or replace function public.ep_email_my_report(p_date date, p_to text[])
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp     public.ep_employees;
  v_email   text;
  v_rep     public.ep_work_reports;
  v_json    jsonb;
  v_to      text[];
  v_bad     text;
  v_key     text;
  v_subject text;
  v_html    text;
  v_text    text;
  v_item    jsonb;
  v_req     bigint;
  v_id      uuid;
begin
  perform public.rbac_require('emp.reports.create');
  select * into v_emp from public.ep_employees where id = public.ep_current_employee_id();
  if v_emp.id is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  select email into v_email from auth.users where id = v_emp.user_id;

  select coalesce(array_agg(distinct lower(btrim(t))), '{}') into v_to
    from unnest(coalesce(p_to, '{}')) t where btrim(t) <> '';
  if cardinality(v_to) = 0 then
    raise exception 'Add at least one email address.' using errcode = '22023';
  end if;
  if cardinality(v_to) > 10 then
    raise exception 'You can send to at most 10 email addresses at a time.' using errcode = '22023';
  end if;
  select t into v_bad from unnest(v_to) t where t !~ '^[^@\s<>",;]+@[^@\s<>",;]+\.[a-z]{2,}$' or length(t) > 254 limit 1;
  if v_bad is not null then
    raise exception 'This is not a valid email address: %', v_bad using errcode = '22023';
  end if;

  select * into v_rep from public.ep_work_reports where employee_id = v_emp.id and report_date = p_date;
  if v_rep.id is null then
    raise exception 'Save the report first, then send it by email.' using errcode = 'P0002';
  end if;
  if (select count(*) from public.ep_report_emails
       where employee_id = v_emp.id and created_at > now() - interval '1 day') >= 30 then
    raise exception 'You can send at most 30 report emails a day.' using errcode = '22023';
  end if;

  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    raise exception 'Email is not set up yet (pg_net is not enabled). Please tell the admin.' using errcode = 'P0001';
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
  if v_key is null or btrim(v_key) = '' then
    raise exception 'Email is not set up yet (no Resend API key). Please tell the admin.' using errcode = 'P0001';
  end if;

  v_json := public.ep_report_json(v_rep.id);
  v_subject := 'Daily work report — ' || v_emp.full_name || ' (' || v_emp.employee_code || ') — '
               || to_char(p_date, 'Dy DD Mon YYYY');

  -- HTML + plain text: exactly what the employee wrote.
  v_html := '<div style="font-family:Arial,Helvetica,sans-serif;color:#2b303b;max-width:640px">'
    || '<h2 style="color:#1f4693;margin:0 0 4px">Daily work report</h2>'
    || '<p style="margin:0 0 16px;color:#676b7a">' || public.ep_html(v_emp.full_name) || ' (' || public.ep_html(v_emp.employee_code) || ')'
    || coalesce(' · ' || public.ep_html(v_emp.designation), '') || ' · ' || to_char(p_date, 'Dy DD Mon YYYY')
    || ' · status: ' || public.ep_html(v_rep.status) || '</p>';
  v_text := 'Daily work report' || chr(10) || v_emp.full_name || ' (' || v_emp.employee_code || ') · '
    || to_char(p_date, 'Dy DD Mon YYYY') || ' · status: ' || v_rep.status || chr(10) || chr(10);
  for v_item in select * from jsonb_array_elements(v_json -> 'items') loop
    v_html := v_html || '<div style="border:1px solid #e3e9f5;border-radius:10px;padding:12px 14px;margin:0 0 12px">'
      || '<p style="margin:0 0 8px;font-weight:bold;color:#101a3a">' || public.ep_html(v_item ->> 'project_name')
      || ' <span style="color:#9aa0ad;font-weight:normal">' || public.ep_html(v_item ->> 'project_code') || ' · '
      || public.ep_html(v_item ->> 'hours') || ' h</span></p>'
      || case when v_item ->> 'task_updates' is not null then '<p style="margin:0 0 6px"><b>Task updates:</b><br>' || replace(public.ep_html(v_item ->> 'task_updates'), chr(10), '<br>') || '</p>' else '' end
      || case when v_item ->> 'completed_work' is not null then '<p style="margin:0 0 6px"><b>Completed:</b><br>' || replace(public.ep_html(v_item ->> 'completed_work'), chr(10), '<br>') || '</p>' else '' end
      || case when v_item ->> 'pending_work' is not null then '<p style="margin:0"><b>Pending:</b><br>' || replace(public.ep_html(v_item ->> 'pending_work'), chr(10), '<br>') || '</p>' else '' end
      || '</div>';
    v_text := v_text || (v_item ->> 'project_name') || ' (' || (v_item ->> 'project_code') || ') · ' || (v_item ->> 'hours') || ' h' || chr(10)
      || coalesce('Task updates: ' || (v_item ->> 'task_updates') || chr(10), '')
      || coalesce('Completed: ' || (v_item ->> 'completed_work') || chr(10), '')
      || coalesce('Pending: ' || (v_item ->> 'pending_work') || chr(10), '') || chr(10);
  end loop;
  if v_rep.notes is not null then
    v_html := v_html || '<div style="border:1px solid #f7d9b5;background:#fffaf3;border-radius:10px;padding:12px 14px;margin:0 0 12px">'
      || '<p style="margin:0 0 6px;font-weight:bold">'
      || case when jsonb_array_length(v_json -> 'items') = 0 then 'Work done today' else 'Other work, notes / blockers' end
      || '</p><p style="margin:0">' || replace(public.ep_html(v_rep.notes), chr(10), '<br>') || '</p></div>';
    v_text := v_text || case when jsonb_array_length(v_json -> 'items') = 0 then 'Work done today: ' else 'Notes: ' end
      || v_rep.notes || chr(10) || chr(10);
  end if;
  v_html := v_html || '<p style="color:#676b7a">Total hours: <b>' || coalesce(v_json ->> 'total_hours', '0') || '</b></p>'
    || '<p style="color:#9aa0ad;font-size:12px">Sent from the Zyllo Tech Employee Portal. Reply to this email to answer '
    || public.ep_html(v_emp.full_name) || '.</p></div>';
  v_text := v_text || 'Total hours: ' || coalesce(v_json ->> 'total_hours', '0') || chr(10)
    || 'Sent from the Zyllo Tech Employee Portal. Reply to this email to answer ' || v_emp.full_name || '.';

  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 10000)'
    into v_req
    using 'https://api.resend.com/emails',
          jsonb_build_object(
            'from', replace(v_emp.full_name, '"', '') || ' via Zyllo Tech <info@zyllotech.com>',
            'to', to_jsonb(v_to),
            'reply_to', v_email,
            'subject', v_subject,
            'html', v_html,
            'text', v_text),
          jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key);

  insert into public.ep_report_emails (report_id, employee_id, recipients, subject, request_id)
  values (v_rep.id, v_emp.id, v_to, v_subject, v_req)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'status', 'sending', 'recipients', to_jsonb(v_to));
end $$;

-- Sent emails of a day + delivery status (read from pg_net's response log).
create or replace function public.ep_my_report_emails(p_date date)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
  r     record;
  v_code int;
  v_body text;
  v_err  text;
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  -- Update statuses still "sending" from pg_net's responses.
  if to_regclass('net._http_response') is not null then
    for r in select e.id, e.request_id from public.ep_report_emails e
              join public.ep_work_reports w on w.id = e.report_id
             where e.employee_id = v_emp and w.report_date = p_date and e.status = 'sending' and e.request_id is not null loop
      execute 'select status_code, content::text, error_msg from net._http_response where id = $1'
        into v_code, v_body, v_err using r.request_id;
      if v_code between 200 and 299 then
        update public.ep_report_emails set status = 'sent', error = null where id = r.id;
      elsif v_code is not null or v_err is not null then
        update public.ep_report_emails
           set status = 'failed', error = left(coalesce(v_body, v_err, 'Unknown error'), 500)
         where id = r.id;
      end if;
    end loop;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'recipients', to_jsonb(e.recipients), 'status', e.status,
                                        'error', e.error, 'created_at', e.created_at) order by e.created_at desc)
      from public.ep_report_emails e join public.ep_work_reports w on w.id = e.report_id
     where e.employee_id = v_emp and w.report_date = p_date), '[]'::jsonb);
end $$;

revoke all on function public.ep_report_email_options(), public.ep_email_my_report(date, text[]),
  public.ep_my_report_emails(date) from public, anon;
grant execute on function public.ep_report_email_options(), public.ep_email_my_report(date, text[]),
  public.ep_my_report_emails(date) to authenticated;

-- ===================== 267_real_email_for_staff.sql =====================

-- false for reserved / placeholder / test domains (RFC 2606 / 6761 and common throwaway placeholders).
create or replace function public.ep_email_is_real(p_email text)
returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(p_email, '') ~* '^[^@\s]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$'
     and lower(split_part(p_email, '@', 2)) !~ '(^|\.)(example\.(com|net|org)|test|invalid|localhost|local|example|internal|lan|home|corp|localdomain)$'
     and lower(split_part(p_email, '@', 2)) not in ('mailinator.com', 'tempmail.com', '10minutemail.com', 'guerrillamail.com',
                                                    'yopmail.com', 'trashmail.com', 'fake.com', 'test.com', 'email.com');
$$;
grant execute on function public.ep_email_is_real(text) to authenticated;

CREATE OR REPLACE FUNCTION public.ep_admin_create_employee(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f          text;
  v_code     text := upper(btrim(coalesce(p ->> 'employee_code', '')));
  v_name     text := btrim(coalesce(p ->> 'full_name', ''));
  v_email    text := lower(btrim(coalesce(p ->> 'email', '')));
  v_password text := coalesce(p ->> 'password', '');
  v_user     uuid;
  v_linked   boolean := false;
  v_emp      uuid;
  v_work     jsonb;
begin
  perform public.rbac_require('portal.employees.create'); -- rbac
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Invalid employee data.' using errcode = '22023';
  end if;
  for f in select jsonb_object_keys(p) loop
    if f not in ('employee_code', 'full_name', 'email', 'password', 'department', 'designation',
                 'reporting_manager_id', 'reporting_manager_name', 'date_of_joining', 'employment_type', 'work_location') then
      raise exception 'Field % cannot be set here.', f using errcode = '42501';
    end if;
  end loop;

  if v_code !~ '^[A-Z0-9][A-Z0-9-]{1,29}$' then
    raise exception 'Employee ID: use 2-30 letters, numbers or dashes (e.g. ZT-001).' using errcode = '22023';
  end if;
  if length(v_name) not between 1 and 120 then
    raise exception 'Name is required (up to 120 characters).' using errcode = '22023';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'Enter a valid work email.' using errcode = '22023';
  end if;
  -- Employees sign in with their own real email (migration 267).
  if not public.ep_email_is_real(v_email) then
    raise exception 'Use the person''s real email address: % cannot receive email.', v_email using errcode = '22023';
  end if;
  if exists (select 1 from public.ep_employees where employee_code = v_code) then
    raise exception 'Employee ID % is already used.', v_code using errcode = '23505';
  end if;

  -- Same email twice at the same moment: serialise.
  perform pg_advisory_xact_lock(hashtextextended('ep_create_employee:' || v_email, 0));

  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is not null then
    if exists (select 1 from public.ep_employees where user_id = v_user) then
      raise exception 'This email already belongs to an employee.' using errcode = '23505';
    end if;
    if public.ep_user_is_admin(v_user) then
      raise exception 'This email is an admin account. Use a separate email for the employee.' using errcode = '22023';
    end if;
    v_linked := true;
  else
    if public.ep_password_problem(v_password) is not null then
      raise exception 'Temporary password: %', public.ep_password_problem(v_password) using errcode = '22023';
    end if;
    v_user := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
      extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('full_name', v_name), now(), now(),
      '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    values (
      v_user::text, v_user,
      jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true),
      'email', now(), now());
  end if;

  -- A new login with a temporary password must be changed at the first sign-in.
  insert into public.ep_employees (user_id, employee_code, full_name, must_change_password)
  values (v_user, v_code, v_name, not v_linked)
  returning id into v_emp;

  -- Work details: only the keys given, with the same checks as editing.
  v_work := p - 'employee_code' - 'full_name' - 'email' - 'password';
  if v_work <> '{}'::jsonb then
    perform public.ep_admin_update_employee(v_emp, v_work);
  end if;

  perform public.ep_notify(
    v_emp, 'message', 'Welcome to the Zyllo Tech Employee Portal',
    'Your account is ready. Please complete your personal details and emergency contacts in My Profile.',
    '/employee/profile');

  return public.ep_admin_employee(v_emp) || jsonb_build_object('linked_existing_account', v_linked);
end $function$;

CREATE OR REPLACE FUNCTION public.rbac_admin_create_user(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_email text := lower(btrim(coalesce(p ->> 'email', '')));
  v_name  text := nullif(btrim(coalesce(p ->> 'full_name', '')), '');
  v_pw    text := coalesce(p ->> 'password', '');
  v_roles text[] := coalesce((select array_agg(distinct r) from jsonb_array_elements_text(coalesce(p -> 'roles', '[]'::jsonb)) r), '{}');
  v_user  uuid;
  v_bad   text;
begin
  perform public.rbac_require('settings.users.create');
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'Enter a valid sign-in email.' using errcode = '22023';
  end if;
  -- Only Super Admin / Admin may use an email that is not a real mailbox (migration 267).
  if exists (select 1 from jsonb_array_elements_text(coalesce(p -> 'roles', '[]'::jsonb)) r where r not in ('super_admin', 'admin'))
     and not public.ep_email_is_real(v_email) then
    raise exception 'Use the person''s real email address: % cannot receive email.', v_email using errcode = '22023';
  end if;
  if v_name is null or length(v_name) > 120 then
    raise exception 'Name is required (up to 120 characters).' using errcode = '22023';
  end if;
  if cardinality(v_roles) <> 1 then
    raise exception 'Choose one role (a person has one role at a time).' using errcode = '22023';
  end if;
  select r into v_bad from unnest(v_roles) r
   where r not in (select key from public.rbac_roles where area = 'admin') limit 1;
  if v_bad is not null then
    raise exception 'Only admin-area roles can be given here (Super Admin, Admin, HR).' using errcode = '22023';
  end if;
  if 'super_admin' = any (v_roles)
     and not exists (select 1 from public.rbac_user_roles where user_id = auth.uid() and role_key = 'super_admin') then
    raise exception 'Only a Super Admin can give the Super Admin role.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rbac_create_user:' || v_email, 0));
  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is not null then
    if exists (select 1 from public.rbac_user_roles where user_id = v_user)
       or exists (select 1 from public.ep_employees where user_id = v_user) then
      raise exception 'This email already has an account. Change its roles in the list instead.' using errcode = '23505';
    end if;
  else
    if public.ep_password_problem(v_pw) is not null then
      raise exception 'Password: %', public.ep_password_problem(v_pw) using errcode = '22023';
    end if;
    v_user := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
      extensions.crypt(v_pw, extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('full_name', v_name), now(), now(),
      '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    values (v_user::text, v_user,
            jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true), 'email', now(), now());
  end if;
  insert into public.rbac_user_roles (user_id, role_key, granted_by)
  select v_user, r, auth.uid() from unnest(v_roles) r on conflict do nothing;
  return v_user;
end $function$;

CREATE OR REPLACE FUNCTION public.rbac_admin_set_user_roles(p_user uuid, p_roles text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_new   text[] := coalesce((select array_agg(distinct r) from unnest(coalesce(p_roles, '{}')) r), '{}');
  v_old   text[];
  v_super boolean := public.rbac_user_can(auth.uid(), 'settings.users.edit')
                     and exists (select 1 from public.rbac_user_roles where user_id = auth.uid() and role_key = 'super_admin');
  v_bad   text;
begin
  perform public.rbac_require('settings.users.edit');
  if p_user = auth.uid() then
    raise exception 'You cannot change your own roles. Ask another Super Admin.' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'User not found.' using errcode = 'P0002';
  end if;
  select r into v_bad from unnest(v_new) r where r not in (select key from public.rbac_roles) limit 1;
  if v_bad is not null then
    raise exception 'Unknown role %.', v_bad using errcode = '22023';
  end if;
  -- One role per person (migration 263). "Employee" = no other role (Employee Portal accounts only).
  if 'employee' = any (v_new) then
    if not exists (select 1 from public.ep_employees where user_id = p_user) then
      raise exception 'Employee is only for Employee Portal accounts.' using errcode = '22023';
    end if;
    v_new := array_remove(v_new, 'employee');
  end if;
  if cardinality(v_new) > 1 then
    raise exception 'A person can have only one role at a time. Choose one.' using errcode = '22023';
  end if;
  if cardinality(v_new) = 0 and not exists (select 1 from public.ep_employees where user_id = p_user) then
    raise exception 'Choose a role.' using errcode = '22023';
  end if;
  -- HR, Manager, Team Lead and Employee need a real email (migration 267); Super Admin / Admin do not.
  if not ('super_admin' = any (v_new) or 'admin' = any (v_new))
     and not public.ep_email_is_real((select email from auth.users where id = p_user)) then
    raise exception 'Use the person''s real email address: % cannot receive email.', (select email from auth.users where id = p_user) using errcode = '22023';
  end if;
  if (('manager' = any (v_new)) or ('team_lead' = any (v_new)))
     and not exists (select 1 from public.ep_employees where user_id = p_user) then
    raise exception 'Manager and Team Lead are for Employee Portal accounts.' using errcode = '22023';
  end if;
  select coalesce(array_agg(role_key), '{}') into v_old from public.rbac_user_roles where user_id = p_user;
  if (('super_admin' = any (v_new)) <> ('super_admin' = any (v_old))) and not v_super then
    raise exception 'Only a Super Admin can give or remove the Super Admin role.' using errcode = '42501';
  end if;
  delete from public.rbac_user_roles where user_id = p_user and role_key <> all (v_new);
  insert into public.rbac_user_roles (user_id, role_key, granted_by)
  select p_user, r, auth.uid() from unnest(v_new) r on conflict do nothing;
  if not exists (select 1 from public.rbac_user_roles where role_key = 'super_admin') then
    raise exception 'There must always be at least one Super Admin.' using errcode = '22023';
  end if;
  return to_jsonb(coalesce((select array_agg(role_key order by role_key) from public.rbac_user_roles where user_id = p_user), '{}'));
end $function$;

-- ===================== 268_welcome_email.sql =====================

-- ================================================================ tables
create table if not exists public.rbac_welcome_emails (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  email            text not null,
  kind             text not null default 'welcome' check (kind in ('welcome', 'resend')),
  status           text not null default 'sending' check (status in ('sending', 'sent', 'delivered', 'bounced', 'failed')),
  send_request_id  bigint,
  resend_id        text,
  check_request_id bigint,
  last_event       text,
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists rbac_welcome_emails_user_idx on public.rbac_welcome_emails (user_id, created_at desc);
create index if not exists rbac_welcome_emails_open_idx on public.rbac_welcome_emails (status, created_at) where status in ('sending', 'sent');
alter table public.rbac_welcome_emails enable row level security;
revoke all on public.rbac_welcome_emails from anon, authenticated;

-- Admin-area users who still have the one-time password (employees use ep_employees.must_change_password).
create table if not exists public.rbac_user_flags (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  must_change_password boolean not null default false
);
alter table public.rbac_user_flags enable row level security;
revoke all on public.rbac_user_flags from anon, authenticated;

-- ================================================================ helpers
-- Is sending email set up on this database? (no secret is returned)
create or replace function public.rbac_email_ready()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null
     and exists (select 1 from vault.secrets where name = 'resend_api_key');
$$;
grant execute on function public.rbac_email_ready() to authenticated;

-- A one-time password that follows the password rules (upper, lower, digit, special).
create or replace function public.rbac_one_time_password()
returns text
language sql volatile set search_path = ''
as $$
  select 'Zt' || substr(md5(gen_random_uuid()::text), 1, 6) || '#' || (floor(random() * 90) + 10)::int::text;
$$;

-- Queue the welcome email. Returns 'sending', or 'not_configured' when email is not set up.
create or replace function public.rbac_queue_welcome(p_user uuid, p_email text, p_name text, p_password text, p_kind text default 'welcome')
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_key  text;
  v_req  bigint;
  v_html text;
  v_text text;
begin
  if not public.rbac_email_ready() then
    return 'not_configured';
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
  v_html := '<div style="font-family:Arial,Helvetica,sans-serif;color:#2b303b;max-width:560px">'
    || '<h2 style="color:#1f4693;margin:0 0 12px">Welcome to Zyllo Tech</h2>'
    || '<p>Hello ' || public.ep_html(coalesce(p_name, '')) || ',</p>'
    || '<p>' || case when p_kind = 'resend' then 'Here are your new sign-in details' else 'An account has been created for you' end
    || '. Sign in at <a href="https://zyllotech.com/login">zyllotech.com/login</a> with:</p>'
    || '<table style="border-collapse:collapse;margin:8px 0 16px">'
    || '<tr><td style="padding:6px 12px 6px 0;color:#676b7a">Sign-in email</td><td style="padding:6px 0"><b>' || public.ep_html(p_email) || '</b></td></tr>'
    || '<tr><td style="padding:6px 12px 6px 0;color:#676b7a">One-time password</td><td style="padding:6px 0;font-family:monospace;font-size:16px"><b>' || public.ep_html(p_password) || '</b></td></tr>'
    || '</table>'
    || '<p>You will be asked to choose your own password when you sign in for the first time.</p>'
    || '<p style="color:#9aa0ad;font-size:12px">If you did not expect this email, you can ignore it.</p></div>';
  v_text := 'Welcome to Zyllo Tech' || chr(10) || chr(10)
    || 'Sign in at https://zyllotech.com/login' || chr(10)
    || 'Sign-in email: ' || p_email || chr(10)
    || 'One-time password: ' || p_password || chr(10) || chr(10)
    || 'You will be asked to choose your own password when you sign in for the first time.';
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 10000)'
    into v_req
    using 'https://api.resend.com/emails',
          jsonb_build_object('from', 'Zyllo Tech <info@zyllotech.com>', 'to', jsonb_build_array(p_email),
                             'subject', 'Your Zyllo Tech sign-in details', 'html', v_html, 'text', v_text),
          jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key);
  insert into public.rbac_welcome_emails (user_id, email, kind, send_request_id) values (p_user, p_email, p_kind, v_req);
  return 'sending';
end $$;

-- Latest welcome email of a user (for the admin screens).
create or replace function public.rbac_welcome_json(p_user uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('status', w.status, 'email', w.email, 'kind', w.kind, 'error', w.error,
                            'created_at', w.created_at, 'updated_at', w.updated_at)
    from public.rbac_welcome_emails w where w.user_id = p_user order by w.created_at desc limit 1;
$$;

-- Every 5 minutes: delivery status of recent welcome emails; bounces -> urgent admin notification.
create or replace function public.rbac_check_welcome_emails()
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  w      public.rbac_welcome_emails;
  v_code int;
  v_body text;
  v_err  text;
  v_json jsonb;
  v_key  text;
  v_emp  uuid;
  v_link text;
  v_n    int := 0;
begin
  if to_regclass('net._http_response') is null then
    return 0;
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
  for w in select * from public.rbac_welcome_emails
            where status in ('sending', 'sent') and created_at > now() - interval '3 days' for update skip locked loop
    select id into v_emp from public.ep_employees where user_id = w.user_id;
    v_link := case when v_emp is not null then '/admin/employees/' || v_emp else '/admin/settings/users' end;

    if w.status = 'sending' then
      v_code := null; v_body := null; v_err := null;
      execute 'select status_code, content::text, error_msg from net._http_response where id = $1'
        into v_code, v_body, v_err using w.send_request_id;
      if v_code between 200 and 299 then
        begin v_json := v_body::jsonb; exception when others then v_json := '{}'::jsonb; end;
        update public.rbac_welcome_emails set status = 'sent', resend_id = v_json ->> 'id', updated_at = now() where id = w.id;
        w.status := 'sent';
        w.resend_id := v_json ->> 'id';
      elsif v_code is not null or v_err is not null or w.created_at < now() - interval '1 hour' then
        update public.rbac_welcome_emails
           set status = 'failed', error = left(coalesce(v_body, v_err, 'No answer from the email service'), 500), updated_at = now()
         where id = w.id;
        perform public.ep_admin_notify(v_emp, 'account', 'Sign-in email could not be sent to ' || w.email,
          'The welcome email with the one-time password was not sent: ' || left(coalesce(v_body, v_err, 'no answer from the email service'), 200),
          v_link, 'urgent');
      end if;
      if w.status <> 'sent' then
        v_n := v_n + 1;
        continue;
      end if;
      -- accepted just now: ask Resend for its delivery status right away (below)
    end if;

    -- status 'sent': read the last check, then ask again (Resend GET /emails/{id})
    if w.check_request_id is not null then
      v_code := null; v_body := null;
      execute 'select status_code, content::text from net._http_response where id = $1'
        into v_code, v_body using w.check_request_id;
      if v_code between 200 and 299 then
        begin v_json := v_body::jsonb; exception when others then v_json := '{}'::jsonb; end;
        update public.rbac_welcome_emails set last_event = v_json ->> 'last_event', updated_at = now() where id = w.id;
        if v_json ->> 'last_event' in ('delivered', 'opened', 'clicked', 'complained') then
          update public.rbac_welcome_emails set status = 'delivered' where id = w.id;
          continue;
        elsif v_json ->> 'last_event' = 'bounced' then
          update public.rbac_welcome_emails set status = 'bounced', error = 'Mailbox does not exist (bounced)' where id = w.id;
          perform public.ep_admin_notify(v_emp, 'account', 'Mailbox does not exist: ' || w.email,
            'The welcome email with the one-time password bounced, so this person cannot sign in. '
              || 'Open their page and use “Change sign-in email & resend” with their correct email.',
            v_link, 'urgent');
          continue;
        end if;
      end if;
    end if;
    if w.resend_id is not null and v_key is not null then
      execute 'select net.http_get(url := $1, headers := $2, timeout_milliseconds := 10000)'
        into v_code
        using 'https://api.resend.com/emails/' || w.resend_id,
              jsonb_build_object('Authorization', 'Bearer ' || v_key);
      update public.rbac_welcome_emails set check_request_id = v_code where id = w.id;
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Admin: correct the sign-in email of a person and email them a new one-time password.
create or replace function public.rbac_admin_change_email(p_user uuid, p_email text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_emp   public.ep_employees;
  v_role  text;
  v_name  text;
  v_pw    text := public.rbac_one_time_password();
  v_state text;
begin
  select * into v_emp from public.ep_employees where user_id = p_user;
  if v_emp.id is not null then
    perform public.rbac_require_any(array['portal.employees.edit', 'settings.users.edit']);
  else
    perform public.rbac_require('settings.users.edit');
  end if;
  if p_user = auth.uid() then
    raise exception 'Change your own email is not possible here.' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'User not found.' using errcode = 'P0002';
  end if;
  select role_key into v_role from public.rbac_user_roles where user_id = p_user;
  if v_role = 'super_admin' and not public.ep_is_super_admin() then
    raise exception 'Only a Super Admin can change a Super Admin''s email.' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'Enter a valid sign-in email.' using errcode = '22023';
  end if;
  if coalesce(v_role, 'employee') not in ('super_admin', 'admin') and not public.ep_email_is_real(v_email) then
    raise exception 'Use the person''s real email address: % cannot receive email.', v_email using errcode = '22023';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email and id <> p_user) then
    raise exception 'This email already belongs to another account.' using errcode = '23505';
  end if;
  update auth.users
     set email = v_email, encrypted_password = extensions.crypt(v_pw, extensions.gen_salt('bf')),
         email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
   where id = p_user;
  update auth.identities
     set identity_data = coalesce(identity_data, '{}'::jsonb) || jsonb_build_object('email', v_email), updated_at = now()
   where user_id = p_user and provider = 'email';
  if v_emp.id is not null then
    update public.ep_employees set must_change_password = true, updated_at = now() where id = v_emp.id;
  else
    insert into public.rbac_user_flags (user_id, must_change_password) values (p_user, true)
    on conflict (user_id) do update set must_change_password = true;
  end if;
  v_name := public.ep_user_display_name(p_user);
  v_state := public.rbac_queue_welcome(p_user, v_email, v_name, v_pw, 'resend');
  return jsonb_build_object('email', v_email, 'welcome', v_state,
                            'password', case when v_state = 'not_configured' then v_pw end);
end $$;

revoke all on function public.rbac_one_time_password(), public.rbac_queue_welcome(uuid, text, text, text, text),
  public.rbac_welcome_json(uuid), public.rbac_check_welcome_emails() from public, anon, authenticated;
revoke all on function public.rbac_admin_change_email(uuid, text) from public, anon;
grant execute on function public.rbac_admin_change_email(uuid, text) to authenticated;

-- ================================================================ updated functions (generated)
CREATE OR REPLACE FUNCTION public.ep_admin_create_employee(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f          text;
  v_code     text := upper(btrim(coalesce(p ->> 'employee_code', '')));
  v_name     text := btrim(coalesce(p ->> 'full_name', ''));
  v_email    text := lower(btrim(coalesce(p ->> 'email', '')));
  v_password text := coalesce(p ->> 'password', '');
  v_user     uuid;
  v_linked   boolean := false;
  v_welcome  text := 'linked';
  v_emp      uuid;
  v_work     jsonb;
begin
  perform public.rbac_require('portal.employees.create'); -- rbac
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Invalid employee data.' using errcode = '22023';
  end if;
  for f in select jsonb_object_keys(p) loop
    if f not in ('employee_code', 'full_name', 'email', 'password', 'department', 'designation',
                 'reporting_manager_id', 'reporting_manager_name', 'date_of_joining', 'employment_type', 'work_location') then
      raise exception 'Field % cannot be set here.', f using errcode = '42501';
    end if;
  end loop;

  if v_code !~ '^[A-Z0-9][A-Z0-9-]{1,29}$' then
    raise exception 'Employee ID: use 2-30 letters, numbers or dashes (e.g. ZT-001).' using errcode = '22023';
  end if;
  if length(v_name) not between 1 and 120 then
    raise exception 'Name is required (up to 120 characters).' using errcode = '22023';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'Enter a valid work email.' using errcode = '22023';
  end if;
  -- Employees sign in with their own real email (migration 267).
  if not public.ep_email_is_real(v_email) then
    raise exception 'Use the person''s real email address: % cannot receive email.', v_email using errcode = '22023';
  end if;
  if exists (select 1 from public.ep_employees where employee_code = v_code) then
    raise exception 'Employee ID % is already used.', v_code using errcode = '23505';
  end if;

  -- Same email twice at the same moment: serialise.
  perform pg_advisory_xact_lock(hashtextextended('ep_create_employee:' || v_email, 0));

  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is not null then
    if exists (select 1 from public.ep_employees where user_id = v_user) then
      raise exception 'This email already belongs to an employee.' using errcode = '23505';
    end if;
    if public.ep_user_is_admin(v_user) then
      raise exception 'This email is an admin account. Use a separate email for the employee.' using errcode = '22023';
    end if;
    v_linked := true;
  else
    if public.ep_password_problem(v_password) is not null then
      raise exception 'Temporary password: %', public.ep_password_problem(v_password) using errcode = '22023';
    end if;
    v_user := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
      extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('full_name', v_name), now(), now(),
      '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    values (
      v_user::text, v_user,
      jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true),
      'email', now(), now());
  end if;

  -- A new login with a temporary password must be changed at the first sign-in.
  insert into public.ep_employees (user_id, employee_code, full_name, must_change_password)
  values (v_user, v_code, v_name, not v_linked)
  returning id into v_emp;

  -- Work details: only the keys given, with the same checks as editing.
  v_work := p - 'employee_code' - 'full_name' - 'email' - 'password';
  if v_work <> '{}'::jsonb then
    perform public.ep_admin_update_employee(v_emp, v_work);
  end if;

  perform public.ep_notify(
    v_emp, 'message', 'Welcome to the Zyllo Tech Employee Portal',
    'Your account is ready. Please complete your personal details and emergency contacts in My Profile.',
    '/employee/profile');

  -- Email the sign-in email + one-time password (migration 268).
  if not v_linked then
    v_welcome := public.rbac_queue_welcome(v_user, v_email, v_name, v_password, 'welcome');
  end if;
  return public.ep_admin_employee(v_emp) || jsonb_build_object('linked_existing_account', v_linked, 'welcome', v_welcome);
end $function$;

CREATE OR REPLACE FUNCTION public.rbac_admin_create_user(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_email text := lower(btrim(coalesce(p ->> 'email', '')));
  v_name  text := nullif(btrim(coalesce(p ->> 'full_name', '')), '');
  v_pw    text := coalesce(p ->> 'password', '');
  v_roles text[] := coalesce((select array_agg(distinct r) from jsonb_array_elements_text(coalesce(p -> 'roles', '[]'::jsonb)) r), '{}');
  v_user  uuid;
  v_bad   text;
begin
  perform public.rbac_require('settings.users.create');
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'Enter a valid sign-in email.' using errcode = '22023';
  end if;
  -- Only Super Admin / Admin may use an email that is not a real mailbox (migration 267).
  if exists (select 1 from jsonb_array_elements_text(coalesce(p -> 'roles', '[]'::jsonb)) r where r not in ('super_admin', 'admin'))
     and not public.ep_email_is_real(v_email) then
    raise exception 'Use the person''s real email address: % cannot receive email.', v_email using errcode = '22023';
  end if;
  if v_name is null or length(v_name) > 120 then
    raise exception 'Name is required (up to 120 characters).' using errcode = '22023';
  end if;
  if cardinality(v_roles) <> 1 then
    raise exception 'Choose one role (a person has one role at a time).' using errcode = '22023';
  end if;
  select r into v_bad from unnest(v_roles) r
   where r not in (select key from public.rbac_roles where area = 'admin') limit 1;
  if v_bad is not null then
    raise exception 'Only admin-area roles can be given here (Super Admin, Admin, HR).' using errcode = '22023';
  end if;
  if 'super_admin' = any (v_roles)
     and not exists (select 1 from public.rbac_user_roles where user_id = auth.uid() and role_key = 'super_admin') then
    raise exception 'Only a Super Admin can give the Super Admin role.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rbac_create_user:' || v_email, 0));
  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is not null then
    if exists (select 1 from public.rbac_user_roles where user_id = v_user)
       or exists (select 1 from public.ep_employees where user_id = v_user) then
      raise exception 'This email already has an account. Change its roles in the list instead.' using errcode = '23505';
    end if;
  else
    if public.ep_password_problem(v_pw) is not null then
      raise exception 'Password: %', public.ep_password_problem(v_pw) using errcode = '22023';
    end if;
    v_user := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
      extensions.crypt(v_pw, extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('full_name', v_name), now(), now(),
      '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    values (v_user::text, v_user,
            jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true), 'email', now(), now());
    -- One-time password: emailed (migration 268) and changed at the first sign-in.
    insert into public.rbac_user_flags (user_id, must_change_password) values (v_user, true)
    on conflict (user_id) do update set must_change_password = true;
    perform public.rbac_queue_welcome(v_user, v_email, v_name, v_pw, 'welcome');
  end if;
  insert into public.rbac_user_roles (user_id, role_key, granted_by)
  select v_user, r, auth.uid() from unnest(v_roles) r on conflict do nothing;
  return v_user;
end $function$;

CREATE OR REPLACE FUNCTION public.rbac_my_access()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid   uuid := auth.uid();
  v_roles text[] := public.rbac_roles_of(auth.uid());
  v_super boolean := 'super_admin' = any (public.rbac_roles_of(auth.uid()));
begin
  if v_uid is null then
    return jsonb_build_object('roles', '[]'::jsonb, 'permissions', '[]'::jsonb, 'is_admin', false, 'is_super_admin', false);
  end if;
  return jsonb_build_object(
    'is_super_admin', v_super,
    'must_change_password', coalesce((select f.must_change_password from public.rbac_user_flags f where f.user_id = v_uid), false),
    'is_admin', public.rbac_user_has_admin_pages(v_uid),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('key', r.key, 'name', r.name, 'area', r.area) order by r.sort_order)
                         from public.rbac_roles r where r.key = any (v_roles)), '[]'::jsonb),
    'permissions', coalesce((select jsonb_agg(p.key order by p.sort_order) from public.rbac_permissions p
                              where v_super or exists (select 1 from public.rbac_role_permissions rp
                                                        where rp.permission_key = p.key and rp.role_key = any (v_roles))),
                            '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.rbac_my_change_password(p_current text, p_new text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid  uuid := auth.uid();
  v_hash text;
begin
  if v_uid is null then
    raise exception 'Please sign in again.' using errcode = '42501';
  end if;
  select encrypted_password into v_hash from auth.users where id = v_uid;
  if v_hash is null or v_hash = '' or extensions.crypt(coalesce(p_current, ''), v_hash) <> v_hash then
    perform pg_sleep(1); -- slows down guessing
    raise exception 'Your current password is not correct.' using errcode = '22023';
  end if;
  if public.ep_password_problem(p_new) is not null then
    raise exception 'New password: %', public.ep_password_problem(p_new) using errcode = '22023';
  end if;
  if p_new = p_current then
    raise exception 'The new password must be different from the current one.' using errcode = '22023';
  end if;
  update auth.users set encrypted_password = extensions.crypt(p_new, extensions.gen_salt('bf')), updated_at = now()
   where id = v_uid;
  update public.ep_employees set must_change_password = false where user_id = v_uid and must_change_password;
  update public.rbac_user_flags set must_change_password = false where user_id = v_uid;
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.ep_admin_employee_json(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id',              e.id,
    'employee_code',   e.employee_code,
    'full_name',       e.full_name,
    'work_email',      u.email,
    'department',      e.department,
    'designation',     e.designation,
    'date_of_joining', e.date_of_joining,
    'employment_type', e.employment_type,
    'work_location',   e.work_location,
    'is_active',       e.is_active,
    'created_at',      e.created_at,
    'last_sign_in_at', u.last_sign_in_at,
    'manager', case when m.id is null then null else jsonb_build_object(
      'id', m.id, 'full_name', m.full_name, 'employee_code', m.employee_code,
      'designation', m.designation, 'is_active', m.is_active) end,
    'manager_name', case when m.id is null then e.reporting_manager_name end,
    'user_id', e.user_id,
    'sign_in_email', u.email,
    'welcome', public.rbac_welcome_json(e.user_id),
    'admin_approver', case when e.admin_approver_id is not null then jsonb_build_object('user_id', e.admin_approver_id,
                         'name', public.ep_user_display_name(e.admin_approver_id)) end,
    'reports_count', (select count(*) from public.ep_employees r where r.reporting_manager_id = e.id),
    'punched_in', exists (select 1 from public.ep_attendance a where a.employee_id = e.id and a.punch_out_at is null)
  )
  from public.ep_employees e
  left join auth.users u on u.id = e.user_id
  left join public.ep_employees m on m.id = e.reporting_manager_id
  where e.id = p_id;
$function$;

CREATE OR REPLACE FUNCTION public.rbac_admin_users()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('settings.users.view');
  return coalesce((
    select jsonb_agg(x.j order by x.ord, x.nm) from (
      select (case when exists (select 1 from public.rbac_user_roles ur join public.rbac_roles r on r.key = ur.role_key
                                 where ur.user_id = u.id and r.area = 'admin') then 0 else 1 end) as ord,
             lower(coalesce(e.full_name, u.raw_user_meta_data ->> 'full_name', u.email)) as nm,
             jsonb_build_object(
               'user_id', u.id,
               'sign_in', u.email,
               'full_name', coalesce(e.full_name, nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1)),
               'employee_id', e.id, 'employee_code', e.employee_code, 'employee_active', e.is_active,
               'roles', coalesce((select jsonb_agg(ur.role_key order by r.sort_order)
                                    from public.rbac_user_roles ur join public.rbac_roles r on r.key = ur.role_key
                                   where ur.user_id = u.id), '[]'::jsonb),
               'last_sign_in_at', u.last_sign_in_at, 'created_at', u.created_at,
               'is_self', u.id = auth.uid(),
               'welcome', public.rbac_welcome_json(u.id)) as j
        from auth.users u
        left join public.ep_employees e on e.user_id = u.id
       where e.id is not null or exists (select 1 from public.rbac_user_roles ur where ur.user_id = u.id)) x),
    '[]'::jsonb);
end $function$;

-- ================================================================ every 5 minutes
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobname) from cron.job where jobname = 'rbac-welcome-check';
    perform cron.schedule('rbac-welcome-check', '*/5 * * * *', 'select public.rbac_check_welcome_emails()');
  else
    raise warning 'pg_cron is not enabled: bounces of welcome emails will not be checked automatically.';
  end if;
end $$;

notify pgrst, 'reload schema';

select '253: Employee ID can be edited' as result,
       position('''employee_code'', ''full_name''' in pg_get_functiondef('public.ep_admin_update_employee(uuid, jsonb)'::regprocedure)) > 0 as ok
union all
select '256: admin notifications (11 triggers)', (select count(*) from pg_trigger where tgname like 'ep_admin_%') = 11
union all
select '257/258: manager review -> admin -> manager approval',
       exists (select 1 from pg_constraint where conname = 'ep_leave_requests_status_check'
                and pg_get_constraintdef(oid) like '%manager_review%manager_pending%')
union all
select '259/260: 6 roles (Manager and Team Lead separate)', (select count(*) from public.rbac_roles) = 6
union all
select '261: permissions per action', not exists (select 1 from public.rbac_permissions where module is null)
                                    and (select count(*) from public.rbac_permissions) >= 75
union all
select '262: Clients and Search Console pages', (select count(*) from public.rbac_permissions where module in ('projects.clients', 'website.search_console')) = 5
union all
select '263: one role per person', not exists (select user_id from public.rbac_user_roles group by user_id having count(*) > 1)
union all
select '264: approvals (approver column)', exists (select 1 from information_schema.columns where table_name = 'ep_employees' and column_name = 'admin_approver_id')
union all
select '265: report without projects', position('what you worked on today' in pg_get_functiondef('public.ep_save_my_report(date, text, jsonb, boolean)'::regprocedure)) > 0
union all
select '266: report email installed', to_regprocedure('public.ep_email_my_report(date, text[])') is not null
union all
select '266: pg_net enabled (needed to send emails)', to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null
union all
select '266: Resend key in the Vault (needed to send emails)', exists (select 1 from vault.secrets where name = 'resend_api_key')
union all
select '267: real email for staff', public.ep_email_is_real('person@gmail.com') and not public.ep_email_is_real('person@example.com')
union all
select '268: welcome emails + bounce check every 5 min', to_regprocedure('public.rbac_check_welcome_emails()') is not null
                                                    and exists (select 1 from cron.job where jobname = 'rbac-welcome-check')
union all
select '259: at least one Super Admin (your existing admins)', exists (select 1 from public.rbac_user_roles where role_key = 'super_admin')
union all
select '259: no security policy left on the old admin check',
       not exists (select 1 from pg_policies where (coalesce(qual, '') || coalesce(with_check, '')) ~ 'is_admin()'
                    and tablename in ('contact_submissions', 'blog_posts', 'portfolio_projects', 'job_postings', 'job_applications',
                                      'job_application_views', 'pt_companies', 'pt_projects', 'pt_documents', 'pt_backups',
                                      'pt_credentials', 'pt_credential_events'));

select u.email as super_admin from public.rbac_user_roles r join auth.users u on u.id = r.user_id where r.role_key = 'super_admin';

commit;
