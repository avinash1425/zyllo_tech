-- Module 8 — Daily Work Reports (128): project allocation, daily tasks,
-- completed work, blockers, hours / attendance comparison, versions,
-- approval locking + reopen, scoping. Synthetic data only.
-- Runs inside a transaction that the runner rolls back.

create temp table t_ids (k text primary key, v uuid);
create temp table t_d (k text primary key, d date);
grant all on t_ids, t_d to authenticated, anon, service_role;

create or replace function pg_temp.su(p_k text) returns void language plpgsql as $$
begin
  perform test.as_owner();
  perform test.as_user(test.user_of((select v from t_ids where k = p_k)));
end $$;
create or replace function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;
create or replace function pg_temp.d(p_k text) returns date language sql as $$ select d from t_d where k = p_k $$;

do $$
declare mon date;
begin
  insert into t_ids values ('hr',   test.make_employee('m8.hr@test.local', 'Hana', null, array['hr_admin']));
  insert into t_ids values ('mgr',  test.make_employee('m8.mgr@test.local', 'Mira', null, array['manager','employee']));
  insert into t_ids values ('mgr2', test.make_employee('m8.mgr2@test.local', 'Milo', null, array['manager','employee']));
  insert into t_ids values ('emp1', test.make_employee('m8.emp1@test.local', 'Ezra', (select v from t_ids where k='mgr')));
  insert into t_ids values ('emp3', test.make_employee('m8.emp3@test.local', 'Enzo', (select v from t_ids where k='mgr')));
  insert into t_ids values ('emp2', test.make_employee('m8.emp2@test.local', 'Ella', (select v from t_ids where k='mgr2')));
  mon := hr_private.business_today() - (extract(isodow from hr_private.business_today())::int - 1) - 7;
  insert into t_d values ('mon', mon), ('tue', mon + 1), ('wed', mon + 2), ('thu', mon + 3), ('fri', mon + 4);
end $$;

-- =====================================================================
-- Project allocation
-- =====================================================================
select pg_temp.su('hr');
insert into public.hr_projects (code, name, manager_employee_id) values ('M8A', 'Synthetic Alpha', pg_temp.id('mgr2')), ('M8B', 'Synthetic Beta', null);
insert into t_ids select 'pa', id from public.hr_projects where code = 'M8A';
insert into t_ids select 'pb', id from public.hr_projects where code = 'M8B';
-- emp1 on Alpha from Tuesday only; on Beta without dates.
insert into public.hr_project_members (project_id, employee_id, role, start_date, allocation_pct)
values (pg_temp.id('pa'), pg_temp.id('emp1'), 'developer', pg_temp.d('tue'), 60);
insert into public.hr_project_members (project_id, employee_id, role) values (pg_temp.id('pb'), pg_temp.id('emp1'), 'developer');
insert into public.hr_tasks (project_id, assignee_id, title) values (pg_temp.id('pa'), pg_temp.id('emp1'), 'Synthetic API');
insert into t_ids select 'ta', id from public.hr_tasks where title = 'Synthetic API';
select test.throws(format('insert into public.hr_project_members (project_id, employee_id, start_date, end_date) values (%L, %L, %L, %L)',
  pg_temp.id('pb'), pg_temp.id('emp3'), pg_temp.d('fri'), pg_temp.d('mon')), 'allocation end before start rejected', 'check constraint');
select test.throws(format('insert into public.hr_project_members (project_id, employee_id, allocation_pct) values (%L, %L, 150)',
  pg_temp.id('pb'), pg_temp.id('emp3')), 'allocation over 100% rejected', 'check constraint');
select test.throws(format('insert into public.hr_project_members (project_id, employee_id) values (%L, %L)', pg_temp.id('pa'), pg_temp.id('emp1')),
  'duplicate allocation rejected', 'duplicate key');
select test.eq(test.count_rows(format('select 1 from public.hr_project_allocation_history where project_id = %L and action = %L', pg_temp.id('pa'), 'assigned')), 1::bigint,
  'allocation history records assignment');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications where recipient_user_id = test.user_of(pg_temp.id('emp1')) and type = 'daily_reports.project_assigned'),
  'employee notified of project assignment');

