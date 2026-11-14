-- =====================================================================
-- Zyllo Tech — Project Tracker: company hierarchy (Company → Projects).
--
-- NOT APPLIED. Apply after 001 (and 002), with explicit approval.
-- Purely additive:
--   * new table pt_companies (+ RLS, triggers, audit like every pt_ table);
--   * new nullable column pt_projects.company_id (FK) — existing project
--     rows, ids and child records are untouched;
--   * views pt_project_list / pt_due_items are re-created with company
--     columns; new view pt_company_summary.
--
-- Backfill strategy for projects that exist before this migration: they are
-- NOT assigned to invented companies. They stay company_id = NULL and show
-- as "Unassigned" in the app until an editor picks a company (the edit
-- form requires one). Optional SQL to assign them is at the end of this
-- file (commented out).
--
-- Business rules
--   * Every NEW project must belong to a company; once assigned, a project
--     cannot be left without one. Moving a project to another company is
--     manager-only and logged.
--   * New projects cannot be created under (or moved to) an archived company,
--     and an archived project cannot be restored while its company is archived.
--   * A company cannot be archived while it has active (non-archived)
--     projects: archive or move them first. Companies are never deleted.
--   * Restoring an archived company is manager-only (as for every pt_ record).
-- =====================================================================

begin;

do $$
begin
  if to_regclass('public.pt_projects') is null then
    raise exception 'Apply 001_project_tracker_schema.sql first.';
  end if;
  if to_regclass('public.pt_companies') is not null then
    raise exception 'public.pt_companies already exists: 003 is already installed. Aborting (nothing changed).';
  end if;
end $$;

-- ------------------------------------------------------------ table
create table public.pt_companies (
  id              uuid primary key default gen_random_uuid(),
  serial_no       bigint generated always as identity unique,
  company_number  text not null default '',
  company_code    text,
  company_name    text not null check (char_length(btrim(company_name)) between 2 and 200),
  company_type    text not null default 'private_limited'
                  check (company_type in ('private_limited', 'public_limited', 'llp', 'partnership', 'proprietorship',
                                          'government', 'non_profit', 'educational', 'individual', 'other')),
  website         text check (public.pt_valid_url(website)),
  contact_person  text check (char_length(contact_person) <= 200),
  contact_email   text check (public.pt_valid_email(contact_email)),
  contact_phone   text check (contact_phone ~ '^[0-9+()\-. ]{6,25}$'),
  country         text not null default 'India' check (char_length(btrim(country)) between 2 and 100),
  state           text check (char_length(state) <= 100),
  city            text check (char_length(city) <= 100),
  address         text check (char_length(address) <= 1000),
  status          text not null default 'active' check (status in ('active', 'prospect', 'inactive', 'former_client')),
  remarks         text check (char_length(remarks) <= 5000),
  created_at        timestamptz not null default now(),
  created_by        uuid,
  created_by_email  text,
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  updated_by_email  text,
  archived_at       timestamptz,
  archived_by       uuid,
  archive_reason    text check (char_length(archive_reason) <= 1000),
  constraint pt_companies_code_format check (company_code is null or company_code ~ '^[A-Z0-9][A-Z0-9-]{1,19}$')
);
create unique index pt_companies_number_uidx on public.pt_companies (company_number);
create unique index pt_companies_code_uidx on public.pt_companies (upper(company_code)) where company_code is not null;
-- No two ACTIVE companies with the same name (case-insensitive).
create unique index pt_companies_name_uidx on public.pt_companies (lower(btrim(company_name))) where archived_at is null;

alter table public.pt_projects add column company_id uuid references public.pt_companies(id);
create index pt_projects_company_idx on public.pt_projects (company_id);

-- ------------------------------------------------------------ rules
create or replace function public.pt_companies_rules()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_active int;
begin
  new.company_name := btrim(new.company_name);
  new.company_code := upper(nullif(btrim(coalesce(new.company_code, '')), ''));
  if tg_op = 'INSERT' then
    new.company_number := 'ZT-CO-' || lpad(new.serial_no::text, 4, '0');
  else
    new.serial_no := old.serial_no;
    new.company_number := old.company_number;
    if old.archived_at is null and new.archived_at is not null then
      select count(*) into v_active from public.pt_projects p where p.company_id = new.id and p.archived_at is null;
      if v_active > 0 then
        raise exception using errcode = 'P0001',
          message = format('This company still has %s active project(s). Archive them or move them to another company first.', v_active);
      end if;
    end if;
  end if;
  return new;
end $$;

create or replace function public.pt_projects_company_rules()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_company public.pt_companies%rowtype;
begin
  -- Callers without edit rights are rejected by RLS right after this trigger;
  -- don't reveal anything about companies to them first.
  if public.pt_is_api_call() and not public.pt_can_edit() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.company_id is null then
      raise exception using errcode = '23502', message = 'Select the company this project belongs to.';
    end if;
  elsif new.company_id is distinct from old.company_id then
    if new.company_id is null then
      raise exception using errcode = '23502', message = 'A project cannot be left without a company.';
    end if;
    if old.company_id is not null and public.pt_is_api_call() and not public.pt_is_manager() then
      raise exception using errcode = '42501', message = 'Only Project Tracker managers can move a project to another company.';
    end if;
  end if;

  if new.company_id is not null then
    select * into v_company from public.pt_companies c where c.id = new.company_id;
    if not found then
      raise exception using errcode = '23503', message = 'The selected company does not exist (or you cannot see it).';
    end if;
    if v_company.archived_at is not null
       and (tg_op = 'INSERT' or new.company_id is distinct from old.company_id
            or (old.archived_at is not null and new.archived_at is null)) then
      raise exception using errcode = 'P0001',
        message = 'The company is archived. Restore the company before adding, moving or restoring its projects.';
    end if;
    -- Keep the legacy client_name column filled (reports/exports fallback).
    if tg_op = 'INSERT' or new.company_id is distinct from old.company_id then
      new.client_name := v_company.company_name;
    end if;
  end if;
  return new;
