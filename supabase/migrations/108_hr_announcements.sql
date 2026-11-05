-- =====================================================================
-- 108_hr_announcements.sql — Announcements, audience targeting,
-- read/acknowledgement receipts, notification + email fan-out.
-- =====================================================================
-- Builds on 100_hr_foundation.sql.
--
-- Lifecycle: draft -> (scheduled) -> published -> archived.
--   * Drafts/scheduled items are edited directly (announcements.manage).
--   * Publishing, scheduling and archiving go through RPCs.
--   * Published content is immutable: archive it and publish a new one.
-- Fan-out happens exactly once per announcement (fanout_at), so publishing
-- twice or racing the scheduler never duplicates notifications or emails.
-- Emails are only QUEUED in hr_email_outbox; delivery state lives there.
-- =====================================================================

create table public.hr_announcements (
  id                       uuid primary key default gen_random_uuid(),
  title                    text not null check (length(btrim(title)) between 2 and 200),
  body                     text not null check (length(body) between 1 and 20000),
  category                 text not null default 'general' check (category in ('general','policy','holiday','event','urgent')),
  audience_type            text not null default 'all' check (audience_type in ('all','departments','locations','employment_types','employees')),
  audience_ids             uuid[] not null default '{}',   -- department / location / employee ids
  audience_codes           text[] not null default '{}',   -- employment type codes
  status                   text not null default 'draft' check (status in ('draft','scheduled','published','archived')),
  publish_at               timestamptz,
  published_at             timestamptz,
  expires_at               timestamptz,
  archived_at              timestamptz,
  requires_acknowledgement boolean not null default false,
  send_email               boolean not null default false,
  fanout_at                timestamptz,                    -- set once notifications/emails were generated
  notified_count           integer,
  emails_queued            integer,
  created_by               uuid,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  check (status <> 'scheduled' or publish_at is not null),
  check (expires_at is null or publish_at is null or expires_at > publish_at)
);
create index hr_announcements_status on public.hr_announcements(status, publish_at);

create table public.hr_announcement_receipts (
  announcement_id uuid not null references public.hr_announcements(id) on delete cascade,
  employee_id     uuid not null references public.hr_employees(id) on delete cascade,
  read_at         timestamptz,
  acknowledged_at timestamptz,
  primary key (announcement_id, employee_id)
);
create index hr_announcement_receipts_emp on public.hr_announcement_receipts(employee_id);

-- ---------------------------------------------------------------------
-- Audience helpers
-- ---------------------------------------------------------------------
-- Current (not exited/archived/suspended) employees in the audience.
create or replace function hr_private.announcement_targets(p_announcement uuid)
returns table (employee_id uuid) language sql stable security definer set search_path = '' as $$
  select e.id
  from public.hr_announcements a
  join public.hr_employees e on e.status not in ('exited','archived','suspended')
  where a.id = p_announcement
    and case a.audience_type
          when 'all'              then true
          when 'departments'      then e.department_id = any (a.audience_ids)
          when 'locations'        then e.work_location_id = any (a.audience_ids)
          when 'employment_types' then e.employment_type = any (a.audience_codes)
          when 'employees'        then e.id = any (a.audience_ids)
          else false end
$$;

