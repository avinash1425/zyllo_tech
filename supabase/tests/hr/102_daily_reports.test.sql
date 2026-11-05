-- Daily work reports: projects/tasks visibility, draft editing, submit and
-- review workflow, finalized immutability, compliance, reminders, blockers.
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
  insert into t_ids values ('hr',   test.make_employee('dr.hr@test.local', 'Hari', null, array['hr_admin']));
  insert into t_ids values ('mgr',  test.make_employee('dr.mgr@test.local', 'Meera', null, array['manager','employee']));
  insert into t_ids values ('mgr2', test.make_employee('dr.mgr2@test.local', 'Mateo', null, array['manager','employee']));
  insert into t_ids values ('emp1', test.make_employee('dr.emp1@test.local', 'Esha', (select v from t_ids where k='mgr')));
  insert into t_ids values ('emp3', test.make_employee('dr.emp3@test.local', 'Eric', (select v from t_ids where k='mgr')));
  insert into t_ids values ('emp2', test.make_employee('dr.emp2@test.local', 'Elio'));
  mon := hr_private.business_today() - (extract(isodow from hr_private.business_today())::int - 1) - 7;
  insert into t_d values ('mon', mon), ('tue', mon + 1), ('wed', mon + 2), ('sat', mon + 5);
end $$;

-- ---- projects & tasks managed by daily_reports.manage (HR)
select pg_temp.su('hr');
insert into public.hr_projects (code, name, client) values ('ALPHA', 'Alpha Portal', 'Example Client One'), ('BETA', 'Beta App', 'Example Client Two');
insert into t_ids select 'p1', id from public.hr_projects where code = 'ALPHA';
insert into t_ids select 'p2', id from public.hr_projects where code = 'BETA';
insert into public.hr_project_members (project_id, employee_id, role) values (pg_temp.id('p1'), pg_temp.id('emp1'), 'developer'),
  (pg_temp.id('p2'), pg_temp.id('emp2'), 'developer');
insert into public.hr_tasks (project_id, assignee_id, title, priority) values (pg_temp.id('p1'), pg_temp.id('emp1'), 'Build login page', 'high');
insert into public.hr_tasks (project_id, assignee_id, title) values (pg_temp.id('p2'), pg_temp.id('emp2'), 'Write API docs');
insert into t_ids select 't1', id from public.hr_tasks where title = 'Build login page';
insert into t_ids select 't2', id from public.hr_tasks where title = 'Write API docs';

select pg_temp.su('emp1');
select test.eq(test.count_rows('select 1 from public.hr_projects'), 1::bigint, 'employee sees only projects they belong to');
select test.eq(test.count_rows('select 1 from public.hr_tasks'), 1::bigint, 'employee sees only tasks assigned to them');
select test.throws($q$insert into public.hr_projects (code, name) values ('ROGUE', 'Rogue project')$q$, 'employee cannot create projects', 'row-level security');
select test.eq(public.hr_update_my_task_status(pg_temp.id('t1'), 'in_progress') ->> 'status', 'in_progress', 'assignee updates own task status');
select test.throws(format('select public.hr_update_my_task_status(%L, %L)', pg_temp.id('t2'), 'done'), 'cannot update someone else''s task', 'not found');
select pg_temp.su('mgr');
select test.eq(test.count_rows('select 1 from public.hr_projects'), 1::bigint, 'manager sees projects of team members');

-- ---- drafts
select pg_temp.su('emp1');
insert into public.hr_daily_reports (employee_id, report_date, status, blockers, pending_work)
values (hr_private.current_employee_id(), pg_temp.d('mon'), 'reviewed', 'Waiting on API keys from client', 'Finish login form');
insert into t_ids select 'r1', id from public.hr_daily_reports where report_date = pg_temp.d('mon');
select test.eq((select status from public.hr_daily_reports where id = pg_temp.id('r1')), 'draft', 'client-supplied status forced to draft');
insert into public.hr_daily_report_items (report_id, project_id, task_id, activity, hours, progress_pct)
values (pg_temp.id('r1'), pg_temp.id('p1'), pg_temp.id('t1'), 'Development', 4, 40);
insert into public.hr_daily_report_items (report_id, activity, hours) values (pg_temp.id('r1'), 'Team meeting', 3.5);
select test.eq((select total_hours from public.hr_daily_reports where id = pg_temp.id('r1')), 7.50::numeric, 'total hours computed from items');
select test.throws(format('insert into public.hr_daily_report_items (report_id, project_id, activity, hours) values (%L, %L, %L, 1)', pg_temp.id('r1'), pg_temp.id('p2'), 'Other work'),
  'item for a project the employee is not a member of rejected', 'not a member');
