-- =====================================================================
-- 180_hr_requests_approvals.sql — Module 10: HR Requests & Approvals
-- =====================================================================
-- Extends 111_hr_requests.sql (the single HR request system). Nothing here
-- creates a second request, attendance-correction, reimbursement, payroll
-- or document engine:
--
--   * hr_requests stays the one request record. A request now has a
--     `workflow` (helpdesk | hr_letter | profile_change | reimbursement |
--     salary_advance), validated structured `details`, and optional
--     sequential approval stages (hr_request_approvals) configured per
--     category (manager / hr / payroll / finance).
--   * Attendance corrections are NOT copied: hr_attendance_corrections
--     (101, extended by Module 5 in 125) stays authoritative. The approval
--     inbox lists them and the UI decides them through
--     hr_decide_attendance_correction() (Module 5's RPC).
--   * Reimbursement claims are approved here (manager -> finance); on final
--     approval exactly one row is written to hr_reimbursements (Module 7)
--     with status 'approved', so the existing payroll run pays it. Payment
--     status is never set here: it follows the payroll run (paid only when a
--     payroll.approve holder marks the run paid with a bank reference).
--   * HR letters are issued by linking an hr_documents record (Module 9,
--     e.g. generated with hr_issue_document_letter). Salary certificates are
--     issued only by compensation-authorised users (hr_requests.payroll +
--     payroll.view, or documents.compensation from Module 9 / 129) either as
--     a compensation-restricted document (includes_compensation, 129) or as
--     a restricted request file. A plain hr_documents record is refused for
--     salary certificates because it is readable by every documents.view holder.
--   * Approved profile changes are applied to the authoritative columns
--     (hr_employee_private, hr_employees.display_name, and for bank details
--     hr_employee_bank_accounts). Nothing is applied before approval.
--   * Salary advances (new, Module 10): configurable policy, disabled by
--     default. No funds are disbursed and nothing is deducted from payroll
--     automatically. Disbursement and repayments are recorded by Finance
--     with a reference; disbursement needs a second Finance user to verify.
--
-- Security fixes in this migration:
--   * X7: migrations 113-120 (and 125/130 in other modules) run
--     `grant execute on all functions in schema hr_private to authenticated`,
--     which re-granted the write-capable helpers 111 had revoked
--     (request_notify_staff, request_staff_users). They are moved to a new
--     schema `hr_internal` on which API roles have NO usage, so no later
--     blanket hr_private grant can expose them again, and the hr_private
--     copies are dropped. Every new write helper also lives in hr_internal.
--   * HR11: payroll-routed requests were invisible to payroll admins (who
--     hold no hr_requests.* permission). New scoped permissions
--     hr_requests.payroll / hr_requests.finance / hr_requests.approve_team
--     give routed visibility and actions WITHOUT hr_requests.manage.
--
-- Depends on: 100, 101, 102 (projects), 103 (notify_permission_holders),
--             105 (payroll), 107 (documents), 111, 113, 116.
-- Optional:   125 (Module 5 regularization columns), 129 (Module 9
--             includes_compensation / documents.compensation) — both read
--             dynamically, so this file works with or without them.
-- Ordering: the helper lockdown does not depend on running last (hr_internal
-- has no API usage, so later blanket hr_private grants cannot expose it).
-- Apply ONLY to the local test cluster or the isolated dev project.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Internal schema (not reachable by API roles)
-- ---------------------------------------------------------------------
create schema if not exists hr_internal;
revoke all on schema hr_internal from public;
revoke all on schema hr_internal from anon;
revoke all on schema hr_internal from authenticated;
alter default privileges in schema hr_internal revoke execute on functions from public;

-- ---------------------------------------------------------------------
-- 1. Permissions (scoped request handling — no unrestricted HR access)
-- ---------------------------------------------------------------------
insert into public.hr_permissions (key, module, action, description) values
  ('hr_requests.approve_team', 'hr_requests', 'approve_team', 'Manager-stage approval of requests assigned to you (your reports)'),
  ('hr_requests.payroll',      'hr_requests', 'payroll',      'Handle requests routed to payroll: payroll queries, salary advances, bank detail changes, salary certificates'),
  ('hr_requests.finance',      'hr_requests', 'finance',      'Finance-stage approval of reimbursements and salary advances; record and verify advance payments')
on conflict (key) do nothing;

insert into public.hr_role_permissions (role_key, permission_key) values
  ('super_admin',   'hr_requests.approve_team'),
  ('super_admin',   'hr_requests.payroll'),
  ('super_admin',   'hr_requests.finance'),
  ('manager',       'hr_requests.approve_team'),
  ('payroll_admin', 'hr_requests.payroll'),
  ('payroll_admin', 'hr_requests.finance')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 2. Settings
-- ---------------------------------------------------------------------
insert into public.hr_settings (key, value, description) values
  ('salary_advances', jsonb_build_object(
      'enabled', false,                      -- stays off until company policy is approved
      'max_percent_of_monthly_ctc', 50,      -- cap = monthly CTC (annual / 12) x percent
      'max_amount', null,                    -- optional absolute cap
      'min_service_months', 6,
      'max_open_advances', 1,
      'min_repayment_months', 1,
      'max_repayment_months', 6,
      'allow_payroll_deduction', false),     -- Module 7 integration not enabled: repayments are recorded manually
   'Salary advances: policy switch, limits, eligibility and repayment rules. Nothing is disbursed or deducted automatically.')
on conflict (key) do nothing;

update public.hr_settings set value = jsonb_build_object(
    'reopen_window_days', 7,
    'distinct_stage_approvers', true,         -- one person cannot approve two stages of the same request
    'reimbursement_max_age_days', 90,
    'reimbursement_currencies', jsonb_build_array(coalesce((select s.value ->> 'currency' from public.hr_settings s where s.key = 'company'), 'INR')),
    'attendance_correction_sla_hours', 48
  ) || value
where key = 'hr_requests';

-- ---------------------------------------------------------------------
-- 3. Categories: workflow + approval routing
-- ---------------------------------------------------------------------
alter table public.hr_request_categories
  add column workflow text not null default 'helpdesk'
    check (workflow in ('helpdesk','hr_letter','profile_change','reimbursement','salary_advance')),
  add column approval_stages text[] not null default '{}'::text[]
    check (approval_stages <@ array['manager','hr','payroll','finance']::text[] and cardinality(approval_stages) <= 4),
  add column requires_attachment boolean not null default false;
alter table public.hr_request_categories add constraint hr_request_categories_routing check (
  (workflow = 'helpdesk' and cardinality(approval_stages) = 0)
  or (workflow <> 'helpdesk' and cardinality(approval_stages) >= 1));

update public.hr_request_categories
   set workflow = 'hr_letter', approval_stages = array['hr'], name = 'HR letter request',
       description = 'Employment certificate, experience letter, salary certificate, address confirmation or another HR letter'
 where code = 'document_request';
update public.hr_request_categories
   set workflow = 'profile_change', approval_stages = array['hr'],
       description = 'Change your phone, address, emergency contact, personal email or bank details (reviewed before it is applied)'
 where code = 'profile_update';
update public.hr_request_categories
   set workflow = 'salary_advance', approval_stages = array['manager','payroll'],
       name = 'Salary advance', description = 'Salary advance under the company policy (when enabled)'
 where code = 'loan_advance';
insert into public.hr_request_categories (code, name, description, default_assignee_role, sla_hours, is_confidential, active, sort_order,
                                          workflow, approval_stages, requires_attachment) values
  ('reimbursement', 'Reimbursement claim', 'Business expense claim with receipt (manager, then finance approval)', 'payroll_admin', 120, false, true, 13,
   'reimbursement', array['manager','finance'], true)
on conflict (code) do nothing;

create or replace function hr_internal.request_category_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.workflow is distinct from old.workflow
     and exists (select 1 from public.hr_requests r where r.category_id = old.id) then
    perform hr_private.fail('The workflow of a category that already has requests cannot be changed. Create a new category instead.', 'invalid');
  end if;
  if (select count(distinct s) from unnest(new.approval_stages) s) <> cardinality(new.approval_stages) then
    perform hr_private.fail('Each approval stage can be used only once per category.', 'invalid_stages');
  end if;
  if new.workflow in ('reimbursement','salary_advance')
     and new.approval_stages[cardinality(new.approval_stages)] not in ('payroll','finance') then
    perform hr_private.fail('Money requests must end with a Payroll or Finance approval stage.', 'invalid_stages');
  end if;
  if new.workflow in ('hr_letter','profile_change') and not ('hr' = any (new.approval_stages)) then
    perform hr_private.fail('Letters and profile changes need an HR approval stage.', 'invalid_stages');
  end if;
  return new;
end $$;
create trigger hr_request_categories_guard before insert or update on public.hr_request_categories
  for each row execute function hr_internal.request_category_guard();

-- ---------------------------------------------------------------------
-- 4. Requests: workflow columns and statuses
-- ---------------------------------------------------------------------
alter table public.hr_requests drop constraint hr_requests_status_check;
alter table public.hr_requests add constraint hr_requests_status_check check (status in (
  'draft','open','in_progress','waiting_on_employee','pending_approval','returned','approved','rejected',
  'resolved','completed','closed','cancelled'));
alter table public.hr_requests
  add column workflow text not null default 'helpdesk'
    check (workflow in ('helpdesk','hr_letter','profile_change','reimbursement','salary_advance')),
  add column details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object' and pg_column_size(details) <= 32768),
  add column approval_round smallint not null default 0 check (approval_round >= 0),
  add column submitted_at timestamptz,
  add column decided_at timestamptz,
  add column completed_at timestamptz,
  add column linked_entity_type text check (linked_entity_type is null or linked_entity_type in ('hr_reimbursements')),
  add column linked_entity_id uuid,
  add column issued_document_id uuid references public.hr_documents(id) on delete restrict,
  add column issued_attachment_id uuid;
alter table public.hr_requests add constraint hr_requests_workflow_status check (
  (workflow = 'helpdesk' and status in ('open','in_progress','waiting_on_employee','resolved','closed','cancelled'))
  or (workflow <> 'helpdesk' and status in ('draft','pending_approval','returned','approved','rejected','completed','cancelled')));
create index hr_requests_workflow on public.hr_requests(workflow, status);
create unique index hr_requests_linked on public.hr_requests(linked_entity_type, linked_entity_id) where linked_entity_id is not null;
-- Duplicate expense claims: same employee, date, category, amount and currency while active.
create unique index hr_requests_reimbursement_dedupe on public.hr_requests (
  employee_id, (details ->> 'expense_date'), (details ->> 'category'), (details ->> 'amount'), (details ->> 'currency'))
  where workflow = 'reimbursement' and status in ('pending_approval','returned','approved','completed');
-- Requests carry personal / financial detail: keep it out of the audit log.
select hr_private.enable_audit('public.hr_requests', array['description','resolution','details']);

-- ---------------------------------------------------------------------
-- 5. Approval stages, events, sensitive values, attachments
-- ---------------------------------------------------------------------
create table public.hr_request_approvals (
  id                     uuid primary key default gen_random_uuid(),
  request_id             uuid not null references public.hr_requests(id) on delete restrict,
  round                  smallint not null check (round >= 1),
  stage_no               smallint not null check (stage_no between 1 and 4),
  stage_role             text not null check (stage_role in ('manager','hr','payroll','finance')),
  status                 text not null default 'waiting' check (status in ('waiting','pending','approved','rejected','returned','cancelled')),
  approver_employee_id   uuid references public.hr_employees(id) on delete set null,   -- designated approver (manager stage)
  delegate_employee_id   uuid references public.hr_employees(id) on delete set null,
  delegated_by           uuid,
  delegated_at           timestamptz,
  delegation_reason      text check (delegation_reason is null or length(delegation_reason) <= 1000),
  activated_at           timestamptz,
  decided_by             uuid,
  decided_by_employee_id uuid references public.hr_employees(id) on delete set null,
  decided_at             timestamptz,
  decision_basis         text check (decision_basis is null or decision_basis in ('designated','delegate','role','hr_override')),
  comment                text check (comment is null or length(comment) <= 2000),
  created_at             timestamptz not null default now(),
  unique (request_id, round, stage_no)
);
-- Exactly one active stage per request: sequential, never parallel.
create unique index hr_request_approvals_one_pending on public.hr_request_approvals(request_id) where status = 'pending';
create index hr_request_approvals_role on public.hr_request_approvals(stage_role, status);
create index hr_request_approvals_approver on public.hr_request_approvals(approver_employee_id, status);
create index hr_request_approvals_delegate on public.hr_request_approvals(delegate_employee_id, status);

create or replace function hr_internal.request_approvals_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then perform hr_private.fail('Approval records cannot be deleted.', 'immutable'); end if;
  if old.status in ('approved','rejected','returned','cancelled')
     and (new.status, new.decided_by, new.decided_at, new.comment, new.decision_basis)
         is distinct from (old.status, old.decided_by, old.decided_at, old.comment, old.decision_basis) then
    perform hr_private.fail('A decided approval step cannot be changed.', 'immutable');
  end if;
  return new;
end $$;
create trigger hr_request_approvals_guard before update or delete on public.hr_request_approvals
  for each row execute function hr_internal.request_approvals_guard();

create table public.hr_request_events (
  id                bigint generated always as identity primary key,
  request_id        uuid not null references public.hr_requests(id) on delete restrict,
  round             smallint,
  action            text not null check (action in (
                      'created','updated','submitted','resubmitted','stage_approved','stage_rejected','stage_returned','delegated',
                      'approved','rejected','returned','cancelled','completed','letter_issued','profile_applied','claim_recorded',
                      'payment_status','agreement_accepted','disbursement_recorded','disbursement_verified','repayment_recorded',
                      'attachment_added','attachment_removed')),
  stage_role        text,
  from_status       text,
  to_status         text,
  note              text check (note is null or length(note) <= 2000),
  actor_user_id     uuid default auth.uid(),
  actor_employee_id uuid references public.hr_employees(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index hr_request_events_request on public.hr_request_events(request_id, created_at);
create or replace function hr_internal.append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform hr_private.fail('History records are append-only.', 'immutable');
  return null;
end $$;
create trigger hr_request_events_append_only before update or delete on public.hr_request_events
  for each row execute function hr_internal.append_only();

-- Proposed / previous personal and bank values of profile-change requests.
-- No API read policy: values are returned only by hr_request_detail(), field
-- by field, to the people allowed to see them.
create table public.hr_request_sensitive (
  request_id uuid primary key references public.hr_requests(id) on delete restrict,
  payload    jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  previous   jsonb,
  updated_at timestamptz not null default now()
);

create table public.hr_request_attachments (
  id                   uuid primary key default gen_random_uuid(),
  request_id           uuid not null references public.hr_requests(id) on delete restrict,
  kind                 text not null check (kind in ('receipt','evidence','supporting','issued_letter','payment_evidence')),
  storage_path         text not null unique,
  file_name            text not null check (length(file_name) between 1 and 160),
  mime_type            text not null check (mime_type in ('application/pdf','image/png','image/jpeg','image/webp')),
  size_bytes           bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  checksum             text check (checksum is null or checksum ~ '^[a-f0-9]{64}$'),
  uploaded_by          uuid,
  uploaded_employee_id uuid references public.hr_employees(id) on delete set null,
  created_at           timestamptz not null default now(),
  removed_at           timestamptz,
  removed_by           uuid
);
create index hr_request_attachments_request on public.hr_request_attachments(request_id);
create index hr_request_attachments_checksum on public.hr_request_attachments(checksum) where checksum is not null and removed_at is null;
alter table public.hr_requests add constraint hr_requests_issued_attachment_fkey
  foreign key (issued_attachment_id) references public.hr_request_attachments(id) on delete restrict;

-- ---------------------------------------------------------------------
-- 6. Salary advances (Module 10) — named hr_salary_* so their audit rows
--    are visible only to auditors who also hold payroll.view.
-- ---------------------------------------------------------------------
create table public.hr_salary_advances (
  id                         uuid primary key default gen_random_uuid(),
  request_id                 uuid not null unique references public.hr_requests(id) on delete restrict,
  employee_id                uuid not null references public.hr_employees(id) on delete restrict,
  currency                   text not null check (currency ~ '^[A-Z]{3}$'),
  amount                     numeric(14,2) not null check (amount > 0 and amount <= 100000000),
  repayment_months           smallint not null check (repayment_months between 1 and 60),
  installment_amount         numeric(14,2) not null check (installment_amount > 0),
  max_permitted              numeric(14,2),            -- policy snapshot at submission
  outstanding_at_request     numeric(14,2) not null default 0,
  status                     text not null default 'pending' check (status in (
                               'pending','returned','approved','agreed','disbursement_recorded','repaying','repaid','rejected','cancelled')),
  first_repayment_month      date check (first_repayment_month is null or extract(day from first_repayment_month) = 1),
  agreement_accepted_at      timestamptz,
  agreement_accepted_by      uuid,
  payroll_deduction_authorized boolean not null default false,
  disbursed_amount           numeric(14,2) check (disbursed_amount is null or disbursed_amount > 0),
  disbursement_reference     text check (disbursement_reference is null or length(btrim(disbursement_reference)) between 3 and 120),
  disbursed_on               date,
  disbursement_attachment_id uuid references public.hr_request_attachments(id) on delete restrict,
  disbursement_recorded_by   uuid,
  disbursement_recorded_at   timestamptz,
  disbursement_verified_by   uuid,
  disbursement_verified_at   timestamptz,
  repaid_at                  timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  check (disbursement_verified_by is null or disbursement_verified_by is distinct from disbursement_recorded_by)
);
create index hr_salary_advances_employee on public.hr_salary_advances(employee_id, status);
-- One payment reference can settle only one advance (duplicate payment guard).
create unique index hr_salary_advances_reference on public.hr_salary_advances(upper(btrim(disbursement_reference))) where disbursement_reference is not null;
create trigger hr_salary_advances_touch before update on public.hr_salary_advances for each row execute function hr_private.touch_updated_at();

create table public.hr_salary_advance_repayments (
  id                   uuid primary key default gen_random_uuid(),
  advance_id           uuid not null references public.hr_salary_advances(id) on delete restrict,
  amount               numeric(14,2) not null check (amount > 0),
  method               text not null check (method in ('payroll_deduction','direct_payment')),
  reference            text not null check (length(btrim(reference)) between 3 and 120),
  paid_on              date not null,
  payroll_run_id       uuid references public.hr_payroll_runs(id) on delete restrict,
  note                 text check (note is null or length(note) <= 1000),
  recorded_by          uuid default auth.uid(),
  recorded_employee_id uuid references public.hr_employees(id) on delete set null,
  created_at           timestamptz not null default now(),
  unique (advance_id, reference),
  check ((method = 'payroll_deduction') = (payroll_run_id is not null))
);
create unique index hr_salary_advance_repayments_run on public.hr_salary_advance_repayments(advance_id, payroll_run_id) where payroll_run_id is not null;
create trigger hr_salary_advance_repayments_append_only before update or delete on public.hr_salary_advance_repayments
  for each row execute function hr_internal.append_only();

-- ---------------------------------------------------------------------
-- 7. Visibility helpers (hr_private: read-only, used by RLS policies)
-- ---------------------------------------------------------------------
-- Payroll-routed: payroll categories, salary advances, salary certificates,
-- or any request with a payroll approval stage (e.g. bank detail changes).
create or replace function hr_private.request_payroll_routed(p_request uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select c.default_assignee_role = 'payroll_admin'
        or r.workflow = 'salary_advance'
        or (r.workflow = 'hr_letter' and r.details ->> 'letter_type' = 'salary_certificate')
        or exists (select 1 from public.hr_request_approvals a where a.request_id = r.id and a.stage_role = 'payroll')
    from public.hr_requests r join public.hr_request_categories c on c.id = r.category_id
    where r.id = p_request), false)
$$;

-- Row visibility of a request.
--   requester: always (including drafts)
--   hr_requests.manage: everything that is not a draft
--   hr_requests.view: non-confidential helpdesk / letter requests
--   hr_requests.payroll: payroll-routed requests (never confidential helpdesk ones)
--   hr_requests.finance: requests with a finance stage
--   hr_requests.approve_team: requests with a manager stage assigned / delegated to the caller
create or replace function hr_private.request_row_visible(p_request uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select r.employee_id = hr_private.current_employee_id()
        or (r.status <> 'draft' and (
              hr_private.has_permission('hr_requests.manage')
           or (not r.is_confidential and r.workflow in ('helpdesk','hr_letter') and hr_private.has_permission('hr_requests.view'))
           -- Routed access. A confidential helpdesk request (grievance) is never routed; workflow
           -- requests (e.g. salary advances, confidential by default) are visible only along their route.
           or ((not r.is_confidential or r.workflow <> 'helpdesk') and (
                  (hr_private.has_permission('hr_requests.payroll') and hr_private.request_payroll_routed(r.id))
               or (hr_private.has_permission('hr_requests.finance')
                   and exists (select 1 from public.hr_request_approvals a where a.request_id = r.id and a.stage_role = 'finance'))
               or (hr_private.has_permission('hr_requests.approve_team')
                   and exists (select 1 from public.hr_request_approvals a
                               where a.request_id = r.id and a.stage_role = 'manager'
                                 and hr_private.current_employee_id() in (a.approver_employee_id, a.delegate_employee_id)))))))
    from public.hr_requests r where r.id = p_request), false)
$$;

-- May the caller handle (reply / assign / resolve / fulfil) a request?
-- Never the requester. hr_requests.manage, or hr_requests.payroll for
-- non-confidential payroll-routed requests.
create or replace function hr_private.request_can_handle(p_request uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select r.employee_id is distinct from hr_private.current_employee_id()
       and r.status <> 'draft'
       and (hr_private.has_permission('hr_requests.manage')
            or ((not r.is_confidential or r.workflow <> 'helpdesk')
                and hr_private.has_permission('hr_requests.payroll') and hr_private.request_payroll_routed(r.id)))
    from public.hr_requests r where r.id = p_request), false)
