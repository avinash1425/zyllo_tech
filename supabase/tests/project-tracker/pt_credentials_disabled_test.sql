-- =====================================================================
-- LOCAL TEST ONLY. Credentials with NO vault configured (the default state
-- after migration 004, locally and on live until 005 is approved).
-- Runs after the earlier suites (reuses users and projects).
-- =====================================================================
\set ON_ERROR_STOP 1

-- helper: impersonate with a recent (or old) sign-in time in the JWT `amr` claim
create or replace function test.as_user_auth(p_user uuid, p_seconds_ago int) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated', 'email', test.email_of(p_user), 'session_id', test.session_for(p_user),
    'amr', json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - p_seconds_ago)))::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on function test.as_user_auth(uuid, int) to anon, authenticated, service_role;

do $$
declare v uuid; r jsonb;
begin
  perform test.as_user_email(test.id('editor'));
  perform test.eq(public.pt_password_backend(), 'disabled', 'no vault configured: password backend is disabled');
  perform test.eq(public.pt_settings_public() ->> 'password_backend', 'disabled', 'UI sees the disabled state');
  perform test.throws('select * from public.pt_settings', 'settings table not readable via the API', 'permission denied');
  perform test.throws('select * from public.pt_access_secrets', 'vault id table not readable via the API', 'permission denied');

  -- new categories + per-category fields
  insert into public.pt_access_records (project_id, service_name, category, login_url, login_identifier, organization, project_name,
                                        resource_ref, environment, two_factor)
  values (test.id('A1P1'), 'Supabase — A1 portal', 'supabase', 'https://supabase.example/dashboard/project/abcd', 'ops@a1.example',
          'A1 Org', 'a1-portal', 'abcdefghijklmnop', 'production', 'enabled') returning id into v;
  perform test.put('credSupa', v);
  insert into public.pt_access_records (project_id, service_name, category, login_url, login_identifier, provider, hosting_type, environment, renewal_date)
  values (test.id('A1P1'), 'Hostinger hPanel', 'hosting_panel', 'https://hpanel.example', 'host@a1.example', 'Hostinger', 'VPS', 'production', public.pt_today() + 30)
  returning id into v;
  perform test.put('credHost', v);
  insert into public.pt_access_records (project_id, service_name, category) values (test.id('A1P1'), 'Cloudflare', 'cloudflare'), (test.id('A1P1'), 'Vercel', 'vercel'),
    (test.id('A1P1'), 'Render', 'render'), (test.id('A1P1'), 'cPanel', 'cpanel');
  perform test.ok(true, 'new credential categories accepted (supabase, cloudflare, vercel, render, cpanel)');
  perform test.throws(format($q$update public.pt_access_records set has_password = true where id = %L$q$, test.id('credHost')),
                      'has_password cannot be faked', 'permission denied');
  perform test.throws(format($q$select public.pt_set_access_password(%L, 'Synthetic-Pass-123')$q$, test.id('credHost')),
                      'saving a password is refused while no vault is configured', 'disabled until a secure vault');
  perform test.as_user_auth(test.id('manager'), 0);
  r := public.pt_reveal_access_password(test.id('credHost'));
  perform test.eq(r ->> 'reason', 'disabled', 'reveal reports disabled (no fake reveal)');
  perform test.ok(not (r ? 'password'), 'no password field in a disabled reveal');

  -- credential links for email accounts and hosting records
  perform test.as_user_email(test.id('editor'));
  insert into public.pt_email_accounts (project_id, email_address, purpose, provider, login_url) values (test.id('A1P1'), 'info@a1.example', 'info', 'Zoho', 'https://mail.example')
  returning id into v;
  perform test.put('mailInfo', v);
  v := public.pt_ensure_email_credential(test.id('mailInfo'));
  perform test.eq((select linked_access_id from public.pt_email_accounts where id = test.id('mailInfo')), v, 'email account linked to a new credential record');
  perform test.eq((select category || '|' || login_identifier || '|' || project_id::text from public.pt_access_records where id = v),
                  'email_account|info@a1.example|' || test.id('A1P1')::text, 'email credential created in the same project with the address as login');
  perform test.eq(public.pt_ensure_email_credential(test.id('mailInfo')), v, 'ensure is idempotent');
  insert into public.pt_hosting (project_id, provider, environment, account_email, control_panel_url) values (test.id('A1P1'), 'Render', 'staging', 'render@a1.example', 'https://dashboard.render.example')
  returning id into v;
  perform test.put('hostRender', v);
  v := public.pt_ensure_hosting_credential(test.id('hostRender'));
  perform test.eq((select access_record_id from public.pt_hosting where id = test.id('hostRender')), v, 'hosting record linked to its credential record');
  insert into public.pt_access_records (project_id, service_name, category) values (test.id('A2P1'), 'A2 hosting panel', 'hosting_panel') returning id into v;
  perform test.throws(format($q$update public.pt_hosting set access_record_id = %L where id = %L$q$, v, test.id('hostRender')),
                      'hosting cannot link to another project''s credential', 'foreign key');
  perform test.as_user_email(test.id('viewer'));
  perform test.throws(format('select public.pt_ensure_email_credential(%L)', test.id('mailInfo')), 'viewer cannot create credential links', 'permission');
  perform test.as_user_email(test.id('outsider'));
  perform test.ok(public.pt_settings_public() is null, 'settings hidden from non-admins');
  perform test.as_owner();
end $$;

select 'credentials (disabled) suite finished' as result;
