-- =====================================================================
-- 203: Leave x attendance fixes (approved leave recalculates attendance;
--      gender eligibility for leave types)
-- =====================================================================
-- 1. Approved / cancelled leave now recalculates stored attendance.
--
--    Until now nothing recalculated an hr_attendance row when leave was
--    approved or cancelled (195 and 199: "Stored hr_attendance rows are not
--    recalculated"). A punched day keeps the status stored at punch / manual
--    entry time, and hr_private.attendance_day returns that stored status, so
--    a short day that was 'absent' (199: < 4 h) stayed 'absent' after a
--    half-day leave for the other half was approved, although 199 says such
--    a day is 'half_day'. Full-day leave was not affected on screen
--    (attendance_day lets approved full-day leave win), half-day leave was.
--
--    Now an AFTER trigger on hr_leave_requests recalculates the stored rows
--    of the request's dates whenever the request becomes 'approved' (final
--    HR approval of the 2-stage flow), leaves 'approved' (cancelled, incl. an
--    approved cancellation request) or an approved request's day count is
--    recalculated. Per stored row (hr_private.attendance_recalculate_day):
--      * punched rows (self, manual entry, correction): times and minutes are
--        recomputed with hr_private.attendance_compute (199 rules), punches,
--        notes, source and original punch times are never touched;
--      * no punch-in: the row holds an explicit status; only 'absent' becomes
--        'half_day' while a half-day leave is approved (and back to 'absent'
--        when that leave goes away). Other punch-less statuses are kept;
--      * kept as they are: 'missing_punch' rows, days whose last approved
--        correction set an explicit status, and dates in a finalized / paid
--        payroll period (attendance is locked there);
--      * days with no stored row are computed live by attendance_day already.
--    The statement at the end of section 1 applies the same recalculation
--    once to every stored day covered by already-approved leave.
--
-- 2. Leave type gender eligibility (optional).
--    hr_leave_types.eligible_gender: null = every employee (default, so no
--    existing type changes), 'female' or 'male' = only employees whose
--    recorded gender (hr_employee_private.gender) is that value. Employees
--    with no recorded gender, or non_binary / other / prefer_not_to_say, keep
--    the current behaviour (eligible). The setting is a normal policy field:
--    it changes only through hr_propose_leave_policy -> hr_decide_leave_policy
--    (maker-checker) and is part of every policy version snapshot.
--    This migration does NOT set it on Maternity / Paternity Leave: HR sets
--    it through Leave > Policies after deployment.
--    Respected by: hr_private.leave_type_eligibility (apply validation and the
--    apply form), hr_my_leave_types (ineligible types are not offered),
--    hr_my_leave_balances (no balance created; an existing unused balance of
--    an ineligible type is not shown) and hr_initialize_leave_year.
--
-- Requires 160, 161, 195, 199. Re-runnable.
-- =====================================================================

do $$
begin
  if to_regprocedure('hr_private.leave_half_on(uuid,date)') is null
     or to_regprocedure('hr_private.shift_absent_below_minutes(uuid)') is null
     or to_regprocedure('hr_private.leave_type_eligibility(uuid,uuid,date,date)') is null then
    raise exception '203_hr_leave_attendance_fixes requires migrations 160 (leave management), 195 and 199 (attendance)';
  end if;
end $$;

-- =====================================================================
-- 1. Leave decisions recalculate stored attendance
-- =====================================================================

-- Recalculate one stored attendance day from its punches and the current
-- leave / shift / holiday state. Returns true when the row changed.
create or replace function hr_private.attendance_recalculate_day(p_employee uuid, p_date date)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  a public.hr_attendance;
  c record;
  v_portion numeric;
  v_status text;
