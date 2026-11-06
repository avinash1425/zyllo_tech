-- My Tasks & Projects (migration 131): progress %, update history, notes,
-- blocked notifications, assignment notifications, closed projects, RLS.
-- Synthetic data only. Runs inside a transaction that the runner rolls back.

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated, anon, service_role;

create or replace function pg_temp.su(p_k text) returns void language plpgsql as $$
begin
  perform test.as_owner();
  perform test.as_user(test.user_of((select v from t_ids where k = p_k)));
end $$;
create or replace function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;

do $$
begin
  insert into t_ids values ('hr',   test.make_employee('tp.hr@test.local', 'Hari', null, array['hr_admin']));
  insert into t_ids values ('pm',   test.make_employee('tp.pm@test.local', 'Priya', null, array['manager','employee']));
  insert into t_ids values ('mgr',  test.make_employee('tp.mgr@test.local', 'Meera', null, array['manager','employee']));
  insert into t_ids values ('emp1', test.make_employee('tp.emp1@test.local', 'Esha', (select v from t_ids where k = 'mgr')));
  insert into t_ids values ('emp2', test.make_employee('tp.emp2@test.local', 'Elio'));
end $$;

-- ---- fixtures (HR)
select pg_temp.su('hr');
insert into public.hr_projects (code, name, manager_employee_id) values ('TPA', 'Task Progress A', pg_temp.id('pm'));
insert into public.hr_projects (code, name) values ('TPB', 'Task Progress B');
insert into t_ids select 'pa', id from public.hr_projects where code = 'TPA';
insert into t_ids select 'pb', id from public.hr_projects where code = 'TPB';
insert into public.hr_project_members (project_id, employee_id, role) values
  (pg_temp.id('pa'), pg_temp.id('emp1'), 'developer'), (pg_temp.id('pb'), pg_temp.id('emp1'), 'developer'),
  (pg_temp.id('pa'), pg_temp.id('emp2'), 'developer');
insert into public.hr_tasks (project_id, assignee_id, title, priority, start_date, due_date)
values (pg_temp.id('pa'), pg_temp.id('emp1'), 'Design schema', 'high', current_date, current_date + 5);
insert into public.hr_tasks (project_id, assignee_id, title) values (pg_temp.id('pb'), pg_temp.id('emp1'), 'Write tests');
insert into public.hr_tasks (project_id, assignee_id, title) values (pg_temp.id('pa'), pg_temp.id('emp2'), 'Other person task');
insert into t_ids select 't1', id from public.hr_tasks where title = 'Design schema';
insert into t_ids select 't2', id from public.hr_tasks where title = 'Write tests';
insert into t_ids select 't3', id from public.hr_tasks where title = 'Other person task';

select test.throws(format($q$insert into public.hr_tasks (project_id, title, start_date, due_date) values (%L, 'Bad dates', current_date, current_date - 1)$q$, pg_temp.id('pa')),
  'due date before start date is rejected', 'hr_tasks_dates_valid');

select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications where recipient_user_id = test.user_of(pg_temp.id('emp1')) and type = 'tasks.assigned' and entity_id = pg_temp.id('t1')::text),
  'assignee is notified of a new task');

-- ---- employee posts updates
select pg_temp.su('emp1');
select test.eq((public.hr_post_my_task_update(pg_temp.id('t1'), null, 40, 'Tables drafted') ->> 'status'), 'in_progress', 'progress alone moves a todo task to in progress');
select test.eq((select progress_pct from public.hr_tasks where id = pg_temp.id('t1')), 40::smallint, 'progress stored');
select test.ok((select last_update_at is not null from public.hr_tasks where id = pg_temp.id('t1')), 'last_update_at set');
select test.eq((select note from public.hr_task_updates where task_id = pg_temp.id('t1') order by created_at desc limit 1), 'Tables drafted', 'note recorded with the change');
select test.eq((select new_progress from public.hr_task_updates where task_id = pg_temp.id('t1') order by created_at desc limit 1), 40::smallint, 'progress change recorded');

select test.eq((public.hr_post_my_task_update(pg_temp.id('t1'), null, null, 'Waiting for review') ->> 'progress_pct'), '40', 'note-only update keeps progress');
select test.eq(test.count_rows(format('select 1 from public.hr_task_updates where task_id = %L', pg_temp.id('t1'))), 2::bigint, 'note-only update adds a history row');

