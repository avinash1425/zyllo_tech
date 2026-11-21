-- Rollback of 225_project_tracker_password_export.sql.
-- Removes the export function. 'password_exported' log rows are re-labelled 'password_copied'
-- so the old action rule can be restored without deleting audit history.
drop function if exists public.pt_credentials_export_passwords(uuid[]);
update public.pt_credential_events set action = 'password_copied' where action = 'password_exported';
alter table public.pt_credential_events drop constraint if exists pt_credential_events_action_check;
alter table public.pt_credential_events add constraint pt_credential_events_action_check
  check (action in ('password_set', 'password_changed', 'password_removed', 'password_viewed',
                    'password_copied', 'login_deleted'));