begin
  select * into a from public.hr_attendance x where x.employee_id = p_employee and x.work_date = p_date for update;
  if a.id is null then return false; end if;                                 -- computed live by attendance_day
  if hr_private.attendance_period_locked(p_date, p_employee) then return false; end if;   -- finalized payroll
  if a.status = 'missing_punch' then return false; end if;                   -- waits for a correction
  if a.source = 'correction' and exists (                                    -- explicit status set by an approved correction
       select 1 from public.hr_attendance_corrections k
        where k.employee_id = p_employee and k.work_date = p_date and k.status = 'approved'
          and (to_jsonb(k) ->> 'requested_status') is not null
          and k.reviewed_at = (select max(k2.reviewed_at) from public.hr_attendance_corrections k2
                                where k2.employee_id = p_employee and k2.work_date = p_date and k2.status = 'approved')) then
    return false;
  end if;

  if a.check_in_at is null then
    v_portion := hr_private.leave_portion_on(p_employee, p_date);
    v_status := case
      when a.status = 'absent' and v_portion > 0 and v_portion < 1 then 'half_day'   -- the leave covers the other half
      when a.status = 'half_day' and v_portion = 0 then 'absent'                     -- that half-day leave went away
      else a.status end;
    if v_status is distinct from a.status then
      update public.hr_attendance set status = v_status, updated_by = coalesce(auth.uid(), updated_by) where id = a.id;
      return true;
    end if;
    return false;
  end if;

  select * into c from hr_private.attendance_compute(p_employee, p_date, a.check_in_at, a.check_out_at);
  if (c.o_shift_id, c.o_expected_start, c.o_expected_end, c.o_break, c.o_worked, c.o_late, c.o_early, c.o_overtime, c.o_status)
     is not distinct from
     (a.shift_id, a.expected_start_at, a.expected_end_at, a.break_minutes, a.worked_minutes, a.late_minutes,
      a.early_leave_minutes, a.overtime_minutes, a.status) then
    return false;
  end if;
  update public.hr_attendance set
    shift_id = c.o_shift_id, expected_start_at = c.o_expected_start, expected_end_at = c.o_expected_end,
    break_minutes = c.o_break, worked_minutes = c.o_worked, late_minutes = c.o_late,
    early_leave_minutes = c.o_early, overtime_minutes = c.o_overtime, status = c.o_status,
    updated_by = coalesce(auth.uid(), updated_by)
  where id = a.id;
  return true;
end $$;

-- Every stored day of one employee in a date range. Returns the number changed.
create or replace function hr_private.attendance_recalculate_range(p_employee uuid, p_from date, p_to date)
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int := 0; d date;
begin
  if p_employee is null or p_from is null or p_to is null then return 0; end if;
  for d in select x.work_date from public.hr_attendance x
            where x.employee_id = p_employee and x.work_date between p_from and p_to order by x.work_date loop
    if hr_private.attendance_recalculate_day(p_employee, d) then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;

-- Named "zz" so it fires after hr_leave_requests_days_ins / _days_upd (160),
-- which rebuild hr_leave_request_days first (triggers fire in name order).
create or replace function hr_private.leave_request_attendance_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'approved' then
      perform hr_private.attendance_recalculate_range(new.employee_id, new.start_date, new.end_date);
    end if;
  elsif (old.status = 'approved' or new.status = 'approved')
        and (old.status is distinct from new.status or old.days is distinct from new.days) then
    perform hr_private.attendance_recalculate_range(new.employee_id,
      least(old.start_date, new.start_date), greatest(old.end_date, new.end_date));
  end if;
  return null;
end $$;

drop trigger if exists hr_leave_requests_zz_attendance on public.hr_leave_requests;
create trigger hr_leave_requests_zz_attendance after insert or update of status, days on public.hr_leave_requests
  for each row execute function hr_private.leave_request_attendance_sync();

-- Write helpers: never callable through the API (197 rule).
revoke execute on function hr_private.attendance_recalculate_day(uuid, date),
  hr_private.attendance_recalculate_range(uuid, date, date),
  hr_private.leave_request_attendance_sync()
from public, anon, authenticated;
grant execute on function hr_private.attendance_recalculate_day(uuid, date),
  hr_private.attendance_recalculate_range(uuid, date, date)
to service_role;

-- One-off (idempotent) correction of days already covered by approved leave,
-- e.g. a short day stored as 'absent' before a half-day leave was approved.
do $$
declare r record; v_n int := 0;
begin
  for r in
    select distinct a.employee_id, a.work_date
      from public.hr_attendance a
      join public.hr_leave_request_days d on d.employee_id = a.employee_id and d.leave_date = a.work_date
      join public.hr_leave_requests q on q.id = d.request_id and q.status = 'approved'
     order by a.employee_id, a.work_date
  loop
    if hr_private.attendance_recalculate_day(r.employee_id, r.work_date) then v_n := v_n + 1; end if;
  end loop;
  raise notice '203: % stored attendance day(s) recalculated for approved leave', v_n;
end $$;

-- =====================================================================
-- 2. Gender eligibility for leave types
-- =====================================================================
alter table public.hr_leave_types
  add column if not exists eligible_gender text check (eligible_gender in ('female','male'));
