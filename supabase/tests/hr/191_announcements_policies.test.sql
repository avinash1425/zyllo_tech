-- Module 13 — Announcements & Policies: handbook category, progress,
-- recipients, throttled announcement reminders, access control.
-- Synthetic data only. Runs inside a transaction that the runner rolls back.

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated, anon, service_role;
create or replace function pg_temp.id(p text) returns uuid language sql as $$ select v from t_ids where k = p $$;
create or replace function pg_temp.uid(p text) returns uuid language sql as $$ select v from t_ids where k = 'u:' || p $$;
create or replace function pg_temp.login(p text) returns void language sql as $$ select test.as_user(pg_temp.uid(p)) $$;

do $$
declare eng uuid; ops uuid;
begin
  insert into public.hr_departments (code, name) values ('ENG', 'Engineering') returning id into eng;
  insert into public.hr_departments (code, name) values ('OPS', 'Operations') returning id into ops;
  insert into t_ids values ('eng', eng), ('ops', ops);
  insert into public.hr_roles (key, name) values ('ann_auditor', 'Announcement auditor');
  insert into public.hr_role_permissions values ('ann_auditor', 'announcements.view_all');
  insert into t_ids values ('hr',      test.make_employee('hr@test.local', 'Hira', null, array['hr_admin']));
  insert into t_ids values ('mgr',     test.make_employee('mgr@test.local', 'Mona', null, array['manager','employee']));
  insert into t_ids values ('emp1',    test.make_employee('emp1@test.local', 'Eli', null, array['employee'], 'full_time', eng));
  insert into t_ids values ('emp2',    test.make_employee('emp2@test.local', 'Ezra', null, array['employee'], 'full_time', ops));
  insert into t_ids values ('auditor', test.make_employee('auditor@test.local', 'Ada', null, array['ann_auditor']));
  insert into t_ids select 'u:' || k, test.user_of(v) from t_ids where k in ('hr','mgr','emp1','emp2','auditor');
end $$;

-- ---- handbook is a policy category
select pg_temp.login('hr');
select (public.hr_save_policy(null, jsonb_build_object('title', 'Employee Handbook', 'category', 'handbook', 'content', 'Welcome to Zyllo Tech.',
                                                         'requires_acknowledgement', true)) ->> 'policy_id') as pol \gset
insert into t_ids values ('handbook', :'pol');
select test.eq((select category from public.hr_policies where id = pg_temp.id('handbook')), 'handbook', 'handbook category accepted');
select test.throws($q$select public.hr_save_policy(null, '{"title": "Bad", "category": "nonsense", "content": "x"}'::jsonb)$q$, 'unknown category rejected', 'Unknown policy category');
select test.throws($q$update public.hr_policies set category = 'nonsense' where title = 'Employee Handbook'$q$, 'policies are not written directly', 'permission denied');
select test.as_owner();
select test.throws($q$update public.hr_policies set category = 'nonsense' where title = 'Employee Handbook'$q$, 'check constraint rejects unknown category', 'check');
select pg_temp.login('hr');
select public.hr_publish_policy(pg_temp.id('handbook'), null);
select pg_temp.login('emp1');
select test.eq(test.count_rows($q$select 1 from public.hr_my_pending_acknowledgements() where subject_type = 'policy'$q$), 1::bigint, 'handbook awaits employee acknowledgement');
select test.ok(public.hr_acknowledge_policy(pg_temp.id('handbook')) is not null, 'employee acknowledges handbook');

-- ---- announcements: progress + recipients
select pg_temp.login('hr');
insert into public.hr_announcements (title, body, requires_acknowledgement) values ('Office rules', 'Please read.', true) returning id as v \gset
insert into t_ids values ('ack', :'v');
insert into public.hr_announcements (title, body, audience_type, audience_ids) values ('Eng sync', 'Friday.', 'departments', array[pg_temp.id('eng')]) returning id as v \gset
insert into t_ids values ('eng_ann', :'v');
select test.eq((select audience from public.hr_announcement_progress() where announcement_id = pg_temp.id('eng_ann')), 1::bigint,
  'draft progress shows audience reach before publishing');
