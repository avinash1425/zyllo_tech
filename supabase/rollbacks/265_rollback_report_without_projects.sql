-- Rollback of 265: a submitted report needs at least one project entry again.
begin;

CREATE OR REPLACE FUNCTION public.ep_save_my_report(p_date date, p_notes text, p_items jsonb, p_submit boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp    uuid := public.ep_current_employee_id();
  v_today  date := (timezone('Asia/Kolkata', now()))::date;
  v_mgr    uuid;
  v_rep    public.ep_work_reports;
  v_item   jsonb;
  v_pid    uuid;
  v_hours  numeric;
  v_total  numeric := 0;
  v_seen   uuid[] := '{}';
  v_pos    int := 0;
  v_notes  text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  perform public.rbac_require('emp.reports.create'); -- rbac
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  if p_date is null or p_date > v_today then
    raise exception 'You cannot write a report for a future date.' using errcode = '22023';
  end if;
  if p_date < v_today - 7 then
    raise exception 'Reports can only be written for today and the last 7 days.' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Invalid report entries.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 20 then
    raise exception 'A report can have at most 20 project entries.' using errcode = '22023';
  end if;
  if coalesce(length(v_notes), 0) > 2000 then
    raise exception 'Notes must be at most 2000 characters.' using errcode = '22023';
  end if;
  if p_submit and jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one project entry before submitting.' using errcode = '22023';
  end if;

  select reporting_manager_id into v_mgr from public.ep_employees where id = v_emp;
  -- No reporting manager in the portal: the report is submitted to the admin (submitted_to stays null).

  -- Serialise saves of the same report.
  perform pg_advisory_xact_lock(hashtextextended(v_emp::text || p_date::text, 0));
  select * into v_rep from public.ep_work_reports where employee_id = v_emp and report_date = p_date;
  if v_rep.id is not null and v_rep.status in ('submitted', 'reviewed') then
    raise exception 'This report is already submitted and cannot be changed.' using errcode = 'P0001';
  end if;

  -- Validate every entry before writing anything.
  for v_item in select * from jsonb_array_elements(p_items) loop
    begin
      v_pid   := (v_item ->> 'project_id')::uuid;
      v_hours := (v_item ->> 'hours')::numeric;
    exception when others then
      raise exception 'Invalid report entries.' using errcode = '22023';
    end;
    if v_pid is null or not exists (select 1 from public.ep_project_members where project_id = v_pid and employee_id = v_emp) then
      raise exception 'You can only report on projects you are assigned to.' using errcode = '42501';
    end if;
    if v_pid = any (v_seen) then
      raise exception 'Each project can be added only once per report.' using errcode = '22023';
    end if;
    v_seen := v_seen || v_pid;
    if v_hours is null or v_hours <= 0 or v_hours > 24 or v_hours <> round(v_hours, 2) then
      raise exception 'Hours spent must be more than 0 and at most 24 for each project.' using errcode = '22023';
    end if;
    v_total := v_total + v_hours;
    if coalesce(btrim(v_item ->> 'task_updates'), '') = '' and coalesce(btrim(v_item ->> 'completed_work'), '') = ''
       and coalesce(btrim(v_item ->> 'pending_work'), '') = '' then
      raise exception 'Write what you worked on for every project you added.' using errcode = '22023';
    end if;
    if greatest(length(v_item ->> 'task_updates'), length(v_item ->> 'completed_work'), length(v_item ->> 'pending_work')) > 2000 then
      raise exception 'Each text box can have at most 2000 characters.' using errcode = '22023';
    end if;
  end loop;
  if v_total > 24 then
    raise exception 'Total hours for the day cannot be more than 24.' using errcode = '22023';
  end if;

  if v_rep.id is null then
    insert into public.ep_work_reports (employee_id, report_date, notes)
    values (v_emp, p_date, v_notes) returning * into v_rep;
  else
    update public.ep_work_reports set notes = v_notes, updated_at = now() where id = v_rep.id;
  end if;

  delete from public.ep_work_report_items where report_id = v_rep.id;
  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.ep_work_report_items (report_id, project_id, task_updates, completed_work, pending_work, hours, position)
    values (v_rep.id, (v_item ->> 'project_id')::uuid,
            nullif(btrim(coalesce(v_item ->> 'task_updates', '')), ''),
            nullif(btrim(coalesce(v_item ->> 'completed_work', '')), ''),
            nullif(btrim(coalesce(v_item ->> 'pending_work', '')), ''),
            (v_item ->> 'hours')::numeric, v_pos);
    v_pos := v_pos + 1;
  end loop;

  if p_submit then
    update public.ep_work_reports
       set status = 'submitted', submitted_to = v_mgr, submitted_at = now(), updated_at = now(),
           reviewed_by = null, reviewed_at = null, review_comment = null
     where id = v_rep.id;
  end if;

  return public.ep_my_report(p_date);
end $function$;

notify pgrst, 'reload schema';
commit;
