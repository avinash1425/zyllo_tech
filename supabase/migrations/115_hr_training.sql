-- =====================================================================
-- 115_hr_training.sql — Training: catalogue, assignments, completion,
-- certificates
-- =====================================================================
-- Depends on 100_hr_foundation.sql and 107_hr_documents.sql (certificates
-- are ordinary employee documents in category 'training_certificate').
--   * hr_training_categories / hr_training_courses: catalogue
--     (direct writes with training.manage)
--   * hr_training_assignments: RPC-only writes. Visible to the employee,
--     training.view (all) and training.view_team (reporting line).
--   * HR (training.manage) assigns to anyone; managers with
--     training.assign_team assign to their reporting line. Nobody assigns,
--     completes or verifies their own training except self-reported
--     completion, which stays "unverified" until HR or the manager verifies.
-- Apply ONLY to the local test cluster or the isolated dev project.
-- =====================================================================

insert into public.hr_permissions (key, module, action, description) values
  ('training.view',        'training', 'view',        'View the training catalogue and every assignment'),
  ('training.view_team',   'training', 'view_team',   'View training of the reporting line'),
  ('training.assign_team', 'training', 'assign_team', 'Assign training to, and record completion for, the reporting line'),
  ('training.manage',      'training', 'manage',      'Manage courses and categories, assign training and record completion for anyone')
on conflict (key) do nothing;
insert into public.hr_role_permissions (role_key, permission_key) values
  ('super_admin', 'training.view'), ('super_admin', 'training.view_team'), ('super_admin', 'training.assign_team'), ('super_admin', 'training.manage'),
  ('hr_admin', 'training.view'), ('hr_admin', 'training.view_team'), ('hr_admin', 'training.assign_team'), ('hr_admin', 'training.manage'),
  ('manager', 'training.view_team'), ('manager', 'training.assign_team')
on conflict do nothing;

