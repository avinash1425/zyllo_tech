-- 266: Daily work report -> "Send by email" (real emails through Resend).
--
-- The employee sends their saved daily report (exactly what they wrote) to any email address or to people
-- picked from the portal (their sign-in emails). Sent FROM "<employee> via Zyllo Tech <info@zyllotech.com>",
-- reply-to = the employee's sign-in email.
-- Sending happens from the database (pg_net -> https://api.resend.com/emails); no server function needed.
-- Setup (once per database, see docs/project-tracker/SETUP.md):
--   1. pg_net enabled (Supabase: Database -> Extensions -> pg_net).
--   2. Resend account, domain zyllotech.com verified, API key stored in the Vault:
--        select vault.create_secret('<your Resend API key>', 'resend_api_key');
--   Until then "Send by email" answers "Email is not set up yet".
-- Limits: 1-10 recipients per send, at most 30 report emails per employee per day.
--   ep_report_emails             one row per send (who, to whom, which report, delivery status)
--   ep_report_email_options()    people to pick: reporting manager, approver, colleagues, admins
--   ep_email_my_report(date, to) send the saved report of that day
--   ep_my_report_emails(date)    what was sent for that day + status (sending / sent / failed)
-- Rollback: supabase/rollbacks/266_rollback_report_email.sql

begin;

create table if not exists public.ep_report_emails (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.ep_work_reports (id) on delete cascade,
  employee_id uuid not null references public.ep_employees (id) on delete cascade,
  recipients  text[] not null check (cardinality(recipients) between 1 and 10),
  subject     text not null,
  request_id  bigint,
  status      text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  error       text,
  created_at  timestamptz not null default now()
);
create index if not exists ep_report_emails_emp_idx on public.ep_report_emails (employee_id, created_at desc);
alter table public.ep_report_emails enable row level security;
revoke all on public.ep_report_emails from anon, authenticated;
comment on table public.ep_report_emails is 'Daily work reports sent by email (migration 266). Written by ep_email_my_report.';

-- HTML-escape helper.
create or replace function public.ep_html(p text)
returns text
language sql immutable set search_path = ''
as $$
  select replace(replace(replace(replace(coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;');
$$;
revoke all on function public.ep_html(text) from public, anon, authenticated;

-- People the employee can pick (their sign-in emails).
create or replace function public.ep_report_email_options()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_emp public.ep_employees;
begin
  select * into v_emp from public.ep_employees where id = public.ep_current_employee_id();
  if v_emp.id is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(x.j order by x.ord, x.nm) from (
      select case when e.id = v_emp.reporting_manager_id then 0
                  when u.id = v_emp.admin_approver_id then 1 else 3 end as ord,
             lower(e.full_name) as nm,
             jsonb_build_object('email', u.email, 'name', e.full_name,
               'tag', case when e.id = v_emp.reporting_manager_id then 'Reporting manager'
                           when u.id = v_emp.admin_approver_id then 'Approver'
                           else coalesce(e.designation, 'Colleague') end) as j
        from public.ep_employees e join auth.users u on u.id = e.user_id
       where e.is_active and e.id <> v_emp.id and u.email is not null
      union all
      select case when u.id = v_emp.admin_approver_id then 1 else 2 end, lower(public.ep_user_display_name(u.id)),
             jsonb_build_object('email', u.email, 'name', public.ep_user_display_name(u.id),
               'tag', case when u.id = v_emp.admin_approver_id then 'Approver' else r.name end)
        from public.rbac_user_roles ur join public.rbac_roles r on r.key = ur.role_key and r.area = 'admin'
        join auth.users u on u.id = ur.user_id
       where u.email is not null and not exists (select 1 from public.ep_employees e2 where e2.user_id = u.id)
    ) x), '[]'::jsonb);
end $$;

create or replace function public.ep_email_my_report(p_date date, p_to text[])
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp     public.ep_employees;
  v_email   text;
  v_rep     public.ep_work_reports;
  v_json    jsonb;
  v_to      text[];
  v_bad     text;
  v_key     text;
  v_subject text;
  v_html    text;
  v_text    text;
  v_item    jsonb;
  v_req     bigint;
  v_id      uuid;
begin
  perform public.rbac_require('emp.reports.create');
  select * into v_emp from public.ep_employees where id = public.ep_current_employee_id();
  if v_emp.id is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  select email into v_email from auth.users where id = v_emp.user_id;

  select coalesce(array_agg(distinct lower(btrim(t))), '{}') into v_to
    from unnest(coalesce(p_to, '{}')) t where btrim(t) <> '';
  if cardinality(v_to) = 0 then
    raise exception 'Add at least one email address.' using errcode = '22023';
  end if;
  if cardinality(v_to) > 10 then
    raise exception 'You can send to at most 10 email addresses at a time.' using errcode = '22023';
  end if;
  select t into v_bad from unnest(v_to) t where t !~ '^[^@\s<>",;]+@[^@\s<>",;]+\.[a-z]{2,}$' or length(t) > 254 limit 1;
  if v_bad is not null then
    raise exception 'This is not a valid email address: %', v_bad using errcode = '22023';
  end if;

  select * into v_rep from public.ep_work_reports where employee_id = v_emp.id and report_date = p_date;
  if v_rep.id is null then
    raise exception 'Save the report first, then send it by email.' using errcode = 'P0002';
  end if;
  if (select count(*) from public.ep_report_emails
       where employee_id = v_emp.id and created_at > now() - interval '1 day') >= 30 then
    raise exception 'You can send at most 30 report emails a day.' using errcode = '22023';
  end if;

  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    raise exception 'Email is not set up yet (pg_net is not enabled). Please tell the admin.' using errcode = 'P0001';
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
  if v_key is null or btrim(v_key) = '' then
    raise exception 'Email is not set up yet (no Resend API key). Please tell the admin.' using errcode = 'P0001';
  end if;

  v_json := public.ep_report_json(v_rep.id);
  v_subject := 'Daily work report — ' || v_emp.full_name || ' (' || v_emp.employee_code || ') — '
               || to_char(p_date, 'Dy DD Mon YYYY');

  -- HTML + plain text: exactly what the employee wrote.
  v_html := '<div style="font-family:Arial,Helvetica,sans-serif;color:#2b303b;max-width:640px">'
    || '<h2 style="color:#1f4693;margin:0 0 4px">Daily work report</h2>'
    || '<p style="margin:0 0 16px;color:#676b7a">' || public.ep_html(v_emp.full_name) || ' (' || public.ep_html(v_emp.employee_code) || ')'
    || coalesce(' · ' || public.ep_html(v_emp.designation), '') || ' · ' || to_char(p_date, 'Dy DD Mon YYYY')
    || ' · status: ' || public.ep_html(v_rep.status) || '</p>';
  v_text := 'Daily work report' || chr(10) || v_emp.full_name || ' (' || v_emp.employee_code || ') · '
    || to_char(p_date, 'Dy DD Mon YYYY') || ' · status: ' || v_rep.status || chr(10) || chr(10);
  for v_item in select * from jsonb_array_elements(v_json -> 'items') loop
    v_html := v_html || '<div style="border:1px solid #e3e9f5;border-radius:10px;padding:12px 14px;margin:0 0 12px">'
      || '<p style="margin:0 0 8px;font-weight:bold;color:#101a3a">' || public.ep_html(v_item ->> 'project_name')
      || ' <span style="color:#9aa0ad;font-weight:normal">' || public.ep_html(v_item ->> 'project_code') || ' · '
      || public.ep_html(v_item ->> 'hours') || ' h</span></p>'
      || case when v_item ->> 'task_updates' is not null then '<p style="margin:0 0 6px"><b>Task updates:</b><br>' || replace(public.ep_html(v_item ->> 'task_updates'), chr(10), '<br>') || '</p>' else '' end
      || case when v_item ->> 'completed_work' is not null then '<p style="margin:0 0 6px"><b>Completed:</b><br>' || replace(public.ep_html(v_item ->> 'completed_work'), chr(10), '<br>') || '</p>' else '' end
      || case when v_item ->> 'pending_work' is not null then '<p style="margin:0"><b>Pending:</b><br>' || replace(public.ep_html(v_item ->> 'pending_work'), chr(10), '<br>') || '</p>' else '' end
      || '</div>';
    v_text := v_text || (v_item ->> 'project_name') || ' (' || (v_item ->> 'project_code') || ') · ' || (v_item ->> 'hours') || ' h' || chr(10)
      || coalesce('Task updates: ' || (v_item ->> 'task_updates') || chr(10), '')
      || coalesce('Completed: ' || (v_item ->> 'completed_work') || chr(10), '')
      || coalesce('Pending: ' || (v_item ->> 'pending_work') || chr(10), '') || chr(10);
  end loop;
  if v_rep.notes is not null then
    v_html := v_html || '<div style="border:1px solid #f7d9b5;background:#fffaf3;border-radius:10px;padding:12px 14px;margin:0 0 12px">'
      || '<p style="margin:0 0 6px;font-weight:bold">'
      || case when jsonb_array_length(v_json -> 'items') = 0 then 'Work done today' else 'Other work, notes / blockers' end
      || '</p><p style="margin:0">' || replace(public.ep_html(v_rep.notes), chr(10), '<br>') || '</p></div>';
    v_text := v_text || case when jsonb_array_length(v_json -> 'items') = 0 then 'Work done today: ' else 'Notes: ' end
      || v_rep.notes || chr(10) || chr(10);
  end if;
  v_html := v_html || '<p style="color:#676b7a">Total hours: <b>' || coalesce(v_json ->> 'total_hours', '0') || '</b></p>'
    || '<p style="color:#9aa0ad;font-size:12px">Sent from the Zyllo Tech Employee Portal. Reply to this email to answer '
    || public.ep_html(v_emp.full_name) || '.</p></div>';
  v_text := v_text || 'Total hours: ' || coalesce(v_json ->> 'total_hours', '0') || chr(10)
    || 'Sent from the Zyllo Tech Employee Portal. Reply to this email to answer ' || v_emp.full_name || '.';

  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 10000)'
    into v_req
    using 'https://api.resend.com/emails',
          jsonb_build_object(
            'from', replace(v_emp.full_name, '"', '') || ' via Zyllo Tech <info@zyllotech.com>',
            'to', to_jsonb(v_to),
            'reply_to', v_email,
            'subject', v_subject,
            'html', v_html,
            'text', v_text),
          jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key);

  insert into public.ep_report_emails (report_id, employee_id, recipients, subject, request_id)
  values (v_rep.id, v_emp.id, v_to, v_subject, v_req)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'status', 'sending', 'recipients', to_jsonb(v_to));
