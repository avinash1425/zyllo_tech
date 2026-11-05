-- Announcements: drafts, audience targeting, publish fan-out (idempotent),
-- scheduling, immutability of published content, receipts, stats, archive.
-- Synthetic data only. Runs inside a transaction that the runner rolls back.

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated, anon, service_role;
create or replace function pg_temp.id(p text) returns uuid language sql as $$ select v from t_ids where k = p $$;
create or replace function pg_temp.uid(p text) returns uuid language sql as $$ select v from t_ids where k = 'u:' || p $$;
create or replace function pg_temp.login(p text) returns void language sql as $$ select test.as_user(pg_temp.uid(p)) $$;
create or replace function pg_temp.ann(p text) returns uuid language sql as $$ select v from t_ids where k = 'a:' || p $$;

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
  insert into t_ids values ('intern',  test.make_employee('intern@test.local', 'Ira', null, array['intern'], 'intern', eng));
  insert into t_ids values ('auditor', test.make_employee('auditor@test.local', 'Ada', null, array['ann_auditor']));
  insert into t_ids values ('nopor',   test.make_employee('nopor@test.local', 'Nia', null, array['employee'], 'full_time', ops));
  update public.hr_employees set portal_access = false where id = (select v from t_ids where k='nopor');
  insert into t_ids select 'u:' || k, test.user_of(v) from t_ids where k in ('hr','mgr','emp1','emp2','intern','auditor','nopor');
end $$;

-- ---- only announcements.manage can author
select test.as_anon();
select test.throws('select * from public.hr_announcements', 'anon cannot read announcements', 'permission denied');
select test.as_owner();
select pg_temp.login('emp1');
select test.throws($q$insert into public.hr_announcements (title, body) values ('Hack', 'x')$q$, 'employee cannot create announcements', 'row-level security');
select pg_temp.login('hr');
select test.throws($q$insert into public.hr_announcements (title, body, status) values ('Direct', 'x', 'published')$q$,
  'cannot insert as published directly', 'start as drafts');
insert into public.hr_announcements (title, body, category, requires_acknowledgement, send_email)
values ('Updated leave policy', 'Please read the new leave policy.', 'policy', true, true) returning id as v \gset
insert into t_ids values ('a:all', :'v');
insert into public.hr_announcements (title, body, audience_type, audience_ids)
values ('Engineering offsite', 'Offsite on Friday.', 'departments', array[pg_temp.id('eng')]) returning id as v \gset
insert into t_ids values ('a:eng', :'v');
insert into public.hr_announcements (title, body, audience_type, audience_codes)
values ('Intern demo day', 'Show your work.', 'employment_types', array['intern']) returning id as v \gset
insert into t_ids values ('a:int', :'v');
insert into public.hr_announcements (title, body, publish_at)
values ('Holiday calendar', 'Next year holidays.', now() + interval '1 day') returning id as v \gset
insert into t_ids values ('a:future', :'v');
insert into public.hr_announcements (title, body, audience_type) values ('Empty audience', 'x', 'employees') returning id as v \gset
insert into t_ids values ('a:empty', :'v');
update public.hr_announcements set body = 'Please read the updated leave policy.' where id = pg_temp.ann('all');
select test.ok(true, 'draft content is editable');

select pg_temp.login('emp1');
select test.eq(test.count_rows('select 1 from public.hr_announcements'), 0::bigint, 'employees cannot see drafts');
select test.throws(format('select public.hr_publish_announcement(%L)', pg_temp.ann('all')), 'employee cannot publish', 'not allowed');
select pg_temp.login('auditor');
select test.eq(test.count_rows('select 1 from public.hr_announcements'), 5::bigint, 'announcements.view_all sees drafts');