$$;

-- Comment visibility (replaces the 111 version): request visible, and
-- internal notes only for staff (handlers, or hr_requests.view on
-- non-confidential helpdesk / letter requests as in 111) — never the requester.
create or replace function hr_private.request_comment_visible(p_request uuid, p_internal boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select hr_private.request_row_visible(p_request)
     and (not coalesce(p_internal, false)
          or hr_private.request_can_handle(p_request)
          or exists (select 1 from public.hr_requests r
                     where r.id = p_request and r.employee_id is distinct from hr_private.current_employee_id()
                       and not r.is_confidential and r.workflow in ('helpdesk','hr_letter')
                       and hr_private.has_permission('hr_requests.view')))
$$;

create or replace function hr_private.request_attachment_visible(p_attachment uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select a.removed_at is null
       and hr_private.request_row_visible(r.id)
       and (a.kind in ('receipt','evidence','supporting')
            or (a.kind = 'issued_letter'
                and (r.employee_id = hr_private.current_employee_id()
                     or case when r.details ->> 'letter_type' = 'salary_certificate'
                             then hr_private.has_permission('hr_requests.payroll') or hr_private.has_permission('documents.compensation')
                             else hr_private.request_can_handle(r.id) end))
            or (a.kind = 'payment_evidence'
                and (r.employee_id = hr_private.current_employee_id()
                     or hr_private.has_permission('hr_requests.finance')
                     or hr_private.has_permission('hr_requests.payroll'))))
    from public.hr_request_attachments a join public.hr_requests r on r.id = a.request_id
    where a.id = p_attachment), false)
$$;