-- Project manager (mgr2) manages allocations of the project they manage only.
select pg_temp.su('mgr2');
select test.eq(test.count_rows(format('select 1 from public.hr_projects where id = %L', pg_temp.id('pa'))), 1::bigint, 'project manager sees own project');
insert into public.hr_project_members (project_id, employee_id, role) values (pg_temp.id('pa'), pg_temp.id('emp3'), 'tester');
select test.eq(test.count_rows(format('select 1 from public.hr_project_members where project_id = %L', pg_temp.id('pa'))), 2::bigint, 'project manager allocates to own project');
update public.hr_project_members set end_date = pg_temp.d('wed') where project_id = pg_temp.id('pa') and employee_id = pg_temp.id('emp3');
select test.as_owner();
select test.eq((select end_date from public.hr_project_members where project_id = pg_temp.id('pa') and employee_id = pg_temp.id('emp3')), pg_temp.d('wed'),
  'project manager updates allocation dates');
select test.eq(test.count_rows(format('select 1 from public.hr_project_allocation_history where project_id = %L and employee_id = %L and action = %L',
  pg_temp.id('pa'), pg_temp.id('emp3'), 'updated')), 1::bigint, 'allocation update recorded in history');
select pg_temp.su('mgr2');
select test.throws(format('insert into public.hr_project_members (project_id, employee_id) values (%L, %L)', pg_temp.id('pb'), pg_temp.id('emp2')),
  'project manager cannot allocate to a project they do not manage', 'row-level security');
update public.hr_projects set name = 'Renamed by PM' where code = 'M8A';
select test.eq((select name from public.hr_projects where code = 'M8A'), 'Synthetic Alpha', 'project manager cannot edit project master');
select pg_temp.su('emp1');
select test.throws(format('insert into public.hr_project_members (project_id, employee_id) values (%L, %L)', pg_temp.id('pb'), pg_temp.id('emp3')),
  'employee cannot allocate', 'row-level security');
select test.eq(test.count_rows('select 1 from public.hr_projects'), 2::bigint, 'employee sees only assigned projects');
select pg_temp.su('emp2');
select test.eq(test.count_rows('select 1 from public.hr_projects'), 0::bigint, 'unassigned employee sees no projects');
select test.eq(test.count_rows('select 1 from public.hr_project_allocation_history'), 0::bigint, 'unassigned employee sees no allocation history');

-- =====================================================================
-- Daily tasks (items)
-- =====================================================================
select pg_temp.su('emp1');
insert into public.hr_daily_reports (employee_id, report_date, summary) values (hr_private.current_employee_id(), pg_temp.d('mon'), 'Monday');
insert into t_ids select 'rmon', id from public.hr_daily_reports where report_date = pg_temp.d('mon');
select test.throws(format('insert into public.hr_daily_report_items (report_id, project_id, activity, hours) values (%L, %L, %L, 2)', pg_temp.id('rmon'), pg_temp.id('pa'), 'Too early'),
  'cannot log work on a project before the allocation starts', 'not a member');
select test.throws($q$insert into public.hr_daily_reports (employee_id, report_date) values (hr_private.current_employee_id(), (select d from t_d where k = 'mon'))$q$,
  'duplicate report for the same date rejected', 'duplicate key');

