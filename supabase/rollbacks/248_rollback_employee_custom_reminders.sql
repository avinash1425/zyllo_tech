-- Rollback of 248_employee_custom_reminders.sql: custom reminders are removed (their rows are lost)
-- and ep_run_due_reminders() goes back to the 244 version (built-in reminders only).
begin;
create or replace function public.ep_run_due_reminders()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_now   timestamp := timezone('Asia/Kolkata', now());
  v_today date := v_now::date;
  v_n     integer := 0;
  s       public.ep_reminder_settings;
begin
  for s in select * from public.ep_reminder_settings
            where enabled and extract(isodow from v_today)::smallint = any (days)
              and v_now::time >= send_at and v_now::time < send_at + interval '2 hours'
              and (last_run is null or last_run < v_today)
            for update skip locked loop
    v_n := v_n + case when s.kind = 'deadlines' then public.ep_send_deadline_reminders()
                      else public.ep_send_reminders(s.kind) end;
    update public.ep_reminder_settings set last_run = v_today where kind = s.kind;
  end loop;
  return v_n;
end $$;
revoke all on function public.ep_run_due_reminders() from public, anon, authenticated;
drop function if exists public.ep_admin_send_custom_reminder_now(uuid);
drop function if exists public.ep_admin_delete_custom_reminder(uuid);
drop function if exists public.ep_admin_save_custom_reminder(uuid, jsonb);
drop function if exists public.ep_admin_custom_reminders();
drop function if exists public.ep_send_custom_reminder(uuid);
drop function if exists public.ep_custom_reminder_targets(uuid);
drop table if exists public.ep_custom_reminders;
notify pgrst, 'reload schema';
commit;