-- Storage: may the caller upload this exact object (registered by them in the last 24h, not yet uploaded)?
create or replace function hr_private.request_object_can_upload(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
     and not hr_private.caller_is_revoked()
     and exists (select 1 from public.hr_request_attachments a
                 where a.storage_path = p_name and a.uploaded_by = auth.uid() and a.removed_at is null
                   and a.created_at > now() - interval '24 hours')
     and not exists (select 1 from storage.objects o where o.bucket_id = 'hr-request-files' and o.name = p_name)
$$;

create or replace function hr_private.request_object_readable(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.hr_request_attachments a
                 where a.storage_path = p_name and hr_private.request_attachment_visible(a.id))
$$;

-- ---------------------------------------------------------------------
-- 8. RLS
-- ---------------------------------------------------------------------
drop policy hr_requests_read on public.hr_requests;
create policy hr_requests_read on public.hr_requests for select to authenticated
  using (hr_private.request_row_visible(id));
-- hr_requests / hr_request_comments keep 111's model: RLS without write policies (RPC-only writes).

select hr_private.secure_table('public.hr_request_approvals');
select hr_private.secure_table('public.hr_request_events');
select hr_private.secure_table('public.hr_request_sensitive');
select hr_private.secure_table('public.hr_request_attachments');
select hr_private.secure_table('public.hr_salary_advances');
select hr_private.secure_table('public.hr_salary_advance_repayments');

create policy hr_request_approvals_read on public.hr_request_approvals for select to authenticated
  using (hr_private.request_row_visible(request_id));
create policy hr_request_events_read on public.hr_request_events for select to authenticated
  using (hr_private.request_row_visible(request_id));
create policy hr_request_attachments_read on public.hr_request_attachments for select to authenticated
  using (hr_private.request_attachment_visible(id));
create policy hr_salary_advances_read on public.hr_salary_advances for select to authenticated
  using (employee_id = hr_private.current_employee_id()
         or hr_private.has_permission('hr_requests.payroll') or hr_private.has_permission('hr_requests.finance'));
create policy hr_salary_advance_repayments_read on public.hr_salary_advance_repayments for select to authenticated
  using (exists (select 1 from public.hr_salary_advances v where v.id = advance_id
                 and (v.employee_id = hr_private.current_employee_id()
                      or hr_private.has_permission('hr_requests.payroll') or hr_private.has_permission('hr_requests.finance'))));
-- No API writes on any of these tables (RPC only); no API reads of sensitive values at all.
revoke insert, update, delete, truncate on public.hr_request_approvals, public.hr_request_events, public.hr_request_attachments,
  public.hr_salary_advances, public.hr_salary_advance_repayments from authenticated;
revoke all on public.hr_request_sensitive from authenticated;

select hr_private.enable_audit('public.hr_request_approvals');
select hr_private.enable_audit('public.hr_request_sensitive', array['payload','previous']);
select hr_private.enable_audit('public.hr_request_attachments');
select hr_private.enable_audit('public.hr_salary_advances');
select hr_private.enable_audit('public.hr_salary_advance_repayments');

-- Storage bucket for receipts, evidence and issued letters (private).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('hr-request-files', 'hr-request-files', false, 10485760, array['application/pdf','image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;
drop policy if exists "hr-request-files: registered upload" on storage.objects;
create policy "hr-request-files: registered upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'hr-request-files' and hr_private.request_object_can_upload(name));
drop policy if exists "hr-request-files: permitted read" on storage.objects;
create policy "hr-request-files: permitted read" on storage.objects for select to authenticated
  using (bucket_id = 'hr-request-files' and hr_private.request_object_readable(name));
-- No UPDATE / DELETE policies: files are immutable; removal is a flag on the attachment row.

-- ---------------------------------------------------------------------
-- 9. Internal helpers (hr_internal — no API access)
-- ---------------------------------------------------------------------
create or replace function hr_internal.user_has_permission(p_user uuid, p_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user is not null
     and exists (select 1 from public.hr_user_roles ur
                 where ur.user_id = p_user
                   and (ur.role_key = 'super_admin'
                        or exists (select 1 from public.hr_role_permissions rp where rp.role_key = ur.role_key and rp.permission_key = p_permission)))
     and not exists (select 1 from public.hr_employees e where e.user_id = p_user
                     and (not e.portal_access or e.status in ('exited','archived','suspended')))
$$;

-- Active portal users holding a permission (excluding one employee).
create or replace function hr_internal.permission_users(p_permission text, p_exclude_employee uuid default null)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select distinct e.user_id
  from public.hr_employees e
  where e.user_id is not null and e.portal_access and e.status not in ('exited','archived','suspended')
    and e.id is distinct from p_exclude_employee
    and hr_internal.user_has_permission(e.user_id, p_permission)
$$;

create or replace function hr_internal.stage_permission(p_role text)
returns text language sql immutable set search_path = '' as $$
  select case p_role when 'manager' then 'hr_requests.approve_team' when 'hr' then 'hr_requests.manage'
                     when 'payroll' then 'hr_requests.payroll' when 'finance' then 'hr_requests.finance' end
$$;

-- Users who handle a request (helpdesk routing and assignment pool).
create or replace function hr_internal.request_handler_users(p_request uuid)
returns setof uuid language plpgsql stable security definer set search_path = '' as $$
declare r public.hr_requests;
begin
  select * into r from public.hr_requests where id = p_request;
  return query select u from hr_internal.permission_users('hr_requests.manage', r.employee_id) u;
  if (not r.is_confidential or r.workflow <> 'helpdesk') and hr_private.request_payroll_routed(r.id) then
    return query select u from hr_internal.permission_users('hr_requests.payroll', r.employee_id) u;
  end if;
end $$;

-- Replaces hr_private.request_notify_staff (111): routes to the category's
-- default role among users who can actually handle the request (fixes
-- HR11: payroll_query now reaches payroll admins), falling back to every
-- handler.
create or replace function hr_internal.request_notify_staff(p_request uuid, p_title text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.hr_requests; v_role text; v_user uuid; v_any boolean := false;
begin
  select * into r from public.hr_requests where id = p_request;
  if r.assigned_to is not null then
    perform hr_private.notify_employee(r.assigned_to, 'hr_request', p_title, p_body, '/hr/requests/' || r.id, 'hr_request', r.id::text);
    return;
  end if;
  select default_assignee_role into v_role from public.hr_request_categories where id = r.category_id;
  for v_user in
    select distinct h from hr_internal.request_handler_users(r.id) h
    where v_role is null or exists (select 1 from public.hr_user_roles ur where ur.user_id = h and ur.role_key = v_role)
  loop
    perform hr_private.notify_user(v_user, 'hr_request', p_title, p_body, '/hr/requests/' || r.id, 'hr_request', r.id::text);
    v_any := true;
  end loop;
  if not v_any then
    for v_user in select distinct h from hr_internal.request_handler_users(r.id) h loop
      perform hr_private.notify_user(v_user, 'hr_request', p_title, p_body, '/hr/requests/' || r.id, 'hr_request', r.id::text);
    end loop;
  end if;
end $$;

create or replace function hr_internal.notify_requester(p_request uuid, p_type text, p_title text, p_body text)
returns void language sql security definer set search_path = '' as $$
  select hr_private.notify_employee(r.employee_id, p_type, p_title, p_body, '/employee/requests/' || r.id, 'hr_request', r.id::text)
  from public.hr_requests r where r.id = p_request
$$;

create or replace function hr_internal.request_event(p_request uuid, p_action text, p_note text default null,
                                                      p_stage_role text default null, p_from text default null, p_to text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.hr_request_events (request_id, round, action, stage_role, from_status, to_status, note, actor_employee_id)
  select r.id, nullif(r.approval_round, 0), p_action, p_stage_role, p_from, p_to, left(nullif(btrim(p_note), ''), 2000), hr_private.current_employee_id()
  from public.hr_requests r where r.id = p_request
$$;

-- Manager approver for a request: the employee's manager, when that manager
-- has an active portal account and holds hr_requests.approve_team.
create or replace function hr_internal.request_manager_approver(p_employee uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select m.id from public.hr_employees e join public.hr_employees m on m.id = e.manager_id
  where e.id = p_employee and m.user_id is not null and m.portal_access and m.status not in ('exited','archived','suspended')
    and hr_internal.user_has_permission(m.user_id, 'hr_requests.approve_team')
$$;

-- Approval stages for a request (category routing + dynamic rules).
create or replace function hr_internal.request_stage_plan(p_request uuid)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare r public.hr_requests; v_stages text[]; v_bank boolean; v_other boolean; v_out text[] := '{}'; s text;
begin
  select * into r from public.hr_requests where id = p_request;
  select approval_stages into v_stages from public.hr_request_categories where id = r.category_id;
  if r.workflow = 'profile_change' then
    v_bank := coalesce((r.details ->> 'includes_bank')::boolean, false);
    v_other := exists (select 1 from jsonb_array_elements_text(coalesce(r.details -> 'fields', '[]'::jsonb)) f where f <> 'bank_account');
    -- Bank details are payroll data: always reviewed by payroll; HR reviews the other fields.
    if v_bank and not v_other then v_stages := array_remove(v_stages, 'hr'); end if;
    if v_bank and not ('payroll' = any (v_stages)) then v_stages := v_stages || 'payroll'::text; end if;
  end if;
  foreach s in array v_stages loop
    if s = 'manager' and hr_internal.request_manager_approver(r.employee_id) is null then s := 'hr'; end if;
    if not (s = any (v_out)) then v_out := v_out || s; end if;
  end loop;
  return v_out;
end $$;

create or replace function hr_internal.notify_stage(p_request uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.hr_requests; a public.hr_request_approvals; v_cat text; v_user uuid; v_title text; v_body text;
begin
  select * into r from public.hr_requests where id = p_request;
  select * into a from public.hr_request_approvals where request_id = p_request and status = 'pending';
  if a.id is null then return; end if;
  select name into v_cat from public.hr_request_categories where id = r.category_id;
  v_title := 'Approval needed: ' || v_cat;
  v_body := 'A request is waiting for your ' || a.stage_role || ' approval.';
  if a.stage_role = 'manager' then
    perform hr_private.notify_employee(coalesce(a.delegate_employee_id, a.approver_employee_id), 'hr_request.approval',
      v_title, v_body, '/hr/requests/' || r.id, 'hr_request', r.id::text);
  else
    for v_user in select u from hr_internal.permission_users(hr_internal.stage_permission(a.stage_role), r.employee_id) u loop
      perform hr_private.notify_user(v_user, 'hr_request.approval', v_title, v_body, '/hr/requests/' || r.id, 'hr_request', r.id::text);
    end loop;
  end if;
end $$;

-- Basis on which the caller may decide a pending stage, or null.
create or replace function hr_internal.stage_can_act(p_stage uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare a public.hr_request_approvals; r public.hr_requests; v_me uuid := hr_private.current_employee_id();
begin
  if auth.uid() is null or hr_private.caller_is_revoked() then return null; end if;
  select * into a from public.hr_request_approvals where id = p_stage;
  if a.id is null or a.status <> 'pending' then return null; end if;
  select * into r from public.hr_requests where id = a.request_id;
  if r.status <> 'pending_approval' then return null; end if;
  if v_me is not null and v_me = r.employee_id then return null; end if;              -- no self-approval
  if coalesce((hr_private.setting('hr_requests') ->> 'distinct_stage_approvers')::boolean, true)
     and exists (select 1 from public.hr_request_approvals x
                 where x.request_id = a.request_id and x.round = a.round and x.id <> a.id
                   and x.status = 'approved' and x.decided_by = auth.uid()) then
    return null;                                                                       -- a different approver per stage
  end if;
  if a.stage_role = 'manager' then
    if v_me is not null and v_me = a.delegate_employee_id and hr_private.has_permission('hr_requests.approve_team') then return 'delegate'; end if;
    if v_me is not null and v_me = a.approver_employee_id and a.delegate_employee_id is null
       and hr_private.has_permission('hr_requests.approve_team') then return 'designated'; end if;
    if hr_private.has_permission('hr_requests.manage') then return 'hr_override'; end if;
    return null;
  end if;
  if hr_private.has_permission(hr_internal.stage_permission(a.stage_role)) then return 'role'; end if;
  return null;
end $$;

-- Compensation-authorised: payroll request handlers with payroll access, or
-- Module 9's documents.compensation (has_permission is false while 129 is absent).
create or replace function hr_internal.compensation_authorised()
returns boolean language sql stable security definer set search_path = '' as $$
  select (hr_private.has_permission('hr_requests.payroll') and hr_private.has_permission('payroll.view'))
      or hr_private.has_permission('documents.compensation')
$$;

create or replace function hr_internal.can_issue_letter(p_request uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select r.workflow = 'hr_letter' and r.status = 'approved'
       and r.employee_id is distinct from hr_private.current_employee_id()
       and case when r.details ->> 'letter_type' = 'salary_certificate'
                then hr_internal.compensation_authorised()
                else hr_private.request_can_handle(r.id) end
    from public.hr_requests r where r.id = p_request), false)
$$;

-- Next fulfilment action for the caller on an approved request, or null.
create or replace function hr_internal.request_pending_action(p_request uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare r public.hr_requests; v public.hr_salary_advances; v_me uuid := hr_private.current_employee_id();
begin
  select * into r from public.hr_requests where id = p_request;
  if r.id is null or r.status <> 'approved' then return null; end if;
  if r.workflow = 'hr_letter' then
    return case when hr_internal.can_issue_letter(r.id) then 'issue_letter' end;
  end if;
  if r.workflow = 'salary_advance' then
    select * into v from public.hr_salary_advances where request_id = r.id;
    if r.employee_id = v_me then return case when v.status = 'approved' then 'accept_agreement' end; end if;
    if not hr_private.has_permission('hr_requests.finance') then return null; end if;
    if v.status = 'agreed' then return 'record_disbursement'; end if;
    if v.status = 'disbursement_recorded' and v.disbursement_recorded_by is distinct from auth.uid() then return 'verify_disbursement'; end if;
  end if;
  return null;
end $$;

-- ---- validation of request details -----------------------------------
create or replace function hr_internal.text_field(p jsonb, p_key text, p_label text, p_min int, p_max int, p_required boolean)
returns text language plpgsql stable set search_path = '' as $$
declare v text := nullif(btrim(p ->> p_key), '');
begin
  if v is null then
    if p_required then perform hr_private.fail(p_label || ' is required.', 'invalid_' || p_key); end if;
    return null;
  end if;
  if length(v) < p_min or length(v) > p_max then
    perform hr_private.fail(format('%s must be %s to %s characters.', p_label, p_min, p_max), 'invalid_' || p_key);
  end if;
  return v;
end $$;

create or replace function hr_internal.normalize_letter(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_type text := nullif(btrim(p ->> 'letter_type'), '');
  v_purpose text; v_to text; v_other text; v_more text; v_by date; v_label text;
begin
  if v_type is null or v_type not in ('employment_certificate','experience_letter','salary_certificate','address_confirmation','other') then
    perform hr_private.fail('Choose a letter type.', 'invalid_letter_type');
  end if;
  v_purpose := hr_internal.text_field(p, 'purpose', 'Purpose', 3, 500, true);
  v_to := hr_internal.text_field(p, 'addressed_to', 'Addressed to', 2, 200, false);
  v_more := hr_internal.text_field(p, 'additional_details', 'Additional details', 1, 2000, false);
  if v_type = 'other' then v_other := hr_internal.text_field(p, 'other_letter_name', 'Letter name', 3, 120, true); end if;
  begin
    v_by := nullif(btrim(p ->> 'required_by'), '')::date;
  exception when others then
    perform hr_private.fail('Enter a valid "required by" date.', 'invalid_date');
  end;
  if v_by < hr_private.business_today() then perform hr_private.fail('The "required by" date is in the past.', 'invalid_date'); end if;
  v_label := case v_type when 'employment_certificate' then 'Employment certificate' when 'experience_letter' then 'Experience letter'
                         when 'salary_certificate' then 'Salary certificate' when 'address_confirmation' then 'Address confirmation letter'
                         else v_other end;
  return jsonb_build_object('subject', 'Letter request: ' || v_label, 'description', v_purpose,
    'details', jsonb_strip_nulls(jsonb_build_object('letter_type', v_type, 'letter_label', v_label, 'purpose', v_purpose,
       'addressed_to', v_to, 'required_by', v_by, 'other_letter_name', v_other, 'additional_details', v_more)));
end $$;

create or replace function hr_internal.normalize_reimbursement(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  cfg jsonb := coalesce(hr_private.setting('hr_requests'), '{}'::jsonb);
  v_age int := coalesce((cfg ->> 'reimbursement_max_age_days')::int, 90);
  v_currencies jsonb := coalesce(cfg -> 'reimbursement_currencies', jsonb_build_array(coalesce(hr_private.setting('company') ->> 'currency', 'INR')));
  v_today date := hr_private.business_today();
  v_cat text := nullif(btrim(p ->> 'category'), '');
  v_cur text := upper(nullif(btrim(p ->> 'currency'), ''));
  v_date date; v_amount numeric; v_purpose text; v_merchant text; v_project uuid; v_project_name text; v_label text;
begin
  if v_cat is null or v_cat not in ('travel','meals','internet','equipment','medical','training','other') then
    perform hr_private.fail('Choose a reimbursement category.', 'invalid_category');
  end if;
  begin v_date := nullif(btrim(p ->> 'expense_date'), '')::date; exception when others then v_date := null; end;
  if v_date is null then perform hr_private.fail('Enter the expense date.', 'invalid_date'); end if;
  if v_date > v_today then perform hr_private.fail('The expense date cannot be in the future.', 'invalid_date'); end if;
  if v_date < v_today - v_age then perform hr_private.fail(format('Expenses older than %s days cannot be claimed.', v_age), 'claim_too_old'); end if;
  begin v_amount := round(nullif(btrim(p ->> 'amount'), '')::numeric, 2); exception when others then v_amount := null; end;
  if v_amount is null or v_amount <= 0 or v_amount > 10000000 then
    perform hr_private.fail('Enter an amount greater than zero (maximum 10,000,000).', 'invalid_amount');
  end if;
  v_cur := coalesce(v_cur, v_currencies ->> 0);
  if not (v_currencies ? v_cur) then
    perform hr_private.fail('Claims can be made in: ' || (select string_agg(x, ', ') from jsonb_array_elements_text(v_currencies) x) || '.', 'invalid_currency');
  end if;
  v_purpose := hr_internal.text_field(p, 'purpose', 'Business purpose', 3, 2000, true);
  v_merchant := hr_internal.text_field(p, 'merchant', 'Merchant', 2, 120, false);
  if nullif(btrim(p ->> 'project_id'), '') is not null then
    begin v_project := (p ->> 'project_id')::uuid; exception when others then v_project := null; end;
    select name into v_project_name from public.hr_projects where id = v_project and status <> 'archived';
    if v_project_name is null then perform hr_private.fail('Unknown or archived project.', 'invalid_project'); end if;
  end if;
  v_label := case v_cat when 'travel' then 'Travel' when 'meals' then 'Meals' when 'internet' then 'Communication'
                        when 'equipment' then 'Office expenses' when 'medical' then 'Medical' when 'training' then 'Training' else 'Other' end;
  return jsonb_build_object('subject', 'Reimbursement: ' || v_label || ' (' || to_char(v_date, 'DD Mon YYYY') || ')', 'description', v_purpose,
    'details', jsonb_strip_nulls(jsonb_build_object('category', v_cat, 'category_label', v_label, 'expense_date', v_date,
       'amount', v_amount, 'currency', v_cur, 'purpose', v_purpose, 'merchant', v_merchant,
       'project_id', v_project, 'project_name', v_project_name)));
end $$;

-- Eligibility for a new salary advance (excluding one request when re-validating it).
create or replace function hr_internal.advance_eligibility(p_employee uuid, p_exclude_request uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  cfg jsonb := coalesce(hr_private.setting('salary_advances'), '{}'::jsonb);
  v_enabled boolean := coalesce((cfg ->> 'enabled')::boolean, false);
  v_today date := hr_private.business_today();
  v_min_months int := coalesce((cfg ->> 'min_service_months')::int, 6);
  v_pct numeric := coalesce((cfg ->> 'max_percent_of_monthly_ctc')::numeric, 50);
  v_abs numeric := nullif(cfg ->> 'max_amount', '')::numeric;
  v_max_open int := coalesce((cfg ->> 'max_open_advances')::int, 1);
  e public.hr_employees; s record;
  v_reasons text[] := '{}'; v_cap numeric := 0; v_outstanding numeric := 0; v_committed numeric := 0; v_open int := 0; v_max numeric := 0;
  v_currency text := coalesce(hr_private.setting('company') ->> 'currency', 'INR');
begin
  select * into e from public.hr_employees where id = p_employee;
  if not v_enabled then v_reasons := v_reasons || 'Salary advances are not enabled under the current company policy.'::text; end if;
  if e.status is distinct from 'active' then
    v_reasons := v_reasons || ('Only confirmed, active employees can request a salary advance (current status: ' || coalesce(replace(e.status, '_', ' '), 'unknown') || ').');
  end if;
  if e.joining_date is null or e.joining_date > (v_today - make_interval(months => v_min_months))::date then
    v_reasons := v_reasons || format('At least %s months of service are required.', v_min_months);
  end if;
  select st.annual_ctc, st.currency into s from public.hr_salary_structures st
   where st.employee_id = p_employee and st.status = 'active' and st.effective_from <= v_today
     and (st.effective_to is null or st.effective_to >= v_today)
   order by st.effective_from desc limit 1;
  if s.annual_ctc is null then
    v_reasons := v_reasons || 'No active salary structure is on file. Contact Payroll.'::text;
  else
    v_currency := s.currency;
    v_cap := round(s.annual_ctc / 12 * v_pct / 100, 2);
    if v_abs is not null then v_cap := least(v_cap, v_abs); end if;
  end if;
  select coalesce(sum(coalesce(v.disbursed_amount, v.amount)
                      - coalesce((select sum(p.amount) from public.hr_salary_advance_repayments p where p.advance_id = v.id), 0))
                  filter (where v.status in ('disbursement_recorded','repaying')), 0),
         coalesce(sum(v.amount) filter (where v.status in ('pending','returned','approved','agreed')), 0),
         count(*) filter (where v.status in ('pending','returned','approved','agreed','disbursement_recorded','repaying'))
    into v_outstanding, v_committed, v_open
    from public.hr_salary_advances v
   where v.employee_id = p_employee and v.request_id is distinct from p_exclude_request;
  if v_open >= v_max_open then
    v_reasons := v_reasons || 'You already have an open salary advance. It must be repaid before you request another.'::text;
  end if;
  v_max := greatest(0, v_cap - v_outstanding - v_committed);
  if s.annual_ctc is not null and v_max <= 0 and cardinality(v_reasons) = 0 then
    v_reasons := v_reasons || 'No advance amount is available under the current policy.'::text;
  end if;
  return jsonb_build_object('enabled', v_enabled, 'eligible', cardinality(v_reasons) = 0, 'reasons', to_jsonb(v_reasons),
    'max_permitted', v_max, 'outstanding_balance', v_outstanding, 'committed', v_committed, 'currency', v_currency,
    'min_repayment_months', coalesce((cfg ->> 'min_repayment_months')::int, 1),
    'max_repayment_months', coalesce((cfg ->> 'max_repayment_months')::int, 6),
    'allow_payroll_deduction', coalesce((cfg ->> 'allow_payroll_deduction')::boolean, false));
end $$;

create or replace function hr_internal.normalize_advance(p_employee uuid, p jsonb, p_request uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare el jsonb := hr_internal.advance_eligibility(p_employee, p_request); v_amount numeric; v_months int; v_reason text; v_max numeric;
begin
  if not (el ->> 'enabled')::boolean then
    perform hr_private.fail('Salary advances are not available: the company policy has not been enabled.', 'advances_disabled');
  end if;
  if not (el ->> 'eligible')::boolean then perform hr_private.fail(el -> 'reasons' ->> 0, 'not_eligible'); end if;
  begin v_amount := round(nullif(btrim(p ->> 'amount'), '')::numeric, 2); exception when others then v_amount := null; end;
  if v_amount is null or v_amount <= 0 then perform hr_private.fail('Enter the advance amount.', 'invalid_amount'); end if;
  v_max := (el ->> 'max_permitted')::numeric;
  if v_amount > v_max then
    perform hr_private.fail('The maximum advance you can request is ' || to_char(v_max, 'FM999999999990.00') || ' ' || (el ->> 'currency') || '.', 'over_limit');
  end if;
  begin v_months := nullif(btrim(p ->> 'repayment_months'), '')::int; exception when others then v_months := null; end;
  if v_months is null or v_months < (el ->> 'min_repayment_months')::int or v_months > (el ->> 'max_repayment_months')::int then
    perform hr_private.fail(format('Choose a repayment period of %s to %s months.', el ->> 'min_repayment_months', el ->> 'max_repayment_months'), 'invalid_repayment');
  end if;
  v_reason := hr_internal.text_field(p, 'reason', 'Reason', 3, 2000, true);
  return jsonb_build_object('subject', 'Salary advance request', 'description', v_reason,
    'details', jsonb_build_object('amount', v_amount, 'currency', el ->> 'currency', 'repayment_months', v_months,
                                  'installment_amount', round(v_amount / v_months, 2), 'reason', v_reason),
    'advance', jsonb_build_object('max_permitted', v_max, 'outstanding', (el ->> 'outstanding_balance')::numeric));
end $$;

create or replace function hr_internal.profile_field_label(p_key text)
returns text language sql immutable set search_path = '' as $$
  select case p_key
    when 'phone' then 'Phone' when 'personal_email' then 'Personal email' when 'address_line1' then 'Address line 1'
    when 'address_line2' then 'Address line 2' when 'city' then 'City' when 'state' then 'State' when 'postal_code' then 'Postal code'
    when 'country' then 'Country' when 'emergency_contact_name' then 'Emergency contact name'
    when 'emergency_contact_relation' then 'Emergency contact relation' when 'emergency_contact_phone' then 'Emergency contact phone'
    when 'display_name' then 'Display name' when 'marital_status' then 'Marital status' when 'nationality' then 'Nationality'
    when 'bank_account' then 'Bank account' else p_key end
$$;

create or replace function hr_internal.profile_contact_keys()
returns text[] language sql immutable set search_path = '' as $$
  select array['phone','personal_email','address_line1','address_line2','city','state','postal_code','country',
               'emergency_contact_name','emergency_contact_relation','emergency_contact_phone','display_name','marital_status','nationality']
$$;

-- Current value of a contact field (definer: reads the authoritative record).
create or replace function hr_internal.profile_current(p_employee uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(to_jsonb(p), '{}'::jsonb) || jsonb_build_object('display_name', e.display_name)
  from public.hr_employees e left join public.hr_employee_private p on p.employee_id = e.id
  where e.id = p_employee
$$;

create or replace function hr_internal.normalize_profile(p_employee uuid, p jsonb, s jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c jsonb := coalesce(s -> 'contact', '{}'::jsonb);
  b jsonb := nullif(coalesce(s -> 'bank', 'null'::jsonb), 'null'::jsonb);
  cur jsonb := hr_internal.profile_current(p_employee);
  k text; v text; v_out jsonb := '{}'::jsonb; v_fields text[] := '{}'; v_reason text; nb jsonb; v_acct text;
begin
  if jsonb_typeof(c) <> 'object' or (b is not null and jsonb_typeof(b) <> 'object') then
    perform hr_private.fail('Invalid change request.', 'invalid');
  end if;
  v_reason := hr_internal.text_field(p, 'reason', 'Reason for the change', 3, 1000, true);
  for k in select jsonb_object_keys(c) loop
    if not (k = any (hr_internal.profile_contact_keys())) then
      perform hr_private.fail('"' || k || '" cannot be changed through a request.', 'invalid_field');
    end if;
    v := nullif(btrim(c ->> k), '');
    if k in ('phone','emergency_contact_phone') and v is not null and v !~ '^[+0-9 ()-]{7,20}$' then
      perform hr_private.fail(hr_internal.profile_field_label(k) || ': enter 7 to 20 digits (spaces, +, - and brackets allowed).', 'invalid_' || k);
    elsif k = 'personal_email' and v is not null and (v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v) > 254) then
      perform hr_private.fail('Enter a valid personal email address.', 'invalid_personal_email');
    elsif k in ('country','nationality') and v is not null then
      v := upper(v);
      if v !~ '^[A-Z]{2}$' then perform hr_private.fail(hr_internal.profile_field_label(k) || ': use the 2-letter country code.', 'invalid_' || k); end if;
    elsif k = 'postal_code' and v is not null and v !~ '^[A-Za-z0-9 -]{3,12}$' then
      perform hr_private.fail('Enter a valid postal code.', 'invalid_postal_code');
    elsif k = 'marital_status' and v is not null and v not in ('single','married','divorced','widowed','separated','prefer_not_to_say') then
      perform hr_private.fail('Choose a marital status.', 'invalid_marital_status');
    elsif k = 'display_name' and v is not null and length(v) > 120 then
      perform hr_private.fail('Display name: 120 characters maximum.', 'invalid_display_name');
    elsif v is not null and length(v) > 200 then
      perform hr_private.fail(hr_internal.profile_field_label(k) || ': 200 characters maximum.', 'invalid_' || k);
    end if;
    if k in ('phone','personal_email','emergency_contact_phone') and v is null then
      perform hr_private.fail(hr_internal.profile_field_label(k) || ' cannot be removed through a request; enter the new value.', 'invalid_' || k);
    end if;
    if v is distinct from nullif(cur ->> k, '') then      -- only real changes
      v_out := v_out || jsonb_build_object(k, v);
      v_fields := v_fields || k;
    end if;
  end loop;
  if b is not null then
    v_acct := upper(regexp_replace(coalesce(b ->> 'account_number', ''), '\s', '', 'g'));
    nb := jsonb_strip_nulls(jsonb_build_object(
      'bank_name', hr_internal.text_field(b, 'bank_name', 'Bank name', 2, 120, true),
      'account_holder', hr_internal.text_field(b, 'account_holder', 'Account holder', 2, 120, true),
      'account_number', v_acct,
      'ifsc', upper(nullif(btrim(b ->> 'ifsc'), '')),
      'iban', upper(regexp_replace(nullif(btrim(b ->> 'iban'), ''), '\s', '', 'g')),
      'swift_code', upper(nullif(btrim(b ->> 'swift_code'), '')),
      'branch', hr_internal.text_field(b, 'branch', 'Branch', 2, 120, false)));
    if v_acct !~ '^[0-9A-Z]{6,34}$' then perform hr_private.fail('Enter a valid account number (6 to 34 letters or digits).', 'invalid_account_number'); end if;
    if nb ? 'ifsc' and nb ->> 'ifsc' !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then perform hr_private.fail('Enter a valid IFSC code.', 'invalid_ifsc'); end if;
    if nb ? 'iban' and nb ->> 'iban' !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$' then perform hr_private.fail('Enter a valid IBAN.', 'invalid_iban'); end if;
    if nb ? 'swift_code' and nb ->> 'swift_code' !~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$' then perform hr_private.fail('Enter a valid SWIFT code.', 'invalid_swift'); end if;
    if exists (select 1 from public.hr_employee_bank_accounts a where a.employee_id = p_employee and a.active and a.is_primary
               and upper(a.account_number) = v_acct) then
      perform hr_private.fail('This bank account is already your primary account.', 'no_changes');
    end if;
    v_fields := v_fields || 'bank_account'::text;
  end if;
  if cardinality(v_fields) = 0 then perform hr_private.fail('Change at least one value.', 'no_changes'); end if;
  return jsonb_build_object(
    'subject', left('Profile change: ' || (select string_agg(hr_internal.profile_field_label(f), ', ') from unnest(v_fields) f), 200),
    'description', v_reason,
    'details', jsonb_build_object('fields', to_jsonb(v_fields), 'reason', v_reason, 'includes_bank', b is not null),
    'sensitive', jsonb_strip_nulls(jsonb_build_object('contact', nullif(v_out, '{}'::jsonb), 'bank', nb)));
end $$;

create or replace function hr_internal.normalize_request(p_workflow text, p_employee uuid, p_details jsonb, p_sensitive jsonb, p_request uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if p_details is null or jsonb_typeof(p_details) <> 'object' then perform hr_private.fail('Invalid request details.', 'invalid'); end if;
  if p_workflow <> 'profile_change' and p_sensitive is not null and p_sensitive <> '{}'::jsonb then
    perform hr_private.fail('Invalid request details.', 'invalid');
  end if;
  return case p_workflow
    when 'hr_letter' then hr_internal.normalize_letter(p_details)
    when 'reimbursement' then hr_internal.normalize_reimbursement(p_details)
    when 'salary_advance' then hr_internal.normalize_advance(p_employee, p_details, p_request)
    when 'profile_change' then hr_internal.normalize_profile(p_employee, p_details, coalesce(p_sensitive, '{}'::jsonb))
  end;
end $$;

-- Start a new approval round (submit / resubmit). Caller holds the request lock.
create or replace function hr_internal.start_round(p_request uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.hr_requests; v_stages text[]; v_round smallint; i int := 0; s text; v_sla int;
begin
  select * into r from public.hr_requests where id = p_request;
  v_stages := hr_internal.request_stage_plan(r.id);
  if cardinality(v_stages) = 0 then perform hr_private.fail('This request type has no approval route configured.', 'invalid_stages'); end if;
  v_round := r.approval_round + 1;
  foreach s in array v_stages loop
    i := i + 1;
    insert into public.hr_request_approvals (request_id, round, stage_no, stage_role, status, approver_employee_id, activated_at)
    values (r.id, v_round, i, s, case when i = 1 then 'pending' else 'waiting' end,
            case when s = 'manager' then hr_internal.request_manager_approver(r.employee_id) end,
            case when i = 1 then now() end);
  end loop;
  select sla_hours into v_sla from public.hr_request_categories where id = r.category_id;
  update public.hr_requests
     set approval_round = v_round, status = 'pending_approval', submitted_at = now(), decided_at = null,
         sla_due_at = now() + make_interval(hours => v_sla), last_activity_at = now()
   where id = r.id;
  perform hr_internal.notify_stage(r.id);
end $$;

-- Pre-submission checks per workflow (re-run on every submit / resubmit).
create or replace function hr_internal.submit_request(p_request uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.hr_requests; c public.hr_request_categories; v_from text; n jsonb; att record;
begin
  select * into r from public.hr_requests where id = p_request for update;
  if r.status not in ('draft','returned') then perform hr_private.fail('Only draft or returned requests can be submitted.', 'invalid_state'); end if;
  select * into c from public.hr_request_categories where id = r.category_id;
  if not c.active then perform hr_private.fail('This request type is not available at the moment.', 'invalid_category'); end if;
  v_from := r.status;
  if r.workflow = 'reimbursement' then
    if exists (select 1 from public.hr_requests x where x.id <> r.id and x.employee_id = r.employee_id and x.workflow = 'reimbursement'
               and x.status in ('pending_approval','returned','approved','completed')
               and x.details ->> 'expense_date' = r.details ->> 'expense_date' and x.details ->> 'category' = r.details ->> 'category'
               and x.details ->> 'amount' = r.details ->> 'amount' and x.details ->> 'currency' = r.details ->> 'currency')
       or exists (select 1 from public.hr_reimbursements z where z.employee_id = r.employee_id and z.status <> 'rejected'
                  and z.claim_date = (r.details ->> 'expense_date')::date and z.category = r.details ->> 'category'
                  and z.amount = (r.details ->> 'amount')::numeric
                  and not exists (select 1 from public.hr_requests y where y.linked_entity_type = 'hr_reimbursements' and y.linked_entity_id = z.id and y.id = r.id)) then
      perform hr_private.fail('A claim for the same date, category and amount already exists. Duplicate claims are not allowed.', 'duplicate_claim');
    end if;
    if c.requires_attachment and not exists (select 1 from public.hr_request_attachments a
                                             where a.request_id = r.id and a.kind = 'receipt' and a.removed_at is null) then
      perform hr_private.fail('Attach the receipt before submitting the claim.', 'receipt_required');
    end if;
    for att in select a.* from public.hr_request_attachments a where a.request_id = r.id and a.kind = 'receipt' and a.removed_at is null loop
      if not exists (select 1 from storage.objects o where o.bucket_id = 'hr-request-files' and o.name = att.storage_path) then
        perform hr_private.fail('The upload of "' || att.file_name || '" did not finish. Upload it again or remove it.', 'upload_incomplete');
      end if;
      if att.checksum is not null and exists (
           select 1 from public.hr_request_attachments b join public.hr_requests y on y.id = b.request_id
           where b.checksum = att.checksum and b.id <> att.id and b.removed_at is null and b.kind = 'receipt' and y.id <> r.id
             and y.status in ('pending_approval','returned','approved','completed')) then
        perform hr_private.fail('The receipt "' || att.file_name || '" was already used on another claim.', 'duplicate_receipt');
      end if;
    end loop;
  elsif r.workflow = 'salary_advance' then
    n := hr_internal.normalize_advance(r.employee_id, r.details, r.id);          -- re-check policy, eligibility and limits
    insert into public.hr_salary_advances (request_id, employee_id, currency, amount, repayment_months, installment_amount,
                                           max_permitted, outstanding_at_request, status)
    values (r.id, r.employee_id, n -> 'details' ->> 'currency', (n -> 'details' ->> 'amount')::numeric,
            (n -> 'details' ->> 'repayment_months')::smallint, (n -> 'details' ->> 'installment_amount')::numeric,
            (n -> 'advance' ->> 'max_permitted')::numeric, (n -> 'advance' ->> 'outstanding')::numeric, 'pending')
    on conflict (request_id) do update set currency = excluded.currency, amount = excluded.amount, repayment_months = excluded.repayment_months,
      installment_amount = excluded.installment_amount, max_permitted = excluded.max_permitted,
      outstanding_at_request = excluded.outstanding_at_request, status = 'pending';
  end if;
  perform hr_internal.start_round(r.id);
  perform hr_internal.request_event(r.id, case when v_from = 'returned' then 'resubmitted' else 'submitted' end, null, null, v_from, 'pending_approval');
  perform hr_internal.notify_requester(r.id, 'hr_request.submitted', 'Request submitted', r.subject);
end $$;

-- Apply an approved profile change to the authoritative records (atomic).
create or replace function hr_internal.apply_profile_change(p_request uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.hr_requests; s public.hr_request_sensitive; c jsonb; b jsonb; prev jsonb := '{}'::jsonb; cur jsonb; v_old uuid; k text;
begin
  select * into r from public.hr_requests where id = p_request;
  select * into s from public.hr_request_sensitive where request_id = p_request for update;
  c := coalesce(s.payload -> 'contact', '{}'::jsonb);
  b := s.payload -> 'bank';
  if exists (select 1 from public.hr_employees e where e.id = r.employee_id and e.status = 'archived') then
    perform hr_private.fail('The employee record is archived; the change cannot be applied.', 'invalid_state');
  end if;
  if c <> '{}'::jsonb then
    cur := hr_internal.profile_current(r.employee_id);
    for k in select jsonb_object_keys(c) loop prev := prev || jsonb_build_object(k, cur -> k); end loop;
    insert into public.hr_employee_private (employee_id) values (r.employee_id) on conflict (employee_id) do nothing;
    update public.hr_employee_private set
      phone                      = case when c ? 'phone' then c ->> 'phone' else phone end,
      personal_email             = case when c ? 'personal_email' then c ->> 'personal_email' else personal_email end,
      address_line1              = case when c ? 'address_line1' then c ->> 'address_line1' else address_line1 end,
      address_line2              = case when c ? 'address_line2' then c ->> 'address_line2' else address_line2 end,
      city                       = case when c ? 'city' then c ->> 'city' else city end,
      state                      = case when c ? 'state' then c ->> 'state' else state end,
      postal_code                = case when c ? 'postal_code' then c ->> 'postal_code' else postal_code end,
      country                    = case when c ? 'country' then c ->> 'country' else country end,
      emergency_contact_name     = case when c ? 'emergency_contact_name' then c ->> 'emergency_contact_name' else emergency_contact_name end,
      emergency_contact_relation = case when c ? 'emergency_contact_relation' then c ->> 'emergency_contact_relation' else emergency_contact_relation end,
      emergency_contact_phone    = case when c ? 'emergency_contact_phone' then c ->> 'emergency_contact_phone' else emergency_contact_phone end,
      marital_status             = case when c ? 'marital_status' then c ->> 'marital_status' else marital_status end,
      nationality                = case when c ? 'nationality' then c ->> 'nationality' else nationality end
    where employee_id = r.employee_id;
    if c ? 'display_name' then
      update public.hr_employees set display_name = c ->> 'display_name' where id = r.employee_id;
    end if;
  end if;
  if b is not null then
    update public.hr_employee_bank_accounts set is_primary = false, active = false
     where employee_id = r.employee_id and active and is_primary returning id into v_old;
    -- Created unverified: Payroll (Module 7) verifies bank accounts with a second person
    -- (hr_verify_bank_account, maker-checker). The approver here is the maker.
    insert into public.hr_employee_bank_accounts (employee_id, bank_name, account_holder, account_number, ifsc, iban, swift_code, branch,
                                                  is_primary, verified, active)
    values (r.employee_id, b ->> 'bank_name', b ->> 'account_holder', b ->> 'account_number', b ->> 'ifsc', b ->> 'iban', b ->> 'swift_code',
            b ->> 'branch', true, false, true);
    prev := prev || jsonb_build_object('bank_account_id', v_old);
  end if;
  update public.hr_request_sensitive set previous = prev, updated_at = now() where request_id = p_request;
  insert into public.hr_employee_history (employee_id, change_type, new_value, note, changed_by)
  values (r.employee_id, 'note', 'Profile change applied: ' ||
            (select string_agg(hr_internal.profile_field_label(f), ', ') from jsonb_array_elements_text(r.details -> 'fields') f),
          'Approved HR request ' || r.id::text, auth.uid());
end $$;

-- Final approval: hand over to the owning module / fulfilment step.
create or replace function hr_internal.request_finalize(p_request uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.hr_requests; v_id uuid; el jsonb; v public.hr_salary_advances; v_receipt text;
begin
  select * into r from public.hr_requests where id = p_request;
  if r.workflow = 'hr_letter' then
    update public.hr_requests set status = 'approved', decided_at = now(), last_activity_at = now() where id = r.id;
    perform hr_internal.request_event(r.id, 'approved', null, null, 'pending_approval', 'approved');
    perform hr_internal.notify_requester(r.id, 'hr_request.approved', 'HR letter request approved', 'HR will issue your letter.');
  elsif r.workflow = 'profile_change' then
    perform hr_internal.apply_profile_change(r.id);
    update public.hr_requests set status = 'completed', decided_at = now(), completed_at = now(), last_activity_at = now() where id = r.id;
    perform hr_internal.request_event(r.id, 'approved', null, null, 'pending_approval', 'approved');
    perform hr_internal.request_event(r.id, 'profile_applied',
      case when coalesce((r.details ->> 'includes_bank')::boolean, false)
           then 'Approved values applied to the employee record. The new bank account awaits verification by a second Payroll user.'
           else 'Approved values applied to the employee record.' end, null, 'approved', 'completed');
    perform hr_internal.notify_requester(r.id, 'hr_request.completed', 'Profile change approved', 'Your profile has been updated.');
  elsif r.workflow = 'reimbursement' then
    select a.storage_path into v_receipt from public.hr_request_attachments a
     where a.request_id = r.id and a.kind = 'receipt' and a.removed_at is null order by a.created_at limit 1;
    -- Single authoritative claim record in Payroll (Module 7), already approved; paid only through a payroll run.
    insert into public.hr_reimbursements (employee_id, claim_date, category, amount, description, receipt_path, status,
                                          decided_by, decided_at, decision_note)
    values (r.employee_id, (r.details ->> 'expense_date')::date, r.details ->> 'category', (r.details ->> 'amount')::numeric,
            left(r.details ->> 'purpose', 2000), left('hr-request-files/' || v_receipt, 500), 'approved', auth.uid(), now(),
            'Approved through HR request ' || r.id::text)
    returning id into v_id;
    update public.hr_requests set status = 'approved', decided_at = now(), last_activity_at = now(),
           linked_entity_type = 'hr_reimbursements', linked_entity_id = v_id where id = r.id;
    perform hr_internal.request_event(r.id, 'approved', null, null, 'pending_approval', 'approved');
    perform hr_internal.request_event(r.id, 'claim_recorded', 'Approved claim recorded in Payroll; it is paid with the next payroll run.');
    perform hr_internal.notify_requester(r.id, 'hr_request.approved', 'Reimbursement approved', 'It will be paid with the next payroll run.');
  elsif r.workflow = 'salary_advance' then
    el := hr_internal.advance_eligibility(r.employee_id, r.id);
    select * into v from public.hr_salary_advances where request_id = r.id for update;
    if not (el ->> 'enabled')::boolean then
      perform hr_private.fail('Salary advances are disabled by company policy; this request cannot be approved now.', 'advances_disabled');
    end if;
    if v.amount > (el ->> 'max_permitted')::numeric then
      perform hr_private.fail('The requested amount now exceeds the maximum permitted advance. Return the request for correction.', 'over_limit');
    end if;
    update public.hr_salary_advances set status = 'approved' where id = v.id;
    update public.hr_requests set status = 'approved', decided_at = now(), last_activity_at = now() where id = r.id;
    perform hr_internal.request_event(r.id, 'approved', null, null, 'pending_approval', 'approved');
    perform hr_internal.notify_requester(r.id, 'hr_request.approved', 'Salary advance approved', 'Review and accept the repayment agreement to continue.');
  end if;
end $$;

-- Payment status of request-originated reimbursements follows Payroll (trigger on Module 7's table).
create or replace function hr_internal.reimbursement_request_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_req uuid;
begin
  select id into v_req from public.hr_requests where linked_entity_type = 'hr_reimbursements' and linked_entity_id = new.id;
  if v_req is null then return new; end if;
  if new.status = 'paid' and old.status is distinct from 'paid' then
    update public.hr_requests set status = 'completed', completed_at = now(), last_activity_at = now() where id = v_req and status = 'approved';
    perform hr_internal.request_event(v_req, 'payment_status', 'Paid through payroll.', null, 'approved', 'completed');
    perform hr_internal.notify_requester(v_req, 'hr_request.payment', 'Reimbursement paid', 'Your reimbursement was paid with payroll.');
  elsif new.payroll_run_id is not null and old.payroll_run_id is null then
    perform hr_internal.request_event(v_req, 'payment_status', 'Included in a payroll run.');
    perform hr_internal.notify_requester(v_req, 'hr_request.payment', 'Reimbursement scheduled for payment', 'Your claim was added to a payroll run.');
  elsif new.payroll_run_id is null and old.payroll_run_id is not null and new.status = 'approved' then
    perform hr_internal.request_event(v_req, 'payment_status', 'Removed from a payroll run that was recalculated; awaiting the next run.');
  end if;
  return new;
end $$;
create trigger hr_reimbursements_request_sync after update on public.hr_reimbursements
  for each row execute function hr_internal.reimbursement_request_sync();

-- Inbox rows (requests + Module 5 attendance corrections) visible to the caller.
create or replace function hr_internal.inbox_rows(f jsonb)
returns setof jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := hr_private.current_employee_id();
  v_wf text := nullif(f ->> 'workflow', '');
  v_emp uuid := nullif(f ->> 'employee', '')::uuid;
  v_dept uuid := nullif(f ->> 'department', '')::uuid;
  v_entity uuid := nullif(f ->> 'legal_entity', '')::uuid;
  v_approver uuid := nullif(f ->> 'approver', '')::uuid;
  v_from date := nullif(f ->> 'from', '')::date;
  v_to date := nullif(f ->> 'to', '')::date;
  v_search text := nullif(btrim(regexp_replace(coalesce(f ->> 'search', ''), '[%_\\]', ' ', 'g')), '');
  v_att boolean := hr_private.has_permission('attendance.approve') or hr_private.has_permission('attendance.approve_team');
  v_att_sla int := coalesce((hr_private.setting('hr_requests') ->> 'attendance_correction_sla_hours')::int, 48);
begin
  if auth.uid() is null then return; end if;
  return query
  select jsonb_build_object(
      'source', 'request', 'id', r.id, 'request_id', r.id, 'workflow', r.workflow, 'category', c.name, 'category_code', c.code,
      'subject', r.subject, 'employee_id', e.id, 'employee_code', e.employee_code,
      'employee_name', coalesce(nullif(e.display_name, ''), btrim(e.first_name || ' ' || e.last_name)),
      'department_id', e.department_id, 'department', d.name, 'legal_entity_id', e.legal_entity_id,
      'status', r.status, 'priority', r.priority, 'is_confidential', r.is_confidential,
      'stage_id', a.id, 'stage_role', a.stage_role, 'assigned_to', r.assigned_to,
      'submitted_at', coalesce(r.submitted_at, r.created_at), 'sla_due_at', r.sla_due_at,
      'overdue', coalesce(r.sla_due_at < now() and r.status in ('open','in_progress','waiting_on_employee','pending_approval','approved'), false),
      'next_action', case when a.id is not null then case when hr_internal.stage_can_act(a.id) is not null then 'decide' end
                          when r.workflow = 'helpdesk' then case when r.status in ('open','in_progress','waiting_on_employee')
                                                                   and hr_private.request_can_handle(r.id)
                                                                   and (r.assigned_to is null or r.assigned_to = v_me) then 'respond' end
                          else hr_internal.request_pending_action(r.id) end,
      'created_at', r.created_at)
  from public.hr_requests r
  join public.hr_request_categories c on c.id = r.category_id
  join public.hr_employees e on e.id = r.employee_id
  left join public.hr_departments d on d.id = e.department_id
  left join public.hr_request_approvals a on a.request_id = r.id and a.status = 'pending'
  where r.status <> 'draft' and r.employee_id is distinct from v_me
    and hr_private.request_row_visible(r.id)
    and (v_wf is null or r.workflow = v_wf)
    and (v_emp is null or r.employee_id = v_emp)
    and (v_dept is null or e.department_id = v_dept)
    and (v_entity is null or e.legal_entity_id = v_entity)
    and (v_from is null or coalesce(r.submitted_at, r.created_at) >= v_from::timestamptz)
    and (v_to is null or coalesce(r.submitted_at, r.created_at) < (v_to + 1)::timestamptz)
    and (v_approver is null or r.assigned_to = v_approver
         or exists (select 1 from public.hr_request_approvals x where x.request_id = r.id
                    and v_approver in (x.approver_employee_id, x.delegate_employee_id, x.decided_by_employee_id)))
    and (v_search is null or r.subject ilike '%' || v_search || '%' or e.employee_code ilike '%' || v_search || '%'
         or (e.first_name || ' ' || e.last_name) ilike '%' || v_search || '%')
  union all
  select jsonb_build_object(
      'source', 'attendance_correction', 'id', k.id, 'request_id', null, 'workflow', 'attendance_correction',
      'category', 'Attendance correction', 'category_code', 'attendance_correction',
      'subject', 'Attendance correction: ' || to_char(k.work_date, 'DD Mon YYYY')
                 || coalesce(' (' || replace(to_jsonb(k) ->> 'request_type', '_', ' ') || ')', ''),
      'employee_id', e.id, 'employee_code', e.employee_code,
      'employee_name', coalesce(nullif(e.display_name, ''), btrim(e.first_name || ' ' || e.last_name)),
      'department_id', e.department_id, 'department', d.name, 'legal_entity_id', e.legal_entity_id,
      'status', case k.status when 'pending' then 'pending_approval' else k.status end, 'priority', 'medium', 'is_confidential', false,
      'stage_id', null, 'stage_role', case when k.status = 'pending' then coalesce(to_jsonb(k) ->> 'approval_stage', 'manager') end,
      'assigned_to', null, 'submitted_at', k.created_at, 'sla_due_at', k.created_at + make_interval(hours => v_att_sla),
      'overdue', k.status = 'pending' and k.created_at + make_interval(hours => v_att_sla) < now(),
      'next_action', case when k.status = 'pending' and (case when to_jsonb(k) ->> 'approval_stage' = 'hr'
                                                              then hr_private.has_permission('attendance.approve') and k.employee_id is distinct from v_me
                                                              else hr_private.can_act_on_employee(k.employee_id, 'attendance.approve', 'attendance.approve_team') end)
                          then 'decide' end,
      'work_date', k.work_date, 'requested_check_in_at', k.requested_check_in_at, 'requested_check_out_at', k.requested_check_out_at,
      'request_type', to_jsonb(k) ->> 'request_type', 'requested_status', to_jsonb(k) ->> 'requested_status',
      'reason', k.reason, 'evidence_note', to_jsonb(k) ->> 'evidence_note', 'review_note', k.review_note,
      'created_at', k.created_at)
  from public.hr_attendance_corrections k
  join public.hr_employees e on e.id = k.employee_id
  left join public.hr_departments d on d.id = e.department_id
  where v_att and (v_wf is null or v_wf = 'attendance_correction')
    and k.employee_id is distinct from v_me
    and hr_private.can_access_employee(k.employee_id, 'attendance')
    and (v_emp is null or k.employee_id = v_emp)
    and (v_dept is null or e.department_id = v_dept)
    and (v_entity is null or e.legal_entity_id = v_entity)
    and (v_from is null or k.created_at >= v_from::timestamptz)
    and (v_to is null or k.created_at < (v_to + 1)::timestamptz)
    and (v_approver is null or v_approver = k.reviewer_employee_id or v_approver::text = to_jsonb(k) ->> 'manager_employee_id')
    and (v_search is null or e.employee_code ilike '%' || v_search || '%' or (e.first_name || ' ' || e.last_name) ilike '%' || v_search || '%');
end $$;

create or replace function hr_internal.mask(p text)
returns text language sql immutable set search_path = '' as $$
  select case when p is null then null when length(p) <= 4 then '••••' else '••••' || right(p, 4) end
$$;

-- Current vs proposed values, field by field, for the caller.
create or replace function hr_internal.profile_diff(p_request uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.hr_requests; s public.hr_request_sensitive; v_me uuid := hr_private.current_employee_id();
  v_req boolean; v_hr boolean := hr_private.has_permission('hr_requests.manage');
  v_view_sensitive boolean := hr_private.has_permission('employees.view_sensitive');
  v_pay boolean := hr_private.has_permission('hr_requests.payroll');
  v_pay_view boolean := hr_private.has_permission('payroll.view');
  v_done boolean; cur jsonb; c jsonb; b jsonb; k text; v_rows jsonb := '[]'::jsonb; cb record; v_cur_val text;
begin
  select * into r from public.hr_requests where id = p_request;
  select * into s from public.hr_request_sensitive where request_id = p_request;
  v_req := coalesce(r.employee_id = v_me, false);
  v_done := r.status = 'completed';
  cur := hr_internal.profile_current(r.employee_id);
  c := coalesce(s.payload -> 'contact', '{}'::jsonb);
  b := s.payload -> 'bank';
  for k in select jsonb_object_keys(c) order by 1 loop
    v_cur_val := case when v_done then s.previous ->> k else cur ->> k end;
    v_rows := v_rows || jsonb_build_object('field', k, 'label', hr_internal.profile_field_label(k), 'group', 'contact',
      'current', case when v_req or (v_hr and v_view_sensitive) then to_jsonb(v_cur_val) else '"[restricted]"'::jsonb end,
      'proposed', case when v_req or v_hr then c -> k else '"[restricted]"'::jsonb end,
      'current_label', case when v_done then 'Previous' else 'Current' end);
  end loop;
  if b is not null then
    select a.bank_name, a.account_holder, a.account_number, a.ifsc, a.iban into cb
      from public.hr_employee_bank_accounts a
     where a.employee_id = r.employee_id
       and (case when v_done then a.id = (s.previous ->> 'bank_account_id')::uuid else a.active and a.is_primary end)
     order by a.created_at desc limit 1;
    v_rows := v_rows || jsonb_build_object('field', 'bank_account', 'label', 'Bank account', 'group', 'bank',
      'current', case when v_pay and v_pay_view then jsonb_strip_nulls(jsonb_build_object('bank_name', cb.bank_name, 'account_holder', cb.account_holder,
                                                                         'account_number', cb.account_number, 'ifsc', cb.ifsc, 'iban', cb.iban))
                      when v_req or v_pay then jsonb_strip_nulls(jsonb_build_object('bank_name', cb.bank_name, 'account_number', hr_internal.mask(cb.account_number)))
                      else '"[restricted]"'::jsonb end,
      'proposed', case when v_pay then b
                       when v_req then b || jsonb_strip_nulls(jsonb_build_object('account_number', hr_internal.mask(b ->> 'account_number'),
                                                                                 'iban', hr_internal.mask(b ->> 'iban')))
                       else '"[restricted]"'::jsonb end,
      'current_label', case when v_done then 'Previous' else 'Current' end);
  end if;
  return v_rows;
end $$;

-- ---------------------------------------------------------------------
-- 10. Existing helpdesk RPCs (111) — same signatures, scoped handling
-- ---------------------------------------------------------------------
create or replace function public.hr_create_hr_request(p_category text, p_subject text, p_description text,
                                                       p_priority text default 'medium')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid := hr_private.current_employee_id(); v_cat public.hr_request_categories; v_id uuid;
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  select * into v_cat from public.hr_request_categories where code = p_category and active;
  if v_cat.id is null then perform hr_private.fail('Choose a request category.', 'invalid_category'); end if;
  if v_cat.workflow <> 'helpdesk' then
    perform hr_private.fail('Use the "' || v_cat.name || '" form for this request type.', 'use_workflow');
  end if;
  if length(btrim(coalesce(p_subject, ''))) not between 3 and 200 then
    perform hr_private.fail('Enter a subject (3 to 200 characters).', 'invalid_subject');
  end if;
  if nullif(btrim(p_description), '') is null then perform hr_private.fail('Describe your request.', 'invalid_description'); end if;
  if coalesce(p_priority, 'medium') not in ('low','medium','high','urgent') then
    perform hr_private.fail('Unknown priority.', 'invalid_priority');
  end if;
  insert into public.hr_requests (employee_id, category_id, subject, description, priority, is_confidential, sla_due_at, created_by, submitted_at)
  values (v_me, v_cat.id, btrim(p_subject), btrim(p_description), coalesce(p_priority, 'medium'), v_cat.is_confidential,
          now() + make_interval(hours => v_cat.sla_hours), auth.uid(), now())
  returning id into v_id;
  perform hr_internal.request_event(v_id, 'submitted', null, null, null, 'open');
  perform hr_internal.request_notify_staff(v_id, 'New HR request: ' || v_cat.name,
    case when v_cat.is_confidential then 'A confidential request was submitted.' else btrim(p_subject) end);
  return v_id;
end $$;

create or replace function public.hr_comment_hr_request(p_request uuid, p_body text, p_internal boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_r       public.hr_requests;
  v_me      uuid := hr_private.current_employee_id();
  v_handler boolean;
  v_approver boolean;
  v_req     boolean;
  v_id      uuid;
begin
  select * into v_r from public.hr_requests where id = p_request for update;
  if v_r.id is null or not hr_private.request_row_visible(v_r.id) then
    perform hr_private.fail('Request not found.', 'not_found');
  end if;
  v_req := coalesce(v_r.employee_id = v_me, false);
  v_handler := hr_private.request_can_handle(v_r.id);
  v_approver := not v_req and exists (select 1 from public.hr_request_approvals a where a.request_id = v_r.id
                  and (hr_internal.stage_can_act(a.id) is not null or a.decided_by = auth.uid()
                       or v_me in (a.approver_employee_id, a.delegate_employee_id)));
  if nullif(btrim(p_body), '') is null then perform hr_private.fail('Write a comment.', 'invalid'); end if;
  if length(btrim(p_body)) > 8000 then perform hr_private.fail('8000 characters maximum.', 'invalid'); end if;
  if coalesce(p_internal, false) and (v_req or not v_handler) then
    perform hr_private.fail('Only HR staff can add internal notes on requests they handle.', 'forbidden');
  end if;
  if not v_req and not v_handler and not v_approver then
    perform hr_private.fail('You are not allowed to respond to HR requests.', 'forbidden');
  end if;
  if v_r.status in ('closed','cancelled','completed','rejected','draft') and not coalesce(p_internal, false) then
    perform hr_private.fail(case when v_r.status = 'closed' then 'This request is closed. Reopen it to continue the conversation.'
                                 else 'This request is ' || v_r.status || '; the conversation is closed.' end, 'invalid_state');
  end if;
  insert into public.hr_request_comments (request_id, author_user_id, author_employee_id, body, is_internal)
  values (v_r.id, auth.uid(), v_me, btrim(p_body), coalesce(p_internal, false))
  returning id into v_id;
  update public.hr_requests
     set last_activity_at = now(),
         status = case when v_req and status = 'waiting_on_employee' then 'in_progress' else status end
   where id = v_r.id;
  if v_req then
    if v_r.workflow = 'helpdesk' or v_r.status <> 'pending_approval' then
      perform hr_internal.request_notify_staff(v_r.id, 'Requester replied: ' || v_r.subject, null);
    else
      perform hr_internal.notify_stage(v_r.id);
    end if;
  elsif not coalesce(p_internal, false) then
    perform hr_private.notify_employee(v_r.employee_id, 'hr_request', 'New comment on your request', v_r.subject,
      '/employee/requests/' || v_r.id, 'hr_request', v_r.id::text);
  end if;
  return v_id;
end $$;

create or replace function public.hr_assign_hr_request(p_request uuid, p_assignee uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.hr_requests; v_user uuid;
begin
  select * into v_r from public.hr_requests where id = p_request for update;
  if v_r.id is null or not hr_private.request_row_visible(v_r.id) then perform hr_private.fail('Request not found.', 'not_found'); end if;
  if v_r.employee_id = hr_private.current_employee_id() then
    perform hr_private.fail('You cannot handle your own request.', 'self_action');
  end if;
  if not hr_private.request_can_handle(v_r.id) then
    perform hr_private.fail('You are not allowed to manage HR requests.', 'forbidden');
  end if;
  if v_r.status in ('closed','cancelled','completed','rejected') then perform hr_private.fail('This request is closed.', 'invalid_state'); end if;
  if p_assignee is not null then
    if p_assignee = v_r.employee_id then perform hr_private.fail('A request cannot be assigned to the requester.', 'invalid_assignee'); end if;
    v_user := hr_private.employee_user_id(p_assignee);
    if v_user is null or not exists (select 1 from hr_internal.request_handler_users(v_r.id) u where u = v_user) then
      perform hr_private.fail('Requests can only be assigned to HR staff who handle this type of request.', 'invalid_assignee');
    end if;
  end if;
  update public.hr_requests
     set assigned_to = p_assignee, last_activity_at = now(),
         status = case when p_assignee is not null and status = 'open' then 'in_progress' else status end
   where id = v_r.id;
  if p_assignee is not null then
    perform hr_private.notify_employee(p_assignee, 'hr_request', 'HR request assigned to you', v_r.subject,
      '/hr/requests/' || v_r.id, 'hr_request', v_r.id::text);
  end if;
end $$;

create or replace function public.hr_update_hr_request_status(p_request uuid, p_status text, p_resolution text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.hr_requests; v_res text := nullif(btrim(p_resolution), '');
begin
  select * into v_r from public.hr_requests where id = p_request for update;
  if v_r.id is null or not hr_private.request_row_visible(v_r.id) then perform hr_private.fail('Request not found.', 'not_found'); end if;
  if v_r.employee_id = hr_private.current_employee_id() then
    perform hr_private.fail('You cannot handle your own request.', 'self_action');
  end if;
  if not hr_private.request_can_handle(v_r.id) then
    perform hr_private.fail('You are not allowed to manage HR requests.', 'forbidden');
  end if;
  if v_r.workflow <> 'helpdesk' then
    perform hr_private.fail('This request follows an approval workflow. Use approve, reject or return instead.', 'use_workflow');
  end if;
  if p_status is null or p_status not in ('open','in_progress','waiting_on_employee','resolved','closed') then
    perform hr_private.fail('Unknown status.', 'invalid_status');
  end if;
  if v_r.status in ('closed','cancelled') then
    perform hr_private.fail('This request is closed.', 'invalid_state');
  end if;
  if p_status = 'resolved' and v_res is null then
    perform hr_private.fail('Describe the resolution before resolving the request.', 'resolution_required');
  end if;
  if p_status = 'closed' and coalesce(v_res, v_r.resolution) is null then
    perform hr_private.fail('Describe the resolution before closing the request.', 'resolution_required');
  end if;
  update public.hr_requests
     set status = p_status,
         resolution = coalesce(v_res, resolution),
         resolved_at = case when p_status = 'resolved' then now()
                            when p_status = 'closed' then coalesce(resolved_at, now())
                            else null end,
         closed_at = case when p_status = 'closed' then now() else null end,
         last_activity_at = now()
   where id = v_r.id;
  if p_status is distinct from v_r.status then
    perform hr_internal.request_event(v_r.id, 'updated', null, null, v_r.status, p_status);
    perform hr_private.notify_employee(v_r.employee_id, 'hr_request',
      'Your HR request is now ' || replace(p_status, '_', ' '), v_r.subject, '/employee/requests/' || v_r.id, 'hr_request', v_r.id::text);
  end if;
end $$;

create or replace function public.hr_close_hr_request(p_request uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.hr_requests;
begin
  select * into v_r from public.hr_requests where id = p_request for update;
  if v_r.id is null or v_r.employee_id is distinct from hr_private.current_employee_id() then
    perform hr_private.fail('Request not found.', 'not_found');
  end if;
  if v_r.workflow <> 'helpdesk' or v_r.status <> 'resolved' then perform hr_private.fail('Only resolved requests can be closed.', 'invalid_state'); end if;
  update public.hr_requests set status = 'closed', closed_at = now(), last_activity_at = now() where id = v_r.id;
end $$;

create or replace function public.hr_reopen_hr_request(p_request uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.hr_requests;
        v_days int := coalesce((hr_private.setting('hr_requests') ->> 'reopen_window_days')::int, 7);
begin
  select * into v_r from public.hr_requests where id = p_request for update;
  if v_r.id is null or v_r.employee_id is distinct from hr_private.current_employee_id() then
    perform hr_private.fail('Request not found.', 'not_found');
  end if;
  if v_r.workflow <> 'helpdesk' or v_r.status not in ('resolved','closed') or v_r.resolved_at is null then
    perform hr_private.fail('Only resolved or closed requests can be reopened.', 'invalid_state');
  end if;
  if v_r.resolved_at < now() - make_interval(days => v_days) then
    perform hr_private.fail(format('Requests can only be reopened within %s days of resolution. Please raise a new request.', v_days), 'reopen_window_passed');
  end if;
  update public.hr_requests
     set status = 'open', resolved_at = null, closed_at = null, last_activity_at = now()
   where id = v_r.id;
  insert into public.hr_request_comments (request_id, author_user_id, author_employee_id, body, is_internal)
  values (v_r.id, auth.uid(), v_r.employee_id, 'Request reopened' || coalesce(': ' || nullif(btrim(p_reason), ''), '.'), false);
  perform hr_internal.request_notify_staff(v_r.id, 'HR request reopened: ' || v_r.subject, nullif(btrim(p_reason), ''));
end $$;

create or replace function public.hr_cancel_hr_request(p_request uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.hr_requests;
begin
  select * into v_r from public.hr_requests where id = p_request for update;
  if v_r.id is null or v_r.employee_id is distinct from hr_private.current_employee_id() then
    perform hr_private.fail('Request not found.', 'not_found');
  end if;
  if v_r.workflow = 'helpdesk' then
    if v_r.status <> 'open' then perform hr_private.fail('Only open requests can be cancelled.', 'invalid_state'); end if;
  elsif v_r.status not in ('draft','pending_approval','returned') then
    perform hr_private.fail('Only requests that are not yet approved can be cancelled.', 'invalid_state');
  end if;
  update public.hr_request_approvals set status = 'cancelled' where request_id = v_r.id and status in ('pending','waiting');
  update public.hr_salary_advances set status = 'cancelled' where request_id = v_r.id;
  update public.hr_requests set status = 'cancelled', cancelled_at = now(), last_activity_at = now() where id = v_r.id;
  perform hr_internal.request_event(v_r.id, 'cancelled', null, null, v_r.status, 'cancelled');
end $$;

-- The 111 copies were re-granted by later blanket hr_private grants (X7).
drop function hr_private.request_notify_staff(uuid, text, text);
drop function hr_private.request_staff_users(text);

-- ---------------------------------------------------------------------
-- 11. Workflow request RPCs
-- ---------------------------------------------------------------------
create or replace function public.hr_create_workflow_request(p_category text, p_details jsonb, p_sensitive jsonb default null,
                                                             p_submit boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid := hr_private.current_employee_id(); v_cat public.hr_request_categories; n jsonb; v_id uuid;
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  select * into v_cat from public.hr_request_categories where code = p_category and active;
  if v_cat.id is null then
    if exists (select 1 from public.hr_request_categories where code = p_category and workflow = 'salary_advance') then
      perform hr_private.fail('Salary advances are not available: the company policy has not been enabled.', 'advances_disabled');
    end if;
    perform hr_private.fail('Choose a request type.', 'invalid_category');
  end if;
  if v_cat.workflow = 'helpdesk' then perform hr_private.fail('Use the HR question form for this category.', 'invalid_category'); end if;
  n := hr_internal.normalize_request(v_cat.workflow, v_me, p_details, p_sensitive, null);
  insert into public.hr_requests (employee_id, category_id, subject, description, priority, is_confidential, workflow, details, status, created_by)
  values (v_me, v_cat.id, n ->> 'subject', n ->> 'description', 'medium', v_cat.is_confidential, v_cat.workflow, n -> 'details', 'draft', auth.uid())
  returning id into v_id;
  if v_cat.workflow = 'profile_change' then
    insert into public.hr_request_sensitive (request_id, payload) values (v_id, coalesce(n -> 'sensitive', '{}'::jsonb));
  end if;
  perform hr_internal.request_event(v_id, 'created', null, null, null, 'draft');
  if coalesce(p_submit, true) then perform hr_internal.submit_request(v_id); end if;
  return v_id;
end $$;

create or replace function public.hr_update_workflow_request(p_request uuid, p_details jsonb, p_sensitive jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.hr_requests; n jsonb;
begin
  select * into r from public.hr_requests where id = p_request for update;
  if r.id is null or r.employee_id is distinct from hr_private.current_employee_id() then perform hr_private.fail('Request not found.', 'not_found'); end if;
  if r.workflow = 'helpdesk' or r.status not in ('draft','returned') then
    perform hr_private.fail('Only draft or returned requests can be edited.', 'invalid_state');
  end if;
  n := hr_internal.normalize_request(r.workflow, r.employee_id, p_details,
         case when r.workflow = 'profile_change' then coalesce(p_sensitive, '{}'::jsonb) end, r.id);
  update public.hr_requests set subject = n ->> 'subject', description = n ->> 'description', details = n -> 'details', last_activity_at = now()
   where id = r.id;
  if r.workflow = 'profile_change' then
    update public.hr_request_sensitive set payload = coalesce(n -> 'sensitive', '{}'::jsonb), updated_at = now() where request_id = r.id;
  end if;
  perform hr_internal.request_event(r.id, 'updated', 'Request details edited by the requester.');
end $$;

create or replace function public.hr_submit_workflow_request(p_request uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.hr_requests;
begin
  select * into r from public.hr_requests where id = p_request for update;
  if r.id is null or r.employee_id is distinct from hr_private.current_employee_id() then perform hr_private.fail('Request not found.', 'not_found'); end if;
  if r.workflow = 'helpdesk' then perform hr_private.fail('Only workflow requests are submitted this way.', 'invalid_state'); end if;
  perform hr_internal.submit_request(r.id);
  if nullif(btrim(p_note), '') is not null then
    insert into public.hr_request_comments (request_id, author_user_id, author_employee_id, body, is_internal)
    values (r.id, auth.uid(), r.employee_id, left(btrim(p_note), 8000), false);
  end if;
end $$;

-- Approve / reject / return the CURRENT stage. The stage id is the
-- idempotency key: a repeated or concurrent decision on the same stage is
-- refused (already_decided), never applied twice.
create or replace function public.hr_decide_request_stage(p_stage uuid, p_action text, p_comment text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.hr_request_approvals; r public.hr_requests; v_req uuid; v_basis text;
  v_me uuid := hr_private.current_employee_id(); v_comment text := nullif(btrim(p_comment), ''); v_next uuid; v_new text;
begin
  if auth.uid() is null then perform hr_private.fail('Sign in first.', 'not_authenticated'); end if;
  if p_action is null or p_action not in ('approve','reject','return') then
    perform hr_private.fail('Choose approve, reject or return for correction.', 'invalid_action');
  end if;
  select request_id into v_req from public.hr_request_approvals where id = p_stage;
  if v_req is null then perform hr_private.fail('Approval step not found.', 'not_found'); end if;
  select * into r from public.hr_requests where id = v_req for update;              -- lock order: request, then stage
  select * into a from public.hr_request_approvals where id = p_stage for update;
  if not hr_private.request_row_visible(r.id) and not (a.stage_role = 'manager' and hr_private.has_permission('hr_requests.manage')) then
    perform hr_private.fail('Approval step not found.', 'not_found');
  end if;
  if v_me is not null and r.employee_id = v_me then
    perform hr_private.fail('You cannot approve, reject or return your own request.', 'self_approval');
  end if;
  if a.status <> 'pending' or r.status <> 'pending_approval' then
    perform hr_private.fail(case when a.status = 'waiting' then 'This approval step is not active yet.'
                                 else 'This approval step has already been decided (' || a.status || ').' end, 'already_decided');
  end if;
  v_basis := hr_internal.stage_can_act(a.id);
  if v_basis is null then
    if a.stage_role <> 'manager' and not hr_private.has_permission(hr_internal.stage_permission(a.stage_role)) then
      perform hr_private.fail('You are not allowed to decide this approval step.', 'forbidden');
    end if;
    if exists (select 1 from public.hr_request_approvals x where x.request_id = a.request_id and x.round = a.round and x.id <> a.id
               and x.status = 'approved' and x.decided_by = auth.uid()) then
      perform hr_private.fail('You approved an earlier step of this request. A different approver must decide this step.', 'distinct_approver_required');
    end if;
    perform hr_private.fail('You are not allowed to decide this approval step.', 'forbidden');
  end if;
  if p_action in ('reject','return') and v_comment is null then
    perform hr_private.fail('Add a comment explaining the decision.', 'comment_required');
  end if;
  if length(v_comment) > 2000 then perform hr_private.fail('Comment: 2000 characters maximum.', 'invalid'); end if;

  update public.hr_request_approvals
     set status = case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'returned' end,
         decided_by = auth.uid(), decided_by_employee_id = v_me, decided_at = now(), decision_basis = v_basis, comment = v_comment
   where id = a.id returning * into a;
  perform hr_internal.request_event(r.id, 'stage_' || a.status, v_comment, a.stage_role);

  if p_action = 'approve' then
    select id into v_next from public.hr_request_approvals
     where request_id = r.id and round = a.round and status = 'waiting' order by stage_no limit 1;
    if v_next is not null then
      update public.hr_request_approvals set status = 'pending', activated_at = now() where id = v_next;
      update public.hr_requests set last_activity_at = now() where id = r.id;
      perform hr_internal.notify_stage(r.id);
    else
      perform hr_internal.request_finalize(r.id);
    end if;
  else
    v_new := case p_action when 'reject' then 'rejected' else 'returned' end;
    update public.hr_request_approvals set status = 'cancelled' where request_id = r.id and round = a.round and status = 'waiting';
    update public.hr_requests set status = v_new, decided_at = case when v_new = 'rejected' then now() end, last_activity_at = now() where id = r.id;
    update public.hr_salary_advances set status = v_new where request_id = r.id;
    perform hr_internal.request_event(r.id, v_new, v_comment, a.stage_role, 'pending_approval', v_new);
    perform hr_internal.notify_requester(r.id, 'hr_request.' || v_new,
      case when v_new = 'rejected' then 'Request rejected' else 'More information required' end,
      case when v_new = 'rejected' then 'Open the request to see the reason.' else 'Your request was returned for correction. Open it to update and resubmit.' end);
  end if;
  return jsonb_build_object('request_id', r.id, 'stage_id', a.id, 'stage_status', a.status,
                            'request_status', (select status from public.hr_requests where id = r.id));
end $$;

-- Delegate a pending manager stage (designated manager or HR).
create or replace function public.hr_delegate_request_stage(p_stage uuid, p_delegate uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.hr_request_approvals; r public.hr_requests; v_me uuid := hr_private.current_employee_id(); v_user uuid;
begin
  select * into a from public.hr_request_approvals where id = p_stage;
  if a.id is null then perform hr_private.fail('Approval step not found.', 'not_found'); end if;
  select * into r from public.hr_requests where id = a.request_id for update;
  select * into a from public.hr_request_approvals where id = p_stage for update;
  if a.status <> 'pending' or a.stage_role <> 'manager' then
    perform hr_private.fail('Only an active manager approval step can be delegated.', 'invalid_state');
  end if;
  if r.employee_id = v_me then perform hr_private.fail('You cannot delegate approval of your own request.', 'self_approval'); end if;
  if not ((v_me is not null and v_me = coalesce(a.delegate_employee_id, a.approver_employee_id) and hr_private.has_permission('hr_requests.approve_team'))
          or hr_private.has_permission('hr_requests.manage')) then
    perform hr_private.fail('You are not allowed to delegate this approval.', 'forbidden');
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then perform hr_private.fail('Give a reason for the delegation.', 'reason_required'); end if;
  v_user := hr_private.employee_user_id(p_delegate);
  if p_delegate is null or p_delegate = r.employee_id or p_delegate = v_me
     or not hr_internal.user_has_permission(v_user, 'hr_requests.approve_team') then
    perform hr_private.fail('Choose another manager who can approve requests (not the requester).', 'invalid_delegate');
  end if;
  update public.hr_request_approvals set delegate_employee_id = p_delegate, delegated_by = auth.uid(), delegated_at = now(),
         delegation_reason = left(btrim(p_reason), 1000) where id = a.id;
  perform hr_internal.request_event(r.id, 'delegated', btrim(p_reason), 'manager');
  perform hr_private.notify_employee(p_delegate, 'hr_request.approval', 'Approval delegated to you', 'A request is waiting for your approval.',
    '/hr/requests/' || r.id, 'hr_request', r.id::text);
end $$;

-- Managers the caller may delegate a stage to.
create or replace function public.hr_request_delegate_options(p_stage uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a public.hr_request_approvals; r public.hr_requests; v_me uuid := hr_private.current_employee_id();
begin
  select * into a from public.hr_request_approvals where id = p_stage;
  select * into r from public.hr_requests where id = a.request_id;
  if a.id is null or a.status <> 'pending' or a.stage_role <> 'manager'
     or not ((v_me is not null and v_me = coalesce(a.delegate_employee_id, a.approver_employee_id))
             or hr_private.has_permission('hr_requests.manage')) then
    return '[]'::jsonb;
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'employee_code', e.employee_code,
                     'name', coalesce(nullif(e.display_name, ''), btrim(e.first_name || ' ' || e.last_name))) order by e.first_name)
                   from public.hr_employees e
                   where e.user_id is not null and e.portal_access and e.status not in ('exited','archived','suspended')
                     and e.id <> r.employee_id and e.id is distinct from v_me
                     and hr_internal.user_has_permission(e.user_id, 'hr_requests.approve_team')), '[]'::jsonb);
end $$;

-- ---- attachments -----------------------------------------------------
create or replace function public.hr_register_request_attachment(p_request uuid, p_kind text, p_file_name text, p_mime_type text,
                                                                 p_size_bytes bigint, p_checksum text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.hr_requests; v_me uuid := hr_private.current_employee_id(); v_req boolean; v_name text; v_mime text := lower(btrim(coalesce(p_mime_type, '')));
  v_id uuid := gen_random_uuid(); v_path text; v_sum text := lower(nullif(btrim(p_checksum), '')); v_ok boolean := false;
begin
  if auth.uid() is null or hr_private.caller_is_revoked() then perform hr_private.fail('Sign in first.', 'not_authenticated'); end if;
  select * into r from public.hr_requests where id = p_request for update;
  if r.id is null or not hr_private.request_row_visible(r.id) then perform hr_private.fail('Request not found.', 'not_found'); end if;
  v_req := coalesce(r.employee_id = v_me, false);
  if p_kind in ('receipt','evidence','supporting') then
    v_ok := v_req and (r.status in ('draft','returned') or (r.workflow = 'helpdesk' and r.status in ('open','in_progress','waiting_on_employee')))
            and (p_kind <> 'receipt' or r.workflow = 'reimbursement');
    if not v_ok and r.workflow = 'helpdesk' and p_kind = 'supporting' and r.status in ('open','in_progress','waiting_on_employee') then
      v_ok := hr_private.request_can_handle(r.id);
    end if;
  elsif p_kind = 'issued_letter' then
    v_ok := hr_internal.can_issue_letter(r.id);
  elsif p_kind = 'payment_evidence' then
    v_ok := not v_req and r.workflow = 'salary_advance' and r.status = 'approved' and hr_private.has_permission('hr_requests.finance');
  else
    perform hr_private.fail('Unknown attachment type.', 'invalid');
  end if;
  if not v_ok then perform hr_private.fail('You cannot attach this file to the request at its current stage.', 'forbidden'); end if;
  if (select count(*) from public.hr_request_attachments where request_id = r.id and removed_at is null) >= 10 then
    perform hr_private.fail('A request can have at most 10 files.', 'too_many_files');
  end if;
  v_name := hr_private.document_validate_file(p_file_name, v_mime, p_size_bytes);
  if v_mime not in ('application/pdf','image/png','image/jpeg','image/webp') then
    perform hr_private.fail('Only PDF, PNG, JPEG and WEBP files can be attached to requests.', 'invalid_file_type');
  end if;
  if v_sum is not null and v_sum !~ '^[a-f0-9]{64}$' then v_sum := null; end if;
  v_path := r.id::text || '/' || v_id::text || '-' || v_name;
  insert into public.hr_request_attachments (id, request_id, kind, storage_path, file_name, mime_type, size_bytes, checksum, uploaded_by, uploaded_employee_id)
  values (v_id, r.id, p_kind, v_path, v_name, v_mime, p_size_bytes, v_sum, auth.uid(), v_me);
  perform hr_internal.request_event(r.id, 'attachment_added', replace(p_kind, '_', ' ') || ': ' || v_name);
  return jsonb_build_object('attachment_id', v_id, 'bucket', 'hr-request-files', 'storage_path', v_path);
end $$;

create or replace function public.hr_remove_request_attachment(p_attachment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.hr_request_attachments; r public.hr_requests;
begin
  select * into a from public.hr_request_attachments where id = p_attachment;
  if a.id is null then perform hr_private.fail('File not found.', 'not_found'); end if;
  select * into r from public.hr_requests where id = a.request_id for update;
  if a.removed_at is not null or a.uploaded_by is distinct from auth.uid() then perform hr_private.fail('File not found.', 'not_found'); end if;
  if a.kind in ('receipt','evidence','supporting') and not (r.status in ('draft','returned','open','in_progress','waiting_on_employee')) then
    perform hr_private.fail('Files cannot be removed once the request is submitted for approval.', 'invalid_state');
  end if;
  if a.kind in ('issued_letter','payment_evidence') and (r.issued_attachment_id = a.id
       or exists (select 1 from public.hr_salary_advances v where v.disbursement_attachment_id = a.id)) then
    perform hr_private.fail('This file is part of a completed step and cannot be removed.', 'invalid_state');
  end if;
  update public.hr_request_attachments set removed_at = now(), removed_by = auth.uid() where id = a.id;
  perform hr_internal.request_event(r.id, 'attachment_removed', a.file_name);
end $$;

-- ---- HR letters ------------------------------------------------------
create or replace function public.hr_issue_letter_request(p_request uuid, p_document uuid default null, p_attachment uuid default null,
                                                          p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.hr_requests; d public.hr_documents; a public.hr_request_attachments; v_salary boolean;
begin
  select * into r from public.hr_requests where id = p_request for update;
  if r.id is null or not hr_private.request_row_visible(r.id) or r.workflow <> 'hr_letter' then
    perform hr_private.fail('Request not found.', 'not_found');
  end if;
  if r.status = 'completed' then perform hr_private.fail('This letter has already been issued.', 'already_completed'); end if;
  if r.status <> 'approved' then perform hr_private.fail('The request must be approved before the letter is issued.', 'invalid_state'); end if;
  if r.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot issue a letter for your own request.', 'self_action'); end if;
  if not hr_internal.can_issue_letter(r.id) then
    perform hr_private.fail(case when r.details ->> 'letter_type' = 'salary_certificate'
                                 then 'Salary certificates can only be issued by staff authorised to see compensation.'
                                 else 'You are not allowed to issue HR letters.' end, 'forbidden');
  end if;
  v_salary := r.details ->> 'letter_type' = 'salary_certificate';
  if (p_document is null) = (p_attachment is null) then
    perform hr_private.fail('Choose the issued document or upload the letter file.', 'invalid');
  end if;
  if p_document is not null then
    select * into d from public.hr_documents where id = p_document;
    if d.id is null or d.employee_id <> r.employee_id or d.archived_at is not null or d.current_version < 1
       or not exists (select 1 from public.hr_document_categories c where c.id = d.category_id and c.employee_can_view and not c.is_confidential) then
      perform hr_private.fail('Choose an active document of this employee in a category the employee can view.', 'invalid_document');
    end if;
    -- includes_compensation exists once Module 9 (129) is applied; without it no document qualifies.
    if v_salary and coalesce((to_jsonb(d) ->> 'includes_compensation')::boolean, false) is not true then
      perform hr_private.fail('Salary certificates must be a compensation-restricted document or a restricted request file, so that compensation stays limited to authorised staff.', 'restricted_document');
    end if;
  else
    select * into a from public.hr_request_attachments where id = p_attachment;
    if a.id is null or a.request_id <> r.id or a.kind <> 'issued_letter' or a.removed_at is not null then
      perform hr_private.fail('Upload the letter file first.', 'invalid_attachment');
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'hr-request-files' and o.name = a.storage_path) then
      perform hr_private.fail('The letter file upload did not finish. Upload it again.', 'upload_incomplete');
    end if;
  end if;
  update public.hr_requests set status = 'completed', completed_at = now(), last_activity_at = now(),
         issued_document_id = p_document, issued_attachment_id = p_attachment, resolution = nullif(btrim(p_note), '')
   where id = r.id;
  perform hr_internal.request_event(r.id, 'letter_issued', nullif(btrim(p_note), ''), null, 'approved', 'completed');
  perform hr_internal.notify_requester(r.id, 'hr_request.completed', 'Your HR letter is ready', 'Download it from My HR Requests.');
  return jsonb_build_object('request_id', r.id, 'status', 'completed');
end $$;

-- Documents and uploaded files that may be used to issue this letter.
create or replace function public.hr_letter_issue_options(p_request uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.hr_requests; v_salary boolean;
begin
  select * into r from public.hr_requests where id = p_request;
  if r.id is null or not hr_internal.can_issue_letter(r.id) then return '[]'::jsonb; end if;
  v_salary := r.details ->> 'letter_type' = 'salary_certificate';
  return coalesce((select jsonb_agg(x order by x ->> 'created_at' desc) from (
      select jsonb_build_object('kind', 'document', 'id', d.id, 'label', d.title, 'created_at', d.created_at,
                                'includes_compensation', coalesce((to_jsonb(d) ->> 'includes_compensation')::boolean, false)) x
      from public.hr_documents d join public.hr_document_categories c on c.id = d.category_id
      where d.employee_id = r.employee_id and d.archived_at is null and d.current_version >= 1
        and c.employee_can_view and not c.is_confidential
        and (not v_salary or coalesce((to_jsonb(d) ->> 'includes_compensation')::boolean, false))
      union all
      select jsonb_build_object('kind', 'attachment', 'id', a.id, 'label', a.file_name || ' (uploaded file)', 'created_at', a.created_at)
      from public.hr_request_attachments a
      where a.request_id = r.id and a.kind = 'issued_letter' and a.removed_at is null
        and exists (select 1 from storage.objects o where o.bucket_id = 'hr-request-files' and o.name = a.storage_path)) s), '[]'::jsonb);
end $$;

-- ---- salary advances -------------------------------------------------
create or replace function public.hr_salary_advance_eligibility()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := hr_private.current_employee_id();
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  return hr_internal.advance_eligibility(v_me, null);
end $$;

create or replace function public.hr_accept_advance_agreement(p_request uuid, p_authorize_payroll_deduction boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.hr_requests; v public.hr_salary_advances; v_allow boolean := coalesce((hr_private.setting('salary_advances') ->> 'allow_payroll_deduction')::boolean, false);
begin
  select * into r from public.hr_requests where id = p_request for update;
  if r.id is null or r.employee_id is distinct from hr_private.current_employee_id() or r.workflow <> 'salary_advance' then
    perform hr_private.fail('Request not found.', 'not_found');
  end if;
  select * into v from public.hr_salary_advances where request_id = r.id for update;
  if v.status <> 'approved' then perform hr_private.fail('The agreement can be accepted only once, after approval.', 'invalid_state'); end if;
  if coalesce(p_authorize_payroll_deduction, false) and not v_allow then
    perform hr_private.fail('Payroll deduction of advances is not enabled; repayments will be recorded by Finance.', 'deduction_not_enabled');
  end if;
  update public.hr_salary_advances set status = 'agreed', agreement_accepted_at = now(), agreement_accepted_by = auth.uid(),
         payroll_deduction_authorized = coalesce(p_authorize_payroll_deduction, false),
         first_repayment_month = (date_trunc('month', hr_private.business_today()) + interval '1 month')::date
   where id = v.id returning * into v;
  perform hr_internal.request_event(r.id, 'agreement_accepted',
    case when v.payroll_deduction_authorized then 'Repayment agreement accepted; payroll deduction authorised.' else 'Repayment agreement accepted.' end);
  perform hr_private.notify_permission_holders('hr_requests.finance', 'hr_request.approval', 'Salary advance ready for disbursement',
    'An approved salary advance is waiting for disbursement.', '/hr/requests/' || r.id, 'hr_request', r.id::text, r.employee_id);
  return to_jsonb(v) - 'max_permitted';
end $$;

create or replace function public.hr_record_advance_disbursement(p_request uuid, p_amount numeric, p_reference text, p_paid_on date,
                                                                 p_attachment uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.hr_requests; v public.hr_salary_advances; v_ref text := btrim(coalesce(p_reference, ''));
begin
  select * into r from public.hr_requests where id = p_request for update;
  if r.id is null or r.workflow <> 'salary_advance' or not hr_private.request_row_visible(r.id) then perform hr_private.fail('Request not found.', 'not_found'); end if;
  if r.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot record payments for your own advance.', 'self_approval'); end if;
  if not hr_private.has_permission('hr_requests.finance') then perform hr_private.fail('Only Finance can record disbursements.', 'forbidden'); end if;
  select * into v from public.hr_salary_advances where request_id = r.id for update;
  if v.status in ('disbursement_recorded','repaying','repaid') then perform hr_private.fail('The disbursement has already been recorded.', 'already_disbursed'); end if;
  if v.status <> 'agreed' then perform hr_private.fail('The employee must accept the repayment agreement first.', 'invalid_state'); end if;
  if p_amount is null or round(p_amount, 2) <> v.amount then
    perform hr_private.fail('The disbursed amount must equal the approved amount.', 'invalid_amount');
  end if;
  if length(v_ref) < 3 or length(v_ref) > 120 then perform hr_private.fail('Enter the bank / payment reference.', 'reference_required'); end if;
  if exists (select 1 from public.hr_salary_advances x where upper(btrim(x.disbursement_reference)) = upper(v_ref)) then
    perform hr_private.fail('This payment reference is already recorded for another advance.', 'duplicate_reference');
  end if;
  if p_paid_on is null or p_paid_on > hr_private.business_today() or p_paid_on < r.decided_at::date then
    perform hr_private.fail('Enter the payment date (after approval, not in the future).', 'invalid_date');
  end if;
  if p_attachment is not null and not exists (select 1 from public.hr_request_attachments a where a.id = p_attachment and a.request_id = r.id
                                                and a.kind = 'payment_evidence' and a.removed_at is null) then
    perform hr_private.fail('Unknown payment evidence file.', 'invalid_attachment');
  end if;
  update public.hr_salary_advances set status = 'disbursement_recorded', disbursed_amount = v.amount, disbursement_reference = v_ref,
         disbursed_on = p_paid_on, disbursement_attachment_id = p_attachment, disbursement_recorded_by = auth.uid(), disbursement_recorded_at = now()
   where id = v.id returning * into v;
  perform hr_internal.request_event(r.id, 'disbursement_recorded', 'Disbursement recorded; awaiting verification by a second Finance user.');
  perform hr_private.notify_permission_holders('hr_requests.finance', 'hr_request.approval', 'Verify salary advance disbursement',
    'A recorded disbursement needs verification by a second Finance user.', '/hr/requests/' || r.id, 'hr_request', r.id::text, r.employee_id);
  return to_jsonb(v) - 'max_permitted';
end $$;

create or replace function public.hr_verify_advance_disbursement(p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.hr_requests; v public.hr_salary_advances;
begin
  select * into r from public.hr_requests where id = p_request for update;
  if r.id is null or r.workflow <> 'salary_advance' or not hr_private.request_row_visible(r.id) then perform hr_private.fail('Request not found.', 'not_found'); end if;
  if r.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot verify payments for your own advance.', 'self_approval'); end if;
  if not hr_private.has_permission('hr_requests.finance') then perform hr_private.fail('Only Finance can verify disbursements.', 'forbidden'); end if;
  select * into v from public.hr_salary_advances where request_id = r.id for update;
  if v.status in ('repaying','repaid') then perform hr_private.fail('The disbursement has already been verified.', 'already_verified'); end if;
  if v.status <> 'disbursement_recorded' then perform hr_private.fail('No recorded disbursement to verify.', 'invalid_state'); end if;
  if v.disbursement_recorded_by = auth.uid() then
    perform hr_private.fail('A different Finance user must verify the disbursement you recorded.', 'distinct_approver_required');
  end if;
  update public.hr_salary_advances set status = 'repaying', disbursement_verified_by = auth.uid(), disbursement_verified_at = now()
   where id = v.id returning * into v;
  update public.hr_requests set status = 'completed', completed_at = now(), last_activity_at = now() where id = r.id;
  perform hr_internal.request_event(r.id, 'disbursement_verified', 'Disbursement verified. Repayments are tracked on the advance.', null, 'approved', 'completed');
  perform hr_internal.notify_requester(r.id, 'hr_request.payment', 'Salary advance disbursed', 'Your salary advance was paid. Repayments are shown on the request.');
  return to_jsonb(v) - 'max_permitted';
end $$;

create or replace function public.hr_record_advance_repayment(p_request uuid, p_amount numeric, p_method text, p_reference text,
                                                              p_paid_on date, p_payroll_run uuid default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.hr_requests; v public.hr_salary_advances; run public.hr_payroll_runs; v_ref text := btrim(coalesce(p_reference, ''));
  v_balance numeric; v_amount numeric := round(p_amount, 2);
  v_allow boolean := coalesce((hr_private.setting('salary_advances') ->> 'allow_payroll_deduction')::boolean, false);
begin
  select * into r from public.hr_requests where id = p_request for update;
  if r.id is null or r.workflow <> 'salary_advance' or not hr_private.request_row_visible(r.id) then perform hr_private.fail('Request not found.', 'not_found'); end if;
  if r.employee_id = hr_private.current_employee_id() then perform hr_private.fail('You cannot record repayments for your own advance.', 'self_approval'); end if;
  if not (hr_private.has_permission('hr_requests.finance') or hr_private.has_permission('hr_requests.payroll')) then
    perform hr_private.fail('Only Finance or Payroll can record repayments.', 'forbidden');
  end if;
  select * into v from public.hr_salary_advances where request_id = r.id for update;
  if v.status <> 'repaying' then perform hr_private.fail('Repayments can be recorded only after the disbursement is verified.', 'invalid_state'); end if;
  v_balance := v.disbursed_amount - coalesce((select sum(amount) from public.hr_salary_advance_repayments where advance_id = v.id), 0);
  if v_amount is null or v_amount <= 0 or v_amount > v_balance then
    perform hr_private.fail('Enter an amount greater than zero and not more than the remaining balance (' || to_char(v_balance, 'FM999999999990.00') || ').', 'invalid_amount');
  end if;
  if p_method is null or p_method not in ('payroll_deduction','direct_payment') then perform hr_private.fail('Choose the repayment method.', 'invalid_method'); end if;
  if length(v_ref) < 3 or length(v_ref) > 120 then perform hr_private.fail('Enter the repayment reference.', 'reference_required'); end if;
  if exists (select 1 from public.hr_salary_advance_repayments x where x.advance_id = v.id and upper(btrim(x.reference)) = upper(v_ref)) then
    perform hr_private.fail('This repayment reference is already recorded.', 'duplicate_reference');
  end if;
  if p_paid_on is null or p_paid_on > hr_private.business_today() or p_paid_on < v.disbursed_on then
    perform hr_private.fail('Enter the repayment date (after the disbursement, not in the future).', 'invalid_date');
  end if;
  if p_method = 'payroll_deduction' then
    if not v_allow or not v.payroll_deduction_authorized then
      perform hr_private.fail('Payroll deduction is not authorised for this advance (policy and the employee''s agreement are both required).', 'deduction_not_authorised');
    end if;
    select * into run from public.hr_payroll_runs where id = p_payroll_run;
    if run.id is null or run.status not in ('finalized','paid') or run.period_end < v.disbursed_on then
      perform hr_private.fail('Choose the finalized payroll run in which the deduction was made.', 'invalid_payroll_run');
    end if;
    if exists (select 1 from public.hr_salary_advance_repayments x where x.advance_id = v.id and x.payroll_run_id = run.id) then
      perform hr_private.fail('A deduction for this payroll run is already recorded.', 'duplicate_reference');
    end if;
  elsif p_payroll_run is not null then
    perform hr_private.fail('A direct payment is not linked to a payroll run.', 'invalid');
  end if;
  insert into public.hr_salary_advance_repayments (advance_id, amount, method, reference, paid_on, payroll_run_id, note, recorded_employee_id)
  values (v.id, v_amount, p_method, v_ref, p_paid_on, case when p_method = 'payroll_deduction' then run.id end,
          left(nullif(btrim(p_note), ''), 1000), hr_private.current_employee_id());
  v_balance := v_balance - v_amount;
  if v_balance = 0 then
    update public.hr_salary_advances set status = 'repaid', repaid_at = now() where id = v.id;
    perform hr_internal.request_event(r.id, 'repayment_recorded', 'Final repayment recorded; the advance is fully repaid.');
    perform hr_internal.notify_requester(r.id, 'hr_request.payment', 'Salary advance fully repaid', 'Your salary advance has been fully repaid.');
  else
    perform hr_internal.request_event(r.id, 'repayment_recorded', 'Repayment recorded.');
    perform hr_internal.notify_requester(r.id, 'hr_request.payment', 'Advance repayment recorded', 'A repayment of your salary advance was recorded.');
  end if;
  return jsonb_build_object('advance_id', v.id, 'remaining_balance', v_balance, 'status', case when v_balance = 0 then 'repaid' else 'repaying' end);
end $$;

-- ---- read RPCs ------------------------------------------------------
create or replace function public.hr_request_detail(p_request uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.hr_requests; c public.hr_request_categories; e public.hr_employees; v public.hr_salary_advances;
  v_me uuid := hr_private.current_employee_id(); v_req boolean; v_money boolean; v_out jsonb; z public.hr_reimbursements; run public.hr_payroll_runs;
begin
  select * into r from public.hr_requests where id = p_request;
  if r.id is null or not hr_private.request_row_visible(r.id) then perform hr_private.fail('Request not found.', 'not_found'); end if;
  select * into c from public.hr_request_categories where id = r.category_id;
  select * into e from public.hr_employees where id = r.employee_id;
  v_req := coalesce(r.employee_id = v_me, false);
  v_money := v_req or hr_private.has_permission('hr_requests.finance') or hr_private.has_permission('hr_requests.payroll');
  v_out := (to_jsonb(r) - 'details') || jsonb_build_object(
    'details', r.details,
    'is_requester', v_req,
    'category', jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name, 'workflow', c.workflow, 'sla_hours', c.sla_hours,
                                   'requires_attachment', c.requires_attachment, 'approval_stages', c.approval_stages),
    'employee', jsonb_build_object('id', e.id, 'employee_code', e.employee_code, 'first_name', e.first_name, 'last_name', e.last_name,
                                   'display_name', e.display_name,
                                   'department', (select name from public.hr_departments where id = e.department_id),
                                   'company', (select name from public.hr_legal_entities where id = e.legal_entity_id)),
    'stages', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', a.id, 'round', a.round, 'stage_no', a.stage_no, 'stage_role', a.stage_role, 'status', a.status,
                 'approver', (select coalesce(nullif(x.display_name, ''), btrim(x.first_name || ' ' || x.last_name)) from public.hr_employees x where x.id = a.approver_employee_id),
                 'delegate', (select coalesce(nullif(x.display_name, ''), btrim(x.first_name || ' ' || x.last_name)) from public.hr_employees x where x.id = a.delegate_employee_id),
                 'decided_by', (select coalesce(nullif(x.display_name, ''), btrim(x.first_name || ' ' || x.last_name)) from public.hr_employees x where x.id = a.decided_by_employee_id),
                 'decided_at', a.decided_at, 'activated_at', a.activated_at, 'decision_basis', a.decision_basis, 'comment', a.comment,
                 'delegation_reason', a.delegation_reason,
                 'can_act', hr_internal.stage_can_act(a.id) is not null,
                 'can_delegate', a.status = 'pending' and a.stage_role = 'manager' and not v_req
                                 and ((v_me is not null and v_me = coalesce(a.delegate_employee_id, a.approver_employee_id)) or hr_private.has_permission('hr_requests.manage')))
               order by a.round, a.stage_no) from public.hr_request_approvals a where a.request_id = r.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', ev.id, 'action', ev.action, 'round', ev.round, 'stage_role', ev.stage_role,
                 'from_status', ev.from_status, 'to_status', ev.to_status, 'note', ev.note, 'created_at', ev.created_at,
                 'actor', (select coalesce(nullif(x.display_name, ''), btrim(x.first_name || ' ' || x.last_name)) from public.hr_employees x where x.id = ev.actor_employee_id))
               order by ev.created_at, ev.id) from public.hr_request_events ev where ev.request_id = r.id), '[]'::jsonb),
    'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'file_name', a.file_name, 'mime_type', a.mime_type,
                 'size_bytes', a.size_bytes, 'storage_path', a.storage_path, 'created_at', a.created_at, 'mine', a.uploaded_by = auth.uid(),
                 'uploaded', exists (select 1 from storage.objects o where o.bucket_id = 'hr-request-files' and o.name = a.storage_path))
               order by a.created_at) from public.hr_request_attachments a where a.request_id = r.id and hr_private.request_attachment_visible(a.id)), '[]'::jsonb),
    'can_handle', hr_private.request_can_handle(r.id),
    'pending_action', hr_internal.request_pending_action(r.id),
    'can_edit', v_req and r.workflow <> 'helpdesk' and r.status in ('draft','returned'),
    'can_cancel', v_req and ((r.workflow = 'helpdesk' and r.status = 'open') or (r.workflow <> 'helpdesk' and r.status in ('draft','pending_approval','returned'))));
  if r.workflow = 'profile_change' then
    v_out := v_out || jsonb_build_object('profile_changes', hr_internal.profile_diff(r.id));
  end if;
  if r.workflow = 'hr_letter' and r.issued_document_id is not null then
    v_out := v_out || jsonb_build_object('issued_document', (select jsonb_build_object('id', d.id, 'title', d.title) from public.hr_documents d where d.id = r.issued_document_id));
  end if;
  if r.workflow = 'salary_advance' and v_money then
    select * into v from public.hr_salary_advances where request_id = r.id;
    if v.id is not null then
      v_out := v_out || jsonb_build_object('advance', to_jsonb(v) || jsonb_build_object(
        'repaid', coalesce((select sum(p.amount) from public.hr_salary_advance_repayments p where p.advance_id = v.id), 0),
        'remaining_balance', case when v.disbursed_amount is null then null
                                  else v.disbursed_amount - coalesce((select sum(p.amount) from public.hr_salary_advance_repayments p where p.advance_id = v.id), 0) end,
        'repayments', coalesce((select jsonb_agg(to_jsonb(p) order by p.paid_on, p.created_at) from public.hr_salary_advance_repayments p where p.advance_id = v.id), '[]'::jsonb),
        'can_verify', v.status = 'disbursement_recorded' and not v_req and hr_private.has_permission('hr_requests.finance')
                      and v.disbursement_recorded_by is distinct from auth.uid(),
        'can_record_repayment', v.status = 'repaying' and not v_req
                                and (hr_private.has_permission('hr_requests.finance') or hr_private.has_permission('hr_requests.payroll'))));
    end if;
  end if;
  if r.linked_entity_type = 'hr_reimbursements' then
    select * into z from public.hr_reimbursements where id = r.linked_entity_id;
    select * into run from public.hr_payroll_runs where id = z.payroll_run_id;
    v_out := v_out || jsonb_build_object('payment', jsonb_strip_nulls(jsonb_build_object(
      'claim_status', z.status, 'payroll_period_start', run.period_start, 'payroll_period_end', run.period_end,
      'payroll_status', run.status, 'paid_at', run.paid_at,
      'payment_reference', case when hr_private.has_permission('hr_requests.finance') or hr_private.has_permission('payroll.view') then run.payment_reference end)));
  end if;
  return v_out;
end $$;

-- Centralized approval inbox. Boxes: assigned | pending | overdue | approved | rejected | returned | completed | all.
create or replace function public.hr_approval_inbox(p_box text default 'assigned', p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_status text := nullif(coalesce(p_filters, '{}'::jsonb) ->> 'status', '');
begin
  if auth.uid() is null then perform hr_private.fail('Sign in first.', 'not_authenticated'); end if;
  if coalesce(p_box, 'assigned') not in ('assigned','pending','overdue','approved','rejected','returned','completed','all') then
    perform hr_private.fail('Unknown inbox.', 'invalid');
  end if;
  return coalesce((
    select jsonb_agg(x order by (x ->> 'overdue')::boolean desc, x ->> 'submitted_at' desc)
    from (select x from hr_internal.inbox_rows(coalesce(p_filters, '{}'::jsonb)) x
          where case coalesce(p_box, 'assigned')
                  when 'assigned' then x ->> 'next_action' is not null
                  when 'pending' then x ->> 'status' in ('pending_approval','open','in_progress','waiting_on_employee')
                  when 'overdue' then (x ->> 'overdue')::boolean
                  when 'approved' then x ->> 'status' = 'approved'
                  when 'rejected' then x ->> 'status' = 'rejected'
                  when 'returned' then x ->> 'status' in ('returned','waiting_on_employee')
                  when 'completed' then x ->> 'status' in ('completed','resolved','closed')
                  else true end
            and (v_status is null or x ->> 'status' = v_status)
          order by (x ->> 'submitted_at') desc limit 1000) s), '[]'::jsonb);
end $$;

create or replace function public.hr_requests_overview(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then perform hr_private.fail('Sign in first.', 'not_authenticated'); end if;
  return (
    select jsonb_build_object(
      'total', count(*),
      'pending', count(*) filter (where x ->> 'status' in ('pending_approval','open','in_progress','waiting_on_employee')),
      'awaiting_me', count(*) filter (where x ->> 'next_action' is not null),
      'approved', count(*) filter (where x ->> 'status' = 'approved'),
      'rejected', count(*) filter (where x ->> 'status' = 'rejected'),
      'returned', count(*) filter (where x ->> 'status' in ('returned','waiting_on_employee')),
      'completed', count(*) filter (where x ->> 'status' in ('completed','resolved','closed')),
      'overdue', count(*) filter (where (x ->> 'overdue')::boolean),
      'by_type', coalesce((select jsonb_object_agg(w, n) from (select y ->> 'workflow' w, count(*) n
                            from hr_internal.inbox_rows(coalesce(p_filters, '{}'::jsonb)) y group by 1) t), '{}'::jsonb),
      'generated_at', now())
    from hr_internal.inbox_rows(coalesce(p_filters, '{}'::jsonb)) x);
end $$;

-- ---- configuration ---------------------------------------------------
create or replace function public.hr_set_request_category_routing(p_category uuid, p_stages text[], p_requires_attachment boolean default null,
                                                                  p_sla_hours int default null)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.hr_request_categories;
begin
  if not (hr_private.has_permission('settings.manage') or hr_private.has_permission('hr_requests.manage')) then
    perform hr_private.fail('You are not allowed to configure request routing.', 'forbidden');
  end if;
  select * into c from public.hr_request_categories where id = p_category for update;
  if c.id is null then perform hr_private.fail('Category not found.', 'not_found'); end if;
  if c.workflow = 'helpdesk' then perform hr_private.fail('Helpdesk categories have no approval stages.', 'invalid'); end if;
  if p_stages is null or cardinality(p_stages) = 0 or not (p_stages <@ array['manager','hr','payroll','finance']::text[]) then
    perform hr_private.fail('Choose one to four approval stages.', 'invalid_stages');
  end if;
  if p_sla_hours is not null and (p_sla_hours < 1 or p_sla_hours > 2160) then perform hr_private.fail('SLA must be 1 to 2160 hours.', 'invalid'); end if;
  update public.hr_request_categories set approval_stages = p_stages,
         requires_attachment = coalesce(p_requires_attachment, requires_attachment), sla_hours = coalesce(p_sla_hours, sla_hours)
   where id = c.id;
end $$;

create or replace function public.hr_save_request_policy(p_key text, p_value jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb := coalesce(p_value, '{}'::jsonb); v_new jsonb; k text;
  num_ok boolean;
begin
  if not hr_private.has_permission('settings.manage') then perform hr_private.fail('You are not allowed to change request policies.', 'forbidden'); end if;
  if jsonb_typeof(v) <> 'object' then perform hr_private.fail('Invalid policy.', 'invalid'); end if;
  if p_key = 'salary_advances' then
    for k in select jsonb_object_keys(v) loop
      if k not in ('enabled','max_percent_of_monthly_ctc','max_amount','min_service_months','max_open_advances',
                   'min_repayment_months','max_repayment_months','allow_payroll_deduction') then
        perform hr_private.fail('Unknown setting: ' || k, 'invalid');
      end if;
    end loop;
    v_new := coalesce(hr_private.setting('salary_advances'), '{}'::jsonb) || v;
    begin
      num_ok := jsonb_typeof(v_new -> 'enabled') = 'boolean' and jsonb_typeof(v_new -> 'allow_payroll_deduction') = 'boolean'
        and (v_new ->> 'max_percent_of_monthly_ctc')::numeric between 1 and 100
        and (v_new -> 'max_amount' = 'null'::jsonb or (v_new ->> 'max_amount')::numeric > 0)
        and (v_new ->> 'min_service_months')::int between 0 and 120
        and (v_new ->> 'max_open_advances')::int between 1 and 5
        and (v_new ->> 'min_repayment_months')::int between 1 and 60
        and (v_new ->> 'max_repayment_months')::int between (v_new ->> 'min_repayment_months')::int and 60;
    exception when others then num_ok := false;
    end;
    if not coalesce(num_ok, false) then perform hr_private.fail('Check the salary advance policy values.', 'invalid'); end if;
    update public.hr_settings set value = v_new, updated_by = auth.uid() where key = 'salary_advances';
    -- The request type is offered to employees only while the policy is enabled.
    update public.hr_request_categories set active = (v_new ->> 'enabled')::boolean where workflow = 'salary_advance';
  elsif p_key = 'hr_requests' then
    for k in select jsonb_object_keys(v) loop
      if k not in ('reopen_window_days','distinct_stage_approvers','reimbursement_max_age_days','reimbursement_currencies','attendance_correction_sla_hours') then
        perform hr_private.fail('Unknown setting: ' || k, 'invalid');
      end if;
    end loop;
    v_new := coalesce(hr_private.setting('hr_requests'), '{}'::jsonb) || v;
    begin
      num_ok := (v_new ->> 'reopen_window_days')::int between 1 and 90
        and jsonb_typeof(v_new -> 'distinct_stage_approvers') = 'boolean'
        and (v_new ->> 'reimbursement_max_age_days')::int between 1 and 730
        and (v_new ->> 'attendance_correction_sla_hours')::int between 1 and 720
        and jsonb_typeof(v_new -> 'reimbursement_currencies') = 'array'
        and jsonb_array_length(v_new -> 'reimbursement_currencies') between 1 and 10
        and not exists (select 1 from jsonb_array_elements(v_new -> 'reimbursement_currencies') x
                        where jsonb_typeof(x) <> 'string' or x #>> '{}' !~ '^[A-Z]{3}$');
    exception when others then num_ok := false;
    end;
    if not coalesce(num_ok, false) then perform hr_private.fail('Check the request policy values.', 'invalid'); end if;
    update public.hr_settings set value = v_new, updated_by = auth.uid() where key = 'hr_requests';
  else
    perform hr_private.fail('Unknown policy.', 'invalid');
  end if;
  return v_new;
end $$;

-- Policies needed by the request forms (no other settings are exposed).
create or replace function public.hr_request_policies()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'hr_requests', coalesce(hr_private.setting('hr_requests'), '{}'::jsonb),
    'salary_advances', jsonb_build_object('enabled', coalesce((hr_private.setting('salary_advances') ->> 'enabled')::boolean, false))
       || case when hr_private.has_permission('settings.view') or hr_private.has_permission('hr_requests.payroll')
               then coalesce(hr_private.setting('salary_advances'), '{}'::jsonb) else '{}'::jsonb end) end
$$;

-- ---------------------------------------------------------------------
-- 12. Grants
-- ---------------------------------------------------------------------
-- hr_internal: no API role may execute anything (and has no schema usage).
revoke execute on all functions in schema hr_internal from public;
revoke execute on all functions in schema hr_internal from anon;
revoke execute on all functions in schema hr_internal from authenticated;

-- hr_private read-only helpers used by RLS / storage policies.
revoke execute on function
  hr_private.request_payroll_routed(uuid), hr_private.request_row_visible(uuid), hr_private.request_can_handle(uuid),
  hr_private.request_comment_visible(uuid, boolean), hr_private.request_attachment_visible(uuid),
  hr_private.request_object_can_upload(text), hr_private.request_object_readable(text)
from anon, public;
grant execute on function
  hr_private.request_payroll_routed(uuid), hr_private.request_row_visible(uuid), hr_private.request_can_handle(uuid),
  hr_private.request_comment_visible(uuid, boolean), hr_private.request_attachment_visible(uuid),
  hr_private.request_object_can_upload(text), hr_private.request_object_readable(text)
to authenticated, service_role;

revoke execute on function
  public.hr_create_workflow_request(text, jsonb, jsonb, boolean),
  public.hr_update_workflow_request(uuid, jsonb, jsonb),
  public.hr_submit_workflow_request(uuid, text),
  public.hr_decide_request_stage(uuid, text, text),
  public.hr_delegate_request_stage(uuid, uuid, text),
  public.hr_request_delegate_options(uuid),
  public.hr_register_request_attachment(uuid, text, text, text, bigint, text),
  public.hr_remove_request_attachment(uuid),
  public.hr_issue_letter_request(uuid, uuid, uuid, text),
  public.hr_letter_issue_options(uuid),
  public.hr_salary_advance_eligibility(),
  public.hr_accept_advance_agreement(uuid, boolean),
  public.hr_record_advance_disbursement(uuid, numeric, text, date, uuid),
  public.hr_verify_advance_disbursement(uuid),
  public.hr_record_advance_repayment(uuid, numeric, text, text, date, uuid, text),
  public.hr_request_detail(uuid),
  public.hr_approval_inbox(text, jsonb),
  public.hr_requests_overview(jsonb),
  public.hr_set_request_category_routing(uuid, text[], boolean, int),
  public.hr_save_request_policy(text, jsonb),
  public.hr_request_policies()
from anon, public;
grant execute on function
  public.hr_create_workflow_request(text, jsonb, jsonb, boolean),
  public.hr_update_workflow_request(uuid, jsonb, jsonb),
  public.hr_submit_workflow_request(uuid, text),
  public.hr_decide_request_stage(uuid, text, text),
  public.hr_delegate_request_stage(uuid, uuid, text),
  public.hr_request_delegate_options(uuid),
  public.hr_register_request_attachment(uuid, text, text, text, bigint, text),
  public.hr_remove_request_attachment(uuid),
  public.hr_issue_letter_request(uuid, uuid, uuid, text),
  public.hr_letter_issue_options(uuid),
  public.hr_salary_advance_eligibility(),
  public.hr_accept_advance_agreement(uuid, boolean),
  public.hr_record_advance_disbursement(uuid, numeric, text, date, uuid),
  public.hr_verify_advance_disbursement(uuid),
  public.hr_record_advance_repayment(uuid, numeric, text, text, date, uuid, text),
  public.hr_request_detail(uuid),
  public.hr_approval_inbox(text, jsonb),
  public.hr_requests_overview(jsonb),
  public.hr_set_request_category_routing(uuid, text[], boolean, int),
  public.hr_save_request_policy(text, jsonb),
  public.hr_request_policies()
to authenticated;
