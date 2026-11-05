-- =====================================================================
-- 120_hr_recruitment_hiring.sql — Recruitment & Hiring enhancements on
-- top of 104_hr_recruitment.sql (no second recruitment system).
-- =====================================================================
-- Depends on 100 and 104 (and 113 for nothing beyond what 104 uses).
-- Everything here is ADDITIVE: no 104 table, column, status value or RPC
-- signature is removed or renamed, so existing screens, the local harness
-- fixtures and test 104 keep working. Status values keep their 104 names;
-- the UI relabels offer 'sent' as "Issued" and 'declined' as "Rejected".
--
-- Adds:
--   * job openings: designation, qualifications, recruiter, screening
--     questions, eligibility checklist, status machine with history and
--     permission-gated reopen (recruitment.reopen), salary range in a
--     separate table readable only by recruitment.manage
--   * applications: application date, source, assigned recruiter, hold,
--     expected/current salary (separate table, recruitment.manage only)
--   * candidates: skills, qualifications, location, notice period, notes
--     (append-only) and attachments (private bucket 'hr-recruitment')
--   * screening reviews (immutable history: shortlist / reject / hold)
--   * interview reschedule history, guarded status transitions
--   * structured evaluations (draft -> submitted, locked once submitted;
--     HR can only re-open one for its own author), final hiring decision
--   * offer letter templates (approved before use), generated letter
--     versions, signatory, issue, expiry, email via hr_email_outbox
--     (the UI shows real delivery state; nothing is "emailed" until the
--     dispatcher reports 'sent')
--   * hr_recruitment_overview() dashboard (SECURITY INVOKER: RLS scopes it)
--   * optional 'recruiter' role (no users are assigned by this migration)
--
-- Assignment-based access (no new role needed): an employee set as the
-- opening's or application's recruiter, the opening's hiring manager, and
-- interview panel members see only their assigned candidates.
-- Onboarding after hire is owned by the Onboarding module (it reacts to the
-- hr_employees row created by hr_convert_candidate_to_employee).
-- Apply ONLY to the local test cluster or the isolated dev project.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Permissions and the optional Recruiter role
-- ---------------------------------------------------------------------
insert into public.hr_permissions (key, module, action, description) values
  ('recruitment.reopen', 'recruitment', 'reopen', 'Reopen closed or filled job openings')
on conflict (key) do nothing;

insert into public.hr_roles (key, name, description, is_system) values
  ('recruiter', 'Recruiter', 'Manages openings, candidates, screening, interviews and offers. Cannot convert hires or reopen closed openings.', true)
on conflict (key) do nothing;

insert into public.hr_role_permissions (role_key, permission_key) values
  ('super_admin', 'recruitment.reopen'),
  ('hr_admin',    'recruitment.reopen'),
  ('recruiter',   'recruitment.view'),
  ('recruiter',   'recruitment.manage'),
  ('recruiter',   'recruitment.export')
on conflict do nothing;

update public.hr_settings
   set value = value || jsonb_build_object('max_screening_questions', 20)
 where key = 'recruitment' and not (value ? 'max_screening_questions');

-- ---------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------
create or replace function hr_private.jtext(p jsonb, k text)
returns text language sql immutable set search_path = '' as $$
  select nullif(btrim(p ->> k), '')
$$;

create or replace function hr_private.jnum(p jsonb, k text)
returns numeric language plpgsql immutable set search_path = '' as $$
declare v text := nullif(btrim(p ->> k), '');
begin
  if v is null then return null; end if;
  return v::numeric;
exception when others then
  perform hr_private.fail(format('"%s" must be a number.', k), 'invalid');
end $$;

create or replace function hr_private.jdate(p jsonb, k text)
returns date language plpgsql immutable set search_path = '' as $$
declare v text := nullif(btrim(p ->> k), '');
begin
  if v is null then return null; end if;
  return v::date;
exception when others then
  perform hr_private.fail(format('"%s" must be a date.', k), 'invalid');
end $$;

create or replace function hr_private.juuid(p jsonb, k text)
returns uuid language plpgsql immutable set search_path = '' as $$
declare v text := nullif(btrim(p ->> k), '');
begin
  if v is null then return null; end if;
  return v::uuid;
exception when others then
  perform hr_private.fail(format('"%s" is not a valid id.', k), 'invalid');
end $$;

-- jsonb array of non-blank strings -> text[] (deduplicated, order kept).
create or replace function hr_private.jtext_array(p jsonb, k text, p_max int default 50, p_maxlen int default 300)
returns text[] language plpgsql immutable set search_path = '' as $$
declare v text[];
begin
  if p -> k is null or jsonb_typeof(p -> k) = 'null' then return '{}'; end if;
  if jsonb_typeof(p -> k) <> 'array' then perform hr_private.fail(format('"%s" must be a list.', k), 'invalid'); end if;
  select coalesce(array_agg(x order by o), '{}') into v from (
    select btrim(e) x, min(ord) o from jsonb_array_elements_text(p -> k) with ordinality t(e, ord)
    where btrim(e) <> '' group by btrim(e)) s;
  if cardinality(v) > p_max then perform hr_private.fail(format('"%s" can have at most %s entries.', k, p_max), 'invalid'); end if;
  if exists (select 1 from unnest(v) x where length(x) > p_maxlen) then
    perform hr_private.fail(format('Entries in "%s" can be at most %s characters.', k, p_maxlen), 'invalid');
  end if;
  return v;
end $$;

create or replace function hr_private.is_active_employee(p_employee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.hr_employees where id = p_employee and status not in ('exited','archived','suspended'))
$$;

-- ---------------------------------------------------------------------
-- Job openings: new columns, status history, salary range
-- ---------------------------------------------------------------------
alter table public.hr_job_openings
  add column designation_id       uuid references public.hr_designations(id) on delete restrict,
  add column qualifications       text check (qualifications is null or length(qualifications) <= 4000),
  add column recruiter_id         uuid references public.hr_employees(id) on delete set null,
  add column screening_questions  text[] not null default '{}',
  add column eligibility_criteria text[] not null default '{}',
  add column closed_at            timestamptz,
  add column reopened_at          timestamptz;
create index hr_job_openings_recruiter on public.hr_job_openings(recruiter_id);

create table public.hr_job_opening_status_events (
  id          bigint generated always as identity primary key,
  opening_id  uuid not null references public.hr_job_openings(id) on delete cascade,
  from_status text,
  to_status   text not null,
  reason      text,
  changed_by  uuid,
  changed_at  timestamptz not null default now()
);
create index hr_job_opening_status_events_opening on public.hr_job_opening_status_events(opening_id, changed_at);

-- Salary range: confidential, recruitment.manage only.
create table public.hr_job_opening_compensation (
  opening_id  uuid primary key references public.hr_job_openings(id) on delete cascade,
  salary_min  numeric(14,2) check (salary_min is null or salary_min >= 0),
  salary_max  numeric(14,2) check (salary_max is null or salary_max >= 0),
  currency    text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  period      text not null default 'annual' check (period in ('annual','monthly')),
  updated_by  uuid,
  updated_at  timestamptz not null default now(),
  check (salary_max is null or salary_min is null or salary_max >= salary_min)
);

-- Draft -> Open -> On Hold -> Closed. 'filled' (104) is a closed state.
-- Reopening (closed/filled -> open) needs recruitment.reopen and a reason.
create or replace function hr_private.opening_status_allowed(p_from text, p_to text)
returns boolean language sql immutable set search_path = '' as $$
  select case p_from
    when 'draft'   then p_to in ('open','closed')
    when 'open'    then p_to in ('on_hold','closed','filled')
    when 'on_hold' then p_to in ('open','closed','filled')
    when 'closed'  then p_to = 'open'
    when 'filled'  then p_to = 'open'
    else false end
$$;

create or replace function hr_private.job_opening_status_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is not distinct from old.status then return new; end if;
  if not hr_private.opening_status_allowed(old.status, new.status) then
    perform hr_private.fail(format('A job opening cannot move from %s to %s.', replace(old.status, '_', ' '), replace(new.status, '_', ' ')), 'invalid_transition');
  end if;
  if old.status in ('closed','filled') then
    if auth.uid() is not null and not hr_private.has_permission('recruitment.reopen') then
      perform hr_private.fail('You are not allowed to reopen job openings.', 'forbidden');
    end if;
    if nullif(current_setting('hr.status_reason', true), '') is null then
      perform hr_private.fail('Give a reason for reopening the job opening.', 'reason_required');
    end if;
    new.reopened_at := now();
    new.closed_at := null;
  end if;
  if new.status in ('closed','filled') then new.closed_at := now(); end if;
  if new.status = 'open' then new.posting_date := coalesce(new.posting_date, hr_private.business_today()); end if;
  return new;
end $$;
create trigger hr_job_openings_status_guard before update of status on public.hr_job_openings
  for each row execute function hr_private.job_opening_status_guard();

create or replace function hr_private.job_opening_status_log()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.hr_job_opening_status_events (opening_id, from_status, to_status, reason, changed_by)
    values (new.id, case when tg_op = 'UPDATE' then old.status end, new.status,
            nullif(current_setting('hr.status_reason', true), ''), auth.uid());
  end if;
  return new;
end $$;
create trigger hr_job_openings_status_log after insert or update of status on public.hr_job_openings
  for each row execute function hr_private.job_opening_status_log();

-- ---------------------------------------------------------------------
-- Candidates and applications: new columns, compensation, notes, files
-- ---------------------------------------------------------------------
alter table public.hr_candidates
  add column skills             text[] not null default '{}',
  add column qualifications     text check (qualifications is null or length(qualifications) <= 4000),
  add column current_location   text check (current_location is null or length(current_location) <= 200),
  add column notice_period_days smallint check (notice_period_days is null or notice_period_days between 0 and 365);

alter table public.hr_candidate_applications
  add column applied_on   date not null default (now() at time zone 'Asia/Kolkata')::date,
  add column source       text check (source is null or source in ('careers_site','referral','linkedin','agency','campus','job_portal','walk_in','other')),
  add column recruiter_id uuid references public.hr_employees(id) on delete set null,
  add column on_hold      boolean not null default false,
  add column hold_reason  text,
  add column held_at      timestamptz;
update public.hr_candidate_applications set applied_on = (created_at at time zone hr_private.business_timezone())::date;
create index hr_candidate_applications_recruiter on public.hr_candidate_applications(recruiter_id);
create index hr_candidate_applications_applied on public.hr_candidate_applications(applied_on);

-- The candidate source list gains 'job_portal' and 'walk_in'.
alter table public.hr_candidates drop constraint if exists hr_candidates_source_check;
alter table public.hr_candidates add constraint hr_candidates_source_check
  check (source in ('careers_site','referral','linkedin','agency','campus','job_portal','walk_in','other'));

-- Expected / current salary: confidential, recruitment.manage only.
create table public.hr_application_compensation (
  application_id  uuid primary key references public.hr_candidate_applications(id) on delete cascade,
  expected_salary numeric(14,2) check (expected_salary is null or expected_salary >= 0),
  current_salary  numeric(14,2) check (current_salary is null or current_salary >= 0),
  currency        text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  updated_by      uuid,
  updated_at      timestamptz not null default now()
);

