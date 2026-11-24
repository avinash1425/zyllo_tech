-- 268: Welcome email with the one-time password + "mailbox does not exist" alerts.
--
--   * When the admin creates an account (Add employee / Add user), the sign-in email and the one-time
--     password are emailed to that address (Resend, from "Zyllo Tech <info@zyllotech.com>"). The person must
--     set their own password at the first sign-in (employees already did; admin-area users now too).
--   * Every 5 minutes the database asks Resend what happened to recent welcome emails:
--       delivered -> "Welcome email delivered";  bounced -> URGENT admin notification
--       "Mailbox does not exist: <email>";  could not be sent -> admin notification.
--   * "Change sign-in email & resend": the admin corrects the address; a new one-time password is emailed.
--   * Until email is set up (pg_net + Resend key, see 266) nothing is emailed and the admin screens show the
--     password as before.
-- Rollback: supabase/rollbacks/268_rollback_welcome_email.sql

begin;

-- ================================================================ tables
create table if not exists public.rbac_welcome_emails (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  email            text not null,
  kind             text not null default 'welcome' check (kind in ('welcome', 'resend')),
  status           text not null default 'sending' check (status in ('sending', 'sent', 'delivered', 'bounced', 'failed')),
  send_request_id  bigint,
  resend_id        text,
  check_request_id bigint,
  last_event       text,
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists rbac_welcome_emails_user_idx on public.rbac_welcome_emails (user_id, created_at desc);
create index if not exists rbac_welcome_emails_open_idx on public.rbac_welcome_emails (status, created_at) where status in ('sending', 'sent');
alter table public.rbac_welcome_emails enable row level security;
revoke all on public.rbac_welcome_emails from anon, authenticated;

-- Admin-area users who still have the one-time password (employees use ep_employees.must_change_password).
create table if not exists public.rbac_user_flags (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  must_change_password boolean not null default false
);
alter table public.rbac_user_flags enable row level security;
revoke all on public.rbac_user_flags from anon, authenticated;

-- ================================================================ helpers
-- Is sending email set up on this database? (no secret is returned)
create or replace function public.rbac_email_ready()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null
     and exists (select 1 from vault.secrets where name = 'resend_api_key');
$$;
grant execute on function public.rbac_email_ready() to authenticated;

-- A one-time password that follows the password rules (upper, lower, digit, special).
create or replace function public.rbac_one_time_password()
returns text
language sql volatile set search_path = ''
as $$
  select 'Zt' || substr(md5(gen_random_uuid()::text), 1, 6) || '#' || (floor(random() * 90) + 10)::int::text;
$$;

-- Queue the welcome email. Returns 'sending', or 'not_configured' when email is not set up.
create or replace function public.rbac_queue_welcome(p_user uuid, p_email text, p_name text, p_password text, p_kind text default 'welcome')
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_key  text;
  v_req  bigint;
  v_html text;
  v_text text;
begin
  if not public.rbac_email_ready() then
    return 'not_configured';
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
  v_html := '<div style="font-family:Arial,Helvetica,sans-serif;color:#2b303b;max-width:560px">'
    || '<h2 style="color:#1f4693;margin:0 0 12px">Welcome to Zyllo Tech</h2>'
    || '<p>Hello ' || public.ep_html(coalesce(p_name, '')) || ',</p>'
    || '<p>' || case when p_kind = 'resend' then 'Here are your new sign-in details' else 'An account has been created for you' end
    || '. Sign in at <a href="https://zyllotech.com/login">zyllotech.com/login</a> with:</p>'
    || '<table style="border-collapse:collapse;margin:8px 0 16px">'
    || '<tr><td style="padding:6px 12px 6px 0;color:#676b7a">Sign-in email</td><td style="padding:6px 0"><b>' || public.ep_html(p_email) || '</b></td></tr>'
    || '<tr><td style="padding:6px 12px 6px 0;color:#676b7a">One-time password</td><td style="padding:6px 0;font-family:monospace;font-size:16px"><b>' || public.ep_html(p_password) || '</b></td></tr>'
    || '</table>'
    || '<p>You will be asked to choose your own password when you sign in for the first time.</p>'
    || '<p style="color:#9aa0ad;font-size:12px">If you did not expect this email, you can ignore it.</p></div>';
  v_text := 'Welcome to Zyllo Tech' || chr(10) || chr(10)
    || 'Sign in at https://zyllotech.com/login' || chr(10)
    || 'Sign-in email: ' || p_email || chr(10)
    || 'One-time password: ' || p_password || chr(10) || chr(10)
    || 'You will be asked to choose your own password when you sign in for the first time.';
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 10000)'
    into v_req
    using 'https://api.resend.com/emails',
          jsonb_build_object('from', 'Zyllo Tech <info@zyllotech.com>', 'to', jsonb_build_array(p_email),
                             'subject', 'Your Zyllo Tech sign-in details', 'html', v_html, 'text', v_text),
          jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key);
  insert into public.rbac_welcome_emails (user_id, email, kind, send_request_id) values (p_user, p_email, p_kind, v_req);
  return 'sending';
