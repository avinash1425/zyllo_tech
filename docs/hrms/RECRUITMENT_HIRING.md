# Recruitment & Hiring (HR module 3)

Status: implemented on branch `Intern`. Not committed or deployed. Local and isolated test clusters only.

This module extends the existing **Recruitment & Interns** module (migration `104_hr_recruitment.sql`). It does not replace it.

- **Migration:** `supabase/migrations/120_hr_recruitment_hiring.sql` is additive.
  - No 104 table, column, status value or RPC signature was removed or renamed.
  - Four 104 RPCs keep their signatures but have new bodies (see "104 RPCs changed in place").
- **UI:** `src/hr/pages/RecruitmentPage.jsx` (`/hr/recruitment/*`) and `src/hr/pages/recruitment/*`.
- **Data layer:** `src/lib/hr/recruitment.js` (104) and `src/lib/hr/recruitmentHiring.js` (120).
- **PDF writer:** `src/lib/hr/offerPdf.js`. It has no dependencies.

## Workflow

**1. Job opening**
- Statuses: Draft → Open → On hold → Closed (or Filled).
- Reopening a closed opening needs the `recruitment.reopen` permission and a reason.
- Every status change is recorded in `hr_job_opening_status_events`.
- The salary range is stored separately, in `hr_job_opening_compensation`.

**2. Careers page**
- *Publish* uses the existing integration point, `hr_publish_job_opening` and `hr_private.publish_opening_posting`. It writes a `job_postings` row in the connected database.
- Applications that arrive from the careers page come in through `hr_import_careers_applications`.
- `hr_add_application` is the entry point for a future direct integration.
- The main website itself is not modified.

**3. Application**
- One candidate record per email address.
- One application per candidate per opening. A duplicate application for the same job is refused.
- The application has its own source, date and assigned recruiter.
- Expected and current salary are kept in `hr_application_compensation`.
- Notes are append-only.
- Attachments go in the private bucket `hr-recruitment`, using the register → upload → confirm flow.

**4. Screening**
- Records a resume review, the opening's eligibility checklist, answers to its screening questions, a score (0–100) and notes.
- The decision is one of: shortlist, hold or reject.
- Hold and reject need a reason.
- Every decision is an immutable row in `hr_candidate_screenings`, with the reviewer and the date.

**5. Interviews**
- Scheduling uses `hr_schedule_interview` (from 104).
- Reschedules are recorded in `hr_interview_reschedules`, with the reason.
- Cancelling needs a reason. Completed and No-show can only be set after the start time.
- Changing the time, mode or place directly is refused; use Reschedule.
- No email is sent and no calendar invitation is created. The panel is notified in the portal only.

**6. Evaluations**
- Stored in `hr_interview_feedback`.
- Scores for technical, HR, communication, role skills and experience, plus an overall rating and a recommendation (Hire / Hold / Reject).
- Drafts are visible only to the interviewer who wrote them.
- A submitted evaluation is locked. HR (`recruitment.manage`) can re-open it with a reason; after that, only the author can edit it.

**7. Final decision**
- Made by HR or the opening's hiring manager.
- *Hire* needs at least one submitted evaluation and moves the candidate to Selected.
- Recorded in `hr_hiring_decisions`.

**8. Offer**
- Draft → Issued (`sent`) → Accepted / Rejected (`declined`) / Expired / Withdrawn. The database keeps the status names from 104; the UI shows the labels above.
- The letter is generated only from an **approved** template. HR Admin approves templates, which needs `recruitment.manage` + `settings.manage`.
- Each generation creates a new row in `hr_offer_letter_versions`. Older versions are kept.
- The PDF is built in the browser from a stored version. Every download is audited.
- *Issue* needs a letter that is up to date and an authorised signatory.
- After an offer is issued, its terms are frozen.
- *Email letter* queues the letter in `hr_email_outbox`. The offer shows as emailed **only** after the dispatcher sets the outbox row to `sent`.

**9. Hire**
- `hr_convert_candidate_to_employee` (from 104) is reused.
- It creates one `hr_employees` row with `source='candidate'`, `source_ref=<application>` and `status='onboarding'`.
- The application is linked to the new employee, and the candidate's history is kept.
- A second conversion is refused, both for the same application and for the same candidate.
- Interns get an internship record, as before.
- The onboarding workflow belongs to the Onboarding module. That module reacts to the new employee row.

## Access

| Who | Access |
|---|---|
| Super Admin, HR Admin | Everything. Includes `recruitment.reopen`, `recruitment.convert`, and approving templates. |
| Recruiter (optional role `recruiter`; this migration assigns it to nobody) | `recruitment.view` / `manage` / `export`. Cannot reopen openings, convert hires or approve templates. |
| Assigned recruiter (any employee set as recruiter on an opening or application) | Only those candidates. Can screen, add notes and files, and reschedule or cancel interviews. Cannot see compensation. |
| Hiring manager (set on the opening) | Their openings' candidates. Sees submitted evaluations, notes, screening and files. Makes the final decision. Cannot see salaries or offer letters. |
| Interviewer (on the panel) | Assigned candidates only. Can open the resume, cover letter and portfolio, and write their own evaluation. Cannot see screening, notes, other interviewers' evaluations or salaries. |
| Employee, Intern | No access to candidates or openings. |

