-- Expands the applicant status pipeline from 3 stages (applied/selected/
-- rejected) to 7 (new/reviewed/shortlisted/interview/offer/hired/rejected),
-- to match the admin's global Job Applications table. Also adds two
-- admin-only fields: experience_years and prospect_rating (1-5 stars).
-- Run in Supabase Dashboard > SQL Editor > New query.
--
-- Wrapped in an explicit transaction so this either fully applies or
-- fully rolls back — no risk of leaving the table half-migrated.
--
-- Ordering matters here: the old and new status vocabularies are
-- disjoint except for 'rejected' ('applied'/'selected' don't exist in
-- the new set, 'new'/'hired' don't exist in the old set). So the
-- constraint must be fully DROPPED (not replaced) before the data is
-- remapped, and only re-added once every row already holds a new-style
-- value. Doing it any other order makes either the remap or the
-- constraint-add fail against whichever rows haven't been touched yet.

begin;

-- 1. Drop the old constraint entirely — no replacement yet. Between here
--    and step 3, the column temporarily has no check constraint at all.
alter table job_applications drop constraint if exists job_applications_status_check;

-- 2. Migrate existing rows to the new vocabulary while nothing is
--    constraining the column. Old 'applied' -> 'new' (still unreviewed).
--    Old 'selected' -> 'hired' (the pipeline's new terminal "got the
--    job" status). Idempotent — safe to re-run.
update job_applications set status = 'new' where status = 'applied';
update job_applications set status = 'hired' where status = 'selected';

-- 3. Every row now holds a value from the new set, so it's safe to add
--    the new constraint.
alter table job_applications
  add constraint job_applications_status_check
  check (status in ('new', 'reviewed', 'shortlisted', 'interview', 'offer', 'hired', 'rejected'));

alter table job_applications alter column status set default 'new';

-- 4. New admin-only fields, both nullable — set by HR after reviewing an
--    applicant, never collected on the public apply form.
alter table job_applications
  add column if not exists experience_years integer;

alter table job_applications
  add column if not exists prospect_rating integer check (prospect_rating between 1 and 5);

-- 5. The auto-close trigger previously counted 'selected' applicants
--    against total_openings. It now counts 'hired' instead — same
--    behavior, new terminal-status name. Trigger definitions themselves
--    (job_applications_status_change, job_postings_openings_change) are
--    unchanged; only this function body needs updating.
create or replace function recompute_job_status(p_job_id uuid)
returns void as $$
declare
  v_total_openings integer;
  v_selected_count integer;
begin
  select total_openings into v_total_openings
  from job_postings where id = p_job_id;

  select count(*) into v_selected_count
  from job_applications
  where job_id = p_job_id and status = 'hired';

  update job_postings
  set status = case
    when v_selected_count >= v_total_openings then 'closed'
    else 'open'
  end
  where id = p_job_id;
end;
$$ language plpgsql;

-- 6. Step 2's UPDATEs fired the status-change trigger while the OLD
--    function definition (checking for 'selected') was still active, so
--    any job's open/closed flag could be left stale. Force every job
--    posting to recompute now, under the new 'hired'-based function.
do $$
declare
  job record;
begin
  for job in select id from job_postings loop
    perform recompute_job_status(job.id);
  end loop;
end $$;

commit;
