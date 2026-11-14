-- =====================================================================
-- Zyllo Tech — Project Tracker: ENABLE vault-backed passwords.
--
-- NOT APPLIED. Separate approval gate: after this, real passwords can be
-- stored (encrypted by Supabase Vault) and revealed to Project Tracker
-- managers. Run only after 004, on a project where Supabase Vault
-- (extension `supabase_vault`) is enabled (Dashboard > Database > Extensions;
-- enabling it is itself a production change needing approval).
--
-- The script refuses to enable anything unless:
--   1. supabase_vault is installed;
--   2. API roles (anon, authenticated) cannot read vault.secrets or
--      vault.decrypted_secrets directly;
--   3. a self-test secret round-trips, is stored encrypted (ciphertext differs
--      from the plaintext) and is deleted again.
-- Disable again any time:  update public.pt_settings set passwords_enabled = false;
-- =====================================================================
begin;

do $$
declare
  v_id    uuid;
  v_plain text := 'pt-vault-selftest-' || gen_random_uuid()::text;
  v_out   text;
  v_raw   text;
begin
  if to_regclass('public.pt_settings') is null then
    raise exception 'Apply 004_project_tracker_credentials_documents.sql first.';
  end if;
  if not exists (select 1 from pg_extension where extname = 'supabase_vault') then
    raise exception 'Supabase Vault (extension supabase_vault) is not installed on this project. Nothing was enabled.';
  end if;
  if has_table_privilege('anon', 'vault.decrypted_secrets', 'select')
     or has_table_privilege('authenticated', 'vault.decrypted_secrets', 'select')
     or has_table_privilege('anon', 'vault.secrets', 'select')
     or has_table_privilege('authenticated', 'vault.secrets', 'select') then
    raise exception 'API roles can read the vault directly. Fix the vault privileges first. Nothing was enabled.';
  end if;

  v_id := vault.create_secret(v_plain, 'pt_vault_selftest_' || replace(gen_random_uuid()::text, '-', ''), 'Project Tracker vault self-test (deleted at once)');
  select decrypted_secret into v_out from vault.decrypted_secrets where id = v_id;
  select secret::text into v_raw from vault.secrets where id = v_id;
  delete from vault.secrets where id = v_id;
  if v_out is distinct from v_plain then
    raise exception 'Vault self-test failed: the secret did not round-trip. Nothing was enabled.';
  end if;
  if v_raw is null or v_raw = v_plain or position(v_plain in v_raw) > 0 then
    raise exception 'Vault self-test failed: the stored value is not encrypted. Nothing was enabled.';
  end if;

  update public.pt_settings
     set passwords_enabled = true, passwords_enabled_at = now(),
         passwords_enabled_note = 'Supabase Vault self-test passed', updated_at = now();
end $$;

commit;

select public.pt_password_backend() as password_backend;   -- expect: supabase_vault
