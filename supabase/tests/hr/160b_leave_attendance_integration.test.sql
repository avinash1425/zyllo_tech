-- Leave (160) x Attendance & Time (125) integration. Runs only when 125 is
-- applied (hr_private.employee_shift_on exists); otherwise it is skipped.
-- Proves that leave day counting and attendance day classification agree
-- (date-effective shifts, weekly-off rules, recurring company holidays),
-- that recurring holidays reach the leave holiday lists and the holiday-change
-- review, and the half-day contract of hr_private.leave_portion_on (195).
-- Synthetic data only. Runs inside a transaction that the runner rolls back.

do $$
declare
  y int := extract(year from hr_private.business_today())::int + 1;
  sat1 date; sat2 date; mon2 date; fri2 date; wk3 date;
  emp uuid; s6 uuid; s4 uuid; cl uuid; r uuid; d date; n int := 0;
  v_leave boolean; v_att boolean;
begin
  if to_regprocedure('hr_private.employee_shift_on(uuid,date)') is null then
    raise notice 'ok - skipped: Attendance & Time migration 125 is not applied';
    return;
  end if;

  update public.hr_settings set value = value || '{"max_advance_days": 800}' where key = 'leave';
  sat1 := make_date(y, 6, 1) + ((6 - extract(isodow from make_date(y, 6, 1))::int + 7) % 7);   -- 1st Saturday of June
  sat2 := sat1 + 7;                                                                             -- 2nd Saturday
  mon2 := sat2 + 2; fri2 := sat2 + 6; wk3 := sat2 + 9;                                           -- Mon/Fri after it; Mon of week 3
  insert into public.hr_shifts (name, start_time, end_time, working_days, weekly_off_rules)
  values ('M6 Six-day (2nd/4th Sat off)', '09:00', '18:00', '{1,2,3,4,5,6}', '{"6": [2, 4]}') returning id into s6;
  insert into public.hr_shifts (name, start_time, end_time, working_days)
  values ('M6 Four-day', '09:00', '18:00', '{1,2,3,4}') returning id into s4;
  emp := test.make_employee('m6i.emp@test.local', 'Iris');
  update public.hr_employees set shift_id = s6 where id = emp;
  cl := (select id from public.hr_leave_types where code = 'CL');

  -- 1. weekly-off rules
  perform test.ok(not hr_private.leave_is_weekly_off(emp, sat1), '1st Saturday is a working day for leave (six-day shift)');
  perform test.ok(hr_private.leave_is_weekly_off(emp, sat2), '2nd Saturday is a weekly off for leave (weekly_off_rules)');
  perform test.eq(hr_private.leave_days(emp, cl, sat1, sat2), 6::numeric, 'Sat1..Sat2 counts Sat1 + Mon-Fri = 6 leave days');

  -- 2. a dated shift assignment from mon2 (four-day week): Friday becomes a weekly off
  insert into public.hr_shift_assignments (employee_id, shift_id, effective_from) values (emp, s4, mon2);
  perform test.ok(hr_private.leave_is_weekly_off(emp, fri2) and not hr_private.leave_is_weekly_off(emp, sat1 + 6),
    'shift in effect on each date is used (Friday off only after the assignment)');
  perform test.eq(hr_private.leave_days(emp, cl, mon2, fri2), 4::numeric, 'week under the four-day shift counts 4 days');

  -- 3. recurring company holiday (first set last year) on Tuesday of week 3
  insert into public.hr_holidays (holiday_date, name, type, is_recurring)
  values (make_date(y - 1, extract(month from wk3 + 1)::int, extract(day from wk3 + 1)::int), 'M6 Recurring Day', 'company', true);
  perform test.ok(hr_private.is_holiday(wk3 + 1, emp), 'recurring holiday applies in later years');
  perform test.eq(hr_private.leave_days(emp, cl, wk3, wk3 + 4), 3::numeric, 'week 3 (four-day shift, recurring holiday) counts 3 days');

  -- 4. leave counting == attendance classification, day by day
  d := sat1 - 6;
  while d <= wk3 + 6 loop
    v_leave := not hr_private.leave_is_weekly_off(emp, d) and not hr_private.is_holiday(d, emp);
    v_att := hr_private.attendance_day_type(emp, d) in ('working', 'leave');
    if v_leave is distinct from v_att then
      perform test.ok(false, 'leave and attendance disagree on ' || d || ': leave ' || v_leave || ', attendance ' || hr_private.attendance_day_type(emp, d));
    end if;
    n := n + 1;
    d := d + 1;
  end loop;
  perform test.ok(n = (wk3 + 6) - (sat1 - 6) + 1, 'leave counting matches attendance_day_type on all ' || n || ' days');

  -- 5. recurring holidays reach the leave holiday lists
  perform test.as_user(test.user_of(emp));
  perform test.ok(exists (select 1 from public.hr_my_holidays(wk3, wk3 + 6) h where h.name = 'M6 Recurring Day' and h.holiday_date = wk3 + 1 and h.is_recurring),
    'hr_my_holidays expands the recurring holiday into this year');

  -- 6. a recurring holiday added later flags overlapping leave for review
  r := (public.hr_apply_leave(cl, wk3 + 7, wk3 + 10, 'Synthetic trip') ->> 'id')::uuid;
  perform test.as_owner();
  insert into public.hr_holidays (holiday_date, name, type, is_recurring)
  values (make_date(y - 1, extract(month from wk3 + 8)::int, extract(day from wk3 + 8)::int), 'M6 Later Recurring', 'company', true);
  perform test.ok((select holiday_review_required and days = 4 from public.hr_leave_requests where id = r),
    'adding a recurring holiday flags the pending request; days unchanged');

  -- 7. half-day contract for attendance integration
  perform test.as_user(test.user_of(emp));
  r := (public.hr_apply_leave(cl, sat1 + 2, sat1 + 2, 'Half day', false, true) ->> 'id')::uuid;
  perform test.as_owner();
  update public.hr_leave_requests set status = 'approved', current_level = null where id = r;
  perform test.eq(hr_private.leave_portion_on(emp, sat1 + 2), 0.5::numeric, 'leave_portion_on = 0.5 for an approved half day');
  perform test.eq((select half from public.hr_leave_request_days where request_id = r), 'first', 'stored half = first (morning off)');
  perform test.eq(hr_private.attendance_day_type(emp, sat1 + 2), 'working',
    'a half-day leave date stays working in attendance (195: leave only when leave_portion_on >= 1)');
end $$;
