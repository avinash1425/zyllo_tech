-- 237: Leave — the employee enters their reporting manager on the leave form.
--
-- Before: ep_apply_leave refused when ep_employees.reporting_manager_id was not set.
-- Now:    the form sends the manager the employee chose or typed:
--           p_manager_id   : a colleague picked from the list (gets a notification), or null
--           p_manager_name : the name as typed (always stored; used when not a colleague)
--         One of the two is required. The profile's reporting manager is only a default.
-- New column ep_leave_requests.approver_name keeps the typed name.
-- The old 5-argument ep_apply_leave is replaced by the 7-argument one.
-- Rollback: supabase/rollbacks/237_rollback_leave_manager_entered_by_employee.sql

begin;

alter table public.ep_leave_requests
  add column if not exists approver_name text
    check (approver_name is null or length(btrim(approver_name)) between 1 and 120);

comment on column public.ep_leave_requests.approver_name is
  'Reporting manager as entered by the employee on the leave form (may not be a portal user).';

-- JSON of one request: approver = colleague name, else the typed name.
create or replace function public.ep_leave_json(r public.ep_leave_requests)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'leave_type', r.leave_type, 'leave_name', (select name from public.ep_leave_types where code = r.leave_type),
    'start_date', r.start_date, 'end_date', r.end_date, 'half_day', r.half_day, 'days', r.days,
    'reason', r.reason, 'status', r.status, 'created_at', r.created_at,
    'decided_at', r.decided_at, 'decision_comment', r.decision_comment,
    'decided_by', (select full_name from public.ep_employees where id = r.decided_by),
    'approver', coalesce((select full_name from public.ep_employees where id = r.approver_id), r.approver_name),
    'employee', (select jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code,
                                           'designation', e.designation)
                   from public.ep_employees e where e.id = r.employee_id));
$$;
revoke all on function public.ep_leave_json(public.ep_leave_requests) from public, anon, authenticated;

drop function if exists public.ep_apply_leave(text, date, date, text, text);

create or replace function public.ep_apply_leave(
  p_type text, p_start date, p_end date, p_half text, p_reason text, p_manager_id uuid, p_manager_name text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
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
              where r.employee_id = v_emp and r.status in ('pending', 'approved')
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
      || ' · ' || v_days || ' day(s) · ' || left(v_reason, 200),
    '/employee/leave');
  return public.ep_leave_json(v_row);
end $$;

revoke all on function public.ep_apply_leave(text, date, date, text, text, uuid, text) from public, anon;
grant execute on function public.ep_apply_leave(text, date, date, text, text, uuid, text) to authenticated;

notify pgrst, 'reload schema';

commit;
