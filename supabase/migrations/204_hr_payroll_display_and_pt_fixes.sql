-- =====================================================================
-- 204 — Payroll: employee identity for payroll users, and the jurisdiction
--        (state) fallback for state-specific statutory rules
-- =====================================================================
-- 1. Employee names in Payroll for users WITHOUT employees.view
--    Payroll screens embed hr_employees in their payroll queries. hr_employees
--    RLS (100: own row, employees.view, team, mentor, IT clearance) hides
--    every other employee from a payroll user whose role has payroll.* but not
--    employees.view, so the Employee column showed "—" everywhere except the
--    user's own row: an approver could not tell whose pay she was approving.
--    Fix: public.hr_payroll_employee_identities(p_ids) returns ONLY the
--    minimal identity (code, names, department) and ONLY to payroll.view
--    holders, and only for employees that appear in a payroll table the caller
--    can already read in full (structures, bank accounts, items, adjustments,
--    holds, statutory enrolments, payments, corrections, settlement coverage,
--    reimbursements, payslips). payroll.manage holders (preparers, who may
--    already create payroll rows for any employee) also get non-archived
--    employees so they can pick someone for a first structure / bank account.
--    hr_employees RLS is NOT changed; no permission is granted.
--
-- 2. Professional Tax (and any state-specific rule) applied to nobody
--    hr_calculate_payroll_run (170) matched a rule with a state_code only
--    against the state on the employee's STATUTORY ENROLMENT. With no
--    enrolment the state was NULL, so an approved 'PT (AP)' rule set to
--    "All unless opted out" was skipped for every employee
--    ('jurisdiction_mismatch'). Work locations and companies had no state.
--    Fix: optional state_code on hr_locations and hr_legal_entities; the
--    employee's jurisdiction is now
--        enrolment state  ->  work-location state  ->  company state.
--    Existing enrolments keep precedence (no change for them); opt-outs
--    (enrolled = false) still win; 'Enrolled employees only' rules still need
--    an enrolment. The breakdown records employee_state and its source.
--    The free-text address state (hr_employee_private) is deliberately NOT
--    parsed. No statutory rate, slab or rule row is changed.
--
-- Only the calculator body changes (copied from 170 with the marked "204"
-- edits). Re-runnable. Apply only with approval (see supabase/DEPLOY.md).
-- =====================================================================

-- ---------------------------------------------------------------- 1. identities
create or replace function public.hr_payroll_employee_identities(p_ids uuid[] default null)
returns table (id uuid, employee_code text, first_name text, last_name text, display_name text,
               department_id uuid, department_name text, status text)
language sql stable security definer set search_path = '' as $$
  select e.id, e.employee_code, e.first_name, e.last_name, e.display_name, e.department_id, d.name, e.status
  from public.hr_employees e
  left join public.hr_departments d on d.id = e.department_id
  where hr_private.has_permission('payroll.view')
    and (p_ids is null or e.id = any(p_ids))
    and (
         (hr_private.has_permission('payroll.manage') and e.status <> 'archived')
      or exists (select 1 from public.hr_salary_structures x where x.employee_id = e.id)
      or exists (select 1 from public.hr_employee_bank_accounts x where x.employee_id = e.id)
      or exists (select 1 from public.hr_payroll_items x where x.employee_id = e.id)
      or exists (select 1 from public.hr_payroll_adjustments x where x.employee_id = e.id)
      or exists (select 1 from public.hr_payroll_run_holds x where x.employee_id = e.id)
      or exists (select 1 from public.hr_payroll_statutory_enrollments x where x.employee_id = e.id)
      or exists (select 1 from public.hr_payroll_payments x where x.employee_id = e.id)
      or exists (select 1 from public.hr_payroll_correction_requests x where x.employee_id = e.id)
      or exists (select 1 from public.hr_payroll_settlement_coverage x where x.employee_id = e.id)
      or exists (select 1 from public.hr_reimbursements x where x.employee_id = e.id)
      or exists (select 1 from public.hr_payslips x where x.employee_id = e.id)
    )
  order by e.first_name, e.last_name, e.employee_code
  limit 5000
