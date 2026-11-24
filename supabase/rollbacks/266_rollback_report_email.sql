-- Rollback of 266_report_email.sql: removes "Send by email" and its log. pg_net and the Vault key stay.
begin;
drop function if exists public.ep_my_report_emails(date);
drop function if exists public.ep_email_my_report(date, text[]);
drop function if exists public.ep_report_email_options();
drop function if exists public.ep_html(text);
drop table if exists public.ep_report_emails;
notify pgrst, 'reload schema';
commit;