-- ---- publish & fan-out
select pg_temp.login('hr');
select test.throws(format('select public.hr_publish_announcement(%L)', pg_temp.ann('empty')), 'audience required', 'Choose who');
select public.hr_publish_announcement(pg_temp.ann('all')) as r \gset
select test.eq((:'r'::jsonb ->> 'notified')::int, 6, 'publish notifies every portal-enabled active employee');
select test.eq((:'r'::jsonb ->> 'emails_queued')::int, 7, 'publish queues email for every active employee with a company email');
select test.as_owner();
select count(*) as notif_before from public.hr_notifications \gset
select count(*) as mail_before from public.hr_email_outbox \gset
select test.ok(not exists (select 1 from public.hr_notifications where recipient_user_id = pg_temp.uid('nopor')), 'no in-app notification without portal access');
select test.ok((select bool_and(status = 'queued') from public.hr_email_outbox where entity_id = pg_temp.ann('all')::text), 'emails are queued, never marked sent');
select pg_temp.login('hr');
select test.ok((public.hr_publish_announcement(pg_temp.ann('all')) ->> 'already_published')::boolean, 'publishing twice is a no-op');
select test.as_owner();
select test.eq((select count(*) from public.hr_notifications), :notif_before::bigint, 'no duplicate notifications');
select test.eq((select count(*) from public.hr_email_outbox), :mail_before::bigint, 'no duplicate emails');

select pg_temp.login('hr');
select test.throws(format('update public.hr_announcements set body = %L where id = %L', 'Changed', pg_temp.ann('all')),
  'published content cannot be edited', 'Archive it');
select test.throws(format('update public.hr_announcements set status = %L where id = %L', 'draft', pg_temp.ann('all')),
  'published announcement cannot be unpublished directly', 'cannot be edited');
select test.eq((public.hr_publish_announcement(pg_temp.ann('eng')) ->> 'notified')::int, 2, 'department audience: engineering employee + intern');
select test.eq((public.hr_publish_announcement(pg_temp.ann('int')) ->> 'notified')::int, 1, 'employment-type audience: interns only');

-- ---- audience visibility
select pg_temp.login('emp1');
select test.eq(test.count_rows('select 1 from public.hr_announcements'), 2::bigint, 'engineering employee sees all-staff + engineering');
select pg_temp.login('emp2');
select test.eq(test.count_rows('select 1 from public.hr_announcements'), 1::bigint, 'operations employee sees only all-staff');
select test.throws(format('select public.hr_mark_announcement_read(%L)', pg_temp.ann('eng')), 'cannot read an announcement outside audience', 'not found');
select pg_temp.login('intern');
select test.eq(test.count_rows('select 1 from public.hr_announcements'), 3::bigint, 'intern sees all-staff + department + intern-only');
select pg_temp.login('nopor');
select test.eq(test.count_rows('select 1 from public.hr_announcements'), 0::bigint, 'user without portal access sees nothing');

-- ---- scheduling
select pg_temp.login('hr');
select test.eq(public.hr_publish_announcement(pg_temp.ann('future')) ->> 'status', 'scheduled', 'future publish_at schedules');
update public.hr_announcements set title = 'Holiday calendar 2027' where id = pg_temp.ann('future');
select test.ok(true, 'scheduled announcement is still editable');
select test.throws(format('update public.hr_announcements set status = %L where id = %L', 'published', pg_temp.ann('future')),
  'cannot publish by direct update', 'Use Publish');
select pg_temp.login('emp1');
select test.eq(test.count_rows(format('select 1 from public.hr_announcements where id = %L', pg_temp.ann('future'))), 0::bigint,
  'scheduled announcement hidden before publish time');