$$;
comment on function public.hr_payroll_employee_identities(uuid[]) is
  'Minimal employee identity (code, name, department) for payroll.view holders, limited to employees in payroll data (plus non-archived employees for payroll.manage). Does not widen hr_employees RLS.';
revoke execute on function public.hr_payroll_employee_identities(uuid[]) from anon, public;
grant execute on function public.hr_payroll_employee_identities(uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------- 2. jurisdiction columns
alter table public.hr_locations add column if not exists state_code text;
alter table public.hr_legal_entities add column if not exists state_code text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hr_locations_state_code_format') then
    alter table public.hr_locations add constraint hr_locations_state_code_format
      check (state_code is null or state_code ~ '^[A-Z0-9]{2,3}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hr_legal_entities_state_code_format') then
    alter table public.hr_legal_entities add constraint hr_legal_entities_state_code_format
      check (state_code is null or state_code ~ '^[A-Z0-9]{2,3}$');
  end if;
end $$;
comment on column public.hr_locations.state_code is
  'Statutory jurisdiction code (same codes as hr_payroll_statutory_rules.state_code, e.g. AP). Used by payroll when an employee has no enrolment state.';
comment on column public.hr_legal_entities.state_code is
  'Statutory jurisdiction code; payroll fallback after enrolment state and work-location state.';

-- Optional data step (NOT run by this migration; review first):
--   update public.hr_locations set state_code = 'AP' where state_code is null and <your Andhra Pradesh locations>;
--   update public.hr_legal_entities set state_code = 'AP' where state_code is null and <your company>;

-- ---------------------------------------------------------------- 3. calculator
create or replace function public.hr_calculate_payroll_run(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  run public.hr_payroll_runs;
  cfg jsonb := coalesce(hr_private.setting('payroll'), '{}'::jsonb);
  v_basis text := coalesce(cfg ->> 'proration_basis', 'working_days');
  v_att boolean := coalesce((cfg ->> 'lop_from_attendance')::boolean, false);
  v_managed text[] := hr_private.payroll_managed_codes();
  e record; s record; c record; r record; v_enr record;
  v_ws date; v_we date; v_seg_s date; v_seg_e date; v_cover date;
  v_wd int; v_window_days int; v_seg_days int;
  v_seg_lop numeric; v_seg_pay numeric; v_factor numeric; v_share numeric; v_ceil_share numeric;
  v_payable numeric; v_lop numeric;
  v_basic numeric; v_gross_pre numeric; v_gross_full numeric; v_amt numeric; v_full_amt numeric;
  v_lines jsonb; v_seg_full jsonb; v_segments jsonb; v_skipped jsonb; v_inelig jsonb; v_adj jsonb; v_reimb jsonb;
  v_stat jsonb; v_stat_pending jsonb; v_errors jsonb; v_warnings jsonb; v_currencies text[];
  v_adj_pos numeric; v_adj_neg numeric; v_reimb_total numeric; v_pending_adj int;
  v_earn numeric; v_ded numeric; v_employer numeric; v_net numeric;
  v_structure uuid; v_currency text;
  v_base_full numeric; v_base numeric; v_ceiling numeric; v_cbase numeric; v_elig_wage numeric; v_ee numeric; v_er numeric;
  v_eligible boolean; v_why text; v_slab jsonb; v_code text; v_name text;
  v_loc_state text; v_le_state text; v_state text; v_state_src text;   -- 204: jurisdiction fallback
  v_count int := 0; v_err_count int := 0; v_warn_count int := 0;
  v_tot_gross numeric := 0; v_tot_ded numeric := 0; v_tot_net numeric := 0;
  v_excluded jsonb := '[]'::jsonb;
begin
  if not hr_private.has_permission('payroll.manage') then
    perform hr_private.fail('You are not allowed to manage payroll.', 'forbidden');
  end if;
  select * into run from public.hr_payroll_runs where id = p_id for update;
  if run.id is null then perform hr_private.fail('Payroll run not found.', 'not_found'); end if;
  if run.status not in ('draft','calculated') then
    perform hr_private.fail('Only draft or calculated runs can be (re)calculated (status: ' || run.status || ').', 'invalid_state');
  end if;
  if v_basis not in ('working_days','calendar_days') then v_basis := 'working_days'; end if;

  -- Start clean: items are rebuilt; corrections and reimbursements re-attached below.
  delete from public.hr_payroll_items where run_id = p_id;
  update public.hr_reimbursements set payroll_run_id = null where payroll_run_id = p_id and status = 'approved';
  update public.hr_payroll_adjustments set run_id = null where run_id = p_id and source = 'correction';

  for e in
    select emp.id, emp.joining_date, emp.last_working_date, emp.employee_code, emp.employment_type, emp.legal_entity_id, emp.work_location_id
    from public.hr_employees emp
    where emp.status <> 'archived'
      and (run.legal_entity_id is null or emp.legal_entity_id = run.legal_entity_id)
      and coalesce(emp.joining_date, run.period_start) <= run.period_end
      and coalesce(emp.last_working_date, run.period_end) >= run.period_start
      and exists (select 1 from public.hr_salary_structures ss
                  where ss.employee_id = emp.id and ss.status = 'active'
                    and ss.effective_from <= least(run.period_end, coalesce(emp.last_working_date, run.period_end))
                    and coalesce(ss.effective_to, run.period_end) >= greatest(run.period_start, coalesce(emp.joining_date, run.period_start)))
    order by emp.employee_code
  loop
    if exists (select 1 from public.hr_payroll_run_holds h where h.run_id = p_id and h.employee_id = e.id) then
      v_excluded := v_excluded || jsonb_build_object('employee_id', e.id, 'employee_code', e.employee_code, 'reason', 'on_hold');
      continue;
    end if;
    -- 204: the employee's jurisdiction when no enrolment names one: work location, then company.
    select l.state_code into v_loc_state from public.hr_locations l where l.id = e.work_location_id;
    select le.state_code into v_le_state from public.hr_legal_entities le where le.id = e.legal_entity_id;
    v_ws := greatest(run.period_start, coalesce(e.joining_date, run.period_start));
    v_we := least(run.period_end, coalesce(e.last_working_date, run.period_end));
    select max(sc.covered_through) into v_cover from public.hr_payroll_settlement_coverage sc where sc.employee_id = e.id and sc.status = 'active';
    -- Module 4 (130) full & final settlement: an approved/paid settlement with a salary_due line
    -- pays salary up to its last working day, so payroll must not pay those days again.
    -- Guarded: the statement only runs when that module's table exists.
    if to_regclass('public.hr_payroll_settlements') is not null then
      select greatest(v_cover, max(st.last_working_day)) into v_cover
      from public.hr_payroll_settlements st
      where st.employee_id = e.id and st.status in ('approved','paid')
        and exists (select 1 from public.hr_payroll_settlement_lines l where l.settlement_id = st.id and l.line_type = 'salary_due');
    end if;
    if v_cover is not null and v_cover >= v_ws then
      v_ws := v_cover + 1;
      if v_ws > v_we then
        v_excluded := v_excluded || jsonb_build_object('employee_id', e.id, 'employee_code', e.employee_code,
                                                       'reason', 'covered_by_final_settlement', 'covered_through', v_cover);
        continue;
      end if;
    end if;
    v_wd := hr_private.payroll_counted_days(e.id, run.period_start, run.period_end, v_basis);
    v_window_days := hr_private.payroll_counted_days(e.id, v_ws, v_we, v_basis);
    v_lines := '{}'; v_segments := '[]'; v_skipped := '[]'; v_inelig := '[]'; v_stat := '[]'; v_stat_pending := '[]';
    v_errors := '[]'; v_warnings := '[]'; v_currencies := '{}';
    v_payable := 0; v_lop := 0; v_structure := null; v_currency := coalesce(cfg ->> 'currency', 'INR');

    for s in
      select ss.id, ss.effective_from, ss.effective_to, ss.currency from public.hr_salary_structures ss
      where ss.employee_id = e.id and ss.status = 'active'
        and ss.effective_from <= v_we and coalesce(ss.effective_to, v_we) >= v_ws
      order by ss.effective_from
    loop
      v_structure := coalesce(v_structure, s.id);
      v_currency := s.currency;
      if not (s.currency = any(v_currencies)) then v_currencies := v_currencies || s.currency; end if;
      v_seg_s := greatest(v_ws, s.effective_from);
      v_seg_e := least(v_we, coalesce(s.effective_to, v_we));
      v_seg_days := hr_private.payroll_counted_days(e.id, v_seg_s, v_seg_e, v_basis);
      v_seg_lop := least(v_seg_days, hr_private.payroll_lop_days(e.id, v_seg_s, v_seg_e, v_att));
      v_seg_pay := v_seg_days - v_seg_lop;
      v_factor := case when v_wd > 0 then v_seg_pay / v_wd else 0 end;          -- proration of earnings
      v_share := case when v_window_days > 0 then v_seg_days::numeric / v_window_days else 0 end;  -- split of fixed deductions
      v_ceil_share := case when v_wd > 0 then v_seg_days::numeric / v_wd else 0 end;  -- share of a monthly wage ceiling
      v_payable := v_payable + v_seg_pay;
      v_lop := v_lop + v_seg_lop;
      v_seg_full := '{}';
      v_segments := v_segments || jsonb_build_object('structure_id', s.id, 'from', v_seg_s, 'to', v_seg_e,
                                                     'days', v_seg_days, 'lop_days', v_seg_lop, 'payable_days', v_seg_pay);

      select coalesce(sum(i.amount), 0) into v_basic
      from public.hr_salary_structure_items i join public.hr_salary_components k on k.id = i.component_id
      where i.structure_id = s.id and k.code = 'BASIC' and hr_private.component_applies(k, v_seg_e, e.employment_type, v_managed);
      select coalesce(sum(case k.calc_type when 'percent_of_basic' then v_basic * coalesce(i.percent, k.default_value, 0) / 100
                                           else coalesce(i.amount, 0) end), 0) into v_gross_pre
      from public.hr_salary_structure_items i join public.hr_salary_components k on k.id = i.component_id
      where i.structure_id = s.id and k.kind = 'earning' and k.calc_type <> 'percent_of_gross'
        and hr_private.component_applies(k, v_seg_e, e.employment_type, v_managed);
      select v_gross_pre + coalesce(sum(v_gross_pre * coalesce(i.percent, k.default_value, 0) / 100), 0) into v_gross_full
      from public.hr_salary_structure_items i join public.hr_salary_components k on k.id = i.component_id
      where i.structure_id = s.id and k.kind = 'earning' and k.calc_type = 'percent_of_gross'
        and hr_private.component_applies(k, v_seg_e, e.employment_type, v_managed);

      for c in
        select k.code, k.name, k.kind, k.calc_type, k.active, k.requires_verification, i.amount,
               coalesce(i.percent, k.default_value, 0) as pct,
               hr_private.component_applies(k, v_seg_e, e.employment_type, v_managed) as applies,
               (k.code = any(v_managed)) as managed
        from public.hr_salary_structure_items i join public.hr_salary_components k on k.id = i.component_id
        where i.structure_id = s.id
        order by k.sort_order, k.code
      loop
        if not c.active or c.requires_verification then
          v_skipped := v_skipped || to_jsonb(c.code);
          continue;
        end if;
        if not c.applies then
          v_inelig := v_inelig || jsonb_build_object('code', c.code,
                        'reason', case when c.managed then 'managed_by_statutory_rule' else 'not_eligible_or_not_effective' end);
          continue;
        end if;
        if c.kind in ('earning','employer_contribution') then
          v_full_amt := case c.calc_type when 'percent_of_basic' then v_basic * c.pct / 100
                                         when 'percent_of_gross' then v_gross_full * c.pct / 100
                                         else coalesce(c.amount, 0) end;
          v_amt := v_full_amt * v_factor;
          if c.kind = 'earning' then
            v_seg_full := v_seg_full || jsonb_build_object(c.code, coalesce((v_seg_full ->> c.code)::numeric, 0) + v_full_amt);
          end if;
        else
          -- Percentage deductions follow the prorated base; fixed/manual deductions are not prorated
          -- (split between structure segments by days).
          v_amt := case c.calc_type when 'percent_of_basic' then v_basic * v_factor * c.pct / 100
                                    when 'percent_of_gross' then v_gross_full * v_factor * c.pct / 100
                                    else coalesce(c.amount, 0) * v_share end;
        end if;
        v_amt := round(v_amt, 2);
        v_lines := jsonb_set(v_lines, array[c.code], jsonb_build_object('code', c.code, 'name', c.name, 'kind', c.kind,
                     'amount', coalesce((v_lines -> c.code ->> 'amount')::numeric, 0) + v_amt));
      end loop;

      -- Statutory rules in force on the last day of this segment. Only APPROVED
      -- (professionally validated) rules are applied; pending ones are reported.
      for r in
        select distinct on (sr.code, coalesce(sr.state_code, '')) sr.*
        from public.hr_payroll_statutory_rules sr
        where sr.status in ('approved','pending_validation')
          and sr.effective_from <= v_seg_e and coalesce(sr.effective_to, v_seg_e) >= v_seg_e
          and (sr.legal_entity_id is null or sr.legal_entity_id is not distinct from e.legal_entity_id)
        order by sr.code, coalesce(sr.state_code, ''), (sr.status = 'approved') desc, (sr.legal_entity_id is not null) desc, sr.effective_from desc
      loop
        select en.enrolled, en.state_code, en.declared_monthly_amount into v_enr
        from public.hr_payroll_statutory_enrollments en
        where en.employee_id = e.id and en.rule_code = r.code
          and en.effective_from <= v_seg_e and coalesce(en.effective_to, v_seg_e) >= v_seg_e
        order by en.effective_from desc limit 1;
        v_eligible := case when r.applies_to = 'all' then coalesce(v_enr.enrolled, true) else coalesce(v_enr.enrolled, false) end;
        v_why := case when not v_eligible then 'not_enrolled' end;
        -- 204: jurisdiction = enrolment state, else work-location state, else company state.
        v_state := coalesce(v_enr.state_code, v_loc_state, v_le_state);
        v_state_src := case when v_enr.state_code is not null then 'enrolment' when v_loc_state is not null then 'work_location'
                            when v_le_state is not null then 'company' end;
        if v_eligible and r.state_code is not null and v_state is distinct from r.state_code then
          v_eligible := false; v_why := 'jurisdiction_mismatch';
        end if;
        select coalesce(sum(j.value::numeric), 0) into v_base_full from jsonb_each_text(v_seg_full) j where j.key = any(r.wage_base_components);
        if v_eligible and r.eligibility_wage_max is not null then
          v_elig_wage := case r.eligibility_basis when 'gross' then v_gross_full else v_base_full end;
          if v_elig_wage > r.eligibility_wage_max then v_eligible := false; v_why := 'above_eligibility_threshold'; end if;
        end if;
        if r.status <> 'approved' then
          if v_eligible and not (v_stat_pending ? r.code) then v_stat_pending := v_stat_pending || to_jsonb(r.code); end if;
          continue;
        end if;
        if not v_eligible then
          v_stat := v_stat || jsonb_build_object('rule_id', r.id, 'code', r.code, 'state_code', r.state_code,
                      'segment_from', v_seg_s, 'segment_to', v_seg_e, 'applied', false, 'reason', v_why,
                      'employee_state', v_state, 'employee_state_source', v_state_src);
          continue;
        end if;
        v_base := v_base_full * v_factor;
        v_ceiling := case when r.wage_ceiling is null then null else r.wage_ceiling * v_ceil_share end;
        v_cbase := case when v_ceiling is null then v_base else least(v_base, v_ceiling) end;
        v_slab := null;
        if r.calc_method = 'percent_of_wage' then
          v_ee := v_cbase * coalesce(r.employee_rate, 0) / 100;
          v_er := v_cbase * coalesce(r.employer_rate, 0) / 100;
        elsif r.calc_method = 'slab' then
          select x.v into v_slab from jsonb_array_elements(r.slabs) as x(v)
           where coalesce((x.v ->> 'from')::numeric, 0) <= (case r.eligibility_basis when 'gross' then v_gross_full else v_base_full end)
             and ((x.v ->> 'to') is null or (case r.eligibility_basis when 'gross' then v_gross_full else v_base_full end) <= (x.v ->> 'to')::numeric)
           order by coalesce((x.v ->> 'from')::numeric, 0) desc limit 1;
          v_ee := coalesce((v_slab ->> 'employee_amount')::numeric, 0) * v_share;
          v_er := coalesce((v_slab ->> 'employer_amount')::numeric, 0) * v_share;
        elsif r.calc_method = 'fixed' then
          v_ee := coalesce(r.employee_amount, 0) * v_share;
          v_er := coalesce(r.employer_amount, 0) * v_share;
        else
          v_ee := coalesce(v_enr.declared_monthly_amount, 0) * v_share;
          v_er := 0;
        end if;
        v_ee := hr_private.round_money(v_ee, r.rounding_mode, r.rounding_precision);
        v_er := hr_private.round_money(v_er, r.rounding_mode, r.rounding_precision);
        if v_ee > 0 then
          v_code := coalesce(r.employee_component_code, r.code || '_EMPLOYEE');
          v_name := coalesce((select k.name from public.hr_salary_components k where k.code = r.employee_component_code), r.name || ' (employee)');
          v_lines := jsonb_set(v_lines, array[v_code], jsonb_build_object('code', v_code, 'name', v_name, 'kind', 'deduction', 'statutory_rule', r.code,
                       'amount', coalesce((v_lines -> v_code ->> 'amount')::numeric, 0) + v_ee));
        end if;
        if v_er > 0 then
          v_code := coalesce(r.employer_component_code, r.code || '_EMPLOYER');
          v_name := coalesce((select k.name from public.hr_salary_components k where k.code = r.employer_component_code), r.name || ' (employer)');
          v_lines := jsonb_set(v_lines, array[v_code], jsonb_build_object('code', v_code, 'name', v_name, 'kind', 'employer_contribution', 'statutory_rule', r.code,
                       'amount', coalesce((v_lines -> v_code ->> 'amount')::numeric, 0) + v_er));
        end if;
        v_stat := v_stat || jsonb_build_object('rule_id', r.id, 'code', r.code, 'state_code', r.state_code, 'applied', true,
          'employee_state', v_state, 'employee_state_source', v_state_src,
          'segment_from', v_seg_s, 'segment_to', v_seg_e, 'method', r.calc_method, 'rule_effective_from', r.effective_from,
          'wage_base_components', to_jsonb(r.wage_base_components), 'wage_base_monthly', round(v_base_full, 2),
          'wage_base_prorated', round(v_base, 2), 'ceiling', round(v_ceiling, 2), 'contribution_base', round(v_cbase, 2),
          'employee_rate', r.employee_rate, 'employer_rate', r.employer_rate, 'slab', v_slab,
          'employee_amount', v_ee, 'employer_amount', v_er, 'rounding', r.rounding_mode || ' / ' || r.rounding_precision || 'dp',
          'validation_reference', r.validation_reference);
      end loop;
    end loop;

    if v_structure is null then
      v_excluded := v_excluded || jsonb_build_object('employee_id', e.id, 'employee_code', e.employee_code, 'reason', 'no_structure_in_window');
      continue;
    end if;

    -- Corrections from earlier finalized runs that are waiting for a run.
    update public.hr_payroll_adjustments adj set run_id = p_id
    where adj.employee_id = e.id and adj.run_id is null and adj.source = 'correction' and adj.status = 'approved'
      and exists (select 1 from public.hr_payroll_runs src where src.id = adj.source_run_id and src.period_end < run.period_start);
    select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'label', a.label, 'amount', a.amount, 'reason', a.reason,
                                                 'source', a.source, 'source_run_id', a.source_run_id) order by a.created_at), '[]'::jsonb),
           coalesce(sum(a.amount) filter (where a.amount > 0), 0),
           coalesce(-sum(a.amount) filter (where a.amount < 0), 0)
      into v_adj, v_adj_pos, v_adj_neg
    from public.hr_payroll_adjustments a where a.run_id = p_id and a.employee_id = e.id and a.status = 'approved';
    select count(*) into v_pending_adj from public.hr_payroll_adjustments a where a.run_id = p_id and a.employee_id = e.id and a.status = 'pending';

    -- Approved reimbursements not yet paid through payroll.
    update public.hr_reimbursements set payroll_run_id = p_id
    where employee_id = e.id and status = 'approved' and payroll_run_id is null and claim_date <= run.period_end;
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'category', x.category, 'amount', x.amount, 'claim_date', x.claim_date)
                              order by x.claim_date), '[]'::jsonb),
           coalesce(sum(x.amount), 0)
      into v_reimb, v_reimb_total
    from public.hr_reimbursements x where x.payroll_run_id = p_id and x.employee_id = e.id;

    select coalesce(sum((l ->> 'amount')::numeric) filter (where l ->> 'kind' = 'earning'), 0),
           coalesce(sum((l ->> 'amount')::numeric) filter (where l ->> 'kind' = 'deduction'), 0),
           coalesce(sum((l ->> 'amount')::numeric) filter (where l ->> 'kind' = 'employer_contribution'), 0)
      into v_earn, v_ded, v_employer
    from jsonb_each(v_lines) j(k, l);
    v_earn := v_earn + v_adj_pos;
    v_ded := v_ded + v_adj_neg;
    v_net := v_earn - v_ded + v_reimb_total;

    -- Validation: errors block submission; warnings must be reviewed.
    if v_net < 0 then
      v_errors := v_errors || jsonb_build_object('code', 'negative_net', 'message', 'Deductions exceed earnings; net pay would be negative.');
    end if;
    if cardinality(v_currencies) > 1 then
      v_errors := v_errors || jsonb_build_object('code', 'mixed_currency', 'message', 'Salary structures in this period use different currencies.');
    end if;
    if v_pending_adj > 0 then
      v_errors := v_errors || jsonb_build_object('code', 'pending_adjustment', 'message', v_pending_adj || ' adjustment(s) are waiting for approval.');
    end if;
    if v_earn = 0 then
      v_warnings := v_warnings || jsonb_build_object('code', 'zero_gross', 'message', 'No earnings for this period (check LOP and structure dates).');
    end if;
    if jsonb_array_length(v_skipped) > 0 then
      v_warnings := v_warnings || jsonb_build_object('code', 'unverified_components', 'message', 'Unverified or inactive components were skipped.');
    end if;
    if jsonb_array_length(v_stat_pending) > 0 then
      v_warnings := v_warnings || jsonb_build_object('code', 'statutory_pending_validation',
        'message', 'Statutory rule(s) pending professional validation were NOT applied: '
                   || (select string_agg(x, ', ') from jsonb_array_elements_text(v_stat_pending) x) || '.');
    end if;
    if exists (select 1 from jsonb_array_elements(v_inelig) x where x ->> 'reason' = 'managed_by_statutory_rule') then
      v_warnings := v_warnings || jsonb_build_object('code', 'statutory_component_in_structure',
        'message', 'A structure line for a statutory component was ignored to avoid a duplicate deduction.');
    end if;
    if not exists (select 1 from public.hr_employee_bank_accounts b where b.employee_id = e.id and b.is_primary and b.active) then
      v_warnings := v_warnings || jsonb_build_object('code', 'no_bank_account', 'message', 'No active primary bank account.');
    elsif not exists (select 1 from public.hr_employee_bank_accounts b where b.employee_id = e.id and b.is_primary and b.active and b.verified) then
      v_warnings := v_warnings || jsonb_build_object('code', 'bank_unverified', 'message', 'Primary bank account is not verified.');
    end if;
    if exists (select 1 from public.hr_attendance_corrections ac where ac.employee_id = e.id and ac.status = 'pending'
               and ac.work_date between v_ws and v_we) then
      v_warnings := v_warnings || jsonb_build_object('code', 'attendance_pending', 'message', 'Attendance corrections in this period are still pending.');
    end if;
    if exists (select 1 from public.hr_leave_requests lr where lr.employee_id = e.id and lr.status = 'pending_approval'
               and lr.start_date <= v_we and lr.end_date >= v_ws) then
      v_warnings := v_warnings || jsonb_build_object('code', 'leave_pending', 'message', 'Leave requests in this period are still pending approval (not counted).');
    end if;
    if v_cover is null and exists (select 1 from public.hr_exits x where x.employee_id = e.id
               and x.status in ('clearance','final_settlement','closed')
               and coalesce(x.approved_last_working_day, x.proposed_last_working_day) <= run.period_end) then
      v_warnings := v_warnings || jsonb_build_object('code', 'exit_settlement_unreconciled',
        'message', 'Employee is in exit/final settlement and no settlement coverage is recorded. Confirm these days are not also paid in the settlement.');
    end if;
    if v_cover is not null then
      v_warnings := v_warnings || jsonb_build_object('code', 'settlement_coverage',
        'message', 'Days up to ' || to_char(v_cover, 'DD Mon YYYY') || ' are paid through the final settlement and were excluded.');
    end if;
    if v_att then
      v_warnings := v_warnings || jsonb_build_object('code', 'lop_from_attendance', 'message', 'Attendance absences are counted as LOP (company policy setting).');
    end if;

    insert into public.hr_payroll_items (run_id, employee_id, structure_id, currency, working_days, payable_days, lop_days,
                                         gross, total_deductions, employer_contributions, reimbursements, net, breakdown)
    values (p_id, e.id, v_structure, v_currency, v_wd, v_payable, v_lop, v_earn, v_ded, v_employer, v_reimb_total, v_net,
      jsonb_build_object(
        'earnings', coalesce((select jsonb_agg(l order by l ->> 'code') from jsonb_each(v_lines) j(k, l) where l ->> 'kind' = 'earning'), '[]'::jsonb),
        'deductions', coalesce((select jsonb_agg(l order by l ->> 'code') from jsonb_each(v_lines) j(k, l) where l ->> 'kind' = 'deduction'), '[]'::jsonb),
        'employer_contributions', coalesce((select jsonb_agg(l order by l ->> 'code') from jsonb_each(v_lines) j(k, l) where l ->> 'kind' = 'employer_contribution'), '[]'::jsonb),
        'adjustments', v_adj,
        'reimbursements', v_reimb,
        'segments', v_segments,
        'skipped_unverified', coalesce((select jsonb_agg(distinct x) from jsonb_array_elements(v_skipped) x), '[]'::jsonb),
        'skipped_ineligible', v_inelig,
        'statutory', v_stat,
        'statutory_pending', v_stat_pending,
        'validation', jsonb_build_object('errors', v_errors, 'warnings', v_warnings),
        'settlement_covered_through', v_cover,
        'proration_basis', v_basis,
        'lop_from_attendance', v_att,
        'rounding', 'Each line rounded half-up to 2 decimals; statutory lines use the rule''s rounding.',
        'working_days', v_wd, 'payable_days', v_payable, 'lop_days', v_lop,
        'employment_window', jsonb_build_object('from', v_ws, 'to', v_we)));
    v_count := v_count + 1;
    if jsonb_array_length(v_errors) > 0 then v_err_count := v_err_count + 1; end if;
    if jsonb_array_length(v_warnings) > 0 then v_warn_count := v_warn_count + 1; end if;
    v_tot_gross := v_tot_gross + v_earn; v_tot_ded := v_tot_ded + v_ded; v_tot_net := v_tot_net + v_net;
  end loop;

  update public.hr_payroll_runs set status = 'calculated', calculated_by = auth.uid(), calculated_at = now(),
         reviewed_by = null, reviewed_at = null,
         validation = jsonb_build_object('employees', v_count, 'items_with_errors', v_err_count, 'items_with_warnings', v_warn_count,
                                         'excluded', v_excluded, 'calculated_at', now())
   where id = p_id;
  return jsonb_build_object('run_id', p_id, 'employees', v_count, 'gross', v_tot_gross, 'deductions', v_tot_ded, 'net', v_tot_net,
                            'items_with_errors', v_err_count, 'items_with_warnings', v_warn_count, 'excluded', jsonb_array_length(v_excluded));
end $$;
