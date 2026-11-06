-- =====================================================================
-- 161_hr_leave_cancellation_requests.sql — Leave cancellation requests
-- =====================================================================
-- Builds on 103 + 160. Until now an employee could cancel their own pending
-- request, or approved leave that had not started; approved leave that had
-- already started (or was in the past) could only be cancelled by HR, and
-- the employee had no way to ask. This adds a cancellation REQUEST:
--
--   * Employee: hr_request_leave_cancellation(id, reason) on their own
--     APPROVED leave that has started (start_date <= business today). Leave
--     that has not started is still cancelled directly (hr_cancel_leave).
--     hr_withdraw_leave_cancellation(id) takes the request back.
--   * HR (leave.approve or leave.manage, never for their own leave):
--     hr_decide_leave_cancellation(id, approve, note). Approve = the existing
--     hr_cancel_leave path (status -> cancelled, used days restored, ledger
--     linked, employee notified). Reject = leave stays approved, employee
--     notified with the reason.
--
-- State lives on the request (cancellation_status: null | pending |
-- rejected) so one request has at most one open cancellation; every step is
-- an hr_leave_request_events row. The leave itself (dates, type, days) is
-- never changed by this migration: the 160 guard still applies.
--
-- Apply ONLY to the local test cluster or the isolated dev project.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Columns + event actions
-- ---------------------------------------------------------------------
alter table public.hr_leave_requests
  add column if not exists cancellation_status text check (cancellation_status in ('pending','rejected')),
  add column if not exists cancellation_reason text check (length(cancellation_reason) <= 2000),
  add column if not exists cancellation_requested_at timestamptz,
  add column if not exists cancellation_decided_at timestamptz,
  add column if not exists cancellation_decision_note text check (length(cancellation_decision_note) <= 2000);

create index if not exists hr_leave_requests_cancellation_pending
  on public.hr_leave_requests (cancellation_requested_at) where cancellation_status = 'pending';

alter table public.hr_leave_request_events drop constraint if exists hr_leave_request_events_action_check;
alter table public.hr_leave_request_events add constraint hr_leave_request_events_action_check
  check (action in ('applied','manager_approved','approved','rejected','clarification_requested','clarification_response',
                    'cancelled','holiday_changed','recalculated',
                    'cancellation_requested','cancellation_withdrawn','cancellation_rejected'));

