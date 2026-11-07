-- Performance & KPI module (206): goal-sheet approval (weights = 100), goal
-- progress updates, calibration stage, review meetings, improvement-plan
-- check-ins / outcome / acknowledgement, role scoping (employee own only,
-- manager reporting line only, payroll-only user sees nothing) and separation
-- of duties. Synthetic data only. Runs inside a transaction that is rolled back.

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated, anon, service_role;
create or replace function pg_temp.id(p text) returns uuid language sql as $$ select v from t_ids where k = p $$;
create or replace function pg_temp.login(p text) returns void language sql as $$ select test.as_user((select v from t_ids where k = 'u:' || p)) $$;

do $$
declare dep uuid;
begin
  insert into public.hr_departments (code, name) values ('PRF', 'Perf Dept') returning id into dep;
  insert into t_ids values ('hr',   test.make_employee('p206.hr@test.local', 'Hana', null, array['hr_admin','employee']));
  insert into t_ids values ('mgr',  test.make_employee('p206.mgr@test.local', 'Milo', null, array['manager','employee'], 'full_time', dep));
  insert into t_ids values ('emp1', test.make_employee('p206.e1@test.local', 'Esha', (select v from t_ids where k='mgr'), array['employee'], 'full_time', dep));
  insert into t_ids values ('emp3', test.make_employee('p206.e3@test.local', 'Eric', (select v from t_ids where k='emp1'), array['employee'], 'full_time', dep));
  insert into t_ids values ('emp2', test.make_employee('p206.e2@test.local', 'Emil', null, array['employee']));
  insert into t_ids values ('pay',  test.make_employee('p206.pay@test.local', 'Pari', null, array['payroll_admin','employee']));
  insert into t_ids select 'u:' || k, test.user_of(v) from t_ids where k in ('hr','mgr','emp1','emp2','emp3','pay');
end $$;

-- ---- setup: KPI template with new columns, half-yearly cycle
select pg_temp.login('hr');
insert into public.hr_kpi_definitions (name, category, unit, measurement, direction, formula_type, default_weight, default_target)
values ('P206 Tickets closed', 'Delivery', 'tickets', 'Closed tickets in the tracker', 'higher_is_better', 'ratio', 60, 200);
insert into t_ids select 'kpi', id from public.hr_kpi_definitions where name = 'P206 Tickets closed';
insert into public.hr_review_cycles (name, cycle_type, period_start, period_end, self_assessment_due, manager_review_due)
values ('P206 H2', 'half_yearly', current_date - 30, current_date + 150, current_date + 7, current_date + 14);
insert into t_ids select 'cy', id from public.hr_review_cycles where name = 'P206 H2';
select test.throws($q$select public.hr_close_review_cycle((select v from t_ids where k='cy'))$q$, 'draft cycle cannot be closed', 'has not started');
select public.hr_start_review_cycle(pg_temp.id('cy'));
select test.as_owner();
insert into t_ids select 'r:' || t.k, r.id from public.hr_performance_reviews r join t_ids t on t.v = r.employee_id where r.cycle_id = pg_temp.id('cy');

-- ---- goals and goal-sheet approval
select pg_temp.login('emp1');
insert into public.hr_goals (employee_id, cycle_id, kpi_id, title, target_value, agreed_at)
values (pg_temp.id('emp1'), pg_temp.id('cy'), pg_temp.id('kpi'), 'Close tickets', 200, now() - interval '9 days');
insert into t_ids select 'g1', id from public.hr_goals where title = 'Close tickets';
select test.ok((select agreed_at is null and weight = 60 from public.hr_goals where id = pg_temp.id('g1')), 'client cannot stamp agreed_at; KPI default weight applied');
select test.throws(format('select public.hr_agree_goal_sheet(%L, %L)', pg_temp.id('emp1'), pg_temp.id('cy')), 'employee cannot approve own goal sheet', 'not allowed');
select test.throws(format('select public.hr_record_goal_progress(%L, 10)', pg_temp.id('g1')), 'no progress on a draft goal', 'once the goal is agreed');

