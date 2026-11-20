-- =====================================================================
-- 222_project_tracker_project_fields.sql — Project Tracker round 3
-- =====================================================================
-- Brings pt_projects in line with the Zyllo Tech project sheet columns:
--   Project ID (auto ZT-001, ZT-002 …), Type, Status (+ "live"),
--   Progress %, Project Manager, Priority, Health, Live URL,
--   Repo / Source, Next Action, Notes.  (Start Date / Target Date =
--   existing start_date / end_date.)
--
-- Access unchanged: public.is_admin() only (policies from 221).
-- Depends on 221. Idempotent (safe to re-run).
-- Rollback: supabase/rollbacks/222_rollback_project_tracker_project_fields.sql
-- =====================================================================

create sequence if not exists public.pt_project_code_seq;
grant usage on sequence public.pt_project_code_seq to authenticated;

alter table public.pt_projects
  add column if not exists project_code text
    default ('ZT-' || lpad(nextval('public.pt_project_code_seq')::text, 3, '0'));
-- Existing rows (if any) receive a code through the default above.
alter table public.pt_projects alter column project_code set not null;
create unique index if not exists pt_projects_code_key on public.pt_projects (project_code);

alter table public.pt_projects add column if not exists project_type    text;
alter table public.pt_projects add column if not exists progress        integer not null default 0;
alter table public.pt_projects add column if not exists project_manager text;
alter table public.pt_projects add column if not exists priority        text not null default 'medium';
alter table public.pt_projects add column if not exists health          text;
alter table public.pt_projects add column if not exists live_url        text;
alter table public.pt_projects add column if not exists repo_source     text;
alter table public.pt_projects add column if not exists next_action     text;
alter table public.pt_projects add column if not exists notes           text;

-- Constraints (drop + add so a re-run picks up changes).
alter table public.pt_projects drop constraint if exists pt_projects_status_check;
alter table public.pt_projects add constraint pt_projects_status_check
  check (status in ('planning', 'in_progress', 'live', 'on_hold', 'completed', 'cancelled'));

alter table public.pt_projects drop constraint if exists pt_projects_fields_check;
alter table public.pt_projects add constraint pt_projects_fields_check check (
      progress between 0 and 100
  and priority in ('low', 'medium', 'high')
  and (health is null or health in ('on_track', 'at_risk', 'off_track'))
  and (project_type is null or length(project_type) <= 80)
  and (project_manager is null or length(project_manager) <= 120)
  and (live_url is null or (length(live_url) <= 500 and live_url ~* '^https?://[^\s]+$'))
  and (repo_source is null or length(repo_source) <= 500)
  and (next_action is null or length(next_action) <= 500)
  and (notes is null or length(notes) <= 2000)
);

create index if not exists pt_projects_status_idx on public.pt_projects (status);