insert into public.hr_daily_reports (employee_id, report_date) values (hr_private.current_employee_id(), pg_temp.d('tue'));
insert into t_ids select 'r1', id from public.hr_daily_reports where report_date = pg_temp.d('tue');
insert into public.hr_daily_report_items (report_id, project_id, task_id, activity, hours, progress_pct, work_status, completed_work, deliverables, links)
values (pg_temp.id('r1'), pg_temp.id('pa'), pg_temp.id('ta'), 'Synthetic endpoint', 3, 40, 'completed', 'Endpoint merged', 'PR #1', array['https://example.com/pr/1']);
insert into public.hr_daily_report_items (report_id, project_id, activity, hours, progress_pct, work_status)
values (pg_temp.id('r1'), pg_temp.id('pb'), 'Synthetic screen', 2.5, 30, 'in_progress');
insert into public.hr_daily_report_items (report_id, activity, hours, work_status) values (pg_temp.id('r1'), 'Synthetic waiting', 1, 'blocked');
insert into public.hr_daily_report_items (report_id, activity, hours, work_status) values (pg_temp.id('r1'), 'Synthetic later task', 0, 'not_started');
select test.eq(test.count_rows(format('select 1 from public.hr_daily_report_items where report_id = %L', pg_temp.id('r1'))), 4::bigint, 'multiple tasks per report');
select test.eq((select total_hours from public.hr_daily_reports where id = pg_temp.id('r1')), 6.50::numeric, 'daily total hours computed');
select test.eq((select progress_pct::int from public.hr_daily_report_items where activity = 'Synthetic endpoint'), 100, 'completed task forced to 100 %');
select test.eq((select completion_date from public.hr_daily_report_items where activity = 'Synthetic endpoint'), pg_temp.d('tue'), 'completion date defaults to report date');
select test.throws(format('insert into public.hr_daily_report_items (report_id, activity, hours) values (%L, %L, -1)', pg_temp.id('r1'), 'Negative'),
  'negative hours rejected', 'check constraint');
select test.throws(format('insert into public.hr_daily_report_items (report_id, activity, hours, work_status) values (%L, %L, 0, %L)', pg_temp.id('r1'), 'Zero', 'in_progress'),
  'zero hours on a started task rejected', 'check constraint');
select test.throws(format('insert into public.hr_daily_report_items (report_id, activity, hours) values (%L, %L, 18)', pg_temp.id('r1'), 'Overflow'),
  'daily total over 24 h rejected', 'exceed 24');
select test.throws(format('insert into public.hr_daily_report_items (report_id, activity, hours, work_status) values (%L, %L, 1, %L)', pg_temp.id('r1'), 'Bad status', 'paused'),
  'unknown task status rejected', 'check constraint');
select test.throws(format('insert into public.hr_daily_report_items (report_id, activity, hours, work_status, progress_pct) values (%L, %L, 0, %L, 20)', pg_temp.id('r1'), 'Odd', 'not_started'),
  'not-started task with progress rejected', 'cannot have progress');
select test.throws(format('insert into public.hr_daily_report_items (report_id, activity, hours, links) values (%L, %L, 1, %L)', pg_temp.id('r1'), 'Bad link', '{javascript:alert(1)}'),
  'unsafe link rejected', 'http(s)');
select test.throws(format('insert into public.hr_daily_report_items (report_id, activity, hours, work_status, completion_date) values (%L, %L, 1, %L, %L)',
  pg_temp.id('r1'), 'Future completion', 'completed', pg_temp.d('fri')), 'completion date after report date rejected', 'completion date');

-- =====================================================================
-- Blockers + submission rules
-- =====================================================================
select test.throws(format('select public.hr_submit_daily_report(%L)', pg_temp.id('r1')), 'blocked task without a blocker cannot be submitted', 'blocker');
select test.throws(format('insert into public.hr_work_blockers (employee_id, title, reported_date) values (%L, %L, current_date)', pg_temp.id('emp1'), 'Direct'),
  'blockers cannot be written directly', 'permission denied');
select public.hr_save_work_blocker(null, pg_temp.id('r1'), (select id from public.hr_daily_report_items where activity = 'Synthetic waiting'), null, null,
  'Waiting for synthetic credentials', 'Need sandbox access', 'high');
insert into t_ids select 'b1', id from public.hr_work_blockers where title = 'Waiting for synthetic credentials';
select test.eq((select reported_date from public.hr_work_blockers where id = pg_temp.id('b1')), pg_temp.d('tue'), 'blocker dated with its report');
select test.throws(format('select public.hr_save_work_blocker(null, null, null, %L, null, %L)', pg_temp.id('pa'), 'x'), 'blocker title validated', '2–200');
select test.throws(format('select public.hr_save_work_blocker(null, null, null, null, null, %L, null, %L)', 'Severity check', 'apocalyptic'), 'blocker severity validated', 'severity');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications where recipient_user_id = test.user_of(pg_temp.id('mgr')) and type = 'daily_reports.blocker'),
  'manager notified in-app about the blocker');
