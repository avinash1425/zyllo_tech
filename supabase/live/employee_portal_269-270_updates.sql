-- =====================================================================================
-- Employee Portal — live database update (run in Lovable Cloud -> SQL editor,
-- AFTER employee_portal_253-268_updates.sql). Same as migrations 269 + 270, as ONE transaction.
--   269: a person can have SEVERAL roles (e.g. HR + Manager); every active Employee Portal account is
--        also an Employee. The top-bar "Role" button switches between roles without signing out or
--        punching out.
--   270: punch in 9:40 - 10:05 AM is on time, after 10:05 AM is Late; notifications show unread first.
-- Structure only: no data is copied (existing roles are kept). Safe to run again.
-- Undo: supabase/rollbacks/270_rollback_late_after_1005_unread_first.sql, then 269_rollback_rbac_many_roles.sql
-- =====================================================================================

begin;

do $$
begin
  if to_regprocedure('public.rbac_queue_welcome(uuid, text, text, text, text)') is null
     or to_regprocedure('public.rbac_admin_change_email(uuid, text)') is null
     or to_regprocedure('public.ep_admin_inbox(text, integer)') is null then
    raise exception 'Run employee_portal_253-268_updates.sql first.';
  end if;
end $$;

-- ===================== 269_rbac_many_roles.sql =====================

-- 269: Several roles per person + a role switcher.
--   * A person may have more than one role (e.g. HR and Manager). The unique "one role per person" index of
--     migration 263 is dropped. What a person may do = everything their roles allow together (the database
--     keeps checking every action).
--   * Every active Employee Portal account also has the Employee role, whatever other roles it has, so an
--     HR / Admin who is an employee can still punch in, apply for leave and send daily reports.
--   * rbac_my_access() returns each role with its own permissions: the top-bar switcher shows the pages of
--     one role at a time without signing out (punch-in is not touched).
--   * Add user / Users & Roles accept several roles; change-email works with several roles.
-- Safe to run again. Rollback: supabase/rollbacks/269_rollback_rbac_many_roles.sql


insert into public.rbac_backup (kind, name, definition)
select 'function269', f, pg_get_functiondef(f::regprocedure)
  from (values ('public.rbac_roles_of(uuid)'), ('public.rbac_my_access()'), ('public.rbac_admin_set_user_roles(uuid,text[])'),
               ('public.rbac_admin_create_user(jsonb)'), ('public.rbac_admin_change_email(uuid,text)')) v(f)
on conflict do nothing;

drop index if exists public.rbac_user_roles_one_per_user;

-- The roles of a user: the ones given on Users & Roles, plus Employee for an active portal account.
create or replace function public.rbac_roles_of(p_user uuid)
returns text[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array(select ur.role_key from public.rbac_user_roles ur join public.rbac_roles r on r.key = ur.role_key
                         where ur.user_id = p_user order by r.sort_order), '{}'::text[])
      || case when exists (select 1 from public.ep_employees e where e.user_id = p_user and e.is_active)
                   and not exists (select 1 from public.rbac_user_roles ur where ur.user_id = p_user and ur.role_key = 'employee')
              then array['employee'] else '{}'::text[] end;
$$;
revoke all on function public.rbac_roles_of(uuid) from public, anon, authenticated;

update public.rbac_roles set description = 'Everyone with an Employee Portal account (also when they have other roles).' where key = 'employee';

