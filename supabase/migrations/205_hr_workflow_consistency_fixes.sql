-- =====================================================================
-- 205 — HR workflow consistency fixes
-- =====================================================================
-- Policy acknowledgement checklist item (Documents → Checklist, onboarding
-- task "Required joining documents verified").
--
-- Before: the checklist category 'policy_acknowledgement' (107) was complete
-- only with a verified uploaded document. Migration 129 added versioned
-- company policies with in-app acknowledgements (hr_document_acknowledgements),
-- but the checklist never looked at them, so an employee who acknowledged
-- every published policy still showed "Policy acknowledgement: missing" and
-- onboarding stayed blocked until a separate signed form was uploaded.
--
-- Now: the category is ALSO complete when the employee has acknowledged the
-- current published version of every published, employee-visible policy that
-- requires acknowledgement and is addressed to them (same audience rules as
-- hr_private.policy_targets), and there is at least one such policy. With no
-- such policy, the old rule (verified document) still applies. A verified
-- uploaded form keeps working exactly as before. When satisfied through
-- acknowledgements, the checklist row reports verification_status
-- 'acknowledged' and no document_id.
--
-- Unchanged: RLS, permission checks and signatures of hr_document_checklist
-- and hr_lifecycle_internal.onboarding_missing_documents; acknowledgements
-- remain immutable records of receipt (not signatures).
-- Depends on 107, 129, 130. Re-runnable. Apply only with approval.
-- =====================================================================

-- Internal helper: lives in hr_lifecycle_internal (no usage for signed-in
-- users), so it is callable only from the SECURITY DEFINER functions below.
create or replace function hr_lifecycle_internal.policy_acknowledgements_complete(p_employee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  with req as (
    select v.id as version_id
    from public.hr_policies p
    join public.hr_policy_versions v on v.policy_id = p.id and v.status = 'published'
    join public.hr_employees e on e.id = p_employee and e.status not in ('exited','archived','suspended')
    where p.status = 'published' and p.employee_visible and p.requires_acknowledgement
      and case p.audience_type
            when 'all'              then true
            when 'departments'      then e.department_id = any (p.audience_ids)
            when 'locations'        then e.work_location_id = any (p.audience_ids)
            when 'employment_types' then e.employment_type = any (p.audience_codes)
            when 'employees'        then e.id = any (p.audience_ids)
            else false end
  )
  select p_employee is not null
     and exists (select 1 from req)
     and not exists (select 1 from req r
                     where not exists (select 1 from public.hr_document_acknowledgements a
                                       where a.employee_id = p_employee and a.policy_version_id = r.version_id))
$$;
revoke all on function hr_lifecycle_internal.policy_acknowledgements_complete(uuid) from public, anon, authenticated;

-- Required-document checklist (107), policy acknowledgements count for the
-- 'policy_acknowledgement' category.
create or replace function public.hr_document_checklist(p_employee uuid)
returns table (category_code text, category_name text, requires_expiry boolean, employee_can_upload boolean,
               is_complete boolean, document_id uuid, verification_status text, expiry_date date)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_today date := hr_private.business_today();
        v_all boolean := hr_private.has_permission('documents.view') or hr_private.has_permission('documents.manage');
        v_ack boolean;
begin
  if not (hr_private.can_access_employee(p_employee, 'documents') or v_all) then
    perform hr_private.fail('Employee not found.', 'not_found');
  end if;
  v_ack := hr_lifecycle_internal.policy_acknowledgements_complete(p_employee);
  return query
  select c.code, c.name, c.requires_expiry, c.employee_can_upload,
         coalesce(best.verification_status = 'verified' and (best.expiry_date is null or best.expiry_date >= v_today), false)
           or (c.code = 'policy_acknowledgement' and v_ack),
         best.id,
         case when c.code = 'policy_acknowledgement' and v_ack
                   and not coalesce(best.verification_status = 'verified' and (best.expiry_date is null or best.expiry_date >= v_today), false)
              then 'acknowledged' else best.verification_status end,
         best.expiry_date
  from public.hr_document_categories c
  join public.hr_employees e on e.id = p_employee
  left join lateral (
    select d.id, d.verification_status, d.expiry_date
    from public.hr_documents d
    where d.employee_id = p_employee and d.category_id = c.id and d.archived_at is null
    order by (d.verification_status = 'verified' and (d.expiry_date is null or d.expiry_date >= v_today)) desc,
             d.updated_at desc
    limit 1) best on true
  where c.active and c.checklist_required
    and (c.applies_to_employment_types is null or e.employment_type = any (c.applies_to_employment_types))
    and (not c.is_confidential or v_all)
  order by c.sort_order, c.name;
end $$;
revoke execute on function public.hr_document_checklist(uuid) from anon, public;
grant execute on function public.hr_document_checklist(uuid) to authenticated;

-- Onboarding gate (130): same rule, so "Required joining documents verified"
-- can be completed once every applicable policy is acknowledged.
create or replace function hr_lifecycle_internal.onboarding_missing_documents(p_employee uuid)
returns text language sql stable security definer set search_path = '' as $$
  select string_agg(c.name, ', ' order by c.sort_order, c.name)
  from public.hr_document_categories c
  join public.hr_employees e on e.id = p_employee
  where c.active and c.checklist_required and not c.is_confidential
    and (c.applies_to_employment_types is null or e.employment_type = any (c.applies_to_employment_types))
    and not exists (select 1 from public.hr_documents d
                    where d.employee_id = p_employee and d.category_id = c.id and d.archived_at is null
                      and d.verification_status = 'verified'
                      and (d.expiry_date is null or d.expiry_date >= hr_private.business_today()))
    and not (c.code = 'policy_acknowledgement' and hr_lifecycle_internal.policy_acknowledgements_complete(p_employee))
$$;
revoke all on function hr_lifecycle_internal.onboarding_missing_documents(uuid) from public, anon, authenticated;