select pg_temp.su('mgr');
select test.eq(test.count_rows('select 1 from public.hr_list_work_blockers(''active'')'), 1::bigint, 'manager sees team blocker');
select pg_temp.su('mgr2');
select test.eq(test.count_rows('select 1 from public.hr_work_blockers'), 0::bigint, 'unrelated manager cannot see blocker');
select test.throws(format('select public.hr_update_work_blocker(%L, %L)', pg_temp.id('b1'), 'resolved'), 'unrelated manager cannot update blocker', 'not found');

select pg_temp.su('emp1');
select test.eq(public.hr_submit_daily_report(pg_temp.id('r1')) ->> 'status', 'submitted', 'report with blocker documented is submitted');
select test.eq(test.count_rows(format('select 1 from public.hr_daily_report_versions where report_id = %L', pg_temp.id('r1'))), 1::bigint, 'submission stores version 1');
select test.eq((select jsonb_array_length(snapshot -> 'items') from public.hr_daily_report_versions where report_id = pg_temp.id('r1')), 4, 'version snapshot includes tasks');
select test.eq((select jsonb_array_length(snapshot -> 'blockers') from public.hr_daily_report_versions where report_id = pg_temp.id('r1')), 1, 'version snapshot includes blockers');
select test.throws(format('select public.hr_save_work_blocker(%L, null, null, null, null, %L)', pg_temp.id('b1'), 'Edited after submit'),
  'blocker of a submitted report cannot be edited', 'locked');
update public.hr_daily_report_items set hours = 9 where report_id = pg_temp.id('r1');
select test.eq((select total_hours from public.hr_daily_reports where id = pg_temp.id('r1')), 6.50::numeric, 'submitted report tasks are review-controlled');

-- Zero-hour report cannot be submitted.
insert into public.hr_daily_reports (employee_id, report_date) values (hr_private.current_employee_id(), pg_temp.d('wed'));
insert into t_ids select 'r0', id from public.hr_daily_reports where report_date = pg_temp.d('wed');
insert into public.hr_daily_report_items (report_id, activity, hours, work_status) values (pg_temp.id('r0'), 'Plan only', 0, 'not_started');
select test.throws(format('select public.hr_submit_daily_report(%L)', pg_temp.id('r0')), 'report with zero hours cannot be submitted', 'hours');

-- =====================================================================
-- Manager review: changes requested -> revision -> approve -> locked -> reopen
-- =====================================================================
select pg_temp.su('mgr2');
select test.throws(format('select public.hr_review_daily_report(%L, %L)', pg_temp.id('r1'), 'reviewed'), 'manager outside reporting line cannot approve', 'not allowed');
select pg_temp.su('mgr');
select test.eq(public.hr_review_daily_report(pg_temp.id('r1'), 'revision_requested', 'Split the screen hours') ->> 'status', 'revision_requested', 'manager requests changes');
select pg_temp.su('emp1');
update public.hr_daily_report_items set hours = 2, notes = 'Split per request' where report_id = pg_temp.id('r1') and activity = 'Synthetic screen';
select test.eq((select total_hours from public.hr_daily_reports where id = pg_temp.id('r1')), 6.00::numeric, 'employee revises returned report');
select test.eq(public.hr_submit_daily_report(pg_temp.id('r1')) ->> 'status', 'submitted', 'employee resubmits');
select test.eq((select max(version) from public.hr_daily_report_versions where report_id = pg_temp.id('r1')), 2, 'resubmission stores version 2');
select test.eq((select (snapshot ->> 'total_hours')::numeric from public.hr_daily_report_versions where report_id = pg_temp.id('r1') and version = 1), 6.50::numeric,
  'version 1 preserved unchanged');
