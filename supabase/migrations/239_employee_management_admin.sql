-- 239: Employee Portal — admin Employee Management.
--
-- Admins (public.is_admin()) can:
--   ep_admin_employees()                    -> list of all employees (work details + status)
--   ep_admin_employee(id)                   -> one employee: work + personal + emergency contacts + team
--   ep_admin_update_employee(id, jsonb)     -> set the work details the employee sees read-only in
--                                              My Profile (department, designation, reporting manager,
--                                              date of joining, employment type, work location, name)
--   ep_admin_set_employee_access(id, bool)  -> turn Employee Portal access on / off
--                                              (off = ep_employees.is_active false; an open punch-in
--                                              session is closed at that moment)
-- And for the employee side:
--   ep_my_access()                          -> 'active' | 'disabled' | null (not an employee), so a
--                                              turned-off account sees a clear message.
-- No new tables. Personal details stay editable only by the employee (admin reads them).
-- Rollback: supabase/rollbacks/239_rollback_employee_management_admin.sql

begin;

-- ---------------------------------------------------------------- helpers
create or replace function public.ep_require_admin()
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'Only admins can manage employees.' using errcode = '42501';
  end if;
end $$;
revoke all on function public.ep_require_admin() from public, anon, authenticated;

-- One employee as the admin sees it in the list / header.
create or replace function public.ep_admin_employee_json(p_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id',              e.id,
    'employee_code',   e.employee_code,
    'full_name',       e.full_name,
    'work_email',      u.email,
    'department',      e.department,
    'designation',     e.designation,
    'date_of_joining', e.date_of_joining,
    'employment_type', e.employment_type,
    'work_location',   e.work_location,
    'is_active',       e.is_active,
    'created_at',      e.created_at,
    'last_sign_in_at', u.last_sign_in_at,
    'manager', case when m.id is null then null else jsonb_build_object(
      'id', m.id, 'full_name', m.full_name, 'employee_code', m.employee_code,
      'designation', m.designation, 'is_active', m.is_active) end,
    'reports_count', (select count(*) from public.ep_employees r where r.reporting_manager_id = e.id),
    'punched_in', exists (select 1 from public.ep_attendance a where a.employee_id = e.id and a.punch_out_at is null)
  )
  from public.ep_employees e
  left join auth.users u on u.id = e.user_id
  left join public.ep_employees m on m.id = e.reporting_manager_id
  where e.id = p_id;
$$;
revoke all on function public.ep_admin_employee_json(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- list
create or replace function public.ep_admin_employees()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  return coalesce((
    select jsonb_agg(public.ep_admin_employee_json(e.id) order by e.is_active desc, e.employee_code)
    from public.ep_employees e
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- one employee
create or replace function public.ep_admin_employee(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v jsonb := public.ep_admin_employee_json(p_id);
begin
  perform public.ep_require_admin();
  if v is null then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  return v || jsonb_build_object(
    'personal', coalesce((
      select to_jsonb(p) - 'employee_id' from public.ep_employee_profiles p where p.employee_id = p_id
    ), '{}'::jsonb),
    'emergency_contacts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', c.name, 'relationship', c.relationship,
               'phone', c.phone, 'alternate_phone', c.alternate_phone) order by c.sort_order)
      from public.ep_emergency_contacts c where c.employee_id = p_id
    ), '[]'::jsonb),
    'direct_reports', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'full_name', r.full_name, 'employee_code', r.employee_code,
               'designation', r.designation, 'is_active', r.is_active) order by r.full_name)
      from public.ep_employees r where r.reporting_manager_id = p_id
    ), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------- work details
-- p: { full_name, department, designation, reporting_manager_id, date_of_joining,
--      employment_type, work_location } — only the keys given are changed.
-- Empty strings are saved as null (full_name cannot be empty). Table CHECKs validate.
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
begin
  perform public.ep_require_admin();
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Invalid employee data.' using errcode = '22023';
  end if;
  for f in select jsonb_object_keys(p) loop
    if f not in ('full_name', 'department', 'designation', 'reporting_manager_id',
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

  update public.ep_employees set
    full_name            = case when p ? 'full_name' then btrim(p ->> 'full_name') else full_name end,
    department           = case when p ? 'department' then nullif(btrim(p ->> 'department'), '') else department end,
    designation          = case when p ? 'designation' then nullif(btrim(p ->> 'designation'), '') else designation end,
    reporting_manager_id = v_mgr,
    date_of_joining      = case when p ? 'date_of_joining' then nullif(btrim(p ->> 'date_of_joining'), '')::date else date_of_joining end,
    employment_type      = case when p ? 'employment_type' then nullif(btrim(p ->> 'employment_type'), '') else employment_type end,
    work_location        = case when p ? 'work_location' then nullif(btrim(p ->> 'work_location'), '') else work_location end,
    updated_at           = now()
  where id = p_id
  returning * into v_new;

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
    else
      perform public.ep_notify(
        p_id, 'message', 'Your reporting manager was removed',
        'No reporting manager is set for you right now.', '/employee/profile');
    end if;
  end if;

  return public.ep_admin_employee(p_id);
end $$;

-- ---------------------------------------------------------------- portal access
create or replace function public.ep_admin_set_employee_access(p_id uuid, p_active boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.ep_require_admin();
  if p_active is null then
    raise exception 'Choose on or off.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.ep_employees where id = p_id) then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  -- Same lock as punch in / out, so a punch cannot slip in while access is turned off.
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  update public.ep_employees set is_active = p_active, updated_at = now()
   where id = p_id and is_active is distinct from p_active;
  if not p_active then
    update public.ep_attendance set punch_out_at = now()
     where employee_id = p_id and punch_out_at is null;
  end if;
  return public.ep_admin_employee(p_id);
end $$;

-- ---------------------------------------------------------------- employee: my access
create or replace function public.ep_my_access()
returns text
language sql stable security definer set search_path = ''
as $$
  select case when is_active then 'active' else 'disabled' end
  from public.ep_employees where user_id = auth.uid();
$$;

revoke all on function
  public.ep_admin_employees(), public.ep_admin_employee(uuid),
  public.ep_admin_update_employee(uuid, jsonb), public.ep_admin_set_employee_access(uuid, boolean),
  public.ep_my_access()
  from public, anon;
grant execute on function
  public.ep_admin_employees(), public.ep_admin_employee(uuid),
  public.ep_admin_update_employee(uuid, jsonb), public.ep_admin_set_employee_access(uuid, boolean),
  public.ep_my_access()
  to authenticated;

notify pgrst, 'reload schema';

commit;
