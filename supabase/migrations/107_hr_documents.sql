-- =====================================================================
-- 107_hr_documents.sql — Employee documents (versioned, private storage)
--                         and employee avatars
-- =====================================================================
-- Depends on 100_hr_foundation.sql.
--
-- Storage layout (both buckets PRIVATE; files are read via short-lived
-- signed URLs that storage RLS below authorises):
--   hr-documents / <employee_id>/<document_id>/<version>-<sanitized file name>
--   hr-avatars   / <employee_id>/<file name>.(png|jpg|jpeg|webp)
-- hr_document_versions.storage_path and hr_employees.photo_path hold the
-- object name WITHOUT the bucket prefix.
--
-- Upload sequence (documents):
--   1. rpc hr_register_document_upload / hr_new_document_version
--      -> validates permission + file, returns { storage_path, ... }
--   2. storage.from('hr-documents').upload(storage_path, file)   (no upsert)
--      -> allowed only for the exact registered path, by the user who
--         registered it, within 24h, and only if no object exists yet.
--   3. HR verifies with hr_verify_document (checks the object exists).
-- Reading: createSignedUrl(storage_path) (storage SELECT policy) and then
-- rpc hr_log_document_access(version_id, 'view'|'download').
-- Versions are immutable: there are no UPDATE/DELETE storage policies.
-- Apply ONLY to the local test cluster or the isolated dev project.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Storage buckets
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('hr-documents', 'hr-documents', false, 10485760, array[
     'application/pdf', 'image/png', 'image/jpeg', 'image/webp',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/msword',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
  ('hr-avatars', 'hr-avatars', false, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table public.hr_document_categories (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  name                 text not null check (length(btrim(name)) between 2 and 120),
  description          text check (description is null or length(description) <= 1000),
  requires_expiry      boolean not null default false,
  employee_can_upload  boolean not null default false,
  employee_can_view    boolean not null default true,
  -- Confidential (e.g. HR investigation notes): HR only (documents.view /
  -- documents.manage). Never visible to the employee or their managers.
  is_confidential      boolean not null default false,
  checklist_required   boolean not null default false,
  applies_to_employment_types text[],          -- null = all employment types
  active               boolean not null default true,
  sort_order           smallint not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

insert into public.hr_document_categories
  (code, name, description, requires_expiry, employee_can_upload, employee_can_view, is_confidential, checklist_required, sort_order) values
  ('offer_letter',           'Offer letter',            'Signed offer letter issued by HR',                 false, false, true,  false, true,  1),
  ('employment_agreement',   'Employment agreement',    'Signed employment / internship agreement',         false, false, true,  false, true,  2),
  ('id_proof',               'ID proof',                'Government-issued identity document',              false, true,  true,  false, true,  3),
  ('education_certificate',  'Education certificate',   'Highest qualification certificate',               false, true,  true,  false, true,  4),
  ('experience_certificate', 'Experience certificate',  'Relieving / experience letters from past employers', false, true, true, false, false, 5),
  ('hr_letter',              'HR letter',               'Letters issued by HR (confirmation, revision, etc.)', false, false, true, false, false, 6),
  ('policy_acknowledgement', 'Policy acknowledgement',  'Signed acknowledgement of company policies',       false, true,  true,  false, true,  7),
  ('other',                  'Other',                   'Any other document',                                false, true,  true,  false, false, 8),
  ('hr_confidential',        'Confidential HR record',  'HR-only records such as investigation notes',      false, false, false, true,  false, 9)
on conflict (code) do nothing;

create table public.hr_documents (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references public.hr_employees(id) on delete restrict,
  category_id         uuid not null references public.hr_document_categories(id) on delete restrict,
  title               text not null check (length(btrim(title)) between 1 and 200),
  current_version     int not null default 0 check (current_version >= 0),
  expiry_date         date,
  verification_status text not null default 'pending' check (verification_status in ('pending','verified','rejected','expired')),
  verified_by         uuid,
  verified_at         timestamptz,
  rejection_reason    text check (rejection_reason is null or length(rejection_reason) <= 1000),
  uploaded_by         uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  archived_at         timestamptz
);
create index hr_documents_employee on public.hr_documents(employee_id, category_id);
create index hr_documents_expiry on public.hr_documents(expiry_date) where archived_at is null and expiry_date is not null;

create table public.hr_document_versions (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.hr_documents(id) on delete restrict,
  version      int not null check (version >= 1),
  storage_path text not null unique,
  file_name    text not null check (length(file_name) between 1 and 160),
  mime_type    text not null,
  size_bytes   bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  checksum     text check (checksum is null or length(checksum) <= 128),
  uploaded_by  uuid,
  uploaded_at  timestamptz not null default now(),   -- registration time
  unique (document_id, version)
);

create table public.hr_document_access_log (
  id           bigint generated always as identity primary key,
  document_id  uuid not null references public.hr_documents(id) on delete restrict,
  version_id   uuid references public.hr_document_versions(id) on delete restrict,
  accessed_by  uuid,
  action       text not null check (action in ('view','download')),
  accessed_at  timestamptz not null default now()
);
create index hr_document_access_log_doc on public.hr_document_access_log(document_id, accessed_at desc);

-- Idempotency ledger for expiry reminders (one per document + expiry date).
create table public.hr_document_expiry_reminders (
  document_id  uuid not null references public.hr_documents(id) on delete restrict,
  expiry_date  date not null,
  reminded_at  timestamptz not null default now(),
  primary key (document_id, expiry_date)
);

create trigger hr_document_categories_touch before update on public.hr_document_categories
  for each row execute function hr_private.touch_updated_at();
create trigger hr_documents_touch before update on public.hr_documents
  for each row execute function hr_private.touch_updated_at();

-- Versions are immutable once registered.
create or replace function hr_private.document_versions_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform hr_private.fail('Document versions cannot be changed or deleted. Upload a new version instead.', 'immutable');
  return null;
end $$;
create trigger hr_document_versions_immutable before update or delete on public.hr_document_versions
  for each row execute function hr_private.document_versions_immutable();

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
-- Category-level visibility of a document (no uploader exception).
create or replace function hr_private.document_can_view(p_employee uuid, p_category uuid, p_archived timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select hr_private.has_permission('documents.view')
      or hr_private.has_permission('documents.manage')
      or (p_archived is null and exists (
            select 1 from public.hr_document_categories c
            where c.id = p_category and not c.is_confidential
              and ((p_employee = hr_private.current_employee_id() and c.employee_can_view)
                   or (hr_private.has_permission('documents.view_team') and hr_private.is_manager_of(p_employee)))))
$$;

-- Full read check for a document: category visibility, or the employee
-- reading a document of their own that they uploaded themselves.
create or replace function hr_private.document_can_read(p_document uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select hr_private.document_can_view(d.employee_id, d.category_id, d.archived_at)
        or (d.archived_at is null
            and d.employee_id = hr_private.current_employee_id()
            and exists (select 1 from public.hr_document_versions v where v.document_id = d.id and v.uploaded_by = auth.uid()))
    from public.hr_documents d where d.id = p_document), false)
$$;

create or replace function hr_private.document_sanitize_file_name(p_name text)
returns text language plpgsql immutable set search_path = '' as $$
declare v text; v_ext text; v_base text;
begin
  v := coalesce(p_name, '');
  v := regexp_replace(v, '^.*[/\\]', '');               -- basename only
  v := regexp_replace(v, '[^A-Za-z0-9._-]+', '_', 'g'); -- safe characters
  v := regexp_replace(v, '\.{2,}', '.', 'g');
  v := regexp_replace(v, '_{2,}', '_', 'g');
  v := regexp_replace(v, '^[._-]+', '');
  v_ext := lower(substring(v from '\.([A-Za-z0-9]{1,10})$'));
  v_base := case when v_ext is null then v else regexp_replace(v, '\.[A-Za-z0-9]{1,10}$', '') end;
  v_base := regexp_replace(left(v_base, 100), '[._-]+$', '');
  if v_base = '' then v_base := 'file'; end if;
  return v_base || coalesce('.' || v_ext, '');
end $$;

-- Validate an upload (type allow-list, extension must match type, size).
-- Returns the sanitized file name.
create or replace function hr_private.document_validate_file(p_file_name text, p_mime text, p_size bigint)
returns text language plpgsql stable set search_path = '' as $$
declare
  v_name text := hr_private.document_sanitize_file_name(p_file_name);
  v_ext  text := substring(v_name from '\.([a-z0-9]+)$');
  v_mime text := lower(btrim(coalesce(p_mime, '')));
begin
  if p_size is null or p_size <= 0 then
    perform hr_private.fail('The file is empty.', 'invalid_file');
  end if;
  if p_size > 10485760 then
    perform hr_private.fail('The file is larger than the 10 MB limit.', 'file_too_large');
  end if;
  if not (
       (v_mime = 'application/pdf' and v_ext = 'pdf')
    or (v_mime = 'image/png' and v_ext = 'png')
    or (v_mime = 'image/jpeg' and v_ext in ('jpg','jpeg'))
    or (v_mime = 'image/webp' and v_ext = 'webp')
    or (v_mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' and v_ext = 'docx')
    or (v_mime = 'application/msword' and v_ext = 'doc')
    or (v_mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' and v_ext = 'xlsx')) then
    perform hr_private.fail('Only PDF, PNG, JPEG, WEBP, DOC, DOCX and XLSX files are allowed, and the file extension must match the file type.', 'invalid_file_type');
  end if;
  return v_name;
end $$;

-- Storage: may the caller upload this exact hr-documents object?
create or replace function hr_private.document_object_can_upload(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
     and not hr_private.caller_is_revoked()
     and exists (
       select 1 from public.hr_document_versions v
       join public.hr_documents d on d.id = v.document_id
       where v.storage_path = p_name
         and v.uploaded_by = auth.uid()
         and d.archived_at is null
         and v.uploaded_at > now() - interval '24 hours')
     and not exists (select 1 from storage.objects o where o.bucket_id = 'hr-documents' and o.name = p_name)
$$;

-- Storage: may the caller read this hr-documents object?
create or replace function hr_private.document_object_readable(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.hr_document_versions v
    where v.storage_path = p_name and hr_private.document_can_read(v.document_id))
$$;

-- Avatars: employee id owning an avatar object name, or null if the name
-- does not follow <employee_id>/<file>.(png|jpg|jpeg|webp).
create or replace function hr_private.avatar_owner(p_name text)
returns uuid language sql immutable set search_path = '' as $$
  select case
    when p_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-][A-Za-z0-9._-]{0,119}\.(png|jpg|jpeg|webp)$'
    then split_part(p_name, '/', 1)::uuid end
$$;

create or replace function hr_private.avatar_can_write(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select hr_private.avatar_owner(p_name) is not null
     and (hr_private.avatar_owner(p_name) = hr_private.current_employee_id()
          or (hr_private.has_permission('employees.edit')
              and exists (select 1 from public.hr_employees e where e.id = hr_private.avatar_owner(p_name))))
$$;

create or replace function hr_private.avatar_can_read(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select hr_private.avatar_owner(p_name) is not null
     and (hr_private.can_access_employee(hr_private.avatar_owner(p_name), 'employees')
          or hr_private.avatar_owner(p_name) = hr_private.my_manager_id())
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
select hr_private.secure_table('public.hr_document_categories');
select hr_private.secure_table('public.hr_documents');
select hr_private.secure_table('public.hr_document_versions');
select hr_private.secure_table('public.hr_document_access_log');
select hr_private.secure_table('public.hr_document_expiry_reminders');

create policy hr_document_categories_read on public.hr_document_categories for select to authenticated
  using (hr_private.current_employee_id() is not null or hr_private.has_permission('documents.view')
         or hr_private.has_permission('documents.manage'));
create policy hr_document_categories_insert on public.hr_document_categories for insert to authenticated
  with check (hr_private.has_permission('documents.manage') or hr_private.has_permission('settings.manage'));
create policy hr_document_categories_update on public.hr_document_categories for update to authenticated
  using (hr_private.has_permission('documents.manage') or hr_private.has_permission('settings.manage'))
  with check (hr_private.has_permission('documents.manage') or hr_private.has_permission('settings.manage'));
-- No delete: categories are deactivated.

create policy hr_documents_read on public.hr_documents for select to authenticated
  using (hr_private.document_can_read(id));
-- Documents and versions are written only through the RPCs below.

create policy hr_document_versions_read on public.hr_document_versions for select to authenticated
  using (hr_private.document_can_read(document_id));

create policy hr_document_access_log_read on public.hr_document_access_log for select to authenticated
  using (hr_private.has_permission('documents.view') or hr_private.has_permission('documents.manage'));

create policy hr_document_expiry_reminders_read on public.hr_document_expiry_reminders for select to authenticated
  using (hr_private.has_permission('documents.manage'));

select hr_private.enable_audit('public.hr_document_categories');
select hr_private.enable_audit('public.hr_documents');
select hr_private.enable_audit('public.hr_document_versions');

-- ---------------------------------------------------------------------
-- Storage policies
-- ---------------------------------------------------------------------
drop policy if exists "hr-documents: registered upload" on storage.objects;
create policy "hr-documents: registered upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'hr-documents' and hr_private.document_object_can_upload(name));

drop policy if exists "hr-documents: permitted read" on storage.objects;
create policy "hr-documents: permitted read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'hr-documents' and hr_private.document_object_readable(name));
-- No UPDATE / DELETE policies for hr-documents: versions are immutable.

drop policy if exists "hr-avatars: own or HR upload" on storage.objects;
create policy "hr-avatars: own or HR upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'hr-avatars' and hr_private.avatar_can_write(name));

drop policy if exists "hr-avatars: own or HR replace" on storage.objects;
create policy "hr-avatars: own or HR replace"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'hr-avatars' and hr_private.avatar_can_write(name))
  with check (bucket_id = 'hr-avatars' and hr_private.avatar_can_write(name));

drop policy if exists "hr-avatars: own or HR delete" on storage.objects;
create policy "hr-avatars: own or HR delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'hr-avatars' and hr_private.avatar_can_write(name));

drop policy if exists "hr-avatars: read with employee access" on storage.objects;
create policy "hr-avatars: read with employee access"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'hr-avatars' and hr_private.avatar_can_read(name));

-- ---------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------
-- Register a new document (version 1). Returns the exact storage path the
-- client must upload to: { document_id, version_id, version, bucket, storage_path }.
create or replace function public.hr_register_document_upload(
  p_employee uuid, p_category text, p_title text, p_file_name text,
  p_mime_type text, p_size_bytes bigint, p_expiry_date date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me     uuid := hr_private.current_employee_id();
  v_is_hr  boolean := hr_private.has_permission('documents.manage');
  v_emp    public.hr_employees;
  v_cat    public.hr_document_categories;
  v_name   text;
  v_doc    uuid := gen_random_uuid();
  v_ver    uuid;
  v_path   text;
  v_title  text;
begin
  if auth.uid() is null or (v_me is null and not v_is_hr) then
    perform hr_private.fail('Sign in with an active employee account.', 'not_employee');
  end if;
  select * into v_emp from public.hr_employees where id = p_employee;
  if v_emp.id is null then perform hr_private.fail('Employee not found.', 'not_found'); end if;
  select * into v_cat from public.hr_document_categories where code = p_category and active;
  if v_cat.id is null then perform hr_private.fail('Unknown or inactive document category.', 'invalid_category'); end if;
  if not v_is_hr then
    if p_employee is distinct from v_me then
      perform hr_private.fail('You can only upload documents to your own profile.', 'forbidden');
    end if;
    if not v_cat.employee_can_upload or v_cat.is_confidential then
      perform hr_private.fail('Documents of this category are uploaded by HR.', 'forbidden');
    end if;
  end if;
  if v_emp.status = 'archived' then
    perform hr_private.fail('Documents cannot be added to an archived employee.', 'invalid_state');
  end if;
  if v_cat.applies_to_employment_types is not null and not (v_emp.employment_type = any (v_cat.applies_to_employment_types)) then
    perform hr_private.fail('This document category does not apply to the employee''s employment type.', 'invalid_category');
  end if;
  if v_cat.requires_expiry and p_expiry_date is null then
    perform hr_private.fail('This document needs an expiry date.', 'expiry_required');
  end if;
  if p_expiry_date is not null and p_expiry_date < hr_private.business_today() then
    perform hr_private.fail('The expiry date is already in the past.', 'invalid_expiry');
  end if;
  v_name := hr_private.document_validate_file(p_file_name, p_mime_type, p_size_bytes);
  v_title := coalesce(nullif(btrim(p_title), ''), v_cat.name);
  if length(v_title) > 200 then perform hr_private.fail('The title is too long (200 characters maximum).', 'invalid'); end if;
  v_path := p_employee::text || '/' || v_doc::text || '/1-' || v_name;

  insert into public.hr_documents (id, employee_id, category_id, title, current_version, expiry_date, verification_status, uploaded_by)
  values (v_doc, p_employee, v_cat.id, v_title, 1, p_expiry_date, 'pending', auth.uid());
  insert into public.hr_document_versions (document_id, version, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  values (v_doc, 1, v_path, v_name, lower(btrim(p_mime_type)), p_size_bytes, auth.uid())
  returning id into v_ver;

  if p_employee is distinct from v_me and v_cat.employee_can_view and not v_cat.is_confidential then
    perform hr_private.notify_employee(p_employee, 'document_added', 'A document was added to your profile',
      v_title, '/employee/documents', 'hr_document', v_doc::text);
  end if;
  return jsonb_build_object('document_id', v_doc, 'version_id', v_ver, 'version', 1,
                            'bucket', 'hr-documents', 'storage_path', v_path);
end $$;

-- Register a new version of an existing document. Resets verification.
create or replace function public.hr_new_document_version(
  p_document uuid, p_file_name text, p_mime_type text, p_size_bytes bigint, p_expiry_date date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me    uuid := hr_private.current_employee_id();
  v_is_hr boolean := hr_private.has_permission('documents.manage');
  v_doc   public.hr_documents;
  v_cat   public.hr_document_categories;
  v_name  text;
  v_next  int;
  v_ver   uuid;
  v_path  text;
  v_expiry date;
begin
  if auth.uid() is null or (v_me is null and not v_is_hr) then
    perform hr_private.fail('Sign in with an active employee account.', 'not_employee');
  end if;
  select * into v_doc from public.hr_documents where id = p_document for update;
  if v_doc.id is null or not hr_private.document_can_read(v_doc.id) then
    perform hr_private.fail('Document not found.', 'not_found');
  end if;
  if v_doc.archived_at is not null then perform hr_private.fail('This document is archived.', 'invalid_state'); end if;
  select * into v_cat from public.hr_document_categories where id = v_doc.category_id;
  if not v_is_hr and (v_doc.employee_id is distinct from v_me or not v_cat.employee_can_upload or v_cat.is_confidential) then
    perform hr_private.fail('You are not allowed to upload a new version of this document.', 'forbidden');
  end if;
  v_expiry := coalesce(p_expiry_date, v_doc.expiry_date);
  if v_cat.requires_expiry and v_expiry is null then
    perform hr_private.fail('This document needs an expiry date.', 'expiry_required');
  end if;
  if v_expiry is not null and v_expiry < hr_private.business_today() then
    perform hr_private.fail('The expiry date is already in the past.', 'invalid_expiry');
  end if;
  v_name := hr_private.document_validate_file(p_file_name, p_mime_type, p_size_bytes);
  v_next := v_doc.current_version + 1;
  v_path := v_doc.employee_id::text || '/' || v_doc.id::text || '/' || v_next::text || '-' || v_name;

  update public.hr_documents
     set current_version = v_next, expiry_date = v_expiry, verification_status = 'pending',
         verified_by = null, verified_at = null, rejection_reason = null
   where id = v_doc.id;
  insert into public.hr_document_versions (document_id, version, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  values (v_doc.id, v_next, v_path, v_name, lower(btrim(p_mime_type)), p_size_bytes, auth.uid())
  returning id into v_ver;
  return jsonb_build_object('document_id', v_doc.id, 'version_id', v_ver, 'version', v_next,
                            'bucket', 'hr-documents', 'storage_path', v_path);
end $$;

-- Record a view/download after the client created a signed URL.
-- Returns the storage path of the version.
create or replace function public.hr_log_document_access(p_version uuid, p_action text default 'view')
returns text language plpgsql security definer set search_path = '' as $$
declare v_ver public.hr_document_versions;
begin
  select * into v_ver from public.hr_document_versions where id = p_version;
  if v_ver.id is null or not hr_private.document_can_read(v_ver.document_id) then
    perform hr_private.fail('Document not found.', 'not_found');
  end if;
  if p_action is null or p_action not in ('view','download') then
    perform hr_private.fail('Unknown access action.', 'invalid');
  end if;
  insert into public.hr_document_access_log (document_id, version_id, accessed_by, action)
  values (v_ver.document_id, v_ver.id, auth.uid(), p_action);
  return v_ver.storage_path;
end $$;

create or replace function public.hr_verify_document(p_document uuid, p_approve boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_doc public.hr_documents; v_cat public.hr_document_categories; v_path text;
begin
  if not hr_private.has_permission('documents.manage') then
    perform hr_private.fail('You are not allowed to verify documents.', 'forbidden');
  end if;
  select * into v_doc from public.hr_documents where id = p_document for update;
  if v_doc.id is null then perform hr_private.fail('Document not found.', 'not_found'); end if;
  if v_doc.employee_id = hr_private.current_employee_id() then
    perform hr_private.fail('You cannot verify your own documents.', 'self_action');
  end if;
  if v_doc.archived_at is not null then perform hr_private.fail('This document is archived.', 'invalid_state'); end if;
  if p_approve is null then perform hr_private.fail('Choose verify or reject.', 'invalid'); end if;
  select storage_path into v_path from public.hr_document_versions where document_id = v_doc.id and version = v_doc.current_version;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'hr-documents' and o.name = v_path) then
    perform hr_private.fail('The file for the latest version has not been uploaded yet.', 'upload_missing');
  end if;
  if p_approve then
    if v_doc.expiry_date is not null and v_doc.expiry_date < hr_private.business_today() then
      perform hr_private.fail('This document has expired; ask for a new version.', 'expired');
    end if;
    update public.hr_documents set verification_status = 'verified', verified_by = auth.uid(), verified_at = now(),
           rejection_reason = null where id = v_doc.id;
  else
    if nullif(btrim(p_reason), '') is null then
      perform hr_private.fail('Give a reason when rejecting a document.', 'reason_required');
    end if;
    update public.hr_documents set verification_status = 'rejected', verified_by = auth.uid(), verified_at = now(),
           rejection_reason = btrim(p_reason) where id = v_doc.id;
  end if;
  select * into v_cat from public.hr_document_categories where id = v_doc.category_id;
  if v_cat.employee_can_view and not v_cat.is_confidential then
    perform hr_private.notify_employee(v_doc.employee_id, 'document_verification',
      case when p_approve then 'Document verified' else 'Document rejected' end,
      case when p_approve then v_doc.title else v_doc.title || ': ' || btrim(p_reason) end,
      '/employee/documents', 'hr_document', v_doc.id::text);
  end if;
end $$;

create or replace function public.hr_archive_document(p_document uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_doc public.hr_documents;
begin
  if not hr_private.has_permission('documents.manage') then
    perform hr_private.fail('You are not allowed to archive documents.', 'forbidden');
  end if;
  select * into v_doc from public.hr_documents where id = p_document for update;
  if v_doc.id is null then perform hr_private.fail('Document not found.', 'not_found'); end if;
  if v_doc.archived_at is null then
    update public.hr_documents set archived_at = now() where id = v_doc.id;
  end if;
end $$;

-- Documents expiring within p_days (and already expired), scoped to what the
-- caller may see.
create or replace function public.hr_expiring_documents(p_days int default 30)
returns table (document_id uuid, employee_id uuid, employee_code text, employee_name text,
               category_code text, category_name text, title text, expiry_date date,
               days_left int, verification_status text)
language sql stable security definer set search_path = '' as $$
  select d.id, d.employee_id, e.employee_code,
         coalesce(e.display_name, btrim(e.first_name || ' ' || e.last_name)),
         c.code, c.name, d.title, d.expiry_date,
         (d.expiry_date - hr_private.business_today())::int, d.verification_status
  from public.hr_documents d
  join public.hr_document_categories c on c.id = d.category_id
  join public.hr_employees e on e.id = d.employee_id
  where d.archived_at is null
    and d.expiry_date is not null
    and d.expiry_date <= hr_private.business_today() + greatest(coalesce(p_days, 30), 0)
    and hr_private.document_can_view(d.employee_id, d.category_id, d.archived_at)
  order by d.expiry_date, e.employee_code
$$;

-- Daily job (service role via scheduler) or manual run by HR. Marks expired
-- documents and sends one reminder per document + expiry date. Returns the
-- number of reminders created.
create or replace function public.hr_generate_document_expiry_reminders(p_days int default 30)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; v_n int := 0; v_today date := hr_private.business_today();
begin
  if not (coalesce(auth.role(), '') = 'service_role' or hr_private.has_permission('documents.manage')) then
    perform hr_private.fail('You are not allowed to run document reminders.', 'forbidden');
  end if;
  update public.hr_documents set verification_status = 'expired'
   where archived_at is null and expiry_date < v_today and verification_status in ('pending','verified');

  for r in
    select d.id, d.employee_id, d.title, d.expiry_date, c.employee_can_view, c.is_confidential, e.company_email
    from public.hr_documents d
    join public.hr_document_categories c on c.id = d.category_id
    join public.hr_employees e on e.id = d.employee_id
    where d.archived_at is null and d.expiry_date is not null
      and d.expiry_date <= v_today + greatest(coalesce(p_days, 30), 0)
      and e.status not in ('exited','archived')
      and not exists (select 1 from public.hr_document_expiry_reminders x where x.document_id = d.id and x.expiry_date = d.expiry_date)
    for update of d
  loop
    insert into public.hr_document_expiry_reminders (document_id, expiry_date) values (r.id, r.expiry_date);
    if r.employee_can_view and not r.is_confidential then
      perform hr_private.notify_employee(r.employee_id, 'document_expiry',
        case when r.expiry_date < v_today then 'Document expired' else 'Document expiring soon' end,
        r.title || ' expires on ' || to_char(r.expiry_date, 'DD Mon YYYY') || '. Please upload a renewed copy.',
        '/employee/documents', 'hr_document', r.id::text);
      if r.company_email is not null then
        perform hr_private.queue_email(r.company_email::text,
          'Document expiry reminder: ' || r.title,
          'Your document "' || r.title || '" expires on ' || to_char(r.expiry_date, 'DD Mon YYYY')
            || '. Please upload a renewed copy in the Employee Portal.',
          'document_expiry', 'hr_document', r.id::text);
      end if;
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Required-document checklist for an employee.
create or replace function public.hr_document_checklist(p_employee uuid)
returns table (category_code text, category_name text, requires_expiry boolean, employee_can_upload boolean,
               is_complete boolean, document_id uuid, verification_status text, expiry_date date)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_today date := hr_private.business_today();
        v_all boolean := hr_private.has_permission('documents.view') or hr_private.has_permission('documents.manage');
begin
  if not (hr_private.can_access_employee(p_employee, 'documents') or v_all) then
    perform hr_private.fail('Employee not found.', 'not_found');
  end if;
  return query
  select c.code, c.name, c.requires_expiry, c.employee_can_upload,
         coalesce(best.verification_status = 'verified' and (best.expiry_date is null or best.expiry_date >= v_today), false),
         best.id, best.verification_status, best.expiry_date
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

-- Avatars: set (or clear with null) the caller's own photo path.
create or replace function public.hr_set_my_photo(p_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid := hr_private.current_employee_id();
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  if p_path is not null then
    if hr_private.avatar_owner(p_path) is distinct from v_me then
      perform hr_private.fail('Choose a photo uploaded to your own profile folder.', 'invalid_path');
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'hr-avatars' and o.name = p_path) then
      perform hr_private.fail('Upload the photo first.', 'upload_missing');
    end if;
  end if;
  update public.hr_employees set photo_path = p_path where id = v_me;
end $$;

create or replace function public.hr_set_employee_photo(p_employee uuid, p_path text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not hr_private.has_permission('employees.edit') then
    perform hr_private.fail('You are not allowed to edit employees.', 'forbidden');
  end if;
  if not exists (select 1 from public.hr_employees where id = p_employee) then
    perform hr_private.fail('Employee not found.', 'not_found');
  end if;
  if p_path is not null then
    if hr_private.avatar_owner(p_path) is distinct from p_employee then
      perform hr_private.fail('The photo must be stored in this employee''s folder.', 'invalid_path');
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'hr-avatars' and o.name = p_path) then
      perform hr_private.fail('Upload the photo first.', 'upload_missing');
    end if;
  end if;
  update public.hr_employees set photo_path = p_path where id = p_employee;
end $$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke execute on function
  hr_private.document_can_view(uuid, uuid, timestamptz), hr_private.document_can_read(uuid),
  hr_private.document_sanitize_file_name(text), hr_private.document_validate_file(text, text, bigint),
  hr_private.document_object_can_upload(text), hr_private.document_object_readable(text),
  hr_private.avatar_owner(text), hr_private.avatar_can_write(text), hr_private.avatar_can_read(text),
  hr_private.document_versions_immutable()
from anon, public;
grant execute on function
  hr_private.document_can_view(uuid, uuid, timestamptz), hr_private.document_can_read(uuid),
  hr_private.document_sanitize_file_name(text), hr_private.document_validate_file(text, text, bigint),
  hr_private.document_object_can_upload(text), hr_private.document_object_readable(text),
  hr_private.avatar_owner(text), hr_private.avatar_can_write(text), hr_private.avatar_can_read(text)
to authenticated, service_role;

revoke execute on function
  public.hr_register_document_upload(uuid, text, text, text, text, bigint, date),
  public.hr_new_document_version(uuid, text, text, bigint, date),
  public.hr_log_document_access(uuid, text),
  public.hr_verify_document(uuid, boolean, text),
  public.hr_archive_document(uuid),
  public.hr_expiring_documents(int),
  public.hr_generate_document_expiry_reminders(int),
  public.hr_document_checklist(uuid),
  public.hr_set_my_photo(text),
  public.hr_set_employee_photo(uuid, text)
from anon, public;
grant execute on function
  public.hr_register_document_upload(uuid, text, text, text, text, bigint, date),
  public.hr_new_document_version(uuid, text, text, bigint, date),
  public.hr_log_document_access(uuid, text),
  public.hr_verify_document(uuid, boolean, text),
  public.hr_archive_document(uuid),
  public.hr_expiring_documents(int),
  public.hr_generate_document_expiry_reminders(int),
  public.hr_document_checklist(uuid),
  public.hr_set_my_photo(text),
  public.hr_set_employee_photo(uuid, text)
to authenticated;
grant execute on function public.hr_generate_document_expiry_reminders(int) to service_role;
