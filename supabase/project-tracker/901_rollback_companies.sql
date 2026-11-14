-- =====================================================================
-- Zyllo Tech — Project Tracker: ROLLBACK OF 003 ONLY (company hierarchy).
-- Keeps every project and all project records. Removes companies and the
-- project→company link (assignments are lost — export the Companies and
-- Company Project Register reports first). Views return to their 001 form.
-- Needs explicit approval.
-- =====================================================================
begin;

drop view if exists public.pt_company_summary;
drop view if exists public.pt_project_list;
drop view if exists public.pt_due_items;

drop trigger if exists pt_25_company on public.pt_projects;
alter table public.pt_projects drop column if exists company_id;
drop table if exists public.pt_companies;
drop function if exists public.pt_projects_company_rules();
drop function if exists public.pt_companies_rules();

-- Views exactly as created by 001:
create view public.pt_project_list with (security_invoker = true) as
select p.*, h.overview_state, h.hosting_state, h.domain_state, h.admin_access_state, h.backups_state, h.source_state,
       h.maintenance_state, h.amc_state, h.seo_state, h.handover_state, h.applicable_sections, h.completeness_score,
       h.completeness_label, h.last_backup_at, h.last_backup_verified_on, h.backup_missing, h.backup_verification_overdue,
       h.admin_details_missing, h.handover_pending, h.handover_status, h.latest_update_date, h.overdue_tasks,
       h.last_activity_at, h.last_activity_by
  from public.pt_projects p
  join public.pt_project_health h on h.project_id = p.id;

create view public.pt_due_items with (security_invoker = true) as
select x.*, p.name as project_name, p.project_code, p.client_name, (x.due_date - public.pt_today()) as days_left
from (
  select h.project_id, 'hosting'::text as kind, 'pt_hosting'::text as source_table, h.id as record_id,
         h.provider || ' · ' || h.environment || ' · ' || h.purpose as label, h.renewal_date as due_date, h.auto_renew, h.responsible_person
    from public.pt_hosting h where h.archived_at is null and h.status = 'active' and h.renewal_date is not null
  union all
  select h.project_id, 'hosting', 'pt_hosting', h.id, h.provider || ' · ' || h.environment || ' (expiry)', h.expiry_date, h.auto_renew, h.responsible_person
    from public.pt_hosting h where h.archived_at is null and h.status = 'active' and h.expiry_date is not null
     and h.expiry_date is distinct from h.renewal_date
  union all
  select d.project_id, 'domain', 'pt_domains', d.id, d.domain_name, d.expires_on, d.auto_renew, null
    from public.pt_domains d where d.archived_at is null and d.status in ('active', 'pending', 'parked') and d.expires_on is not null
  union all
  select d.project_id, 'ssl', 'pt_domains', d.id, d.domain_name || ' (SSL)', d.ssl_expires_on, d.ssl_auto_renew, null
    from public.pt_domains d where d.archived_at is null and d.status in ('active', 'pending', 'parked') and d.ssl_expires_on is not null
  union all
  select c.project_id, 'amc', 'pt_amc_contracts', c.id, 'AMC ' || coalesce(c.contract_number, ''), coalesce(c.renewal_date, c.end_date), false, c.responsible_person
    from public.pt_amc_contracts c where c.archived_at is null and c.status = 'active'
  union all
  select r.project_id, case r.item_type when 'email_service' then 'email' when 'subscription' then 'subscription' else r.item_type end,
         'pt_renewals', r.id, r.item_label, r.due_date, false, null
    from public.pt_renewals r where r.archived_at is null and r.status = 'upcoming'
) x
join public.pt_projects p on p.id = x.project_id and p.archived_at is null;

revoke all on public.pt_project_list, public.pt_due_items from public, anon, authenticated;
grant select on public.pt_project_list, public.pt_due_items to authenticated;

commit;
