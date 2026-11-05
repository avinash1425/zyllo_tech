-- Performance: cycles, KPI scoring formulas, goal rules & weight budget,
-- review workflow and confidentiality, feedback visibility, improvement plans.
-- Synthetic data only. Runs inside a transaction that the runner rolls back.

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated, anon, service_role;
create or replace function pg_temp.id(p text) returns uuid language sql as $$ select v from t_ids where k = p $$;
create or replace function pg_temp.uid(p text) returns uuid language sql as $$ select v from t_ids where k = 'u:' || p $$;
create or replace function pg_temp.login(p text) returns void language sql as $$ select test.as_user(pg_temp.uid(p)) $$;
-- review ids are captured as owner (RLS hides unfinalized reviews from their subject)
create or replace function pg_temp.review(p text, c text) returns uuid language sql as $$ select v from t_ids where k = 'r:' || p || ':' || c $$;

do $$
declare dep uuid;
begin
  insert into public.hr_departments (code, name) values ('ENG', 'Engineering') returning id into dep;
  insert into t_ids values ('hr',     test.make_employee('hr@test.local', 'Hira', null, array['hr_admin']));
  insert into t_ids values ('mgr',    test.make_employee('mgr@test.local', 'Mona', null, array['manager','employee'], 'full_time', dep));
  insert into t_ids values ('emp1',   test.make_employee('emp1@test.local', 'Eli', (select v from t_ids where k='mgr'), array['employee'], 'full_time', dep));
  insert into t_ids values ('emp2',   test.make_employee('emp2@test.local', 'Ezra', null, array['employee']));
  insert into t_ids values ('intern', test.make_employee('intern@test.local', 'Ira', (select v from t_ids where k='mgr'), array['intern'], 'intern', dep));
  insert into t_ids select 'u:' || k, test.user_of(v) from t_ids where k in ('hr','mgr','emp1','emp2','intern');
end $$;

-- ---- scoring formulas (pure function)
select test.eq(hr_private.kpi_score('ratio', 'higher_is_better', 100, 50), 50.00::numeric, 'ratio: 50 of 100 = 50');
select test.eq(hr_private.kpi_score('ratio', 'higher_is_better', 100, 150), 100.00::numeric, 'ratio is capped at score_cap');
select test.eq(hr_private.kpi_score('inverse_ratio', 'lower_is_better', 2, 4), 50.00::numeric, 'inverse ratio: target 2, actual 4 = 50');
select test.eq(hr_private.kpi_score('binary', 'higher_is_better', 1, 1), 100::numeric, 'binary met = 100');
select test.eq(hr_private.kpi_score('binary', 'lower_is_better', 5, 6), 0::numeric, 'binary (lower is better) missed = 0');
select test.eq(hr_private.kpi_score('ratio', 'target_exact', 10, 8), 80.00::numeric, 'target exact: 8 vs 10 = 80');
select test.eq(hr_private.kpi_score('manual', 'higher_is_better', null, 73), 73.00::numeric, 'manual: actual is the score');
select test.ok(hr_private.kpi_score('ratio', 'higher_is_better', 100, null) is null, 'no actual -> no score');

-- ---- setup as HR
select pg_temp.login('emp1');
select test.throws($q$insert into public.hr_review_cycles (name, cycle_type, period_start, period_end) values ('X', 'monthly', current_date, current_date)$q$,
  'employee cannot create review cycles', 'row-level security');
select pg_temp.login('hr');
insert into public.hr_kpi_definitions (name, unit, direction, formula_type, default_weight) values
  ('Tickets resolved', 'tickets', 'higher_is_better', 'ratio', 40),
  ('Escaped defects', 'bugs', 'lower_is_better', 'inverse_ratio', 30);
insert into t_ids select 'k_tickets', id from public.hr_kpi_definitions where name = 'Tickets resolved';
insert into t_ids select 'k_bugs', id from public.hr_kpi_definitions where name = 'Escaped defects';
insert into public.hr_review_cycles (name, cycle_type, period_start, period_end, self_assessment_due, manager_review_due)
values ('Q4 2026', 'quarterly', current_date - 30, current_date + 60, current_date + 7, current_date + 14),
       ('Interns Nov 2026', 'intern', current_date - 30, current_date, current_date + 7, current_date + 14);