select test.throws(format('insert into public.hr_daily_report_items (report_id, activity, hours) values (%L, %L, 25)', pg_temp.id('r1'), 'Too long'),
  'item over 24 hours rejected', 'check constraint');
select test.throws(format('insert into public.hr_daily_report_items (report_id, activity, hours) values (%L, %L, 20)', pg_temp.id('r1'), 'Overflow'),
  'daily total over 24 hours rejected', 'exceed 24');
select test.throws($q$insert into public.hr_daily_reports (employee_id, report_date) values (hr_private.current_employee_id(), current_date + 10)$q$,
  'future-dated report rejected', 'future');
select test.throws(format('insert into public.hr_daily_reports (employee_id, report_date) values (%L, %L)', pg_temp.id('emp3'), pg_temp.d('mon')),
  'cannot create a report for someone else', 'row-level security');
insert into public.hr_daily_reports (employee_id, report_date) values (hr_private.current_employee_id(), pg_temp.d('tue'));
insert into t_ids select 'r2', id from public.hr_daily_reports where report_date = pg_temp.d('tue');
select test.throws(format('select public.hr_submit_daily_report(%L)', pg_temp.id('r2')), 'submit without items rejected', 'at least one');
select test.throws(format('update public.hr_daily_reports set status = %L where id = %L', 'submitted', pg_temp.id('r2')), 'status cannot be changed directly', 'submit / review');
delete from public.hr_daily_reports where id = pg_temp.id('r2');
select test.eq(test.count_rows('select 1 from public.hr_daily_reports'), 1::bigint, 'owner can delete own draft');

select pg_temp.su('mgr');
select test.eq(test.count_rows('select 1 from public.hr_daily_reports'), 0::bigint, 'manager cannot see team drafts');

-- ---- submit; finalized reports are not editable by the employee
select pg_temp.su('emp1');
select test.eq(public.hr_submit_daily_report(pg_temp.id('r1')) ->> 'status', 'submitted', 'employee submits report');
select test.throws(format('select public.hr_submit_daily_report(%L)', pg_temp.id('r1')), 'double submit rejected', 'already been submitted');
update public.hr_daily_reports set pending_work = 'tampered' where id = pg_temp.id('r1');
select test.eq((select pending_work from public.hr_daily_reports where id = pg_temp.id('r1')), 'Finish login form', 'submitted report not editable');
select test.throws(format('insert into public.hr_daily_report_items (report_id, activity, hours) values (%L, %L, 1)', pg_temp.id('r1'), 'Late add'),
  'cannot add items to submitted report', 'row-level security');
delete from public.hr_daily_report_items where report_id = pg_temp.id('r1');
select test.eq(test.count_rows(format('select 1 from public.hr_daily_report_items where report_id = %L', pg_temp.id('r1'))), 2::bigint, 'cannot delete items of submitted report');
delete from public.hr_daily_reports where id = pg_temp.id('r1');
select test.eq(test.count_rows('select 1 from public.hr_daily_reports'), 1::bigint, 'cannot delete submitted report');
select test.throws(format('select public.hr_review_daily_report(%L, %L)', pg_temp.id('r1'), 'reviewed'), 'employee cannot review own report', 'own report');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications where recipient_user_id = test.user_of(pg_temp.id('mgr')) and type = 'daily_reports.submitted'),
  'manager notified on submit');