end $$;

create trigger pt_10_before_write before insert or update on public.pt_companies
  for each row execute function public.pt_before_write();
create trigger pt_20_rules before insert or update on public.pt_companies
  for each row execute function public.pt_companies_rules();
create trigger pt_90_after_write after insert or update on public.pt_companies
  for each row execute function public.pt_after_write('company', 'company_name');
create trigger pt_25_company before insert or update on public.pt_projects
  for each row execute function public.pt_projects_company_rules();

-- ------------------------------------------------------------ views
drop view public.pt_project_list;
create view public.pt_project_list with (security_invoker = true) as
select p.*, h.overview_state, h.hosting_state, h.domain_state, h.admin_access_state, h.backups_state, h.source_state,
       h.maintenance_state, h.amc_state, h.seo_state, h.handover_state, h.applicable_sections, h.completeness_score,
       h.completeness_label, h.last_backup_at, h.last_backup_verified_on, h.backup_missing, h.backup_verification_overdue,
       h.admin_details_missing, h.handover_pending, h.handover_status, h.latest_update_date, h.overdue_tasks,
       h.last_activity_at, h.last_activity_by,
       c.company_name, c.company_number, c.company_code, c.archived_at as company_archived_at
  from public.pt_projects p
  join public.pt_project_health h on h.project_id = p.id
  left join public.pt_companies c on c.id = p.company_id;

-- Same columns as in 001, plus the company (appended).
create or replace view public.pt_due_items with (security_invoker = true) as
select x.*, p.name as project_name, p.project_code, p.client_name, (x.due_date - public.pt_today()) as days_left,
       p.company_id, c.company_name
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
join public.pt_projects p on p.id = x.project_id and p.archived_at is null
left join public.pt_companies c on c.id = p.company_id;

-- One row per company with live project counts (archived projects excluded
-- from the status counts and counted separately).
create view public.pt_company_summary with (security_invoker = true) as
select c.*,
  count(p.id) filter (where p.archived_at is null)                                         as total_projects,
  count(p.id) filter (where p.archived_at is null and p.status = 'live')                    as live_projects,
  count(p.id) filter (where p.archived_at is null and p.status = 'in_progress')             as in_progress_projects,
  count(p.id) filter (where p.archived_at is null and p.status = 'under_maintenance')       as maintenance_projects,
  count(p.id) filter (where p.archived_at is null and p.status = 'completed')               as completed_projects,
  count(p.id) filter (where p.archived_at is null and p.status in ('planned', 'under_testing', 'under_client_review', 'on_hold')) as other_projects,
  count(p.id) filter (where p.archived_at is null and h.handover_pending)                   as pending_handover_projects,
  count(p.id) filter (where p.archived_at is not null)                                      as archived_projects,
  max(h.last_activity_at)                                                                   as last_project_activity_at
from public.pt_companies c
left join public.pt_projects p on p.company_id = c.id
left join public.pt_project_health h on h.project_id = p.id
group by c.id;

-- ------------------------------------------------------------ security
alter table public.pt_companies enable row level security;
revoke all on public.pt_companies from public, anon, authenticated;
grant all on public.pt_companies to service_role;
grant select on public.pt_companies to authenticated;
grant insert (company_code, company_name, company_type, website, contact_person, contact_email, contact_phone,
              country, state, city, address, status, remarks)
  on public.pt_companies to authenticated;
grant update (company_code, company_name, company_type, website, contact_person, contact_email, contact_phone,
              country, state, city, address, status, remarks, archived_at, archive_reason)
  on public.pt_companies to authenticated;
create policy pt_select on public.pt_companies for select to authenticated using ((select public.pt_can_read()));
create policy pt_insert on public.pt_companies for insert to authenticated with check ((select public.pt_can_edit()));
create policy pt_update on public.pt_companies for update to authenticated
  using ((select public.pt_can_edit())) with check ((select public.pt_can_edit()));

grant insert (company_id) on public.pt_projects to authenticated;

revoke all on public.pt_project_list, public.pt_due_items, public.pt_company_summary from public, anon, authenticated;
grant select on public.pt_project_list, public.pt_due_items, public.pt_company_summary to authenticated;

revoke all on function public.pt_companies_rules(), public.pt_projects_company_rules() from public, anon, authenticated;
grant execute on function public.pt_companies_rules(), public.pt_projects_company_rules() to authenticated;

commit;

-- ---------------------------------------------------------------------
-- OPTIONAL (only with a decision per project): assign pre-existing projects.
--
--   insert into public.pt_companies (company_name, company_type) values ('<REAL COMPANY NAME>', 'private_limited');
--   update public.pt_projects set company_id = (select id from public.pt_companies where company_name = '<REAL COMPANY NAME>')
--    where id = '<PROJECT UUID>' and company_id is null;
--
-- Unassigned projects can also be assigned from the app (Edit Project).
-- ---------------------------------------------------------------------