select pg_temp.su('mgr');
select test.eq(public.hr_review_daily_report(pg_temp.id('r1'), 'reviewed', 'Approved') ->> 'status', 'reviewed', 'manager approves');
select pg_temp.su('emp1');
update public.hr_daily_reports set summary = 'tampered' where id = pg_temp.id('r1');
select test.ok((select summary from public.hr_daily_reports where id = pg_temp.id('r1')) is null, 'approved report locked for employee');
select test.throws(format('select public.hr_reopen_daily_report(%L, %L)', pg_temp.id('r1'), 'please'), 'employee cannot reopen own report', 'own report');
select pg_temp.su('mgr2');
select test.throws(format('select public.hr_reopen_daily_report(%L, %L)', pg_temp.id('r1'), 'x'), 'unrelated manager cannot reopen', 'not found');
select pg_temp.su('mgr');
select test.throws(format('select public.hr_reopen_daily_report(%L, %L)', pg_temp.id('r1'), ' '), 'reopen requires a reason', 'reason');
select test.eq(public.hr_reopen_daily_report(pg_temp.id('r1'), 'Wrong project on one task') ->> 'status', 'revision_requested', 'reviewer reopens approved report');
select test.throws(format('select public.hr_reopen_daily_report(%L, %L)', pg_temp.id('r1'), 'again'), 'only approved reports can be reopened', 'approved');
select test.eq((select action from public.hr_daily_report_reviews where report_id = pg_temp.id('r1') order by created_at desc, action limit 1), 'reopened', 'reopen recorded in review history');
select pg_temp.su('emp1');
select test.eq(public.hr_submit_daily_report(pg_temp.id('r1')) ->> 'status', 'submitted', 'reopened report resubmitted');
select pg_temp.su('mgr');
select test.eq(public.hr_review_daily_report(pg_temp.id('r1'), 'reviewed') ->> 'status', 'reviewed', 'approved again');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_audit_log where table_name = 'hr_daily_report_items' and record_id in (select id::text from public.hr_daily_report_items where report_id = pg_temp.id('r1'))),
  'task edits are audited');
-- HR self-approval prevention: HR cannot approve their own report.
select pg_temp.su('hr');
insert into public.hr_daily_reports (employee_id, report_date) values (hr_private.current_employee_id(), pg_temp.d('tue'));
insert into public.hr_daily_report_items (report_id, activity, hours) select id, 'HR admin work', 4 from public.hr_daily_reports where employee_id = pg_temp.id('hr');
select public.hr_submit_daily_report((select id from public.hr_daily_reports where employee_id = pg_temp.id('hr')));
select test.throws(format('select public.hr_review_daily_report(%L, %L)', (select id from public.hr_daily_reports where employee_id = pg_temp.id('hr')), 'reviewed'),
  'HR cannot approve their own report', 'own report');

-- =====================================================================
-- Blocker triage / resolution
-- =====================================================================
select pg_temp.su('emp1');
select test.throws(format('select public.hr_update_work_blocker(%L, null, %L)', pg_temp.id('b1'), pg_temp.id('emp3')), 'reporter cannot assign owner', 'manager or HR');
select pg_temp.su('mgr');
select test.eq(public.hr_update_work_blocker(pg_temp.id('b1'), 'in_progress', pg_temp.id('emp3')) ->> 'status', 'in_progress', 'manager triages and assigns owner');
select pg_temp.su('emp3');
select test.eq(test.count_rows('select 1 from public.hr_list_work_blockers(null, null, null, null, null, null, true)'), 1::bigint, 'resolution owner sees assigned blocker');
select test.throws(format('select public.hr_update_work_blocker(%L, %L)', pg_temp.id('b1'), 'resolved'), 'resolution notes required', 'notes');
select test.eq(public.hr_update_work_blocker(pg_temp.id('b1'), 'resolved', null, 'Synthetic credentials issued') ->> 'resolved_date', hr_private.business_today()::text,
  'owner resolves blocker with notes');
select test.throws(format('select public.hr_update_work_blocker(%L, %L)', pg_temp.id('b1'), 'open'), 'owner cannot reopen', 'reopen');
select pg_temp.su('emp1');
select test.eq(public.hr_update_work_blocker(pg_temp.id('b1'), 'open') ->> 'status', 'open', 'reporter reopens blocker');
select test.ok((public.hr_update_work_blocker(pg_temp.id('b1'), 'in_progress') ->> 'resolved_date') is null, 'resolved date cleared after reopen');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications where recipient_user_id = test.user_of(pg_temp.id('emp3')) and type = 'daily_reports.blocker_assigned'),
  'resolution owner notified');