create table public.hr_candidate_notes (
  id                 uuid primary key default gen_random_uuid(),
  candidate_id       uuid not null references public.hr_candidates(id) on delete cascade,
  application_id     uuid references public.hr_candidate_applications(id) on delete cascade,
  body               text not null check (length(btrim(body)) between 1 and 4000),
  author_user_id     uuid,
  author_employee_id uuid references public.hr_employees(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index hr_candidate_notes_candidate on public.hr_candidate_notes(candidate_id, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('hr-recruitment', 'hr-recruitment', false, 10485760, array[
     'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'application/msword',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

-- Object name: <candidate_id>/<attachment_id>-<sanitized file name>
create table public.hr_candidate_attachments (
  id             uuid primary key default gen_random_uuid(),
  candidate_id   uuid not null references public.hr_candidates(id) on delete restrict,
  application_id uuid references public.hr_candidate_applications(id) on delete set null,
  kind           text not null default 'resume' check (kind in ('resume','cover_letter','portfolio','certificate','id_proof','other')),
  file_name      text not null check (length(file_name) between 1 and 200),
  mime_type      text not null check (mime_type in ('application/pdf','image/png','image/jpeg','image/webp','application/msword',
                                                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  size_bytes     integer not null check (size_bytes between 1 and 10485760),
  storage_path   text not null unique,
  uploaded_by    uuid,
  uploaded_at    timestamptz not null default now(),
  confirmed_at   timestamptz,
  archived_at    timestamptz,
  archived_by    uuid,
  archive_reason text
);
create index hr_candidate_attachments_candidate on public.hr_candidate_attachments(candidate_id);

-- ---------------------------------------------------------------------
-- Screening, interview reschedules, hiring decisions
-- ---------------------------------------------------------------------
create table public.hr_candidate_screenings (
  id                   uuid primary key default gen_random_uuid(),
  application_id       uuid not null references public.hr_candidate_applications(id) on delete cascade,
  reviewer_user_id     uuid,
  reviewer_employee_id uuid references public.hr_employees(id) on delete set null,
  resume_reviewed      boolean not null default false,
  checklist            jsonb not null default '[]'::jsonb check (jsonb_typeof(checklist) = 'array'),   -- [{"item":"...","met":true}]
  answers              jsonb not null default '[]'::jsonb check (jsonb_typeof(answers) = 'array'),     -- [{"question":"...","answer":"..."}]
  score                numeric(5,2) check (score is null or score between 0 and 100),
  notes                text check (notes is null or length(notes) <= 4000),
  decision             text not null check (decision in ('shortlist','reject','hold')),
  reason               text check (reason is null or length(reason) <= 2000),
  stage_before         text,
  decided_at           timestamptz not null default now(),
  check (decision = 'shortlist' or nullif(btrim(reason), '') is not null)
);
create index hr_candidate_screenings_app on public.hr_candidate_screenings(application_id, decided_at);

alter table public.hr_interviews
  add column cancel_reason     text,
  add column status_changed_at timestamptz,
  add column status_changed_by uuid,
  add column reschedule_count  smallint not null default 0;

create table public.hr_interview_reschedules (
  id                   bigint generated always as identity primary key,
  interview_id         uuid not null references public.hr_interviews(id) on delete cascade,
  old_scheduled_at     timestamptz not null,
  new_scheduled_at     timestamptz not null,
  old_mode             text,
  new_mode             text,
  old_location_or_link text,
  new_location_or_link text,
  reason               text not null check (length(btrim(reason)) between 1 and 2000),
  changed_by           uuid,
  changed_at           timestamptz not null default now()
);
create index hr_interview_reschedules_iv on public.hr_interview_reschedules(interview_id, changed_at);

create table public.hr_hiring_decisions (
  id                   uuid primary key default gen_random_uuid(),
  application_id       uuid not null references public.hr_candidate_applications(id) on delete cascade,
  decision             text not null check (decision in ('hire','hold','reject')),
  reason               text check (reason is null or length(reason) <= 2000),
  decided_by           uuid,
  decided_by_employee  uuid references public.hr_employees(id) on delete set null,
  decided_at           timestamptz not null default now(),
  check (decision = 'hire' or nullif(btrim(reason), '') is not null)
);
create index hr_hiring_decisions_app on public.hr_hiring_decisions(application_id, decided_at);

-- Structured evaluations on the existing feedback table.
alter table public.hr_interview_feedback drop constraint if exists hr_interview_feedback_rating_check;
alter table public.hr_interview_feedback drop constraint if exists hr_interview_feedback_recommendation_check;
alter table public.hr_interview_feedback
  alter column rating drop not null,
  alter column recommendation drop not null,
  alter column submitted_at drop not null,
  add column technical_score     smallint check (technical_score is null or technical_score between 1 and 5),
  add column hr_score            smallint check (hr_score is null or hr_score between 1 and 5),
  add column communication_score smallint check (communication_score is null or communication_score between 1 and 5),
  add column role_skills_score   smallint check (role_skills_score is null or role_skills_score between 1 and 5),
  add column experience_score    smallint check (experience_score is null or experience_score between 1 and 5),
  add column comments            text check (comments is null or length(comments) <= 4000),
  add column status              text not null default 'submitted' check (status in ('draft','submitted')),
  add column created_at          timestamptz not null default now(),
  add column updated_at          timestamptz not null default now(),
  add column reopened_at         timestamptz,
  add column reopened_by         uuid,
  add column reopen_reason       text;
alter table public.hr_interview_feedback
  add constraint hr_interview_feedback_rating_check check (rating is null or rating between 1 and 5),
  add constraint hr_interview_feedback_recommendation_check
    check (recommendation is null or recommendation in ('strong_hire','hire','hold','no_hire','strong_no_hire')),
  add constraint hr_interview_feedback_submitted_complete
    check (status = 'draft' or (rating is not null and recommendation is not null and submitted_at is not null));
create trigger hr_interview_feedback_touch before update on public.hr_interview_feedback for each row execute function hr_private.touch_updated_at();

-- ---------------------------------------------------------------------
-- Offers: letter templates, generated versions, signatory, email
-- ---------------------------------------------------------------------
create table public.hr_offer_letter_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (length(btrim(name)) between 2 and 120),
  subject     text not null check (length(btrim(subject)) between 2 and 200),
  body        text not null check (length(body) between 20 and 20000),
  status      text not null default 'draft' check (status in ('draft','approved','archived')),
  is_default  boolean not null default false,
  approved_by uuid,
  approved_at timestamptz,
  created_by  uuid,
  updated_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (status <> 'approved' or approved_at is not null)
);
create unique index hr_offer_letter_templates_one_default on public.hr_offer_letter_templates(is_default) where is_default;
create trigger hr_offer_letter_templates_touch before update on public.hr_offer_letter_templates for each row execute function hr_private.touch_updated_at();

alter table public.hr_offers
  add column work_location         text check (work_location is null or length(work_location) <= 200),
  add column issued_on             date,
  add column signatory_employee_id uuid references public.hr_employees(id) on delete set null,
  add column signatory_name        text check (signatory_name is null or length(signatory_name) <= 120),
  add column signatory_title       text check (signatory_title is null or length(signatory_title) <= 120),
  add column template_id           uuid references public.hr_offer_letter_templates(id) on delete set null,
  add column current_version       integer not null default 0,
  add column letter_stale          boolean not null default false,
  add column email_outbox_id       uuid references public.hr_email_outbox(id) on delete set null;

create table public.hr_offer_letter_versions (
  id            uuid primary key default gen_random_uuid(),
  offer_id      uuid not null references public.hr_offers(id) on delete cascade,
  version       integer not null check (version >= 1),
  template_id   uuid references public.hr_offer_letter_templates(id) on delete set null,
  template_name text not null,
  subject       text not null,
  body          text not null,
  merge_data    jsonb not null,
  generated_by  uuid,
  generated_at  timestamptz not null default now(),
  unique (offer_id, version)
);

-- Placeholders an offer letter template may use.
create or replace function hr_private.offer_placeholders()
returns text[] language sql immutable set search_path = '' as $$
  select array['candidate_name','candidate_email','job_title','designation','department','work_location','employment_type',
               'annual_ctc','currency','joining_date','issue_date','valid_until','signatory_name','signatory_title',
               'company_name','company_legal_name','reference']
$$;

create or replace function hr_private.check_offer_template(p_subject text, p_body text)
returns void language plpgsql immutable set search_path = '' as $$
declare v_bad text;
begin
  select string_agg(distinct m[1], ', ') into v_bad
  from regexp_matches(coalesce(p_subject, '') || ' ' || coalesce(p_body, ''), '\{\{\s*([A-Za-z0-9_]+)\s*\}\}', 'g') m
  where not (m[1] = any (hr_private.offer_placeholders()));
  if v_bad is not null then
    perform hr_private.fail('Unknown placeholder(s) in the template: ' || v_bad || '.', 'invalid');
  end if;
end $$;

insert into public.hr_offer_letter_templates (name, subject, body, status, is_default, approved_at) values
('Standard offer letter', 'Offer of employment: {{designation}} at {{company_name}}',
$tpl$Ref: {{reference}}
Date: {{issue_date}}

Dear {{candidate_name}},

We are pleased to offer you the position of {{designation}} in the {{department}} department at {{company_legal_name}}, for the role of {{job_title}}.

Employment type: {{employment_type}}
Work location: {{work_location}}
Joining date: {{joining_date}}
Annual compensation (CTC): {{currency}} {{annual_ctc}}

This offer is valid until {{valid_until}}. Please confirm your acceptance before that date. The offer is subject to verification of your documents and the company's standard terms of employment, which will be shared with you on joining.

We look forward to welcoming you to {{company_name}}.

Sincerely,

{{signatory_name}}
{{signatory_title}}
{{company_legal_name}}$tpl$, 'approved', true, now());

-- ---------------------------------------------------------------------
-- Access helpers (104 helpers extended additively)
-- ---------------------------------------------------------------------
create or replace function hr_private.is_assigned_recruiter_for_application(p_application uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select hr_private.current_employee_id() is not null and exists (
    select 1 from public.hr_candidate_applications a join public.hr_job_openings o on o.id = a.opening_id
    where a.id = p_application
      and (a.recruiter_id = hr_private.current_employee_id() or o.recruiter_id = hr_private.current_employee_id()))
$$;

create or replace function hr_private.can_view_application(p_application uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_application is not null and (
       hr_private.is_recruiter()
    or hr_private.is_assigned_recruiter_for_application(p_application)
    or hr_private.is_hiring_manager_for_application(p_application)
    or hr_private.is_interviewer_for_application(p_application))
$$;

create or replace function hr_private.can_view_candidate(p_candidate uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_candidate is not null and (
       hr_private.is_recruiter()
    or exists (select 1 from public.hr_candidate_applications a
               where a.candidate_id = p_candidate
                 and (hr_private.is_assigned_recruiter_for_application(a.id)
                      or hr_private.is_hiring_manager_for_application(a.id)
                      or hr_private.is_interviewer_for_application(a.id))))
$$;

create or replace function hr_private.can_view_opening(p_opening uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_opening is not null and (
       hr_private.is_recruiter()
    or exists (select 1 from public.hr_job_openings o where o.id = p_opening
               and hr_private.current_employee_id() in (o.hiring_manager_id, o.recruiter_id))
    or exists (select 1 from public.hr_candidate_applications a where a.opening_id = p_opening
               and (hr_private.is_interviewer_for_application(a.id) or hr_private.is_assigned_recruiter_for_application(a.id))))
$$;

-- Screening and candidate notes/files: recruiters with recruitment.manage
-- or the assigned recruiter.
create or replace function hr_private.can_screen_application(p_application uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select hr_private.has_permission('recruitment.manage') or hr_private.is_assigned_recruiter_for_application(p_application)
$$;

-- Internal candidate information (screening, notes, decisions, non-resume
-- files): recruiters, assigned recruiter, hiring manager. NOT interviewers.
create or replace function hr_private.can_view_application_internal(p_application uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_application is not null and (
       hr_private.is_recruiter()
    or hr_private.is_assigned_recruiter_for_application(p_application)
    or hr_private.is_hiring_manager_for_application(p_application))
$$;

create or replace function hr_private.can_view_candidate_internal(p_candidate uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_candidate is not null and (
       hr_private.is_recruiter()
    or exists (select 1 from public.hr_candidate_applications a where a.candidate_id = p_candidate
               and hr_private.can_view_application_internal(a.id)))
$$;

create or replace function hr_private.can_manage_candidate(p_candidate uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select hr_private.has_permission('recruitment.manage')
      or exists (select 1 from public.hr_candidate_applications a where a.candidate_id = p_candidate
                 and hr_private.is_assigned_recruiter_for_application(a.id))
$$;

create or replace function hr_private.attachment_readable(p_attachment uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.hr_candidate_attachments t where t.id = p_attachment and t.archived_at is null
                 and (case when t.kind in ('resume','cover_letter','portfolio') then hr_private.can_view_candidate(t.candidate_id)
                           else hr_private.can_view_candidate_internal(t.candidate_id) end))
$$;

create or replace function hr_private.candidate_object_can_upload(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and not hr_private.caller_is_revoked()
     and exists (select 1 from public.hr_candidate_attachments t
                 where t.storage_path = p_name and t.uploaded_by = auth.uid() and t.archived_at is null
                   and t.confirmed_at is null and t.uploaded_at > now() - interval '24 hours')
     and not exists (select 1 from storage.objects o where o.bucket_id = 'hr-recruitment' and o.name = p_name)
$$;

create or replace function hr_private.candidate_object_readable(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.hr_candidate_attachments t where t.storage_path = p_name and hr_private.attachment_readable(t.id))
$$;

-- Stage change now also clears a hold (same signature as 104).
create or replace function hr_private.set_candidate_stage(p_application uuid, p_to text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_from text;
begin
  select stage into v_from from public.hr_candidate_applications where id = p_application for update;
  if v_from = p_to then return; end if;
  update public.hr_candidate_applications
     set stage = p_to, stage_changed_at = now(),
         rejected_reason = case when p_to = 'rejected' then p_note else rejected_reason end,
         on_hold = false, hold_reason = null, held_at = null
   where id = p_application;
  insert into public.hr_candidate_stage_events (application_id, from_stage, to_stage, note, changed_by)
  values (p_application, v_from, p_to, p_note, auth.uid());
end $$;

-- Reject an application (same side effects as hr_move_candidate_stage).
create or replace function hr_private.reject_application(p_application uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform hr_private.set_candidate_stage(p_application, 'rejected', p_reason);
  update public.hr_interviews set status = 'cancelled', cancel_reason = coalesce(cancel_reason, 'Candidate rejected')
   where application_id = p_application and status = 'scheduled';
  update public.hr_offers set status = 'withdrawn' where application_id = p_application and status in ('draft','sent');
end $$;

create or replace function hr_private.hold_application(p_application uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.hr_candidate_applications set on_hold = true, hold_reason = p_reason, held_at = now() where id = p_application;
  insert into public.hr_candidate_stage_events (application_id, from_stage, to_stage, note, changed_by)
  select id, stage, stage, 'On hold: ' || p_reason, auth.uid() from public.hr_candidate_applications where id = p_application;
end $$;

-- Interviews: status leaves 'scheduled' only once; time/place/mode change
-- only through hr_reschedule_interview (which records history).
create or replace function hr_private.interviews_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    if old.status <> 'scheduled' then
      perform hr_private.fail('This interview is already ' || replace(old.status, '_', ' ') || '.', 'invalid_state');
    end if;
    new.status_changed_at := now();
    new.status_changed_by := auth.uid();
  end if;
  if (new.scheduled_at, new.mode, new.location_or_link, new.duration_minutes)
       is distinct from (old.scheduled_at, old.mode, old.location_or_link, old.duration_minutes)
     and auth.uid() is not null and current_setting('hr.recruitment_rpc', true) is distinct from 'on' then
    perform hr_private.fail('Use Reschedule to change the interview time, mode or place.', 'use_reschedule');
  end if;
  if new.application_id is distinct from old.application_id then
    perform hr_private.fail('The application of an interview cannot be changed.', 'immutable');
  end if;
  return new;
end $$;
create trigger hr_interviews_guard before update on public.hr_interviews
  for each row execute function hr_private.interviews_guard();

-- Offers: an issued/closed offer's terms are frozen.
create or replace function hr_private.offers_terms_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status <> 'draft'
     and (new.offered_designation_id, new.department_id, new.employment_type, new.proposed_joining_date, new.annual_ctc, new.currency,
          new.work_location, new.signatory_employee_id, new.signatory_name, new.signatory_title, new.current_version)
         is distinct from
         (old.offered_designation_id, old.department_id, old.employment_type, old.proposed_joining_date, old.annual_ctc, old.currency,
          old.work_location, old.signatory_employee_id, old.signatory_name, old.signatory_title, old.current_version) then
    perform hr_private.fail('An issued offer cannot be changed. Withdraw it and create a new offer.', 'invalid_state');
  end if;
  return new;
end $$;
create trigger hr_offers_terms_guard before update on public.hr_offers
  for each row execute function hr_private.offers_terms_guard();

-- ---------------------------------------------------------------------
-- Triggers for created_by / updated_at on new tables
-- ---------------------------------------------------------------------
create trigger hr_offer_letter_templates_created_by before insert on public.hr_offer_letter_templates
  for each row execute function hr_private.recruitment_set_created_by();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
select hr_private.secure_table('public.hr_job_opening_status_events');
create policy hr_job_opening_status_events_read on public.hr_job_opening_status_events for select to authenticated using (hr_private.can_view_opening(opening_id));
revoke insert, update, delete on public.hr_job_opening_status_events from authenticated;

select hr_private.secure_table('public.hr_job_opening_compensation');
create policy hr_job_opening_compensation_read on public.hr_job_opening_compensation for select to authenticated using (hr_private.has_permission('recruitment.manage'));
revoke insert, update, delete on public.hr_job_opening_compensation from authenticated;

select hr_private.secure_table('public.hr_application_compensation');
create policy hr_application_compensation_read on public.hr_application_compensation for select to authenticated using (hr_private.has_permission('recruitment.manage'));
revoke insert, update, delete on public.hr_application_compensation from authenticated;

select hr_private.secure_table('public.hr_candidate_notes');
create policy hr_candidate_notes_read on public.hr_candidate_notes for select to authenticated using (hr_private.can_view_candidate_internal(candidate_id));
revoke insert, update, delete on public.hr_candidate_notes from authenticated;

select hr_private.secure_table('public.hr_candidate_attachments');
create policy hr_candidate_attachments_read on public.hr_candidate_attachments for select to authenticated using (hr_private.attachment_readable(id));
revoke insert, update, delete on public.hr_candidate_attachments from authenticated;

select hr_private.secure_table('public.hr_candidate_screenings');
create policy hr_candidate_screenings_read on public.hr_candidate_screenings for select to authenticated using (hr_private.can_view_application_internal(application_id));
revoke insert, update, delete on public.hr_candidate_screenings from authenticated;

select hr_private.secure_table('public.hr_interview_reschedules');
create policy hr_interview_reschedules_read on public.hr_interview_reschedules for select to authenticated
  using (exists (select 1 from public.hr_interviews i where i.id = interview_id and hr_private.can_view_application(i.application_id)));
revoke insert, update, delete on public.hr_interview_reschedules from authenticated;

select hr_private.secure_table('public.hr_hiring_decisions');
create policy hr_hiring_decisions_read on public.hr_hiring_decisions for select to authenticated using (hr_private.can_view_application_internal(application_id));
revoke insert, update, delete on public.hr_hiring_decisions from authenticated;

select hr_private.secure_table('public.hr_offer_letter_templates');
create policy hr_offer_letter_templates_read on public.hr_offer_letter_templates for select to authenticated using (hr_private.has_permission('recruitment.manage'));
revoke insert, update, delete on public.hr_offer_letter_templates from authenticated;

select hr_private.secure_table('public.hr_offer_letter_versions');
create policy hr_offer_letter_versions_read on public.hr_offer_letter_versions for select to authenticated using (hr_private.has_permission('recruitment.manage'));
revoke insert, update, delete on public.hr_offer_letter_versions from authenticated;

-- Interviewers see their own evaluations (draft or submitted); recruiters,
-- the assigned recruiter and the hiring manager see SUBMITTED ones only.
drop policy if exists hr_interview_feedback_read on public.hr_interview_feedback;
create policy hr_interview_feedback_read on public.hr_interview_feedback for select to authenticated using (
     interviewer_id = hr_private.current_employee_id()
  or (status = 'submitted' and exists (select 1 from public.hr_interviews i where i.id = interview_id
             and hr_private.can_view_application_internal(i.application_id))));

-- Direct opening updates (104 UI) stay limited to recruitment.manage; the
-- status guard above applies to them as well.

drop policy if exists "hr-recruitment: registered upload" on storage.objects;
create policy "hr-recruitment: registered upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'hr-recruitment' and hr_private.candidate_object_can_upload(name));
drop policy if exists "hr-recruitment: permitted read" on storage.objects;
create policy "hr-recruitment: permitted read" on storage.objects for select to authenticated
  using (bucket_id = 'hr-recruitment' and hr_private.candidate_object_readable(name));

select hr_private.enable_audit('public.hr_job_opening_compensation', array['salary_min','salary_max']);
select hr_private.enable_audit('public.hr_application_compensation', array['expected_salary','current_salary']);
select hr_private.enable_audit('public.hr_candidate_attachments');
select hr_private.enable_audit('public.hr_candidate_screenings');
select hr_private.enable_audit('public.hr_hiring_decisions');
select hr_private.enable_audit('public.hr_offer_letter_templates');
select hr_private.enable_audit('public.hr_interviews');

-- ---------------------------------------------------------------------
-- RPCs: job openings
-- ---------------------------------------------------------------------
-- Create (p_opening null) or update an opening. p_values keys:
--   title, department_id, designation_id, employment_type, openings, location,
--   description, qualifications, required_skills[], experience_min,
--   experience_max, posting_date, closing_date, hiring_manager_id,
--   recruiter_id, screening_questions[], eligibility_criteria[],
--   salary_min, salary_max, salary_currency, salary_period
-- On update only the keys present are changed. New openings start as Draft.
create or replace function public.hr_save_job_opening(p_opening uuid, p_values jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  o public.hr_job_openings;
  v jsonb := coalesce(p_values, '{}'::jsonb);
  v_id uuid;
  v_title text; v_dep uuid; v_des uuid; v_type text; v_n int; v_loc text; v_desc text; v_qual text;
  v_skills text[]; v_emin numeric; v_emax numeric; v_post date; v_close date; v_hm uuid; v_rec uuid;
  v_q text[]; v_elig text[]; v_maxq int;
  v_smin numeric; v_smax numeric; v_cur text; v_per text;
  has_ boolean;
begin
  if not hr_private.has_permission('recruitment.manage') then
    perform hr_private.fail('You are not allowed to manage job openings.', 'forbidden');
  end if;
  if jsonb_typeof(v) <> 'object' then perform hr_private.fail('Invalid job opening details.', 'invalid'); end if;
  if p_opening is not null then
    select * into o from public.hr_job_openings where id = p_opening for update;
    if o.id is null then perform hr_private.fail('Job opening not found.', 'not_found'); end if;
  end if;

  v_title := case when v ? 'title' or p_opening is null then hr_private.jtext(v, 'title') else o.title end;
  v_dep   := case when v ? 'department_id' then hr_private.juuid(v, 'department_id') else o.department_id end;
  v_des   := case when v ? 'designation_id' then hr_private.juuid(v, 'designation_id') else o.designation_id end;
  v_type  := case when v ? 'employment_type' then hr_private.jtext(v, 'employment_type') else coalesce(o.employment_type, 'full_time') end;
  v_n     := case when v ? 'openings' then hr_private.jnum(v, 'openings')::int else coalesce(o.openings, 1) end;
  v_loc   := case when v ? 'location' then hr_private.jtext(v, 'location') else o.location end;
  v_desc  := case when v ? 'description' then coalesce(v ->> 'description', '') else coalesce(o.description, '') end;
  v_qual  := case when v ? 'qualifications' then hr_private.jtext(v, 'qualifications') else o.qualifications end;
  v_skills:= case when v ? 'required_skills' then hr_private.jtext_array(v, 'required_skills', 30, 60) else coalesce(o.required_skills, '{}') end;
  v_emin  := case when v ? 'experience_min' then hr_private.jnum(v, 'experience_min') else o.experience_min end;
  v_emax  := case when v ? 'experience_max' then hr_private.jnum(v, 'experience_max') else o.experience_max end;
  v_post  := case when v ? 'posting_date' then hr_private.jdate(v, 'posting_date') else o.posting_date end;
  v_close := case when v ? 'closing_date' then hr_private.jdate(v, 'closing_date') else o.closing_date end;
  v_hm    := case when v ? 'hiring_manager_id' then hr_private.juuid(v, 'hiring_manager_id') else o.hiring_manager_id end;
  v_rec   := case when v ? 'recruiter_id' then hr_private.juuid(v, 'recruiter_id') else o.recruiter_id end;
  v_maxq  := coalesce((hr_private.setting('recruitment') ->> 'max_screening_questions')::int, 20);
  v_q     := case when v ? 'screening_questions' then hr_private.jtext_array(v, 'screening_questions', v_maxq, 500) else coalesce(o.screening_questions, '{}') end;
  v_elig  := case when v ? 'eligibility_criteria' then hr_private.jtext_array(v, 'eligibility_criteria', v_maxq, 300) else coalesce(o.eligibility_criteria, '{}') end;

  if v_title is null or length(v_title) not between 2 and 200 then perform hr_private.fail('Enter a job title of 2–200 characters.', 'invalid'); end if;
  if not exists (select 1 from public.hr_employment_types where code = v_type and active) then perform hr_private.fail('Unknown employment type.', 'invalid'); end if;
  if v_n is null or v_n not between 1 and 500 then perform hr_private.fail('Vacancies must be between 1 and 500.', 'invalid'); end if;
  if v_dep is not null and not exists (select 1 from public.hr_departments where id = v_dep) then perform hr_private.fail('Unknown department.', 'invalid'); end if;
  if v_des is not null then
    if not exists (select 1 from public.hr_designations where id = v_des) then perform hr_private.fail('Unknown designation.', 'invalid'); end if;
    if v_dep is not null and exists (select 1 from public.hr_designations where id = v_des and department_id is not null and department_id <> v_dep) then
      perform hr_private.fail('The designation belongs to another department.', 'invalid');
    end if;
  end if;
  if (v_emin is not null and v_emin not between 0 and 60) or (v_emax is not null and v_emax not between 0 and 60) then
    perform hr_private.fail('Experience must be between 0 and 60 years.', 'invalid');
  end if;
  if v_emin is not null and v_emax is not null and v_emax < v_emin then perform hr_private.fail('Maximum experience must be at least the minimum.', 'invalid'); end if;
  if v_close is not null and v_post is not null and v_close < v_post then perform hr_private.fail('Closing date cannot be before the opening date.', 'invalid'); end if;
  if v_close is not null and v_close < hr_private.business_today() and v_close is distinct from o.closing_date then
    perform hr_private.fail('Closing date cannot be in the past.', 'invalid');
  end if;
  if v_hm is not null and v_hm is distinct from o.hiring_manager_id and not hr_private.is_active_employee(v_hm) then
    perform hr_private.fail('Hiring manager must be an active employee.', 'invalid');
  end if;
  if v_rec is not null and v_rec is distinct from o.recruiter_id and not hr_private.is_active_employee(v_rec) then
    perform hr_private.fail('Recruiter must be an active employee.', 'invalid');
  end if;
  if o.status in ('closed','filled') and p_opening is not null then
    perform hr_private.fail('A closed opening cannot be edited. Reopen it first.', 'invalid_state');
  end if;

  if p_opening is null then
    insert into public.hr_job_openings (title, department_id, designation_id, employment_type, openings, location, description, qualifications,
        required_skills, experience_min, experience_max, posting_date, closing_date, hiring_manager_id, recruiter_id,
        screening_questions, eligibility_criteria, status)
    values (v_title, v_dep, v_des, v_type, v_n, v_loc, v_desc, v_qual, v_skills, v_emin, v_emax, v_post, v_close, v_hm, v_rec,
        v_q, v_elig, 'draft')
    returning id into v_id;
  else
    update public.hr_job_openings set title = v_title, department_id = v_dep, designation_id = v_des, employment_type = v_type,
        openings = v_n, location = v_loc, description = v_desc, qualifications = v_qual, required_skills = v_skills,
        experience_min = v_emin, experience_max = v_emax, posting_date = v_post, closing_date = v_close,
        hiring_manager_id = v_hm, recruiter_id = v_rec, screening_questions = v_q, eligibility_criteria = v_elig
     where id = p_opening;
    v_id := p_opening;
    -- keep the careers posting text in step (data only)
    if o.job_id is not null then
      update public.job_postings set title = v_title, description = v_desc, total_openings = v_n,
             location = coalesce(v_loc, location)
       where id = o.job_id;
    end if;
  end if;

  has_ := v ? 'salary_min' or v ? 'salary_max' or v ? 'salary_currency' or v ? 'salary_period';
  if has_ then
    select c.salary_min, c.salary_max, c.currency, c.period into v_smin, v_smax, v_cur, v_per
      from public.hr_job_opening_compensation c where c.opening_id = v_id;
    if v ? 'salary_min' then v_smin := hr_private.jnum(v, 'salary_min'); end if;
    if v ? 'salary_max' then v_smax := hr_private.jnum(v, 'salary_max'); end if;
    v_cur := upper(coalesce(case when v ? 'salary_currency' then hr_private.jtext(v, 'salary_currency') end, v_cur, 'INR'));
    v_per := coalesce(case when v ? 'salary_period' then hr_private.jtext(v, 'salary_period') end, v_per, 'annual');
    if (v_smin is not null and v_smin < 0) or (v_smax is not null and v_smax < 0) then perform hr_private.fail('Salary cannot be negative.', 'invalid'); end if;
    if v_smin is not null and v_smax is not null and v_smax < v_smin then perform hr_private.fail('Maximum salary must be at least the minimum.', 'invalid'); end if;
    if v_cur !~ '^[A-Z]{3}$' then perform hr_private.fail('Currency must be a 3-letter code.', 'invalid'); end if;
    if v_per not in ('annual','monthly') then perform hr_private.fail('Salary period must be annual or monthly.', 'invalid'); end if;
    insert into public.hr_job_opening_compensation (opening_id, salary_min, salary_max, currency, period, updated_by)
    values (v_id, v_smin, v_smax, v_cur, v_per, auth.uid())
    on conflict (opening_id) do update set salary_min = excluded.salary_min, salary_max = excluded.salary_max,
      currency = excluded.currency, period = excluded.period, updated_by = excluded.updated_by, updated_at = now();
  end if;

  if v_hm is not null and v_hm is distinct from o.hiring_manager_id then
    perform hr_private.notify_employee(v_hm, 'recruitment_opening', 'You are the hiring manager for ' || v_title, null,
      '/hr/recruitment/openings', 'hr_job_openings', v_id::text);
  end if;
  if v_rec is not null and v_rec is distinct from o.recruiter_id then
    perform hr_private.notify_employee(v_rec, 'recruitment_opening', 'You are the recruiter for ' || v_title, null,
      '/hr/recruitment/openings', 'hr_job_openings', v_id::text);
  end if;
  return v_id;
end $$;

-- Change an opening's status (Open / On hold / Closed / Filled / reopen).
-- Opening here does NOT publish to the careers site; use
-- hr_publish_job_opening for that (the integration point).
create or replace function public.hr_set_job_opening_status(p_opening uuid, p_status text, p_reason text default null, p_closing_date date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.hr_job_openings;
begin
  if not hr_private.has_permission('recruitment.manage') then
    perform hr_private.fail('You are not allowed to manage job openings.', 'forbidden');
  end if;
  select * into o from public.hr_job_openings where id = p_opening for update;
  if o.id is null then perform hr_private.fail('Job opening not found.', 'not_found'); end if;
  if p_status is null or p_status not in ('open','on_hold','closed','filled') then perform hr_private.fail('Unknown job opening status.', 'invalid'); end if;
  if p_status = o.status then return; end if;
  if o.status in ('closed','filled') and not hr_private.has_permission('recruitment.reopen') then
    perform hr_private.fail('You are not allowed to reopen job openings.', 'forbidden');
  end if;
  if p_status in ('on_hold') and nullif(btrim(p_reason), '') is null then
    perform hr_private.fail('Give a reason for putting the opening on hold.', 'reason_required');
  end if;
  if p_closing_date is not null and p_closing_date < hr_private.business_today() then
    perform hr_private.fail('Closing date cannot be in the past.', 'invalid');
  end if;
  if p_status = 'open' and coalesce(p_closing_date, o.closing_date) < hr_private.business_today() then
    perform hr_private.fail('The closing date has passed. Set a new closing date to open the job.', 'closing_date_passed');
  end if;
  perform set_config('hr.status_reason', coalesce(nullif(btrim(p_reason), ''), ''), true);
  update public.hr_job_openings set status = p_status, closing_date = coalesce(p_closing_date, closing_date) where id = p_opening;
  perform set_config('hr.status_reason', '', true);
end $$;

-- ---------------------------------------------------------------------
-- RPCs: applications, candidates, notes, attachments
-- ---------------------------------------------------------------------
-- Manual application (also the entry point a future careers-site
-- integration can call). Candidate matched by email; one application per
-- candidate per opening. p_values keys: full_name, email, phone, source,
-- current_company, experience_years, skills[], qualifications,
-- current_location, notice_period_days, notes, applied_on, recruiter_id,
-- expected_salary, current_salary, salary_currency.
create or replace function public.hr_add_application(p_opening uuid, p_values jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v jsonb := coalesce(p_values, '{}'::jsonb);
  v_status text; v_cand uuid; v_app uuid; v_email text; v_name text; v_src text; v_applied date; v_rec uuid;
  v_exp numeric; v_notice numeric; v_es numeric; v_cs numeric; v_cur text;
begin
  if not hr_private.has_permission('recruitment.manage') then
    perform hr_private.fail('You are not allowed to manage candidates.', 'forbidden');
  end if;
  select status into v_status from public.hr_job_openings where id = p_opening;
  if v_status is null then perform hr_private.fail('Job opening not found.', 'not_found'); end if;
  if v_status in ('closed','filled') then perform hr_private.fail('This opening is closed.', 'invalid_state'); end if;
  v_name := hr_private.jtext(v, 'full_name');
  v_email := lower(hr_private.jtext(v, 'email'));
  if v_name is null or length(v_name) > 200 then perform hr_private.fail('Enter the candidate''s name.', 'invalid'); end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform hr_private.fail('Enter a valid candidate email.', 'invalid'); end if;
  if hr_private.jtext(v, 'phone') is not null and hr_private.jtext(v, 'phone') !~ '^[+0-9 ()-]{7,20}$' then
    perform hr_private.fail('Enter a valid mobile number.', 'invalid');
  end if;
  v_src := coalesce(hr_private.jtext(v, 'source'), 'other');
  if v_src not in ('careers_site','referral','linkedin','agency','campus','job_portal','walk_in','other') then perform hr_private.fail('Unknown application source.', 'invalid'); end if;
  v_applied := coalesce(hr_private.jdate(v, 'applied_on'), hr_private.business_today());
  if v_applied > hr_private.business_today() then perform hr_private.fail('Application date cannot be in the future.', 'invalid'); end if;
  v_rec := hr_private.juuid(v, 'recruiter_id');
  if v_rec is not null and not hr_private.is_active_employee(v_rec) then perform hr_private.fail('Recruiter must be an active employee.', 'invalid'); end if;
  v_exp := hr_private.jnum(v, 'experience_years');
  if v_exp is not null and v_exp not between 0 and 60 then perform hr_private.fail('Experience must be between 0 and 60 years.', 'invalid'); end if;
  v_notice := hr_private.jnum(v, 'notice_period_days');
  if v_notice is not null and v_notice not between 0 and 365 then perform hr_private.fail('Notice period must be 0–365 days.', 'invalid'); end if;
  v_es := hr_private.jnum(v, 'expected_salary'); v_cs := hr_private.jnum(v, 'current_salary');
  if coalesce(v_es, 0) < 0 or coalesce(v_cs, 0) < 0 then perform hr_private.fail('Salary cannot be negative.', 'invalid'); end if;
  v_cur := upper(coalesce(hr_private.jtext(v, 'salary_currency'), 'INR'));
  if v_cur !~ '^[A-Z]{3}$' then perform hr_private.fail('Currency must be a 3-letter code.', 'invalid'); end if;

  insert into public.hr_candidates (full_name, email, phone, source, current_company, experience_years, notes,
                                    skills, qualifications, current_location, notice_period_days)
  values (v_name, v_email, hr_private.jtext(v, 'phone'), v_src, hr_private.jtext(v, 'current_company'), v_exp,
          hr_private.jtext(v, 'notes'), hr_private.jtext_array(v, 'skills', 50, 60), hr_private.jtext(v, 'qualifications'),
          hr_private.jtext(v, 'current_location'), v_notice::smallint)
  on conflict (email) do update set
    phone = coalesce(public.hr_candidates.phone, excluded.phone),
    current_company = coalesce(public.hr_candidates.current_company, excluded.current_company),
    experience_years = coalesce(public.hr_candidates.experience_years, excluded.experience_years),
    qualifications = coalesce(public.hr_candidates.qualifications, excluded.qualifications),
    current_location = coalesce(public.hr_candidates.current_location, excluded.current_location),
    notice_period_days = coalesce(public.hr_candidates.notice_period_days, excluded.notice_period_days),
    skills = case when cardinality(public.hr_candidates.skills) = 0 then excluded.skills else public.hr_candidates.skills end
  returning id into v_cand;
  if exists (select 1 from public.hr_candidate_applications where candidate_id = v_cand and opening_id = p_opening) then
    perform hr_private.fail('This candidate has already applied for this job opening.', 'duplicate_candidate');
  end if;
  insert into public.hr_candidate_applications (candidate_id, opening_id, applied_on, source, recruiter_id)
  values (v_cand, p_opening, v_applied, v_src, v_rec) returning id into v_app;
  if v_es is not null or v_cs is not null then
    insert into public.hr_application_compensation (application_id, expected_salary, current_salary, currency, updated_by)
    values (v_app, v_es, v_cs, v_cur, auth.uid());
  end if;
  if v_rec is not null then
    perform hr_private.notify_employee(v_rec, 'recruitment_assigned', 'A candidate was assigned to you: ' || v_name, null,
      '/hr/recruitment/applications/' || v_app, 'hr_candidate_applications', v_app::text);
  end if;
  return v_app;
end $$;

-- Update application-level fields: recruiter_id, source, applied_on,
-- expected_salary, current_salary, salary_currency (keys present only).
create or replace function public.hr_update_application(p_application uuid, p_values jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.hr_candidate_applications; v jsonb := coalesce(p_values, '{}'::jsonb);
  v_rec uuid; v_src text; v_applied date; v_es numeric; v_cs numeric; v_cur text; v_name text;
begin
  if not hr_private.has_permission('recruitment.manage') then
    perform hr_private.fail('You are not allowed to manage candidates.', 'forbidden');
  end if;
  select * into a from public.hr_candidate_applications where id = p_application for update;
  if a.id is null then perform hr_private.fail('Application not found.', 'not_found'); end if;
  v_rec := case when v ? 'recruiter_id' then hr_private.juuid(v, 'recruiter_id') else a.recruiter_id end;
  v_src := case when v ? 'source' then hr_private.jtext(v, 'source') else a.source end;
  v_applied := case when v ? 'applied_on' then coalesce(hr_private.jdate(v, 'applied_on'), a.applied_on) else a.applied_on end;
  if v_rec is not null and v_rec is distinct from a.recruiter_id and not hr_private.is_active_employee(v_rec) then
    perform hr_private.fail('Recruiter must be an active employee.', 'invalid');
  end if;
  if v_src is not null and v_src not in ('careers_site','referral','linkedin','agency','campus','job_portal','walk_in','other') then
    perform hr_private.fail('Unknown application source.', 'invalid');
  end if;
  if v_applied > hr_private.business_today() then perform hr_private.fail('Application date cannot be in the future.', 'invalid'); end if;
  update public.hr_candidate_applications set recruiter_id = v_rec, source = v_src, applied_on = v_applied where id = p_application;

  if v ? 'expected_salary' or v ? 'current_salary' or v ? 'salary_currency' then
    select c.expected_salary, c.current_salary, c.currency into v_es, v_cs, v_cur from public.hr_application_compensation c where c.application_id = p_application;
    if v ? 'expected_salary' then v_es := hr_private.jnum(v, 'expected_salary'); end if;
    if v ? 'current_salary' then v_cs := hr_private.jnum(v, 'current_salary'); end if;
    v_cur := upper(coalesce(case when v ? 'salary_currency' then hr_private.jtext(v, 'salary_currency') end, v_cur, 'INR'));
    if coalesce(v_es, 0) < 0 or coalesce(v_cs, 0) < 0 then perform hr_private.fail('Salary cannot be negative.', 'invalid'); end if;
    if v_cur !~ '^[A-Z]{3}$' then perform hr_private.fail('Currency must be a 3-letter code.', 'invalid'); end if;
    insert into public.hr_application_compensation (application_id, expected_salary, current_salary, currency, updated_by)
    values (p_application, v_es, v_cs, v_cur, auth.uid())
    on conflict (application_id) do update set expected_salary = excluded.expected_salary, current_salary = excluded.current_salary,
      currency = excluded.currency, updated_by = excluded.updated_by, updated_at = now();
  end if;
  if v_rec is not null and v_rec is distinct from a.recruiter_id then
    select full_name into v_name from public.hr_candidates where id = a.candidate_id;
    perform hr_private.notify_employee(v_rec, 'recruitment_assigned', 'A candidate was assigned to you: ' || v_name, null,
      '/hr/recruitment/applications/' || p_application, 'hr_candidate_applications', p_application::text);
  end if;
end $$;

create or replace function public.hr_add_candidate_note(p_candidate uuid, p_body text, p_application uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not (hr_private.can_manage_candidate(p_candidate)
          or (p_application is not null and hr_private.is_hiring_manager_for_application(p_application))) then
    perform hr_private.fail('You are not allowed to add notes for this candidate.', 'forbidden');
  end if;
  if p_application is not null and not exists (select 1 from public.hr_candidate_applications where id = p_application and candidate_id = p_candidate) then
    perform hr_private.fail('The application does not belong to this candidate.', 'invalid');
  end if;
  if nullif(btrim(p_body), '') is null or length(p_body) > 4000 then perform hr_private.fail('Write a note of up to 4000 characters.', 'invalid'); end if;
  insert into public.hr_candidate_notes (candidate_id, application_id, body, author_user_id, author_employee_id)
  values (p_candidate, p_application, btrim(p_body), auth.uid(), hr_private.current_employee_id()) returning id into v_id;
  return v_id;
end $$;

-- Register an attachment; the browser then uploads to the returned path.
create or replace function public.hr_register_candidate_attachment(
  p_candidate uuid, p_kind text, p_file_name text, p_mime_type text, p_size_bytes integer, p_application uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid := gen_random_uuid(); v_path text; v_safe text;
begin
  if not hr_private.can_manage_candidate(p_candidate) then
    perform hr_private.fail('You are not allowed to upload files for this candidate.', 'forbidden');
  end if;
  if not exists (select 1 from public.hr_candidates where id = p_candidate) then perform hr_private.fail('Candidate not found.', 'not_found'); end if;
  if p_application is not null and not exists (select 1 from public.hr_candidate_applications where id = p_application and candidate_id = p_candidate) then
    perform hr_private.fail('The application does not belong to this candidate.', 'invalid');
  end if;
  if coalesce(p_kind, '') not in ('resume','cover_letter','portfolio','certificate','id_proof','other') then perform hr_private.fail('Unknown attachment type.', 'invalid'); end if;
  if p_mime_type is null or p_mime_type not in ('application/pdf','image/png','image/jpeg','image/webp','application/msword',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document') then
    perform hr_private.fail('Only PDF, Word, PNG, JPEG and WEBP files are allowed.', 'invalid_file');
  end if;
  if p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 10485760 then perform hr_private.fail('Files must be between 1 byte and 10 MB.', 'invalid_file'); end if;
  if nullif(btrim(p_file_name), '') is null or length(p_file_name) > 200 then perform hr_private.fail('Invalid file name.', 'invalid_file'); end if;
  v_safe := left(regexp_replace(btrim(p_file_name), '[^A-Za-z0-9._-]+', '_', 'g'), 120);
  v_path := p_candidate::text || '/' || v_id::text || '-' || v_safe;
  insert into public.hr_candidate_attachments (id, candidate_id, application_id, kind, file_name, mime_type, size_bytes, storage_path, uploaded_by)
  values (v_id, p_candidate, p_application, p_kind, btrim(p_file_name), p_mime_type, p_size_bytes, v_path, auth.uid());
  return jsonb_build_object('id', v_id, 'bucket', 'hr-recruitment', 'storage_path', v_path);
end $$;

create or replace function public.hr_confirm_candidate_attachment(p_attachment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.hr_candidate_attachments;
begin
  select * into t from public.hr_candidate_attachments where id = p_attachment for update;
  if t.id is null then perform hr_private.fail('Attachment not found.', 'not_found'); end if;
  if t.uploaded_by is distinct from auth.uid() and not hr_private.has_permission('recruitment.manage') then
    perform hr_private.fail('You are not allowed to confirm this upload.', 'forbidden');
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'hr-recruitment' and o.name = t.storage_path) then
    perform hr_private.fail('The file has not been uploaded yet.', 'upload_missing');
  end if;
  update public.hr_candidate_attachments set confirmed_at = coalesce(confirmed_at, now()) where id = p_attachment;
end $$;

create or replace function public.hr_archive_candidate_attachment(p_attachment uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.hr_candidate_attachments;
begin
  select * into t from public.hr_candidate_attachments where id = p_attachment for update;
  if t.id is null then perform hr_private.fail('Attachment not found.', 'not_found'); end if;
  if not hr_private.can_manage_candidate(t.candidate_id) then perform hr_private.fail('You are not allowed to remove this file.', 'forbidden'); end if;
  if t.archived_at is not null then return; end if;
  if nullif(btrim(p_reason), '') is null then perform hr_private.fail('Give a reason for removing the file.', 'reason_required'); end if;
  update public.hr_candidate_attachments set archived_at = now(), archived_by = auth.uid(), archive_reason = btrim(p_reason) where id = p_attachment;
end $$;

-- ---------------------------------------------------------------------
-- RPCs: screening
-- ---------------------------------------------------------------------
-- p_values: resume_reviewed, checklist [{item, met}], answers [{question, answer}],
-- score (0-100), notes, decision ('shortlist'|'reject'|'hold'), reason.
create or replace function public.hr_record_screening(p_application uuid, p_values jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  a public.hr_candidate_applications; v jsonb := coalesce(p_values, '{}'::jsonb);
  v_dec text; v_reason text; v_score numeric; v_id uuid; v_stage text;
begin
  if not hr_private.can_screen_application(p_application) then
    perform hr_private.fail('You are not allowed to screen this candidate.', 'forbidden');
  end if;
  select * into a from public.hr_candidate_applications where id = p_application for update;
  if a.id is null then perform hr_private.fail('Application not found.', 'not_found'); end if;
  if a.stage not in ('applied','screening') then
    perform hr_private.fail('Only candidates in Applied or Screening can be screened.', 'invalid_state');
  end if;
  v_dec := hr_private.jtext(v, 'decision');
  v_reason := hr_private.jtext(v, 'reason');
  v_score := hr_private.jnum(v, 'score');
  if v_dec is null or v_dec not in ('shortlist','reject','hold') then perform hr_private.fail('Choose shortlist, reject or hold.', 'invalid'); end if;
  if v_dec in ('reject','hold') and v_reason is null then perform hr_private.fail('Give a reason for this screening decision.', 'reason_required'); end if;
  if v_score is not null and v_score not between 0 and 100 then perform hr_private.fail('Screening score must be between 0 and 100.', 'invalid'); end if;
  if v ? 'checklist' and jsonb_typeof(v -> 'checklist') <> 'array' then perform hr_private.fail('Invalid eligibility checklist.', 'invalid'); end if;
  if v ? 'answers' and jsonb_typeof(v -> 'answers') <> 'array' then perform hr_private.fail('Invalid screening answers.', 'invalid'); end if;
  if length(coalesce(hr_private.jtext(v, 'notes'), '')) > 4000 then perform hr_private.fail('Screening notes can be at most 4000 characters.', 'invalid'); end if;

  v_stage := a.stage;
  if a.stage = 'applied' then
    perform hr_private.set_candidate_stage(p_application, 'screening', 'Screening started');
  end if;
  insert into public.hr_candidate_screenings (application_id, reviewer_user_id, reviewer_employee_id, resume_reviewed, checklist, answers,
                                              score, notes, decision, reason, stage_before)
  values (p_application, auth.uid(), hr_private.current_employee_id(), coalesce((v ->> 'resume_reviewed')::boolean, false),
          coalesce(v -> 'checklist', '[]'::jsonb), coalesce(v -> 'answers', '[]'::jsonb), v_score, hr_private.jtext(v, 'notes'),
          v_dec, v_reason, v_stage)
  returning id into v_id;
  if v_dec = 'shortlist' then
    perform hr_private.set_candidate_stage(p_application, 'shortlisted', 'Screening: shortlisted' || coalesce(' — ' || v_reason, ''));
  elsif v_dec = 'reject' then
    perform hr_private.reject_application(p_application, 'Screening: ' || v_reason);
  else
    perform hr_private.hold_application(p_application, 'Screening: ' || v_reason);
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- RPCs: interviews
-- ---------------------------------------------------------------------
create or replace function public.hr_reschedule_interview(
  p_interview uuid, p_scheduled_at timestamptz, p_reason text, p_mode text default null, p_location_or_link text default null,
  p_duration_minutes integer default null, p_interviewers uuid[] default null)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.hr_interviews; v_mode text; v_loc text; v_emp uuid;
begin
  select * into i from public.hr_interviews where id = p_interview for update;
  if i.id is null then perform hr_private.fail('Interview not found.', 'not_found'); end if;
  if not hr_private.can_screen_application(i.application_id) then
    perform hr_private.fail('You are not allowed to reschedule interviews.', 'forbidden');
  end if;
  if i.status <> 'scheduled' then perform hr_private.fail('Only a scheduled interview can be rescheduled.', 'invalid_state'); end if;
  if p_scheduled_at is null then perform hr_private.fail('Choose the new date and time.', 'invalid'); end if;
  if nullif(btrim(p_reason), '') is null then perform hr_private.fail('Give a reason for rescheduling.', 'reason_required'); end if;
  v_mode := coalesce(p_mode, i.mode);
  if v_mode not in ('in_person','video','phone') then perform hr_private.fail('Unknown interview mode.', 'invalid'); end if;
  v_loc := case when p_location_or_link is null then i.location_or_link else nullif(btrim(p_location_or_link), '') end;
  if p_duration_minutes is not null and p_duration_minutes not between 5 and 480 then perform hr_private.fail('Duration must be 5–480 minutes.', 'invalid'); end if;
  if p_scheduled_at = i.scheduled_at and v_mode = i.mode and v_loc is not distinct from i.location_or_link then
    perform hr_private.fail('Nothing changed: choose a new time, mode or place.', 'invalid');
  end if;
  insert into public.hr_interview_reschedules (interview_id, old_scheduled_at, new_scheduled_at, old_mode, new_mode,
                                               old_location_or_link, new_location_or_link, reason, changed_by)
  values (i.id, i.scheduled_at, p_scheduled_at, i.mode, v_mode, i.location_or_link, v_loc, btrim(p_reason), auth.uid());
  perform set_config('hr.recruitment_rpc', 'on', true);
  update public.hr_interviews set scheduled_at = p_scheduled_at, mode = v_mode, location_or_link = v_loc,
         duration_minutes = coalesce(p_duration_minutes, duration_minutes), reschedule_count = reschedule_count + 1
   where id = i.id;
  perform set_config('hr.recruitment_rpc', 'off', true);
  if p_interviewers is not null then
    if coalesce(array_length(p_interviewers, 1), 0) = 0 then perform hr_private.fail('Add at least one interviewer.', 'invalid'); end if;
    if exists (select 1 from unnest(p_interviewers) x(id) where not hr_private.is_active_employee(x.id)) then
      perform hr_private.fail('Every interviewer must be an active employee.', 'invalid');
    end if;
    if exists (select 1 from public.hr_interview_feedback f where f.interview_id = i.id and not (f.interviewer_id = any (p_interviewers))) then
      perform hr_private.fail('An interviewer who has already written an evaluation cannot be removed.', 'invalid');
    end if;
    delete from public.hr_interview_panel where interview_id = i.id and not (employee_id = any (p_interviewers));
    insert into public.hr_interview_panel (interview_id, employee_id) select distinct i.id, x from unnest(p_interviewers) x on conflict do nothing;
  end if;
  for v_emp in select employee_id from public.hr_interview_panel where interview_id = i.id loop
    perform hr_private.notify_employee(v_emp, 'interview_rescheduled', 'An interview has been rescheduled',
      'New time: ' || to_char(p_scheduled_at at time zone hr_private.business_timezone(), 'DD Mon YYYY HH24:MI'),
      '/employee/interviews', 'hr_interviews', i.id::text);
  end loop;
end $$;

-- Scheduled -> completed / cancelled / no_show (cancel needs a reason).
create or replace function public.hr_set_interview_status(p_interview uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.hr_interviews; v_emp uuid;
begin
  select * into i from public.hr_interviews where id = p_interview for update;
  if i.id is null then perform hr_private.fail('Interview not found.', 'not_found'); end if;
  if not hr_private.can_screen_application(i.application_id) then
    perform hr_private.fail('You are not allowed to update interviews.', 'forbidden');
  end if;
  if p_status not in ('completed','cancelled','no_show') then perform hr_private.fail('Unknown interview status.', 'invalid'); end if;
  if i.status <> 'scheduled' then perform hr_private.fail('This interview is already ' || replace(i.status, '_', ' ') || '.', 'invalid_state'); end if;
  if p_status = 'cancelled' and nullif(btrim(p_reason), '') is null then perform hr_private.fail('Give a reason for cancelling.', 'reason_required'); end if;
  if p_status in ('completed','no_show') and i.scheduled_at > now() then
    perform hr_private.fail('An interview can be marked completed or no-show only after it has started.', 'too_early');
  end if;
  update public.hr_interviews set status = p_status, cancel_reason = case when p_status = 'cancelled' then btrim(p_reason) else cancel_reason end,
         notes = case when p_status <> 'cancelled' and nullif(btrim(p_reason), '') is not null then concat_ws(E'\n', notes, btrim(p_reason)) else notes end
   where id = i.id;
  if p_status = 'cancelled' then
    for v_emp in select employee_id from public.hr_interview_panel where interview_id = i.id loop
      perform hr_private.notify_employee(v_emp, 'interview_cancelled', 'An interview has been cancelled', btrim(p_reason),
        '/employee/interviews', 'hr_interviews', i.id::text);
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- RPCs: evaluations and final decision
-- ---------------------------------------------------------------------
-- Save (draft) or submit the caller's own evaluation. Submitted
-- evaluations are locked; HR can re-open one for its author only.
-- p_values: rating (overall 1-5), recommendation, technical_score, hr_score,
-- communication_score, role_skills_score, experience_score, strengths,
-- concerns, comments.
create or replace function public.hr_save_interview_evaluation(p_interview uuid, p_values jsonb, p_submit boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  i public.hr_interviews; f public.hr_interview_feedback; v jsonb := coalesce(p_values, '{}'::jsonb);
  v_me uuid := hr_private.current_employee_id(); v_id uuid; v_rec text; k text;
  v_rating numeric; v_scores numeric[];
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  select * into i from public.hr_interviews where id = p_interview for update;
  if i.id is null or not exists (select 1 from public.hr_interview_panel where interview_id = p_interview and employee_id = v_me) then
    perform hr_private.fail('Only interviewers on this panel can write an evaluation.', 'forbidden');
  end if;
  if i.status in ('cancelled','no_show') then perform hr_private.fail('This interview did not take place.', 'invalid_state'); end if;
  select * into f from public.hr_interview_feedback where interview_id = p_interview and interviewer_id = v_me for update;
  if f.id is not null and f.status = 'submitted' then
    perform hr_private.fail('You have already submitted this evaluation. Ask HR to re-open it if it needs a correction.', 'already_submitted');
  end if;
  v_rating := hr_private.jnum(v, 'rating');
  v_rec := hr_private.jtext(v, 'recommendation');
  if v_rating is not null and (v_rating not between 1 and 5 or v_rating <> trunc(v_rating)) then perform hr_private.fail('Overall rating must be a whole number from 1 to 5.', 'invalid'); end if;
  if v_rec is not null and v_rec not in ('strong_hire','hire','hold','no_hire','strong_no_hire') then perform hr_private.fail('Unknown recommendation.', 'invalid'); end if;
  foreach k in array array['technical_score','hr_score','communication_score','role_skills_score','experience_score'] loop
    if hr_private.jnum(v, k) is not null and (hr_private.jnum(v, k) not between 1 and 5 or hr_private.jnum(v, k) <> trunc(hr_private.jnum(v, k))) then
      perform hr_private.fail('Scores must be whole numbers from 1 to 5.', 'invalid');
    end if;
  end loop;
  if coalesce(p_submit, false) then
    if i.scheduled_at > now() then perform hr_private.fail('Feedback can be submitted after the interview has started.', 'too_early'); end if;
    if v_rating is null or v_rec is null then perform hr_private.fail('Give an overall rating and a recommendation before submitting.', 'incomplete'); end if;
    if coalesce(hr_private.jtext(v, 'strengths'), hr_private.jtext(v, 'concerns'), hr_private.jtext(v, 'comments')) is null then
      perform hr_private.fail('Add comments, strengths or concerns before submitting.', 'incomplete');
    end if;
  end if;
  if f.id is null then
    insert into public.hr_interview_feedback (interview_id, interviewer_id, rating, recommendation, strengths, concerns, comments,
        technical_score, hr_score, communication_score, role_skills_score, experience_score, status, submitted_at)
    values (p_interview, v_me, v_rating::smallint, v_rec, hr_private.jtext(v, 'strengths'), hr_private.jtext(v, 'concerns'), hr_private.jtext(v, 'comments'),
        hr_private.jnum(v, 'technical_score')::smallint, hr_private.jnum(v, 'hr_score')::smallint, hr_private.jnum(v, 'communication_score')::smallint,
        hr_private.jnum(v, 'role_skills_score')::smallint, hr_private.jnum(v, 'experience_score')::smallint,
        case when p_submit then 'submitted' else 'draft' end, case when p_submit then now() end)
    returning id into v_id;
  else
    update public.hr_interview_feedback set rating = v_rating::smallint, recommendation = v_rec,
        strengths = hr_private.jtext(v, 'strengths'), concerns = hr_private.jtext(v, 'concerns'), comments = hr_private.jtext(v, 'comments'),
        technical_score = hr_private.jnum(v, 'technical_score')::smallint, hr_score = hr_private.jnum(v, 'hr_score')::smallint,
        communication_score = hr_private.jnum(v, 'communication_score')::smallint, role_skills_score = hr_private.jnum(v, 'role_skills_score')::smallint,
        experience_score = hr_private.jnum(v, 'experience_score')::smallint,
        status = case when p_submit then 'submitted' else 'draft' end, submitted_at = case when p_submit then now() end
     where id = f.id;
    v_id := f.id;
  end if;
  if p_submit and i.status = 'scheduled' then update public.hr_interviews set status = 'completed' where id = p_interview; end if;
  return v_id;
end $$;

-- 104 RPC kept (same signature); now also submits an existing draft.
create or replace function public.hr_submit_interview_feedback(
  p_interview uuid, p_rating integer, p_recommendation text, p_strengths text default null, p_concerns text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid := hr_private.current_employee_id(); f public.hr_interview_feedback;
begin
  if v_me is not null then
    select * into f from public.hr_interview_feedback where interview_id = p_interview and interviewer_id = v_me;
  end if;
  return public.hr_save_interview_evaluation(p_interview,
    jsonb_build_object('rating', p_rating, 'recommendation', p_recommendation,
                       'strengths', coalesce(p_strengths, f.strengths), 'concerns', coalesce(p_concerns, f.concerns),
                       'comments', coalesce(f.comments, case when p_strengths is null and p_concerns is null then 'Rating ' || p_rating || '/5' end),
                       'technical_score', f.technical_score, 'hr_score', f.hr_score, 'communication_score', f.communication_score,
                       'role_skills_score', f.role_skills_score, 'experience_score', f.experience_score),
    true);
end $$;

create or replace function public.hr_reopen_interview_evaluation(p_feedback uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare f public.hr_interview_feedback;
begin
  if not hr_private.has_permission('recruitment.manage') then
    perform hr_private.fail('You are not allowed to re-open evaluations.', 'forbidden');
  end if;
  select * into f from public.hr_interview_feedback where id = p_feedback for update;
  if f.id is null then perform hr_private.fail('Evaluation not found.', 'not_found'); end if;
  if f.status <> 'submitted' then perform hr_private.fail('Only a submitted evaluation can be re-opened.', 'invalid_state'); end if;
  if nullif(btrim(p_reason), '') is null then perform hr_private.fail('Give a reason for re-opening the evaluation.', 'reason_required'); end if;
  if exists (select 1 from public.hr_interviews i join public.hr_candidate_applications a on a.id = i.application_id
             where i.id = f.interview_id and a.stage in ('selected','offered','joined','rejected','withdrawn')) then
    perform hr_private.fail('A final decision has already been made for this candidate.', 'invalid_state');
  end if;
  update public.hr_interview_feedback set status = 'draft', submitted_at = null, reopened_at = now(), reopened_by = auth.uid(),
         reopen_reason = btrim(p_reason) where id = p_feedback;
  perform hr_private.notify_employee(f.interviewer_id, 'evaluation_reopened', 'Your interview evaluation was re-opened for correction',
    btrim(p_reason), '/employee/interviews', 'hr_interview_feedback', f.id::text);
end $$;

-- Final decision after interviews: recruitment.manage or the opening's
-- hiring manager. hire -> Selected; reject -> Rejected; hold -> on hold.
create or replace function public.hr_record_hiring_decision(p_application uuid, p_decision text, p_reason text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare a public.hr_candidate_applications; v_id uuid; v_reason text := nullif(btrim(p_reason), '');
begin
  if not (hr_private.has_permission('recruitment.manage') or hr_private.is_hiring_manager_for_application(p_application)) then
    perform hr_private.fail('Only HR or the hiring manager can make the final decision.', 'forbidden');
  end if;
  select * into a from public.hr_candidate_applications where id = p_application for update;
  if a.id is null then perform hr_private.fail('Application not found.', 'not_found'); end if;
  if a.stage <> 'interview' then perform hr_private.fail('A final decision can be made only for candidates in the Interview stage.', 'invalid_state'); end if;
  if p_decision not in ('hire','hold','reject') then perform hr_private.fail('Choose hire, hold or reject.', 'invalid'); end if;
  if p_decision <> 'hire' and v_reason is null then perform hr_private.fail('Give a reason for this decision.', 'reason_required'); end if;
  if p_decision = 'hire' and not exists (
       select 1 from public.hr_interview_feedback f join public.hr_interviews i on i.id = f.interview_id
       where i.application_id = p_application and f.status = 'submitted') then
    perform hr_private.fail('At least one submitted interview evaluation is required before hiring.', 'evaluation_required');
  end if;
  if exists (select 1 from public.hr_candidates c join public.hr_employees me on me.id = hr_private.current_employee_id()
             where c.id = a.candidate_id and lower(me.company_email::text) = lower(c.email::text)) then
    perform hr_private.fail('You cannot decide on your own application.', 'self_action');
  end if;
  insert into public.hr_hiring_decisions (application_id, decision, reason, decided_by, decided_by_employee)
  values (p_application, p_decision, v_reason, auth.uid(), hr_private.current_employee_id()) returning id into v_id;
  if p_decision = 'hire' then
    perform hr_private.set_candidate_stage(p_application, 'selected', 'Final decision: hire' || coalesce(' — ' || v_reason, ''));
  elsif p_decision = 'reject' then
    perform hr_private.reject_application(p_application, 'Final decision: ' || v_reason);
  else
    perform hr_private.hold_application(p_application, 'Final decision: ' || v_reason);
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- RPCs: offer letters
-- ---------------------------------------------------------------------
create or replace function public.hr_save_offer_template(p_template uuid, p_name text, p_subject text, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare t public.hr_offer_letter_templates; v_id uuid;
begin
  if not hr_private.has_permission('recruitment.manage') then perform hr_private.fail('You are not allowed to manage offer templates.', 'forbidden'); end if;
  if nullif(btrim(p_name), '') is null or nullif(btrim(p_subject), '') is null or length(coalesce(p_body, '')) < 20 then
    perform hr_private.fail('Enter a name, a subject and a letter body of at least 20 characters.', 'invalid');
  end if;
  perform hr_private.check_offer_template(p_subject, p_body);
  if p_template is null then
    insert into public.hr_offer_letter_templates (name, subject, body, status, updated_by)
    values (btrim(p_name), btrim(p_subject), p_body, 'draft', auth.uid()) returning id into v_id;
  else
    select * into t from public.hr_offer_letter_templates where id = p_template for update;
    if t.id is null then perform hr_private.fail('Template not found.', 'not_found'); end if;
    if t.status = 'archived' then perform hr_private.fail('An archived template cannot be edited.', 'invalid_state'); end if;
    -- Any edit sends the template back to draft: it must be approved again.
    update public.hr_offer_letter_templates set name = btrim(p_name), subject = btrim(p_subject), body = p_body,
           status = 'draft', approved_by = null, approved_at = null, is_default = false, updated_by = auth.uid()
     where id = p_template;
    v_id := p_template;
  end if;
  return v_id;
end $$;

-- Approve (settings.manage: HR Admin / Super Admin) or archive a template.
create or replace function public.hr_set_offer_template_status(p_template uuid, p_status text, p_make_default boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.hr_offer_letter_templates;
begin
  if not (hr_private.has_permission('recruitment.manage') and hr_private.has_permission('settings.manage')) then
    perform hr_private.fail('Only HR administrators can approve or archive offer templates.', 'forbidden');
  end if;
  select * into t from public.hr_offer_letter_templates where id = p_template for update;
  if t.id is null then perform hr_private.fail('Template not found.', 'not_found'); end if;
  if p_status not in ('approved','archived') then perform hr_private.fail('Unknown template status.', 'invalid'); end if;
  if p_status = 'approved' then
    perform hr_private.check_offer_template(t.subject, t.body);
    if coalesce(p_make_default, false) then update public.hr_offer_letter_templates set is_default = false where is_default and id <> p_template; end if;
    update public.hr_offer_letter_templates set status = 'approved', approved_by = auth.uid(), approved_at = now(),
           is_default = coalesce(p_make_default, false) or is_default where id = p_template;
  else
    update public.hr_offer_letter_templates set status = 'archived', is_default = false where id = p_template;
  end if;
end $$;

-- Merge data for an offer (internal). CTC is formatted with grouping.
create or replace function hr_private.offer_merge_data(p_offer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare f public.hr_offers; a public.hr_candidate_applications; c public.hr_candidates; o public.hr_job_openings;
  v_co jsonb := coalesce(hr_private.setting('company'), '{}'::jsonb); v_sig_name text; v_sig_title text;
begin
  select * into f from public.hr_offers where id = p_offer;
  select * into a from public.hr_candidate_applications where id = f.application_id;
  select * into c from public.hr_candidates where id = a.candidate_id;
  select * into o from public.hr_job_openings where id = a.opening_id;
  if f.signatory_employee_id is not null then
    select coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name)), d.name into v_sig_name, v_sig_title
      from public.hr_employees e left join public.hr_designations d on d.id = e.designation_id where e.id = f.signatory_employee_id;
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'candidate_name', c.full_name,
    'candidate_email', c.email::text,
    'job_title', o.title,
    'designation', (select name from public.hr_designations where id = f.offered_designation_id),
    'department', (select name from public.hr_departments where id = f.department_id),
    'work_location', coalesce(f.work_location, o.location),
    'employment_type', (select name from public.hr_employment_types where code = f.employment_type),
    'annual_ctc', case when f.annual_ctc is not null then btrim(to_char(f.annual_ctc, 'FM999,999,999,990.00')) end,
    'currency', f.currency,
    'joining_date', to_char(f.proposed_joining_date, 'DD Mon YYYY'),
    'issue_date', to_char(coalesce(f.issued_on, hr_private.business_today()), 'DD Mon YYYY'),
    'valid_until', to_char(f.expires_on, 'DD Mon YYYY'),
    'signatory_name', coalesce(nullif(btrim(f.signatory_name), ''), v_sig_name),
    'signatory_title', coalesce(nullif(btrim(f.signatory_title), ''), v_sig_title),
    'company_name', coalesce(v_co ->> 'name', 'Zyllo Tech'),
    'company_legal_name', coalesce(v_co ->> 'legal_name', v_co ->> 'name', 'Zyllo Tech'),
    'reference', 'OFR-' || upper(left(replace(f.id::text, '-', ''), 8))));
end $$;

create or replace function hr_private.render_offer_text(p_text text, p_data jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare v text := p_text; r record; v_missing text;
begin
  for r in select key, value from jsonb_each_text(p_data) loop
    v := regexp_replace(v, '\{\{\s*' || r.key || '\s*\}\}', replace(r.value, '\', '\\'), 'g');
  end loop;
  select string_agg(distinct replace(m[1], '_', ' '), ', ') into v_missing from regexp_matches(v, '\{\{\s*([A-Za-z0-9_]+)\s*\}\}', 'g') m;
  if v_missing is not null then
    perform hr_private.fail('Fill in these offer details before generating the letter: ' || v_missing || '.', 'offer_incomplete');
  end if;
  return v;
end $$;

-- Internal: create the next letter version for a draft offer.
create or replace function hr_private.generate_offer_letter(p_offer uuid, p_template uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare f public.hr_offers; t public.hr_offer_letter_templates; v_data jsonb; v_ver int;
begin
  select * into f from public.hr_offers where id = p_offer for update;
  if f.id is null then perform hr_private.fail('Offer not found.', 'not_found'); end if;
  if f.status <> 'draft' then perform hr_private.fail('The letter of an issued offer cannot be regenerated.', 'invalid_state'); end if;
  if p_template is null then
    select * into t from public.hr_offer_letter_templates where status = 'approved' order by is_default desc, approved_at limit 1;
  else
    select * into t from public.hr_offer_letter_templates where id = p_template;
  end if;
  if t.id is null then perform hr_private.fail('No approved offer letter template is available.', 'no_template'); end if;
  if t.status <> 'approved' then perform hr_private.fail('Only an approved template can be used.', 'template_not_approved'); end if;
  v_data := hr_private.offer_merge_data(p_offer);
  v_ver := f.current_version + 1;
  insert into public.hr_offer_letter_versions (offer_id, version, template_id, template_name, subject, body, merge_data, generated_by)
  values (p_offer, v_ver, t.id, t.name, hr_private.render_offer_text(t.subject, v_data), hr_private.render_offer_text(t.body, v_data), v_data, auth.uid());
  update public.hr_offers set current_version = v_ver, template_id = t.id, letter_stale = false where id = p_offer;
  return v_ver;
end $$;

create or replace function public.hr_generate_offer_letter(p_offer uuid, p_template uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
begin
  if not hr_private.has_permission('recruitment.manage') then perform hr_private.fail('You are not allowed to manage offers.', 'forbidden'); end if;
  return hr_private.generate_offer_letter(p_offer, p_template);
end $$;

-- Edit a draft offer. Keys: designation_id, department_id, employment_type,
-- joining_date, annual_ctc, currency, expires_on, work_location,
-- signatory_employee_id, signatory_name, signatory_title, notes.
create or replace function public.hr_update_offer(p_offer uuid, p_values jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare f public.hr_offers; v jsonb := coalesce(p_values, '{}'::jsonb);
  v_des uuid; v_dep uuid; v_type text; v_join date; v_ctc numeric; v_cur text; v_exp date; v_sig uuid;
begin
  if not hr_private.has_permission('recruitment.manage') then perform hr_private.fail('You are not allowed to manage offers.', 'forbidden'); end if;
  select * into f from public.hr_offers where id = p_offer for update;
  if f.id is null then perform hr_private.fail('Offer not found.', 'not_found'); end if;
  if f.status <> 'draft' then perform hr_private.fail('Only a draft offer can be edited.', 'invalid_state'); end if;
  v_des := case when v ? 'designation_id' then hr_private.juuid(v, 'designation_id') else f.offered_designation_id end;
  v_dep := case when v ? 'department_id' then hr_private.juuid(v, 'department_id') else f.department_id end;
  v_type := case when v ? 'employment_type' then coalesce(hr_private.jtext(v, 'employment_type'), f.employment_type) else f.employment_type end;
  v_join := case when v ? 'joining_date' then hr_private.jdate(v, 'joining_date') else f.proposed_joining_date end;
  v_ctc := case when v ? 'annual_ctc' then hr_private.jnum(v, 'annual_ctc') else f.annual_ctc end;
  v_cur := case when v ? 'currency' then upper(coalesce(hr_private.jtext(v, 'currency'), 'INR')) else f.currency end;
  v_exp := case when v ? 'expires_on' then hr_private.jdate(v, 'expires_on') else f.expires_on end;
  v_sig := case when v ? 'signatory_employee_id' then hr_private.juuid(v, 'signatory_employee_id') else f.signatory_employee_id end;
  if not exists (select 1 from public.hr_employment_types where code = v_type and active) then perform hr_private.fail('Unknown employment type.', 'invalid'); end if;
  if v_des is not null and v_dep is not null and exists (select 1 from public.hr_designations where id = v_des and department_id is not null and department_id <> v_dep) then
    perform hr_private.fail('The designation belongs to another department.', 'invalid');
  end if;
  if v_ctc is not null and v_ctc < 0 then perform hr_private.fail('Compensation cannot be negative.', 'invalid'); end if;
  if v_cur !~ '^[A-Z]{3}$' then perform hr_private.fail('Currency must be a 3-letter code.', 'invalid'); end if;
  if v_exp is not null and v_exp < hr_private.business_today() then perform hr_private.fail('Offer validity cannot end in the past.', 'invalid'); end if;
  if v_join is not null and v_exp is not null and v_join < v_exp - 365 then perform hr_private.fail('Check the joining date.', 'invalid'); end if;
  if v_sig is not null and v_sig is distinct from f.signatory_employee_id and not hr_private.is_active_employee(v_sig) then
    perform hr_private.fail('The signatory must be an active employee.', 'invalid');
  end if;
  update public.hr_offers set offered_designation_id = v_des, department_id = v_dep, employment_type = v_type,
         proposed_joining_date = v_join, annual_ctc = v_ctc, currency = v_cur, expires_on = v_exp,
         work_location = case when v ? 'work_location' then hr_private.jtext(v, 'work_location') else work_location end,
         signatory_employee_id = v_sig,
         signatory_name = case when v ? 'signatory_name' then hr_private.jtext(v, 'signatory_name') else signatory_name end,
         signatory_title = case when v ? 'signatory_title' then hr_private.jtext(v, 'signatory_title') else signatory_title end,
         notes = case when v ? 'notes' then hr_private.jtext(v, 'notes') else notes end,
         letter_stale = current_version > 0
   where id = p_offer;
end $$;

-- Internal issue: draft -> sent ("Issued"); stage -> offered.
create or replace function hr_private.issue_offer(p_offer uuid, p_strict boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare f public.hr_offers; v_stage text; v_data jsonb;
begin
  select * into f from public.hr_offers where id = p_offer for update;
  if f.id is null then perform hr_private.fail('Offer not found.', 'not_found'); end if;
  if f.status <> 'draft' then perform hr_private.fail('Only a draft offer can be issued.', 'invalid_state'); end if;
  select stage into v_stage from public.hr_candidate_applications where id = f.application_id for update;
  if v_stage not in ('selected','offered') then perform hr_private.fail('The candidate is no longer selected.', 'invalid_state'); end if;
  if p_strict then
    if f.current_version = 0 then perform hr_private.fail('Generate the offer letter before issuing the offer.', 'letter_required'); end if;
    if f.letter_stale then perform hr_private.fail('The offer changed after the letter was generated. Regenerate the letter first.', 'letter_stale'); end if;
    v_data := hr_private.offer_merge_data(p_offer);
    if v_data ->> 'signatory_name' is null then perform hr_private.fail('Choose the authorised signatory before issuing.', 'signatory_required'); end if;
    if f.proposed_joining_date is null then perform hr_private.fail('Enter the joining date before issuing.', 'invalid'); end if;
  elsif f.current_version = 0 and exists (select 1 from public.hr_offer_letter_templates where status = 'approved') then
    -- 104-compatible path: keep a letter on file for every issued offer when possible.
    begin
      perform hr_private.generate_offer_letter(p_offer, null);
    exception when others then null;   -- incomplete details: issue without a generated letter (legacy behaviour)
    end;
  end if;
  if f.expires_on is not null and f.expires_on < hr_private.business_today() then
    perform hr_private.fail('The offer validity date has passed. Change it before issuing.', 'invalid');
  end if;
  update public.hr_offers set status = 'sent', sent_at = now(), issued_on = hr_private.business_today() where id = p_offer;
  if v_stage = 'selected' then perform hr_private.set_candidate_stage(f.application_id, 'offered', 'Offer issued'); end if;
end $$;

create or replace function public.hr_issue_offer(p_offer uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not hr_private.has_permission('recruitment.manage') then perform hr_private.fail('You are not allowed to manage offers.', 'forbidden'); end if;
  perform hr_private.issue_offer(p_offer, true);
end $$;

-- 104 RPC kept (same signature), routed through the shared issue logic.
create or replace function public.hr_send_offer(p_offer uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not hr_private.has_permission('recruitment.manage') then perform hr_private.fail('You are not allowed to manage offers.', 'forbidden'); end if;
  perform hr_private.issue_offer(p_offer, false);
end $$;

-- Queue the issued letter to the candidate through hr_email_outbox. The
-- offer is NOT reported as emailed until the dispatcher marks it 'sent'.
create or replace function public.hr_queue_offer_email(p_offer uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare f public.hr_offers; l public.hr_offer_letter_versions; v_to text; v_status text; v_id uuid;
begin
  if not hr_private.has_permission('recruitment.manage') then perform hr_private.fail('You are not allowed to manage offers.', 'forbidden'); end if;
  select * into f from public.hr_offers where id = p_offer for update;
  if f.id is null then perform hr_private.fail('Offer not found.', 'not_found'); end if;
  if f.status <> 'sent' then perform hr_private.fail('Only an issued offer can be emailed.', 'invalid_state'); end if;
  select * into l from public.hr_offer_letter_versions where offer_id = p_offer and version = f.current_version;
  if l.id is null then perform hr_private.fail('This offer has no generated letter to email.', 'letter_required'); end if;
  if f.email_outbox_id is not null then
    select status into v_status from public.hr_email_outbox where id = f.email_outbox_id;
    if v_status in ('queued','sending','sent') then perform hr_private.fail('The offer letter email is already ' || v_status || '.', 'already_queued'); end if;
  end if;
  select c.email::text into v_to from public.hr_candidate_applications a join public.hr_candidates c on c.id = a.candidate_id where a.id = f.application_id;
  v_id := hr_private.queue_email(v_to, left(l.subject, 250), l.body, 'recruitment.offer_letter', 'hr_offers', p_offer::text);
  update public.hr_offers set email_outbox_id = v_id where id = p_offer;
  perform hr_private.audit_event('OFFER_EMAIL_QUEUED', 'hr_offers', p_offer::text, jsonb_build_object('version', f.current_version, 'outbox_id', v_id));
  return v_id;
end $$;

-- Mark issued offers past their validity date as expired.
create or replace function public.hr_expire_overdue_offers()
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  if not hr_private.has_permission('recruitment.manage') then perform hr_private.fail('You are not allowed to manage offers.', 'forbidden'); end if;
  for r in select id, application_id from public.hr_offers where status = 'sent' and expires_on < hr_private.business_today() for update loop
    update public.hr_offers set status = 'expired', responded_at = now() where id = r.id;
    insert into public.hr_candidate_stage_events (application_id, from_stage, to_stage, note, changed_by)
    select id, stage, stage, 'Offer expired (validity date passed)', auth.uid() from public.hr_candidate_applications where id = r.application_id;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.hr_log_offer_letter_download(p_version uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare l public.hr_offer_letter_versions;
begin
  if not hr_private.has_permission('recruitment.manage') then perform hr_private.fail('You are not allowed to download offer letters.', 'forbidden'); end if;
  select * into l from public.hr_offer_letter_versions where id = p_version;
  if l.id is null then perform hr_private.fail('Offer letter not found.', 'not_found'); end if;
  perform hr_private.audit_event('OFFER_LETTER_DOWNLOAD', 'hr_offer_letter_versions', p_version::text,
    jsonb_build_object('offer_id', l.offer_id, 'version', l.version));
end $$;

-- 104 RPC kept (same signature) with the new offer fields. CTC and email
-- delivery details are returned only to recruitment.manage.
create or replace function public.hr_get_application_offers(p_application uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_mg boolean := hr_private.has_permission('recruitment.manage');
begin
  if not hr_private.can_view_application(p_application) then
    perform hr_private.fail('You are not allowed to view this application.', 'forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', f.id, 'application_id', f.application_id, 'offered_designation_id', f.offered_designation_id,
      'department_id', f.department_id, 'employment_type', f.employment_type, 'proposed_joining_date', f.proposed_joining_date,
      'annual_ctc', case when v_mg then f.annual_ctc end, 'currency', f.currency, 'expires_on', f.expires_on,
      'status', f.status, 'sent_at', f.sent_at, 'responded_at', f.responded_at, 'created_at', f.created_at,
      'work_location', f.work_location, 'issued_on', f.issued_on,
      'signatory_employee_id', f.signatory_employee_id, 'signatory_name', f.signatory_name, 'signatory_title', f.signatory_title,
      'current_version', f.current_version, 'letter_stale', f.letter_stale,
      'notes', case when v_mg then f.notes end,
      'email_status', case when v_mg then x.status end, 'email_sent_at', case when v_mg then x.sent_at end,
      'email_error', case when v_mg then x.last_error end)
      order by f.created_at)
    from public.hr_offers f left join public.hr_email_outbox x on x.id = f.email_outbox_id
    where f.application_id = p_application), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- Hiring: 104 conversion kept (same signature, same employee row:
-- source='candidate', source_ref=<application>, status='onboarding'),
-- plus a candidate-level duplicate check and notifications.
-- ---------------------------------------------------------------------
create or replace function public.hr_convert_candidate_to_employee(
  p_application uuid, p_company_email text, p_joining_date date default null, p_department uuid default null,
  p_designation uuid default null, p_manager uuid default null, p_employment_type text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  a public.hr_candidate_applications;
  c public.hr_candidates;
  f public.hr_offers;
  o public.hr_job_openings;
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
  if exists (select 1 from public.hr_candidate_applications x where x.candidate_id = a.candidate_id and x.id <> a.id and x.employee_id is not null) then
    perform hr_private.fail('This candidate already has an employee record from another application.', 'already_converted');
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
  if p_manager is not null and not hr_private.is_active_employee(p_manager) then
    perform hr_private.fail('The reporting manager must be an active employee.', 'invalid');
  end if;
  select * into c from public.hr_candidates where id = a.candidate_id;
  select * into o from public.hr_job_openings where id = a.opening_id;
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
  values (v_emp, 'conversion', 'candidate', v_join,
          'Hired from candidate application ' || p_application || ' (opening: ' || coalesce(o.title, '—') || ')', auth.uid());

  update public.hr_candidate_applications set employee_id = v_emp where id = p_application;
  perform hr_private.set_candidate_stage(p_application, 'joined', 'Hired: employee record created');

  if exists (select 1 from public.hr_employment_types where code = v_type and is_intern) then
    v_months := coalesce((hr_private.setting('recruitment') ->> 'default_internship_months')::int, 6);
    insert into public.hr_internships (employee_id, mentor_id, department_id, start_date, end_date, source_application_id)
    values (v_emp, p_manager, coalesce(p_department, f.department_id), v_join,
            (v_join + make_interval(months => v_months) - interval '1 day')::date, p_application);
  end if;
  perform hr_private.audit_event('CANDIDATE_CONVERTED', 'hr_candidate_applications', p_application::text,
    jsonb_build_object('employee_id', v_emp, 'employment_type', v_type, 'opening_id', a.opening_id, 'candidate_id', a.candidate_id));
  if o.hiring_manager_id is not null then
    perform hr_private.notify_employee(o.hiring_manager_id, 'candidate_hired', c.full_name || ' has been hired for ' || o.title,
      'Joining ' || to_char(v_join, 'DD Mon YYYY'), '/hr/employees/' || v_emp, 'hr_employees', v_emp::text);
  end if;
  if p_manager is not null and p_manager is distinct from o.hiring_manager_id then
    perform hr_private.notify_employee(p_manager, 'candidate_hired', c.full_name || ' will report to you',
      'Joining ' || to_char(v_join, 'DD Mon YYYY'), '/hr/employees/' || v_emp, 'hr_employees', v_emp::text);
  end if;
  return v_emp;
end $$;

-- ---------------------------------------------------------------------
-- Recruitment overview (dashboard). SECURITY INVOKER: every count is read
-- under the caller's RLS, so a hiring manager / assigned recruiter sees
-- only their openings. Offer KPIs are null without recruitment.manage.
-- Date filter: applications by application date, interviews by interview
-- date, offers by creation date (accepted: by response date).
-- ---------------------------------------------------------------------
create or replace function public.hr_recruitment_overview(
  p_opening uuid default null, p_department uuid default null, p_recruiter uuid default null,
  p_hiring_manager uuid default null, p_status text default null, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_mg boolean := hr_private.has_permission('recruitment.manage'); r jsonb;
begin
  if p_from is not null and p_to is not null and p_to < p_from then perform hr_private.fail('The end date is before the start date.', 'invalid'); end if;
  with o as (
    select * from public.hr_job_openings x
    where (p_opening is null or x.id = p_opening) and (p_department is null or x.department_id = p_department)
      and (p_hiring_manager is null or x.hiring_manager_id = p_hiring_manager) and (p_status is null or x.status = p_status)
      and (p_recruiter is null or x.recruiter_id = p_recruiter
           or exists (select 1 from public.hr_candidate_applications y where y.opening_id = x.id and y.recruiter_id = p_recruiter))),
  a_all as (
    select a.* from public.hr_candidate_applications a join o on o.id = a.opening_id
    where p_recruiter is null or coalesce(a.recruiter_id, o.recruiter_id) = p_recruiter),
  a as (select * from a_all where (p_from is null or applied_on >= p_from) and (p_to is null or applied_on <= p_to)),
  iv as (
    select i.* from public.hr_interviews i join a_all on a_all.id = i.application_id
    where (p_from is null or (i.scheduled_at at time zone hr_private.business_timezone())::date >= p_from)
      and (p_to is null or (i.scheduled_at at time zone hr_private.business_timezone())::date <= p_to)),
  ofr as (select f.* from public.hr_offers f join a_all on a_all.id = f.application_id)
  select jsonb_build_object(
    'scope', case when hr_private.is_recruiter() then 'all' else 'assigned' end,
    'open_jobs', (select count(*) from o where status = 'open'),
    'open_vacancies', (select coalesce(sum(openings), 0) from o where status = 'open'),
    'total_applications', (select count(*) from a),
    'under_screening', (select count(*) from a where stage = 'screening'),
    'on_hold', (select count(*) from a where on_hold and stage not in ('rejected','withdrawn','joined')),
    'shortlisted', (select count(*) from a where stage = 'shortlisted'),
    'interviews_scheduled', (select count(*) from iv where status = 'scheduled'),
    'offers_pending', case when v_mg then (select count(*) from ofr where status in ('draft','sent')
                        and (p_from is null or (created_at at time zone hr_private.business_timezone())::date >= p_from)
                        and (p_to is null or (created_at at time zone hr_private.business_timezone())::date <= p_to)) end,
    'offers_accepted', case when v_mg then (select count(*) from ofr where status = 'accepted'
                        and (p_from is null or (responded_at at time zone hr_private.business_timezone())::date >= p_from)
                        and (p_to is null or (responded_at at time zone hr_private.business_timezone())::date <= p_to)) end,
    'hired', (select count(*) from a where stage = 'joined'),
    'stages', (select coalesce(jsonb_object_agg(stage, n), '{}'::jsonb) from (select stage, count(*) n from a group by stage) s),
    'by_opening', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', o.id, 'title', o.title, 'status', o.status, 'vacancies', o.openings,
        'applications', (select count(*) from a where a.opening_id = o.id),
        'in_process', (select count(*) from a where a.opening_id = o.id and a.stage not in ('rejected','withdrawn','joined')),
        'interviews_scheduled', (select count(*) from iv join a_all on a_all.id = iv.application_id where a_all.opening_id = o.id and iv.status = 'scheduled'),
        'hired', (select count(*) from a_all where a_all.opening_id = o.id and a_all.stage = 'joined'))
        order by (o.status = 'open') desc, o.created_at desc), '[]'::jsonb)
      from (select * from o order by (status = 'open') desc, created_at desc limit 50) o)
  ) into r;
  return r;
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
             'hr_save_job_opening','hr_set_job_opening_status','hr_add_application','hr_update_application',
             'hr_add_candidate_note','hr_register_candidate_attachment','hr_confirm_candidate_attachment','hr_archive_candidate_attachment',
             'hr_record_screening','hr_reschedule_interview','hr_set_interview_status','hr_save_interview_evaluation',
             'hr_submit_interview_feedback','hr_reopen_interview_evaluation','hr_record_hiring_decision',
             'hr_save_offer_template','hr_set_offer_template_status','hr_generate_offer_letter','hr_update_offer',
             'hr_issue_offer','hr_send_offer','hr_queue_offer_email','hr_expire_overdue_offers','hr_log_offer_letter_download',
             'hr_get_application_offers','hr_convert_candidate_to_employee','hr_recruitment_overview'])
  loop
    execute format('revoke execute on function %s from anon, public', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
