-- =====================================================================
-- 104_hr_recruitment.sql — Recruitment pipeline, interviews, offers,
-- candidate -> employee conversion, internships and intern evaluations.
-- =====================================================================
-- Builds on 100_hr_foundation.sql. The public careers tables
-- (public.job_postings / public.job_applications) are NOT altered: HR data
-- lives in hr_* tables that reference them. RPCs may INSERT a job_postings
-- row (publish) and keep its open/closed status in step with the HR opening.
--
-- Candidate data protection: candidates/applications are visible only to
-- recruitment.view / recruitment.manage, the opening's hiring manager, and
-- employees on an interview panel for that application.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------
insert into public.hr_settings (key, value, description) values
  ('recruitment', jsonb_build_object('default_internship_months', 6, 'offer_validity_days', 7),
   'Recruitment defaults: internship length for intern hires, offer validity (days)')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Job openings (HR extension of a public job posting)
-- ---------------------------------------------------------------------
create table public.hr_job_openings (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid unique references public.job_postings(id) on delete set null,
  title             text not null check (length(btrim(title)) between 2 and 200),
  department_id     uuid references public.hr_departments(id) on delete restrict,
  employment_type   text not null default 'full_time' references public.hr_employment_types(code),
  openings          integer not null default 1 check (openings between 1 and 500),
  required_skills   text[] not null default '{}',
  experience_min    numeric(4,1) check (experience_min is null or experience_min between 0 and 60),
  experience_max    numeric(4,1) check (experience_max is null or experience_max between 0 and 60),
  location          text,
  description       text not null default '',
  posting_date      date,
  closing_date      date,
  hiring_manager_id uuid references public.hr_employees(id) on delete set null,
  status            text not null default 'draft' check (status in ('draft','open','on_hold','closed','filled')),
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (experience_max is null or experience_min is null or experience_max >= experience_min),
  check (closing_date is null or posting_date is null or closing_date >= posting_date)
);
create index hr_job_openings_status on public.hr_job_openings(status);
create index hr_job_openings_hm on public.hr_job_openings(hiring_manager_id);

