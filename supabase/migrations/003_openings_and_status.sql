-- Adds total headcount per job posting, and a selection status per
-- applicant, so remaining slots and auto-close can be derived instead of
-- manually tracked. Run in Supabase Dashboard > SQL Editor > New query.

alter table job_postings
  add column if not exists total_openings integer not null default 1;

alter table job_applications
  add column if not exists status text not null default 'applied'
    check (status in ('applied', 'selected', 'rejected'));

-- Recompute a job's status from its own row: open if filled < openings,
-- closed once filled >= openings. Called by the trigger below whenever
-- an application's status changes, and can also be called manually.
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
  where job_id = p_job_id and status = 'selected';

  update job_postings
  set status = case
    when v_selected_count >= v_total_openings then 'closed'
    else 'open'
  end
  where id = p_job_id;
end;
$$ language plpgsql;

create or replace function job_applications_status_trigger()
returns trigger as $$
begin
  if (TG_OP = 'DELETE') then
    perform recompute_job_status(OLD.job_id);
    return OLD;
  else
    perform recompute_job_status(NEW.job_id);
    return NEW;
  end if;
end;
$$ language plpgsql;

drop trigger if exists job_applications_status_change on job_applications;
create trigger job_applications_status_change
  after insert or update of status or delete on job_applications
  for each row
  execute function job_applications_status_trigger();

-- Recompute on total_openings edits too, in case an admin raises/lowers
-- the headcount after some applicants are already selected.
create or replace function job_postings_openings_trigger()
returns trigger as $$
begin
  perform recompute_job_status(NEW.id);
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists job_postings_openings_change on job_postings;
create trigger job_postings_openings_change
  after update of total_openings on job_postings
  for each row
  execute function job_postings_openings_trigger();
