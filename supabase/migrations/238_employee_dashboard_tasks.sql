-- 238: Employee Portal — Dashboard: my open tasks across all my projects.
--
-- Read-only. Returns the signed-in employee's tasks that are not done, on
-- projects they are still a member of: overdue first, then by deadline
-- (no deadline last), then newest. p_limit 1–50.
-- Rollback: supabase/rollbacks/238_rollback_employee_dashboard_tasks.sql

begin;

create or replace function public.ep_my_open_tasks(p_limit int default 5)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_emp   uuid := public.ep_current_employee_id();
  v_today date := (timezone('Asia/Kolkata', now()))::date;
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'total', (select count(*) from public.ep_project_tasks t
               join public.ep_project_members m on m.project_id = t.project_id and m.employee_id = v_emp
              where t.assignee_id = v_emp and t.status <> 'done'),
    'items', coalesce((
      select jsonb_agg(x.j order by x.ord)
      from (
        select row_number() over (order by (t.due_date < v_today) desc, t.due_date nulls last, t.created_at desc) as ord,
               jsonb_build_object(
                 'id', t.id, 'title', t.title, 'status', t.status, 'priority', t.priority, 'due_date', t.due_date,
                 'project_id', p.id, 'project_name', p.name, 'project_code', p.project_code) as j
        from public.ep_project_tasks t
        join public.ep_project_members m on m.project_id = t.project_id and m.employee_id = v_emp
        join public.pt_projects p on p.id = t.project_id
        where t.assignee_id = v_emp and t.status <> 'done'
        order by 1
        limit least(greatest(coalesce(p_limit, 5), 1), 50)
      ) x), '[]'::jsonb));
end $$;

revoke all on function public.ep_my_open_tasks(int) from public, anon;
grant execute on function public.ep_my_open_tasks(int) to authenticated;

notify pgrst, 'reload schema';

commit;
