-- =====================================================================
-- LOCAL TEST ONLY. Password LOGIC with the plaintext vault TEST DOUBLE
-- (vault_test_double.sql) and passwords switched on. Verifies authorization,
-- re-authentication, audit, rate limiting, rotation, revocation and isolation.
-- It does NOT verify encryption — that needs the real Supabase Vault (005).
-- Synthetic passwords only.
-- =====================================================================
\set ON_ERROR_STOP 1

do $$
declare r jsonb; v_other uuid; n int;
begin
  perform test.eq(public.pt_password_backend(), 'test_double', 'backend reports the TEST DOUBLE (never "supabase_vault")');

  -- editors can set (write-only); the value never lands in pt_ tables
  perform test.as_user_email(test.id('editor'));
  perform public.pt_set_access_password(test.id('credHost'), 'Synthetic-Host-Pass-1!');
  perform test.ok((select has_password from public.pt_access_records where id = test.id('credHost')), 'password stored; record flagged has_password');
  perform test.throws(format($q$select public.pt_set_access_password(%L, 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig')$q$, test.id('credSupa')),
                      'service-role style keys are refused', 'API key');
  perform test.throws(format($q$select public.pt_set_access_password(%L, 'sb_secret_abcdefghijklmnop')$q$, test.id('credSupa')),
                      'Supabase secret keys are refused', 'API key');
  perform public.pt_set_access_password(test.id('credSupa'), 'Synthetic-Supa-Pass-2!');
  perform test.ok(not exists (select 1 from public.pt_access_records t where to_jsonb(t)::text like '%Synthetic-Host-Pass%'), 'password not in pt_access_records');
  perform test.ok(not exists (select 1 from public.pt_activity_logs t where to_jsonb(t)::text like '%Synthetic-%Pass%'), 'password not in activity logs');

  -- editor / viewer cannot reveal; refusals are logged
  r := public.pt_reveal_access_password(test.id('credHost'));
  perform test.eq(r ->> 'reason', 'forbidden', 'editor cannot reveal');
  perform test.ok(not (r ? 'password'), 'no password in a refused reveal');
  perform test.as_user_email(test.id('viewer'));
  perform test.eq(public.pt_reveal_access_password(test.id('credHost')) ->> 'reason', 'forbidden', 'viewer cannot reveal');
  perform test.as_user_email(test.id('outsider'));
  perform test.throws(format('select public.pt_reveal_access_password(%L)', test.id('credHost')), 'non-admin cannot call reveal', 'access');

  -- manager needs a recent sign-in
  perform test.as_user_auth(test.id('manager'), 3600);
  perform test.eq(public.pt_reveal_access_password(test.id('credHost')) ->> 'reason', 'reauth_required', 'manager with an old sign-in must re-authenticate');
  perform test.as_user_email(test.id('manager'));
  perform test.eq(public.pt_reveal_access_password(test.id('credHost')) ->> 'reason', 'reauth_required', 'token without sign-in time must re-authenticate');
  perform test.as_user_auth(test.id('manager'), 30);
  r := public.pt_reveal_access_password(test.id('credHost'));
  perform test.eq(r ->> 'password', 'Synthetic-Host-Pass-1!', 'manager with a recent sign-in can reveal');
  perform test.eq((r ->> 'expires_in')::int, 30, 'reveal carries a short display time');
  r := public.pt_reveal_access_password(test.id('credSupa'), 'copy');
  perform test.eq(r ->> 'password', 'Synthetic-Supa-Pass-2!', 'copy returns the right record''s password (no cross-record mix-up)');
  perform test.as_owner();
  perform test.ok(exists (select 1 from public.pt_activity_logs where entity_id = test.id('credHost') and action = 'access.password_revealed'), 'reveal logged');
  perform test.ok(exists (select 1 from public.pt_activity_logs where entity_id = test.id('credSupa') and action = 'access.password_copied'), 'copy logged');
  perform test.ok((select count(*) from public.pt_activity_logs where entity_id = test.id('credHost') and action = 'access.password_denied') >= 4,
                  'refused attempts logged (editor, viewer, reauth)');
  perform test.ok(not exists (select 1 from public.pt_activity_logs t where to_jsonb(t)::text like '%Synthetic-%Pass%'), 'logs never contain the value');

  -- rotation
  perform test.as_user_email(test.id('editor'));
  perform public.pt_set_access_password(test.id('credHost'), 'Synthetic-Host-Pass-ROTATED');
  perform test.as_user_auth(test.id('manager'), 10);
  perform test.eq(public.pt_reveal_access_password(test.id('credHost')) ->> 'password', 'Synthetic-Host-Pass-ROTATED', 'rotation replaces the value');
  perform test.as_owner();
  perform test.eq((select count(*)::int from vault.secrets where name = 'pt_access_' || test.id('credHost')::text), 1, 'one vault secret per record after rotation');
  perform test.ok(exists (select 1 from public.pt_activity_logs where entity_id = test.id('credHost') and action = 'access.password_changed'), 'rotation logged');

  -- rate limit
  update public.pt_settings set max_reveals_per_10min = 3;
  perform test.as_user_auth(test.id('manager'), 10);
  perform public.pt_reveal_access_password(test.id('credSupa'));
  perform public.pt_reveal_access_password(test.id('credSupa'));
  perform test.eq(public.pt_reveal_access_password(test.id('credSupa')) ->> 'reason', 'rate_limited', 'reveals are rate-limited per user');
  perform test.as_owner();
  update public.pt_settings set max_reveals_per_10min = 200;

  -- isolation: a different project's credential with its own password
  perform test.as_user_email(test.id('editor'));
  insert into public.pt_access_records (project_id, service_name, category) values (test.id('A2P1'), 'A2 admin', 'website_admin') returning id into v_other;
  perform public.pt_set_access_password(v_other, 'Synthetic-A2-Pass-3!');
  perform test.as_owner();
  perform test.eq((select project_id from public.pt_access_secrets where access_record_id = v_other), test.id('A2P1'), 'vault id bound to its own project');
  perform test.as_user_auth(test.id('manager'), 10);
  perform test.eq(public.pt_reveal_access_password(v_other) ->> 'password', 'Synthetic-A2-Pass-3!', 'project A2 credential reveals A2''s password only');

  -- revocation
  perform test.as_user_email(test.id('editor'));
  perform test.throws(format('select public.pt_clear_access_password(%L)', v_other), 'editor cannot remove a stored password', 'managers');
  perform test.as_user_auth(test.id('manager'), 10);
  perform public.pt_clear_access_password(v_other);
  perform test.eq(public.pt_reveal_access_password(v_other) ->> 'reason', 'no_password', 'cleared password is gone');
  perform test.as_owner();
  perform test.eq((select count(*)::int from vault.secrets where name = 'pt_access_' || v_other::text), 0, 'vault secret deleted on clear');
  perform test.ok(not (select has_password from public.pt_access_records where id = v_other), 'record no longer flagged');

  -- archived project: read-only
  perform test.as_user_email(test.id('editor'));
  update public.pt_projects set archived_at = now(), archive_reason = 'cred test' where id = test.id('A2P1');
  perform test.throws(format($q$select public.pt_set_access_password(%L, 'Synthetic-X-9')$q$, v_other), 'no password changes in an archived project', 'archived');
  perform test.as_user_email(test.id('manager'));
  update public.pt_projects set archived_at = null where id = test.id('A2P1');

  -- anon cannot execute any of it
  perform test.as_anon();
  perform test.throws(format('select public.pt_reveal_access_password(%L)', test.id('credHost')), 'anon cannot call reveal', 'permission denied');
  perform test.throws(format($q$select public.pt_set_access_password(%L, 'x')$q$, test.id('credHost')), 'anon cannot set passwords', 'permission denied');
  perform test.as_owner();
  select count(*) into n from vault.secrets;
  perform test.ok(n >= 2, 'secrets live only in the vault (' || n || ' entries)');
end $$;

select 'credentials (vault logic, test double) suite finished' as result;