comment on column public.hr_leave_types.eligible_gender is
  'Null = every employee. female / male = only employees with that recorded gender; employees with no recorded gender (or another value) stay eligible.';

-- Null when eligible; otherwise the message shown to the employee.
create or replace function hr_private.leave_gender_issue(p_type uuid, p_employee uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case when lt.eligible_gender is not null and p.gender in ('female','male') and p.gender <> lt.eligible_gender
              then lt.name || ' is available to ' || lt.eligible_gender || ' employees only.' end
  from public.hr_leave_types lt
  left join public.hr_employee_private p on p.employee_id = p_employee
  where lt.id = p_type
$$;
revoke execute on function hr_private.leave_gender_issue(uuid, uuid) from public, anon, authenticated;
grant execute on function hr_private.leave_gender_issue(uuid, uuid) to service_role;

-- Same as 160 plus the gender rule.
create or replace function hr_private.leave_type_eligibility(p_type uuid, p_employee uuid, p_start date default null, p_end date default null)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when lt.eligible_employment_types is not null and not (e.employment_type = any(lt.eligible_employment_types))
      then lt.name || ' is not available for your employment type.'
    when hr_private.leave_gender_issue(lt.id, e.id) is not null
      then hr_private.leave_gender_issue(lt.id, e.id)
    when p_start is not null and lt.effective_from is not null and p_start < lt.effective_from
      then lt.name || ' can only be taken from ' || to_char(lt.effective_from, 'DD Mon YYYY') || '.'
    when p_end is not null and lt.effective_to is not null and p_end > lt.effective_to
      then lt.name || ' cannot be taken after ' || to_char(lt.effective_to, 'DD Mon YYYY') || '.'
  end
  from public.hr_leave_types lt, public.hr_employees e
  where lt.id = p_type and e.id = p_employee
$$;

-- Policy field list (160) + eligible_gender, so it goes through propose -> approve.
create or replace function hr_private.leave_policy_fields()
returns text[] language sql immutable set search_path = '' as $$
  select array['name','description','paid','annual_entitlement','accrual','carry_forward_max','carry_forward_expiry_months',
               'allow_half_day','requires_document_after_days','allow_during_probation','allow_negative','max_negative',
               'counts_weekends','counts_holidays','active','sort_order','eligible_employment_types','min_days_per_request',
               'max_days_per_request','min_notice_days','effective_from','effective_to','eligible_gender']
$$;

-- Same as 160; the update also writes eligible_gender.
create or replace function hr_leave_internal.leave_policy_write(p_type uuid, p_changes jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v public.hr_leave_types;
begin
  -- Defence in depth: hr_private is not exposed by the API, but EXECUTE on it
  -- is granted broadly by later migrations; never write policy for a caller
  -- who could not propose it.
  if auth.uid() is not null and not hr_private.has_permission('leave.manage') then
    perform hr_private.fail('You are not allowed to change leave policies.', 'forbidden');
  end if;
  perform set_config('hr.leave_policy_apply', 'on', true);
  if p_type is null then
    v := jsonb_populate_record(null::public.hr_leave_types,
      jsonb_build_object('id', gen_random_uuid(), 'created_at', now(), 'updated_at', now(), 'paid', true, 'annual_entitlement', 0,
                         'accrual', 'annual', 'carry_forward_max', 0, 'allow_half_day', true, 'allow_during_probation', true,
                         'allow_negative', false, 'counts_weekends', false, 'counts_holidays', false, 'active', true,
                         'sort_order', 10, 'policy_version', 1) || p_changes);
    v.code := upper(btrim(v.code));
    insert into public.hr_leave_types select (v).*;
  else
    select * into v from public.hr_leave_types where id = p_type for update;
    if v.id is null then perform hr_private.fail('Leave type not found.', 'not_found'); end if;
    v := jsonb_populate_record(v, p_changes - 'id' - 'code' - 'policy_version' - 'created_at' - 'updated_at');
    update public.hr_leave_types x set
      name = v.name, description = v.description, paid = v.paid, annual_entitlement = v.annual_entitlement, accrual = v.accrual,
      carry_forward_max = v.carry_forward_max, carry_forward_expiry_months = v.carry_forward_expiry_months,
      allow_half_day = v.allow_half_day, requires_document_after_days = v.requires_document_after_days,
      allow_during_probation = v.allow_during_probation, allow_negative = v.allow_negative, max_negative = v.max_negative,
      counts_weekends = v.counts_weekends, counts_holidays = v.counts_holidays, active = v.active, sort_order = v.sort_order,
      eligible_employment_types = v.eligible_employment_types, min_days_per_request = v.min_days_per_request,
      max_days_per_request = v.max_days_per_request, min_notice_days = v.min_notice_days,
      effective_from = v.effective_from, effective_to = v.effective_to, eligible_gender = v.eligible_gender
    where x.id = p_type;
  end if;
  perform set_config('hr.leave_policy_apply', '', true);
  return v.id;
end $$;

-- Same as 160, except a type the caller is not eligible for by gender keeps
-- no visible balance (one already used / pending stays visible).
create or replace function public.hr_my_leave_balances(p_year int default null)
returns table (balance_id uuid, leave_type_id uuid, code text, name text, paid boolean, year int, entitled numeric, accrued numeric,
               carried_forward numeric, adjusted numeric, used numeric, pending numeric, available numeric,
               opening numeric, cf_expires_on date, cf_expired numeric, allow_negative boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare v_me uuid := hr_private.current_employee_id(); v_year int := coalesce(p_year, extract(year from hr_private.business_today())::int);
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  perform hr_private.ensure_leave_balance(v_me, lt.id, v_year)
     from public.hr_leave_types lt
    where lt.active and hr_private.leave_type_eligibility(lt.id, v_me) is null;
  return query
    select b.id, lt.id, lt.code, lt.name, lt.paid, b.year, b.entitled, b.accrued, b.carried_forward, b.adjusted, b.used, b.pending,
           b.available, b.opening, b.cf_expires_on, b.cf_expired, lt.allow_negative
    from public.hr_leave_balances b join public.hr_leave_types lt on lt.id = b.leave_type_id
    where b.employee_id = v_me and b.year = v_year
      and (hr_private.leave_gender_issue(lt.id, v_me) is null or b.used <> 0 or b.pending <> 0)
    order by lt.sort_order, lt.code;
end $$;

-- Same as 160, except types the caller is not eligible for by gender are not offered.
create or replace function public.hr_my_leave_types()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := hr_private.current_employee_id(); v_today date := hr_private.business_today();
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  return coalesce((
    select jsonb_agg((to_jsonb(lt) - 'created_at' - 'updated_at') || jsonb_build_object(
             'eligibility_issue', hr_private.leave_type_eligibility(lt.id, v_me),
             'probation_restricted', (not lt.allow_during_probation and (e.status = 'probation' or coalesce(e.probation_end_date >= v_today, false))))
           order by lt.sort_order, lt.code)
    from public.hr_leave_types lt cross join public.hr_employees e
    where lt.active and e.id = v_me and hr_private.leave_gender_issue(lt.id, v_me) is null), '[]'::jsonb);
end $$;

-- Same as 160, except no balance is created for a gender-ineligible type.
create or replace function public.hr_initialize_leave_year(p_year int)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count int := 0; r record; v_cur int := extract(year from hr_private.business_today())::int;
begin
  if not hr_private.has_permission('leave.manage') then
    perform hr_private.fail('You are not allowed to manage leave.', 'forbidden');
  end if;
  if p_year is null or p_year not between v_cur - 1 and v_cur + 1 then
    perform hr_private.fail('Leave years can be initialised for the previous, current or next year only.', 'invalid_year');
  end if;
  if hr_private.leave_year_closed(p_year) then
    perform hr_private.fail('Leave year ' || p_year || ' is closed.', 'year_closed');
  end if;
  for r in
    select e.id as employee_id, t.id as leave_type_id
    from public.hr_employees e cross join public.hr_leave_types t
    where t.active
      and (t.eligible_employment_types is null or e.employment_type = any(t.eligible_employment_types))
      and hr_private.leave_gender_issue(t.id, e.id) is null
      and e.status in ('onboarding','probation','active','notice_period')
      and (e.joining_date is null or e.joining_date <= make_date(p_year, 12, 31))
      and not exists (select 1 from public.hr_leave_balances b
                      where b.employee_id = e.id and b.leave_type_id = t.id and b.year = p_year)
  loop
    perform hr_private.ensure_leave_balance(r.employee_id, r.leave_type_id, p_year);
    v_count := v_count + 1;
  end loop;
  perform hr_private.audit_event('LEAVE_YEAR_INITIALIZED', 'hr_leave_balances', p_year::text, jsonb_build_object('created', v_count));
  return v_count;
end $$;
