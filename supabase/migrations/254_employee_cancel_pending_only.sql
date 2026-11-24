-- 254: Employee Portal — an employee can cancel ONLY a pending leave request.
--
-- Before: pending, or approved leave that had not started yet, could be cancelled.
-- Now: once the admin has approved or rejected it, the employee can no longer cancel it.
-- ep_cancel_leave is otherwise unchanged (from migration 236).
-- Rollback: supabase/rollbacks/254_rollback_employee_cancel_pending_only.sql

begin;

create or replace function public.ep_cancel_leave(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp   uuid := public.ep_current_employee_id();
  v_row   public.ep_leave_requests;
  v_name  text;
begin
  select * into v_row from public.ep_leave_requests where id = p_id and employee_id = v_emp for update;
  if v_emp is null or v_row.id is null then
    raise exception 'Leave request not found.' using errcode = '42501';
  end if;
  -- Once the admin has approved or rejected it, the employee can no longer cancel it.
  if v_row.status <> 'pending' then
    raise exception 'This leave was already % by the admin, so it can no longer be cancelled. Please contact the admin.',
      v_row.status using errcode = 'P0001';
  end if;
  update public.ep_leave_requests set status = 'cancelled', updated_at = now() where id = p_id returning * into v_row;
  select full_name into v_name from public.ep_employees where id = v_emp;
  perform public.ep_notify(v_row.approver_id, 'leave',
    v_name || ' cancelled a leave request',
    to_char(v_row.start_date, 'DD Mon YYYY') || case when v_row.end_date <> v_row.start_date then ' – ' || to_char(v_row.end_date, 'DD Mon YYYY') else '' end,
    '/employee/leave/team');
  return public.ep_leave_json(v_row);
end $$;

notify pgrst, 'reload schema';

commit;