insert into t_ids select 'q4', id from public.hr_review_cycles where name = 'Q4 2026';
insert into t_ids select 'ic', id from public.hr_review_cycles where name = 'Interns Nov 2026';
select test.throws($q$update public.hr_review_cycles set status = 'active' where name = 'Q4 2026'$q$, 'cycle activation only via RPC', 'Start cycle');

select pg_temp.login('emp1');
select test.throws($q$insert into public.hr_goals (employee_id, cycle_id, title, weight) values ((select v from t_ids where k='emp1'), (select v from t_ids where k='q4'), 'Early goal', 10)$q$,
  'cannot propose goals before the cycle is active', 'only while the review cycle is active');
select test.throws($q$select public.hr_start_review_cycle((select v from t_ids where k='q4'))$q$, 'employee cannot start cycles', 'not allowed');

select pg_temp.login('hr');
select test.eq((public.hr_start_review_cycle(pg_temp.id('q4')) ->> 'reviews_created')::int, 4, 'quarterly cycle creates reviews for non-intern employees');
select test.eq((public.hr_start_review_cycle(pg_temp.id('q4')) ->> 'reviews_created')::int, 0, 're-running start does not duplicate reviews');
select test.eq((public.hr_start_review_cycle(pg_temp.id('ic')) ->> 'reviews_created')::int, 1, 'intern cycle covers interns only');
select test.as_owner();
insert into t_ids select 'r:' || e.k || ':' || c.k, r.id from public.hr_performance_reviews r
  join t_ids e on e.v = r.employee_id join t_ids c on c.v = r.cycle_id and c.k in ('q4','ic');
select pg_temp.login('hr');
select test.ok(pg_temp.review('intern', 'q4') is null, 'interns are not in the quarterly cycle');
select test.eq((select manager_id from public.hr_performance_reviews where id = pg_temp.review('emp1', 'q4')), pg_temp.id('mgr'), 'review snapshot of reporting manager');

-- ---- goals
select pg_temp.login('emp1');
insert into public.hr_goals (employee_id, cycle_id, kpi_id, title, target_value)
values (pg_temp.id('emp1'), pg_temp.id('q4'), pg_temp.id('k_tickets'), 'Resolve support tickets', 100);
insert into t_ids select 'g1', id from public.hr_goals where title = 'Resolve support tickets';
select test.eq((select weight from public.hr_goals where id = pg_temp.id('g1')), 40.00::numeric, 'KPI default weight applied');
select test.throws($q$insert into public.hr_goals (employee_id, cycle_id, title, status) values ((select v from t_ids where k='emp1'), (select v from t_ids where k='q4'), 'Self-agreed', 'agreed')$q$,
  'employee proposals start as draft', 'start as draft');
select test.throws($q$insert into public.hr_goals (employee_id, cycle_id, title) values ((select v from t_ids where k='emp2'), (select v from t_ids where k='q4'), 'For someone else')$q$,
  'employee cannot create goals for others', 'own goals');

select pg_temp.login('mgr');
update public.hr_goals set status = 'agreed', target_value = 100 where id = pg_temp.id('g1');
insert into public.hr_goals (employee_id, cycle_id, kpi_id, title, weight, target_value, status)
values (pg_temp.id('emp1'), pg_temp.id('q4'), pg_temp.id('k_bugs'), 'Keep escaped defects low', 50, 2, 'agreed');
insert into t_ids select 'g2', id from public.hr_goals where title = 'Keep escaped defects low';
select test.throws($q$insert into public.hr_goals (employee_id, cycle_id, title, weight) values ((select v from t_ids where k='emp1'), (select v from t_ids where k='q4'), 'Too much', 20)$q$,
  'goal weights cannot exceed 100 per cycle', 'maximum is 100');
select test.eq(test.count_rows($q$select 1 from public.hr_goals where employee_id = (select v from t_ids where k='emp1')$q$), 2::bigint, 'manager sees team goals');

