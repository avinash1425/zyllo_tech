-- 253: Employee Portal — the admin can change an employee's Employee ID.
--
-- ep_admin_update_employee (from migration 250) now also accepts 'employee_code':
--   upper-cased, 2-30 letters / numbers / dashes (same rule as the column check), must not be used
--   by another employee; the employee gets a notification. Signing in is unaffected (it uses the email);
--   everything else links employees by their internal id, not by the Employee ID.
-- Rollback: supabase/rollbacks/253_rollback_employee_edit_id.sql

begin;

create or replace function public.ep_admin_update_employee(p_id uuid, p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  f text;
  v_old public.ep_employees;
  v_new public.ep_employees;
  v_mgr uuid;
  v_walk uuid;
  v_depth int := 0;
  v_mgr_name text;
  v_code text;
begin
  perform public.ep_require_admin();
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Invalid employee data.' using errcode = '22023';
  end if;
  for f in select jsonb_object_keys(p) loop
    if f not in ('employee_code', 'full_name', 'department', 'designation', 'reporting_manager_id', 'reporting_manager_name',
                 'date_of_joining', 'employment_type', 'work_location') then
      raise exception 'Field % cannot be changed here.', f using errcode = '42501';
    end if;
  end loop;

  select * into v_old from public.ep_employees where id = p_id for update;
  if v_old.id is null then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;

  if p ? 'full_name' and nullif(btrim(p ->> 'full_name'), '') is null then
    raise exception 'Name cannot be empty.' using errcode = '22023';
  end if;

  -- Employee ID: the admin may change it (sign-in stays the same: it uses the email).
  v_code := case when p ? 'employee_code' then upper(btrim(coalesce(p ->> 'employee_code', ''))) else v_old.employee_code end;
  if v_code !~ '^[A-Z0-9][A-Z0-9-]{1,29}$' then
    raise exception 'Employee ID: use 2-30 letters, numbers or dashes (e.g. ZT-001).' using errcode = '22023';
  end if;
  if v_code <> v_old.employee_code
     and exists (select 1 from public.ep_employees where employee_code = v_code and id <> p_id) then
    raise exception 'Employee ID % is already used by another employee.', v_code using errcode = '23505';
  end if;

  -- Reporting manager: must exist, be active, not the employee, and not create a loop.
  v_mgr := case when p ? 'reporting_manager_id'
                then nullif(btrim(p ->> 'reporting_manager_id'), '')::uuid
                else v_old.reporting_manager_id end;
  if p ? 'reporting_manager_id' and v_mgr is not null
     and v_mgr is distinct from v_old.reporting_manager_id then
    if v_mgr = p_id then
      raise exception 'An employee cannot report to themselves.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.ep_employees where id = v_mgr and is_active) then
      raise exception 'Choose an active employee as reporting manager.' using errcode = '22023';
    end if;
    v_walk := v_mgr;
    while v_walk is not null and v_depth < 100 loop
      if v_walk = p_id then
        raise exception 'That would make a loop: this employee is above the chosen manager.' using errcode = '22023';
      end if;
      select reporting_manager_id into v_walk from public.ep_employees where id = v_walk;
      v_depth := v_depth + 1;
    end loop;
  end if;

  -- Typed manager name (someone who is not in the portal). A portal manager replaces it.
  v_mgr_name := case when p ? 'reporting_manager_name' then nullif(btrim(coalesce(p ->> 'reporting_manager_name', '')), '')
                     else v_old.reporting_manager_name end;
  if v_mgr is not null then
    v_mgr_name := null;
  end if;
  if length(v_mgr_name) > 120 then
    raise exception 'Manager name must be at most 120 characters.' using errcode = '22023';
  end if;

  update public.ep_employees set
    full_name            = case when p ? 'full_name' then btrim(p ->> 'full_name') else full_name end,
    department           = case when p ? 'department' then nullif(btrim(p ->> 'department'), '') else department end,
    designation          = case when p ? 'designation' then nullif(btrim(p ->> 'designation'), '') else designation end,
    employee_code        = v_code,
    reporting_manager_id = v_mgr,
    reporting_manager_name = v_mgr_name,
    date_of_joining      = case when p ? 'date_of_joining' then nullif(btrim(p ->> 'date_of_joining'), '')::date else date_of_joining end,
    employment_type      = case when p ? 'employment_type' then nullif(btrim(p ->> 'employment_type'), '') else employment_type end,
    work_location        = case when p ? 'work_location' then nullif(btrim(p ->> 'work_location'), '') else work_location end,
    updated_at           = now()
  where id = p_id
  returning * into v_new;

  if v_new.employee_code is distinct from v_old.employee_code then
    perform public.ep_notify(
      p_id, 'message', 'Your Employee ID was changed',
      'Your Employee ID is now ' || v_new.employee_code || ' (was ' || v_old.employee_code
        || '). You still sign in with the same email and password.',
      '/employee/profile');
  end if;

  -- Tell the people concerned when the reporting line changes.
  if v_new.reporting_manager_id is distinct from v_old.reporting_manager_id then
    if v_new.reporting_manager_id is not null then
      perform public.ep_notify(
        p_id, 'message', 'Your reporting manager was updated',
        'You now report to ' || (select full_name from public.ep_employees where id = v_new.reporting_manager_id) || '.',
        '/employee/profile');
      perform public.ep_notify(
        v_new.reporting_manager_id, 'message', v_new.full_name || ' now reports to you',
        v_new.full_name || ' (' || v_new.employee_code || ') was added to your team by the admin.',
        null);
    elsif v_new.reporting_manager_name is null then
      perform public.ep_notify(
        p_id, 'message', 'Your reporting manager was removed',
        'No reporting manager is set for you right now.', '/employee/profile');
    end if;
  end if;

  -- A typed (non-portal) manager set or changed: tell the employee.
  if v_new.reporting_manager_id is null and v_new.reporting_manager_name is not null
     and v_new.reporting_manager_name is distinct from v_old.reporting_manager_name then
    perform public.ep_notify(
      p_id, 'message', 'Your reporting manager was updated',
      'You now report to ' || v_new.reporting_manager_name || '.', '/employee/profile');
  end if;

  return public.ep_admin_employee(p_id);
end $$;

notify pgrst, 'reload schema';

commit;