-- ---------------------------------------------------------------------
-- 2. Employee: request / withdraw
-- ---------------------------------------------------------------------
create or replace function public.hr_request_leave_cancellation(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.hr_leave_requests;
  v_me uuid := hr_private.current_employee_id();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_me is null then perform hr_private.fail('Sign in with an active employee account.', 'not_employee'); end if;
  select * into r from public.hr_leave_requests where id = p_id;
  if r.id is null or r.employee_id is distinct from v_me then
    perform hr_private.fail('Leave request not found.', 'not_found');
  end if;
  perform pg_advisory_xact_lock(hashtext('hr_leave:' || r.employee_id::text));
  select * into r from public.hr_leave_requests where id = p_id for update;
  if r.status = 'pending_approval' then
    perform hr_private.fail('This request is still pending; cancel it directly.', 'cancel_directly');
  end if;
  if r.status <> 'approved' then
    perform hr_private.fail('This leave request is already ' || replace(r.status, '_', ' ') || '.', 'invalid_state');
  end if;
  if r.start_date > hr_private.business_today() then
    perform hr_private.fail('This leave has not started yet; cancel it directly.', 'cancel_directly');
  end if;
  if r.cancellation_status = 'pending' then
    perform hr_private.fail('A cancellation request for this leave is already waiting for HR.', 'already_requested');
  end if;
  if hr_private.leave_year_closed(r.year) then
    perform hr_private.fail('Leave year ' || r.year || ' is closed.', 'year_closed');
  end if;
  if v_reason is null or length(v_reason) < 3 then
    perform hr_private.fail('Give a reason for the cancellation (at least 3 characters).', 'reason_required');
  end if;
  if length(v_reason) > 2000 then perform hr_private.fail('Reason is too long (2000 characters max).', 'too_long'); end if;

  update public.hr_leave_requests
     set cancellation_status = 'pending', cancellation_reason = v_reason, cancellation_requested_at = now(),
         cancellation_decided_at = null, cancellation_decision_note = null
   where id = p_id returning * into r;
  perform hr_private.leave_event(p_id, 'cancellation_requested', r.status, r.status, 'hr', v_reason);
  perform hr_private.notify_permission_holders('leave.approve', 'leave.cancellation_requested', 'Leave cancellation requested',
    'An employee asked to cancel approved leave from ' || to_char(r.start_date, 'DD Mon YYYY') || ': ' || left(v_reason, 200),
    '/hr/leave?tab=approvals', 'hr_leave_requests', p_id::text, r.employee_id);
  perform hr_private.notify_employee(hr_private.my_manager_id(), 'leave.cancellation_requested', 'Leave cancellation requested',
    'A team member asked HR to cancel approved leave from ' || to_char(r.start_date, 'DD Mon YYYY') || '.',
    '/hr/leave', 'hr_leave_requests', p_id::text);
  return to_jsonb(r);
end $$;

create or replace function public.hr_withdraw_leave_cancellation(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.hr_leave_requests; v_me uuid := hr_private.current_employee_id();
begin
  select * into r from public.hr_leave_requests where id = p_id;
  if r.id is null or v_me is null or r.employee_id is distinct from v_me then
    perform hr_private.fail('Leave request not found.', 'not_found');
  end if;
  perform pg_advisory_xact_lock(hashtext('hr_leave:' || r.employee_id::text));
  select * into r from public.hr_leave_requests where id = p_id for update;
  if r.cancellation_status is distinct from 'pending' then
    perform hr_private.fail('There is no pending cancellation request for this leave.', 'invalid_state');
  end if;
  update public.hr_leave_requests set cancellation_status = null where id = p_id returning * into r;
  perform hr_private.leave_event(p_id, 'cancellation_withdrawn', r.status, r.status, null, null);
  return to_jsonb(r);
end $$;

-- ---------------------------------------------------------------------
-- 3. HR: decide
-- ---------------------------------------------------------------------
create or replace function public.hr_decide_leave_cancellation(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.hr_leave_requests;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not (hr_private.has_permission('leave.approve') or hr_private.has_permission('leave.manage')) then
    perform hr_private.fail('Leave request not found.', 'not_found');
  end if;
  select * into r from public.hr_leave_requests where id = p_id;
  if r.id is null then perform hr_private.fail('Leave request not found.', 'not_found'); end if;
  if r.employee_id = hr_private.current_employee_id() then
    perform hr_private.fail('You cannot decide a cancellation of your own leave.', 'self_approval');
  end if;
  perform pg_advisory_xact_lock(hashtext('hr_leave:' || r.employee_id::text));
  select * into r from public.hr_leave_requests where id = p_id for update;
  if r.cancellation_status is distinct from 'pending' or r.status <> 'approved' then
    perform hr_private.fail('There is no pending cancellation request for this leave.', 'invalid_state');
  end if;
  if v_note is not null and length(v_note) > 2000 then perform hr_private.fail('Note is too long (2000 characters max).', 'too_long'); end if;

  if p_approve then
    update public.hr_leave_requests set cancellation_status = null, cancellation_decided_at = now(), cancellation_decision_note = v_note
     where id = p_id;
    -- Same path as an HR cancellation: restores used days, ledgered, notifies the employee.
    return public.hr_cancel_leave(p_id, coalesce(v_note, 'Cancellation request approved: ' || left(r.cancellation_reason, 200)));
  end if;

  if v_note is null or length(v_note) < 3 then
    perform hr_private.fail('Give a reason for rejecting the cancellation (at least 3 characters).', 'reason_required');
  end if;
  update public.hr_leave_requests set cancellation_status = 'rejected', cancellation_decided_at = now(), cancellation_decision_note = v_note
   where id = p_id returning * into r;
  perform hr_private.leave_event(p_id, 'cancellation_rejected', r.status, r.status, 'hr', v_note);
  perform hr_private.notify_employee(r.employee_id, 'leave.cancellation_rejected', 'Cancellation request rejected',
    'Your leave from ' || to_char(r.start_date, 'DD Mon YYYY') || ' stays approved. ' || v_note,
    '/employee/leave', 'hr_leave_requests', p_id::text);
  return to_jsonb(r);
end $$;

-- ---------------------------------------------------------------------
-- 4. A direct cancellation closes any open cancellation request
-- ---------------------------------------------------------------------
create or replace function public.hr_cancel_leave(p_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_mark bigint := hr_leave_internal.leave_ledger_mark(); v_res jsonb;
begin
  v_res := hr_leave_internal.cancel_leave_core(p_id, p_note);
  perform hr_leave_internal.leave_link_ledger(v_mark, p_id);
  update public.hr_leave_requests set cancellation_status = null where id = p_id and cancellation_status = 'pending';
  return (select to_jsonb(x) from public.hr_leave_requests x where x.id = p_id);
end $$;

-- ---------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------
revoke execute on function
  public.hr_request_leave_cancellation(uuid, text), public.hr_withdraw_leave_cancellation(uuid),
  public.hr_decide_leave_cancellation(uuid, boolean, text), public.hr_cancel_leave(uuid, text)
from anon, public;
grant execute on function
  public.hr_request_leave_cancellation(uuid, text), public.hr_withdraw_leave_cancellation(uuid),
  public.hr_decide_leave_cancellation(uuid, boolean, text), public.hr_cancel_leave(uuid, text)
to authenticated;