CREATE OR REPLACE FUNCTION public.rbac_admin_set_user_roles(p_user uuid, p_roles text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_new   text[] := coalesce((select array_agg(distinct r) from unnest(coalesce(p_roles, '{}')) r), '{}');
  v_old   text[];
  v_super boolean := public.rbac_user_can(auth.uid(), 'settings.users.edit')
                     and exists (select 1 from public.rbac_user_roles where user_id = auth.uid() and role_key = 'super_admin');
  v_bad   text;
begin
  perform public.rbac_require('settings.users.edit');
  if p_user = auth.uid() then
    raise exception 'You cannot change your own roles. Ask another Super Admin.' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'User not found.' using errcode = 'P0002';
  end if;
  select r into v_bad from unnest(v_new) r where r not in (select key from public.rbac_roles) limit 1;
  if v_bad is not null then
    raise exception 'Unknown role %.', v_bad using errcode = '22023';
  end if;
  -- Several roles per person (migration 269). "Employee" is implicit for every active Employee Portal account.
  if 'employee' = any (v_new) then
    if not exists (select 1 from public.ep_employees where user_id = p_user) then
      raise exception 'Employee is only for Employee Portal accounts.' using errcode = '22023';
    end if;
    v_new := array_remove(v_new, 'employee');
  end if;
  if cardinality(v_new) = 0 and not exists (select 1 from public.ep_employees where user_id = p_user) then
    raise exception 'Choose a role.' using errcode = '22023';
  end if;
  -- HR, Manager, Team Lead and Employee need a real email (migration 267); Super Admin / Admin do not.
  if (exists (select 1 from unnest(v_new) r where r not in ('super_admin', 'admin'))
      or exists (select 1 from public.ep_employees where user_id = p_user))
     and not public.ep_email_is_real((select email from auth.users where id = p_user)) then
    raise exception 'Use the person''s real email address: % cannot receive email.', (select email from auth.users where id = p_user) using errcode = '22023';
  end if;
  if (('manager' = any (v_new)) or ('team_lead' = any (v_new)))
     and not exists (select 1 from public.ep_employees where user_id = p_user) then
    raise exception 'Manager and Team Lead are for Employee Portal accounts.' using errcode = '22023';
  end if;
  select coalesce(array_agg(role_key), '{}') into v_old from public.rbac_user_roles where user_id = p_user;
  if (('super_admin' = any (v_new)) <> ('super_admin' = any (v_old))) and not v_super then
    raise exception 'Only a Super Admin can give or remove the Super Admin role.' using errcode = '42501';
  end if;
  delete from public.rbac_user_roles where user_id = p_user and role_key <> all (v_new);
  insert into public.rbac_user_roles (user_id, role_key, granted_by)
  select p_user, r, auth.uid() from unnest(v_new) r on conflict do nothing;
  if not exists (select 1 from public.rbac_user_roles where role_key = 'super_admin') then
    raise exception 'There must always be at least one Super Admin.' using errcode = '22023';
  end if;
  return to_jsonb(coalesce((select array_agg(role_key order by role_key) from public.rbac_user_roles where user_id = p_user), '{}'));
end $function$;

CREATE OR REPLACE FUNCTION public.rbac_admin_create_user(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_email text := lower(btrim(coalesce(p ->> 'email', '')));
  v_name  text := nullif(btrim(coalesce(p ->> 'full_name', '')), '');
  v_pw    text := coalesce(p ->> 'password', '');
  v_roles text[] := coalesce((select array_agg(distinct r) from jsonb_array_elements_text(coalesce(p -> 'roles', '[]'::jsonb)) r), '{}');
  v_user  uuid;
  v_bad   text;
begin
  perform public.rbac_require('settings.users.create');
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'Enter a valid sign-in email.' using errcode = '22023';
  end if;
  -- Only Super Admin / Admin may use an email that is not a real mailbox (migration 267).
  if exists (select 1 from jsonb_array_elements_text(coalesce(p -> 'roles', '[]'::jsonb)) r where r not in ('super_admin', 'admin'))
     and not public.ep_email_is_real(v_email) then
    raise exception 'Use the person''s real email address: % cannot receive email.', v_email using errcode = '22023';
  end if;
  if v_name is null or length(v_name) > 120 then
    raise exception 'Name is required (up to 120 characters).' using errcode = '22023';
  end if;
  if cardinality(v_roles) < 1 then
    raise exception 'Choose at least one role.' using errcode = '22023';
  end if;
  select r into v_bad from unnest(v_roles) r
   where r not in (select key from public.rbac_roles where area = 'admin') limit 1;
  if v_bad is not null then
    raise exception 'Only admin-area roles can be given here (Super Admin, Admin, HR).' using errcode = '22023';
  end if;
  if 'super_admin' = any (v_roles)
     and not exists (select 1 from public.rbac_user_roles where user_id = auth.uid() and role_key = 'super_admin') then
    raise exception 'Only a Super Admin can give the Super Admin role.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rbac_create_user:' || v_email, 0));
  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is not null then
    if exists (select 1 from public.rbac_user_roles where user_id = v_user)
       or exists (select 1 from public.ep_employees where user_id = v_user) then
      raise exception 'This email already has an account. Change its roles in the list instead.' using errcode = '23505';
    end if;
  else
    if public.ep_password_problem(v_pw) is not null then
      raise exception 'Password: %', public.ep_password_problem(v_pw) using errcode = '22023';
    end if;
    v_user := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
      extensions.crypt(v_pw, extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('full_name', v_name), now(), now(),
      '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    values (v_user::text, v_user,
            jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true), 'email', now(), now());
    -- One-time password: emailed (migration 268) and changed at the first sign-in.
    insert into public.rbac_user_flags (user_id, must_change_password) values (v_user, true)
    on conflict (user_id) do update set must_change_password = true;
    perform public.rbac_queue_welcome(v_user, v_email, v_name, v_pw, 'welcome');
  end if;
  insert into public.rbac_user_roles (user_id, role_key, granted_by)
  select v_user, r, auth.uid() from unnest(v_roles) r on conflict do nothing;
  return v_user;
end $function$;

