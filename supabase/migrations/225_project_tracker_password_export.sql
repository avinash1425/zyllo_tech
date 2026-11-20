-- =====================================================================
-- 225_project_tracker_password_export.sql — Project Tracker round 6
-- =====================================================================
-- Excel export of logins WITH passwords (the owner chose "always include").
--   public.pt_credentials_export_passwords(uuid[]) returns (credential_id, password)
--     * website admin only, signed in with a password within the last 10 minutes
--     * up to 500 logins per call, at most 1000 exported passwords per admin per 10 minutes
--     * every exported password is logged as 'password_exported' (never the value)
-- Depends on 223. Idempotent (safe to re-run).
-- Rollback: supabase/rollbacks/225_rollback_project_tracker_password_export.sql
-- =====================================================================

alter table public.pt_credential_events drop constraint if exists pt_credential_events_action_check;
alter table public.pt_credential_events add constraint pt_credential_events_action_check
  check (action in ('password_set', 'password_changed', 'password_removed', 'password_viewed',
                    'password_copied', 'password_exported', 'login_deleted'));

create or replace function public.pt_credentials_export_passwords(p_credential_ids uuid[])
returns table (credential_id uuid, password text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids    uuid[] := array(select distinct x from unnest(coalesce(p_credential_ids, array[]::uuid[])) as x where x is not null);
  v_count  integer := cardinality(v_ids);
  v_recent integer;
  v_cred   public.pt_credentials;
begin
  perform pt_private.require_admin();
  if not pt_private.signed_in_within(600) then
    raise exception 'PT_REAUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if v_count = 0 then
    return;
  end if;
  if v_count > 500 then
    raise exception 'PT_TOO_MANY' using errcode = 'P0001';
  end if;

  select count(*) into v_recent
    from public.pt_credential_events
   where actor = auth.uid()
     and action = 'password_exported'
     and created_at > now() - interval '10 minutes';
  if v_recent + v_count > 1000 then
    raise exception 'PT_RATE_LIMITED' using errcode = 'P0001';
  end if;

  for v_cred in
    select c.* from public.pt_credentials c
     where c.id = any (v_ids) and c.has_password
  loop
    credential_id := v_cred.id;
    select d.decrypted_secret into password
      from pt_private.credential_secrets s
      join vault.decrypted_secrets d on d.id = s.secret_id
     where s.credential_id = v_cred.id;
    if password is not null then
      perform pt_private.log_credential_event(v_cred, 'password_exported');
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function public.pt_credentials_export_passwords(uuid[]) from public, anon;
grant execute on function public.pt_credentials_export_passwords(uuid[]) to authenticated;
