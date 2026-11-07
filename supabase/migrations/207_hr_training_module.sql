-- =====================================================================
-- 207: Training Management module (trainers, programs, sessions,
--      enrollment + capacity/waitlist, attendance, completion with
--      evidence -> verification, certificates, expiry & renewal)
-- =====================================================================
-- Builds on the existing training tables of 115 (hr_training_categories,
-- hr_training_courses, hr_training_assignments) - no second training
-- system. Onboarding (130) keeps linking induction courses through
-- hr_link_onboarding_task, which creates an ordinary training assignment.
--
-- New tables
--   hr_training_trainers         internal employee OR external name
--   hr_training_programs         a named group of courses
--   hr_training_program_courses  program <-> course (ordered)
--   hr_training_sessions         dated runs of a course (venue / link,
--                                capacity, trainer). RPC-only writes.
--   hr_training_enrollments      employee seat in a session (enrolled,
--                                waitlisted, attended, absent, cancelled).
--                                RPC-only writes.
-- New columns
--   hr_training_courses:     trainer_id, content_url
--   hr_training_assignments: source (manual / program / session /
--     onboarding / renewal), program_id, renewal_of, evidence_note,
--     evidence_document_id, submitted_at, review_note, reviewed_by,
--     reviewed_at, certificate_number, certificate_issued_on
--
-- Assignment workflow (stored status of 115 is unchanged)
--   assigned -> in_progress           employee starts (hr_start_training)
--                                     or attends a session
--   assigned|in_progress -> completed + verified_at null
--                                     employee submits completion with
--                                     evidence (hr_submit_training_completion)
--                                     = "pending verification"
--   completed (unverified) -> completed + verified
--   completed (unverified) -> in_progress (returned with a reason)
--                                     HR / reporting-line manager only
--                                     (hr_review_training_completion);
--                                     never the employee themself
--   assigned|in_progress -> completed + verified
--                                     HR / manager records completion
--                                     (hr_complete_training, attendance)
--   assigned|in_progress -> cancelled (hr_cancel_training)
--   completed -> new assignment (source renewal, renewal_of = old id)
--                                     (hr_renew_training /
--                                     hr_generate_training_renewals)
-- Derived (not stored): overdue, pending verification, certificate
-- expiring / expired.
--
-- Separation of duties: every HR / manager action goes through
-- hr_private.can_manage_training_of (training.manage for anyone,
-- training.assign_team for the reporting line, never self).
--
-- Onboarding: the onboarding sync (130) now completes a linked onboarding
-- task only when the training completion is VERIFIED, so a self-reported
-- completion no longer closes an induction task by itself. Assignments
-- linked from onboarding are tagged source = 'onboarding'.
--
-- Requires 107, 115 and 130. Re-runnable. Existing rows are kept (the 4
-- seeded categories, courses, assignments).
-- =====================================================================

do $$
begin
  if to_regclass('public.hr_training_assignments') is null
     or to_regclass('public.hr_onboarding_tasks') is null
     or to_regclass('public.hr_documents') is null
     or to_regprocedure('hr_private.can_manage_training_of(uuid)') is null then
    raise exception '207_hr_training_module requires migrations 107 (documents), 115 (training) and 130 (onboarding)';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
create table if not exists public.hr_training_trainers (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid references public.hr_employees(id) on delete restrict,
  external_name text check (external_name is null or length(btrim(external_name)) between 2 and 120),
  organisation  text check (organisation is null or length(organisation) <= 120),
  expertise     text check (expertise is null or length(expertise) <= 500),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint hr_training_trainers_kind check ((employee_id is null) <> (external_name is null))
);
create unique index if not exists hr_training_trainers_employee on public.hr_training_trainers (employee_id) where employee_id is not null;

create table if not exists public.hr_training_programs (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z0-9_-]{2,20}$'),
  title       text not null check (length(btrim(title)) between 3 and 200),
  description text check (description is null or length(description) <= 4000),
  category_id uuid references public.hr_training_categories(id) on delete restrict,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.hr_training_program_courses (
  id         uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.hr_training_programs(id) on delete cascade,
  course_id  uuid not null references public.hr_training_courses(id) on delete restrict,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (program_id, course_id)
);

alter table public.hr_training_courses add column if not exists trainer_id uuid references public.hr_training_trainers(id) on delete set null;
alter table public.hr_training_courses add column if not exists content_url text;

create table if not exists public.hr_training_sessions (
  id            uuid primary key default gen_random_uuid(),
  course_id     uuid not null references public.hr_training_courses(id) on delete restrict,
  title         text check (title is null or length(btrim(title)) between 3 and 200),
  session_date  date not null,
  start_time    time,
  end_time      time,
  venue         text check (venue is null or length(venue) <= 200),
  meeting_url   text check (meeting_url is null or (meeting_url ~* '^https?://' and length(meeting_url) <= 500)),
  capacity      int check (capacity is null or capacity between 1 and 1000),
  trainer_id    uuid references public.hr_training_trainers(id) on delete set null,
  status        text not null default 'scheduled' check (status in ('scheduled','completed','cancelled')),
  notes         text check (notes is null or length(notes) <= 2000),
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 1000),
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint hr_training_sessions_times check (start_time is null or end_time is null or end_time > start_time)
);
create index if not exists hr_training_sessions_date on public.hr_training_sessions (session_date);
create index if not exists hr_training_sessions_course on public.hr_training_sessions (course_id);