create or replace function hr_private.announcement_includes_employee(p_announcement uuid, p_employee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_employee is not null and exists (select 1 from hr_private.announcement_targets(p_announcement) t where t.employee_id = p_employee)
$$;

-- Live (published, started, not expired) and addressed to the caller.
create or replace function hr_private.announcement_visible_to_me(p_announcement uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select hr_private.current_employee_id() is not null
     and exists (select 1 from public.hr_announcements a
                 where a.id = p_announcement and a.status = 'published'
                   and coalesce(a.publish_at, a.published_at) <= now()
                   and (a.expires_at is null or a.expires_at > now()))
     and hr_private.announcement_includes_employee(p_announcement, hr_private.current_employee_id())
$$;

create or replace function hr_private.can_manage_announcements()
returns boolean language sql stable security definer set search_path = '' as $$
  select hr_private.has_permission('announcements.manage')
$$;

-- ---------------------------------------------------------------------
-- Guard trigger: direct writes may only create/edit drafts and scheduled
-- items (and unschedule back to draft). Published/archived are immutable.
-- RPCs set hr.announcement_rpc; system (no JWT) writes are trusted.
-- ---------------------------------------------------------------------
create or replace function hr_private.announcements_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_rpc boolean := current_setting('hr.announcement_rpc', true) is not distinct from 'on' or auth.uid() is null;
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    if not v_rpc then
      if new.status <> 'draft' then
        perform hr_private.fail('New announcements start as drafts; use Publish to schedule or publish them.', 'use_publish');
      end if;
      new.published_at := null; new.archived_at := null; new.fanout_at := null;
      new.notified_count := null; new.emails_queued := null;
    end if;
    return new;
  end if;

  if not v_rpc then
    if old.status in ('published','archived') then
      perform hr_private.fail('Published announcements cannot be edited. Archive it and publish a new one.', 'immutable_published');
    end if;
    if new.status is distinct from old.status and new.status <> 'draft' then
      perform hr_private.fail('Use Publish or Archive to change the announcement status.', 'use_publish');
    end if;
    if (new.published_at, new.archived_at, new.fanout_at, new.notified_count, new.emails_queued, new.created_by)
       is distinct from (old.published_at, old.archived_at, old.fanout_at, old.notified_count, old.emails_queued, old.created_by) then
      perform hr_private.fail('Publication fields are maintained by the system.', 'forbidden');
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger hr_announcements_guard before insert or update on public.hr_announcements
  for each row execute function hr_private.announcements_guard();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
select hr_private.secure_table('public.hr_announcements');
create policy hr_announcements_read on public.hr_announcements for select to authenticated using (
     hr_private.can_manage_announcements()
  or hr_private.has_permission('announcements.view_all')
  or hr_private.announcement_visible_to_me(id));
create policy hr_announcements_insert on public.hr_announcements for insert to authenticated with check (hr_private.can_manage_announcements());
create policy hr_announcements_update on public.hr_announcements for update to authenticated
  using (hr_private.can_manage_announcements()) with check (hr_private.can_manage_announcements());
create policy hr_announcements_delete on public.hr_announcements for delete to authenticated
  using (hr_private.can_manage_announcements() and status = 'draft');

select hr_private.secure_table('public.hr_announcement_receipts');
create policy hr_announcement_receipts_read on public.hr_announcement_receipts for select to authenticated using (
     employee_id = hr_private.current_employee_id()
  or hr_private.can_manage_announcements()
  or hr_private.has_permission('announcements.view_all'));
revoke insert, update, delete on public.hr_announcement_receipts from authenticated;

select hr_private.enable_audit('public.hr_announcements');

-- ---------------------------------------------------------------------
-- Publishing core (internal). Caller must hold the row lock.
-- ---------------------------------------------------------------------
create or replace function hr_private.announcement_publish_now(p_announcement uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.hr_announcements;
  t record;
  v_notified int := 0;
  v_emails int := 0;
  v_company text := coalesce(hr_private.setting('company') ->> 'name', 'Zyllo Tech');
begin
  select * into a from public.hr_announcements where id = p_announcement;
  perform set_config('hr.announcement_rpc', 'on', true);
  update public.hr_announcements
     set status = 'published', published_at = coalesce(published_at, now()), publish_at = coalesce(publish_at, now())
   where id = p_announcement;

  if a.fanout_at is null then
    for t in
      select e.id, e.user_id, e.portal_access, e.company_email
      from hr_private.announcement_targets(p_announcement) x join public.hr_employees e on e.id = x.employee_id
    loop
      if t.user_id is not null and t.portal_access then
        perform hr_private.notify_user(t.user_id, 'announcement',
          case when a.category = 'urgent' then 'Urgent: ' else '' end || a.title,
          left(a.body, 280), '/employee/announcements?id=' || p_announcement, 'hr_announcements', p_announcement::text);
        v_notified := v_notified + 1;
      end if;
      if a.send_email and t.company_email is not null then
        perform hr_private.queue_email(t.company_email::text, left('[' || v_company || '] ' || a.title, 250),
          a.body || E'\n\n' || case when a.requires_acknowledgement then 'Please sign in to the employee portal to acknowledge this announcement.'
                                    else 'You can also read this announcement in the employee portal.' end,
          'announcement', 'hr_announcements', p_announcement::text);
        v_emails := v_emails + 1;
      end if;
    end loop;
    update public.hr_announcements set fanout_at = now(), notified_count = v_notified, emails_queued = v_emails where id = p_announcement;
    perform hr_private.audit_event('ANNOUNCEMENT_PUBLISHED', 'hr_announcements', p_announcement::text,
      jsonb_build_object('notified', v_notified, 'emails_queued', v_emails));
  end if;
  perform set_config('hr.announcement_rpc', 'off', true);
  return jsonb_build_object('id', p_announcement, 'status', 'published', 'notified', v_notified, 'emails_queued', v_emails);
end $$;

-- ---------------------------------------------------------------------
-- Public RPCs
-- ---------------------------------------------------------------------
-- Publish now, or schedule when publish_at is in the future. Idempotent.
-- Returns {id, status, notified, emails_queued[, already_published]}.
create or replace function public.hr_publish_announcement(p_announcement uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.hr_announcements;
begin
  if not hr_private.can_manage_announcements() then
    perform hr_private.fail('You are not allowed to publish announcements.', 'forbidden');
  end if;
  select * into a from public.hr_announcements where id = p_announcement for update;
  if a.id is null then perform hr_private.fail('Announcement not found.', 'not_found'); end if;
  if a.status = 'archived' then perform hr_private.fail('An archived announcement cannot be published again. Create a new one.', 'invalid_state'); end if;
  if a.status = 'published' then
    return jsonb_build_object('id', a.id, 'status', 'published', 'notified', 0, 'emails_queued', 0, 'already_published', true);
  end if;
  if a.audience_type in ('departments','locations','employees') and cardinality(a.audience_ids) = 0
     or a.audience_type = 'employment_types' and cardinality(a.audience_codes) = 0 then
    perform hr_private.fail('Choose who should receive this announcement.', 'audience_required');
  end if;
  if a.expires_at is not null and a.expires_at <= greatest(now(), coalesce(a.publish_at, now())) then
    perform hr_private.fail('The expiry time must be after the publish time.', 'invalid');
  end if;
  if a.publish_at is not null and a.publish_at > now() then
    perform set_config('hr.announcement_rpc', 'on', true);
    update public.hr_announcements set status = 'scheduled' where id = p_announcement;
    perform set_config('hr.announcement_rpc', 'off', true);
    return jsonb_build_object('id', a.id, 'status', 'scheduled', 'publish_at', a.publish_at, 'notified', 0, 'emails_queued', 0);
  end if;
  return hr_private.announcement_publish_now(p_announcement);
end $$;

-- Publish every scheduled announcement whose time has come. For pg_cron or
-- an Edge Function (service role); announcements.manage may also run it.
create or replace function public.hr_process_scheduled_announcements()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; res jsonb; v_pub int := 0; v_notified int := 0; v_emails int := 0;
begin
  -- service role (Edge Function), a direct DB session with no JWT (pg_cron), or an HR manager.
  if not (coalesce(auth.role(), '') = 'service_role'
          or nullif(current_setting('request.jwt.claims', true), '') is null
          or hr_private.can_manage_announcements()) then
    perform hr_private.fail('You are not allowed to process scheduled announcements.', 'forbidden');
  end if;
  for r in select id from public.hr_announcements
           where status = 'scheduled' and publish_at <= now()
           order by publish_at for update skip locked
  loop
    res := hr_private.announcement_publish_now(r.id);
    v_pub := v_pub + 1;
    v_notified := v_notified + (res ->> 'notified')::int;
    v_emails := v_emails + (res ->> 'emails_queued')::int;
  end loop;
  return jsonb_build_object('published', v_pub, 'notified', v_notified, 'emails_queued', v_emails);
end $$;

create or replace function public.hr_archive_announcement(p_announcement uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.hr_announcements;
begin
  if not hr_private.can_manage_announcements() then
    perform hr_private.fail('You are not allowed to archive announcements.', 'forbidden');
  end if;
  select * into a from public.hr_announcements where id = p_announcement for update;
  if a.id is null then perform hr_private.fail('Announcement not found.', 'not_found'); end if;
  if a.status = 'archived' then return; end if;
  perform set_config('hr.announcement_rpc', 'on', true);
  update public.hr_announcements set status = 'archived', archived_at = now() where id = p_announcement;
  perform set_config('hr.announcement_rpc', 'off', true);
end $$;

create or replace function public.hr_mark_announcement_read(p_announcement uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid := hr_private.current_employee_id();
begin
  if v_me is null or not hr_private.announcement_visible_to_me(p_announcement) then
    perform hr_private.fail('Announcement not found.', 'not_found');
  end if;
  insert into public.hr_announcement_receipts (announcement_id, employee_id, read_at) values (p_announcement, v_me, now())
  on conflict (announcement_id, employee_id) do update
    set read_at = coalesce(public.hr_announcement_receipts.read_at, excluded.read_at);
  update public.hr_notifications set read_at = now()
   where recipient_user_id = auth.uid() and entity_type = 'hr_announcements' and entity_id = p_announcement::text and read_at is null;
end $$;

create or replace function public.hr_acknowledge_announcement(p_announcement uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_me uuid := hr_private.current_employee_id(); v_at timestamptz;
begin
  if v_me is null or not hr_private.announcement_visible_to_me(p_announcement) then
    perform hr_private.fail('Announcement not found.', 'not_found');
  end if;
  if not (select requires_acknowledgement from public.hr_announcements where id = p_announcement) then
    perform hr_private.fail('This announcement does not require acknowledgement.', 'not_required');
  end if;
  insert into public.hr_announcement_receipts (announcement_id, employee_id, read_at, acknowledged_at)
  values (p_announcement, v_me, now(), now())
  on conflict (announcement_id, employee_id) do update
    set read_at = coalesce(public.hr_announcement_receipts.read_at, excluded.read_at),
        acknowledged_at = coalesce(public.hr_announcement_receipts.acknowledged_at, excluded.acknowledged_at)
  returning acknowledged_at into v_at;
  update public.hr_notifications set read_at = now()
   where recipient_user_id = auth.uid() and entity_type = 'hr_announcements' and entity_id = p_announcement::text and read_at is null;
  return v_at;
end $$;

-- Audience size (current), read/acknowledged counts and email delivery state.
create or replace function public.hr_announcement_stats(p_announcement uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a public.hr_announcements;
begin
  if not hr_private.can_manage_announcements() then
    perform hr_private.fail('You are not allowed to view announcement statistics.', 'forbidden');
  end if;
  select * into a from public.hr_announcements where id = p_announcement;
  if a.id is null then perform hr_private.fail('Announcement not found.', 'not_found'); end if;
  return jsonb_build_object(
    'id', a.id, 'status', a.status,
    'audience', (select count(*) from hr_private.announcement_targets(p_announcement)),
    'read', (select count(*) from public.hr_announcement_receipts where announcement_id = p_announcement and read_at is not null),
    'acknowledged', (select count(*) from public.hr_announcement_receipts where announcement_id = p_announcement and acknowledged_at is not null),
    'requires_acknowledgement', a.requires_acknowledgement,
    'notified', coalesce(a.notified_count, 0),
    'emails_queued', coalesce(a.emails_queued, 0),
    'emails_sent', (select count(*) from public.hr_email_outbox o where o.entity_type = 'hr_announcements' and o.entity_id = p_announcement::text and o.status = 'sent'),
    'emails_failed', (select count(*) from public.hr_email_outbox o where o.entity_type = 'hr_announcements' and o.entity_id = p_announcement::text and o.status = 'failed'));
end $$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke execute on all functions in schema hr_private from anon, public;
grant execute on all functions in schema hr_private to authenticated, service_role;

do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = any (array[
             'hr_publish_announcement','hr_process_scheduled_announcements','hr_archive_announcement',
             'hr_mark_announcement_read','hr_acknowledge_announcement','hr_announcement_stats'])
  loop
    execute format('revoke execute on function %s from anon, public', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
grant execute on function public.hr_process_scheduled_announcements() to service_role;