select test.throws('select public.hr_process_scheduled_announcements()', 'employee cannot run the scheduler', 'not allowed');
select test.as_owner();
update public.hr_announcements set publish_at = now() - interval '1 minute' where id = pg_temp.ann('future');   -- time passes
select test.as_service();
select public.hr_process_scheduled_announcements() as s \gset
select test.eq((:'s'::jsonb ->> 'published')::int, 1, 'scheduler publishes due announcement');
select test.eq((:'s'::jsonb ->> 'notified')::int, 6, 'scheduler fans out notifications');
select test.eq((public.hr_process_scheduled_announcements() ->> 'published')::int, 0, 'scheduler is idempotent');
select test.as_owner();
select pg_temp.login('emp1');
select test.eq(test.count_rows(format('select 1 from public.hr_announcements where id = %L', pg_temp.ann('future'))), 1::bigint,
  'scheduled announcement visible after publishing');

-- ---- read & acknowledge
select public.hr_mark_announcement_read(pg_temp.ann('all'));
select test.throws(format('select public.hr_acknowledge_announcement(%L)', pg_temp.ann('eng')), 'ack only when required', 'does not require');
select test.ok(public.hr_acknowledge_announcement(pg_temp.ann('all')) is not null, 'employee acknowledges');
select test.ok(public.hr_acknowledge_announcement(pg_temp.ann('all')) is not null, 'acknowledging twice is harmless');
select test.eq(test.count_rows('select 1 from public.hr_announcement_receipts'), 1::bigint, 'employee sees own receipt only');
select test.eq(test.count_rows(format($q$select 1 from public.hr_notifications where entity_id = %L and read_at is null$q$, pg_temp.ann('all'))), 0::bigint,
  'reading marks the announcement notification read');
select test.throws($q$insert into public.hr_announcement_receipts (announcement_id, employee_id, acknowledged_at) select id, (select v from t_ids where k='emp2'), now() from public.hr_announcements limit 1$q$,
  'receipts cannot be forged', 'permission denied');
select test.throws(format('select public.hr_announcement_stats(%L)', pg_temp.ann('all')), 'employee cannot read stats', 'not allowed');
select pg_temp.login('emp2');
select public.hr_mark_announcement_read(pg_temp.ann('all'));
select pg_temp.login('hr');
select public.hr_announcement_stats(pg_temp.ann('all')) as st \gset
select test.ok((:'st'::jsonb ->> 'audience')::int = 7 and (:'st'::jsonb ->> 'read')::int = 2 and (:'st'::jsonb ->> 'acknowledged')::int = 1
               and (:'st'::jsonb ->> 'notified')::int = 6 and (:'st'::jsonb ->> 'emails_queued')::int = 7 and (:'st'::jsonb ->> 'emails_sent')::int = 0,
               'stats: audience 7, read 2, acknowledged 1, notified 6, queued 7, sent 0');

-- ---- archive & delete
select public.hr_archive_announcement(pg_temp.ann('all'));
select test.throws(format('select public.hr_publish_announcement(%L)', pg_temp.ann('all')), 'archived cannot be republished', 'archived');
delete from public.hr_announcements where id = pg_temp.ann('eng');
select test.eq(test.count_rows(format('select 1 from public.hr_announcements where id = %L', pg_temp.ann('eng'))), 1::bigint, 'published announcements cannot be deleted');
delete from public.hr_announcements where id = pg_temp.ann('empty');
select test.eq(test.count_rows(format('select 1 from public.hr_announcements where id = %L', pg_temp.ann('empty'))), 0::bigint, 'drafts can be deleted');
select pg_temp.login('emp1');
select test.eq(test.count_rows(format('select 1 from public.hr_announcements where id = %L', pg_temp.ann('all'))), 0::bigint, 'archived announcement hidden from employees');
select test.throws(format('select public.hr_acknowledge_announcement(%L)', pg_temp.ann('all')), 'cannot acknowledge archived announcement', 'not found');

-- ---- expiry
select test.as_owner();
update public.hr_announcements set expires_at = now() - interval '1 second', publish_at = now() - interval '1 hour' where id = pg_temp.ann('eng');
select pg_temp.login('emp1');
select test.eq(test.count_rows(format('select 1 from public.hr_announcements where id = %L', pg_temp.ann('eng'))), 0::bigint, 'expired announcement hidden');
select test.as_owner();