-- ---------------------------------------------------------------------
-- Candidates (one per person, deduplicated by email) and applications
-- (candidate x opening, carries the pipeline stage)
-- ---------------------------------------------------------------------
create table public.hr_candidates (
  id                    uuid primary key default gen_random_uuid(),
  full_name             text not null check (length(btrim(full_name)) between 1 and 200),
  email                 citext not null unique check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone                 text check (phone is null or length(phone) <= 50),
  source                text not null default 'other'
                        check (source in ('careers_site','referral','linkedin','agency','campus','other')),
  source_application_id uuid unique references public.job_applications(id) on delete set null,
  resume_path           text check (resume_path is null or length(resume_path) <= 1000),  -- object path in private bucket 'resumes'
  current_company       text,
  experience_years      numeric(4,1) check (experience_years is null or experience_years between 0 and 60),
  notes                 text,
  created_by            uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table public.hr_candidate_applications (
  id                    uuid primary key default gen_random_uuid(),
  candidate_id          uuid not null references public.hr_candidates(id) on delete restrict,
  opening_id            uuid not null references public.hr_job_openings(id) on delete restrict,
  source_application_id uuid unique references public.job_applications(id) on delete set null,
  stage                 text not null default 'applied'
                        check (stage in ('applied','screening','shortlisted','interview','selected','rejected','offered','joined','withdrawn')),
  stage_changed_at      timestamptz not null default now(),
  rejected_reason       text,
  employee_id           uuid references public.hr_employees(id) on delete set null,  -- set on conversion
  created_by            uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (candidate_id, opening_id)
);
create index hr_candidate_applications_opening on public.hr_candidate_applications(opening_id, stage);

create table public.hr_candidate_stage_events (
  id             bigint generated always as identity primary key,
  application_id uuid not null references public.hr_candidate_applications(id) on delete cascade,
  from_stage     text,
  to_stage       text not null,
  note           text,
  changed_by     uuid,
  changed_at     timestamptz not null default now()
);
create index hr_candidate_stage_events_app on public.hr_candidate_stage_events(application_id, changed_at);

-- ---------------------------------------------------------------------
-- Interviews, panel, feedback
-- ---------------------------------------------------------------------
create table public.hr_interviews (
  id               uuid primary key default gen_random_uuid(),
  application_id   uuid not null references public.hr_candidate_applications(id) on delete cascade,
  round            smallint not null default 1 check (round between 1 and 20),
  interview_type   text not null default 'technical' check (interview_type in ('phone','technical','hr','managerial','other')),
  scheduled_at     timestamptz not null,
  duration_minutes smallint not null default 60 check (duration_minutes between 5 and 480),
  mode             text not null default 'video' check (mode in ('in_person','video','phone')),
  location_or_link text check (location_or_link is null or length(location_or_link) <= 1000),
  status           text not null default 'scheduled' check (status in ('scheduled','completed','cancelled','no_show')),
  notes            text,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index hr_interviews_app on public.hr_interviews(application_id);

create table public.hr_interview_panel (
  interview_id uuid not null references public.hr_interviews(id) on delete cascade,
  employee_id  uuid not null references public.hr_employees(id) on delete restrict,
  primary key (interview_id, employee_id)
);
create index hr_interview_panel_emp on public.hr_interview_panel(employee_id);

create table public.hr_interview_feedback (
  id             uuid primary key default gen_random_uuid(),
  interview_id   uuid not null references public.hr_interviews(id) on delete cascade,
  interviewer_id uuid not null references public.hr_employees(id) on delete restrict,
  rating         smallint not null check (rating between 1 and 5),
  recommendation text not null check (recommendation in ('strong_hire','hire','no_hire','strong_no_hire')),
  strengths      text,
  concerns       text,
  submitted_at   timestamptz not null default now(),
  unique (interview_id, interviewer_id)
);

-- ---------------------------------------------------------------------
-- Offers (annual_ctc is sensitive: rows readable by recruitment.manage only;
-- others use hr_get_application_offers(), which omits CTC)
-- ---------------------------------------------------------------------
create table public.hr_offers (
  id                     uuid primary key default gen_random_uuid(),
  application_id         uuid not null references public.hr_candidate_applications(id) on delete restrict,
  offered_designation_id uuid references public.hr_designations(id) on delete restrict,
  department_id          uuid references public.hr_departments(id) on delete restrict,
  employment_type        text not null references public.hr_employment_types(code),
  proposed_joining_date  date,
  annual_ctc             numeric(14,2) check (annual_ctc is null or annual_ctc >= 0),
  currency               text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  expires_on             date,
  status                 text not null default 'draft' check (status in ('draft','sent','accepted','declined','withdrawn','expired')),
  notes                  text,
  sent_at                timestamptz,
  responded_at           timestamptz,
  created_by             uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create unique index hr_offers_one_active on public.hr_offers(application_id) where status in ('draft','sent','accepted');

-- ---------------------------------------------------------------------
-- Internships & intern evaluations
-- ---------------------------------------------------------------------
create table public.hr_internships (
  id                     uuid primary key default gen_random_uuid(),
  employee_id            uuid not null references public.hr_employees(id) on delete restrict,
  mentor_id              uuid references public.hr_employees(id) on delete set null,
  department_id          uuid references public.hr_departments(id) on delete restrict,
  start_date             date not null,
  end_date               date,
  project                text,
  learning_goals         text,
  status                 text not null default 'active' check (status in ('active','completed','terminated','converted')),
  completion_date        date,
  certificate_eligible   boolean not null default false,
  certificate_issued_at  timestamptz,
  converted_at           timestamptz,
  converted_employment_type text references public.hr_employment_types(code),
  source_application_id  uuid references public.hr_candidate_applications(id) on delete set null,
  created_by             uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (end_date is null or end_date >= start_date),
  check (mentor_id is null or mentor_id <> employee_id),
  check (certificate_issued_at is null or certificate_eligible)
);
create unique index hr_internships_one_active on public.hr_internships(employee_id) where status = 'active';
create index hr_internships_mentor on public.hr_internships(mentor_id);

create or replace function hr_private.valid_ratings(p jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'object'
     and not exists (select 1 from jsonb_each(p) r
                     where jsonb_typeof(r.value) <> 'number' or (r.value)::text::numeric not between 1 and 5)
$$;

create table public.hr_intern_evaluations (
  id             uuid primary key default gen_random_uuid(),
  internship_id  uuid not null references public.hr_internships(id) on delete cascade,
  evaluator_id   uuid not null references public.hr_employees(id) on delete restrict,
  period         text not null check (length(btrim(period)) between 1 and 60),   -- e.g. 'Month 1', '2026-11'
  period_start   date,
  period_end     date,
  ratings        jsonb not null default '{}'::jsonb check (hr_private.valid_ratings(ratings)),  -- {"technical":4,"communication":5}
  overall_rating numeric(2,1) check (overall_rating is null or overall_rating between 1 and 5),
  comments       text,
  recommendation text check (recommendation is null or recommendation in ('continue','convert','complete','terminate')),
  status         text not null default 'draft' check (status in ('draft','finalized')),
  finalized_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (period_end is null or period_start is null or period_end >= period_start),
  check (status = 'draft' or (overall_rating is not null and recommendation is not null))
);
create index hr_intern_evaluations_internship on public.hr_intern_evaluations(internship_id);

-- ---------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------
create or replace function hr_private.is_recruiter()
returns boolean language sql stable security definer set search_path = '' as $$
  select hr_private.has_permission('recruitment.view') or hr_private.has_permission('recruitment.manage')
$$;

create or replace function hr_private.is_interviewer_for_application(p_application uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select hr_private.current_employee_id() is not null and exists (
    select 1 from public.hr_interviews i join public.hr_interview_panel p on p.interview_id = i.id
    where i.application_id = p_application and p.employee_id = hr_private.current_employee_id())
$$;

create or replace function hr_private.is_hiring_manager_for_application(p_application uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select hr_private.current_employee_id() is not null and exists (
    select 1 from public.hr_candidate_applications a join public.hr_job_openings o on o.id = a.opening_id
    where a.id = p_application and o.hiring_manager_id = hr_private.current_employee_id())
$$;

create or replace function hr_private.can_view_application(p_application uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_application is not null and (
       hr_private.is_recruiter()
    or hr_private.is_hiring_manager_for_application(p_application)
    or hr_private.is_interviewer_for_application(p_application))
$$;

create or replace function hr_private.can_view_candidate(p_candidate uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_candidate is not null and (
       hr_private.is_recruiter()
    or exists (select 1 from public.hr_candidate_applications a
               where a.candidate_id = p_candidate
                 and (hr_private.is_hiring_manager_for_application(a.id) or hr_private.is_interviewer_for_application(a.id))))
$$;

create or replace function hr_private.can_view_opening(p_opening uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_opening is not null and (
       hr_private.is_recruiter()
    or exists (select 1 from public.hr_job_openings o where o.id = p_opening and o.hiring_manager_id = hr_private.current_employee_id())
    or exists (select 1 from public.hr_candidate_applications a where a.opening_id = p_opening and hr_private.is_interviewer_for_application(a.id)))
$$;

-- Resume objects (bucket 'resumes') readable by whoever may see the candidate.
create or replace function hr_private.can_view_resume(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select hr_private.is_recruiter()
      or exists (select 1 from public.hr_candidates c where c.resume_path = p_name and hr_private.can_view_candidate(c.id))
$$;

-- Mentor of an employee's current (or any) internship.
create or replace function hr_private.is_mentor_of(p_employee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select hr_private.current_employee_id() is not null and exists (
    select 1 from public.hr_internships i where i.employee_id = p_employee and i.mentor_id = hr_private.current_employee_id())
$$;

-- Valid pipeline transitions. 'joined' is reached only through conversion.
create or replace function hr_private.candidate_stage_allowed(p_from text, p_to text)
returns boolean language sql immutable set search_path = '' as $$
  select case p_from
    when 'applied'     then p_to in ('screening','rejected','withdrawn')
    when 'screening'   then p_to in ('shortlisted','rejected','withdrawn')
    when 'shortlisted' then p_to in ('interview','rejected','withdrawn')
    when 'interview'   then p_to in ('selected','rejected','withdrawn')
    when 'selected'    then p_to in ('offered','rejected','withdrawn')
    when 'offered'     then p_to in ('joined','rejected','withdrawn')
    else false
  end
$$;

-- Normalise a careers resume reference to a storage object path.
create or replace function hr_private.resume_object_path(p_ref text)
returns text language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(regexp_replace(coalesce(p_ref, ''), '^.*/storage/v1/object/(public|sign|authenticated)/resumes/', ''), '\?.*$', ''), '')
$$;

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
create or replace function hr_private.recruitment_set_created_by()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
  return new;
end $$;

create trigger hr_job_openings_created_by before insert on public.hr_job_openings for each row execute function hr_private.recruitment_set_created_by();
create trigger hr_candidates_created_by before insert on public.hr_candidates for each row execute function hr_private.recruitment_set_created_by();
create trigger hr_candidate_applications_created_by before insert on public.hr_candidate_applications for each row execute function hr_private.recruitment_set_created_by();
create trigger hr_interviews_created_by before insert on public.hr_interviews for each row execute function hr_private.recruitment_set_created_by();
create trigger hr_offers_created_by before insert on public.hr_offers for each row execute function hr_private.recruitment_set_created_by();
create trigger hr_internships_created_by before insert on public.hr_internships for each row execute function hr_private.recruitment_set_created_by();

create trigger hr_job_openings_touch before update on public.hr_job_openings for each row execute function hr_private.touch_updated_at();
create trigger hr_candidates_touch before update on public.hr_candidates for each row execute function hr_private.touch_updated_at();
create trigger hr_candidate_applications_touch before update on public.hr_candidate_applications for each row execute function hr_private.touch_updated_at();
create trigger hr_interviews_touch before update on public.hr_interviews for each row execute function hr_private.touch_updated_at();
create trigger hr_offers_touch before update on public.hr_offers for each row execute function hr_private.touch_updated_at();
create trigger hr_internships_touch before update on public.hr_internships for each row execute function hr_private.touch_updated_at();
create trigger hr_intern_evaluations_touch before update on public.hr_intern_evaluations for each row execute function hr_private.touch_updated_at();

-- Initial stage event for every new application.
create or replace function hr_private.candidate_application_created()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.hr_candidate_stage_events (application_id, from_stage, to_stage, note, changed_by)
  values (new.id, null, new.stage, nullif(current_setting('hr.stage_note', true), ''), auth.uid());
  return new;
end $$;
create trigger hr_candidate_applications_created after insert on public.hr_candidate_applications
  for each row execute function hr_private.candidate_application_created();

-- Keep the public posting's open/closed state in step with the HR opening.
-- (Writes DATA to job_postings; its schema/triggers are untouched.)
create or replace function hr_private.job_opening_sync_posting()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.job_id is not null and new.status is distinct from old.status then
    update public.job_postings
       set status = case when new.status = 'open' then 'open' else 'closed' end
     where id = new.job_id
       and status is distinct from (case when new.status = 'open' then 'open' else 'closed' end);
  end if;
  return new;
end $$;
create trigger hr_job_openings_sync_posting after update of status on public.hr_job_openings
  for each row execute function hr_private.job_opening_sync_posting();

-- Internship guard: the intern must be an intern-type employee; 'converted'
-- is reached only through hr_convert_intern_to_employee().
create or replace function hr_private.internships_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_type text; v_dep uuid;
begin
  if tg_op = 'INSERT' then
    select e.employment_type, e.department_id into v_type, v_dep from public.hr_employees e where e.id = new.employee_id;
    if not exists (select 1 from public.hr_employment_types t where t.code = v_type and t.is_intern) then
      perform hr_private.fail('Internships can only be created for intern employees.', 'not_intern');
    end if;
    new.department_id := coalesce(new.department_id, v_dep);
    if new.status = 'converted' then perform hr_private.fail('Use the intern conversion workflow.', 'use_conversion_workflow'); end if;
  else
    if new.employee_id is distinct from old.employee_id then
      perform hr_private.fail('The intern on an internship cannot be changed.', 'immutable');
    end if;
    if old.status = 'converted' and current_setting('hr.recruitment_rpc', true) is distinct from 'on' then
      perform hr_private.fail('A converted internship cannot be changed.', 'invalid_state');
    end if;
    if new.status = 'converted' and old.status <> 'converted' and current_setting('hr.recruitment_rpc', true) is distinct from 'on' then
      perform hr_private.fail('Use the intern conversion workflow.', 'use_conversion_workflow');
    end if;
    if new.status in ('completed','terminated') and new.completion_date is null then
      new.completion_date := hr_private.business_today();
    end if;
  end if;
  return new;
end $$;
create trigger hr_internships_guard before insert or update on public.hr_internships
  for each row execute function hr_private.internships_guard();

-- Evaluation guard: finalized evaluations are immutable; finalizing stamps
-- the time and notifies the intern.
create or replace function hr_private.intern_evaluations_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_intern uuid;
begin
  select employee_id into v_intern from public.hr_internships where id = new.internship_id;
  if tg_op = 'UPDATE' then
    if old.status = 'finalized' then
      perform hr_private.fail('A finalized evaluation cannot be changed.', 'invalid_state');
    end if;
    if new.internship_id is distinct from old.internship_id or new.evaluator_id is distinct from old.evaluator_id then
      perform hr_private.fail('Evaluation internship/evaluator cannot be changed.', 'immutable');
    end if;
  end if;
  if new.evaluator_id = v_intern then
    perform hr_private.fail('Interns cannot evaluate themselves.', 'forbidden');
  end if;
  if new.status = 'finalized' and (tg_op = 'INSERT' or old.status <> 'finalized') then
    new.finalized_at := now();
    perform hr_private.notify_employee(v_intern, 'intern_evaluation', 'Your internship evaluation is available',
      'Evaluation for ' || new.period || ' has been finalized.', '/employee/internship', 'hr_intern_evaluations', new.id::text);
  end if;
  return new;
end $$;
create trigger hr_intern_evaluations_guard before insert or update on public.hr_intern_evaluations
  for each row execute function hr_private.intern_evaluations_guard();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
select hr_private.secure_table('public.hr_job_openings');
create policy hr_job_openings_read on public.hr_job_openings for select to authenticated using (hr_private.can_view_opening(id));
create policy hr_job_openings_insert on public.hr_job_openings for insert to authenticated with check (hr_private.has_permission('recruitment.manage'));
create policy hr_job_openings_update on public.hr_job_openings for update to authenticated
  using (hr_private.has_permission('recruitment.manage')) with check (hr_private.has_permission('recruitment.manage'));
-- No delete: openings are closed, never deleted.

select hr_private.secure_table('public.hr_candidates');
create policy hr_candidates_read on public.hr_candidates for select to authenticated using (hr_private.can_view_candidate(id));
create policy hr_candidates_insert on public.hr_candidates for insert to authenticated with check (hr_private.has_permission('recruitment.manage'));
create policy hr_candidates_update on public.hr_candidates for update to authenticated
  using (hr_private.has_permission('recruitment.manage')) with check (hr_private.has_permission('recruitment.manage'));

select hr_private.secure_table('public.hr_candidate_applications');
create policy hr_candidate_applications_read on public.hr_candidate_applications for select to authenticated using (hr_private.can_view_application(id));
create policy hr_candidate_applications_insert on public.hr_candidate_applications for insert to authenticated
  with check (hr_private.has_permission('recruitment.manage') and stage = 'applied' and employee_id is null);
-- Stage changes only through hr_move_candidate_stage / offers / conversion.
revoke update, delete on public.hr_candidate_applications from authenticated;

select hr_private.secure_table('public.hr_candidate_stage_events');
create policy hr_candidate_stage_events_read on public.hr_candidate_stage_events for select to authenticated using (hr_private.can_view_application(application_id));
revoke insert, update, delete on public.hr_candidate_stage_events from authenticated;

select hr_private.secure_table('public.hr_interviews');
create policy hr_interviews_read on public.hr_interviews for select to authenticated using (hr_private.can_view_application(application_id));
create policy hr_interviews_insert on public.hr_interviews for insert to authenticated with check (hr_private.has_permission('recruitment.manage'));
create policy hr_interviews_update on public.hr_interviews for update to authenticated
  using (hr_private.has_permission('recruitment.manage')) with check (hr_private.has_permission('recruitment.manage'));

select hr_private.secure_table('public.hr_interview_panel');
create policy hr_interview_panel_read on public.hr_interview_panel for select to authenticated
  using (exists (select 1 from public.hr_interviews i where i.id = interview_id and hr_private.can_view_application(i.application_id)));
create policy hr_interview_panel_insert on public.hr_interview_panel for insert to authenticated with check (hr_private.has_permission('recruitment.manage'));
create policy hr_interview_panel_delete on public.hr_interview_panel for delete to authenticated using (hr_private.has_permission('recruitment.manage'));

-- Feedback: recruiters and the hiring manager see all; an interviewer sees
-- only their own (avoids anchoring on other panelists). Written via RPC.
select hr_private.secure_table('public.hr_interview_feedback');
create policy hr_interview_feedback_read on public.hr_interview_feedback for select to authenticated using (
     interviewer_id = hr_private.current_employee_id()
  or exists (select 1 from public.hr_interviews i where i.id = interview_id
             and (hr_private.is_recruiter() or hr_private.is_hiring_manager_for_application(i.application_id))));
revoke insert, update, delete on public.hr_interview_feedback from authenticated;

select hr_private.secure_table('public.hr_offers');
create policy hr_offers_read on public.hr_offers for select to authenticated using (hr_private.has_permission('recruitment.manage'));
revoke insert, update, delete on public.hr_offers from authenticated;

select hr_private.secure_table('public.hr_internships');
create policy hr_internships_read on public.hr_internships for select to authenticated using (
     hr_private.can_access_employee(employee_id, 'interns')   -- self, interns.view, interns.view_team (reporting line)
  or mentor_id = hr_private.current_employee_id()            -- mentor (need not be the manager)
  or hr_private.has_permission('interns.manage'));
create policy hr_internships_insert on public.hr_internships for insert to authenticated with check (hr_private.has_permission('interns.manage'));
create policy hr_internships_update on public.hr_internships for update to authenticated
  using (hr_private.has_permission('interns.manage')) with check (hr_private.has_permission('interns.manage'));

-- Evaluations: HR / mentor / reporting-line managers see all; the evaluator
-- sees their own; the intern sees only finalized ones.
select hr_private.secure_table('public.hr_intern_evaluations');
create policy hr_intern_evaluations_read on public.hr_intern_evaluations for select to authenticated using (
  exists (select 1 from public.hr_internships i where i.id = internship_id and (
       hr_private.has_permission('interns.view') or hr_private.has_permission('interns.manage')
    or i.mentor_id = hr_private.current_employee_id()
    or (hr_private.has_permission('interns.view_team') and hr_private.is_manager_of(i.employee_id))
    or (i.employee_id = hr_private.current_employee_id() and hr_intern_evaluations.status = 'finalized')))
  or evaluator_id = hr_private.current_employee_id());
create policy hr_intern_evaluations_insert on public.hr_intern_evaluations for insert to authenticated with check (
  evaluator_id = hr_private.current_employee_id()
  and exists (select 1 from public.hr_internships i where i.id = internship_id and i.status = 'active'
              and (i.mentor_id = hr_private.current_employee_id() or hr_private.has_permission('interns.manage')
                   or (hr_private.has_permission('interns.view_team') and hr_private.is_manager_of(i.employee_id)))));
create policy hr_intern_evaluations_update on public.hr_intern_evaluations for update to authenticated
  using (evaluator_id = hr_private.current_employee_id() or hr_private.has_permission('interns.manage'))
  with check (evaluator_id = hr_private.current_employee_id() or hr_private.has_permission('interns.manage'));
create policy hr_intern_evaluations_delete on public.hr_intern_evaluations for delete to authenticated
  using (status = 'draft' and (evaluator_id = hr_private.current_employee_id() or hr_private.has_permission('interns.manage')));

-- Storage: HR recruiters (and others allowed to see the candidate) can read
-- resumes in the private 'resumes' bucket via signed URLs. Additive policy;
-- the existing admin policies are unchanged.
drop policy if exists "resumes: hr recruitment read" on storage.objects;
create policy "resumes: hr recruitment read" on storage.objects for select to authenticated
  using (bucket_id = 'resumes' and hr_private.can_view_resume(name));

-- Audit
select hr_private.enable_audit('public.hr_job_openings');
select hr_private.enable_audit('public.hr_candidates', array['phone']);
select hr_private.enable_audit('public.hr_candidate_applications');
select hr_private.enable_audit('public.hr_interview_feedback');
select hr_private.enable_audit('public.hr_offers', array['annual_ctc']);
select hr_private.enable_audit('public.hr_internships');
select hr_private.enable_audit('public.hr_intern_evaluations');

-- ---------------------------------------------------------------------
-- Internal helpers for RPCs
-- ---------------------------------------------------------------------
create or replace function hr_private.set_candidate_stage(p_application uuid, p_to text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_from text;
begin
  select stage into v_from from public.hr_candidate_applications where id = p_application for update;
  if v_from = p_to then return; end if;
  update public.hr_candidate_applications
     set stage = p_to, stage_changed_at = now(),
         rejected_reason = case when p_to = 'rejected' then p_note else rejected_reason end
   where id = p_application;
  insert into public.hr_candidate_stage_events (application_id, from_stage, to_stage, note, changed_by)
  values (p_application, v_from, p_to, p_note, auth.uid());
end $$;

create or replace function hr_private.employment_type_from_label(p_label text)
returns text language sql immutable set search_path = '' as $$
  select case
    when lower(regexp_replace(coalesce(p_label, ''), '[^a-zA-Z]', '', 'g')) like 'intern%' then 'intern'
    when lower(regexp_replace(coalesce(p_label, ''), '[^a-zA-Z]', '', 'g')) like 'parttime%' then 'part_time'
    when lower(regexp_replace(coalesce(p_label, ''), '[^a-zA-Z]', '', 'g')) like 'contract%' then 'contract'
    when lower(regexp_replace(coalesce(p_label, ''), '[^a-zA-Z]', '', 'g')) like 'consult%' then 'consultant'
    else 'full_time' end
$$;

-- Create the public careers posting for an opening (status open).
create or replace function hr_private.publish_opening_posting(p_opening uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare o public.hr_job_openings; v_job uuid;
begin
  select * into o from public.hr_job_openings where id = p_opening for update;
  if o.job_id is not null then
    update public.job_postings set status = 'open' where id = o.job_id and status <> 'open';
    return o.job_id;
  end if;
  insert into public.job_postings (title, department, location, employment_type, description, total_openings, status)
  values (o.title,
          coalesce((select name from public.hr_departments where id = o.department_id), 'General'),
          coalesce(nullif(btrim(o.location), ''), 'Remote / India'),
          coalesce((select name from public.hr_employment_types where code = o.employment_type), 'Full-time'),
          coalesce(o.description, ''), o.openings, 'open')
  returning id into v_job;
  update public.hr_job_openings set job_id = v_job where id = p_opening;
  return v_job;
end $$;

-- ---------------------------------------------------------------------
-- Public RPCs: openings & candidates
-- ---------------------------------------------------------------------
create or replace function public.hr_create_job_opening(
  p_title text, p_department uuid default null, p_employment_type text default 'full_time',
  p_openings integer default 1, p_required_skills text[] default '{}',
  p_experience_min numeric default null, p_experience_max numeric default null,
  p_location text default null, p_description text default '', p_closing_date date default null,
  p_hiring_manager uuid default null, p_publish boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not hr_private.has_permission('recruitment.manage') then
    perform hr_private.fail('You are not allowed to manage job openings.', 'forbidden');
  end if;
  if p_title is null or length(btrim(p_title)) < 2 then perform hr_private.fail('Enter a job title.', 'invalid'); end if;
  if not exists (select 1 from public.hr_employment_types where code = p_employment_type and active) then
    perform hr_private.fail('Unknown employment type.', 'invalid');
  end if;
  if p_hiring_manager is not null and not exists (
       select 1 from public.hr_employees where id = p_hiring_manager and status not in ('exited','archived','suspended')) then
    perform hr_private.fail('Hiring manager must be an active employee.', 'invalid');
  end if;
  if p_closing_date is not null and p_closing_date < hr_private.business_today() then
    perform hr_private.fail('Closing date cannot be in the past.', 'invalid');
  end if;
  insert into public.hr_job_openings (title, department_id, employment_type, openings, required_skills,
      experience_min, experience_max, location, description, posting_date, closing_date, hiring_manager_id, status)
  values (btrim(p_title), p_department, p_employment_type, coalesce(p_openings, 1), coalesce(p_required_skills, '{}'),
      p_experience_min, p_experience_max, nullif(btrim(p_location), ''), coalesce(p_description, ''),
      case when p_publish then hr_private.business_today() end, p_closing_date, p_hiring_manager,
      case when p_publish then 'open' else 'draft' end)
  returning id into v_id;
  if p_publish then perform hr_private.publish_opening_posting(v_id); end if;
  if p_hiring_manager is not null then
    perform hr_private.notify_employee(p_hiring_manager, 'recruitment_opening', 'You are the hiring manager for ' || btrim(p_title),
      null, '/hr/recruitment', 'hr_job_openings', v_id::text);
  end if;
  return v_id;
end $$;

-- Publish an existing (draft / on-hold) opening to the careers site.
create or replace function public.hr_publish_job_opening(p_opening uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare o public.hr_job_openings; v_job uuid;
begin
  if not hr_private.has_permission('recruitment.manage') then
    perform hr_private.fail('You are not allowed to manage job openings.', 'forbidden');
  end if;
  select * into o from public.hr_job_openings where id = p_opening for update;
  if o.id is null then perform hr_private.fail('Job opening not found.', 'not_found'); end if;
  if o.status in ('closed','filled') then perform hr_private.fail('A closed or filled opening cannot be published.', 'invalid_state'); end if;
  update public.hr_job_openings set status = 'open', posting_date = coalesce(posting_date, hr_private.business_today()) where id = p_opening;
  v_job := hr_private.publish_opening_posting(p_opening);
  return v_job;
end $$;

-- Add a candidate (deduplicated by email) to an opening. Returns the application id.
create or replace function public.hr_add_candidate(
  p_opening uuid, p_full_name text, p_email text, p_phone text default null, p_source text default 'other',
  p_resume_path text default null, p_current_company text default null, p_experience_years numeric default null,
  p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_cand uuid; v_app uuid; v_status text;
begin
  if not hr_private.has_permission('recruitment.manage') then
    perform hr_private.fail('You are not allowed to manage candidates.', 'forbidden');
  end if;
  select status into v_status from public.hr_job_openings where id = p_opening;
  if v_status is null then perform hr_private.fail('Job opening not found.', 'not_found'); end if;
  if v_status in ('closed','filled') then perform hr_private.fail('This opening is closed.', 'invalid_state'); end if;
  if p_email is null or btrim(p_email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    perform hr_private.fail('Enter a valid candidate email.', 'invalid');
  end if;
  insert into public.hr_candidates (full_name, email, phone, source, resume_path, current_company, experience_years, notes)
  values (btrim(p_full_name), lower(btrim(p_email)), nullif(btrim(p_phone), ''), coalesce(p_source, 'other'),
          nullif(btrim(p_resume_path), ''), nullif(btrim(p_current_company), ''), p_experience_years, p_notes)
  on conflict (email) do update set
    resume_path = coalesce(public.hr_candidates.resume_path, excluded.resume_path),
    phone = coalesce(public.hr_candidates.phone, excluded.phone)
  returning id into v_cand;
  if exists (select 1 from public.hr_candidate_applications where candidate_id = v_cand and opening_id = p_opening) then
    perform hr_private.fail('This candidate is already in the pipeline for this opening.', 'duplicate_candidate');
  end if;
  insert into public.hr_candidate_applications (candidate_id, opening_id) values (v_cand, p_opening) returning id into v_app;
  return v_app;
end $$;

-- Import careers-site applications for a posting (idempotent).
create or replace function public.hr_import_careers_applications(p_job_posting uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  jp public.job_postings;
  v_opening uuid;
  r record;
  v_cand uuid;
  v_n int;
  v_imported int := 0;
  v_skipped int := 0;
begin
  if not hr_private.has_permission('recruitment.manage') then
    perform hr_private.fail('You are not allowed to import applications.', 'forbidden');
  end if;
  select * into jp from public.job_postings where id = p_job_posting;
  if jp.id is null then perform hr_private.fail('Job posting not found.', 'not_found'); end if;

  select id into v_opening from public.hr_job_openings where job_id = p_job_posting;
  if v_opening is null then
    insert into public.hr_job_openings (job_id, title, department_id, employment_type, openings, location, description, posting_date, status)
    values (jp.id, jp.title,
            (select d.id from public.hr_departments d where lower(d.name) = lower(jp.department) or lower(d.code) = lower(jp.department) limit 1),
            hr_private.employment_type_from_label(jp.employment_type), greatest(coalesce(jp.total_openings, 1), 1),
            jp.location, coalesce(jp.description, ''), (jp.created_at at time zone hr_private.business_timezone())::date,
            case when jp.status = 'open' then 'open' else 'closed' end)
    on conflict (job_id) do nothing
    returning id into v_opening;
    if v_opening is null then select id into v_opening from public.hr_job_openings where job_id = p_job_posting; end if;
  end if;

  for r in select * from public.job_applications a where a.job_id = p_job_posting order by a.created_at, a.id loop
    if exists (select 1 from public.hr_candidate_applications where source_application_id = r.id) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    if btrim(r.email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    insert into public.hr_candidates (full_name, email, phone, source, source_application_id, resume_path, experience_years)
    values (btrim(r.full_name), lower(btrim(r.email)), nullif(btrim(r.phone), ''), 'careers_site', r.id,
            hr_private.resume_object_path(r.resume_url), case when r.experience_years between 0 and 60 then r.experience_years end)
    on conflict (email) do update set
      resume_path = coalesce(public.hr_candidates.resume_path, excluded.resume_path)
    returning id into v_cand;

    perform set_config('hr.stage_note', 'Imported from careers site (status: ' || r.status || ')', true);
    insert into public.hr_candidate_applications (candidate_id, opening_id, source_application_id, stage, created_at)
    values (v_cand, v_opening, r.id,
            case r.status when 'new' then 'applied' when 'reviewed' then 'screening' when 'shortlisted' then 'shortlisted'
                          when 'interview' then 'interview' when 'offer' then 'selected' when 'hired' then 'selected'
                          when 'rejected' then 'rejected' else 'applied' end,
            r.created_at)
    on conflict do nothing;
    get diagnostics v_n = row_count;
    perform set_config('hr.stage_note', '', true);
    if v_n = 1 then v_imported := v_imported + 1; else v_skipped := v_skipped + 1; end if;
  end loop;

  perform hr_private.audit_event('CAREERS_IMPORT', 'hr_job_openings', v_opening::text,
    jsonb_build_object('job_posting', p_job_posting, 'imported', v_imported, 'skipped', v_skipped));
  return jsonb_build_object('opening_id', v_opening, 'imported', v_imported, 'skipped', v_skipped);
end $$;

create or replace function public.hr_move_candidate_stage(p_application uuid, p_to_stage text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.hr_candidate_applications;
begin
  if not hr_private.has_permission('recruitment.manage') then
    perform hr_private.fail('You are not allowed to move candidates.', 'forbidden');
  end if;
  select * into a from public.hr_candidate_applications where id = p_application for update;
  if a.id is null then perform hr_private.fail('Application not found.', 'not_found'); end if;
  if p_to_stage = 'joined' then
    perform hr_private.fail('Candidates join through the conversion workflow.', 'use_conversion_workflow');
  end if;
  if not hr_private.candidate_stage_allowed(a.stage, p_to_stage) then
    perform hr_private.fail(format('A candidate cannot move from %s to %s.', a.stage, coalesce(p_to_stage, '(none)')), 'invalid_transition');
  end if;
  if p_to_stage = 'offered' and not exists (
       select 1 from public.hr_offers where application_id = p_application and status in ('sent','accepted')) then
    perform hr_private.fail('Send an offer before moving the candidate to Offered.', 'offer_required');
  end if;
  if p_to_stage = 'rejected' and nullif(btrim(p_note), '') is null then
    perform hr_private.fail('Give a reason for rejecting the candidate.', 'reason_required');
  end if;
  perform hr_private.set_candidate_stage(p_application, p_to_stage, nullif(btrim(p_note), ''));
  if p_to_stage in ('rejected','withdrawn') then
    update public.hr_interviews set status = 'cancelled' where application_id = p_application and status = 'scheduled';
    update public.hr_offers set status = 'withdrawn' where application_id = p_application and status in ('draft','sent');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Public RPCs: interviews & feedback
-- ---------------------------------------------------------------------
create or replace function public.hr_schedule_interview(
  p_application uuid, p_scheduled_at timestamptz, p_interviewers uuid[],
  p_round integer default 1, p_type text default 'technical', p_duration_minutes integer default 60,
  p_mode text default 'video', p_location_or_link text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare a public.hr_candidate_applications; v_id uuid; v_emp uuid;
begin
  if not hr_private.has_permission('recruitment.manage') then
    perform hr_private.fail('You are not allowed to schedule interviews.', 'forbidden');
  end if;
  select * into a from public.hr_candidate_applications where id = p_application for update;
  if a.id is null then perform hr_private.fail('Application not found.', 'not_found'); end if;
  if a.stage not in ('shortlisted','interview') then
    perform hr_private.fail('Only shortlisted candidates can be interviewed.', 'invalid_state');
  end if;
  if coalesce(array_length(p_interviewers, 1), 0) = 0 then
    perform hr_private.fail('Add at least one interviewer.', 'invalid');
  end if;
  if exists (select 1 from unnest(p_interviewers) x(id)
             where not exists (select 1 from public.hr_employees e where e.id = x.id and e.status not in ('exited','archived','suspended'))) then
    perform hr_private.fail('Every interviewer must be an active employee.', 'invalid');
  end if;
  insert into public.hr_interviews (application_id, round, interview_type, scheduled_at, duration_minutes, mode, location_or_link)
  values (p_application, coalesce(p_round, 1), coalesce(p_type, 'technical'), p_scheduled_at, coalesce(p_duration_minutes, 60),
          coalesce(p_mode, 'video'), nullif(btrim(p_location_or_link), ''))
  returning id into v_id;
  insert into public.hr_interview_panel (interview_id, employee_id) select distinct v_id, x from unnest(p_interviewers) x;
  if a.stage = 'shortlisted' then
    perform hr_private.set_candidate_stage(p_application, 'interview', 'Interview scheduled');
  end if;
  foreach v_emp in array p_interviewers loop
    perform hr_private.notify_employee(v_emp, 'interview_assigned', 'You have been added to an interview panel',
      'Scheduled for ' || to_char(p_scheduled_at at time zone hr_private.business_timezone(), 'DD Mon YYYY HH24:MI'),
      '/hr/recruitment/interviews', 'hr_interviews', v_id::text);
  end loop;
  return v_id;
end $$;

create or replace function public.hr_submit_interview_feedback(
  p_interview uuid, p_rating integer, p_recommendation text, p_strengths text default null, p_concerns text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare i public.hr_interviews; v_me uuid := hr_private.current_employee_id(); v_id uuid;
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  select * into i from public.hr_interviews where id = p_interview for update;
  if i.id is null or not exists (select 1 from public.hr_interview_panel where interview_id = p_interview and employee_id = v_me) then
    perform hr_private.fail('Only interviewers on this panel can submit feedback.', 'forbidden');
  end if;
  if i.status in ('cancelled','no_show') then perform hr_private.fail('This interview did not take place.', 'invalid_state'); end if;
  if i.scheduled_at > now() then perform hr_private.fail('Feedback can be submitted after the interview has started.', 'too_early'); end if;
  if exists (select 1 from public.hr_interview_feedback where interview_id = p_interview and interviewer_id = v_me) then
    perform hr_private.fail('You have already submitted feedback for this interview.', 'already_submitted');
  end if;
  insert into public.hr_interview_feedback (interview_id, interviewer_id, rating, recommendation, strengths, concerns)
  values (p_interview, v_me, p_rating, p_recommendation, p_strengths, p_concerns) returning id into v_id;
  if i.status = 'scheduled' then update public.hr_interviews set status = 'completed' where id = p_interview; end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Public RPCs: offers
-- ---------------------------------------------------------------------
create or replace function public.hr_create_offer(
  p_application uuid, p_designation uuid default null, p_department uuid default null, p_employment_type text default null,
  p_joining_date date default null, p_annual_ctc numeric default null, p_expires_on date default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare a public.hr_candidate_applications; o public.hr_job_openings; v_id uuid;
begin
  if not hr_private.has_permission('recruitment.manage') then
    perform hr_private.fail('You are not allowed to manage offers.', 'forbidden');
  end if;
  select * into a from public.hr_candidate_applications where id = p_application for update;
  if a.id is null then perform hr_private.fail('Application not found.', 'not_found'); end if;
  if a.stage not in ('selected','offered') then perform hr_private.fail('Only selected candidates can receive an offer.', 'invalid_state'); end if;
  if exists (select 1 from public.hr_offers where application_id = p_application and status in ('draft','sent','accepted')) then
    perform hr_private.fail('This candidate already has an active offer.', 'duplicate_offer');
  end if;
  select * into o from public.hr_job_openings where id = a.opening_id;
  insert into public.hr_offers (application_id, offered_designation_id, department_id, employment_type, proposed_joining_date,
                                annual_ctc, expires_on, notes)
  values (p_application, p_designation, coalesce(p_department, o.department_id), coalesce(p_employment_type, o.employment_type),
          p_joining_date, p_annual_ctc,
          coalesce(p_expires_on, hr_private.business_today() + coalesce((hr_private.setting('recruitment') ->> 'offer_validity_days')::int, 7)),
          p_notes)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.hr_send_offer(p_offer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare f public.hr_offers; v_stage text;
begin
  if not hr_private.has_permission('recruitment.manage') then
    perform hr_private.fail('You are not allowed to manage offers.', 'forbidden');
  end if;
  select * into f from public.hr_offers where id = p_offer for update;
  if f.id is null then perform hr_private.fail('Offer not found.', 'not_found'); end if;
  if f.status <> 'draft' then perform hr_private.fail('Only a draft offer can be sent.', 'invalid_state'); end if;
  select stage into v_stage from public.hr_candidate_applications where id = f.application_id for update;
  if v_stage not in ('selected','offered') then perform hr_private.fail('The candidate is no longer selected.', 'invalid_state'); end if;
  update public.hr_offers set status = 'sent', sent_at = now() where id = p_offer;
  if v_stage = 'selected' then perform hr_private.set_candidate_stage(f.application_id, 'offered', 'Offer sent'); end if;
end $$;

-- Record the candidate's response: accepted / declined / expired.
create or replace function public.hr_record_offer_response(p_offer uuid, p_response text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare f public.hr_offers;
begin
  if not hr_private.has_permission('recruitment.manage') then
    perform hr_private.fail('You are not allowed to manage offers.', 'forbidden');
  end if;
  if p_response not in ('accepted','declined','expired') then perform hr_private.fail('Unknown offer response.', 'invalid'); end if;
  select * into f from public.hr_offers where id = p_offer for update;
  if f.id is null then perform hr_private.fail('Offer not found.', 'not_found'); end if;
  if f.status <> 'sent' then perform hr_private.fail('Only a sent offer can be accepted, declined or expired.', 'invalid_state'); end if;
  update public.hr_offers set status = p_response, responded_at = now(),
         notes = case when nullif(btrim(p_note), '') is null then notes else concat_ws(E'\n', notes, btrim(p_note)) end
   where id = p_offer;
  insert into public.hr_candidate_stage_events (application_id, from_stage, to_stage, note, changed_by)
  select id, stage, stage, 'Offer ' || p_response || coalesce(': ' || nullif(btrim(p_note), ''), ''), auth.uid()
  from public.hr_candidate_applications where id = f.application_id;
end $$;

create or replace function public.hr_withdraw_offer(p_offer uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare f public.hr_offers;
begin
  if not hr_private.has_permission('recruitment.manage') then
    perform hr_private.fail('You are not allowed to manage offers.', 'forbidden');
  end if;
  select * into f from public.hr_offers where id = p_offer for update;
  if f.id is null then perform hr_private.fail('Offer not found.', 'not_found'); end if;
  if f.status not in ('draft','sent','accepted') then perform hr_private.fail('This offer is already closed.', 'invalid_state'); end if;
  if exists (select 1 from public.hr_candidate_applications where id = f.application_id and stage = 'joined') then
    perform hr_private.fail('The candidate has already joined.', 'invalid_state');
  end if;
  update public.hr_offers set status = 'withdrawn',
         notes = case when nullif(btrim(p_note), '') is null then notes else concat_ws(E'\n', notes, btrim(p_note)) end
   where id = p_offer;
end $$;

-- Offers for an application, readable by anyone who may see the application.
-- annual_ctc is returned only to recruitment.manage.
create or replace function public.hr_get_application_offers(p_application uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_ctc boolean := hr_private.has_permission('recruitment.manage');
begin
  if not hr_private.can_view_application(p_application) then
    perform hr_private.fail('You are not allowed to view this application.', 'forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', f.id, 'application_id', f.application_id, 'offered_designation_id', f.offered_designation_id,
      'department_id', f.department_id, 'employment_type', f.employment_type, 'proposed_joining_date', f.proposed_joining_date,
      'annual_ctc', case when v_ctc then f.annual_ctc end, 'currency', f.currency, 'expires_on', f.expires_on,
      'status', f.status, 'sent_at', f.sent_at, 'responded_at', f.responded_at, 'created_at', f.created_at)
      order by f.created_at)
    from public.hr_offers f where f.application_id = p_application), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- Public RPCs: conversions
-- ---------------------------------------------------------------------
create or replace function public.hr_convert_candidate_to_employee(
  p_application uuid, p_company_email text, p_joining_date date default null, p_department uuid default null,
  p_designation uuid default null, p_manager uuid default null, p_employment_type text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  a public.hr_candidate_applications;
  c public.hr_candidates;
  f public.hr_offers;
  v_type text;
  v_join date;
  v_emp uuid;
  v_first text;
  v_last text;
  v_months int;
begin
  if not hr_private.has_permission('recruitment.convert') then
    perform hr_private.fail('You are not allowed to convert candidates.', 'forbidden');
  end if;
  select * into a from public.hr_candidate_applications where id = p_application for update;
  if a.id is null then perform hr_private.fail('Application not found.', 'not_found'); end if;
  if a.stage = 'joined' or exists (select 1 from public.hr_employees where source = 'candidate' and source_ref = p_application) then
    perform hr_private.fail('This candidate has already been converted to an employee.', 'already_converted');
  end if;
  if a.stage <> 'offered' then perform hr_private.fail('Only candidates in the Offered stage can be converted.', 'invalid_state'); end if;
  select * into f from public.hr_offers where application_id = p_application and status = 'accepted' for update;
  if f.id is null then perform hr_private.fail('The candidate has not accepted an offer.', 'offer_not_accepted'); end if;
  if p_company_email is null or btrim(p_company_email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    perform hr_private.fail('Enter a valid company email.', 'invalid');
  end if;
  if exists (select 1 from public.hr_employees where lower(company_email::text) = lower(btrim(p_company_email))) then
    perform hr_private.fail('That company email is already used by another employee.', 'duplicate_email');
  end if;
  select * into c from public.hr_candidates where id = a.candidate_id;
  v_type := coalesce(p_employment_type, f.employment_type);
  v_join := coalesce(p_joining_date, f.proposed_joining_date);
  if v_join is null then perform hr_private.fail('Enter a joining date.', 'invalid'); end if;
  if not exists (select 1 from public.hr_employment_types where code = v_type and active) then
    perform hr_private.fail('Unknown employment type.', 'invalid');
  end if;
  v_first := split_part(btrim(c.full_name), ' ', 1);
  v_last := btrim(substr(btrim(c.full_name), length(v_first) + 1));
  begin
    insert into public.hr_employees (first_name, last_name, company_email, department_id, designation_id, manager_id,
                                     employment_type, joining_date, status, source, source_ref)
    values (left(v_first, 80), left(v_last, 80), lower(btrim(p_company_email)), coalesce(p_department, f.department_id),
            coalesce(p_designation, f.offered_designation_id), p_manager, v_type, v_join, 'onboarding', 'candidate', p_application)
    returning id into v_emp;
  exception when unique_violation then
    perform hr_private.fail('That company email is already used by another employee, or the candidate was already converted.', 'duplicate_employee');
  end;
  insert into public.hr_employee_history (employee_id, change_type, new_value, effective_date, note, changed_by)
  values (v_emp, 'conversion', 'candidate', v_join, 'Hired from candidate application ' || p_application, auth.uid());

  update public.hr_candidate_applications set employee_id = v_emp where id = p_application;
  perform hr_private.set_candidate_stage(p_application, 'joined', 'Converted to employee');

  if exists (select 1 from public.hr_employment_types where code = v_type and is_intern) then
    v_months := coalesce((hr_private.setting('recruitment') ->> 'default_internship_months')::int, 6);
    insert into public.hr_internships (employee_id, mentor_id, department_id, start_date, end_date, source_application_id)
    values (v_emp, p_manager, coalesce(p_department, f.department_id), v_join,
            (v_join + make_interval(months => v_months) - interval '1 day')::date, p_application);
  end if;
  perform hr_private.audit_event('CANDIDATE_CONVERTED', 'hr_candidate_applications', p_application::text,
    jsonb_build_object('employee_id', v_emp, 'employment_type', v_type));
  return v_emp;
end $$;

create or replace function public.hr_convert_intern_to_employee(
  p_internship uuid, p_employment_type text default 'full_time', p_effective_date date default null,
  p_designation uuid default null, p_manager uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  i public.hr_internships;
  e public.hr_employees;
  t public.hr_employment_types;
  v_eff date := coalesce(p_effective_date, hr_private.business_today());
begin
  if not (hr_private.has_permission('recruitment.convert') or hr_private.has_permission('interns.manage')) then
    perform hr_private.fail('You are not allowed to convert interns.', 'forbidden');
  end if;
  select * into i from public.hr_internships where id = p_internship for update;
  if i.id is null then perform hr_private.fail('Internship not found.', 'not_found'); end if;
  if i.status = 'converted' then perform hr_private.fail('This intern has already been converted.', 'already_converted'); end if;
  if i.status not in ('active','completed') then perform hr_private.fail('Only active or completed internships can be converted.', 'invalid_state'); end if;
  if i.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot convert yourself.', 'forbidden'); end if;
  select * into t from public.hr_employment_types where code = p_employment_type and active;
  if t.code is null or t.is_intern then perform hr_private.fail('Choose a non-intern employment type.', 'invalid'); end if;
  select * into e from public.hr_employees where id = i.employee_id for update;
  if e.status not in ('onboarding','probation','active') then
    perform hr_private.fail('Only a current employee record can be converted.', 'invalid_state');
  end if;
  if e.joining_date is not null and v_eff < e.joining_date then
    perform hr_private.fail('Conversion date cannot be before the joining date.', 'invalid');
  end if;

  update public.hr_employees set
    employment_type = t.code,
    designation_id = coalesce(p_designation, designation_id),
    manager_id = coalesce(p_manager, manager_id),
    probation_end_date = case when t.probation_months > 0 then (v_eff + make_interval(months => t.probation_months))::date end,
    status = case when t.probation_months > 0 then 'probation' else 'active' end
  where id = e.id;

  insert into public.hr_employee_history (employee_id, change_type, old_value, new_value, effective_date, note, changed_by)
  values (e.id, 'conversion', e.employment_type, t.code, v_eff, 'Intern converted (internship ' || p_internship || ')', auth.uid());

  perform set_config('hr.recruitment_rpc', 'on', true);
  update public.hr_internships set status = 'converted', converted_at = now(), converted_employment_type = t.code,
         completion_date = coalesce(completion_date, v_eff)
   where id = p_internship;
  perform set_config('hr.recruitment_rpc', 'off', true);

  if e.user_id is not null then
    delete from public.hr_user_roles where user_id = e.user_id and role_key = 'intern';
    insert into public.hr_user_roles (user_id, role_key, granted_by) values (e.user_id, 'employee', auth.uid()) on conflict do nothing;
    insert into public.hr_employee_history (employee_id, change_type, new_value, effective_date, changed_by)
    values (e.id, 'role', '-intern +employee', v_eff, auth.uid());
  end if;
  perform hr_private.notify_employee(e.id, 'intern_converted', 'Congratulations! Your internship has been converted',
    'You are now ' || t.name || ' effective ' || to_char(v_eff, 'DD Mon YYYY') || '.', '/employee/profile', 'hr_internships', p_internship::text);
  return e.id;
end $$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke execute on all functions in schema hr_private from anon, public;
grant execute on all functions in schema hr_private to authenticated, service_role;

do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = any (array[
             'hr_create_job_opening','hr_publish_job_opening','hr_add_candidate','hr_import_careers_applications',
             'hr_move_candidate_stage','hr_schedule_interview','hr_submit_interview_feedback','hr_create_offer',
             'hr_send_offer','hr_record_offer_response','hr_withdraw_offer','hr_get_application_offers',
             'hr_convert_candidate_to_employee','hr_convert_intern_to_employee'])
  loop
    execute format('revoke execute on function %s from anon, public', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Mentor <-> intern visibility on hr_employees (added in integration).
-- A mentor who is not the intern's manager must still see the mentee's
-- work record (name, code, department), and an intern must see their
-- mentor's. Additive policy: RLS policies combine with OR.
-- ---------------------------------------------------------------------
create or replace function hr_private.is_my_mentor(p_employee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select hr_private.current_employee_id() is not null and exists (
    select 1 from public.hr_internships i
    where i.employee_id = hr_private.current_employee_id() and i.mentor_id = p_employee and i.status = 'active')
$$;
revoke execute on function hr_private.is_my_mentor(uuid) from public, anon;
grant execute on function hr_private.is_my_mentor(uuid) to authenticated, service_role;

create policy hr_employees_read_mentor_links on public.hr_employees for select to authenticated
  using (hr_private.is_mentor_of(id) or hr_private.is_my_mentor(id));