select test.throws(format('select public.hr_post_my_task_update(%L, null, null, null)', pg_temp.id('t1')), 'empty update rejected', 'Nothing to update');
select test.throws(format('select public.hr_post_my_task_update(%L, %L, null, null)', pg_temp.id('t1'), 'blocked'), 'blocked needs a note', 'blocking');
select test.throws(format('select public.hr_post_my_task_update(%L, %L, 100, null)', pg_temp.id('t1'), 'in_progress'), '100 percent but not done rejected', 'Mark it Done');
select test.throws(format('select public.hr_post_my_task_update(%L, null, 101, null)', pg_temp.id('t1')), 'progress over 100 rejected', 'between 0 and 100');
select test.throws(format('select public.hr_post_my_task_update(%L, %L, null, null)', pg_temp.id('t1'), 'paused'), 'unknown status rejected', 'Unknown task status');
select test.throws(format('select public.hr_post_my_task_update(%L, %L, null, null)', pg_temp.id('t3'), 'done'), 'cannot update someone else''s task', 'not found');

select public.hr_post_my_task_update(pg_temp.id('t1'), 'blocked', null, 'API credentials missing');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications where recipient_user_id = test.user_of(pg_temp.id('pm')) and type = 'tasks.blocked'),
  'project manager notified when a task is blocked');
select test.ok(not exists (select 1 from public.hr_notifications where recipient_user_id = test.user_of(pg_temp.id('mgr')) and type = 'tasks.blocked'),
  'reporting manager not notified when a project manager exists');

select pg_temp.su('emp1');
select public.hr_post_my_task_update(pg_temp.id('t2'), 'blocked', null, 'Need test data');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications where recipient_user_id = test.user_of(pg_temp.id('mgr')) and type = 'tasks.blocked'),
  'reporting manager notified when the project has no manager');

select pg_temp.su('emp1');
select test.eq((public.hr_post_my_task_update(pg_temp.id('t1'), 'done', 60, null) ->> 'progress_pct'), '100', 'done forces 100 percent');
select test.ok((select completed_at is not null from public.hr_tasks where id = pg_temp.id('t1')), 'completed_at set on done');
select test.eq((public.hr_post_my_task_update(pg_temp.id('t1'), 'in_progress', null, 'Review found a bug') ->> 'progress_pct'), '99', 'reopening without progress sets 99 percent');
select test.eq((public.hr_post_my_task_update(pg_temp.id('t1'), null, 100, null) ->> 'status'), 'done', 'progress 100 marks the task done');

-- legacy status RPC still works and is recorded
select public.hr_update_my_task_status(pg_temp.id('t2'), 'in_progress');
select test.eq((select new_status from public.hr_task_updates where task_id = pg_temp.id('t2') order by created_at desc, id limit 1), 'in_progress', 'legacy status RPC change recorded in history');
select test.eq(public.hr_update_my_task_status(pg_temp.id('t2'), 'done') ->> 'progress_pct', '100', 'legacy done sets 100 percent');

-- activity feed
select test.ok((select count(*) from public.hr_my_task_activity(50)) >= 6, 'activity feed lists my task updates');
select test.eq((select author_name from public.hr_my_task_activity(1)), 'You', 'own updates labelled You');

-- ---- history is read-only and scoped
select test.throws(format($q$insert into public.hr_task_updates (task_id, note) values (%L, 'forged')$q$, pg_temp.id('t1')), 'employee cannot write history directly', 'permission denied');
select test.throws(format($q$update public.hr_task_updates set note = 'edited' where task_id = %L$q$, pg_temp.id('t1')), 'employee cannot edit history', 'permission denied');
select pg_temp.su('emp2');
select test.eq(test.count_rows(format('select 1 from public.hr_task_updates where task_id = %L', pg_temp.id('t1'))), 0::bigint, 'other employee cannot see my task history');
select test.eq((select count(*) from public.hr_my_task_activity(50)), 0::bigint, 'other employee activity feed excludes my tasks');
select pg_temp.su('mgr');
select test.ok(test.count_rows(format('select 1 from public.hr_task_updates where task_id = %L', pg_temp.id('t1'))) > 0, 'reporting manager sees team member task history');

-- ---- HR edits are recorded; closed projects refuse updates
select pg_temp.su('hr');
update public.hr_tasks set status = 'todo' where id = pg_temp.id('t1');
select test.eq((select progress_pct from public.hr_tasks where id = pg_temp.id('t1')), 99::smallint, 'HR reopening a done task leaves 99 percent');
select test.ok(exists (select 1 from public.hr_task_updates where task_id = pg_temp.id('t1') and author_employee_id = pg_temp.id('hr') and new_status = 'todo'),
  'HR status edit recorded with HR as author');
update public.hr_tasks set assignee_id = pg_temp.id('emp2') where id = pg_temp.id('t2');
select test.as_owner();
select test.ok(exists (select 1 from public.hr_notifications where recipient_user_id = test.user_of(pg_temp.id('emp2')) and type = 'tasks.assigned' and entity_id = pg_temp.id('t2')::text),
  'reassignment notifies the new assignee');

select pg_temp.su('hr');
update public.hr_projects set status = 'completed' where id = pg_temp.id('pa');
select pg_temp.su('emp1');
select test.throws(format('select public.hr_post_my_task_update(%L, null, 50, null)', pg_temp.id('t1')), 'updates refused on a completed project', 'closed');