end $$;

-- Sent emails of a day + delivery status (read from pg_net's response log).
create or replace function public.ep_my_report_emails(p_date date)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_emp uuid := public.ep_current_employee_id();
  r     record;
  v_code int;
  v_body text;
  v_err  text;
begin
  if v_emp is null then
    raise exception 'Not an active employee.' using errcode = '42501';
  end if;
  -- Update statuses still "sending" from pg_net's responses.
  if to_regclass('net._http_response') is not null then
    for r in select e.id, e.request_id from public.ep_report_emails e
              join public.ep_work_reports w on w.id = e.report_id
             where e.employee_id = v_emp and w.report_date = p_date and e.status = 'sending' and e.request_id is not null loop
      execute 'select status_code, content::text, error_msg from net._http_response where id = $1'
        into v_code, v_body, v_err using r.request_id;
      if v_code between 200 and 299 then
        update public.ep_report_emails set status = 'sent', error = null where id = r.id;
      elsif v_code is not null or v_err is not null then
        update public.ep_report_emails
           set status = 'failed', error = left(coalesce(v_body, v_err, 'Unknown error'), 500)
         where id = r.id;
      end if;
    end loop;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'recipients', to_jsonb(e.recipients), 'status', e.status,
                                        'error', e.error, 'created_at', e.created_at) order by e.created_at desc)
      from public.ep_report_emails e join public.ep_work_reports w on w.id = e.report_id
     where e.employee_id = v_emp and w.report_date = p_date), '[]'::jsonb);
end $$;

revoke all on function public.ep_report_email_options(), public.ep_email_my_report(date, text[]),
  public.ep_my_report_emails(date) from public, anon;
grant execute on function public.ep_report_email_options(), public.ep_email_my_report(date, text[]),
  public.ep_my_report_emails(date) to authenticated;

notify pgrst, 'reload schema';

commit;