create table if not exists public.hr_training_enrollments (
  id                   uuid primary key default gen_random_uuid(),
  session_id           uuid not null references public.hr_training_sessions(id) on delete restrict,
  employee_id          uuid not null references public.hr_employees(id) on delete restrict,
  assignment_id        uuid references public.hr_training_assignments(id) on delete set null,
  status               text not null default 'enrolled' check (status in ('enrolled','waitlisted','attended','absent','cancelled')),
  enrolled_by          uuid,
  enrolled_at          timestamptz not null default clock_timestamp(),
  attendance_marked_by uuid,
  attendance_marked_at timestamptz,
  cancel_reason        text check (cancel_reason is null or length(cancel_reason) <= 1000),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index if not exists hr_training_enrollments_active on public.hr_training_enrollments (session_id, employee_id) where status <> 'cancelled';
create index if not exists hr_training_enrollments_employee on public.hr_training_enrollments (employee_id);
create index if not exists hr_training_enrollments_session on public.hr_training_enrollments (session_id, status);

alter table public.hr_training_assignments add column if not exists source text not null default 'manual';
alter table public.hr_training_assignments add column if not exists program_id uuid references public.hr_training_programs(id) on delete set null;
alter table public.hr_training_assignments add column if not exists renewal_of uuid references public.hr_training_assignments(id) on delete set null;
alter table public.hr_training_assignments add column if not exists evidence_note text;
alter table public.hr_training_assignments add column if not exists evidence_document_id uuid references public.hr_documents(id) on delete set null;
alter table public.hr_training_assignments add column if not exists submitted_at timestamptz;
alter table public.hr_training_assignments add column if not exists review_note text;
alter table public.hr_training_assignments add column if not exists reviewed_by uuid;
alter table public.hr_training_assignments add column if not exists reviewed_at timestamptz;
alter table public.hr_training_assignments add column if not exists certificate_number text;
alter table public.hr_training_assignments add column if not exists certificate_issued_on date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hr_training_courses_content_url_check') then
    alter table public.hr_training_courses add constraint hr_training_courses_content_url_check
      check (content_url is null or (content_url ~* '^https?://' and length(content_url) <= 500));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hr_training_assignments_source_check') then
    alter table public.hr_training_assignments add constraint hr_training_assignments_source_check
      check (source in ('manual','program','session','onboarding','renewal'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hr_training_assignments_207_lengths') then
    alter table public.hr_training_assignments add constraint hr_training_assignments_207_lengths
      check ((evidence_note is null or length(evidence_note) <= 2000)
         and (review_note is null or length(review_note) <= 1000)
         and (certificate_number is null or length(certificate_number) <= 80));
  end if;
end $$;

create index if not exists hr_training_assignments_cert_expiry on public.hr_training_assignments (certificate_expiry)
  where status = 'completed' and certificate_expiry is not null;
create index if not exists hr_training_assignments_unverified on public.hr_training_assignments (employee_id)
  where status = 'completed' and verified_at is null;

-- Assignments created by an onboarding link (130) are tagged once.
update public.hr_training_assignments a set source = 'onboarding'
 where a.source = 'manual'
   and exists (select 1 from public.hr_onboarding_tasks t where t.training_assignment_id = a.id);

-- Triggers, RLS, audit
drop trigger if exists hr_training_trainers_touch on public.hr_training_trainers;
create trigger hr_training_trainers_touch before update on public.hr_training_trainers for each row execute function hr_private.touch_updated_at();
drop trigger if exists hr_training_programs_touch on public.hr_training_programs;
create trigger hr_training_programs_touch before update on public.hr_training_programs for each row execute function hr_private.touch_updated_at();
drop trigger if exists hr_training_sessions_touch on public.hr_training_sessions;
create trigger hr_training_sessions_touch before update on public.hr_training_sessions for each row execute function hr_private.touch_updated_at();
drop trigger if exists hr_training_enrollments_touch on public.hr_training_enrollments;
create trigger hr_training_enrollments_touch before update on public.hr_training_enrollments for each row execute function hr_private.touch_updated_at();

select hr_private.secure_table('public.hr_training_trainers');
select hr_private.secure_table('public.hr_training_programs');
select hr_private.secure_table('public.hr_training_program_courses');
select hr_private.secure_table('public.hr_training_sessions');
select hr_private.secure_table('public.hr_training_enrollments');
select hr_private.enable_audit('public.hr_training_trainers');
select hr_private.enable_audit('public.hr_training_programs');
select hr_private.enable_audit('public.hr_training_program_courses');
select hr_private.enable_audit('public.hr_training_sessions');
select hr_private.enable_audit('public.hr_training_enrollments');

-- Sessions and enrollments change only through the RPCs below.
revoke insert, update, delete, truncate on public.hr_training_sessions, public.hr_training_enrollments from authenticated;

do $$
declare t text;
begin
  -- Catalogue-style tables: readable by every employee and training staff, written with training.manage.
  foreach t in array array['hr_training_trainers','hr_training_programs','hr_training_program_courses','hr_training_sessions'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (hr_private.current_employee_id() is not null or hr_private.any_permission(array[''training.view'',''training.view_team'',''training.manage'',''settings.view'']))', t || '_read', t);
  end loop;
  foreach t in array array['hr_training_trainers','hr_training_programs','hr_training_program_courses'] loop
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (hr_private.has_permission(''training.manage''))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (hr_private.has_permission(''training.manage'')) with check (hr_private.has_permission(''training.manage''))', t || '_update', t);
  end loop;
end $$;
drop policy if exists hr_training_program_courses_delete on public.hr_training_program_courses;
create policy hr_training_program_courses_delete on public.hr_training_program_courses for delete to authenticated
  using (hr_private.has_permission('training.manage'));
drop policy if exists hr_training_enrollments_read on public.hr_training_enrollments;
create policy hr_training_enrollments_read on public.hr_training_enrollments for select to authenticated
  using (hr_private.can_access_employee(employee_id, 'training'));

-- ---------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------
-- Certificate / recertification expiry: completion date + course validity,
-- for passed or attended results (failed training has no certificate).
create or replace function hr_private.training_expiry(p_course uuid, p_date date, p_result text)
returns date language sql stable security definer set search_path = '' as $$
  select case when p_date is not null and p_result in ('passed','attended') and c.validity_months is not null
              then (p_date + make_interval(months => c.validity_months))::date end
  from public.hr_training_courses c where c.id = p_course
$$;

create or replace function hr_private.training_emp_name(p_employee uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(btrim(e.display_name), ''), btrim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')))
  from public.hr_employees e where e.id = p_employee
$$;

create or replace function hr_private.training_open_assignment(p_employee uuid, p_course uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select a.id from public.hr_training_assignments a
   where a.employee_id = p_employee and a.course_id = p_course and a.status in ('assigned','in_progress')
   order by a.assigned_at desc limit 1
$$;

create or replace function hr_private.training_employee_active(p_employee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.hr_employees where id = p_employee and status not in ('exited','archived','suspended'))
$$;

-- Seats in use: confirmed, attended and absent enrollments (waitlist excluded).
create or replace function hr_private.training_seats_taken(p_session uuid)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.hr_training_enrollments where session_id = p_session and status in ('enrolled','attended','absent')
$$;

-- Moves waitlisted employees into free seats (oldest first). Caller holds the session lock.
create or replace function hr_private.training_promote_waitlist(p_session uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare v_s public.hr_training_sessions; v_free int; r record; n int := 0; v_title text;
begin
  select * into v_s from public.hr_training_sessions where id = p_session;
  if v_s.id is null or v_s.status <> 'scheduled' then return 0; end if;
  v_free := case when v_s.capacity is null then 2147483647 else v_s.capacity - hr_private.training_seats_taken(p_session) end;
  select title into v_title from public.hr_training_courses where id = v_s.course_id;
  for r in select e.id, e.employee_id from public.hr_training_enrollments e
            where e.session_id = p_session and e.status = 'waitlisted' order by e.enrolled_at, e.id loop
    exit when v_free <= 0;
    update public.hr_training_enrollments set status = 'enrolled' where id = r.id;
    perform hr_private.notify_employee(r.employee_id, 'training_session', 'Training seat confirmed: ' || v_title,
      'A seat opened up for the session on ' || to_char(v_s.session_date, 'DD Mon YYYY') || '.', '/employee/training', 'hr_training_enrollment', r.id::text);
    v_free := v_free - 1; n := n + 1;
  end loop;
  return n;
end $$;

-- One enrollment (seat or waitlist). Caller holds the session lock and has checked permissions.
create or replace function hr_private.training_enroll_one(p_session uuid, p_employee uuid, p_assignment uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_s public.hr_training_sessions; v_status text; v_id uuid; v_title text;
begin
  select * into v_s from public.hr_training_sessions where id = p_session;
  if exists (select 1 from public.hr_training_enrollments where session_id = p_session and employee_id = p_employee and status <> 'cancelled') then
    return 'skipped';
  end if;
  v_status := case when v_s.capacity is null or hr_private.training_seats_taken(p_session) < v_s.capacity then 'enrolled' else 'waitlisted' end;
  insert into public.hr_training_enrollments (session_id, employee_id, assignment_id, status, enrolled_by)
  values (p_session, p_employee, p_assignment, v_status, auth.uid()) returning id into v_id;
  select title into v_title from public.hr_training_courses where id = v_s.course_id;
  if p_employee is distinct from hr_private.current_employee_id() then
    perform hr_private.notify_employee(p_employee, 'training_session',
      case when v_status = 'enrolled' then 'Training session booked: ' else 'Waitlisted for training: ' end || v_title,
      to_char(v_s.session_date, 'DD Mon YYYY') || coalesce(' ' || to_char(v_s.start_time, 'HH24:MI'), '') || coalesce(' · ' || v_s.venue, ''),
      '/employee/training', 'hr_training_enrollment', v_id::text);
  end if;
  return v_status;
end $$;

-- ---------------------------------------------------------------------
-- 3. Onboarding integration
-- ---------------------------------------------------------------------
-- Linked training completed AND verified -> onboarding task completed.
create or replace function hr_lifecycle_internal.onboarding_training_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if new.status = 'completed' and new.verified_at is not null
     and (old.status is distinct from 'completed' or old.verified_at is null) then
    for r in select t.id, t.case_id, t.title from public.hr_onboarding_tasks t join public.hr_onboarding_cases c on c.id = t.case_id
             where t.training_assignment_id = new.id and t.status in ('pending','in_progress') and c.status = 'open'
    loop
      update public.hr_onboarding_tasks set status = 'completed', completed_by = auth.uid(), completed_at = now(),
             evidence_note = coalesce(evidence_note, 'Training completed ' || to_char(new.completion_date, 'DD Mon YYYY'))
       where id = r.id;
      perform hr_lifecycle_internal.onboarding_log(r.case_id, 'task_completed', r.title || ': linked training completed', r.id);
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists hr_training_assignments_onboarding_sync on public.hr_training_assignments;
create trigger hr_training_assignments_onboarding_sync after update of status, verified_at on public.hr_training_assignments
  for each row execute function hr_lifecycle_internal.onboarding_training_sync();

-- Tag the assignment an onboarding task links to.
create or replace function hr_private.training_mark_onboarding_source()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.training_assignment_id is not null and new.training_assignment_id is distinct from old.training_assignment_id then
    update public.hr_training_assignments set source = 'onboarding' where id = new.training_assignment_id and source = 'manual';
  end if;
  return new;
end $$;
drop trigger if exists hr_onboarding_tasks_training_source on public.hr_onboarding_tasks;
create trigger hr_onboarding_tasks_training_source after update of training_assignment_id on public.hr_onboarding_tasks
  for each row execute function hr_private.training_mark_onboarding_source();

-- ---------------------------------------------------------------------
-- 4. Completion (115 function, same signature; expiry now via helper,
--    certificate issue date recorded, self-reported completion timestamped)
-- ---------------------------------------------------------------------
create or replace function public.hr_complete_training(
  p_assignment uuid, p_completion_date date, p_result text default 'passed', p_score numeric default null,
  p_certificate_document uuid default null, p_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.hr_training_assignments; v_c public.hr_training_courses; v_self boolean; v_source text;
begin
  select * into v from public.hr_training_assignments where id = p_assignment for update;
  if v.id is null then perform hr_private.fail('Training assignment not found.', 'not_found'); end if;
  v_self := v.employee_id = hr_private.current_employee_id();
  if not v_self and not hr_private.can_manage_training_of(v.employee_id) then
    perform hr_private.fail('You are not allowed to record completion for this employee.', 'forbidden');
  end if;
  if v.status not in ('assigned','in_progress') then perform hr_private.fail('This assignment is not open.', 'invalid_status'); end if;
  if p_completion_date is null or p_completion_date > hr_private.business_today() then
    perform hr_private.fail('Enter a completion date that is not in the future.', 'invalid_date');
  end if;
  if p_completion_date < v.assigned_at::date - 365 then perform hr_private.fail('The completion date is too far before the assignment.', 'invalid_date'); end if;
  if p_result is null or p_result not in ('passed','failed','attended') then perform hr_private.fail('Choose passed, failed or attended.', 'invalid_result'); end if;
  if p_score is not null and (p_score < 0 or p_score > 100) then perform hr_private.fail('The score must be between 0 and 100.', 'invalid_score'); end if;
  select * into v_c from public.hr_training_courses where id = v.course_id;
  if p_score is not null and v_c.pass_score is not null and p_result = 'passed' and p_score < v_c.pass_score then
    perform hr_private.fail('The score is below the pass mark of ' || v_c.pass_score || '.', 'below_pass_score');
  end if;
  if v_c.certificate_required and p_result = 'passed' and p_certificate_document is null then
    perform hr_private.fail('This course requires a certificate. Upload it in Documents (Training certificate) and attach it.', 'certificate_required');
  end if;
  if p_certificate_document is not null and not exists (
       select 1 from public.hr_documents d where d.id = p_certificate_document and d.employee_id = v.employee_id and d.archived_at is null) then
    perform hr_private.fail('The certificate must be an active document of the same employee.', 'invalid_certificate');
  end if;
  v_source := case when v_self then 'self' when hr_private.has_permission('training.manage') then 'hr' else 'manager' end;
  update public.hr_training_assignments set
    status = 'completed', completion_date = p_completion_date, result = p_result, score = p_score,
    certificate_document_id = p_certificate_document,
    certificate_issued_on = case when p_certificate_document is not null then p_completion_date end,
    certificate_expiry = hr_private.training_expiry(v.course_id, p_completion_date, p_result),
    completion_source = v_source, completed_by = auth.uid(),
    verified_by = case when v_self then null else auth.uid() end,
    verified_at = case when v_self then null else now() end,
    submitted_at = case when v_self then now() else submitted_at end,
    started_at = coalesce(started_at, now()),
    notes = coalesce(nullif(btrim(p_notes), ''), notes)
  where id = p_assignment;
  if not v_self then
    perform hr_private.notify_employee(v.employee_id, 'training_completed', 'Training recorded: ' || v_c.title,
      'Your completion of ' || v_c.title || ' was recorded (' || p_result || ').', '/employee/training', 'hr_training_assignment', v.id::text);
  end if;
end $$;

-- Employee submits completion with evidence; HR / manager verifies later.
create or replace function public.hr_submit_training_completion(
  p_assignment uuid, p_completion_date date, p_result text default 'passed', p_score numeric default null,
  p_evidence_note text default null, p_evidence_document uuid default null,
  p_certificate_document uuid default null, p_certificate_number text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.hr_training_assignments; v_c public.hr_training_courses; v_me uuid := hr_private.current_employee_id();
        v_mgr uuid; v_mgr_user uuid; v_name text;
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  select * into v from public.hr_training_assignments where id = p_assignment for update;
  if v.id is null or v.employee_id is distinct from v_me then perform hr_private.fail('Training assignment not found.', 'not_found'); end if;
  if v.status not in ('assigned','in_progress') then perform hr_private.fail('This assignment is not open.', 'invalid_status'); end if;
  if p_completion_date is null or p_completion_date > hr_private.business_today() then
    perform hr_private.fail('Enter a completion date that is not in the future.', 'invalid_date');
  end if;
  if p_completion_date < v.assigned_at::date - 365 then perform hr_private.fail('The completion date is too far before the assignment.', 'invalid_date'); end if;
  if p_result is null or p_result not in ('passed','failed','attended') then perform hr_private.fail('Choose passed, failed or attended.', 'invalid_result'); end if;
  if p_score is not null and (p_score < 0 or p_score > 100) then perform hr_private.fail('The score must be between 0 and 100.', 'invalid_score'); end if;
  select * into v_c from public.hr_training_courses where id = v.course_id;
  if p_score is not null and v_c.pass_score is not null and p_result = 'passed' and p_score < v_c.pass_score then
    perform hr_private.fail('The score is below the pass mark of ' || v_c.pass_score || '.', 'below_pass_score');
  end if;
  if nullif(btrim(p_evidence_note), '') is null and p_evidence_document is null and p_certificate_document is null then
    perform hr_private.fail('Add evidence: a note, a file or the certificate.', 'evidence_required');
  end if;
  if length(coalesce(p_evidence_note, '')) > 2000 then perform hr_private.fail('The evidence note is too long (2000 characters maximum).', 'invalid'); end if;
  if length(coalesce(p_certificate_number, '')) > 80 then perform hr_private.fail('The certificate number is too long.', 'invalid'); end if;
  if v_c.certificate_required and p_result = 'passed' and p_certificate_document is null then
    perform hr_private.fail('This course requires a certificate. Upload the certificate file with your submission.', 'certificate_required');
  end if;
  if (p_evidence_document is not null and not exists (
        select 1 from public.hr_documents d where d.id = p_evidence_document and d.employee_id = v_me and d.archived_at is null))
     or (p_certificate_document is not null and not exists (
        select 1 from public.hr_documents d where d.id = p_certificate_document and d.employee_id = v_me and d.archived_at is null)) then
    perform hr_private.fail('Evidence and certificates must be your own active documents.', 'invalid_document');
  end if;
  update public.hr_training_assignments set
    status = 'completed', completion_date = p_completion_date, result = p_result, score = p_score,
    evidence_note = nullif(btrim(p_evidence_note), ''), evidence_document_id = p_evidence_document,
    certificate_document_id = p_certificate_document, certificate_number = nullif(btrim(p_certificate_number), ''),
    certificate_issued_on = case when p_certificate_document is not null or nullif(btrim(p_certificate_number), '') is not null then p_completion_date end,
    certificate_expiry = hr_private.training_expiry(v.course_id, p_completion_date, p_result),
    completion_source = 'self', completed_by = auth.uid(), verified_by = null, verified_at = null,
    submitted_at = now(), reviewed_by = null, reviewed_at = null, review_note = null,
    started_at = coalesce(started_at, now())
  where id = p_assignment;

  v_name := hr_private.training_emp_name(v_me);
  v_mgr := hr_private.my_manager_id();
  v_mgr_user := hr_private.employee_user_id(v_mgr);
  if v_mgr is not null then
    perform hr_private.notify_employee(v_mgr, 'training_verification', 'Training completion to verify',
      v_name || ': ' || v_c.title, '/hr/training?tab=verification', 'hr_training_assignment', v.id::text);
  end if;
  if v.assigned_by is not null and v.assigned_by is distinct from auth.uid() and v.assigned_by is distinct from v_mgr_user then
    perform hr_private.notify_user(v.assigned_by, 'training_verification', 'Training completion to verify',
      v_name || ': ' || v_c.title, '/hr/training?tab=verification', 'hr_training_assignment', v.id::text);
  end if;
  perform hr_private.audit_event('TRAINING_COMPLETION_SUBMITTED', 'hr_training_assignments', v.id::text,
    jsonb_build_object('employee_id', v_me, 'course_id', v.course_id, 'result', p_result, 'score', p_score));
end $$;

-- Verify (optionally correcting result / score) or return a self-reported completion.
create or replace function public.hr_review_training_completion(
  p_assignment uuid, p_approve boolean, p_note text default null, p_result text default null, p_score numeric default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.hr_training_assignments; v_c public.hr_training_courses; v_result text; v_score numeric;
begin
  select * into v from public.hr_training_assignments where id = p_assignment for update;
  if v.id is null then perform hr_private.fail('Training assignment not found.', 'not_found'); end if;
  if not hr_private.can_manage_training_of(v.employee_id) then
    perform hr_private.fail('You are not allowed to verify this completion (your own training is verified by HR or your manager).', 'forbidden');
  end if;
  if v.status <> 'completed' or v.verified_at is not null then
    perform hr_private.fail('Only completions waiting for verification can be reviewed.', 'invalid_status');
  end if;
  if p_approve is null then perform hr_private.fail('Choose verify or return.', 'invalid'); end if;
  if length(coalesce(p_note, '')) > 1000 then perform hr_private.fail('The note is too long (1000 characters maximum).', 'invalid'); end if;
  select * into v_c from public.hr_training_courses where id = v.course_id;
  if p_approve then
    v_result := coalesce(nullif(p_result, ''), v.result);
    v_score := coalesce(p_score, v.score);
    if v_result not in ('passed','failed','attended') then perform hr_private.fail('Choose passed, failed or attended.', 'invalid_result'); end if;
    if v_score is not null and (v_score < 0 or v_score > 100) then perform hr_private.fail('The score must be between 0 and 100.', 'invalid_score'); end if;
    if v_score is not null and v_c.pass_score is not null and v_result = 'passed' and v_score < v_c.pass_score then
      perform hr_private.fail('The score is below the pass mark of ' || v_c.pass_score || '.', 'below_pass_score');
    end if;
    if v_c.certificate_required and v_result = 'passed' and v.certificate_document_id is null then
      perform hr_private.fail('This course requires a certificate. Record the certificate before verifying.', 'certificate_required');
    end if;
    update public.hr_training_assignments set
      result = v_result, score = v_score,
      certificate_expiry = hr_private.training_expiry(v.course_id, v.completion_date, v_result),
      verified_by = auth.uid(), verified_at = now(), reviewed_by = auth.uid(), reviewed_at = now(),
      review_note = nullif(btrim(p_note), '')
    where id = p_assignment;
    perform hr_private.notify_employee(v.employee_id, 'training_completed', 'Training completion verified: ' || v_c.title,
      'Result: ' || v_result || coalesce(' (' || v_score || ')', '') || '.', '/employee/training', 'hr_training_assignment', v.id::text);
  else
    if length(btrim(coalesce(p_note, ''))) < 3 then perform hr_private.fail('Tell the employee why the completion is returned.', 'reason_required'); end if;
    update public.hr_training_assignments set
      status = 'in_progress', completion_date = null, result = null, score = null, certificate_expiry = null,
      certificate_issued_on = null, completion_source = null, completed_by = null, submitted_at = null,
      reviewed_by = auth.uid(), reviewed_at = now(), review_note = btrim(p_note)
    where id = p_assignment;
    perform hr_private.notify_employee(v.employee_id, 'training_returned', 'Training completion returned: ' || v_c.title,
      btrim(p_note), '/employee/training', 'hr_training_assignment', v.id::text);
  end if;
  perform hr_private.audit_event(case when p_approve then 'TRAINING_COMPLETION_VERIFIED' else 'TRAINING_COMPLETION_RETURNED' end,
    'hr_training_assignments', v.id::text, jsonb_build_object('employee_id', v.employee_id, 'course_id', v.course_id, 'note', nullif(btrim(p_note), '')));
end $$;

-- Record / correct certificate details of a completed assignment (HR / manager).
create or replace function public.hr_record_training_certificate(
  p_assignment uuid, p_document uuid default null, p_number text default null, p_issued_on date default null, p_expiry date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.hr_training_assignments; v_c public.hr_training_courses; v_issued date; v_exp date;
begin
  select * into v from public.hr_training_assignments where id = p_assignment for update;
  if v.id is null then perform hr_private.fail('Training assignment not found.', 'not_found'); end if;
  if not hr_private.can_manage_training_of(v.employee_id) then
    perform hr_private.fail('You are not allowed to record certificates for this employee.', 'forbidden');
  end if;
  if v.status <> 'completed' or v.result not in ('passed','attended') then
    perform hr_private.fail('Certificates are recorded for passed or attended training only.', 'invalid_status');
  end if;
  if p_document is null and nullif(btrim(p_number), '') is null and v.certificate_document_id is null and v.certificate_number is null then
    perform hr_private.fail('Attach the certificate file or enter its number.', 'certificate_required');
  end if;
  if length(coalesce(p_number, '')) > 80 then perform hr_private.fail('The certificate number is too long.', 'invalid'); end if;
  if p_document is not null and not exists (
       select 1 from public.hr_documents d where d.id = p_document and d.employee_id = v.employee_id and d.archived_at is null) then
    perform hr_private.fail('The certificate must be an active document of the same employee.', 'invalid_certificate');
  end if;
  select * into v_c from public.hr_training_courses where id = v.course_id;
  v_issued := coalesce(p_issued_on, v.certificate_issued_on, v.completion_date);
  if v_issued > hr_private.business_today() then perform hr_private.fail('The issue date cannot be in the future.', 'invalid_date'); end if;
  v_exp := coalesce(p_expiry, case when v_c.validity_months is not null then (v_issued + make_interval(months => v_c.validity_months))::date end);
  if v_exp is not null and v_exp <= v_issued then perform hr_private.fail('The expiry date must be after the issue date.', 'invalid_date'); end if;
  update public.hr_training_assignments set
    certificate_document_id = coalesce(p_document, certificate_document_id),
    certificate_number = coalesce(nullif(btrim(p_number), ''), certificate_number),
    certificate_issued_on = v_issued, certificate_expiry = v_exp
  where id = p_assignment;
  perform hr_private.audit_event('TRAINING_CERTIFICATE_RECORDED', 'hr_training_assignments', v.id::text,
    jsonb_build_object('employee_id', v.employee_id, 'issued_on', v_issued, 'expiry', v_exp, 'document_id', coalesce(p_document, v.certificate_document_id)));
end $$;

-- ---------------------------------------------------------------------
-- 5. Renewal (recertification)
-- ---------------------------------------------------------------------
create or replace function public.hr_renew_training(p_assignment uuid, p_due_date date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v public.hr_training_assignments; v_c public.hr_training_courses; v_open uuid; v_due date; v_id uuid;
begin
  select * into v from public.hr_training_assignments where id = p_assignment;
  if v.id is null then perform hr_private.fail('Training assignment not found.', 'not_found'); end if;
  if not hr_private.can_manage_training_of(v.employee_id) then
    perform hr_private.fail('You can only renew training of your reporting line (never your own).', 'forbidden');
  end if;
  if v.status <> 'completed' then perform hr_private.fail('Only completed training can be renewed.', 'invalid_status'); end if;
  select * into v_c from public.hr_training_courses where id = v.course_id;
  if not v_c.active then perform hr_private.fail('The course is no longer active.', 'course_inactive'); end if;
  if not hr_private.training_employee_active(v.employee_id) then perform hr_private.fail('The employee is not active.', 'employee_inactive'); end if;
  v_open := hr_private.training_open_assignment(v.employee_id, v.course_id);
  if v_open is not null then return v_open; end if;
  v_due := coalesce(p_due_date, greatest(coalesce(v.certificate_expiry, hr_private.business_today()), hr_private.business_today()));
  if v_due < hr_private.business_today() then perform hr_private.fail('The due date is in the past.', 'invalid_due_date'); end if;
  insert into public.hr_training_assignments (employee_id, course_id, due_date, assigned_by, source, renewal_of, notes)
  values (v.employee_id, v.course_id, v_due, auth.uid(), 'renewal', v.id,
          'Renewal' || coalesce(' of certificate expiring ' || to_char(v.certificate_expiry, 'DD Mon YYYY'), ''))
  returning id into v_id;
  perform hr_private.notify_employee(v.employee_id, 'training_assigned', 'Recertification due: ' || v_c.title,
    'Due ' || to_char(v_due, 'DD Mon YYYY') || '.', '/employee/training', 'hr_training_assignment', v_id::text);
  perform hr_private.audit_event('TRAINING_RENEWAL_ASSIGNED', 'hr_training_assignments', v_id::text,
    jsonb_build_object('renewal_of', v.id, 'employee_id', v.employee_id, 'course_id', v.course_id, 'due_date', v_due));
  return v_id;
end $$;

-- Assign renewals for every latest verified certificate expiring within p_days (HR only).
create or replace function public.hr_generate_training_renewals(p_days int default 60)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0; v_today date := hr_private.business_today(); v_me uuid := hr_private.current_employee_id();
begin
  if not hr_private.has_permission('training.manage') then perform hr_private.fail('You are not allowed to generate renewals.', 'forbidden'); end if;
  if p_days is null or p_days not between 0 and 365 then perform hr_private.fail('Choose 0 to 365 days.', 'invalid'); end if;
  for r in
    select x.* from (
      select distinct on (a.employee_id, a.course_id) a.id, a.employee_id, a.course_id, a.certificate_expiry
        from public.hr_training_assignments a
       where a.status = 'completed' and a.verified_at is not null
       order by a.employee_id, a.course_id, a.completion_date desc, a.created_at desc) x
    join public.hr_training_courses c on c.id = x.course_id and c.active
    where x.certificate_expiry is not null and x.certificate_expiry <= v_today + p_days
      and x.employee_id is distinct from v_me
      and hr_private.training_employee_active(x.employee_id)
      and hr_private.training_open_assignment(x.employee_id, x.course_id) is null
  loop
    perform public.hr_renew_training(r.id, null);
    n := n + 1;
  end loop;
  perform hr_private.audit_event('TRAINING_RENEWALS_GENERATED', 'hr_training_assignments', null, jsonb_build_object('days', p_days, 'created', n));
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 6. Programs
-- ---------------------------------------------------------------------
create or replace function public.hr_assign_training_program(p_program uuid, p_employees uuid[], p_due_date date default null, p_notes text default null)
returns int language plpgsql security definer set search_path = '' as $$
declare v_p public.hr_training_programs; r record; n int := 0; v_courses uuid[];
begin
  if not hr_private.any_permission(array['training.manage','training.assign_team']) then
    perform hr_private.fail('You are not allowed to assign training.', 'forbidden');
  end if;
  select * into v_p from public.hr_training_programs where id = p_program;
  if v_p.id is null or not v_p.active then perform hr_private.fail('Choose an active program.', 'program_inactive'); end if;
  select array_agg(pc.course_id order by pc.sort_order) into v_courses
    from public.hr_training_program_courses pc join public.hr_training_courses c on c.id = pc.course_id and c.active
   where pc.program_id = p_program;
  if v_courses is null then perform hr_private.fail('This program has no active courses.', 'program_empty'); end if;
  for r in select unnest(v_courses) as course_id loop
    n := n + public.hr_assign_training(r.course_id, p_employees, p_due_date, coalesce(nullif(btrim(p_notes), ''), 'Program: ' || v_p.title));
  end loop;
  -- Rows created by this call (same transaction timestamp, same assigner).
  update public.hr_training_assignments set source = 'program', program_id = p_program
   where employee_id = any (p_employees) and course_id = any (v_courses) and status = 'assigned'
     and assigned_by is not distinct from auth.uid() and assigned_at = now() and source = 'manual';
  perform hr_private.audit_event('TRAINING_PROGRAM_ASSIGNED', 'hr_training_programs', p_program::text,
    jsonb_build_object('employees', cardinality(p_employees), 'created', n));
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 7. Sessions
-- ---------------------------------------------------------------------
create or replace function public.hr_save_training_session(p_session uuid, p_values jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_s public.hr_training_sessions; v_id uuid; v_course uuid; v_date date; v_start time; v_end time; v_cap int; v_trainer uuid;
        v_title text; v_venue text; v_url text; v_notes text; v_taken int; v_changed boolean; r record; v_ctitle text;
begin
  if not hr_private.has_permission('training.manage') then perform hr_private.fail('You are not allowed to schedule training sessions.', 'forbidden'); end if;
  if p_values is null or jsonb_typeof(p_values) <> 'object' then perform hr_private.fail('Session details are missing.', 'invalid'); end if;
  begin
    v_course  := nullif(p_values ->> 'course_id', '')::uuid;
    v_date    := nullif(p_values ->> 'session_date', '')::date;
    v_start   := nullif(p_values ->> 'start_time', '')::time;
    v_end     := nullif(p_values ->> 'end_time', '')::time;
    v_cap     := nullif(p_values ->> 'capacity', '')::int;
    v_trainer := nullif(p_values ->> 'trainer_id', '')::uuid;
  exception when others then
    perform hr_private.fail('One of the session values is not valid.', 'invalid');
  end;
  v_title := nullif(btrim(p_values ->> 'title'), '');
  v_venue := nullif(btrim(p_values ->> 'venue'), '');
  v_url   := nullif(btrim(p_values ->> 'meeting_url'), '');
  v_notes := nullif(btrim(p_values ->> 'notes'), '');
  if v_course is null then perform hr_private.fail('Choose a course.', 'course_required'); end if;
  if v_date is null then perform hr_private.fail('Choose the session date.', 'date_required'); end if;
  if v_start is not null and v_end is not null and v_end <= v_start then perform hr_private.fail('The end time must be after the start time.', 'invalid_time'); end if;
  if v_cap is not null and v_cap not between 1 and 1000 then perform hr_private.fail('Capacity must be between 1 and 1000 (empty = unlimited).', 'invalid_capacity'); end if;
  if v_url is not null and v_url !~* '^https?://' then perform hr_private.fail('The meeting link must start with http:// or https://.', 'invalid_url'); end if;
  if v_venue is null and v_url is null then perform hr_private.fail('Enter a venue or a meeting link.', 'venue_required'); end if;
  if v_trainer is not null and not exists (select 1 from public.hr_training_trainers where id = v_trainer and active) then
    perform hr_private.fail('Choose an active trainer.', 'trainer_inactive');
  end if;

  if p_session is null then
    if not exists (select 1 from public.hr_training_courses where id = v_course and active) then perform hr_private.fail('Choose an active course.', 'course_inactive'); end if;
    if v_date < hr_private.business_today() then perform hr_private.fail('The session date is in the past.', 'invalid_date'); end if;
    insert into public.hr_training_sessions (course_id, title, session_date, start_time, end_time, venue, meeting_url, capacity, trainer_id, notes, created_by)
    values (v_course, v_title, v_date, v_start, v_end, v_venue, v_url, v_cap, v_trainer, v_notes, auth.uid())
    returning id into v_id;
    return v_id;
  end if;

  select * into v_s from public.hr_training_sessions where id = p_session for update;
  if v_s.id is null then perform hr_private.fail('Session not found.', 'not_found'); end if;
  if v_s.status <> 'scheduled' then perform hr_private.fail('Only scheduled sessions can be edited.', 'invalid_status'); end if;
  if v_course <> v_s.course_id and exists (select 1 from public.hr_training_enrollments where session_id = p_session and status <> 'cancelled') then
    perform hr_private.fail('The course cannot change once employees are enrolled.', 'has_enrollments');
  end if;
  if v_date <> v_s.session_date and v_date < hr_private.business_today() then perform hr_private.fail('The session date is in the past.', 'invalid_date'); end if;
  v_taken := hr_private.training_seats_taken(p_session);
  if v_cap is not null and v_cap < v_taken then
    perform hr_private.fail('Capacity cannot be below the ' || v_taken || ' seats already taken.', 'capacity_below_enrolled');
  end if;
  v_changed := (v_date, v_start, v_end, v_venue, v_url) is distinct from (v_s.session_date, v_s.start_time, v_s.end_time, v_s.venue, v_s.meeting_url);
  update public.hr_training_sessions set course_id = v_course, title = v_title, session_date = v_date, start_time = v_start, end_time = v_end,
         venue = v_venue, meeting_url = v_url, capacity = v_cap, trainer_id = v_trainer, notes = v_notes
   where id = p_session;
  if v_changed then
    select title into v_ctitle from public.hr_training_courses where id = v_course;
    for r in select id, employee_id from public.hr_training_enrollments where session_id = p_session and status in ('enrolled','waitlisted') loop
      perform hr_private.notify_employee(r.employee_id, 'training_session', 'Training session updated: ' || v_ctitle,
        to_char(v_date, 'DD Mon YYYY') || coalesce(' ' || to_char(v_start, 'HH24:MI'), '') || coalesce(' · ' || v_venue, ''),
        '/employee/training', 'hr_training_enrollment', r.id::text);
    end loop;
  end if;
  perform hr_private.training_promote_waitlist(p_session);
  return p_session;
end $$;

create or replace function public.hr_set_training_session_status(p_session uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_s public.hr_training_sessions; r record; v_title text;
begin
  if not hr_private.has_permission('training.manage') then perform hr_private.fail('You are not allowed to manage training sessions.', 'forbidden'); end if;
  select * into v_s from public.hr_training_sessions where id = p_session for update;
  if v_s.id is null then perform hr_private.fail('Session not found.', 'not_found'); end if;
  if v_s.status <> 'scheduled' then perform hr_private.fail('This session is already ' || v_s.status || '.', 'invalid_status'); end if;
  if p_status not in ('completed','cancelled') then perform hr_private.fail('Choose completed or cancelled.', 'invalid'); end if;
  if p_status = 'completed' and v_s.session_date > hr_private.business_today() then
    perform hr_private.fail('A session can be closed on or after its date.', 'too_early');
  end if;
  if p_status = 'cancelled' then
    if length(btrim(coalesce(p_reason, ''))) < 3 then perform hr_private.fail('Give a reason for cancelling.', 'reason_required'); end if;
    select title into v_title from public.hr_training_courses where id = v_s.course_id;
    for r in select id, employee_id from public.hr_training_enrollments where session_id = p_session and status in ('enrolled','waitlisted') for update loop
      update public.hr_training_enrollments set status = 'cancelled', cancel_reason = left('Session cancelled: ' || btrim(p_reason), 1000) where id = r.id;
      perform hr_private.notify_employee(r.employee_id, 'training_session', 'Training session cancelled: ' || v_title,
        to_char(v_s.session_date, 'DD Mon YYYY') || ': ' || btrim(p_reason), '/employee/training', 'hr_training_enrollment', r.id::text);
    end loop;
  end if;
  update public.hr_training_sessions set status = p_status,
         cancel_reason = case when p_status = 'cancelled' then left(btrim(p_reason), 1000) else cancel_reason end
   where id = p_session;
  perform hr_private.audit_event('TRAINING_SESSION_' || upper(p_status), 'hr_training_sessions', p_session::text,
    jsonb_build_object('reason', nullif(btrim(p_reason), '')));
end $$;

-- Sessions with seat counts (aggregates only) and the caller's own enrollment.
create or replace function public.hr_list_training_sessions(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := hr_private.current_employee_id(); v jsonb;
begin
  if auth.uid() is null or (v_me is null and not hr_private.any_permission(array['training.view','training.view_team','training.manage','training.assign_team'])) then
    perform hr_private.fail('Sign in with an active employee account.', 'not_employee');
  end if;
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.session_date, x.start_time nulls first), '[]'::jsonb) into v
  from (
    select s.id, s.course_id, c.code as course_code, c.title as course_title, c.delivery_mode, c.duration_hours, s.title, s.session_date,
           s.start_time, s.end_time, s.venue, s.meeting_url, s.capacity, s.status, s.cancel_reason, s.notes, s.trainer_id,
           case when t.id is null then null when t.employee_id is not null then hr_private.training_emp_name(t.employee_id) else t.external_name end as trainer_name,
           hr_private.training_seats_taken(s.id) as seats_taken,
           (select count(*)::int from public.hr_training_enrollments e where e.session_id = s.id and e.status = 'waitlisted') as waitlisted,
           (select count(*)::int from public.hr_training_enrollments e where e.session_id = s.id and e.status = 'attended') as attended,
           case when s.capacity is null then null else greatest(s.capacity - hr_private.training_seats_taken(s.id), 0) end as seats_left,
           me.id as my_enrollment_id, me.status as my_status,
           (v_me is not null and hr_private.training_open_assignment(v_me, s.course_id) is not null) as my_assignment_open
      from public.hr_training_sessions s
      join public.hr_training_courses c on c.id = s.course_id
      left join public.hr_training_trainers t on t.id = s.trainer_id
      left join lateral (select e.id, e.status from public.hr_training_enrollments e
                          where e.session_id = s.id and e.employee_id = v_me and e.status <> 'cancelled' limit 1) me on true
     where (p_from is null or s.session_date >= p_from) and (p_to is null or s.session_date <= p_to)
     order by s.session_date desc
     limit 1000) x;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- 8. Enrollment + attendance
-- ---------------------------------------------------------------------
create or replace function public.hr_enroll_training_session(p_session uuid, p_employees uuid[], p_due_date date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_s public.hr_training_sessions; v_c public.hr_training_courses; v_emp uuid; v_asg uuid; v_res text;
        v_enrolled int := 0; v_wait int := 0; v_skip int := 0;
begin
  if not hr_private.any_permission(array['training.manage','training.assign_team']) then
    perform hr_private.fail('You are not allowed to enroll employees.', 'forbidden');
  end if;
  select * into v_s from public.hr_training_sessions where id = p_session for update;
  if v_s.id is null then perform hr_private.fail('Session not found.', 'not_found'); end if;
  if v_s.status <> 'scheduled' or v_s.session_date < hr_private.business_today() then
    perform hr_private.fail('Only upcoming scheduled sessions take enrollments.', 'invalid_status');
  end if;
  select * into v_c from public.hr_training_courses where id = v_s.course_id;
  if not v_c.active then perform hr_private.fail('The course is no longer active.', 'course_inactive'); end if;
  if p_employees is null or cardinality(p_employees) = 0 then perform hr_private.fail('Choose at least one employee.', 'employees_required'); end if;
  if cardinality(p_employees) > 500 then perform hr_private.fail('Enroll at most 500 employees at a time.', 'too_many'); end if;
  if p_due_date is not null and p_due_date < hr_private.business_today() then perform hr_private.fail('The due date is in the past.', 'invalid_due_date'); end if;
  foreach v_emp in array p_employees loop
    if not hr_private.training_employee_active(v_emp) then
      perform hr_private.fail('One of the selected employees is not active.', 'employee_inactive');
    end if;
    if not hr_private.can_manage_training_of(v_emp) then
      perform hr_private.fail('You can only enroll employees in your reporting line (never yourself).', 'forbidden');
    end if;
    v_asg := hr_private.training_open_assignment(v_emp, v_c.id);
    if v_asg is null then
      insert into public.hr_training_assignments (employee_id, course_id, due_date, assigned_by, source, notes)
      values (v_emp, v_c.id, coalesce(p_due_date, v_s.session_date), auth.uid(), 'session', 'Session on ' || to_char(v_s.session_date, 'DD Mon YYYY'))
      returning id into v_asg;
    end if;
    v_res := hr_private.training_enroll_one(p_session, v_emp, v_asg);
    if v_res = 'enrolled' then v_enrolled := v_enrolled + 1; elsif v_res = 'waitlisted' then v_wait := v_wait + 1; else v_skip := v_skip + 1; end if;
  end loop;
  perform hr_private.audit_event('TRAINING_SESSION_ENROLLED', 'hr_training_sessions', p_session::text,
    jsonb_build_object('enrolled', v_enrolled, 'waitlisted', v_wait, 'skipped', v_skip));
  return jsonb_build_object('enrolled', v_enrolled, 'waitlisted', v_wait, 'skipped', v_skip);
end $$;

-- Employee books a seat in a session of a course assigned to them.
create or replace function public.hr_self_enroll_training_session(p_session uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_me uuid := hr_private.current_employee_id(); v_s public.hr_training_sessions; v_asg uuid; v_res text;
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  select * into v_s from public.hr_training_sessions where id = p_session for update;
  if v_s.id is null then perform hr_private.fail('Session not found.', 'not_found'); end if;
  if v_s.status <> 'scheduled' or v_s.session_date < hr_private.business_today() then
    perform hr_private.fail('Only upcoming scheduled sessions take enrollments.', 'invalid_status');
  end if;
  v_asg := hr_private.training_open_assignment(v_me, v_s.course_id);
  if v_asg is null then
    perform hr_private.fail('This course is not assigned to you. Ask HR or your manager to assign it first.', 'not_assigned');
  end if;
  v_res := hr_private.training_enroll_one(p_session, v_me, v_asg);
  if v_res = 'skipped' then perform hr_private.fail('You are already enrolled in this session.', 'already_enrolled'); end if;
  return v_res;
end $$;

create or replace function public.hr_withdraw_training_enrollment(p_enrollment uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_e public.hr_training_enrollments; v_s public.hr_training_sessions; v_self boolean; v_sid uuid;
begin
  select session_id into v_sid from public.hr_training_enrollments where id = p_enrollment;
  if v_sid is null then perform hr_private.fail('Enrollment not found.', 'not_found'); end if;
  select * into v_s from public.hr_training_sessions where id = v_sid for update;
  select * into v_e from public.hr_training_enrollments where id = p_enrollment for update;
  v_self := v_e.employee_id = hr_private.current_employee_id();
  if not v_self and not hr_private.can_manage_training_of(v_e.employee_id) then
    perform hr_private.fail('Enrollment not found.', 'not_found');
  end if;
  if v_e.status not in ('enrolled','waitlisted') then perform hr_private.fail('Only booked or waitlisted seats can be withdrawn.', 'invalid_status'); end if;
  if v_s.status <> 'scheduled' or v_s.session_date < hr_private.business_today() then
    perform hr_private.fail('The session has already taken place or is closed.', 'invalid_status');
  end if;
  if not v_self and length(btrim(coalesce(p_reason, ''))) < 3 then perform hr_private.fail('Give a reason.', 'reason_required'); end if;
  update public.hr_training_enrollments set status = 'cancelled', cancel_reason = left(nullif(btrim(p_reason), ''), 1000) where id = p_enrollment;
  if v_e.status = 'enrolled' then perform hr_private.training_promote_waitlist(v_sid); end if;
  if not v_self then
    perform hr_private.notify_employee(v_e.employee_id, 'training_session', 'Training seat withdrawn',
      to_char(v_s.session_date, 'DD Mon YYYY') || ': ' || btrim(p_reason), '/employee/training', 'hr_training_enrollment', v_e.id::text);
  end if;
end $$;

-- Attendance: [{ "enrollment_id": uuid, "status": "attended"|"absent" }].
-- p_record_completion: attended employees' open assignments are completed
-- (result 'attended', verified by the marker).
create or replace function public.hr_mark_training_attendance(p_session uuid, p_marks jsonb, p_record_completion boolean default false)
returns int language plpgsql security definer set search_path = '' as $$
declare v_s public.hr_training_sessions; v_e public.hr_training_enrollments; v_a public.hr_training_assignments; m record; n int := 0;
        v_title text; v_source text;
begin
  if not hr_private.any_permission(array['training.manage','training.assign_team']) then
    perform hr_private.fail('You are not allowed to mark training attendance.', 'forbidden');
  end if;
  select * into v_s from public.hr_training_sessions where id = p_session for update;
  if v_s.id is null then perform hr_private.fail('Session not found.', 'not_found'); end if;
  if v_s.status = 'cancelled' then perform hr_private.fail('The session was cancelled.', 'invalid_status'); end if;
  if v_s.session_date > hr_private.business_today() then perform hr_private.fail('Attendance can be marked on or after the session date.', 'too_early'); end if;
  if p_marks is null or jsonb_typeof(p_marks) <> 'array' or jsonb_array_length(p_marks) = 0 then
    perform hr_private.fail('Mark at least one employee.', 'invalid');
  end if;
  select title into v_title from public.hr_training_courses where id = v_s.course_id;
  v_source := case when hr_private.has_permission('training.manage') then 'hr' else 'manager' end;
  for m in select * from jsonb_to_recordset(p_marks) as x(enrollment_id uuid, status text) loop
    if m.status is null or m.status not in ('attended','absent') then perform hr_private.fail('Mark each employee attended or absent.', 'invalid'); end if;
    select * into v_e from public.hr_training_enrollments where id = m.enrollment_id and session_id = p_session for update;
    if v_e.id is null then perform hr_private.fail('An enrollment does not belong to this session.', 'invalid'); end if;
    if v_e.status not in ('enrolled','attended','absent') then
      perform hr_private.fail('Only confirmed (not waitlisted or withdrawn) seats can be marked.', 'invalid_status');
    end if;
    if not hr_private.can_manage_training_of(v_e.employee_id) then
      perform hr_private.fail('You can only mark attendance for your reporting line (never yourself).', 'forbidden');
    end if;
    update public.hr_training_enrollments set status = m.status, attendance_marked_by = auth.uid(), attendance_marked_at = now() where id = v_e.id;
    if m.status = 'attended' and v_e.assignment_id is not null then
      select * into v_a from public.hr_training_assignments where id = v_e.assignment_id for update;
      if p_record_completion and v_a.status in ('assigned','in_progress') then
        update public.hr_training_assignments set status = 'completed', completion_date = v_s.session_date, result = 'attended',
               completion_source = v_source, completed_by = auth.uid(), verified_by = auth.uid(), verified_at = now(),
               started_at = coalesce(started_at, now()),
               certificate_expiry = hr_private.training_expiry(v_a.course_id, v_s.session_date, 'attended')
         where id = v_a.id;
        perform hr_private.notify_employee(v_e.employee_id, 'training_completed', 'Training recorded: ' || v_title,
          'Your attendance on ' || to_char(v_s.session_date, 'DD Mon YYYY') || ' completed this training.', '/employee/training', 'hr_training_assignment', v_a.id::text);
      elsif v_a.status = 'assigned' then
        update public.hr_training_assignments set status = 'in_progress', started_at = coalesce(started_at, now()) where id = v_a.id;
      end if;
    end if;
    n := n + 1;
  end loop;
  perform hr_private.audit_event('TRAINING_ATTENDANCE_MARKED', 'hr_training_sessions', p_session::text,
    jsonb_build_object('marked', n, 'record_completion', coalesce(p_record_completion, false)));
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 9. Grants
-- ---------------------------------------------------------------------
revoke execute on function
  public.hr_complete_training(uuid, date, text, numeric, uuid, text),
  public.hr_submit_training_completion(uuid, date, text, numeric, text, uuid, uuid, text),
  public.hr_review_training_completion(uuid, boolean, text, text, numeric),
  public.hr_record_training_certificate(uuid, uuid, text, date, date),
  public.hr_renew_training(uuid, date),
  public.hr_generate_training_renewals(int),
  public.hr_assign_training_program(uuid, uuid[], date, text),
  public.hr_save_training_session(uuid, jsonb),
  public.hr_set_training_session_status(uuid, text, text),
  public.hr_list_training_sessions(date, date),
  public.hr_enroll_training_session(uuid, uuid[], date),
  public.hr_self_enroll_training_session(uuid),
  public.hr_withdraw_training_enrollment(uuid, text),
  public.hr_mark_training_attendance(uuid, jsonb, boolean)
from anon, public;
grant execute on function
  public.hr_complete_training(uuid, date, text, numeric, uuid, text),
  public.hr_submit_training_completion(uuid, date, text, numeric, text, uuid, uuid, text),
  public.hr_review_training_completion(uuid, boolean, text, text, numeric),
  public.hr_record_training_certificate(uuid, uuid, text, date, date),
  public.hr_renew_training(uuid, date),
  public.hr_generate_training_renewals(int),
  public.hr_assign_training_program(uuid, uuid[], date, text),
  public.hr_save_training_session(uuid, jsonb),
  public.hr_set_training_session_status(uuid, text, text),
  public.hr_list_training_sessions(date, date),
  public.hr_enroll_training_session(uuid, uuid[], date),
  public.hr_self_enroll_training_session(uuid),
  public.hr_withdraw_training_enrollment(uuid, text),
  public.hr_mark_training_attendance(uuid, jsonb, boolean)
to authenticated;
-- No blanket hr_private grant (see 197). The helpers below are only called
-- from the SECURITY DEFINER RPCs / triggers above (owner context), never
-- from RLS policies, so no API role may execute them.
revoke execute on function
  hr_private.training_expiry(uuid, date, text),
  hr_private.training_emp_name(uuid),
  hr_private.training_open_assignment(uuid, uuid),
  hr_private.training_employee_active(uuid),
  hr_private.training_seats_taken(uuid),
  hr_private.training_promote_waitlist(uuid),
  hr_private.training_enroll_one(uuid, uuid, uuid),
  hr_private.training_mark_onboarding_source()
from public, anon, authenticated;
revoke execute on function hr_lifecycle_internal.onboarding_training_sync() from public, anon, authenticated;
