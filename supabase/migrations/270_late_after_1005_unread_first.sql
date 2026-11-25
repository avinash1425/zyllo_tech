-- 270: Attendance + notifications.
--   * Punch in between 09:40 and 10:05 (India time) is on time; the first punch in after 10:05 is Late.
--     (Late is worked out from the rules every time, so past days are shown with the new time too.)
--   * Notifications (Employee Portal and admin): unread ones first (newest first), then the read ones.
-- Safe to run again. Rollback: supabase/rollbacks/270_rollback_late_after_1005_unread_first.sql

begin;

insert into public.rbac_backup (kind, name, definition)
select 'function270', f, pg_get_functiondef(f::regprocedure)
  from (values ('public.ep_attendance_rules()'), ('public.ep_trg_admin_attendance()'),
               ('public.ep_my_notifications(text)'), ('public.ep_admin_inbox(text,integer)')) v(f)
on conflict do nothing;

CREATE OR REPLACE FUNCTION public.ep_attendance_rules()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'timezone',           'Asia/Kolkata',
    'office_start',       '09:40',
    'office_end',         '19:00',
    'late_after',         '10:05',
    'half_day_min_hours', 4,
    'auto_punch_out',     '20:00'
  );
$function$;

CREATE OR REPLACE FUNCTION public.ep_trg_admin_attendance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor public.ep_employees := public.ep_actor_employee();
  v_emp   public.ep_employees;
  v_late  time;
  v_in    time;
begin
  begin
    select * into v_emp from public.ep_employees where id = new.employee_id;
    if tg_op = 'INSERT' and v_actor.id = new.employee_id then
      v_late := coalesce((public.ep_attendance_rules() ->> 'late_after')::time, time '10:05');
      v_in := (new.punch_in_at at time zone 'Asia/Kolkata')::time;
      if v_in > v_late and not exists (
           select 1 from public.ep_attendance a
            where a.employee_id = new.employee_id and a.work_date = new.work_date and a.id <> new.id) then
        perform public.ep_admin_notify(new.employee_id, 'attendance',
          v_emp.full_name || ' punched in late at ' || to_char(new.punch_in_at at time zone 'Asia/Kolkata', 'HH12:MI am'),
          to_char(new.work_date, 'Dy DD Mon YYYY') || ' · late after ' || to_char(v_late, 'HH12:MI am'),
          '/admin/attendance?tab=late');
      end if;
    elsif tg_op = 'UPDATE' and new.auto_punched_out and not coalesce(old.auto_punched_out, false) then
      perform public.ep_admin_notify(new.employee_id, 'attendance',
        v_emp.full_name || ' forgot to punch out',
        to_char(new.work_date, 'Dy DD Mon YYYY') || ' · punched out automatically at '
          || to_char(new.punch_out_at at time zone 'Asia/Kolkata', 'HH12:MI am'),
        '/admin/attendance?tab=missing');
    end if;
  exception when others then
    raise warning 'admin notification (attendance) skipped: %', sqlerrm;
  end;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.ep_my_notifications(p_filter text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_emp uuid := public.ep_current_employee_id();
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'unread', (select count(*) from public.ep_notifications where employee_id = v_emp and read_at is null),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', n.id, 'kind', n.kind, 'priority', n.priority, 'title', n.title, 'body', n.body,
               'link', n.link, 'sender_label', n.sender_label, 'created_at', n.created_at, 'read_at', n.read_at)
             order by (n.read_at is not null), n.created_at desc)
      from (select * from public.ep_notifications
             where employee_id = v_emp
               and (coalesce(p_filter, 'all') = 'all'
                    or (p_filter = 'unread' and read_at is null)
                    or kind = p_filter)
             order by (read_at is not null), created_at desc limit 200) n), '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.ep_admin_inbox(p_filter text DEFAULT 'all'::text, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  perform public.rbac_require('portal.inbox.view'); -- rbac
  return jsonb_build_object(
    'unread', (select count(*) from public.ep_admin_notifications n
                where public.ep_admin_inbox_visible(n.kind, n.employee_id)
                  and not exists (select 1 from public.ep_admin_notification_reads r
                                   where r.notification_id = n.id and r.user_id = v_uid)),
    'counts', coalesce((select jsonb_object_agg(kind, c) from (
                 select kind, count(*) c from public.ep_admin_notifications n
                  where public.ep_admin_inbox_visible(n.kind, n.employee_id)
                    and not exists (select 1 from public.ep_admin_notification_reads r
                                     where r.notification_id = n.id and r.user_id = v_uid)
                  group by kind) k), '{}'::jsonb),
    'items', coalesce((
      select jsonb_agg(x.j order by x.is_read, x.created_at desc) from (
        select n.created_at,
               exists (select 1 from public.ep_admin_notification_reads r
                        where r.notification_id = n.id and r.user_id = v_uid) as is_read,
               jsonb_build_object(
                 'id', n.id, 'kind', n.kind, 'priority', n.priority, 'title', n.title, 'body', n.body,
                 'link', n.link, 'created_at', n.created_at,
                 'read', exists (select 1 from public.ep_admin_notification_reads r
                                  where r.notification_id = n.id and r.user_id = v_uid),
                 'employee', (select jsonb_build_object('id', e.id, 'full_name', e.full_name, 'employee_code', e.employee_code)
                                from public.ep_employees e where e.id = n.employee_id)) j
          from public.ep_admin_notifications n
         where public.ep_admin_inbox_visible(n.kind, n.employee_id)
           and case coalesce(p_filter, 'all')
                 when 'all' then true
                 when 'unread' then not exists (select 1 from public.ep_admin_notification_reads r
                                                 where r.notification_id = n.id and r.user_id = v_uid)
                 else n.kind = p_filter end
         order by exists (select 1 from public.ep_admin_notification_reads r
                           where r.notification_id = n.id and r.user_id = v_uid), n.created_at desc
         limit least(greatest(coalesce(p_limit, 200), 1), 500)) x), '[]'::jsonb));
end $function$;

select '270: late after 10:05, unread first' as step, (public.ep_attendance_rules() ->> 'late_after') = '10:05' as ok;

commit;
