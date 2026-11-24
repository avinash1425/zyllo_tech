-- 257: Employee Portal — leave: the REPORTING MANAGER reviews first, then the ADMIN, then the MANAGER approves.
--
--   Employee applies:
--     has a reporting manager with an active portal account -> 'manager_review' (manager reviews first)
--     no portal manager                                     -> 'pending'        (straight to the admin)
--   Manager review (step 1): "Send to admin" -> 'pending' (note optional) | Reject -> 'rejected' (reason required)
--   Admin (step 2):          Approve -> 'manager_pending' (portal manager) or 'approved' (no portal manager)
--                            Reject  -> 'rejected'
--   Manager (step 3):        Approve -> 'approved' (final) | Reject -> 'rejected' (reason required)
--   The admin can still decide during the manager review (it then continues as if the manager had sent it)
--   and can make the final decision instead of the manager in step 3 (unchanged from 255).
--   The employee can cancel while nobody has approved yet ('manager_review' or 'pending').
-- New columns: manager_review_comment, manager_reviewed_at, manager_reviewed_by.
-- Rollback: supabase/rollbacks/257_rollback_employee_leave_manager_review_first.sql

begin;

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

notify pgrst, 'reload schema';

commit;