select pg_temp.login('mgr');
insert into public.hr_goals (employee_id, cycle_id, title, weight, target_value, due_date)
values (pg_temp.id('emp1'), pg_temp.id('cy'), 'Mentor a junior', 30, 1, current_date + 60);
select test.throws(format('select public.hr_agree_goal_sheet(%L, %L)', pg_temp.id('emp1'), pg_temp.id('cy')), 'weights must total 100', 'must total exactly 100');
insert into public.hr_goals (employee_id, cycle_id, title, weight, target_value)
values (pg_temp.id('emp1'), pg_temp.id('cy'), 'Write runbooks', 10, 4);
select test.eq((public.hr_agree_goal_sheet(pg_temp.id('emp1'), pg_temp.id('cy')) ->> 'agreed')::int, 3, 'sheet approved at 100%: 3 drafts agreed');
select test.ok((select bool_and(status = 'agreed' and agreed_by = pg_temp.id('mgr') and agreed_at is not null) from public.hr_goals where employee_id = pg_temp.id('emp1')),
  'agreement stamped by the manager');
select test.throws(format('select public.hr_agree_goal_sheet(%L, %L)', pg_temp.id('emp2'), pg_temp.id('cy')), 'manager cannot approve outside reporting line', 'not allowed');
select test.throws(format('select public.hr_agree_goal_sheet(%L, %L)', pg_temp.id('mgr'), pg_temp.id('cy')), 'manager cannot approve own goals', 'not allowed');

-- ---- progress updates
select pg_temp.login('emp2');
select test.throws(format('select public.hr_record_goal_progress(%L, 10)', pg_temp.id('g1')), 'colleague cannot record progress', 'not found');
select pg_temp.login('emp1');
select test.eq((public.hr_record_goal_progress(pg_temp.id('g1'), 150, 'Halfway plus') ->> 'score')::numeric, 75.00::numeric, 'progress recomputes score');
select test.ok((select status = 'in_progress' and last_progress_at is not null from public.hr_goals where id = pg_temp.id('g1')), 'agreed goal moves to in progress');
select test.eq(test.count_rows('select 1 from public.hr_goal_progress_updates'), 1::bigint, 'employee sees own progress history');
select test.throws($q$insert into public.hr_goal_progress_updates (goal_id, employee_id, actual_value) values ((select v from t_ids where k='g1'), (select v from t_ids where k='emp1'), 1)$q$,
  'progress rows are RPC-only', 'permission denied');
select test.throws(format('update public.hr_goals set due_date = current_date + 5 where id = %L', pg_temp.id('g1')), 'employee cannot move due date of agreed goal', 'due date');
select pg_temp.login('mgr');
select test.eq(test.count_rows('select 1 from public.hr_goal_progress_updates'), 1::bigint, 'manager sees team progress');
select pg_temp.login('emp2');
select test.eq(test.count_rows('select 1 from public.hr_goal_progress_updates'), 0::bigint, 'colleague sees no progress');
select test.eq(test.count_rows('select 1 from public.hr_goals'), 0::bigint, 'colleague sees no goals');
select pg_temp.login('pay');
select test.eq(test.count_rows('select 1 from public.hr_goals'), 0::bigint, 'payroll-only user sees no goals');
select test.eq(test.count_rows('select 1 from public.hr_goal_progress_updates'), 0::bigint, 'payroll-only user sees no progress');
select test.eq(test.count_rows('select 1 from public.hr_performance_reviews'), 0::bigint, 'payroll-only user sees no reviews');

-- ---- review workflow with calibration
select pg_temp.login('emp1');
select public.hr_submit_self_assessment(pg_temp.id('r:emp1'), 'Closed most tickets', 4);
select pg_temp.login('mgr');
select test.throws(format('select public.hr_submit_manager_assessment(%L, %L, 3)', pg_temp.id('r:emp2'), 'x'), 'manager cannot assess outside reporting line', 'not allowed');
select public.hr_submit_manager_assessment(pg_temp.id('r:emp1'), 'Solid quarter', 4);
select test.eq((select status from public.hr_performance_reviews where id = pg_temp.id('r:emp1')), 'calibration', 'manager assessment moves review to calibration');
select test.throws(format('select public.hr_return_performance_review(%L, %L)', pg_temp.id('r:emp1'), 'x'), 'manager cannot return (HR only)', 'not allowed');
select pg_temp.login('hr');
select test.ok(exists (select 1 from public.hr_notifications where type = 'review_ready_for_calibration'), 'HR notified for calibration');
select test.throws(format('select public.hr_return_performance_review(%L, %L)', pg_temp.id('r:emp1'), ''), 'return needs a reason', 'reason');
select public.hr_return_performance_review(pg_temp.id('r:emp1'), 'Add examples');
select test.ok((select status = 'manager_review' and manager_submitted_at is null and return_reason = 'Add examples'
                from public.hr_performance_reviews where id = pg_temp.id('r:emp1')), 'returned to manager');
