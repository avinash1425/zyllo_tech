-- =====================================================================
-- 130_hr_onboarding_exit.sql — HRMS Module 4: Onboarding & Employee Exit
-- =====================================================================
-- Depends on 100–117 (foundation, recruitment offers, payroll, documents,
-- assets, exit, training). Additive: no existing table is dropped and no
-- existing data is rewritten. Existing exit RPCs are replaced in place with
-- backward-compatible, stricter versions (see "Exit: clearance" below).
--
-- Adds
--   * Onboarding: checklist templates, one onboarding case per hire (linked
--     to the accepted offer and the Employee Management record), checklist
--     tasks (owners, due dates, evidence, employee acknowledgement), events.
--     Induction is modelled as onboarding tasks (orientation, policy
--     briefing, IT setup, equipment, security acknowledgement, sessions)
--     that link to the existing Training and Assets modules.
--     A case is created automatically when a candidate with an accepted
--     offer is converted (hr_convert_candidate_to_employee, 104).
--   * Document verification: reuses hr_documents / hr_verify_document (107);
--     adds HR notification when an employee uploads a document.
--   * Probation: reviews (manager feedback -> HR decision: confirm, extend,
--     end early via an Exit case), reminders, history; employee status kept
--     in sync with hr_employees.
--   * Resignation: company withdrawal policy (setting lifecycle.resignation_withdrawal).
--   * Clearance: IT clearance item, due dates, department owners, owner
--     permissions (IT / payroll / assets / line manager), audited exceptions
--     (exit.override), access-revocation timing policy and failure tracking.
--   * Full & final settlement: hr_payroll_settlements + lines, prepared by
--     payroll.manage, approved by a DIFFERENT payroll.approve holder, never
--     by the leaver; payment is recorded only (no funds are moved).
-- No statutory rule or rate is hardcoded: prefilled settlement lines are
-- derived from existing payroll/leave/reimbursement records and amounts that
-- depend on company policy are left at 0 for the preparer to decide.
-- Apply ONLY to the local test cluster or the isolated dev project.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------
-- Internal helpers live in their own schema. Signed-in users get NO usage on
-- it, so they cannot call these helpers directly, and the blanket
-- `grant execute on all functions in schema hr_private to authenticated`
-- that several HRMS migrations run cannot re-expose them. Only the
-- SECURITY DEFINER RPCs below (running as the owner) call them. hr_private
-- keeps only the boolean visibility checks that RLS policies need.
create schema if not exists hr_lifecycle_internal;
revoke all on schema hr_lifecycle_internal from public, anon, authenticated;
alter default privileges in schema hr_lifecycle_internal revoke execute on functions from public;

insert into public.hr_settings (key, value, description) values
  ('lifecycle', jsonb_build_object(
      'default_onboarding_template', 'standard',
      'probation_reminder_days', 14,
      -- before_hr_approval | before_clearance | never
      'resignation_withdrawal', 'before_hr_approval',
      -- on_last_working_day | from_clearance
      'access_revocation_timing', 'on_last_working_day'),
   'Onboarding & exit: default checklist template, probation reminder lead time (days), employee resignation withdrawal policy, sign-in access revocation timing')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------
insert into public.hr_permissions (key, module, action, description) values
  ('onboarding.view',       'onboarding', 'view',          'View every onboarding case'),
  ('onboarding.view_team',  'onboarding', 'view_team',     'View onboarding of the reporting line and complete manager tasks'),
  ('onboarding.manage',     'onboarding', 'manage',        'Create, update and complete onboarding cases and checklist templates'),
  ('probation.view',        'probation',  'view',          'View every probation review'),
  ('probation.view_team',   'probation',  'view_team',     'View probation reviews of the reporting line'),
  ('probation.review_team', 'probation',  'review_team',   'Give manager feedback on reporting-line probation reviews'),
  ('probation.decide',      'probation',  'decide',        'Confirm, extend or end probation (HR decision)'),
  ('exit.clearance_it',     'exit',       'clearance_it',  'Complete IT clearance and access revocation items of exits'),
  ('exit.override',         'exit',       'override',      'Grant audited exceptions for pending mandatory clearance or failed access revocation')
on conflict (key) do nothing;

insert into public.hr_role_permissions (role_key, permission_key)
select 'super_admin', key from public.hr_permissions
where key in ('onboarding.view','onboarding.view_team','onboarding.manage','probation.view','probation.view_team',
              'probation.review_team','probation.decide','exit.clearance_it','exit.override')
on conflict do nothing;
insert into public.hr_role_permissions (role_key, permission_key) values
  ('hr_admin', 'onboarding.view'), ('hr_admin', 'onboarding.manage'),
  ('hr_admin', 'probation.view'),  ('hr_admin', 'probation.decide'),
  ('manager',  'onboarding.view_team'), ('manager', 'probation.view_team'), ('manager', 'probation.review_team')
on conflict do nothing;
-- exit.clearance_it and exit.override are not granted to any role except
-- super_admin by default; assign them in HR Settings > Roles.

-- Employee Management (module 2) adds this column too; idempotent.
alter table public.hr_employees add column if not exists confirmation_date date;