select public.hr_publish_announcement(pg_temp.id('ack'));
select public.hr_publish_announcement(pg_temp.id('eng_ann'));

select pg_temp.login('emp1');
select test.throws('select * from public.hr_announcement_progress()', 'employee cannot read progress', 'not allowed');
select test.throws(format('select * from public.hr_announcement_recipients(%L)', pg_temp.id('ack')), 'employee cannot read recipients', 'not allowed');
select test.throws(format('select public.hr_remind_announcement(%L)', pg_temp.id('ack')), 'employee cannot send reminders', 'not allowed');
select test.throws('insert into public.hr_announcement_reminders (announcement_id, employee_id) values (gen_random_uuid(), gen_random_uuid())',
  'reminder ledger cannot be written directly', 'permission denied');
select public.hr_acknowledge_announcement(pg_temp.id('ack'));
select pg_temp.login('emp2');
select public.hr_mark_announcement_read(pg_temp.id('ack'));

select pg_temp.login('hr');
select audience, read, acknowledged from public.hr_announcement_progress() where announcement_id = pg_temp.id('ack') \gset
select test.ok(:audience = 5 and :read = 2 and :acknowledged = 1, 'progress: audience 5, read 2, acknowledged 1');
select test.eq(test.count_rows(format('select 1 from public.hr_announcement_recipients(%L)', pg_temp.id('ack'))), 5::bigint, 'recipients lists the audience');
select test.eq(test.count_rows(format('select 1 from public.hr_announcement_recipients(%L)', pg_temp.id('eng_ann'))), 1::bigint, 'recipients follows the department audience');
select test.ok((select acknowledged_at is not null from public.hr_announcement_recipients(pg_temp.id('ack')) where employee_id = pg_temp.id('emp1')),
  'recipient row carries the acknowledgement time');

-- ---- reminders
select test.throws(format('select public.hr_remind_announcement(%L)', pg_temp.id('eng_ann')), 'no reminders when acknowledgement is not required', 'does not require');
select test.eq(public.hr_remind_announcement(pg_temp.id('ack')), 4, 'reminds every unacknowledged portal user (emp1 already acknowledged)');
select test.eq(public.hr_remind_announcement(pg_temp.id('ack')), 0, 'reminders are throttled');
select test.as_owner();
select test.eq((select count(*) from public.hr_notifications where type = 'acknowledgement_reminder' and entity_id = pg_temp.id('ack')::text), 4::bigint,
  'one reminder notification per pending employee');
select test.ok(not exists (select 1 from public.hr_notifications where type = 'acknowledgement_reminder' and recipient_user_id = pg_temp.uid('emp1')),
  'acknowledged employee is not reminded');
update public.hr_announcement_reminders set reminded_at = now() - interval '2 days';   -- time passes
select pg_temp.login('hr');
select test.eq(public.hr_remind_announcement(pg_temp.id('ack'), pg_temp.id('emp2')), 1, 'remind one employee after the throttle window');
select test.eq((select reminder_count from public.hr_announcement_recipients(pg_temp.id('ack')) where employee_id = pg_temp.id('emp2')), 2::bigint,
  'recipient row counts reminders');

select pg_temp.login('auditor');
select test.eq(test.count_rows('select 1 from public.hr_announcement_reminders'), 5::bigint, 'view_all can read the reminder ledger');
select test.ok(exists (select 1 from public.hr_announcement_progress()), 'view_all can read progress');
select test.throws(format('select public.hr_remind_announcement(%L)', pg_temp.id('ack')), 'view_all cannot send reminders', 'not allowed');

select pg_temp.login('hr');
select public.hr_archive_announcement(pg_temp.id('ack'));
select test.throws(format('select public.hr_remind_announcement(%L)', pg_temp.id('ack')), 'archived announcement cannot be reminded', 'Only live');