select pg_temp.login('emp1');
update public.hr_goals set actual_value = 120 where id = pg_temp.id('g1');
update public.hr_goals set actual_value = 4 where id = pg_temp.id('g2');
select test.eq((select score from public.hr_goals where id = pg_temp.id('g1')), 100.00::numeric, 'employee actual updates score (capped)');
select test.eq((select score from public.hr_goals where id = pg_temp.id('g2')), 50.00::numeric, 'inverse KPI scored from actual');
select test.throws($q$update public.hr_goals set weight = 10 where id = (select v from t_ids where k='g1')$q$, 'employee cannot change agreed goal weight', 'Only the actual value');
select test.throws($q$update public.hr_goals set status = 'achieved' where id = (select v from t_ids where k='g1')$q$, 'employee cannot set goal status', 'sets the goal status');
update public.hr_goals set score = 99 where id = pg_temp.id('g2');
select test.eq((select score from public.hr_goals where id = pg_temp.id('g2')), 50.00::numeric, 'client-supplied score is ignored');
select pg_temp.login('emp2');
select test.eq(test.count_rows('select 1 from public.hr_goals'), 0::bigint, 'unrelated employee sees no goals');
select pg_temp.login('hr');
select test.ok((public.hr_compute_goal_scores(pg_temp.id('q4')) ->> 'goals_scored')::int = 2, 'compute scores processes cycle goals');
select test.eq((select goal_score from public.hr_performance_reviews where id = pg_temp.review('emp1', 'q4')), 72.22::numeric,
  'weighted goal score rolled up to review ((100*40 + 50*50) / 90)');

-- ---- review workflow & confidentiality
select pg_temp.login('mgr');
select test.throws(format('select public.hr_submit_manager_assessment(%L, %L, 4)', pg_temp.review('emp1', 'q4'), 'Good'),
  'manager waits for self-assessment before due date', 'not submitted their self-assessment');
select pg_temp.login('emp1');
select test.eq(test.count_rows('select 1 from public.hr_performance_reviews'), 0::bigint, 'employee cannot read own unfinalized review row');
select test.eq(jsonb_array_length(public.hr_my_performance_reviews()), 1, 'employee lists own review via RPC');
select public.hr_submit_self_assessment(pg_temp.review('emp1', 'q4'), 'Shipped the portal', 4);
select test.throws(format('select public.hr_submit_self_assessment(%L, %L, 5)', pg_temp.review('emp1', 'q4'), 'Again'),
  'self-assessment submitted once', 'already been submitted');
select test.throws(format('select public.hr_submit_self_assessment(%L, %L, 5)', pg_temp.review('emp2', 'q4'), 'Not mine'),
  'cannot submit another employee''s self-assessment', 'only submit your own');
select test.throws(format('select public.hr_submit_manager_assessment(%L, %L, 5)', pg_temp.review('emp1', 'q4'), 'I am great'),
  'employee cannot write own manager assessment', 'own review');
select pg_temp.login('emp2');
select test.throws(format('select public.hr_submit_manager_assessment(%L, %L, 1)', pg_temp.review('emp1', 'q4'), 'Bad'),
  'non-manager cannot review a colleague', 'not allowed');
select pg_temp.login('mgr');
select public.hr_submit_manager_assessment(pg_temp.review('emp1', 'q4'), 'Strong delivery, improve estimates', 4);
select test.eq(test.count_rows('select 1 from public.hr_performance_reviews'), 2::bigint, 'manager sees team reviews (emp1 + intern), not own');
select test.throws(format('select public.hr_finalize_performance_review(%L, 4)', pg_temp.review('emp1', 'q4')),
  'manager cannot finalize', 'not allowed');
select pg_temp.login('emp1');
select test.ok((public.hr_my_performance_reviews() -> 0 -> 'manager_assessment') = 'null'::jsonb
               and (public.hr_my_performance_reviews() -> 0 ->> 'self_rating')::int = 4,
               'manager comments hidden from employee until finalized');
select pg_temp.login('hr');
select test.eq(test.count_rows($q$select 1 from public.hr_performance_reviews where employee_id = (select v from t_ids where k='hr')$q$), 0::bigint,
  'HR cannot read own unfinalized review');
