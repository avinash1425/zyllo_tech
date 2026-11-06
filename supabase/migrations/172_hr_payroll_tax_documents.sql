-- 172 — Employee Portal "My Payroll & Payslips": tax documents.
--
-- Tax documents are ordinary employee documents (Module 9), so storage,
-- versioning, RLS (hr_private.document_can_read), the access log and the
-- compensation guard all apply unchanged. This migration only adds:
--   * a 'tax' document group, and
--   * three categories:
--       form_16             — Form 16 (TDS certificate) issued by the employer.
--                             HR uploads; the employee can view. Holds salary
--                             figures, so it is a compensation category (only
--                             documents.compensation holders can add one).
--       tax_statement       — other employer-issued tax papers (annual tax
--                             computation, Form 12BA, revised Form 16 …).
--       tax_investment_proof — the employee's own tax-saving declarations and
--                             proofs (rent receipts, 80C/80D proofs, Form 12BB)
--                             for payroll to consider in the TDS estimate.
--                             Employee can upload; HR verifies.
-- Nothing here computes income tax; the payroll TDS amount still comes from
-- the employee's statutory enrolment (170).

alter table public.hr_document_categories drop constraint if exists hr_document_categories_doc_group_check;
alter table public.hr_document_categories add constraint hr_document_categories_doc_group_check
  check (doc_group in ('offer_letter','appointment_letter','contract','certificate','letter','policy','identity','attachment','confidential','tax','other'));

insert into public.hr_document_categories
  (code, name, description, requires_expiry, employee_can_upload, employee_can_view, is_confidential, checklist_required, sort_order, doc_group, contains_compensation) values
  ('form_16',              'Form 16 (TDS certificate)',      'Annual TDS certificate issued by the employer (Part A and Part B) for one financial year', false, false, true, false, false, 40, 'tax', true),
  ('tax_statement',        'Tax statement (employer)',       'Employer-issued tax papers: annual tax computation, Form 12BA, revised Form 16',          false, false, true, false, false, 41, 'tax', true),
  ('tax_investment_proof', 'Tax declaration / proof',        'Your tax-saving declaration (Form 12BB) and proofs: rent receipts, 80C / 80D, home loan', false, true,  true, false, false, 42, 'tax', false)
on conflict (code) do nothing;