-- ---------------------------------------------------------------------
-- Onboarding: templates
-- ---------------------------------------------------------------------
create table public.hr_onboarding_templates (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  name             text not null check (length(btrim(name)) between 2 and 120),
  description      text check (description is null or length(description) <= 1000),
  employment_types text[],                 -- null = any employment type
  active           boolean not null default true,
  sort_order       smallint not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.hr_onboarding_template_tasks (
  id                  uuid primary key default gen_random_uuid(),
  template_id         uuid not null references public.hr_onboarding_templates(id) on delete cascade,
  title               text not null check (length(btrim(title)) between 2 and 200),
  description         text check (description is null or length(description) <= 2000),
  category            text not null default 'other'
                      check (category in ('pre_joining','documents','it_setup','equipment','orientation','policy','induction','compliance','payroll','other')),
  task_kind           text not null default 'manual' check (task_kind in ('manual','documents','training','asset','acknowledgement')),
  owner_role          text not null default 'hr' check (owner_role in ('hr','manager','it','payroll','employee')),
  due_offset_days     int not null default 0 check (due_offset_days between -90 and 365),   -- relative to the joining date
  mandatory           boolean not null default true,
  requires_evidence   boolean not null default false,
  visible_to_employee boolean not null default true,
  training_course_id  uuid references public.hr_training_courses(id) on delete set null,
  active              boolean not null default true,
  sort_order          smallint not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index hr_onboarding_template_tasks_tpl on public.hr_onboarding_template_tasks(template_id, sort_order);

insert into public.hr_onboarding_templates (code, name, description, sort_order) values
  ('standard', 'Standard joining checklist', 'Default checklist for new employees: documents, IT, equipment and induction.', 1)
on conflict (code) do nothing;

insert into public.hr_onboarding_template_tasks
  (template_id, title, description, category, task_kind, owner_role, due_offset_days, mandatory, requires_evidence, visible_to_employee, sort_order)
select t.id, x.title, x.description, x.category, x.kind, x.owner, x.off, x.mand, x.evid, x.vis, x.ord
from public.hr_onboarding_templates t
cross join (values
  ('Joining instructions sent',                 'Send the joining date, time, location and first-day agenda.', 'pre_joining', 'manual',          'hr',       -3, false, false, false, 1),
  ('Required joining documents verified',       'All checklist documents uploaded and verified in Visa & Documents.', 'documents', 'documents', 'hr',        7, true,  false, true,  2),
  ('IT account setup',                          'Company email, SSO and system access created.', 'it_setup',     'manual',          'it',        0, true,  true,  true,  3),
  ('Equipment allocation',                      'Laptop and accessories assigned in Assets.',   'equipment',    'asset',           'it',        0, true,  false, true,  4),
  ('Company orientation',                       'Company overview, values, teams and ways of working.', 'orientation', 'manual',   'hr',        1, true,  false, true,  5),
  ('HR policy briefing',                        'Leave, attendance, code of conduct and grievance policies.', 'policy', 'manual',     'hr',        2, true,  false, true,  6),
  ('Security and confidentiality acknowledgement', 'Read and acknowledge the information security and confidentiality policy.', 'compliance', 'acknowledgement', 'employee', 3, true, false, true, 7),
  ('Meet the reporting manager and team',       'Introductions, role expectations and first-month goals.', 'orientation', 'manual',  'manager',   1, true,  false, true,  8),
  ('Induction sessions completed',              'Assigned induction training completed.',       'induction',    'training',        'hr',       14, false, false, true,  9),
  ('Payroll and bank details captured',         'Bank account and payroll identifiers recorded.', 'payroll',    'manual',          'payroll',   7, false, false, false, 10)
) as x(title, description, category, kind, owner, off, mand, evid, vis, ord)
where t.code = 'standard'
  and not exists (select 1 from public.hr_onboarding_template_tasks tt where tt.template_id = t.id);

-- ---------------------------------------------------------------------
-- Onboarding: cases, tasks, events
-- ---------------------------------------------------------------------
create table public.hr_onboarding_cases (
  id                   uuid primary key default gen_random_uuid(),
  employee_id          uuid not null references public.hr_employees(id) on delete restrict,
  application_id       uuid references public.hr_candidate_applications(id) on delete set null,
  offer_id             uuid references public.hr_offers(id) on delete set null,
  template_id          uuid references public.hr_onboarding_templates(id) on delete set null,
  joining_date         date,
  actual_joining_date  date,
  hr_coordinator_id    uuid references public.hr_employees(id) on delete set null,
  reporting_manager_id uuid references public.hr_employees(id) on delete set null,
  department_id        uuid references public.hr_departments(id) on delete set null,
  designation_id       uuid references public.hr_designations(id) on delete set null,
  joining_status       text not null default 'awaiting_joining' check (joining_status in ('awaiting_joining','joined','deferred','no_show')),
  status               text not null default 'open' check (status in ('open','completed','cancelled')),
  notes                text check (notes is null or length(notes) <= 4000),     -- HR / manager notes; never shown to the employee
  completed_at         timestamptz,
  completed_by         uuid,
  cancelled_at         timestamptz,
  cancelled_by         uuid,
  cancel_reason        text check (cancel_reason is null or length(cancel_reason) <= 1000),
  created_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
-- No duplicate onboarding: one live (open or completed) case per employee and per offer.
create unique index hr_onboarding_cases_one_per_employee on public.hr_onboarding_cases(employee_id) where status <> 'cancelled';
create unique index hr_onboarding_cases_one_per_offer on public.hr_onboarding_cases(offer_id) where offer_id is not null and status <> 'cancelled';
create index hr_onboarding_cases_status on public.hr_onboarding_cases(status, joining_date);

create table public.hr_onboarding_tasks (
  id                     uuid primary key default gen_random_uuid(),
  case_id                uuid not null references public.hr_onboarding_cases(id) on delete restrict,
  template_task_id       uuid references public.hr_onboarding_template_tasks(id) on delete set null,
  due_offset_days        int,
  title                  text not null check (length(btrim(title)) between 2 and 200),
  description            text check (description is null or length(description) <= 2000),
  category               text not null default 'other'
                         check (category in ('pre_joining','documents','it_setup','equipment','orientation','policy','induction','compliance','payroll','other')),
  task_kind              text not null default 'manual' check (task_kind in ('manual','documents','training','asset','acknowledgement')),
  owner_role             text not null default 'hr' check (owner_role in ('hr','manager','it','payroll','employee')),
  assignee_employee_id   uuid references public.hr_employees(id) on delete set null,
  due_date               date,
  mandatory              boolean not null default true,
  requires_evidence      boolean not null default false,
  visible_to_employee    boolean not null default true,
  training_course_id     uuid references public.hr_training_courses(id) on delete set null,
  training_assignment_id uuid references public.hr_training_assignments(id) on delete set null,
  asset_assignment_id    uuid references public.hr_asset_assignments(id) on delete set null,
  status                 text not null default 'pending' check (status in ('pending','in_progress','completed','waived')),
  evidence_note          text check (evidence_note is null or length(evidence_note) <= 2000),
  evidence_document_id   uuid references public.hr_documents(id) on delete set null,
  acknowledged_at        timestamptz,
  completed_by           uuid,
  completed_at           timestamptz,
  waived_reason          text check (waived_reason is null or length(waived_reason) <= 1000),
  waived_by              uuid,
  sort_order             smallint not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index hr_onboarding_tasks_case on public.hr_onboarding_tasks(case_id, sort_order);
create index hr_onboarding_tasks_open_due on public.hr_onboarding_tasks(due_date) where status in ('pending','in_progress');
create index hr_onboarding_tasks_assignee on public.hr_onboarding_tasks(assignee_employee_id) where assignee_employee_id is not null;

create table public.hr_onboarding_events (
  id            bigint generated always as identity primary key,
  case_id       uuid not null references public.hr_onboarding_cases(id) on delete restrict,
  task_id       uuid references public.hr_onboarding_tasks(id) on delete restrict,
  event_type    text not null,
  note          text,
  actor_user_id uuid,
  created_at    timestamptz not null default now()
);
create index hr_onboarding_events_case on public.hr_onboarding_events(case_id, created_at);

create trigger hr_onboarding_templates_touch before update on public.hr_onboarding_templates for each row execute function hr_private.touch_updated_at();
create trigger hr_onboarding_template_tasks_touch before update on public.hr_onboarding_template_tasks for each row execute function hr_private.touch_updated_at();
create trigger hr_onboarding_cases_touch before update on public.hr_onboarding_cases for each row execute function hr_private.touch_updated_at();
create trigger hr_onboarding_tasks_touch before update on public.hr_onboarding_tasks for each row execute function hr_private.touch_updated_at();

-- ---------------------------------------------------------------------
-- Probation
-- ---------------------------------------------------------------------
create table public.hr_probation_reviews (
  id                     uuid primary key default gen_random_uuid(),
  employee_id            uuid not null references public.hr_employees(id) on delete restrict,
  review_type            text not null default 'scheduled' check (review_type in ('scheduled','extension')),
  probation_end_date     date not null,
  due_date               date not null,
  status                 text not null default 'pending_manager' check (status in ('pending_manager','pending_hr','decided','cancelled')),
  manager_id             uuid references public.hr_employees(id) on delete set null,
  manager_rating         smallint check (manager_rating is null or manager_rating between 1 and 5),
  manager_recommendation text check (manager_recommendation is null or manager_recommendation in ('confirm','extend','terminate')),
  manager_feedback       text check (manager_feedback is null or length(manager_feedback) <= 4000),
  manager_submitted_by   uuid,
  manager_submitted_at   timestamptz,
  hr_comments            text check (hr_comments is null or length(hr_comments) <= 4000),
  decision               text check (decision is null or decision in ('confirmed','extended','terminated')),
  decision_reason        text check (decision_reason is null or length(decision_reason) <= 2000),
  effective_date         date,
  extended_to            date,
  exit_id                uuid references public.hr_exits(id) on delete restrict,
  decided_by             uuid,
  decided_at             timestamptz,
  created_by             uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (decision is null or status = 'decided'),
  check (decision <> 'extended' or extended_to is not null)
);
create unique index hr_probation_reviews_one_open on public.hr_probation_reviews(employee_id) where status in ('pending_manager','pending_hr');
create index hr_probation_reviews_due on public.hr_probation_reviews(status, due_date);

create table public.hr_probation_events (
  id            bigint generated always as identity primary key,
  review_id     uuid not null references public.hr_probation_reviews(id) on delete restrict,
  event_type    text not null,
  note          text,
  actor_user_id uuid,
  created_at    timestamptz not null default now()
);
create index hr_probation_events_review on public.hr_probation_events(review_id, created_at);
create trigger hr_probation_reviews_touch before update on public.hr_probation_reviews for each row execute function hr_private.touch_updated_at();

-- ---------------------------------------------------------------------
-- Exit: clearance additions and access-revocation tracking
-- ---------------------------------------------------------------------
alter table public.hr_exit_clearance_items drop constraint if exists hr_exit_clearance_items_item_key_check;
alter table public.hr_exit_clearance_items add constraint hr_exit_clearance_items_item_key_check
  check (item_key in ('asset_return','access_revocation','it_clearance','document_handover','project_handover',
                      'hr_clearance','payroll_clearance','final_settlement','relieving_letter'));
alter table public.hr_exit_clearance_items drop constraint if exists hr_exit_clearance_items_status_check;
alter table public.hr_exit_clearance_items add constraint hr_exit_clearance_items_status_check
  check (status in ('pending','completed','not_applicable','waived'));
alter table public.hr_exit_clearance_items
  add column if not exists department           text check (department is null or length(department) <= 60),
  add column if not exists due_date             date,
  add column if not exists mandatory            boolean not null default true,
  add column if not exists assignee_employee_id uuid references public.hr_employees(id) on delete set null,
  add column if not exists evidence_document_id uuid references public.hr_documents(id) on delete set null,
  add column if not exists exception_reason     text check (exception_reason is null or length(exception_reason) <= 2000),
  add column if not exists exception_by         uuid,
  add column if not exists exception_at         timestamptz;

alter table public.hr_exits
  add column if not exists access_revocation_status text not null default 'not_started'
    check (access_revocation_status in ('not_started','revoked','failed','exception','not_applicable')),
  add column if not exists access_revocation_error  text check (access_revocation_error is null or length(access_revocation_error) <= 1000),
  add column if not exists access_exception_reason  text check (access_exception_reason is null or length(access_exception_reason) <= 2000),
  add column if not exists access_exception_by      uuid,
  add column if not exists access_exception_at      timestamptz;
update public.hr_exits set access_revocation_status = 'revoked' where auth_access_revoked_at is not null and access_revocation_status = 'not_started';

create table public.hr_exit_access_revocations (
  id           bigint generated always as identity primary key,
  exit_id      uuid not null references public.hr_exits(id) on delete restrict,
  outcome      text not null check (outcome in ('revoked','failed','exception')),
  detail       text check (detail is null or length(detail) <= 2000),
  actor_user_id uuid,
  created_at   timestamptz not null default now()
);
create index hr_exit_access_revocations_exit on public.hr_exit_access_revocations(exit_id, created_at);

-- ---------------------------------------------------------------------
-- Full & final settlement (payroll-only data; named hr_payroll_* so the
-- shared audit log treats it as payroll — see hr_private.audit_table_is_payroll)
-- ---------------------------------------------------------------------
create table public.hr_payroll_settlements (
  id                uuid primary key default gen_random_uuid(),
  exit_id           uuid not null references public.hr_exits(id) on delete restrict,
  employee_id       uuid not null references public.hr_employees(id) on delete restrict,
  last_working_day  date,
  currency          text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  status            text not null default 'draft' check (status in ('draft','submitted','approved','paid','cancelled')),
  total_earnings    numeric(14,2) not null default 0,
  total_deductions  numeric(14,2) not null default 0,
  net_amount        numeric(14,2) not null default 0,
  notes             text check (notes is null or length(notes) <= 4000),
  prepared_by       uuid,
  prepared_at       timestamptz not null default now(),
  editors           uuid[] not null default '{}',     -- everyone who changed lines (separation of duties)
  submitted_by      uuid,
  submitted_at      timestamptz,
  approved_by       uuid,
  approved_at       timestamptz,
  approval_note     text check (approval_note is null or length(approval_note) <= 2000),
  returned_reason   text check (returned_reason is null or length(returned_reason) <= 2000),
  paid_by           uuid,
  paid_at           timestamptz,
  paid_on           date,
  payment_reference text check (payment_reference is null or length(payment_reference) <= 120),
  cancelled_reason  text check (cancelled_reason is null or length(cancelled_reason) <= 1000),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index hr_payroll_settlements_one_live on public.hr_payroll_settlements(exit_id) where status <> 'cancelled';
create index hr_payroll_settlements_status on public.hr_payroll_settlements(status);

create table public.hr_payroll_settlement_lines (
  id            uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.hr_payroll_settlements(id) on delete cascade,
  line_type     text not null check (line_type in ('salary_due','unpaid_salary','leave_encashment','reimbursement','notice_pay','bonus',
                                                   'other_earning','notice_recovery','asset_recovery','advance_recovery','other_deduction')),
  label         text not null check (length(btrim(label)) between 2 and 160),
  quantity      numeric(10,2),
  rate          numeric(14,2),
  amount        numeric(14,2) not null default 0 check (amount >= 0),
  source_ref    text check (source_ref is null or length(source_ref) <= 80),
  note          text check (note is null or length(note) <= 1000),
  sort_order    smallint not null default 0,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index hr_payroll_settlement_lines_s on public.hr_payroll_settlement_lines(settlement_id, sort_order);
create trigger hr_payroll_settlements_touch before update on public.hr_payroll_settlements for each row execute function hr_private.touch_updated_at();
create trigger hr_payroll_settlement_lines_touch before update on public.hr_payroll_settlement_lines for each row execute function hr_private.touch_updated_at();

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function hr_lifecycle_internal.lifecycle_setting(p_key text, p_default text)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(hr_private.setting('lifecycle') ->> p_key, p_default)
$$;

create or replace function hr_lifecycle_internal.emp_name(p_employee uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name)) from public.hr_employees e where e.id = p_employee
$$;

-- Record an employment change event when Employee Management (module 2,
-- migration 118) is installed, and link the field-level history rows that
-- the hr_employees trigger wrote in this transaction to that event.
-- Call it AFTER the hr_employees update, passing the max(hr_employee_history.id)
-- captured BEFORE that update (hr_lifecycle_internal.history_mark()).
create or replace function hr_lifecycle_internal.history_mark()
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(max(id), 0) from public.hr_employee_history
$$;

create or replace function hr_lifecycle_internal.lifecycle_change_event(p_employee uuid, p_category text, p_effective date, p_reason text, p_changes jsonb,
                                                             p_history_after bigint default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ev uuid; v_reason text := left(coalesce(nullif(btrim(p_reason), ''), p_category), 1000);
begin
  if to_regclass('public.hr_employee_change_events') is null then return; end if;
  execute 'insert into public.hr_employee_change_events (employee_id, category, effective_date, reason, changes, changed_by, changed_by_employee)
           values ($1, $2, $3, $4, $5, $6, $7) returning id'
    into v_ev
    using p_employee, p_category, p_effective, v_reason, coalesce(p_changes, '{}'::jsonb),
          auth.uid(), hr_private.current_employee_id();
  if p_history_after is not null
     and exists (select 1 from pg_attribute where attrelid = 'public.hr_employee_history'::regclass and attname = 'event_id' and not attisdropped) then
    perform set_config('hr.history_annotate', 'on', true);
    execute 'update public.hr_employee_history set event_id = $1, effective_date = $2, note = $3
             where employee_id = $4 and event_id is null and id > $5'
      using v_ev, p_effective, v_reason, p_employee, p_history_after;
    perform set_config('hr.history_annotate', 'off', true);
  end if;
exception when others then
  -- The event table is owned by module 2; never let its validation block a lifecycle decision.
  raise notice 'lifecycle change event not recorded: %', sqlerrm;
end $$;

create or replace function hr_private.onboarding_can_view(p_employee uuid, p_coordinator uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select hr_private.has_permission('onboarding.view') or hr_private.has_permission('onboarding.manage')
      or (hr_private.has_permission('onboarding.view_team') and hr_private.is_manager_of(p_employee))
      or (p_coordinator is not null and p_coordinator = hr_private.current_employee_id() and p_employee is distinct from hr_private.current_employee_id())
$$;

create or replace function hr_private.onboarding_can_view_case(p_case uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select hr_private.onboarding_can_view(c.employee_id, c.hr_coordinator_id) from public.hr_onboarding_cases c where c.id = p_case), false)
$$;

create or replace function hr_private.onboarding_require_manage()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not hr_private.has_permission('onboarding.manage') then
    perform hr_private.fail('You are not allowed to manage onboarding.', 'forbidden');
  end if;
end $$;

create or replace function hr_lifecycle_internal.onboarding_log(p_case uuid, p_event text, p_note text default null, p_task uuid default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.hr_onboarding_events (case_id, task_id, event_type, note, actor_user_id)
  values (p_case, p_task, p_event, nullif(btrim(p_note), ''), auth.uid())
$$;

-- Checklist documents (107) not yet verified and valid, as a readable list.
create or replace function hr_lifecycle_internal.onboarding_missing_documents(p_employee uuid)
returns text language sql stable security definer set search_path = '' as $$
  select string_agg(c.name, ', ' order by c.sort_order, c.name)
  from public.hr_document_categories c
  join public.hr_employees e on e.id = p_employee
  where c.active and c.checklist_required and not c.is_confidential
    and (c.applies_to_employment_types is null or e.employment_type = any (c.applies_to_employment_types))
    and not exists (select 1 from public.hr_documents d
                    where d.employee_id = p_employee and d.category_id = c.id and d.archived_at is null
                      and d.verification_status = 'verified'
                      and (d.expiry_date is null or d.expiry_date >= hr_private.business_today()))
$$;

create or replace function hr_private.probation_can_view(p_employee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select hr_private.has_permission('probation.view') or hr_private.has_permission('probation.decide')
      or (hr_private.any_permission(array['probation.view_team','probation.review_team']) and hr_private.is_manager_of(p_employee))
$$;

create or replace function hr_lifecycle_internal.probation_log(p_review uuid, p_event text, p_note text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.hr_probation_events (review_id, event_type, note, actor_user_id)
  values (p_review, p_event, nullif(btrim(p_note), ''), auth.uid())
$$;

-- Who may act on a clearance item (never the leaver; HR always; owners for their items).
create or replace function hr_private.clearance_can_act(p_item_key text, p_employee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_employee is distinct from hr_private.current_employee_id() and (
       hr_private.has_permission('exit.manage')
    or (p_item_key = 'asset_return' and hr_private.has_permission('assets.manage'))
    or (p_item_key in ('it_clearance','access_revocation') and hr_private.has_permission('exit.clearance_it'))
    or (p_item_key in ('payroll_clearance','final_settlement') and hr_private.any_permission(array['payroll.manage','payroll.approve']))
    or (p_item_key in ('document_handover','project_handover') and hr_private.has_permission('exit.approve_team') and hr_private.is_manager_of(p_employee)))
$$;

create or replace function hr_lifecycle_internal.settlement_is_earning(p_type text)
returns boolean language sql immutable set search_path = '' as $$
  select p_type in ('salary_due','unpaid_salary','leave_encashment','reimbursement','notice_pay','bonus','other_earning')
$$;

create or replace function hr_lifecycle_internal.settlement_recalc(p_settlement uuid)
returns void language sql security definer set search_path = '' as $$
  update public.hr_payroll_settlements s
     set total_earnings   = t.e, total_deductions = t.d, net_amount = t.e - t.d
    from (select coalesce(sum(amount) filter (where hr_lifecycle_internal.settlement_is_earning(line_type)), 0) e,
                 coalesce(sum(amount) filter (where not hr_lifecycle_internal.settlement_is_earning(line_type)), 0) d
          from public.hr_payroll_settlement_lines where settlement_id = p_settlement) t
   where s.id = p_settlement
$$;

-- Daily rate suggestion from the latest finalized payroll item (gross / working days).
create or replace function hr_lifecycle_internal.settlement_daily_rate(p_employee uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select round(i.gross / nullif(i.working_days, 0), 2)
  from public.hr_payroll_items i join public.hr_payroll_runs r on r.id = i.run_id
  where i.employee_id = p_employee and r.status in ('finalized','paid')
  order by r.period_end desc limit 1
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
select hr_private.secure_table('public.hr_onboarding_templates');
select hr_private.secure_table('public.hr_onboarding_template_tasks');
select hr_private.secure_table('public.hr_onboarding_cases');
select hr_private.secure_table('public.hr_onboarding_tasks');
select hr_private.secure_table('public.hr_onboarding_events');
select hr_private.secure_table('public.hr_probation_reviews');
select hr_private.secure_table('public.hr_probation_events');
select hr_private.secure_table('public.hr_exit_access_revocations');
select hr_private.secure_table('public.hr_payroll_settlements');
select hr_private.secure_table('public.hr_payroll_settlement_lines');

-- Templates: master data (onboarding.manage writes directly; deactivate, never delete).
create policy hr_onboarding_templates_read on public.hr_onboarding_templates for select to authenticated
  using (hr_private.any_permission(array['onboarding.view','onboarding.view_team','onboarding.manage','settings.view']));
create policy hr_onboarding_templates_insert on public.hr_onboarding_templates for insert to authenticated
  with check (hr_private.has_permission('onboarding.manage'));
create policy hr_onboarding_templates_update on public.hr_onboarding_templates for update to authenticated
  using (hr_private.has_permission('onboarding.manage')) with check (hr_private.has_permission('onboarding.manage'));
create policy hr_onboarding_template_tasks_read on public.hr_onboarding_template_tasks for select to authenticated
  using (hr_private.any_permission(array['onboarding.view','onboarding.view_team','onboarding.manage','settings.view']));
create policy hr_onboarding_template_tasks_insert on public.hr_onboarding_template_tasks for insert to authenticated
  with check (hr_private.has_permission('onboarding.manage'));
create policy hr_onboarding_template_tasks_update on public.hr_onboarding_template_tasks for update to authenticated
  using (hr_private.has_permission('onboarding.manage')) with check (hr_private.has_permission('onboarding.manage'));

-- Cases / tasks / events: read-only for clients; writes through RPCs.
-- The employee reads their own onboarding only through hr_my_lifecycle()
-- (no notes, no evidence notes, no internal events).
create policy hr_onboarding_cases_read on public.hr_onboarding_cases for select to authenticated
  using (hr_private.onboarding_can_view(employee_id, hr_coordinator_id));
create policy hr_onboarding_tasks_read on public.hr_onboarding_tasks for select to authenticated
  using (hr_private.onboarding_can_view_case(case_id)
         or (assignee_employee_id is not null and assignee_employee_id = hr_private.current_employee_id()));
create policy hr_onboarding_events_read on public.hr_onboarding_events for select to authenticated
  using (hr_private.onboarding_can_view_case(case_id));

create policy hr_probation_reviews_read on public.hr_probation_reviews for select to authenticated
  using (hr_private.probation_can_view(employee_id));
create policy hr_probation_events_read on public.hr_probation_events for select to authenticated
  using (exists (select 1 from public.hr_probation_reviews r where r.id = review_id and hr_private.probation_can_view(r.employee_id)));

create policy hr_exit_access_revocations_read on public.hr_exit_access_revocations for select to authenticated
  using (hr_private.has_permission('exit.manage') or hr_private.has_permission('exit.clearance_it'));

-- Clearance owners (IT, payroll) need to find the exits they clear
-- (from the clearance stage on only).
create policy hr_exits_read_clearance_owners on public.hr_exits for select to authenticated
  using (hr_private.any_permission(array['exit.clearance_it','payroll.manage','payroll.approve'])
         and status in ('clearance','final_settlement','closed')
         and employee_id is distinct from hr_private.current_employee_id());
create policy hr_exit_clearance_items_read_owners on public.hr_exit_clearance_items for select to authenticated
  using (hr_private.any_permission(array['exit.clearance_it','payroll.manage','payroll.approve'])
         and exists (select 1 from public.hr_exits x where x.id = exit_id and x.status in ('clearance','final_settlement','closed')
                     and x.employee_id is distinct from hr_private.current_employee_id()));

create policy hr_payroll_settlements_read on public.hr_payroll_settlements for select to authenticated
  using (hr_private.has_permission('payroll.view'));
create policy hr_payroll_settlement_lines_read on public.hr_payroll_settlement_lines for select to authenticated
  using (hr_private.has_permission('payroll.view'));
revoke insert, update, delete, truncate on public.hr_onboarding_cases, public.hr_onboarding_tasks, public.hr_onboarding_events,
  public.hr_probation_reviews, public.hr_probation_events, public.hr_exit_access_revocations,
  public.hr_payroll_settlements, public.hr_payroll_settlement_lines from authenticated;

select hr_private.enable_audit('public.hr_onboarding_templates');
select hr_private.enable_audit('public.hr_onboarding_template_tasks');
select hr_private.enable_audit('public.hr_onboarding_cases');
select hr_private.enable_audit('public.hr_onboarding_tasks');
select hr_private.enable_audit('public.hr_probation_reviews');
select hr_private.enable_audit('public.hr_exit_access_revocations');
select hr_private.enable_audit('public.hr_payroll_settlements', array['total_earnings','total_deductions','net_amount']);
select hr_private.enable_audit('public.hr_payroll_settlement_lines', array['quantity','rate','amount']);

-- =====================================================================
-- ONBOARDING
-- =====================================================================
create or replace function hr_lifecycle_internal.onboarding_create_case(
  p_employee uuid, p_template uuid default null, p_offer uuid default null, p_application uuid default null,
  p_coordinator uuid default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_emp public.hr_employees; v_tpl uuid := p_template; v_id uuid;
begin
  select * into v_emp from public.hr_employees where id = p_employee;
  if v_emp.id is null then perform hr_private.fail('Employee not found.', 'not_found'); end if;
  if exists (select 1 from public.hr_onboarding_cases where employee_id = p_employee and status <> 'cancelled') then
    perform hr_private.fail('This employee already has an onboarding case.', 'onboarding_exists');
  end if;
  if p_offer is not null and exists (select 1 from public.hr_onboarding_cases where offer_id = p_offer and status <> 'cancelled') then
    perform hr_private.fail('An onboarding case already exists for this offer.', 'onboarding_exists');
  end if;
  if v_tpl is null then
    select t.id into v_tpl from public.hr_onboarding_templates t
     where t.active and t.employment_types is not null and v_emp.employment_type = any (t.employment_types)
     order by t.sort_order limit 1;
  end if;
  if v_tpl is null then
    select t.id into v_tpl from public.hr_onboarding_templates t
     where t.active and t.code = hr_lifecycle_internal.lifecycle_setting('default_onboarding_template', 'standard');
  end if;

  insert into public.hr_onboarding_cases (employee_id, application_id, offer_id, template_id, joining_date, hr_coordinator_id,
                                          reporting_manager_id, department_id, designation_id, notes, created_by)
  values (p_employee, p_application, p_offer, v_tpl, v_emp.joining_date, p_coordinator, v_emp.manager_id,
          v_emp.department_id, v_emp.designation_id, nullif(btrim(p_notes), ''), auth.uid())
  returning id into v_id;

  if v_tpl is not null then
    insert into public.hr_onboarding_tasks (case_id, template_task_id, due_offset_days, title, description, category, task_kind, owner_role,
                                            assignee_employee_id, due_date, mandatory, requires_evidence, visible_to_employee,
                                            training_course_id, sort_order)
    select v_id, tt.id, tt.due_offset_days, tt.title, tt.description, tt.category, tt.task_kind, tt.owner_role,
           case tt.owner_role when 'manager' then v_emp.manager_id when 'employee' then p_employee when 'hr' then p_coordinator end,
           case when v_emp.joining_date is not null then v_emp.joining_date + tt.due_offset_days end,
           tt.mandatory, tt.requires_evidence, tt.visible_to_employee, tt.training_course_id, tt.sort_order
    from public.hr_onboarding_template_tasks tt
    where tt.template_id = v_tpl and tt.active;
  end if;

  perform hr_lifecycle_internal.onboarding_log(v_id, 'created',
    case when p_offer is not null then 'Created from accepted offer' else 'Created by HR' end);
  if p_coordinator is not null then
    perform hr_private.notify_employee(p_coordinator, 'onboarding', 'Onboarding assigned: ' || hr_lifecycle_internal.emp_name(p_employee),
      'You are the HR coordinator for this joiner.', '/hr/onboarding-exit/onboarding/' || v_id, 'hr_onboarding_case', v_id::text);
  end if;
  if v_emp.manager_id is not null then
    perform hr_private.notify_employee(v_emp.manager_id, 'onboarding', 'New joiner in your team: ' || hr_lifecycle_internal.emp_name(p_employee),
      case when v_emp.joining_date is not null then 'Joining ' || to_char(v_emp.joining_date, 'DD Mon YYYY') || '.' end,
      '/hr/onboarding-exit/onboarding/' || v_id, 'hr_onboarding_case', v_id::text);
  end if;
  perform hr_private.notify_employee(p_employee, 'onboarding', 'Welcome to Zyllo Tech',
    'Your onboarding checklist is ready.', '/employee/onboarding', 'hr_onboarding_case', v_id::text);
  return v_id;
end $$;

-- A hire confirmed through recruitment (candidate conversion, 104) gets its
-- onboarding case automatically, linked to the accepted offer.
create or replace function hr_lifecycle_internal.onboarding_after_employee_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_offer uuid;
begin
  if new.source = 'candidate' and new.status = 'onboarding' and new.source_ref is not null then
    select f.id into v_offer from public.hr_offers f
     where f.application_id = new.source_ref and f.status = 'accepted' order by f.created_at desc limit 1;
    if not exists (select 1 from public.hr_onboarding_cases where employee_id = new.id and status <> 'cancelled') then
      perform hr_lifecycle_internal.onboarding_create_case(new.id, null, v_offer, new.source_ref, hr_private.current_employee_id(), null);
    end if;
  end if;
  return new;
end $$;
create trigger hr_employees_onboarding_case after insert on public.hr_employees
  for each row execute function hr_lifecycle_internal.onboarding_after_employee_insert();

create or replace function public.hr_create_onboarding_case(p_employee uuid, p_template uuid default null,
                                                            p_coordinator uuid default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_emp public.hr_employees; v_app uuid; v_offer uuid;
begin
  perform hr_private.onboarding_require_manage();
  if p_employee = hr_private.current_employee_id() then
    perform hr_private.fail('You cannot open onboarding for yourself.', 'self_action');
  end if;
  select * into v_emp from public.hr_employees where id = p_employee for update;
  if v_emp.id is null then perform hr_private.fail('Employee not found.', 'not_found'); end if;
  if v_emp.status not in ('onboarding','probation','active') then
    perform hr_private.fail('Onboarding can only be opened for a current employee.', 'invalid_state');
  end if;
  if p_template is not null and not exists (select 1 from public.hr_onboarding_templates where id = p_template and active) then
    perform hr_private.fail('Choose an active checklist template.', 'invalid');
  end if;
  if p_coordinator is not null and not exists (select 1 from public.hr_employees where id = p_coordinator and status not in ('exited','archived')) then
    perform hr_private.fail('The HR coordinator must be a current employee.', 'invalid');
  end if;
  if v_emp.source = 'candidate' then
    v_app := v_emp.source_ref;
    select f.id into v_offer from public.hr_offers f where f.application_id = v_app and f.status = 'accepted' order by f.created_at desc limit 1;
  end if;
  return hr_lifecycle_internal.onboarding_create_case(p_employee, p_template, v_offer, v_app, coalesce(p_coordinator, hr_private.current_employee_id()), p_notes);
end $$;

-- Update case details; changes to the joining date, manager, department and
-- designation are applied to the Employee Management record as well.
create or replace function public.hr_update_onboarding_case(
  p_case uuid, p_joining_date date default null, p_coordinator uuid default null, p_manager uuid default null,
  p_department uuid default null, p_designation uuid default null, p_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_c public.hr_onboarding_cases; v_changes text := '';
begin
  perform hr_private.onboarding_require_manage();
  select * into v_c from public.hr_onboarding_cases where id = p_case for update;
  if v_c.id is null then perform hr_private.fail('Onboarding case not found.', 'not_found'); end if;
  if v_c.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot manage your own onboarding.', 'self_action'); end if;
  if v_c.status <> 'open' then perform hr_private.fail('Only open onboarding cases can be changed.', 'invalid_state'); end if;
  if p_coordinator is not null and not exists (select 1 from public.hr_employees where id = p_coordinator and status not in ('exited','archived')) then
    perform hr_private.fail('The HR coordinator must be a current employee.', 'invalid');
  end if;
  if p_manager is not null and p_manager = v_c.employee_id then
    perform hr_private.fail('An employee cannot report to themselves.', 'invalid');
  end if;

  if p_joining_date is not null and p_joining_date is distinct from v_c.joining_date then
    v_changes := v_changes || 'joining date ' || coalesce(to_char(v_c.joining_date, 'YYYY-MM-DD'), '—') || ' → ' || to_char(p_joining_date, 'YYYY-MM-DD') || '; ';
    update public.hr_employees set joining_date = p_joining_date,
           probation_end_date = case when probation_end_date is not null and joining_date is not null
                                     then probation_end_date + (p_joining_date - joining_date) else probation_end_date end
     where id = v_c.employee_id;
    update public.hr_onboarding_tasks set due_date = p_joining_date + due_offset_days
     where case_id = v_c.id and due_offset_days is not null and status in ('pending','in_progress');
  end if;
  if p_manager is not null and p_manager is distinct from v_c.reporting_manager_id then
    v_changes := v_changes || 'reporting manager changed; ';
    update public.hr_employees set manager_id = p_manager where id = v_c.employee_id;
    update public.hr_onboarding_tasks set assignee_employee_id = p_manager
     where case_id = v_c.id and owner_role = 'manager' and status in ('pending','in_progress');
  end if;
  if p_department is not null and p_department is distinct from v_c.department_id then
    v_changes := v_changes || 'department changed; ';
    update public.hr_employees set department_id = p_department where id = v_c.employee_id;
  end if;
  if p_designation is not null and p_designation is distinct from v_c.designation_id then
    v_changes := v_changes || 'designation changed; ';
    update public.hr_employees set designation_id = p_designation where id = v_c.employee_id;
  end if;
  if p_coordinator is not null and p_coordinator is distinct from v_c.hr_coordinator_id then
    v_changes := v_changes || 'HR coordinator changed; ';
    update public.hr_onboarding_tasks set assignee_employee_id = p_coordinator
     where case_id = v_c.id and owner_role = 'hr' and status in ('pending','in_progress')
       and (assignee_employee_id is null or assignee_employee_id = v_c.hr_coordinator_id);
    perform hr_private.notify_employee(p_coordinator, 'onboarding', 'Onboarding assigned: ' || hr_lifecycle_internal.emp_name(v_c.employee_id),
      'You are the HR coordinator for this joiner.', '/hr/onboarding-exit/onboarding/' || v_c.id, 'hr_onboarding_case', v_c.id::text);
  end if;

  update public.hr_onboarding_cases c
     set joining_date = e.joining_date, reporting_manager_id = e.manager_id, department_id = e.department_id,
         designation_id = e.designation_id, hr_coordinator_id = coalesce(p_coordinator, c.hr_coordinator_id),
         notes = case when p_notes is null then c.notes else nullif(btrim(p_notes), '') end
    from public.hr_employees e
   where c.id = v_c.id and e.id = v_c.employee_id;
  if p_notes is not null then v_changes := v_changes || 'notes updated; '; end if;
  if v_changes <> '' then perform hr_lifecycle_internal.onboarding_log(v_c.id, 'updated', rtrim(v_changes, '; ')); end if;
end $$;

create or replace function public.hr_set_joining_status(p_case uuid, p_status text, p_date date default null, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_c public.hr_onboarding_cases;
begin
  perform hr_private.onboarding_require_manage();
  select * into v_c from public.hr_onboarding_cases where id = p_case for update;
  if v_c.id is null then perform hr_private.fail('Onboarding case not found.', 'not_found'); end if;
  if v_c.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot manage your own onboarding.', 'self_action'); end if;
  if v_c.status <> 'open' then perform hr_private.fail('Only open onboarding cases can be changed.', 'invalid_state'); end if;
  if p_status is null or p_status not in ('awaiting_joining','joined','deferred','no_show') then
    perform hr_private.fail('Unknown joining status.', 'invalid');
  end if;
  if p_status = 'joined' then
    if coalesce(p_date, v_c.joining_date) is null then perform hr_private.fail('Enter the actual joining date.', 'invalid_date'); end if;
    if coalesce(p_date, v_c.joining_date) > hr_private.business_today() then
      perform hr_private.fail('The joining date is in the future; record the joining on or after that day.', 'invalid_date');
    end if;
    update public.hr_onboarding_cases set joining_status = 'joined', actual_joining_date = coalesce(p_date, v_c.joining_date) where id = v_c.id;
    if p_date is not null and p_date is distinct from v_c.joining_date then
      perform public.hr_update_onboarding_case(v_c.id, p_date);
    end if;
  elsif p_status = 'deferred' then
    if p_date is null then perform hr_private.fail('Enter the new joining date.', 'invalid_date'); end if;
    if nullif(btrim(p_note), '') is null then perform hr_private.fail('Record why the joining was deferred.', 'reason_required'); end if;
    update public.hr_onboarding_cases set joining_status = 'deferred' where id = v_c.id;
    perform public.hr_update_onboarding_case(v_c.id, p_date);
  elsif p_status = 'no_show' then
    if nullif(btrim(p_note), '') is null then perform hr_private.fail('Record the details of the no-show.', 'reason_required'); end if;
    update public.hr_onboarding_cases set joining_status = 'no_show' where id = v_c.id;
  else
    update public.hr_onboarding_cases set joining_status = 'awaiting_joining', actual_joining_date = null where id = v_c.id;
  end if;
  perform hr_lifecycle_internal.onboarding_log(v_c.id, 'joining_' || p_status,
    concat_ws(' · ', case when p_date is not null then to_char(p_date, 'DD Mon YYYY') end, nullif(btrim(p_note), '')));
end $$;

create or replace function public.hr_add_onboarding_task(
  p_case uuid, p_title text, p_category text default 'other', p_owner_role text default 'hr', p_due_date date default null,
  p_assignee uuid default null, p_mandatory boolean default true, p_kind text default 'manual',
  p_visible boolean default true, p_description text default null, p_requires_evidence boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_c public.hr_onboarding_cases; v_id uuid;
begin
  perform hr_private.onboarding_require_manage();
  select * into v_c from public.hr_onboarding_cases where id = p_case for update;
  if v_c.id is null then perform hr_private.fail('Onboarding case not found.', 'not_found'); end if;
  if v_c.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot manage your own onboarding.', 'self_action'); end if;
  if v_c.status <> 'open' then perform hr_private.fail('Only open onboarding cases can be changed.', 'invalid_state'); end if;
  if length(btrim(coalesce(p_title, ''))) < 2 then perform hr_private.fail('Enter a task title.', 'invalid'); end if;
  if p_assignee is not null and not exists (select 1 from public.hr_employees where id = p_assignee and status not in ('exited','archived')) then
    perform hr_private.fail('The task owner must be a current employee.', 'invalid');
  end if;
  insert into public.hr_onboarding_tasks (case_id, title, description, category, task_kind, owner_role, assignee_employee_id, due_date,
                                          mandatory, requires_evidence, visible_to_employee, sort_order)
  values (v_c.id, btrim(p_title), nullif(btrim(p_description), ''), coalesce(p_category, 'other'), coalesce(p_kind, 'manual'),
          coalesce(p_owner_role, 'hr'), case when p_owner_role = 'employee' then v_c.employee_id else p_assignee end, p_due_date,
          coalesce(p_mandatory, true), coalesce(p_requires_evidence, false), coalesce(p_visible, true),
          coalesce((select max(sort_order) + 1 from public.hr_onboarding_tasks where case_id = v_c.id), 1))
  returning id into v_id;
  perform hr_lifecycle_internal.onboarding_log(v_c.id, 'task_added', btrim(p_title), v_id);
  if p_assignee is not null and p_assignee <> v_c.employee_id then
    perform hr_private.notify_employee(p_assignee, 'onboarding', 'Onboarding task: ' || btrim(p_title),
      hr_lifecycle_internal.emp_name(v_c.employee_id), '/hr/onboarding-exit/onboarding/' || v_c.id, 'hr_onboarding_task', v_id::text);
  end if;
  return v_id;
end $$;

create or replace function public.hr_assign_onboarding_task(p_task uuid, p_assignee uuid, p_due_date date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_t public.hr_onboarding_tasks; v_c public.hr_onboarding_cases;
begin
  perform hr_private.onboarding_require_manage();
  select * into v_t from public.hr_onboarding_tasks where id = p_task for update;
  if v_t.id is null then perform hr_private.fail('Task not found.', 'not_found'); end if;
  select * into v_c from public.hr_onboarding_cases where id = v_t.case_id;
  if v_c.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot manage your own onboarding.', 'self_action'); end if;
  if v_c.status <> 'open' or v_t.status not in ('pending','in_progress') then
    perform hr_private.fail('Only open tasks of open cases can be reassigned.', 'invalid_state');
  end if;
  if p_assignee is not null and not exists (select 1 from public.hr_employees where id = p_assignee and status not in ('exited','archived')) then
    perform hr_private.fail('The task owner must be a current employee.', 'invalid');
  end if;
  update public.hr_onboarding_tasks set assignee_employee_id = p_assignee, due_date = coalesce(p_due_date, due_date) where id = v_t.id;
  perform hr_lifecycle_internal.onboarding_log(v_c.id, 'task_assigned',
    v_t.title || coalesce(' → ' || hr_lifecycle_internal.emp_name(p_assignee), '') || coalesce(' · due ' || to_char(p_due_date, 'DD Mon YYYY'), ''), v_t.id);
  if p_assignee is not null and p_assignee <> v_c.employee_id then
    perform hr_private.notify_employee(p_assignee, 'onboarding', 'Onboarding task: ' || v_t.title,
      hr_lifecycle_internal.emp_name(v_c.employee_id), '/hr/onboarding-exit/onboarding/' || v_c.id, 'hr_onboarding_task', v_t.id::text);
  end if;
end $$;

-- Link a task to an asset assignment (Assets) or a training course (Training).
-- A training link creates the training assignment (or reuses an open one).
create or replace function public.hr_link_onboarding_task(p_task uuid, p_asset_assignment uuid default null, p_training_course uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_t public.hr_onboarding_tasks; v_c public.hr_onboarding_cases; v_asg uuid;
begin
  perform hr_private.onboarding_require_manage();
  select * into v_t from public.hr_onboarding_tasks where id = p_task for update;
  if v_t.id is null then perform hr_private.fail('Task not found.', 'not_found'); end if;
  select * into v_c from public.hr_onboarding_cases where id = v_t.case_id;
  if v_c.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot manage your own onboarding.', 'self_action'); end if;
  if v_c.status <> 'open' or v_t.status not in ('pending','in_progress') then
    perform hr_private.fail('Only open tasks of open cases can be linked.', 'invalid_state');
  end if;
  if (p_asset_assignment is null) = (p_training_course is null) then
    perform hr_private.fail('Link either an asset assignment or a training course.', 'invalid');
  end if;
  if p_asset_assignment is not null then
    if not exists (select 1 from public.hr_asset_assignments a where a.id = p_asset_assignment and a.employee_id = v_c.employee_id and a.returned_at is null) then
      perform hr_private.fail('That asset is not currently assigned to this employee.', 'invalid');
    end if;
    update public.hr_onboarding_tasks set asset_assignment_id = p_asset_assignment, status = 'in_progress' where id = v_t.id;
    perform hr_lifecycle_internal.onboarding_log(v_c.id, 'asset_linked', v_t.title, v_t.id);
  else
    if not exists (select 1 from public.hr_training_courses where id = p_training_course and active) then
      perform hr_private.fail('Choose an active training course.', 'invalid');
    end if;
    select id into v_asg from public.hr_training_assignments
     where employee_id = v_c.employee_id and course_id = p_training_course and status in ('assigned','in_progress','completed')
     order by (status = 'completed') desc, assigned_at desc limit 1;
    if v_asg is null then
      insert into public.hr_training_assignments (employee_id, course_id, due_date, assigned_by, notes)
      values (v_c.employee_id, p_training_course, v_t.due_date, auth.uid(), 'Onboarding: ' || v_t.title)
      returning id into v_asg;
      perform hr_private.notify_employee(v_c.employee_id, 'training', 'Induction training assigned', v_t.title,
        '/employee/training', 'hr_training_assignment', v_asg::text);
    end if;
    update public.hr_onboarding_tasks set training_course_id = p_training_course, training_assignment_id = v_asg,
           status = case when status = 'pending' then 'in_progress' else status end
     where id = v_t.id;
    perform hr_lifecycle_internal.onboarding_log(v_c.id, 'training_linked', v_t.title, v_t.id);
  end if;
end $$;

-- Complete a checklist task. HR (onboarding.manage), the task assignee, or
-- the line manager for manager-owned tasks. Kind-specific evidence rules.
create or replace function public.hr_complete_onboarding_task(p_task uuid, p_evidence_note text default null, p_evidence_document uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_t public.hr_onboarding_tasks; v_c public.hr_onboarding_cases; v_me uuid := hr_private.current_employee_id();
        v_missing text; v_train text;
begin
  select * into v_t from public.hr_onboarding_tasks where id = p_task for update;
  if v_t.id is null then perform hr_private.fail('Task not found.', 'not_found'); end if;
  select * into v_c from public.hr_onboarding_cases where id = v_t.case_id for update;
  if v_c.employee_id = v_me then
    perform hr_private.fail('Joiners complete their own steps from the Employee Portal (acknowledgements and document uploads).', 'self_action');
  end if;
  if not (hr_private.onboarding_can_view(v_c.employee_id, v_c.hr_coordinator_id)
          or v_t.assignee_employee_id = v_me) then
    perform hr_private.fail('Task not found.', 'not_found');
  end if;
  if not (hr_private.has_permission('onboarding.manage')
          or (v_t.assignee_employee_id is not null and v_t.assignee_employee_id = v_me)
          or (v_t.owner_role = 'manager' and hr_private.has_permission('onboarding.view_team') and hr_private.is_manager_of(v_c.employee_id))) then
    perform hr_private.fail('You are not allowed to complete this task.', 'forbidden');
  end if;
  if v_c.status <> 'open' then perform hr_private.fail('This onboarding case is closed.', 'invalid_state'); end if;
  if v_t.status in ('completed','waived') then perform hr_private.fail('This task is already closed.', 'invalid_state'); end if;
  if p_evidence_document is not null and not exists (
       select 1 from public.hr_documents d where d.id = p_evidence_document and d.employee_id = v_c.employee_id and d.archived_at is null) then
    perform hr_private.fail('The evidence document must be one of the employee''s documents.', 'invalid');
  end if;

  if v_t.task_kind = 'documents' then
    v_missing := hr_lifecycle_internal.onboarding_missing_documents(v_c.employee_id);
    if v_missing is not null then
      perform hr_private.fail('These required documents are not verified yet: ' || v_missing || '.', 'documents_pending');
    end if;
  elsif v_t.task_kind = 'training' and v_t.training_assignment_id is not null then
    select status into v_train from public.hr_training_assignments where id = v_t.training_assignment_id;
    if v_train is distinct from 'completed' then
      perform hr_private.fail('The linked induction training is not completed yet.', 'training_pending');
    end if;
  elsif v_t.task_kind = 'asset' and v_t.asset_assignment_id is null and nullif(btrim(p_evidence_note), '') is null then
    perform hr_private.fail('Link the assigned equipment (Assets) or record what was handed over.', 'evidence_required');
  elsif v_t.task_kind = 'acknowledgement' and v_t.acknowledged_at is null then
    perform hr_private.fail('Waiting for the employee to acknowledge this item in the Employee Portal.', 'acknowledgement_pending');
  end if;
  if v_t.requires_evidence and nullif(btrim(p_evidence_note), '') is null and p_evidence_document is null and v_t.evidence_note is null then
    perform hr_private.fail('Add completion evidence (a note or a document).', 'evidence_required');
  end if;

  update public.hr_onboarding_tasks
     set status = 'completed', completed_by = auth.uid(), completed_at = now(),
         evidence_note = coalesce(nullif(btrim(p_evidence_note), ''), evidence_note),
         evidence_document_id = coalesce(p_evidence_document, evidence_document_id)
   where id = v_t.id;
  perform hr_lifecycle_internal.onboarding_log(v_c.id, 'task_completed', v_t.title || coalesce(': ' || nullif(btrim(p_evidence_note), ''), ''), v_t.id);
end $$;

create or replace function public.hr_reopen_onboarding_task(p_task uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_t public.hr_onboarding_tasks; v_c public.hr_onboarding_cases;
begin
  perform hr_private.onboarding_require_manage();
  select * into v_t from public.hr_onboarding_tasks where id = p_task for update;
  if v_t.id is null then perform hr_private.fail('Task not found.', 'not_found'); end if;
  select * into v_c from public.hr_onboarding_cases where id = v_t.case_id;
  if v_c.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot manage your own onboarding.', 'self_action'); end if;
  if v_c.status <> 'open' then perform hr_private.fail('This onboarding case is closed.', 'invalid_state'); end if;
  if v_t.status not in ('completed','waived') then perform hr_private.fail('Only closed tasks can be reopened.', 'invalid_state'); end if;
  update public.hr_onboarding_tasks
     set status = 'pending', completed_by = null, completed_at = null, waived_reason = null, waived_by = null,
         acknowledged_at = case when task_kind = 'acknowledgement' then null else acknowledged_at end
   where id = v_t.id;
  perform hr_lifecycle_internal.onboarding_log(v_c.id, 'task_reopened', v_t.title || coalesce(': ' || nullif(btrim(p_note), ''), ''), v_t.id);
end $$;

create or replace function public.hr_waive_onboarding_task(p_task uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_t public.hr_onboarding_tasks; v_c public.hr_onboarding_cases;
begin
  perform hr_private.onboarding_require_manage();
  select * into v_t from public.hr_onboarding_tasks where id = p_task for update;
  if v_t.id is null then perform hr_private.fail('Task not found.', 'not_found'); end if;
  select * into v_c from public.hr_onboarding_cases where id = v_t.case_id;
  if v_c.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot manage your own onboarding.', 'self_action'); end if;
  if v_c.status <> 'open' then perform hr_private.fail('This onboarding case is closed.', 'invalid_state'); end if;
  if v_t.status in ('completed','waived') then perform hr_private.fail('This task is already closed.', 'invalid_state'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then perform hr_private.fail('Record why this task does not apply.', 'reason_required'); end if;
  update public.hr_onboarding_tasks set status = 'waived', waived_reason = btrim(p_reason), waived_by = auth.uid(), completed_at = now()
   where id = v_t.id;
  perform hr_lifecycle_internal.onboarding_log(v_c.id, 'task_waived', v_t.title || ': ' || btrim(p_reason), v_t.id);
  if v_t.mandatory then
    perform hr_private.audit_event('ONBOARDING_MANDATORY_TASK_WAIVED', 'hr_onboarding_tasks', v_t.id::text,
      jsonb_build_object('case_id', v_c.id, 'employee_id', v_c.employee_id, 'reason', btrim(p_reason)));
  end if;
end $$;

-- Employee acknowledgement (security / confidentiality etc.) from the portal.
create or replace function public.hr_acknowledge_onboarding_task(p_task uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_t public.hr_onboarding_tasks; v_c public.hr_onboarding_cases; v_me uuid := hr_private.current_employee_id();
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  select * into v_t from public.hr_onboarding_tasks where id = p_task for update;
  if v_t.id is not null then select * into v_c from public.hr_onboarding_cases where id = v_t.case_id; end if;
  if v_t.id is null or v_c.employee_id is distinct from v_me or not v_t.visible_to_employee then
    perform hr_private.fail('Task not found.', 'not_found');
  end if;
  if v_t.task_kind <> 'acknowledgement' then perform hr_private.fail('This item does not need your acknowledgement.', 'invalid'); end if;
  if v_c.status <> 'open' then perform hr_private.fail('Your onboarding is already closed.', 'invalid_state'); end if;
  if v_t.status in ('completed','waived') then perform hr_private.fail('You have already acknowledged this item.', 'invalid_state'); end if;
  update public.hr_onboarding_tasks set acknowledged_at = now(), status = 'completed', completed_by = auth.uid(), completed_at = now()
   where id = v_t.id;
  perform hr_lifecycle_internal.onboarding_log(v_c.id, 'acknowledged', v_t.title, v_t.id);
  perform hr_private.audit_event('ONBOARDING_ACKNOWLEDGED', 'hr_onboarding_tasks', v_t.id::text,
    jsonb_build_object('case_id', v_c.id, 'employee_id', v_me, 'title', v_t.title));
end $$;

-- Linked training completed -> onboarding task completed.
create or replace function hr_lifecycle_internal.onboarding_training_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
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
create trigger hr_training_assignments_onboarding_sync after update of status on public.hr_training_assignments
  for each row execute function hr_lifecycle_internal.onboarding_training_sync();

create or replace function public.hr_complete_onboarding(p_case uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_c public.hr_onboarding_cases; v_e public.hr_employees; v_pending text; v_new text; v_today date := hr_private.business_today(); v_mark bigint;
begin
  perform hr_private.onboarding_require_manage();
  select * into v_c from public.hr_onboarding_cases where id = p_case for update;
  if v_c.id is null then perform hr_private.fail('Onboarding case not found.', 'not_found'); end if;
  if v_c.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot manage your own onboarding.', 'self_action'); end if;
  if v_c.status <> 'open' then perform hr_private.fail('This onboarding case is already closed.', 'invalid_state'); end if;
  if v_c.joining_status <> 'joined' then perform hr_private.fail('Record the employee''s joining before completing onboarding.', 'not_joined'); end if;
  select string_agg(title, ', ' order by sort_order) into v_pending
    from public.hr_onboarding_tasks where case_id = v_c.id and mandatory and status in ('pending','in_progress');
  if v_pending is not null then
    perform hr_private.fail('Complete or waive these mandatory tasks first: ' || v_pending || '.', 'tasks_pending');
  end if;
  update public.hr_onboarding_cases set status = 'completed', completed_at = now(), completed_by = auth.uid() where id = v_c.id;

  -- Employee Management: onboarding -> probation (if a probation period applies) or active.
  select * into v_e from public.hr_employees where id = v_c.employee_id for update;
  if v_e.status = 'onboarding' then
    v_new := case when v_e.probation_end_date is not null and v_e.probation_end_date >= v_today then 'probation' else 'active' end;
    v_mark := hr_lifecycle_internal.history_mark();
    update public.hr_employees set status = v_new where id = v_e.id;
    perform hr_lifecycle_internal.lifecycle_change_event(v_e.id, case when v_new = 'probation' then 'probation_start' else 'status_change' end,
      coalesce(v_c.actual_joining_date, v_today), 'Onboarding completed',
      jsonb_build_object('status', jsonb_build_object('from', 'onboarding', 'to', v_new)), v_mark);
  end if;
  perform hr_lifecycle_internal.onboarding_log(v_c.id, 'completed', p_note);
  perform hr_private.notify_employee(v_c.employee_id, 'onboarding', 'Onboarding complete',
    'Welcome aboard! Your onboarding checklist is complete.', '/employee/onboarding', 'hr_onboarding_case', v_c.id::text);
end $$;

create or replace function public.hr_cancel_onboarding(p_case uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_c public.hr_onboarding_cases;
begin
  perform hr_private.onboarding_require_manage();
  select * into v_c from public.hr_onboarding_cases where id = p_case for update;
  if v_c.id is null then perform hr_private.fail('Onboarding case not found.', 'not_found'); end if;
  if v_c.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot manage your own onboarding.', 'self_action'); end if;
  if v_c.status <> 'open' then perform hr_private.fail('Only open onboarding cases can be cancelled.', 'invalid_state'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then perform hr_private.fail('Record why onboarding is cancelled.', 'reason_required'); end if;
  update public.hr_onboarding_cases set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = btrim(p_reason)
   where id = v_c.id;
  perform hr_lifecycle_internal.onboarding_log(v_c.id, 'cancelled', btrim(p_reason));
end $$;

-- Document verification queue for joiners (open onboarding cases): per
-- employee, missing checklist documents and documents awaiting verification.
create or replace function public.hr_onboarding_document_queue()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (hr_private.any_permission(array['onboarding.view','onboarding.manage']) and hr_private.any_permission(array['documents.view','documents.manage'])) then
    perform hr_private.fail('You are not allowed to view the document verification queue.', 'forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'case_id', c.id, 'employee_id', e.id, 'employee_code', e.employee_code, 'employee', hr_lifecycle_internal.emp_name(e.id),
      'joining_date', c.joining_date, 'joining_status', c.joining_status,
      'missing', hr_lifecycle_internal.onboarding_missing_documents(e.id),
      'pending', (select count(*) from public.hr_documents d join public.hr_document_categories k on k.id = d.category_id
                  where d.employee_id = e.id and d.archived_at is null and d.verification_status = 'pending' and not k.is_confidential),
      'rejected', (select count(*) from public.hr_documents d where d.employee_id = e.id and d.archived_at is null and d.verification_status = 'rejected'),
      'expiring', (select count(*) from public.hr_documents d where d.employee_id = e.id and d.archived_at is null and d.expiry_date is not null
                     and d.expiry_date <= hr_private.business_today() + 30))
      order by c.joining_date nulls last)
    from public.hr_onboarding_cases c join public.hr_employees e on e.id = c.employee_id
    where c.status = 'open' and e.id is distinct from hr_private.current_employee_id()), '[]'::jsonb);
end $$;

-- HR is told when an employee's uploaded FILE has landed in storage (not when
-- the version row is registered), so a failed upload never notifies anyone.
-- This is the same notification point as Module 9 (129,
-- hr_documents_object_uploaded): when that trigger is installed it owns the
-- documents.manage notification and this one only adds the onboarding
-- coordinator, so HR is never notified twice.
create or replace function hr_lifecycle_internal.document_upload_notify_hr()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_ver public.hr_document_versions; v_doc public.hr_documents; v_cat text; v_coord uuid;
begin
  select * into v_ver from public.hr_document_versions where storage_path = new.name;
  if v_ver.id is null then return null; end if;
  select * into v_doc from public.hr_documents where id = v_ver.document_id;
  if v_doc.id is null or v_ver.uploaded_by is null or v_ver.uploaded_by is distinct from hr_private.employee_user_id(v_doc.employee_id) then
    return null;
  end if;
  select name into v_cat from public.hr_document_categories where id = v_doc.category_id;
  if not exists (select 1 from pg_catalog.pg_trigger t
                 where t.tgrelid = 'storage.objects'::regclass and t.tgname = 'hr_documents_object_uploaded' and not t.tgisinternal) then
    perform hr_private.notify_permission_holders('documents.manage', 'document_uploaded', 'Document to verify: ' || hr_lifecycle_internal.emp_name(v_doc.employee_id),
      v_cat || ' · ' || v_doc.title || case when v_ver.version > 1 then ' (version ' || v_ver.version || ')' else '' end,
      '/hr/onboarding-exit/documents', 'hr_document', v_doc.id::text, v_doc.employee_id);
  end if;
  select hr_coordinator_id into v_coord from public.hr_onboarding_cases where employee_id = v_doc.employee_id and status = 'open';
  if v_coord is not null and v_coord <> v_doc.employee_id
     and not exists (select 1 from public.hr_employees e where e.id = v_coord and e.user_id is not null
                     and exists (select 1 from public.hr_user_roles ur where ur.user_id = e.user_id
                                 and (ur.role_key = 'super_admin' or exists (select 1 from public.hr_role_permissions rp
                                      where rp.role_key = ur.role_key and rp.permission_key = 'documents.manage')))) then
    perform hr_private.notify_employee(v_coord, 'document_uploaded', 'Joiner uploaded a document: ' || hr_lifecycle_internal.emp_name(v_doc.employee_id),
      v_cat || ' · ' || v_doc.title, '/hr/onboarding-exit/documents', 'hr_document', v_doc.id::text);
  end if;
  return null;
end $$;
drop trigger if exists hr_onboarding_document_object_uploaded on storage.objects;
create trigger hr_onboarding_document_object_uploaded after insert on storage.objects
  for each row when (new.bucket_id = 'hr-documents') execute function hr_lifecycle_internal.document_upload_notify_hr();

-- =====================================================================
-- PROBATION
-- =====================================================================
create or replace function hr_lifecycle_internal.probation_open_review(p_employee uuid, p_type text, p_due date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_e public.hr_employees; v_mgr uuid; v_id uuid;
begin
  select * into v_e from public.hr_employees where id = p_employee;
  if v_e.probation_end_date is null then perform hr_private.fail('This employee has no probation end date.', 'no_probation'); end if;
  select m.id into v_mgr from public.hr_employees m where m.id = v_e.manager_id and m.status not in ('exited','archived');
  insert into public.hr_probation_reviews (employee_id, review_type, probation_end_date, due_date, status, manager_id, created_by)
  values (p_employee, p_type, v_e.probation_end_date, coalesce(p_due, v_e.probation_end_date),
          case when v_mgr is null then 'pending_hr' else 'pending_manager' end, v_mgr, auth.uid())
  returning id into v_id;
  perform hr_lifecycle_internal.probation_log(v_id, 'opened', 'Probation ends ' || to_char(v_e.probation_end_date, 'DD Mon YYYY'));
  if v_mgr is not null then
    perform hr_private.notify_employee(v_mgr, 'probation', 'Probation review due: ' || hr_lifecycle_internal.emp_name(p_employee),
      'Give your feedback by ' || to_char(coalesce(p_due, v_e.probation_end_date), 'DD Mon YYYY') || '.',
      '/hr/onboarding-exit/probation', 'hr_probation_review', v_id::text);
  end if;
  perform hr_private.notify_permission_holders('probation.decide', 'probation', 'Probation review opened: ' || hr_lifecycle_internal.emp_name(p_employee),
    'Probation ends ' || to_char(v_e.probation_end_date, 'DD Mon YYYY') || '.', '/hr/onboarding-exit/probation',
    'hr_probation_review', v_id::text, p_employee);
  return v_id;
end $$;

create or replace function public.hr_open_probation_review(p_employee uuid, p_due_date date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_e public.hr_employees;
begin
  if not hr_private.has_permission('probation.decide') then
    perform hr_private.fail('You are not allowed to manage probation reviews.', 'forbidden');
  end if;
  if p_employee = hr_private.current_employee_id() then perform hr_private.fail('You cannot open your own probation review.', 'self_action'); end if;
  select * into v_e from public.hr_employees where id = p_employee for update;
  if v_e.id is null then perform hr_private.fail('Employee not found.', 'not_found'); end if;
  if v_e.status not in ('onboarding','probation') then
    perform hr_private.fail('Only employees in onboarding or probation have a probation review.', 'invalid_state');
  end if;
  if exists (select 1 from public.hr_probation_reviews where employee_id = p_employee and status in ('pending_manager','pending_hr')) then
    perform hr_private.fail('This employee already has an open probation review.', 'review_exists');
  end if;
  return hr_lifecycle_internal.probation_open_review(p_employee, 'scheduled', p_due_date);
end $$;

-- Review reminders: opens reviews for probations ending within p_days and
-- re-notifies managers/HR about overdue open reviews. Idempotent per day.
create or replace function public.hr_generate_probation_reviews(p_days int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_days int := coalesce(p_days, (hr_lifecycle_internal.lifecycle_setting('probation_reminder_days', '14'))::int);
        v_today date := hr_private.business_today(); r record; v_opened int := 0; v_reminded int := 0;
begin
  if not hr_private.has_permission('probation.decide') then
    perform hr_private.fail('You are not allowed to manage probation reviews.', 'forbidden');
  end if;
  if v_days < 0 or v_days > 120 then perform hr_private.fail('Look-ahead must be between 0 and 120 days.', 'invalid'); end if;
  for r in select e.id from public.hr_employees e
           where e.status = 'probation' and e.probation_end_date is not null and e.probation_end_date <= v_today + v_days
             and e.id is distinct from hr_private.current_employee_id()
             and not exists (select 1 from public.hr_probation_reviews pr where pr.employee_id = e.id and pr.status in ('pending_manager','pending_hr'))
             and not exists (select 1 from public.hr_probation_reviews pr where pr.employee_id = e.id and pr.status = 'decided'
                             and pr.decision = 'extended' and pr.extended_to > e.probation_end_date)
  loop
    perform hr_lifecycle_internal.probation_open_review(r.id, 'scheduled', null);
    v_opened := v_opened + 1;
  end loop;
  for r in select pr.id, pr.employee_id, pr.manager_id, pr.status, pr.due_date from public.hr_probation_reviews pr
           where pr.status in ('pending_manager','pending_hr') and pr.due_date < v_today
             and not exists (select 1 from public.hr_probation_events ev where ev.review_id = pr.id and ev.event_type = 'reminder'
                             and ev.created_at >= v_today::timestamptz)
  loop
    if r.status = 'pending_manager' and r.manager_id is not null then
      perform hr_private.notify_employee(r.manager_id, 'probation', 'Overdue probation review: ' || hr_lifecycle_internal.emp_name(r.employee_id),
        'Due ' || to_char(r.due_date, 'DD Mon YYYY') || '.', '/hr/onboarding-exit/probation', 'hr_probation_review', r.id::text);
    else
      perform hr_private.notify_permission_holders('probation.decide', 'probation', 'Overdue probation decision: ' || hr_lifecycle_internal.emp_name(r.employee_id),
        'Due ' || to_char(r.due_date, 'DD Mon YYYY') || '.', '/hr/onboarding-exit/probation', 'hr_probation_review', r.id::text, r.employee_id);
    end if;
    perform hr_lifecycle_internal.probation_log(r.id, 'reminder', 'Overdue since ' || to_char(r.due_date, 'DD Mon YYYY'));
    v_reminded := v_reminded + 1;
  end loop;
  return jsonb_build_object('opened', v_opened, 'reminded', v_reminded);
end $$;

-- Manager feedback (reporting line, probation.review_team), or HR on the
-- manager's behalf (probation.decide). Never on one's own review.
create or replace function public.hr_submit_probation_feedback(p_review uuid, p_rating int, p_recommendation text, p_feedback text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.hr_probation_reviews; v_on_behalf boolean;
begin
  select * into v_r from public.hr_probation_reviews where id = p_review for update;
  if v_r.id is null or not hr_private.probation_can_view(v_r.employee_id) then perform hr_private.fail('Probation review not found.', 'not_found'); end if;
  if v_r.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot review your own probation.', 'self_action'); end if;
  v_on_behalf := not (hr_private.has_permission('probation.review_team') and hr_private.is_manager_of(v_r.employee_id));
  if v_on_behalf and not hr_private.has_permission('probation.decide') then
    perform hr_private.fail('Only the employee''s reporting manager or HR can give probation feedback.', 'forbidden');
  end if;
  if v_r.status not in ('pending_manager','pending_hr') then perform hr_private.fail('This probation review is closed.', 'invalid_state'); end if;
  if p_rating is null or p_rating not between 1 and 5 then perform hr_private.fail('Choose a rating from 1 to 5.', 'invalid'); end if;
  if p_recommendation is null or p_recommendation not in ('confirm','extend','terminate') then
    perform hr_private.fail('Choose a recommendation: confirm, extend or terminate.', 'invalid');
  end if;
  if length(btrim(coalesce(p_feedback, ''))) < 10 then perform hr_private.fail('Write your feedback (at least 10 characters).', 'reason_required'); end if;
  update public.hr_probation_reviews
     set manager_rating = p_rating, manager_recommendation = p_recommendation, manager_feedback = btrim(p_feedback),
         manager_submitted_by = auth.uid(), manager_submitted_at = now(), status = 'pending_hr'
   where id = v_r.id;
  perform hr_lifecycle_internal.probation_log(v_r.id, case when v_on_behalf then 'feedback_by_hr' else 'manager_feedback' end,
    'Recommendation: ' || p_recommendation || ' · rating ' || p_rating);
  perform hr_private.notify_permission_holders('probation.decide', 'probation', 'Probation feedback received: ' || hr_lifecycle_internal.emp_name(v_r.employee_id),
    'Recommendation: ' || p_recommendation || '.', '/hr/onboarding-exit/probation', 'hr_probation_review', v_r.id::text, v_r.employee_id);
end $$;

-- HR decision. confirmed -> active (+confirmation_date); extended -> new end
-- date and a new review; terminated -> Exit case (termination, needs exit.manage).
create or replace function public.hr_decide_probation(
  p_review uuid, p_decision text, p_reason text, p_effective_date date default null, p_extend_to date default null,
  p_last_working_day date default null, p_hr_comments text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_r public.hr_probation_reviews; v_e public.hr_employees; v_eff date := coalesce(p_effective_date, hr_private.business_today());
        v_exit uuid; v_new uuid; v_mark bigint;
begin
  if not hr_private.has_permission('probation.decide') then
    perform hr_private.fail('You are not allowed to decide probation.', 'forbidden');
  end if;
  select * into v_r from public.hr_probation_reviews where id = p_review for update;
  if v_r.id is null then perform hr_private.fail('Probation review not found.', 'not_found'); end if;
  if v_r.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot decide your own probation.', 'self_action'); end if;
  if v_r.status = 'pending_manager' then
    perform hr_private.fail('Waiting for the reporting manager''s feedback. Record it (or give feedback on their behalf) first.', 'feedback_pending');
  end if;
  if v_r.status <> 'pending_hr' then perform hr_private.fail('This probation review is closed.', 'invalid_state'); end if;
  if p_decision is null or p_decision not in ('confirmed','extended','terminated') then
    perform hr_private.fail('Choose confirm, extend or terminate.', 'invalid');
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then perform hr_private.fail('Record the reason for the decision.', 'reason_required'); end if;
  select * into v_e from public.hr_employees where id = v_r.employee_id for update;
  if v_e.status not in ('onboarding','probation') then
    perform hr_private.fail('The employee is no longer in probation (status: ' || v_e.status || ').', 'invalid_state');
  end if;

  if p_decision = 'confirmed' then
    if v_e.joining_date is not null and v_eff < v_e.joining_date then
      perform hr_private.fail('The confirmation date cannot be before the joining date.', 'invalid_date');
    end if;
    v_mark := hr_lifecycle_internal.history_mark();
    update public.hr_employees set status = 'active', confirmation_date = v_eff where id = v_e.id;
    perform hr_lifecycle_internal.lifecycle_change_event(v_e.id, 'confirmation', v_eff, btrim(p_reason),
      jsonb_build_object('status', jsonb_build_object('from', v_e.status, 'to', 'active'),
                         'confirmation_date', jsonb_build_object('from', null, 'to', v_eff)), v_mark);
    perform hr_private.notify_employee(v_e.id, 'probation', 'Your employment is confirmed',
      'Congratulations! Confirmed effective ' || to_char(v_eff, 'DD Mon YYYY') || '.', '/employee/onboarding', 'hr_probation_review', v_r.id::text);
  elsif p_decision = 'extended' then
    if p_extend_to is null or p_extend_to <= coalesce(v_e.probation_end_date, v_eff) then
      perform hr_private.fail('The extended probation end date must be after the current end date.', 'invalid_date');
    end if;
    if v_e.joining_date is not null and p_extend_to > v_e.joining_date + 730 then
      perform hr_private.fail('Probation cannot be extended beyond two years from joining.', 'invalid_date');
    end if;
    v_mark := hr_lifecycle_internal.history_mark();
    update public.hr_employees set probation_end_date = p_extend_to, status = 'probation' where id = v_e.id;
    perform hr_lifecycle_internal.lifecycle_change_event(v_e.id, 'status_change', v_eff, 'Probation extended: ' || btrim(p_reason),
      jsonb_build_object('probation_end_date', jsonb_build_object('from', v_e.probation_end_date, 'to', p_extend_to)), v_mark);
    perform hr_private.notify_employee(v_e.id, 'probation', 'Your probation has been extended',
      'New probation end date: ' || to_char(p_extend_to, 'DD Mon YYYY') || '.', '/employee/onboarding', 'hr_probation_review', v_r.id::text);
  else
    if not hr_private.has_permission('exit.manage') then
      perform hr_private.fail('Ending probation early also needs Exit Management permission.', 'forbidden');
    end if;
    if p_last_working_day is null then perform hr_private.fail('Set the last working day.', 'invalid_date'); end if;
    v_exit := public.hr_initiate_exit(v_e.id, 'termination', 'Probation not confirmed: ' || btrim(p_reason), p_last_working_day);
  end if;

  update public.hr_probation_reviews
     set status = 'decided', decision = p_decision, decision_reason = btrim(p_reason), effective_date = v_eff,
         extended_to = case when p_decision = 'extended' then p_extend_to end, exit_id = v_exit,
         hr_comments = coalesce(nullif(btrim(p_hr_comments), ''), hr_comments), decided_by = auth.uid(), decided_at = now()
   where id = v_r.id;
  perform hr_lifecycle_internal.probation_log(v_r.id, 'decided_' || p_decision, btrim(p_reason));
  perform hr_private.audit_event('PROBATION_' || upper(p_decision), 'hr_probation_reviews', v_r.id::text,
    jsonb_build_object('employee_id', v_e.id, 'effective_date', v_eff, 'extended_to', p_extend_to, 'exit_id', v_exit));
  if p_decision = 'extended' then
    v_new := hr_lifecycle_internal.probation_open_review(v_e.id, 'extension', p_extend_to);
  end if;
  return coalesce(v_exit, v_new, v_r.id);
end $$;

create or replace function public.hr_cancel_probation_review(p_review uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.hr_probation_reviews;
begin
  if not hr_private.has_permission('probation.decide') then perform hr_private.fail('You are not allowed to manage probation reviews.', 'forbidden'); end if;
  select * into v_r from public.hr_probation_reviews where id = p_review for update;
  if v_r.id is null then perform hr_private.fail('Probation review not found.', 'not_found'); end if;
  if v_r.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot manage your own probation.', 'self_action'); end if;
  if v_r.status not in ('pending_manager','pending_hr') then perform hr_private.fail('This probation review is closed.', 'invalid_state'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then perform hr_private.fail('Record why the review is cancelled.', 'reason_required'); end if;
  update public.hr_probation_reviews set status = 'cancelled' where id = v_r.id;
  perform hr_lifecycle_internal.probation_log(v_r.id, 'cancelled', btrim(p_reason));
end $$;

-- =====================================================================
-- EXIT: resignation withdrawal policy, clearance, access revocation
-- =====================================================================
-- 110's exit helpers write exit history and send notifications. Blanket
-- `grant execute on all functions in schema hr_private to authenticated`
-- statements in later migrations would let any signed-in user call them
-- directly (forged exit history, spam notifications). The real bodies now
-- live in hr_lifecycle_internal; the hr_private names stay (same signatures,
-- so every 110 RPC keeps working) as SECURITY INVOKER wrappers. Inside an
-- exit RPC (SECURITY DEFINER, running as the owner) the wrapper works; a
-- direct call runs as the caller, who has no usage on hr_lifecycle_internal,
-- and is refused, whatever is later granted on hr_private.
create or replace function hr_lifecycle_internal.exit_log(p_exit uuid, p_event text, p_from text, p_to text, p_note text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.hr_exit_events (exit_id, event_type, from_status, to_status, note, actor_user_id)
  values (p_exit, p_event, p_from, p_to, p_note, auth.uid())
$$;

create or replace function hr_lifecycle_internal.exit_notify(p_exit uuid, p_title text, p_body text default null,
                                                             p_employee_too boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
declare v_emp uuid; v_mgr uuid; v_name text;
begin
  select x.employee_id, e.manager_id, coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name))
    into v_emp, v_mgr, v_name
    from public.hr_exits x join public.hr_employees e on e.id = x.employee_id where x.id = p_exit;
  if p_employee_too then
    perform hr_private.notify_employee(v_emp, 'exit_update', p_title, p_body, '/employee/exit', 'hr_exit', p_exit::text);
  end if;
  if v_mgr is not null then
    perform hr_private.notify_employee(v_mgr, 'exit_update', p_title || ': ' || v_name, p_body, '/employee/team/exits', 'hr_exit', p_exit::text);
  end if;
end $$;

create or replace function hr_private.exit_log(p_exit uuid, p_event text, p_from text, p_to text, p_note text default null)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform hr_lifecycle_internal.exit_log(p_exit, p_event, p_from, p_to, p_note);
end $$;

create or replace function hr_private.exit_notify(p_exit uuid, p_title text, p_body text default null,
                                                  p_employee_too boolean default true)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform hr_lifecycle_internal.exit_notify(p_exit, p_title, p_body, p_employee_too);
end $$;
-- Employee withdrawal follows lifecycle.resignation_withdrawal:
--   before_hr_approval (default, previous behaviour) | before_clearance | never.
-- HR (exit.manage) may still withdraw any case until clearance ends.
create or replace function public.hr_withdraw_resignation(p_exit uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_x public.hr_exits; v_me uuid := hr_private.current_employee_id(); v_by_hr boolean := false;
        v_policy text := hr_lifecycle_internal.lifecycle_setting('resignation_withdrawal', 'before_hr_approval');
begin
  select * into v_x from public.hr_exits where id = p_exit for update;
  if v_x.id is null or not hr_private.exit_can_view(v_x.employee_id) then
    perform hr_private.fail('Exit case not found.', 'not_found');
  end if;
  if v_x.employee_id = v_me then
    if v_x.initiated_by <> 'employee' then
      perform hr_private.fail('This exit was initiated by HR. Please contact HR.', 'invalid_state');
    end if;
    if v_policy = 'never' then
      perform hr_private.fail('Company policy does not allow withdrawing a submitted resignation. Please contact HR.', 'withdrawal_not_allowed');
    elsif v_policy = 'before_clearance' then
      if v_x.status not in ('submitted','manager_review','hr_review','notice_period') then
        perform hr_private.fail('Your resignation can no longer be withdrawn here. Please contact HR.', 'invalid_state');
      end if;
    elsif v_x.status not in ('submitted','manager_review','hr_review') then
      perform hr_private.fail('Your resignation can no longer be withdrawn here. Please contact HR.', 'invalid_state');
    end if;
  elsif hr_private.has_permission('exit.manage') then
    v_by_hr := true;
    if v_x.status not in ('submitted','manager_review','hr_review','notice_period','clearance') then
      perform hr_private.fail('This exit case can no longer be withdrawn.', 'invalid_state');
    end if;
  else
    perform hr_private.fail('You are not allowed to withdraw this exit.', 'forbidden');
  end if;
  update public.hr_exits set status = 'withdrawn', withdrawn_at = now() where id = v_x.id;
  if v_x.status in ('notice_period','clearance') then
    update public.hr_employees
       set status = coalesce(nullif(v_x.employee_status_before, 'notice_period'), 'active'),
           resignation_date = null, last_working_date = null
     where id = v_x.employee_id and status = 'notice_period';
  end if;
  update public.hr_payroll_settlements set status = 'cancelled', cancelled_reason = 'Exit withdrawn'
   where exit_id = v_x.id and status in ('draft','submitted');
  perform hr_private.exit_log(v_x.id, case when v_by_hr then 'withdrawn_by_hr' else 'withdrawn' end,
                              v_x.status, 'withdrawn', nullif(btrim(p_note), ''));
  perform hr_private.exit_notify(v_x.id, 'Resignation withdrawn', nullif(btrim(p_note), ''));
end $$;

-- Clearance checklist: adds IT clearance, department owners and due dates.
create or replace function public.hr_start_exit_clearance(p_exit uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_x public.hr_exits; v_user uuid; v_due date; v_mgr uuid;
begin
  perform hr_private.exit_require_manage();
  select * into v_x from public.hr_exits where id = p_exit for update;
  if v_x.id is null then perform hr_private.fail('Exit case not found.', 'not_found'); end if;
  if v_x.employee_id = hr_private.current_employee_id() then
    perform hr_private.fail('You cannot process your own exit.', 'self_action');
  end if;
  if v_x.status <> 'notice_period' then
    perform hr_private.fail('Clearance starts from the notice period stage.', 'invalid_state');
  end if;
  v_user := hr_private.employee_user_id(v_x.employee_id);
  v_due := v_x.approved_last_working_day;
  select manager_id into v_mgr from public.hr_employees where id = v_x.employee_id;
  insert into public.hr_exit_clearance_items (exit_id, item_key, owner_role, department, due_date, assignee_employee_id, sort_order, status, note, completed_at) values
    (v_x.id, 'asset_return',      'hr_admin',      'IT / Admin', v_due, null,  1, 'pending', null, null),
    (v_x.id, 'access_revocation', 'it',            'IT',         v_due, null,  2,
       case when v_user is null then 'not_applicable' else 'pending' end,
       case when v_user is null then 'No portal account linked.' end,
       case when v_user is null then now() end),
    (v_x.id, 'it_clearance',      'it',            'IT',         v_due, null,  3, 'pending', null, null),
    (v_x.id, 'document_handover', 'manager',       'Department', v_due, v_mgr, 4, 'pending', null, null),
    (v_x.id, 'project_handover',  'manager',       'Department', v_due, v_mgr, 5, 'pending', null, null),
    (v_x.id, 'hr_clearance',      'hr_admin',      'HR',         v_due, null,  6, 'pending', null, null),
    (v_x.id, 'payroll_clearance', 'payroll_admin', 'Finance',    v_due, null,  7, 'pending', null, null),
    (v_x.id, 'final_settlement',  'payroll_admin', 'Payroll',    v_due + 30, null, 8, 'pending', null, null),
    (v_x.id, 'relieving_letter',  'hr_admin',      'HR',         v_due, null,  9, 'pending', null, null)
  on conflict (exit_id, item_key) do nothing;
  update public.hr_exits set status = 'clearance',
         access_revocation_status = case when v_user is null then 'not_applicable' else access_revocation_status end
   where id = v_x.id;
  perform hr_private.exit_log(v_x.id, 'clearance_started', 'notice_period', 'clearance');
  perform hr_private.exit_notify(v_x.id, 'Exit clearance started',
    'Please return company assets and complete your handovers.');
  perform hr_private.notify_permission_holders('exit.clearance_it', 'exit_update', 'IT clearance: ' || hr_lifecycle_internal.emp_name(v_x.employee_id),
    'Last working day ' || coalesce(to_char(v_due, 'DD Mon YYYY'), '—') || '.', '/hr/onboarding-exit/clearance', 'hr_exit', v_x.id::text, v_x.employee_id);
  perform hr_private.notify_permission_holders('payroll.manage', 'exit_update', 'Final settlement to prepare: ' || hr_lifecycle_internal.emp_name(v_x.employee_id),
    'Last working day ' || coalesce(to_char(v_due, 'DD Mon YYYY'), '—') || '.', '/hr/onboarding-exit/settlement', 'hr_exit', v_x.id::text, v_x.employee_id);
end $$;

-- Owner-aware clearance completion. HR (exit.manage) may complete any item as
-- before; IT, payroll, asset managers and the line manager complete their own
-- items. The leaver can never clear their own exit. Access revocation cannot
-- be skipped while a portal account exists, and the final settlement item is
-- completed only by an approved settlement (or an audited exception).
create or replace function public.hr_complete_clearance_item(p_item uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_item public.hr_exit_clearance_items; v_x public.hr_exits;
begin
  select * into v_item from public.hr_exit_clearance_items where id = p_item for update;
  if v_item.id is null then perform hr_private.fail('Clearance item not found.', 'not_found'); end if;
  select * into v_x from public.hr_exits where id = v_item.exit_id for update;
  if v_x.employee_id = hr_private.current_employee_id() then
    perform hr_private.fail('You cannot process your own exit.', 'self_action');
  end if;
  if not hr_private.clearance_can_act(v_item.item_key, v_x.employee_id) then
    perform hr_private.fail('You are not allowed to complete this clearance item.', 'forbidden');
  end if;
  if p_status is null or p_status not in ('completed','not_applicable','pending') then
    perform hr_private.fail('Status must be completed, not applicable or pending.', 'invalid_status');
  end if;
  if p_status = 'pending' and not hr_private.has_permission('exit.manage') then
    perform hr_private.fail('Only HR can reopen clearance items.', 'forbidden');
  end if;
  if v_item.status = 'waived' and p_status <> 'pending' then
    perform hr_private.fail('This item is covered by an exception. Reopen it first.', 'invalid_state');
  end if;
  if v_x.status not in ('clearance','final_settlement')
     or (p_status = 'pending' and v_x.status <> 'clearance') then
    perform hr_private.fail('Clearance items can only be changed while the exit is in clearance or final settlement.', 'invalid_state');
  end if;
  if v_x.status = 'final_settlement' and v_item.item_key not in ('final_settlement','relieving_letter') then
    perform hr_private.fail('Only settlement items can be changed at the final settlement stage.', 'invalid_state');
  end if;
  if p_status = 'not_applicable' and nullif(btrim(p_note), '') is null then
    perform hr_private.fail('Add a note explaining why this item does not apply.', 'reason_required');
  end if;
  if v_item.item_key = 'asset_return' and p_status <> 'pending'
     and exists (select 1 from public.hr_employee_open_assets(v_x.employee_id)) then
    perform hr_private.fail('Assets are still assigned to this employee. Record their return first.', 'open_assets');
  end if;
  if v_item.item_key = 'access_revocation' and p_status in ('completed','not_applicable')
     and hr_private.employee_user_id(v_x.employee_id) is not null and v_x.auth_access_revoked_at is null then
    perform hr_private.fail('Sign-in access has not been revoked yet. Run the access revocation first.', 'access_not_revoked');
  end if;
  if v_item.item_key = 'final_settlement' and p_status = 'completed'
     and not exists (select 1 from public.hr_payroll_settlements s where s.exit_id = v_x.id and s.status in ('approved','paid')) then
    perform hr_private.fail('The full and final settlement has not been approved by payroll yet.', 'settlement_not_approved');
  end if;
  if v_item.item_key = 'final_settlement' and p_status = 'not_applicable' and not hr_private.has_permission('payroll.approve') then
    perform hr_private.fail('Only a payroll approver can mark the final settlement as not applicable.', 'forbidden');
  end if;
  update public.hr_exit_clearance_items
     set status = p_status,
         completed_by = case when p_status = 'pending' then null else auth.uid() end,
         completed_at = case when p_status = 'pending' then null else now() end,
         note = coalesce(nullif(btrim(p_note), ''), note),
         exception_reason = case when p_status = 'pending' then null else exception_reason end,
         exception_by = case when p_status = 'pending' then null else exception_by end,
         exception_at = case when p_status = 'pending' then null else exception_at end
   where id = v_item.id;
  if v_item.item_key = 'access_revocation' and p_status = 'pending' and v_item.status = 'waived' then
    update public.hr_exits set access_revocation_status = case when auth_access_revoked_at is not null then 'revoked'
                                                               when access_revocation_error is not null then 'failed' else 'not_started' end,
           access_exception_reason = null, access_exception_by = null, access_exception_at = null
     where id = v_x.id;
  end if;
  perform hr_private.exit_log(v_x.id, 'clearance_item', v_item.status, p_status,
                              v_item.item_key || coalesce(': ' || nullif(btrim(p_note), ''), ''));
end $$;

-- Explicitly authorised, audited exception for a pending mandatory item
-- (exit.override; never for one's own exit). For access revocation this is
-- the controlled path when the revocation service failed: portal data access
-- is still removed when the exit is closed (portal_access=false, roles revoked).
create or replace function public.hr_grant_clearance_exception(p_item uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_item public.hr_exit_clearance_items; v_x public.hr_exits;
begin
  if not hr_private.has_permission('exit.override') then
    perform hr_private.fail('Only holders of the exit override permission can grant clearance exceptions.', 'forbidden');
  end if;
  select * into v_item from public.hr_exit_clearance_items where id = p_item for update;
  if v_item.id is null then perform hr_private.fail('Clearance item not found.', 'not_found'); end if;
  select * into v_x from public.hr_exits where id = v_item.exit_id for update;
  if v_x.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot process your own exit.', 'self_action'); end if;
  if v_x.status not in ('clearance','final_settlement') then
    perform hr_private.fail('Exceptions can only be granted during clearance or final settlement.', 'invalid_state');
  end if;
  if v_item.status <> 'pending' then perform hr_private.fail('Only pending items need an exception.', 'invalid_state'); end if;
  if v_item.item_key = 'asset_return' and exists (select 1 from public.hr_employee_open_assets(v_x.employee_id)) then
    perform hr_private.fail('Assets are still assigned. Record them as returned, lost or written off in Assets first.', 'open_assets');
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    perform hr_private.fail('Explain the exception in detail (at least 10 characters).', 'reason_required');
  end if;
  update public.hr_exit_clearance_items
     set status = 'waived', completed_by = auth.uid(), completed_at = now(),
         exception_reason = btrim(p_reason), exception_by = auth.uid(), exception_at = now()
   where id = v_item.id;
  if v_item.item_key = 'access_revocation' then
    update public.hr_exits set access_revocation_status = 'exception', access_exception_reason = btrim(p_reason),
           access_exception_by = auth.uid(), access_exception_at = now()
     where id = v_x.id;
    insert into public.hr_exit_access_revocations (exit_id, outcome, detail, actor_user_id)
    values (v_x.id, 'exception', btrim(p_reason), auth.uid());
  end if;
  perform hr_private.exit_log(v_x.id, 'clearance_exception', 'pending', 'waived', v_item.item_key || ': ' || btrim(p_reason));
  perform hr_private.audit_event('CLEARANCE_EXCEPTION', 'hr_exit_clearance_items', v_item.id::text,
    jsonb_build_object('exit_id', v_x.id, 'employee_id', v_x.employee_id, 'item_key', v_item.item_key, 'reason', btrim(p_reason)));
  perform hr_private.notify_permission_holders('exit.manage', 'exit_update', 'Clearance exception granted: ' || hr_lifecycle_internal.emp_name(v_x.employee_id),
    replace(v_item.item_key, '_', ' ') || ': ' || btrim(p_reason), '/hr/exits/' || v_x.id, 'hr_exit', v_x.id::text, v_x.employee_id);
end $$;

-- Pre-flight for the access-revocation Edge Function (caller's JWT).
-- Timing follows lifecycle.access_revocation_timing:
--   on_last_working_day (default): on or after the approved last working day
--   from_clearance: any time from the clearance stage.
create or replace function public.hr_can_revoke_exit_access(p_exit uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_x public.hr_exits;
begin
  if not hr_private.any_permission(array['exit.manage','exit.clearance_it']) then
    perform hr_private.fail('You are not allowed to manage exits.', 'forbidden');
  end if;
  select * into v_x from public.hr_exits where id = p_exit;
  if v_x.id is null then perform hr_private.fail('Exit case not found.', 'not_found'); end if;
  if v_x.employee_id = hr_private.current_employee_id() then
    perform hr_private.fail('You cannot process your own exit.', 'self_action');
  end if;
  if v_x.status not in ('clearance','final_settlement','closed') then
    perform hr_private.fail('Access is revoked from the clearance stage onwards.', 'invalid_state');
  end if;
  if hr_lifecycle_internal.lifecycle_setting('access_revocation_timing', 'on_last_working_day') = 'on_last_working_day'
     and v_x.approved_last_working_day is not null and v_x.approved_last_working_day > hr_private.business_today() then
    perform hr_private.fail('Under company policy sign-in access is revoked on or after the last working day ('
      || to_char(v_x.approved_last_working_day, 'DD Mon YYYY') || ').', 'before_last_working_day');
  end if;
  return jsonb_build_object('exit_id', v_x.id, 'employee_id', v_x.employee_id,
                            'user_id', hr_private.employee_user_id(v_x.employee_id));
end $$;

-- Service role only (Edge Function), after the Auth user was banned.
create or replace function public.hr_record_auth_access_revoked(p_exit uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_x public.hr_exits;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    perform hr_private.fail('This operation is reserved for the access revocation service.', 'forbidden');
  end if;
  select * into v_x from public.hr_exits where id = p_exit for update;
  if v_x.id is null then perform hr_private.fail('Exit case not found.', 'not_found'); end if;
  if v_x.status not in ('clearance','final_settlement','closed') then
    perform hr_private.fail('Access is revoked from the clearance stage onwards.', 'invalid_state');
  end if;
  update public.hr_exits set auth_access_revoked_at = coalesce(auth_access_revoked_at, now()),
         access_revocation_status = case when access_revocation_status = 'exception' then 'exception' else 'revoked' end,
         access_revocation_error = null
   where id = v_x.id;
  update public.hr_exit_clearance_items
     set note = 'Sign-in access revoked by the access service at ' || to_char(now() at time zone hr_private.business_timezone(), 'YYYY-MM-DD HH24:MI')
   where exit_id = v_x.id and item_key = 'access_revocation' and status = 'pending';
  insert into public.hr_exit_access_revocations (exit_id, outcome, detail, actor_user_id) values (v_x.id, 'revoked', null, auth.uid());
  perform hr_private.exit_log(v_x.id, 'auth_access_revoked', v_x.status, v_x.status, null);
end $$;

-- Service role only (Edge Function): revocation failed. The exit shows a
-- blocking state; HR retries or an exit.override holder grants an exception.
create or replace function public.hr_record_access_revocation_failure(p_exit uuid, p_error text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_x public.hr_exits;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    perform hr_private.fail('This operation is reserved for the access revocation service.', 'forbidden');
  end if;
  select * into v_x from public.hr_exits where id = p_exit for update;
  if v_x.id is null then perform hr_private.fail('Exit case not found.', 'not_found'); end if;
  update public.hr_exits set access_revocation_status = 'failed', access_revocation_error = left(coalesce(p_error, 'Unknown error'), 1000)
   where id = v_x.id and auth_access_revoked_at is null;
  insert into public.hr_exit_access_revocations (exit_id, outcome, detail) values (v_x.id, 'failed', left(coalesce(p_error, 'Unknown error'), 2000));
  perform hr_private.exit_log(v_x.id, 'auth_access_revocation_failed', v_x.status, v_x.status, left(coalesce(p_error, 'Unknown error'), 500));
  perform hr_private.notify_permission_holders('exit.manage', 'exit_update', 'Access revocation failed: ' || hr_lifecycle_internal.emp_name(v_x.employee_id),
    'Retry the revocation or record an authorised exception.', '/hr/exits/' || v_x.id, 'hr_exit', v_x.id::text, v_x.employee_id);
end $$;

-- =====================================================================
-- FULL & FINAL SETTLEMENT
-- =====================================================================
create or replace function public.hr_prepare_settlement(p_exit uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_x public.hr_exits; v_e public.hr_employees; v_id uuid; v_rate numeric; v_last_end date; v_from date; v_to date;
        v_days int; v_cur text; v_short int; r record; v_ord int := 0; v_year int;
begin
  if not hr_private.has_permission('payroll.manage') then
    perform hr_private.fail('You are not allowed to prepare settlements.', 'forbidden');
  end if;
  select * into v_x from public.hr_exits where id = p_exit for update;
  if v_x.id is null then perform hr_private.fail('Exit case not found.', 'not_found'); end if;
  if v_x.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot prepare your own settlement.', 'self_action'); end if;
  if v_x.status not in ('clearance','final_settlement') then
    perform hr_private.fail('Settlements are prepared once the exit is in clearance or final settlement.', 'invalid_state');
  end if;
  if exists (select 1 from public.hr_payroll_settlements where exit_id = v_x.id and status <> 'cancelled') then
    perform hr_private.fail('A settlement already exists for this exit.', 'settlement_exists');
  end if;
  select * into v_e from public.hr_employees where id = v_x.employee_id;
  v_to := v_x.approved_last_working_day;
  v_cur := coalesce((select s.currency from public.hr_salary_structures s where s.employee_id = v_e.id and s.status = 'active'
                      order by s.effective_from desc limit 1),
                    hr_private.setting('payroll') ->> 'currency', 'INR');
  insert into public.hr_payroll_settlements (exit_id, employee_id, last_working_day, currency, prepared_by, editors)
  values (v_x.id, v_e.id, v_to, v_cur, auth.uid(), array[auth.uid()])
  returning id into v_id;

  v_rate := hr_lifecycle_internal.settlement_daily_rate(v_e.id);
  -- 1. Salary for working days after the last finalized payroll period.
  select max(r2.period_end) into v_last_end from public.hr_payroll_items i join public.hr_payroll_runs r2 on r2.id = i.run_id
   where i.employee_id = v_e.id and r2.status in ('finalized','paid');
  v_from := greatest(coalesce(v_last_end + 1, v_e.joining_date, v_to), coalesce(v_e.joining_date, v_to));
  if v_to is not null and v_from <= v_to then
    select count(*) into v_days from generate_series(v_from, v_to, interval '1 day') d
     where extract(isodow from d)::smallint = any (hr_private.employee_working_days(v_e.id));
    v_ord := v_ord + 1;
    insert into public.hr_payroll_settlement_lines (settlement_id, line_type, label, quantity, rate, amount, note, sort_order, created_by)
    values (v_id, 'salary_due', 'Salary ' || to_char(v_from, 'DD Mon') || ' – ' || to_char(v_to, 'DD Mon YYYY'), v_days, v_rate,
            case when v_rate is null then 0 else round(v_days * v_rate, 2) end,
            case when v_rate is null then 'No finalized payroll found to derive a daily rate; enter the amount.'
                 else 'Working days × daily rate from the last finalized payslip. Review before submitting.' end, v_ord, auth.uid());
  end if;
  -- 2. Finalized but unpaid payroll.
  for r in select i.net, r2.period_start, r2.period_end, i.id from public.hr_payroll_items i join public.hr_payroll_runs r2 on r2.id = i.run_id
           where i.employee_id = v_e.id and r2.status = 'finalized' order by r2.period_end loop
    v_ord := v_ord + 1;
    insert into public.hr_payroll_settlement_lines (settlement_id, line_type, label, amount, source_ref, note, sort_order, created_by)
    values (v_id, 'unpaid_salary', 'Unpaid payroll ' || to_char(r.period_start, 'Mon YYYY'), greatest(r.net, 0), 'payroll_item:' || r.id,
            'Finalized payroll not yet marked paid.', v_ord, auth.uid());
  end loop;
  -- 3. Approved reimbursements not yet paid through payroll.
  for r in select id, category, amount, claim_date from public.hr_reimbursements
           where employee_id = v_e.id and status = 'approved' and payroll_run_id is null order by claim_date loop
    v_ord := v_ord + 1;
    insert into public.hr_payroll_settlement_lines (settlement_id, line_type, label, amount, source_ref, sort_order, created_by)
    values (v_id, 'reimbursement', 'Reimbursement: ' || r.category || ' (' || to_char(r.claim_date, 'DD Mon YYYY') || ')', r.amount,
            'reimbursement:' || r.id, v_ord, auth.uid());
  end loop;
  -- 4. Leave balances (encashment only where company policy allows: amount left at 0).
  v_year := extract(year from coalesce(v_to, hr_private.business_today()))::int;
  for r in select t.name, b.available from public.hr_leave_balances b join public.hr_leave_types t on t.id = b.leave_type_id
           where b.employee_id = v_e.id and b.year = v_year and t.paid and b.available > 0 order by t.sort_order loop
    v_ord := v_ord + 1;
    insert into public.hr_payroll_settlement_lines (settlement_id, line_type, label, quantity, rate, amount, note, sort_order, created_by)
    values (v_id, 'leave_encashment', 'Leave balance: ' || r.name, r.available, v_rate, 0,
            'Set the amount only if your leave policy allows encashment of this leave type.', v_ord, auth.uid());
  end loop;
  -- 5. Notice period shortfall (recovery only where company policy requires it: amount left at 0).
  if v_x.resignation_date is not null and v_x.notice_period_days is not null and v_to is not null then
    v_short := v_x.notice_period_days - (v_to - v_x.resignation_date);
    if v_short > 0 then
      v_ord := v_ord + 1;
      insert into public.hr_payroll_settlement_lines (settlement_id, line_type, label, quantity, rate, amount, note, sort_order, created_by)
      values (v_id, 'notice_recovery', 'Notice period shortfall', v_short, v_rate, 0,
              'Notice served is ' || v_short || ' day(s) short. Set the amount only if your notice policy requires recovery.', v_ord, auth.uid());
    end if;
  end if;
  perform hr_lifecycle_internal.settlement_recalc(v_id);
  perform hr_private.exit_log(v_x.id, 'settlement_prepared', v_x.status, v_x.status, null);
  return v_id;
end $$;

create or replace function hr_lifecycle_internal.settlement_lock_draft(p_settlement uuid)
returns public.hr_payroll_settlements language plpgsql security definer set search_path = '' as $$
declare v_s public.hr_payroll_settlements;
begin
  if not hr_private.has_permission('payroll.manage') then
    perform hr_private.fail('You are not allowed to edit settlements.', 'forbidden');
  end if;
  select * into v_s from public.hr_payroll_settlements where id = p_settlement for update;
  if v_s.id is null then perform hr_private.fail('Settlement not found.', 'not_found'); end if;
  if v_s.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot edit your own settlement.', 'self_action'); end if;
  if v_s.status <> 'draft' then perform hr_private.fail('Only draft settlements can be edited. Ask the approver to return it.', 'invalid_state'); end if;
  return v_s;
end $$;

create or replace function public.hr_save_settlement_line(
  p_settlement uuid, p_line uuid, p_line_type text, p_label text, p_amount numeric,
  p_quantity numeric default null, p_rate numeric default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_s public.hr_payroll_settlements; v_id uuid := p_line;
begin
  v_s := hr_lifecycle_internal.settlement_lock_draft(p_settlement);
  if p_line_type is null or p_line_type not in ('salary_due','unpaid_salary','leave_encashment','reimbursement','notice_pay','bonus',
       'other_earning','notice_recovery','asset_recovery','advance_recovery','other_deduction') then
    perform hr_private.fail('Unknown settlement line type.', 'invalid');
  end if;
  if length(btrim(coalesce(p_label, ''))) < 2 then perform hr_private.fail('Enter a label for the line.', 'invalid'); end if;
  if p_amount is null or p_amount < 0 or p_amount > 100000000 then
    perform hr_private.fail('Enter an amount of zero or more (deductions are entered as positive amounts).', 'invalid');
  end if;
  if p_line is null then
    insert into public.hr_payroll_settlement_lines (settlement_id, line_type, label, quantity, rate, amount, note, sort_order, created_by)
    values (v_s.id, p_line_type, btrim(p_label), p_quantity, p_rate, round(p_amount, 2), nullif(btrim(p_note), ''),
            coalesce((select max(sort_order) + 1 from public.hr_payroll_settlement_lines where settlement_id = v_s.id), 1), auth.uid())
    returning id into v_id;
  else
    update public.hr_payroll_settlement_lines
       set line_type = p_line_type, label = btrim(p_label), quantity = p_quantity, rate = p_rate, amount = round(p_amount, 2),
           note = nullif(btrim(p_note), '')
     where id = p_line and settlement_id = v_s.id;
    if not found then perform hr_private.fail('Settlement line not found.', 'not_found'); end if;
  end if;
  update public.hr_payroll_settlements set editors = case when auth.uid() = any (editors) then editors else editors || auth.uid() end
   where id = v_s.id;
  perform hr_lifecycle_internal.settlement_recalc(v_s.id);
  return v_id;
end $$;

create or replace function public.hr_delete_settlement_line(p_line uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_sid uuid; v_s public.hr_payroll_settlements;
begin
  select settlement_id into v_sid from public.hr_payroll_settlement_lines where id = p_line;
  if v_sid is null then perform hr_private.fail('Settlement line not found.', 'not_found'); end if;
  v_s := hr_lifecycle_internal.settlement_lock_draft(v_sid);
  delete from public.hr_payroll_settlement_lines where id = p_line;
  update public.hr_payroll_settlements set editors = case when auth.uid() = any (editors) then editors else editors || auth.uid() end
   where id = v_s.id;
  perform hr_lifecycle_internal.settlement_recalc(v_s.id);
end $$;

create or replace function public.hr_submit_settlement(p_settlement uuid, p_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_s public.hr_payroll_settlements;
begin
  v_s := hr_lifecycle_internal.settlement_lock_draft(p_settlement);
  if not exists (select 1 from public.hr_payroll_settlement_lines where settlement_id = v_s.id) then
    perform hr_private.fail('Add at least one settlement line before submitting.', 'invalid');
  end if;
  perform hr_lifecycle_internal.settlement_recalc(v_s.id);
  update public.hr_payroll_settlements set status = 'submitted', submitted_by = auth.uid(), submitted_at = now(), returned_reason = null,
         notes = coalesce(nullif(btrim(p_notes), ''), notes)
   where id = v_s.id;
  perform hr_private.exit_log(v_s.exit_id, 'settlement_submitted', null, null, null);
  perform hr_private.notify_permission_holders('payroll.approve', 'payroll.settlement_submitted', 'Final settlement to approve: ' || hr_lifecycle_internal.emp_name(v_s.employee_id),
    null, '/hr/onboarding-exit/settlement/' || v_s.id, 'hr_payroll_settlement', v_s.id::text, v_s.employee_id);
end $$;

-- Approval by a different payroll.approve holder (not the preparer, the
-- submitter, any editor, or the leaver). Approval completes the exit's
-- final_settlement clearance item. Return sends it back to draft.
create or replace function public.hr_approve_settlement(p_settlement uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_s public.hr_payroll_settlements;
begin
  if not hr_private.has_permission('payroll.approve') then
    perform hr_private.fail('You are not allowed to approve settlements.', 'forbidden');
  end if;
  select * into v_s from public.hr_payroll_settlements where id = p_settlement for update;
  if v_s.id is null then perform hr_private.fail('Settlement not found.', 'not_found'); end if;
  if v_s.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot approve your own settlement.', 'self_action'); end if;
  if v_s.status <> 'submitted' then perform hr_private.fail('Only submitted settlements can be approved or returned.', 'invalid_state'); end if;
  if p_approve is null then perform hr_private.fail('Choose approve or return.', 'invalid'); end if;
  if p_approve and (auth.uid() = v_s.prepared_by or auth.uid() = v_s.submitted_by or auth.uid() = any (v_s.editors)) then
    perform hr_private.fail('A settlement must be approved by a different person than the one who prepared or edited it.', 'separation_of_duties');
  end if;
  if p_approve then
    update public.hr_payroll_settlements set status = 'approved', approved_by = auth.uid(), approved_at = now(),
           approval_note = nullif(btrim(p_note), '')
     where id = v_s.id;
    update public.hr_exit_clearance_items
       set status = 'completed', completed_by = auth.uid(), completed_at = now(),
           note = 'Full and final settlement approved by payroll ' || to_char(now() at time zone hr_private.business_timezone(), 'YYYY-MM-DD')
     where exit_id = v_s.exit_id and item_key = 'final_settlement' and status = 'pending';
    perform hr_private.exit_log(v_s.exit_id, 'settlement_approved', null, null, null);
    perform hr_private.notify_employee(v_s.employee_id, 'exit_update', 'Your final settlement is approved',
      'The settlement statement is available in the Employee Portal.', '/employee/resignation', 'hr_payroll_settlement', v_s.id::text);
  else
    if length(btrim(coalesce(p_note, ''))) < 3 then perform hr_private.fail('Explain what needs to change.', 'reason_required'); end if;
    update public.hr_payroll_settlements set status = 'draft', returned_reason = btrim(p_note), submitted_by = null, submitted_at = null
     where id = v_s.id;
    perform hr_private.exit_log(v_s.exit_id, 'settlement_returned', null, null, null);
    perform hr_private.notify_user(v_s.prepared_by, 'payroll.settlement_returned', 'Final settlement returned for changes', btrim(p_note),
      '/hr/onboarding-exit/settlement/' || v_s.id, 'hr_payroll_settlement', v_s.id::text);
  end if;
end $$;

-- Records a payment made outside the system. NEVER initiates a transfer.
create or replace function public.hr_mark_settlement_paid(p_settlement uuid, p_reference text, p_paid_on date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_s public.hr_payroll_settlements;
begin
  if not hr_private.has_permission('payroll.approve') then
    perform hr_private.fail('You are not allowed to record settlement payments.', 'forbidden');
  end if;
  select * into v_s from public.hr_payroll_settlements where id = p_settlement for update;
  if v_s.id is null then perform hr_private.fail('Settlement not found.', 'not_found'); end if;
  if v_s.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot record your own settlement payment.', 'self_action'); end if;
  if v_s.status <> 'approved' then perform hr_private.fail('Only approved settlements can be marked as paid.', 'invalid_state'); end if;
  if length(btrim(coalesce(p_reference, ''))) < 3 then perform hr_private.fail('Enter the bank / payment reference.', 'reference_required'); end if;
  if p_paid_on is not null and p_paid_on > hr_private.business_today() then perform hr_private.fail('The payment date cannot be in the future.', 'invalid_date'); end if;
  update public.hr_payroll_settlements set status = 'paid', paid_by = auth.uid(), paid_at = now(),
         paid_on = coalesce(p_paid_on, hr_private.business_today()), payment_reference = btrim(p_reference)
   where id = v_s.id;
  update public.hr_reimbursements r set status = 'paid'
    from public.hr_payroll_settlement_lines l
   where l.settlement_id = v_s.id and l.line_type = 'reimbursement' and l.source_ref = 'reimbursement:' || r.id::text
     and r.status = 'approved' and r.employee_id = v_s.employee_id;
  perform hr_private.exit_log(v_s.exit_id, 'settlement_paid', null, null, null);
  perform hr_private.notify_employee(v_s.employee_id, 'exit_update', 'Final settlement paid',
    'Payment reference: ' || btrim(p_reference), '/employee/resignation', 'hr_payroll_settlement', v_s.id::text);
end $$;

create or replace function public.hr_cancel_settlement(p_settlement uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_s public.hr_payroll_settlements;
begin
  if not hr_private.has_permission('payroll.manage') then perform hr_private.fail('You are not allowed to cancel settlements.', 'forbidden'); end if;
  select * into v_s from public.hr_payroll_settlements where id = p_settlement for update;
  if v_s.id is null then perform hr_private.fail('Settlement not found.', 'not_found'); end if;
  if v_s.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot cancel your own settlement.', 'self_action'); end if;
  if v_s.status not in ('draft','submitted') then perform hr_private.fail('Approved or paid settlements cannot be cancelled.', 'invalid_state'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then perform hr_private.fail('Record why the settlement is cancelled.', 'reason_required'); end if;
  update public.hr_payroll_settlements set status = 'cancelled', cancelled_reason = btrim(p_reason) where id = v_s.id;
  perform hr_private.exit_log(v_s.exit_id, 'settlement_cancelled', null, null, btrim(p_reason));
end $$;

-- Statement for the statement/PDF view: payroll.view, or the employee for
-- their own approved/paid settlement.
create or replace function public.hr_settlement_statement(p_settlement uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_s public.hr_payroll_settlements; v_e public.hr_employees; v_x public.hr_exits;
begin
  select * into v_s from public.hr_payroll_settlements where id = p_settlement;
  if v_s.id is null or not (hr_private.has_permission('payroll.view')
                           or (v_s.employee_id = hr_private.current_employee_id() and v_s.status in ('approved','paid'))) then
    perform hr_private.fail('Settlement not found.', 'not_found');
  end if;
  select * into v_e from public.hr_employees where id = v_s.employee_id;
  select * into v_x from public.hr_exits where id = v_s.exit_id;
  return jsonb_build_object(
    'id', v_s.id, 'status', v_s.status, 'currency', v_s.currency,
    'employee', jsonb_build_object('name', hr_lifecycle_internal.emp_name(v_e.id), 'employee_code', v_e.employee_code,
                                   'department', (select name from public.hr_departments where id = v_e.department_id),
                                   'designation', (select name from public.hr_designations where id = v_e.designation_id),
                                   'joining_date', v_e.joining_date),
    'exit', jsonb_build_object('exit_type', v_x.exit_type, 'resignation_date', v_x.resignation_date,
                               'last_working_day', v_x.approved_last_working_day),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('line_type', l.line_type, 'label', l.label, 'quantity', l.quantity, 'rate', l.rate,
                                                           'amount', l.amount, 'earning', hr_lifecycle_internal.settlement_is_earning(l.line_type))
                                        order by l.sort_order) from public.hr_payroll_settlement_lines l where l.settlement_id = v_s.id), '[]'::jsonb),
    'total_earnings', v_s.total_earnings, 'total_deductions', v_s.total_deductions, 'net_amount', v_s.net_amount,
    'approved_at', v_s.approved_at, 'paid_on', v_s.paid_on, 'payment_reference', case when v_s.status = 'paid' then v_s.payment_reference end,
    'generated_at', now());
end $$;

-- Settlement progress for HR (exit.manage / exit.view) without amounts.
create or replace function public.hr_exit_settlement_status(p_exit uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (hr_private.exit_can_view_id(p_exit) or hr_private.has_permission('payroll.view')) then
    perform hr_private.fail('Exit case not found.', 'not_found');
  end if;
  return (select jsonb_build_object('id', s.id, 'status', s.status, 'submitted_at', s.submitted_at, 'approved_at', s.approved_at, 'paid_on', s.paid_on)
          from public.hr_payroll_settlements s where s.exit_id = p_exit and s.status <> 'cancelled' limit 1);
end $$;

-- =====================================================================
-- OVERVIEW + EMPLOYEE SELF-SERVICE
-- =====================================================================
create or replace function public.hr_lifecycle_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_today date := hr_private.business_today(); v jsonb := '{}'::jsonb; v_me uuid := hr_private.current_employee_id();
begin
  if hr_private.any_permission(array['onboarding.view','onboarding.manage','onboarding.view_team']) then
    v := v || jsonb_build_object(
      'onboarding_open', (select count(*) from public.hr_onboarding_cases c where c.status = 'open' and hr_private.onboarding_can_view(c.employee_id, c.hr_coordinator_id)),
      'joining_next_7_days', (select count(*) from public.hr_onboarding_cases c where c.status = 'open' and c.joining_status in ('awaiting_joining','deferred')
                                and c.joining_date between v_today and v_today + 7 and hr_private.onboarding_can_view(c.employee_id, c.hr_coordinator_id)),
      'onboarding_tasks_overdue', (select count(*) from public.hr_onboarding_tasks t join public.hr_onboarding_cases c on c.id = t.case_id
                                     where c.status = 'open' and t.status in ('pending','in_progress') and t.due_date < v_today
                                       and hr_private.onboarding_can_view(c.employee_id, c.hr_coordinator_id)),
      'induction_open', (select count(*) from public.hr_onboarding_tasks t join public.hr_onboarding_cases c on c.id = t.case_id
                           where c.status = 'open' and t.status in ('pending','in_progress')
                             and t.category in ('orientation','policy','induction','it_setup','equipment','compliance')
                             and hr_private.onboarding_can_view(c.employee_id, c.hr_coordinator_id)));
  end if;
  if hr_private.any_permission(array['onboarding.view','onboarding.manage']) and hr_private.any_permission(array['documents.view','documents.manage']) then
    v := v || jsonb_build_object('documents_pending_verification',
      (select count(*) from public.hr_documents d join public.hr_onboarding_cases c on c.employee_id = d.employee_id and c.status = 'open'
       where d.archived_at is null and d.verification_status = 'pending' and d.employee_id is distinct from v_me));
  end if;
  if hr_private.any_permission(array['probation.view','probation.decide','probation.view_team','probation.review_team']) then
    v := v || jsonb_build_object(
      'probation_reviews_open', (select count(*) from public.hr_probation_reviews r where r.status in ('pending_manager','pending_hr') and hr_private.probation_can_view(r.employee_id)),
      'probation_reviews_overdue', (select count(*) from public.hr_probation_reviews r where r.status in ('pending_manager','pending_hr') and r.due_date < v_today and hr_private.probation_can_view(r.employee_id)),
      'probation_ending_30_days', (select count(*) from public.hr_employees e where e.status = 'probation' and e.probation_end_date between v_today and v_today + 30 and hr_private.probation_can_view(e.id)));
  end if;
  if hr_private.any_permission(array['exit.view','exit.view_team','exit.manage','exit.approve_team','exit.clearance_it','payroll.manage','payroll.approve']) then
    v := v || jsonb_build_object(
      'resignations_under_review', (select count(*) from public.hr_exits x where x.status in ('submitted','manager_review','hr_review')
                                      and (hr_private.exit_can_view(x.employee_id))),
      'exits_in_clearance', (select count(*) from public.hr_exits x where x.status = 'clearance'
                               and (hr_private.exit_can_view(x.employee_id) or hr_private.any_permission(array['exit.clearance_it','payroll.manage','payroll.approve']))),
      'access_revocation_failed', (select count(*) from public.hr_exits x where x.access_revocation_status = 'failed' and x.status not in ('closed','withdrawn','rejected')
                                     and (hr_private.exit_can_view(x.employee_id) or hr_private.has_permission('exit.clearance_it'))));
  end if;
  if hr_private.has_permission('payroll.view') then
    v := v || jsonb_build_object(
      'settlements_to_prepare', (select count(*) from public.hr_exits x where x.status in ('clearance','final_settlement')
                                   and not exists (select 1 from public.hr_payroll_settlements s where s.exit_id = x.id and s.status <> 'cancelled')),
      'settlements_awaiting_approval', (select count(*) from public.hr_payroll_settlements s where s.status = 'submitted'),
      'settlements_awaiting_payment', (select count(*) from public.hr_payroll_settlements s where s.status = 'approved'));
  end if;
  return v;
end $$;

-- Everything an employee may see about their own lifecycle. Excludes HR
-- notes, evidence notes, internal events, manager feedback, HR comments and
-- settlement amounts before approval.
create or replace function public.hr_my_lifecycle()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := hr_private.current_employee_id(); v_e public.hr_employees; v_c public.hr_onboarding_cases;
        v_x public.hr_exits; v_s public.hr_payroll_settlements; v_r public.hr_probation_reviews; v_policy text; v_can_withdraw boolean := false;
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  select * into v_e from public.hr_employees where id = v_me;
  select * into v_c from public.hr_onboarding_cases where employee_id = v_me and status <> 'cancelled' order by created_at desc limit 1;
  select * into v_x from public.hr_exits where employee_id = v_me order by created_at desc limit 1;
  if v_x.id is not null then
    select * into v_s from public.hr_payroll_settlements where exit_id = v_x.id and status <> 'cancelled' limit 1;
  end if;
  select * into v_r from public.hr_probation_reviews where employee_id = v_me and status = 'decided'
   order by decided_at desc, (review_type = 'extension') desc, created_at desc limit 1;
  v_policy := hr_lifecycle_internal.lifecycle_setting('resignation_withdrawal', 'before_hr_approval');
  if v_x.id is not null and v_x.initiated_by = 'employee' and v_policy <> 'never' then
    v_can_withdraw := v_x.status in ('submitted','manager_review','hr_review') or (v_policy = 'before_clearance' and v_x.status = 'notice_period');
  end if;
  return jsonb_build_object(
    'employee', jsonb_build_object('status', v_e.status, 'joining_date', v_e.joining_date, 'probation_end_date', v_e.probation_end_date,
                                   'confirmation_date', v_e.confirmation_date, 'employment_type', v_e.employment_type),
    'onboarding', case when v_c.id is null then null else jsonb_build_object(
      'id', v_c.id, 'status', v_c.status, 'joining_status', v_c.joining_status, 'joining_date', v_c.joining_date,
      'actual_joining_date', v_c.actual_joining_date, 'completed_at', v_c.completed_at,
      'coordinator', hr_lifecycle_internal.emp_name(v_c.hr_coordinator_id), 'manager', hr_lifecycle_internal.emp_name(v_c.reporting_manager_id),
      'tasks', coalesce((select jsonb_agg(jsonb_build_object(
          'id', t.id, 'title', t.title, 'description', t.description, 'category', t.category, 'kind', t.task_kind,
          'owner_role', t.owner_role, 'due_date', t.due_date, 'mandatory', t.mandatory, 'status', t.status,
          'acknowledged_at', t.acknowledged_at, 'completed_at', t.completed_at,
          'training_status', (select a.status from public.hr_training_assignments a where a.id = t.training_assignment_id))
          order by t.sort_order) from public.hr_onboarding_tasks t where t.case_id = v_c.id and t.visible_to_employee), '[]'::jsonb)) end,
    'missing_documents', hr_lifecycle_internal.onboarding_missing_documents(v_me),
    'probation', jsonb_build_object(
      'in_probation', v_e.status = 'probation', 'probation_end_date', v_e.probation_end_date, 'confirmation_date', v_e.confirmation_date,
      'review_open', exists (select 1 from public.hr_probation_reviews where employee_id = v_me and status in ('pending_manager','pending_hr')),
      'last_decision', case when v_r.id is null then null else jsonb_build_object('decision', v_r.decision, 'effective_date', v_r.effective_date,
                                                                               'extended_to', v_r.extended_to, 'decided_at', v_r.decided_at) end),
    'exit', case when v_x.id is null then null else jsonb_build_object(
      'id', v_x.id, 'status', v_x.status,
      'request_status', case when v_x.status = 'submitted' then 'submitted'
                             when v_x.status in ('manager_review','hr_review') then 'under_review'
                             when v_x.status in ('notice_period','clearance','final_settlement','closed') then 'approved'
                             else v_x.status end,
      'exit_type', v_x.exit_type, 'initiated_by', v_x.initiated_by, 'resignation_date', v_x.resignation_date,
      'reason', case when v_x.initiated_by = 'employee' then v_x.reason end,
      'notice_period_days', v_x.notice_period_days, 'proposed_last_working_day', v_x.proposed_last_working_day,
      'approved_last_working_day', v_x.approved_last_working_day,
      'manager_decision', v_x.manager_decision, 'manager_note', v_x.manager_note,
      'hr_decision', v_x.hr_decision, 'hr_note', case when v_x.status = 'rejected' then v_x.hr_note end,
      'can_withdraw', v_can_withdraw, 'withdrawal_policy', v_policy,
      'relieving_letter_issued_at', v_x.relieving_letter_issued_at, 'experience_letter_issued_at', v_x.experience_letter_issued_at,
      'closed_at', v_x.closed_at,
      'clearance', coalesce((select jsonb_agg(jsonb_build_object('item_key', i.item_key, 'department', i.department, 'status', i.status,
                                                               'due_date', i.due_date, 'completed_at', i.completed_at) order by i.sort_order)
                             from public.hr_exit_clearance_items i where i.exit_id = v_x.id), '[]'::jsonb),
      'open_assets', (select count(*) from public.hr_asset_assignments a where a.employee_id = v_me and a.returned_at is null)) end,
    'settlement', case when v_s.id is null then null else jsonb_build_object(
      'id', v_s.id, 'status', case when v_s.status in ('draft','submitted') then 'in_preparation' else v_s.status end,
      'currency', v_s.currency,
      'net_amount', case when v_s.status in ('approved','paid') then v_s.net_amount end,
      'approved_at', case when v_s.status in ('approved','paid') then v_s.approved_at end,
      'paid_on', v_s.paid_on) end);
end $$;

-- =====================================================================
-- Grants
-- =====================================================================
-- No blanket grant on hr_private here: the default privileges from 100
-- already let authenticated call the RLS visibility checks defined above.
revoke execute on function hr_private.onboarding_can_view(uuid, uuid), hr_private.onboarding_can_view_case(uuid),
  hr_private.onboarding_require_manage(), hr_private.probation_can_view(uuid), hr_private.clearance_can_act(text, uuid)
from anon, public;
revoke execute on all functions in schema hr_lifecycle_internal from public, anon, authenticated;
-- Exit helpers from 110 (event log + notifications) must not be callable
-- directly; re-applied here because later blanket grants re-exposed them.
revoke execute on function hr_private.exit_log(uuid, text, text, text, text), hr_private.exit_notify(uuid, text, text, boolean)
from authenticated;

do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = any (array[
             'hr_create_onboarding_case','hr_update_onboarding_case','hr_set_joining_status','hr_add_onboarding_task',
             'hr_assign_onboarding_task','hr_link_onboarding_task','hr_complete_onboarding_task','hr_reopen_onboarding_task',
             'hr_waive_onboarding_task','hr_acknowledge_onboarding_task','hr_complete_onboarding','hr_cancel_onboarding',
             'hr_onboarding_document_queue','hr_open_probation_review','hr_generate_probation_reviews','hr_submit_probation_feedback',
             'hr_decide_probation','hr_cancel_probation_review','hr_withdraw_resignation','hr_start_exit_clearance',
             'hr_complete_clearance_item','hr_grant_clearance_exception','hr_can_revoke_exit_access','hr_prepare_settlement',
             'hr_save_settlement_line','hr_delete_settlement_line','hr_submit_settlement','hr_approve_settlement',
             'hr_mark_settlement_paid','hr_cancel_settlement','hr_settlement_statement','hr_exit_settlement_status',
             'hr_lifecycle_overview','hr_my_lifecycle'])
  loop
    execute format('revoke execute on function %s from anon, public', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

revoke execute on function public.hr_record_auth_access_revoked(uuid) from anon, public, authenticated;
grant execute on function public.hr_record_auth_access_revoked(uuid) to service_role;
revoke execute on function public.hr_record_access_revocation_failure(uuid, text) from anon, public, authenticated;
grant execute on function public.hr_record_access_revocation_failure(uuid, text) to service_role;