-- ---- review workflow
select pg_temp.su('mgr2');
select test.eq(test.count_rows('select 1 from public.hr_daily_reports'), 0::bigint, 'unrelated manager cannot see report');
select test.throws(format('select public.hr_review_daily_report(%L, %L)', pg_temp.id('r1'), 'reviewed'), 'non-team manager cannot review', 'not allowed');
select pg_temp.su('mgr');
select test.eq(test.count_rows('select 1 from public.hr_daily_report_items'), 2::bigint, 'manager sees items of submitted team report');
select test.eq(public.hr_review_daily_report(pg_temp.id('r1'), 'clarification', 'Which API keys?') ->> 'status', 'under_review', 'clarification moves to under_review');
select test.throws(format('select public.hr_review_daily_report(%L, %L)', pg_temp.id('r1'), 'revision_requested'), 'revision request needs a comment', 'comment is required');
select test.eq(public.hr_review_daily_report(pg_temp.id('r1'), 'revision_requested', 'Add hours split for the meeting') ->> 'status', 'revision_requested', 'revision requested');
select pg_temp.su('emp1');
select public.hr_reply_daily_report(pg_temp.id('r1'), 'Keys for the payment sandbox.');
update public.hr_daily_reports set tomorrow_plan = 'Integrate sandbox keys' where id = pg_temp.id('r1');
select test.eq((select tomorrow_plan from public.hr_daily_reports where id = pg_temp.id('r1')), 'Integrate sandbox keys', 'employee edits report after revision request');
update public.hr_daily_report_items set hours = 2.5 where report_id = pg_temp.id('r1') and activity = 'Team meeting';
select test.eq((select total_hours from public.hr_daily_reports where id = pg_temp.id('r1')), 6.50::numeric, 'total hours recomputed after item edit');
select test.eq(public.hr_submit_daily_report(pg_temp.id('r1')) ->> 'status', 'submitted', 'employee resubmits');
select pg_temp.su('mgr');
select test.eq(public.hr_review_daily_report(pg_temp.id('r1'), 'reviewed') ->> 'status', 'reviewed', 'manager marks reviewed');
select test.throws(format('select public.hr_review_daily_report(%L, %L)', pg_temp.id('r1'), 'reviewed'), 'cannot review twice', 'not awaiting review');
select test.eq(public.hr_review_daily_report(pg_temp.id('r1'), 'comment', 'Nice work') ->> 'status', 'reviewed', 'comment allowed on reviewed report');
select test.eq(test.count_rows(format('select 1 from public.hr_daily_report_reviews where report_id = %L', pg_temp.id('r1'))), 7::bigint, 'full review history recorded');
select pg_temp.su('emp1');
update public.hr_daily_reports set blockers = 'changed' where id = pg_temp.id('r1');
select test.eq((select blockers from public.hr_daily_reports where id = pg_temp.id('r1')), 'Waiting on API keys from client', 'reviewed report not editable');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications where recipient_user_id = test.user_of(pg_temp.id('emp1')) and type = 'daily_reports.revision_requested'),
  'employee notified of revision request');

-- ---- compliance
select pg_temp.su('hr');
select test.eq(test.count_rows(format('select 1 from public.hr_missing_daily_reports(%L)', pg_temp.d('mon'))), 5::bigint,
  'HR sees all employees missing a report (everyone except emp1)');
select test.eq(test.count_rows(format('select 1 from public.hr_missing_daily_reports(%L)', pg_temp.d('sat'))), 0::bigint, 'weekend is not a reporting day');
select pg_temp.su('mgr');
select test.eq((select array_agg(employee_id) from public.hr_missing_daily_reports(pg_temp.d('mon'))), array[pg_temp.id('emp3')], 'manager sees only missing team members');
select pg_temp.su('emp2');
select test.throws(format('select * from public.hr_missing_daily_reports(%L)', pg_temp.d('mon')), 'employee cannot view compliance', 'not allowed');
select test.throws(format('select public.hr_generate_daily_report_reminders(%L)', pg_temp.d('mon')), 'employee cannot generate reminders', 'not allowed');
select pg_temp.su('hr');
select test.eq(public.hr_generate_daily_report_reminders(pg_temp.d('mon')), 5, 'one reminder per missing employee');
select test.eq(public.hr_generate_daily_report_reminders(pg_temp.d('mon')), 0, 'reminders are idempotent per date');
select test.as_service();
select test.eq(public.hr_generate_daily_report_reminders(pg_temp.d('tue')), 6, 'service role scheduler can generate reminders');
select test.as_owner();
select test.eq((select count(*) from public.hr_notifications where recipient_user_id = test.user_of(pg_temp.id('emp2')) and type = 'daily_reports.reminder'), 2::bigint,
  'employee received one reminder per missing date');
update public.hr_settings set value = value || '{"reminder_enabled": false}' where key = 'daily_reports';
select pg_temp.su('hr');
select test.eq(public.hr_generate_daily_report_reminders(pg_temp.d('wed')), 0, 'disabled reminders generate nothing');

-- ---- blockers
select pg_temp.su('mgr');
select test.eq((select project_names from public.hr_daily_report_blockers(pg_temp.d('mon') - 7, hr_private.business_today())), 'Alpha Portal', 'blockers listed with project');
select test.eq(test.count_rows(format('select 1 from public.hr_daily_report_blockers(%L, %L, null, %L)', pg_temp.d('mon') - 7, hr_private.business_today(), pg_temp.id('p2'))), 0::bigint,
  'blockers filtered by project');
select pg_temp.su('mgr2');
select test.eq(test.count_rows(format('select 1 from public.hr_daily_report_blockers(%L, %L)', pg_temp.d('mon') - 7, hr_private.business_today())), 0::bigint,
  'blockers scoped to caller');
select test.as_owner();