select test.ok(exists (select 1 from public.hr_notifications where recipient_user_id = test.user_of(pg_temp.id('emp1')) and type = 'daily_reports.blocker_resolved'),
  'reporter notified of resolution');
select pg_temp.su('emp1');
select public.hr_save_work_blocker(null, null, null, pg_temp.id('pb'), null, 'Standalone synthetic blocker');
select pg_temp.su('emp2');
select test.throws(format('select public.hr_save_work_blocker(null, null, null, %L, null, %L)', pg_temp.id('pa'), 'Not mine'),
  'blocker only on assigned projects', 'not a member');
select pg_temp.su('emp1');
select public.hr_delete_work_blocker((select id from public.hr_work_blockers where title = 'Standalone synthetic blocker'));
select test.eq(test.count_rows('select 1 from public.hr_work_blockers where title = ''Standalone synthetic blocker'''), 0::bigint, 'reporter removes open standalone blocker');
select test.throws(format('select public.hr_delete_work_blocker(%L)', pg_temp.id('b1')), 'blocker of locked report cannot be removed', 'editable');

-- =====================================================================
-- Hours, attendance comparison, completed work, overview, scoping
-- =====================================================================
select test.as_owner();
insert into public.hr_attendance (employee_id, work_date, status, check_in_at, check_out_at, worked_minutes, source)
values (pg_temp.id('emp1'), pg_temp.d('tue'), 'present', pg_temp.d('tue') + time '09:00', pg_temp.d('tue') + time '13:00', 240, 'manual'),
       (pg_temp.id('emp3'), pg_temp.d('tue'), 'present', pg_temp.d('tue') + time '09:00', pg_temp.d('tue') + time '17:00', 480, 'manual');
create temp table t_att as select * from public.hr_attendance where employee_id = pg_temp.id('emp1');

select pg_temp.su('mgr');
select test.eq((select hours from public.hr_work_hours_summary(pg_temp.d('mon'), pg_temp.d('fri'), 'employee') where employee_id = pg_temp.id('emp1')), 6.00::numeric,
  'employee-wise hours');
select test.eq((select hours from public.hr_work_hours_summary(pg_temp.d('mon'), pg_temp.d('fri'), 'project') where project_id = pg_temp.id('pa')), 3.00::numeric,
  'project-wise hours');
select test.eq((select hours from public.hr_work_hours_summary(pg_temp.d('mon'), pg_temp.d('fri'), 'week')), 6.00::numeric, 'weekly hours');
select test.eq((select sum(hours) from public.hr_work_hours_summary(pg_temp.d('mon'), pg_temp.d('fri'), 'month')), 6.00::numeric, 'monthly hours');
select test.eq((select flag from public.hr_work_hours_vs_attendance(pg_temp.d('mon'), pg_temp.d('fri')) where employee_id = pg_temp.id('emp1') and work_date = pg_temp.d('tue')),
  'reported_exceeds_attendance', 'discrepancy flagged (6 h reported vs 4 h attended)');
select test.eq((select flag from public.hr_work_hours_vs_attendance(pg_temp.d('mon'), pg_temp.d('fri')) where employee_id = pg_temp.id('emp3') and work_date = pg_temp.d('tue')),
  'no_report', 'attendance without a report flagged');
select test.ok((select count(*) from public.hr_work_hours_vs_attendance(pg_temp.d('mon'), pg_temp.d('fri'), null, null, null, true)) = 2, 'only-flagged filter');
select test.as_owner();
select test.ok((select (a.worked_minutes, a.status, a.updated_at) = (t.worked_minutes, t.status, t.updated_at) from public.hr_attendance a join t_att t on t.id = a.id),
  'attendance record untouched by the comparison');
select pg_temp.su('mgr');
select test.eq((select activity from public.hr_completed_work(pg_temp.d('mon'), pg_temp.d('fri'))), 'Synthetic endpoint', 'completed work listed for manager');
select test.eq(test.count_rows(format('select 1 from public.hr_completed_work(%L, %L, null, null, %L, false)', pg_temp.d('mon'), pg_temp.d('fri'), pg_temp.id('ta'))), 1::bigint,
  'task completion history');