select test.throws(format('select public.hr_finalize_performance_review(%L, 4)', pg_temp.review('hr', 'q4')), 'HR cannot finalize own review', 'own review');
select test.throws(format('select public.hr_finalize_performance_review(%L, 4)', pg_temp.review('intern', 'ic')), 'cannot finalize before manager assessment', 'still pending');
select public.hr_finalize_performance_review(pg_temp.review('emp1', 'q4'), 3.75);
select test.throws(format('select public.hr_finalize_performance_review(%L, 4)', pg_temp.review('emp1', 'q4')), 'finalize only once', 'already been finalized');
select test.throws($q$update public.hr_performance_reviews set final_rating = 5$q$, 'reviews are RPC-only', 'permission denied');
select pg_temp.login('emp1');
select test.eq(test.count_rows('select 1 from public.hr_performance_reviews'), 1::bigint, 'employee sees own review once finalized');
select test.eq((public.hr_my_performance_reviews() -> 0 ->> 'manager_assessment'), 'Strong delivery, improve estimates', 'manager comments visible after finalization');
select test.eq((select final_rating from public.hr_performance_reviews), 3.75::numeric, 'final rating visible');
select pg_temp.login('emp2');
select test.eq(test.count_rows('select 1 from public.hr_performance_reviews'), 0::bigint, 'employee never sees others'' reviews');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications where recipient_user_id = pg_temp.uid('emp1') and type = 'review_finalized'),
  'employee notified on finalization');

-- ---- feedback visibility
select pg_temp.login('emp2');
insert into public.hr_performance_feedback (employee_id, feedback_type, body, visibility)
values (pg_temp.id('emp1'), 'praise', 'Great help on the release', 'manager_and_employee'),
       (pg_temp.id('emp1'), 'constructive', 'Code reviews are slow', 'private_to_hr');
select test.throws($q$insert into public.hr_performance_feedback (employee_id, feedback_type, body) values ((select v from t_ids where k='emp2'), 'praise', 'Me!')$q$,
  'no self-feedback', 'yourself');
select test.eq(test.count_rows('select 1 from public.hr_performance_feedback'), 2::bigint, 'author sees own feedback');
select pg_temp.login('emp1');
select test.eq(test.count_rows('select 1 from public.hr_performance_feedback'), 1::bigint, 'subject sees only shared feedback');
select pg_temp.login('mgr');
select test.eq(test.count_rows('select 1 from public.hr_performance_feedback'), 1::bigint, 'manager does not see private-to-HR feedback');
select pg_temp.login('hr');
select test.eq(test.count_rows('select 1 from public.hr_performance_feedback'), 2::bigint, 'HR sees all feedback');

-- ---- improvement plans
select pg_temp.login('emp1');
select test.throws($q$insert into public.hr_improvement_plans (employee_id, start_date, end_date, objectives) values ((select v from t_ids where k='emp1'), current_date, current_date + 30, 'x')$q$,
  'employee cannot create own improvement plan', 'row-level security');
select pg_temp.login('mgr');
insert into public.hr_improvement_plans (employee_id, review_id, start_date, end_date, objectives, owner_id)
values (pg_temp.id('emp1'), pg_temp.review('emp1', 'q4'), current_date, current_date + 60, 'Improve estimation accuracy', pg_temp.id('mgr'));
select pg_temp.login('emp1');
select test.eq(test.count_rows('select 1 from public.hr_improvement_plans'), 1::bigint, 'employee sees own improvement plan');
update public.hr_improvement_plans set status = 'completed';
select test.eq((select status from public.hr_improvement_plans), 'active', 'employee cannot change own improvement plan');
select pg_temp.login('emp2');
select test.eq(test.count_rows('select 1 from public.hr_improvement_plans'), 0::bigint, 'unrelated employee sees no improvement plans');

-- ---- closing a cycle freezes goals
select pg_temp.login('hr');
update public.hr_review_cycles set status = 'closed' where id = pg_temp.id('q4');
select test.throws($q$update public.hr_review_cycles set status = 'draft' where name = 'Q4 2026'$q$, 'closed cycle cannot be reopened', 'cannot be reopened');
select pg_temp.login('emp1');
select test.throws($q$update public.hr_goals set actual_value = 130 where id = (select v from t_ids where k='g1')$q$, 'goals frozen after cycle closes', 'closed');
select test.as_owner();