- All of this is enforced by RLS and `SECURITY DEFINER` RPCs. The UI only hides buttons.
- Salary data (opening range, expected/current salary, offer CTC, letters) is readable with `recruitment.manage` only.

## Deployment notes

- Apply 120 after 100–118, only to the local cluster or the isolated dev project. See `DEPLOYMENT.md`.
- **Schedule `public.hr_expire_overdue_offers()`** daily. It needs a service account with `recruitment.manage`, or can be run from the HR UI: Offers → *Expire overdue offers*.
- Offer emails need the `hr-email-dispatch` Edge Function to process `hr_email_outbox`.
- Storage bucket `hr-recruitment` is created by the migration. On real Supabase, confirm it is private.

## 104 RPCs changed in place (same signatures)

- `hr_send_offer` now goes through the shared issue logic. It auto-generates a letter from the default template when the details allow, so the harness fixtures still work.
- `hr_submit_interview_feedback` now also submits an existing draft.
- `hr_get_application_offers` returns the new offer fields. CTC and email state are returned only to `recruitment.manage`.
- `hr_convert_candidate_to_employee` adds a candidate-level duplicate check and sends notifications.

## Tests

- `supabase/tests/hr/120_recruitment_hiring.test.sql`: 130 assertions.
  - Run with `node scripts/hr-db-test.mjs --only 120`, or the full suite.
- `tests/recruitment-offer-pdf.test.mjs`: PDF structure, xref offsets, pagination, escaping.
- An end-to-end browser flow was run against a **private** harness instance. The shared harness was not touched.

## Final review (2026-11-05): integrations, dependencies and pending items

**Onboarding & Exit (Session 4, worktree `hrms/module-4-onboarding-exit`, migration 130):**
- Their AFTER INSERT trigger on `hr_employees` should fire when `source = 'candidate'`.
- It should read the accepted offer via `hr_offers.application_id = source_ref` and `status = 'accepted'`.
- 120 keeps that contract: conversion inserts `status = 'onboarding'`, `source = 'candidate'`, `source_ref = <application id>`.
- Their nav entry goes directly after `recruitment` in `HR_MODULES`.
- Until 130 is merged, a hire creates the employee in Onboarding but no onboarding case.
- **Compatibility verified by Session 4** on a scratch copy of migrations 100–120 plus their 130:
  - all test files pass, including 104 (90 assertions), 120 (130) and 130 (121)
  - converting a candidate through the 120 conversion function creates exactly one onboarding case, linked to the accepted offer
  - their `HrApp.jsx` nav edit is rebased onto ours: "Onboarding & Exit" goes directly after "Recruitment & Hiring"

**Offer expiry scheduler (pending):**
- Schedule `public.hr_expire_overdue_offers()` daily, for example with pg_cron or a scheduled Edge Function.
- It must run as an identity holding `recruitment.manage`, or call a service-role wrapper.
- Until then, HR runs it manually: Offers → *Expire overdue offers*.

**Offer email:**
- *Email letter* only inserts an `hr_email_outbox` row (`queued`). The `hr-email-dispatch` Edge Function must be deployed and scheduled to send it.
- The UI shows "Email queued, not delivered yet" for `queued` / `sending`, "Email failed" for `failed`, and "Emailed to candidate" only for `sent`.
- Issuing an offer never implies it was emailed.
- The email contains the letter text only; there is no PDF attachment.

**Careers page applications (pending):**
- Publishing writes a `job_postings` row.
- Applications come in only through the manual *Import careers applications* (`hr_import_careers_applications`).
- A direct, real-time submission path (careers form → `hr_add_application`, through a server-side or Edge Function caller) is not built.
- The main website was not modified.

**Dashboard count (Session 1): resolved.**
- Before the fix, `117_hr_dashboard_essentials.sql` treated any feedback row, including a 120 draft, as submitted.
- 117 now counts only `submitted` evaluations: `coalesce(to_jsonb(f) ->> 'status', 'submitted') = 'submitted'`, which also works before 120 is applied. The Recruitment session did not edit the file.
- Verified in an isolated cluster with 117 + 118 + 120 applied:
  - 1 due before any evaluation
  - still 1 due with only a draft
  - not due after submission
  - 117 tests pass (35 assertions)

**Resume upload:**
- Permissions are enforced in SQL and covered by the 120 tests: register needs `recruitment.manage` or the assigned recruiter. Storage insert is allowed only for the registered path, by the uploader, within 24 h.
- Read access: resume, cover letter and portfolio are readable by anyone who can view the candidate (including interviewers). Other kinds (ID proof, certificates) are limited to HR, the recruiter and the hiring manager.
- Still needs a browser check: the file-upload form in *Add application* and *Resume & attachments*, against real Supabase Storage. The local harness emulates storage.