select test.throws(format('select public.hr_finalize_performance_review(%L, 4)', pg_temp.id('r:emp1')), 'cannot finalize while back with manager', 'still pending');
select pg_temp.login('mgr');
select public.hr_submit_manager_assessment(pg_temp.id('r:emp1'), 'Solid quarter; runbooks for on-call', 4);
select test.throws(format('select public.hr_finalize_performance_review(%L, 4)', pg_temp.id('r:emp1')), 'manager cannot finalize', 'not allowed');
select pg_temp.login('hr');
select test.throws(format('select public.hr_finalize_performance_review(%L, 4)', pg_temp.id('r:hr')), 'HR cannot finalize own review', 'own review');
select public.hr_finalize_performance_review(pg_temp.id('r:emp1'), 3.8, 'Calibrated against department');
select test.ok((select status = 'finalized' and final_rating = 3.80 and calibration_notes = 'Calibrated against department' and goal_score = 75.00
                from public.hr_performance_reviews where id = pg_temp.id('r:emp1')), 'finalized with calibration notes and weighted goal score over scored goals (75)');

-- ---- review meetings
select pg_temp.login('mgr');
select test.throws(format('select public.hr_save_review_meeting(null, %L, now() + interval ''2 days'')', pg_temp.id('emp2')),
  'manager cannot schedule outside reporting line', 'not allowed');
insert into t_ids values ('m1', public.hr_save_review_meeting(null, pg_temp.id('emp1'), now() + interval '2 days', pg_temp.id('r:emp1'), 'review', 45, 'video', 'Meet link',
  array[pg_temp.id('hr'), pg_temp.id('emp1')], 'Discuss H2 review'));
select test.ok((select cardinality(attendee_ids) = 1 and cycle_id = pg_temp.id('cy') from public.hr_performance_meetings where id = pg_temp.id('m1')),
  'subject is not an attendee of their own meeting; cycle taken from review');
insert into t_ids values ('m3', public.hr_save_review_meeting(null, pg_temp.id('emp3'), now() + interval '3 days'));
select test.eq(test.count_rows('select 1 from public.hr_performance_meetings'), 2::bigint, 'manager sees meetings of direct and indirect reports');
select pg_temp.login('emp1');
select test.eq(test.count_rows('select 1 from public.hr_performance_meetings'), 1::bigint, 'employee sees own meeting only (not report''s, no view_team)');
select test.eq(jsonb_array_length(public.hr_list_review_meetings()), 1, 'meeting RPC scoped the same way');
select test.eq(public.hr_list_review_meetings() -> 0 -> 'attendees' -> 0 ->> 'name', 'Hana Test', 'attendee names resolved for the employee');
select test.throws(format('select public.hr_complete_review_meeting(%L, %L)', pg_temp.id('m1'), 'notes'), 'employee cannot complete meeting', 'not found');
select test.throws($q$insert into public.hr_performance_meetings (employee_id, scheduled_at) values ((select v from t_ids where k='emp1'), now())$q$,
  'meetings are RPC-only', 'permission denied');
select pg_temp.login('emp2');
select test.eq(test.count_rows('select 1 from public.hr_performance_meetings'), 0::bigint, 'colleague sees no meetings');
select test.eq(jsonb_array_length(public.hr_list_review_meetings()), 0, 'colleague RPC empty');
select pg_temp.login('pay');
select test.eq(jsonb_array_length(public.hr_list_review_meetings()), 0, 'payroll-only user sees no meetings');
select pg_temp.login('mgr');
select public.hr_complete_review_meeting(pg_temp.id('m1'), 'Agreed on runbook targets', 'Draft 2 runbooks');
select test.eq((select status from public.hr_performance_meetings where id = pg_temp.id('m1')), 'completed', 'meeting completed');
select test.throws(format('select public.hr_cancel_review_meeting(%L)', pg_temp.id('m1')), 'completed meeting cannot be cancelled', 'Only a scheduled');