select test.eq((public.hr_daily_work_overview(pg_temp.d('tue')) -> 'kpis' ->> 'approved')::int, 1, 'overview: approved count');
select test.eq((public.hr_daily_work_overview(pg_temp.d('tue')) -> 'kpis' ->> 'submitted_today')::int, 1, 'overview: submitted on date');
select test.eq((public.hr_daily_work_overview(pg_temp.d('tue')) -> 'kpis' ->> 'pending_submission')::int, 1, 'overview: pending submission (emp3)');
select test.eq((public.hr_daily_work_overview(pg_temp.d('tue')) -> 'kpis' ->> 'active_blockers')::int, 1, 'overview: active blockers');
select test.eq((public.hr_daily_work_overview(pg_temp.d('tue')) -> 'kpis' ->> 'hours_discrepancies')::int, 2, 'overview: attendance discrepancies');
select test.eq(jsonb_array_length(public.hr_daily_work_overview(pg_temp.d('tue')) -> 'employee_status'), 2, 'manager overview limited to own team');
select test.eq(jsonb_array_length(public.hr_daily_work_overview(pg_temp.d('tue'), null, null, null, pg_temp.id('pa')) -> 'project_hours'), 1, 'overview project filter');
select test.ok((public.hr_daily_work_overview(pg_temp.d('wed')) -> 'employee_status') @> jsonb_build_array(jsonb_build_object('employee_id', pg_temp.id('emp1'), 'status', 'not_submitted')),
  'draft is shown as not submitted (drafts stay private)');
select pg_temp.su('hr');
select test.eq(jsonb_array_length(public.hr_daily_work_overview(pg_temp.d('tue')) -> 'employee_status'), 6, 'HR overview covers everyone');
select pg_temp.su('mgr2');
select test.eq(test.count_rows(format('select 1 from public.hr_work_hours_summary(%L, %L, %L)', pg_temp.d('mon'), pg_temp.d('fri'), 'employee')), 0::bigint,
  'other manager sees no hours of another team');
select test.eq(test.count_rows(format('select 1 from public.hr_completed_work(%L, %L)', pg_temp.d('mon'), pg_temp.d('fri'))), 0::bigint, 'other manager sees no completed work');
select pg_temp.su('emp1');
select test.throws('select public.hr_daily_work_overview()', 'employee cannot open the overview', 'not allowed');
select test.eq(test.count_rows(format('select 1 from public.hr_work_hours_summary(%L, %L, %L)', pg_temp.d('mon'), pg_temp.d('fri'), 'day')), 1::bigint, 'employee sees own hours');
select test.eq(test.count_rows(format('select 1 from public.hr_work_hours_vs_attendance(%L, %L)', pg_temp.d('mon'), pg_temp.d('fri'))), 1::bigint, 'employee compares only own hours');
select test.throws(format('select * from public.hr_work_hours_summary(%L, %L, %L)', pg_temp.d('fri'), pg_temp.d('mon'), 'day'), 'invalid range rejected', 'valid date range');
select pg_temp.su('emp2');
select test.eq(test.count_rows(format('select 1 from public.hr_completed_work(%L, %L)', pg_temp.d('mon'), pg_temp.d('fri'))), 0::bigint, 'employee cannot see colleagues'' work');
select test.eq(test.count_rows('select 1 from public.hr_daily_report_versions'), 0::bigint, 'employee cannot see colleagues'' versions');

-- =====================================================================
-- Project Tracker hook
-- =====================================================================
select pg_temp.su('hr');
select test.throws($q$select public.hr_sync_tracker_project('PT-1', 'PT1', 'Tracker project')$q$, 'tracker sync is service-role only', 'Project Tracker');
select test.as_service();
select test.ok(public.hr_sync_tracker_project('PT-1', 'PT1', 'Tracker project') is not null, 'service role syncs a tracker project');
select test.eq(public.hr_sync_tracker_project('PT-1', 'PT1', 'Tracker project v2'), (select id from public.hr_projects where external_ref = 'PT-1'), 'tracker sync is idempotent');
select test.throws($q$select public.hr_sync_tracker_project('PT-2', 'M8A', 'Clash')$q$, 'tracker sync does not overwrite HRMS projects', 'already exists');
select test.as_owner();