end $$;

-- Latest welcome email of a user (for the admin screens).
create or replace function public.rbac_welcome_json(p_user uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('status', w.status, 'email', w.email, 'kind', w.kind, 'error', w.error,
                            'created_at', w.created_at, 'updated_at', w.updated_at)
    from public.rbac_welcome_emails w where w.user_id = p_user order by w.created_at desc limit 1;
$$;

-- Every 5 minutes: delivery status of recent welcome emails; bounces -> urgent admin notification.
create or replace function public.rbac_check_welcome_emails()
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  w      public.rbac_welcome_emails;
  v_code int;
  v_body text;
  v_err  text;
  v_json jsonb;
  v_key  text;
  v_emp  uuid;
  v_link text;
  v_n    int := 0;
begin
  if to_regclass('net._http_response') is null then
    return 0;
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
  for w in select * from public.rbac_welcome_emails
            where status in ('sending', 'sent') and created_at > now() - interval '3 days' for update skip locked loop
    select id into v_emp from public.ep_employees where user_id = w.user_id;
    v_link := case when v_emp is not null then '/admin/employees/' || v_emp else '/admin/settings/users' end;

    if w.status = 'sending' then
      v_code := null; v_body := null; v_err := null;
      execute 'select status_code, content::text, error_msg from net._http_response where id = $1'
        into v_code, v_body, v_err using w.send_request_id;
      if v_code between 200 and 299 then
        begin v_json := v_body::jsonb; exception when others then v_json := '{}'::jsonb; end;
        update public.rbac_welcome_emails set status = 'sent', resend_id = v_json ->> 'id', updated_at = now() where id = w.id;
        w.status := 'sent';
        w.resend_id := v_json ->> 'id';
      elsif v_code is not null or v_err is not null or w.created_at < now() - interval '1 hour' then
        update public.rbac_welcome_emails
           set status = 'failed', error = left(coalesce(v_body, v_err, 'No answer from the email service'), 500), updated_at = now()
         where id = w.id;
        perform public.ep_admin_notify(v_emp, 'account', 'Sign-in email could not be sent to ' || w.email,
          'The welcome email with the one-time password was not sent: ' || left(coalesce(v_body, v_err, 'no answer from the email service'), 200),
          v_link, 'urgent');
      end if;
      if w.status <> 'sent' then
        v_n := v_n + 1;
        continue;
      end if;
      -- accepted just now: ask Resend for its delivery status right away (below)
    end if;

    -- status 'sent': read the last check, then ask again (Resend GET /emails/{id})
    if w.check_request_id is not null then
      v_code := null; v_body := null;
      execute 'select status_code, content::text from net._http_response where id = $1'
        into v_code, v_body using w.check_request_id;
      if v_code between 200 and 299 then
        begin v_json := v_body::jsonb; exception when others then v_json := '{}'::jsonb; end;
        update public.rbac_welcome_emails set last_event = v_json ->> 'last_event', updated_at = now() where id = w.id;
        if v_json ->> 'last_event' in ('delivered', 'opened', 'clicked', 'complained') then
          update public.rbac_welcome_emails set status = 'delivered' where id = w.id;
          continue;
        elsif v_json ->> 'last_event' = 'bounced' then
          update public.rbac_welcome_emails set status = 'bounced', error = 'Mailbox does not exist (bounced)' where id = w.id;
          perform public.ep_admin_notify(v_emp, 'account', 'Mailbox does not exist: ' || w.email,
            'The welcome email with the one-time password bounced, so this person cannot sign in. '
              || 'Open their page and use “Change sign-in email & resend” with their correct email.',
            v_link, 'urgent');
          continue;
        end if;
      end if;
    end if;
    if w.resend_id is not null and v_key is not null then
      execute 'select net.http_get(url := $1, headers := $2, timeout_milliseconds := 10000)'
        into v_code
        using 'https://api.resend.com/emails/' || w.resend_id,
              jsonb_build_object('Authorization', 'Bearer ' || v_key);
      update public.rbac_welcome_emails set check_request_id = v_code where id = w.id;
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Admin: correct the sign-in email of a person and email them a new one-time password.
create or replace function public.rbac_admin_change_email(p_user uuid, p_email text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
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
  select role_key into v_role from public.rbac_user_roles where user_id = p_user;
  if v_role = 'super_admin' and not public.ep_is_super_admin() then
    raise exception 'Only a Super Admin can change a Super Admin''s email.' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'Enter a valid sign-in email.' using errcode = '22023';
  end if;
  if coalesce(v_role, 'employee') not in ('super_admin', 'admin') and not public.ep_email_is_real(v_email) then
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
end $$;

revoke all on function public.rbac_one_time_password(), public.rbac_queue_welcome(uuid, text, text, text, text),
  public.rbac_welcome_json(uuid), public.rbac_check_welcome_emails() from public, anon, authenticated;
revoke all on function public.rbac_admin_change_email(uuid, text) from public, anon;
grant execute on function public.rbac_admin_change_email(uuid, text) to authenticated;

-- ================================================================ updated functions (generated)
CREATE OR REPLACE FUNCTION public.ep_admin_create_employee(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f          text;
  v_code     text := upper(btrim(coalesce(p ->> 'employee_code', '')));
  v_name     text := btrim(coalesce(p ->> 'full_name', ''));
  v_email    text := lower(btrim(coalesce(p ->> 'email', '')));
  v_password text := coalesce(p ->> 'password', '');
  v_user     uuid;
  v_linked   boolean := false;
  v_welcome  text := 'linked';
  v_emp      uuid;
  v_work     jsonb;
begin
  perform public.rbac_require('portal.employees.create'); -- rbac
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Invalid employee data.' using errcode = '22023';
  end if;
  for f in select jsonb_object_keys(p) loop
    if f not in ('employee_code', 'full_name', 'email', 'password', 'department', 'designation',
                 'reporting_manager_id', 'reporting_manager_name', 'date_of_joining', 'employment_type', 'work_location') then
      raise exception 'Field % cannot be set here.', f using errcode = '42501';
    end if;
  end loop;

  if v_code !~ '^[A-Z0-9][A-Z0-9-]{1,29}$' then
    raise exception 'Employee ID: use 2-30 letters, numbers or dashes (e.g. ZT-001).' using errcode = '22023';
  end if;
  if length(v_name) not between 1 and 120 then
    raise exception 'Name is required (up to 120 characters).' using errcode = '22023';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'Enter a valid work email.' using errcode = '22023';
  end if;
  -- Employees sign in with their own real email (migration 267).
  if not public.ep_email_is_real(v_email) then
    raise exception 'Use the person''s real email address: % cannot receive email.', v_email using errcode = '22023';
  end if;
  if exists (select 1 from public.ep_employees where employee_code = v_code) then
    raise exception 'Employee ID % is already used.', v_code using errcode = '23505';
  end if;

  -- Same email twice at the same moment: serialise.
  perform pg_advisory_xact_lock(hashtextextended('ep_create_employee:' || v_email, 0));

  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is not null then
    if exists (select 1 from public.ep_employees where user_id = v_user) then
      raise exception 'This email already belongs to an employee.' using errcode = '23505';
    end if;
    if public.ep_user_is_admin(v_user) then
      raise exception 'This email is an admin account. Use a separate email for the employee.' using errcode = '22023';
    end if;
    v_linked := true;
  else
    if public.ep_password_problem(v_password) is not null then
      raise exception 'Temporary password: %', public.ep_password_problem(v_password) using errcode = '22023';
    end if;
    v_user := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values (
      '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
      extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('full_name', v_name), now(), now(),
      '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    values (
      v_user::text, v_user,
      jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true),
      'email', now(), now());
  end if;

  -- A new login with a temporary password must be changed at the first sign-in.
  insert into public.ep_employees (user_id, employee_code, full_name, must_change_password)
  values (v_user, v_code, v_name, not v_linked)
  returning id into v_emp;

  -- Work details: only the keys given, with the same checks as editing.
  v_work := p - 'employee_code' - 'full_name' - 'email' - 'password';
  if v_work <> '{}'::jsonb then
    perform public.ep_admin_update_employee(v_emp, v_work);
  end if;

  perform public.ep_notify(
    v_emp, 'message', 'Welcome to the Zyllo Tech Employee Portal',
    'Your account is ready. Please complete your personal details and emergency contacts in My Profile.',
    '/employee/profile');

  -- Email the sign-in email + one-time password (migration 268).
  if not v_linked then
    v_welcome := public.rbac_queue_welcome(v_user, v_email, v_name, v_password, 'welcome');
  end if;
  return public.ep_admin_employee(v_emp) || jsonb_build_object('linked_existing_account', v_linked, 'welcome', v_welcome);
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
  if cardinality(v_roles) <> 1 then
    raise exception 'Choose one role (a person has one role at a time).' using errcode = '22023';
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
    'roles', coalesce((select jsonb_agg(jsonb_build_object('key', r.key, 'name', r.name, 'area', r.area) order by r.sort_order)
                         from public.rbac_roles r where r.key = any (v_roles)), '[]'::jsonb),
    'permissions', coalesce((select jsonb_agg(p.key order by p.sort_order) from public.rbac_permissions p
                              where v_super or exists (select 1 from public.rbac_role_permissions rp
                                                        where rp.permission_key = p.key and rp.role_key = any (v_roles))),
                            '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.rbac_my_change_password(p_current text, p_new text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid  uuid := auth.uid();
  v_hash text;
begin
  if v_uid is null then
    raise exception 'Please sign in again.' using errcode = '42501';
  end if;
  select encrypted_password into v_hash from auth.users where id = v_uid;
  if v_hash is null or v_hash = '' or extensions.crypt(coalesce(p_current, ''), v_hash) <> v_hash then
    perform pg_sleep(1); -- slows down guessing
    raise exception 'Your current password is not correct.' using errcode = '22023';
  end if;
  if public.ep_password_problem(p_new) is not null then
    raise exception 'New password: %', public.ep_password_problem(p_new) using errcode = '22023';
  end if;
  if p_new = p_current then
    raise exception 'The new password must be different from the current one.' using errcode = '22023';
  end if;
  update auth.users set encrypted_password = extensions.crypt(p_new, extensions.gen_salt('bf')), updated_at = now()
   where id = v_uid;
  update public.ep_employees set must_change_password = false where user_id = v_uid and must_change_password;
  update public.rbac_user_flags set must_change_password = false where user_id = v_uid;
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.ep_admin_employee_json(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    'manager_name', case when m.id is null then e.reporting_manager_name end,
    'user_id', e.user_id,
    'sign_in_email', u.email,
    'welcome', public.rbac_welcome_json(e.user_id),
    'admin_approver', case when e.admin_approver_id is not null then jsonb_build_object('user_id', e.admin_approver_id,
                         'name', public.ep_user_display_name(e.admin_approver_id)) end,
    'reports_count', (select count(*) from public.ep_employees r where r.reporting_manager_id = e.id),
    'punched_in', exists (select 1 from public.ep_attendance a where a.employee_id = e.id and a.punch_out_at is null)
  )
  from public.ep_employees e
  left join auth.users u on u.id = e.user_id
  left join public.ep_employees m on m.id = e.reporting_manager_id
  where e.id = p_id;
$function$;

CREATE OR REPLACE FUNCTION public.rbac_admin_users()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.rbac_require('settings.users.view');
  return coalesce((
    select jsonb_agg(x.j order by x.ord, x.nm) from (
      select (case when exists (select 1 from public.rbac_user_roles ur join public.rbac_roles r on r.key = ur.role_key
                                 where ur.user_id = u.id and r.area = 'admin') then 0 else 1 end) as ord,
             lower(coalesce(e.full_name, u.raw_user_meta_data ->> 'full_name', u.email)) as nm,
             jsonb_build_object(
               'user_id', u.id,
               'sign_in', u.email,
               'full_name', coalesce(e.full_name, nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1)),
               'employee_id', e.id, 'employee_code', e.employee_code, 'employee_active', e.is_active,
               'roles', coalesce((select jsonb_agg(ur.role_key order by r.sort_order)
                                    from public.rbac_user_roles ur join public.rbac_roles r on r.key = ur.role_key
                                   where ur.user_id = u.id), '[]'::jsonb),
               'last_sign_in_at', u.last_sign_in_at, 'created_at', u.created_at,
               'is_self', u.id = auth.uid(),
               'welcome', public.rbac_welcome_json(u.id)) as j
        from auth.users u
        left join public.ep_employees e on e.user_id = u.id
       where e.id is not null or exists (select 1 from public.rbac_user_roles ur where ur.user_id = u.id)) x),
    '[]'::jsonb);
end $function$;

-- ================================================================ every 5 minutes
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobname) from cron.job where jobname = 'rbac-welcome-check';
    perform cron.schedule('rbac-welcome-check', '*/5 * * * *', 'select public.rbac_check_welcome_emails()');
  else
    raise warning 'pg_cron is not enabled: bounces of welcome emails will not be checked automatically.';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