-- ---- improvement plans
select pg_temp.login('mgr');
insert into public.hr_improvement_plans (employee_id, title, start_date, end_date, objectives)
values (pg_temp.id('emp1'), 'Estimation PIP', current_date - 10, current_date + 50, 'Estimate within 20%');
insert into t_ids select 'pip', id from public.hr_improvement_plans where title = 'Estimation PIP';
select test.eq((select owner_id from public.hr_improvement_plans where id = pg_temp.id('pip')), pg_temp.id('mgr'), 'creator becomes owner');
select test.throws(format('update public.hr_improvement_plans set status = %L where id = %L', 'completed', pg_temp.id('pip')), 'status only through RPC', 'Record outcome');
select pg_temp.login('emp1');
select test.throws(format('select public.hr_add_improvement_checkin(%L, current_date, %L, %L)', pg_temp.id('pip'), 'on_track', 'me'), 'employee cannot add check-ins', 'not found');
select public.hr_acknowledge_improvement_plan(pg_temp.id('pip'), 'Understood');
select test.throws(format('select public.hr_acknowledge_improvement_plan(%L)', pg_temp.id('pip')), 'acknowledge once', 'already acknowledged');
select pg_temp.login('mgr');
select test.throws(format('select public.hr_add_improvement_checkin(%L, current_date + 3, %L, %L)', pg_temp.id('pip'), 'on_track', 'x'), 'no future check-ins', 'future');
select public.hr_add_improvement_checkin(pg_temp.id('pip'), current_date, 'at_risk', 'Two estimates missed');
select test.throws(format('select public.hr_close_improvement_plan(%L, %L, %L, current_date)', pg_temp.id('pip'), 'extended', 'more time'), 'extension needs later end date', 'new end date');
select public.hr_close_improvement_plan(pg_temp.id('pip'), 'extended', 'More time to show improvement', current_date + 80);
select test.ok((select status = 'extended' and end_date = current_date + 80 from public.hr_improvement_plans where id = pg_temp.id('pip')), 'plan extended');
select pg_temp.login('emp1');
select test.eq(test.count_rows('select 1 from public.hr_improvement_plan_checkins'), 1::bigint, 'employee sees check-ins of own plan');
select test.ok((select employee_acknowledged_at is not null and employee_comment = 'Understood' from public.hr_improvement_plans), 'acknowledgement stored');
select pg_temp.login('emp2');
select test.eq(test.count_rows('select 1 from public.hr_improvement_plan_checkins'), 0::bigint, 'colleague sees no check-ins');
select pg_temp.login('pay');
select test.eq(test.count_rows('select 1 from public.hr_improvement_plans'), 0::bigint, 'payroll-only user sees no plans');
select test.eq(test.count_rows('select 1 from public.hr_improvement_plan_checkins'), 0::bigint, 'payroll-only user sees no check-ins');
select pg_temp.login('hr');
select public.hr_close_improvement_plan(pg_temp.id('pip'), 'completed', 'Targets met');
select test.ok((select status = 'completed' and closed_at is not null and closed_by = pg_temp.id('hr') from public.hr_improvement_plans where id = pg_temp.id('pip')), 'plan closed by HR');
select test.throws(format('select public.hr_add_improvement_checkin(%L, current_date, %L, %L)', pg_temp.id('pip'), 'on_track', 'x'), 'no check-ins after close', 'closed');

-- ---- shared feedback with author names
select pg_temp.login('mgr');
insert into public.hr_performance_feedback (employee_id, feedback_type, body, visibility) values (pg_temp.id('emp1'), 'praise', 'Great runbooks', 'manager_and_employee');
select pg_temp.login('emp1');
select test.ok((public.hr_my_performance_feedback() -> 0 ->> 'from_manager')::boolean and (public.hr_my_performance_feedback() -> 0 ->> 'from_name') = 'Milo Test',
  'employee sees manager feedback with author');

-- ---- closing the cycle
select pg_temp.login('mgr');
select test.throws($q$select public.hr_close_review_cycle((select v from t_ids where k='cy'))$q$, 'manager cannot close cycles', 'not allowed');
select pg_temp.login('hr');
select test.ok((public.hr_close_review_cycle(pg_temp.id('cy')) ->> 'unfinalized_reviews')::int >= 1, 'close reports unfinalized reviews');
select pg_temp.login('emp1');
select test.throws(format('select public.hr_record_goal_progress(%L, 190)', pg_temp.id('g1')), 'no progress after close', 'only while the review cycle is active');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_audit_log where table_name = 'hr_performance_meetings'), 'meetings are audited');
select test.ok(exists (select 1 from public.hr_audit_log where table_name = 'hr_goal_progress_updates'), 'progress updates are audited');