create table public.hr_training_categories (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  name       text not null unique check (length(btrim(name)) between 2 and 120),
  description text check (description is null or length(description) <= 1000),
  sort_order smallint not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.hr_training_categories (code, name, description, sort_order) values
  ('onboarding', 'Onboarding & induction', 'Company induction, policies and tools', 1),
  ('compliance', 'Compliance', 'Mandatory compliance, security and safety training', 2),
  ('technical',  'Technical skills', 'Engineering, design and domain skills', 3),
  ('soft_skills','Professional skills', 'Communication, leadership and teamwork', 4)
on conflict (code) do nothing;

create table public.hr_training_courses (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique check (code ~ '^[A-Z0-9_-]{2,20}$'),
  title                text not null check (length(btrim(title)) between 3 and 200),
  category_id          uuid references public.hr_training_categories(id) on delete restrict,
  description          text check (description is null or length(description) <= 4000),
  provider             text check (provider is null or length(provider) <= 120),
  delivery_mode        text not null default 'online' check (delivery_mode in ('classroom','online','self_paced','on_the_job','webinar','external')),
  duration_hours       numeric(6,2) check (duration_hours is null or (duration_hours > 0 and duration_hours <= 1000)),
  is_mandatory         boolean not null default false,
  certificate_required boolean not null default false,
  validity_months      smallint check (validity_months is null or validity_months between 1 and 120),
  pass_score           numeric(5,2) check (pass_score is null or pass_score between 0 and 100),
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table public.hr_training_assignments (
  id                      uuid primary key default gen_random_uuid(),
  employee_id             uuid not null references public.hr_employees(id) on delete restrict,
  course_id               uuid not null references public.hr_training_courses(id) on delete restrict,
  status                  text not null default 'assigned' check (status in ('assigned','in_progress','completed','cancelled')),
  due_date                date,
  assigned_by             uuid,
  assigned_at             timestamptz not null default now(),
  started_at              timestamptz,
  completion_date         date,
  score                   numeric(5,2) check (score is null or score between 0 and 100),
  result                  text check (result is null or result in ('passed','failed','attended')),
  certificate_document_id uuid references public.hr_documents(id) on delete set null,
  certificate_expiry      date,
  completion_source       text check (completion_source is null or completion_source in ('hr','manager','self')),
  completed_by            uuid,
  verified_by             uuid,
  verified_at             timestamptz,
  notes                   text check (notes is null or length(notes) <= 2000),
  cancel_reason           text check (cancel_reason is null or length(cancel_reason) <= 1000),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (status <> 'completed' or (completion_date is not null and result is not null))
);
create unique index hr_training_assignments_open on public.hr_training_assignments (employee_id, course_id) where status in ('assigned','in_progress');
create index hr_training_assignments_employee on public.hr_training_assignments (employee_id, status);
create index hr_training_assignments_due on public.hr_training_assignments (due_date) where status in ('assigned','in_progress');

create trigger hr_training_categories_touch before update on public.hr_training_categories for each row execute function hr_private.touch_updated_at();
create trigger hr_training_courses_touch before update on public.hr_training_courses for each row execute function hr_private.touch_updated_at();
create trigger hr_training_assignments_touch before update on public.hr_training_assignments for each row execute function hr_private.touch_updated_at();
select hr_private.secure_table('public.hr_training_categories');
select hr_private.secure_table('public.hr_training_courses');
select hr_private.secure_table('public.hr_training_assignments');
select hr_private.enable_audit('public.hr_training_categories');
select hr_private.enable_audit('public.hr_training_courses');
select hr_private.enable_audit('public.hr_training_assignments');

do $$
declare t text;
begin
  foreach t in array array['hr_training_categories','hr_training_courses'] loop
    execute format('create policy %I on public.%I for select to authenticated using (hr_private.current_employee_id() is not null or hr_private.has_permission(''training.view'') or hr_private.has_permission(''settings.view''))', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (hr_private.has_permission(''training.manage''))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (hr_private.has_permission(''training.manage'')) with check (hr_private.has_permission(''training.manage''))', t || '_update', t);
  end loop;
end $$;
create policy hr_training_assignments_read on public.hr_training_assignments for select to authenticated
  using (hr_private.can_access_employee(employee_id, 'training'));

insert into public.hr_document_categories
  (code, name, description, requires_expiry, employee_can_upload, employee_can_view, is_confidential, checklist_required, sort_order) values
  ('training_certificate', 'Training certificate', 'Certificates of completed training', false, true, true, false, false, 14)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- Helpers + workflow RPCs
-- ---------------------------------------------------------------------
-- HR for anyone, managers (training.assign_team) for their reporting line; never self.
create or replace function hr_private.can_manage_training_of(p_employee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select hr_private.can_act_on_employee(p_employee, 'training.manage', 'training.assign_team')
$$;

create or replace function public.hr_assign_training(p_course uuid, p_employees uuid[], p_due_date date default null, p_notes text default null)
returns int language plpgsql security definer set search_path = '' as $$
declare v_c public.hr_training_courses; v_emp uuid; v_n int := 0; v_id uuid;
begin
  if not hr_private.any_permission(array['training.manage','training.assign_team']) then
    perform hr_private.fail('You are not allowed to assign training.', 'forbidden');
  end if;
  select * into v_c from public.hr_training_courses where id = p_course;
  if v_c.id is null or not v_c.active then perform hr_private.fail('Choose an active course.', 'course_inactive'); end if;
  if p_employees is null or cardinality(p_employees) = 0 then perform hr_private.fail('Choose at least one employee.', 'employees_required'); end if;
  if cardinality(p_employees) > 500 then perform hr_private.fail('Assign at most 500 employees at a time.', 'too_many'); end if;
  if p_due_date is not null and p_due_date < hr_private.business_today() then perform hr_private.fail('The due date is in the past.', 'invalid_due_date'); end if;
  foreach v_emp in array p_employees loop
    if not exists (select 1 from public.hr_employees where id = v_emp and status not in ('exited','archived','suspended')) then
      perform hr_private.fail('One of the selected employees is not active.', 'employee_inactive');
    end if;
    if not hr_private.can_manage_training_of(v_emp) then
      perform hr_private.fail('You can only assign training to employees in your reporting line (never to yourself).', 'forbidden');
    end if;
    -- Already has an open assignment for this course: skip silently (idempotent bulk assignment).
    continue when exists (select 1 from public.hr_training_assignments where employee_id = v_emp and course_id = p_course and status in ('assigned','in_progress'));
    insert into public.hr_training_assignments (employee_id, course_id, due_date, assigned_by, notes)
    values (v_emp, p_course, p_due_date, auth.uid(), nullif(btrim(p_notes), '')) returning id into v_id;
    perform hr_private.notify_employee(v_emp, 'training_assigned', 'Training assigned: ' || v_c.title,
      coalesce('Due ' || to_char(p_due_date, 'DD Mon YYYY') || '.', 'No due date.'), '/employee/training', 'hr_training_assignment', v_id::text);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function public.hr_start_training(p_assignment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.hr_training_assignments;
begin
  select * into v from public.hr_training_assignments where id = p_assignment for update;
  if v.id is null or v.employee_id is distinct from hr_private.current_employee_id() then
    perform hr_private.fail('Training assignment not found.', 'not_found');
  end if;
  if v.status <> 'assigned' then perform hr_private.fail('Only assigned training can be started.', 'invalid_status'); end if;
  update public.hr_training_assignments set status = 'in_progress', started_at = now() where id = p_assignment;
end $$;

-- Record completion. HR / manager completions are verified immediately;
-- self-reported completions wait for verification.
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
  if p_result not in ('passed','failed','attended') then perform hr_private.fail('Choose passed, failed or attended.', 'invalid_result'); end if;
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
    certificate_expiry = case when v_c.validity_months is not null and p_result = 'passed' then (p_completion_date + make_interval(months => v_c.validity_months))::date end,
    completion_source = v_source, completed_by = auth.uid(),
    verified_by = case when v_self then null else auth.uid() end,
    verified_at = case when v_self then null else now() end,
    started_at = coalesce(started_at, now()),
    notes = coalesce(nullif(btrim(p_notes), ''), notes)
  where id = p_assignment;
  if not v_self then
    perform hr_private.notify_employee(v.employee_id, 'training_completed', 'Training recorded: ' || v_c.title,
      'Your completion of ' || v_c.title || ' was recorded (' || p_result || ').', '/employee/training', 'hr_training_assignment', v.id::text);
  end if;
end $$;

create or replace function public.hr_verify_training_completion(p_assignment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.hr_training_assignments;
begin
  select * into v from public.hr_training_assignments where id = p_assignment for update;
  if v.id is null then perform hr_private.fail('Training assignment not found.', 'not_found'); end if;
  if not hr_private.can_manage_training_of(v.employee_id) then perform hr_private.fail('You are not allowed to verify this completion.', 'forbidden'); end if;
  if v.status <> 'completed' then perform hr_private.fail('Only completed training can be verified.', 'invalid_status'); end if;
  if v.verified_at is not null then perform hr_private.fail('This completion is already verified.', 'already_verified'); end if;
  update public.hr_training_assignments set verified_by = auth.uid(), verified_at = now() where id = p_assignment;
end $$;

create or replace function public.hr_cancel_training(p_assignment uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.hr_training_assignments;
begin
  select * into v from public.hr_training_assignments where id = p_assignment for update;
  if v.id is null then perform hr_private.fail('Training assignment not found.', 'not_found'); end if;
  if not hr_private.can_manage_training_of(v.employee_id) then perform hr_private.fail('You are not allowed to cancel this assignment.', 'forbidden'); end if;
  if v.status not in ('assigned','in_progress') then perform hr_private.fail('Only open assignments can be cancelled.', 'invalid_status'); end if;
  if nullif(btrim(p_reason), '') is null then perform hr_private.fail('Give a reason.', 'reason_required'); end if;
  update public.hr_training_assignments set status = 'cancelled', cancel_reason = btrim(p_reason) where id = p_assignment;
end $$;

revoke execute on function public.hr_assign_training(uuid, uuid[], date, text), public.hr_start_training(uuid),
  public.hr_complete_training(uuid, date, text, numeric, uuid, text), public.hr_verify_training_completion(uuid),
  public.hr_cancel_training(uuid, text) from anon, public;
grant execute on function public.hr_assign_training(uuid, uuid[], date, text), public.hr_start_training(uuid),
  public.hr_complete_training(uuid, date, text, numeric, uuid, text), public.hr_verify_training_completion(uuid),
  public.hr_cancel_training(uuid, text) to authenticated;
grant execute on all functions in schema hr_private to authenticated, service_role;
revoke execute on all functions in schema hr_private from anon, public;