CREATE OR REPLACE FUNCTION public.rbac_admin_change_email(p_user uuid, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_emp   public.ep_employees;
  v_role  text;
  v_name  text;
  v_pw    text := public.rbac_one_time_password();
  v_state text;
begin
  select * into v_emp from public.ep_employees where user_id = p_user;
  if v_emp.id is not null then
    perform public.rbac_require_any(array['portal.employees.edit', 'settings.users.edit']);
  else
    perform public.rbac_require('settings.users.edit');
  end if;
  if p_user = auth.uid() then
    raise exception 'Change your own email is not possible here.' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'User not found.' using errcode = 'P0002';
  end if;
  -- Several roles (migration 269): the highest one decides.
  select ur.role_key into v_role from public.rbac_user_roles ur join public.rbac_roles r on r.key = ur.role_key
   where ur.user_id = p_user order by r.sort_order limit 1;
  if v_role = 'super_admin' and not public.ep_is_super_admin() then
    raise exception 'Only a Super Admin can change a Super Admin''s email.' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'Enter a valid sign-in email.' using errcode = '22023';
  end if;
  if (coalesce(v_role, 'employee') not in ('super_admin', 'admin')
      or exists (select 1 from public.rbac_user_roles where user_id = p_user and role_key not in ('super_admin', 'admin'))
      or v_emp.id is not null)
     and not public.ep_email_is_real(v_email) then
    raise exception 'Use the person''s real email address: % cannot receive email.', v_email using errcode = '22023';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email and id <> p_user) then
    raise exception 'This email already belongs to another account.' using errcode = '23505';
  end if;
  update auth.users
     set email = v_email, encrypted_password = extensions.crypt(v_pw, extensions.gen_salt('bf')),
         email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
   where id = p_user;
  update auth.identities
     set identity_data = coalesce(identity_data, '{}'::jsonb) || jsonb_build_object('email', v_email), updated_at = now()
   where user_id = p_user and provider = 'email';
  if v_emp.id is not null then
    update public.ep_employees set must_change_password = true, updated_at = now() where id = v_emp.id;
  else
    insert into public.rbac_user_flags (user_id, must_change_password) values (p_user, true)
    on conflict (user_id) do update set must_change_password = true;
  end if;
  v_name := public.ep_user_display_name(p_user);
  v_state := public.rbac_queue_welcome(p_user, v_email, v_name, v_pw, 'resend');
  return jsonb_build_object('email', v_email, 'welcome', v_state,
                            'password', case when v_state = 'not_configured' then v_pw end);
end $function$;

CREATE OR REPLACE FUNCTION public.rbac_my_access()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid   uuid := auth.uid();
  v_roles text[] := public.rbac_roles_of(auth.uid());
  v_super boolean := 'super_admin' = any (public.rbac_roles_of(auth.uid()));
begin
  if v_uid is null then
    return jsonb_build_object('roles', '[]'::jsonb, 'permissions', '[]'::jsonb, 'is_admin', false, 'is_super_admin', false);
  end if;
  return jsonb_build_object(
    'is_super_admin', v_super,
    'must_change_password', coalesce((select f.must_change_password from public.rbac_user_flags f where f.user_id = v_uid), false),
    'is_admin', public.rbac_user_has_admin_pages(v_uid),
    -- Each role with its own permissions: the top-bar role switcher shows one role at a time (migration 269).
    'roles', coalesce((select jsonb_agg(jsonb_build_object(
                         'key', r.key, 'name', r.name, 'area', r.area,
                         'permissions', case when r.key = 'super_admin'
                           then (select coalesce(jsonb_agg(p.key order by p.sort_order), '[]'::jsonb) from public.rbac_permissions p)
                           else (select coalesce(jsonb_agg(p.key order by p.sort_order), '[]'::jsonb) from public.rbac_permissions p
                                  join public.rbac_role_permissions rp on rp.permission_key = p.key and rp.role_key = r.key) end,
                         'admin_pages', r.key = 'super_admin' or exists (select 1 from public.rbac_role_permissions rp join public.rbac_permissions p on p.key = rp.permission_key
                                                                         where rp.role_key = r.key and p.area = 'admin'),
                         'portal_features', exists (select 1 from public.rbac_role_permissions rp join public.rbac_permissions p on p.key = rp.permission_key
                                                     where rp.role_key = r.key and p.area <> 'admin'))
                       order by r.sort_order)
                         from public.rbac_roles r where r.key = any (v_roles)), '[]'::jsonb),
    'is_employee', exists (select 1 from public.ep_employees e where e.user_id = v_uid and e.is_active),
    'permissions', coalesce((select jsonb_agg(p.key order by p.sort_order) from public.rbac_permissions p
                              where v_super or exists (select 1 from public.rbac_role_permissions rp
                                                        where rp.permission_key = p.key and rp.role_key = any (v_roles))),
                            '[]'::jsonb));
end $function$;

revoke all on function public.rbac_my_access() from public, anon;
grant execute on function public.rbac_my_access() to authenticated;



-- ===================== 270_late_after_1005_unread_first.sql =====================

-- 270: Attendance + notifications.
--   * Punch in between 09:40 and 10:05 (India time) is on time; the first punch in after 10:05 is Late.
--     (Late is worked out from the rules every time, so past days are shown with the new time too.)
--   * Notifications (Employee Portal and admin): unread ones first (newest first), then the read ones.
-- Safe to run again. Rollback: supabase/rollbacks/270_rollback_late_after_1005_unread_first.sql


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



-- ===================== check =====================
select '269: several roles per person' as step,
       not exists (select 1 from pg_indexes where indexname = 'rbac_user_roles_one_per_user') as ok
union all
select '270: late after 10:05, unread first', (public.ep_attendance_rules() ->> 'late_after') = '10:05';

commit;
