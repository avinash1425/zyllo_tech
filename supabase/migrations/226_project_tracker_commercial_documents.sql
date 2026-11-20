-- =====================================================================
-- 226_project_tracker_commercial_documents.sql — Project Tracker round 7
-- =====================================================================
-- Quotations, invoices, sales orders and purchase orders (from the client)
-- as project documents with their own number:
--   * pt_documents.category gains 'quotation', 'invoice', 'sales_order', 'purchase_order'
--   * pt_documents.doc_number — the document's number (required for those four)
--   * one number per project and type (case-insensitive), e.g. one "INV-001" per project
-- Files use the existing private bucket "pt-project-documents" (or a link).
-- Access unchanged (public.is_admin(), policies from 223).
-- Depends on 223. Idempotent (safe to re-run).
-- Rollback: supabase/rollbacks/226_rollback_project_tracker_commercial_documents.sql
-- =====================================================================

alter table public.pt_documents add column if not exists doc_number text;

alter table public.pt_documents drop constraint if exists pt_documents_category_check;
alter table public.pt_documents add constraint pt_documents_category_check check (
  category in ('handover', 'mom', 'revision', 'contract', 'other',
               'quotation', 'invoice', 'sales_order', 'purchase_order')
);

alter table public.pt_documents drop constraint if exists pt_documents_doc_number_check;
alter table public.pt_documents add constraint pt_documents_doc_number_check check (
      (doc_number is null or (length(btrim(doc_number)) between 1 and 60))
  and (category not in ('quotation', 'invoice', 'sales_order', 'purchase_order') or doc_number is not null)
);

create unique index if not exists pt_documents_number_key
  on public.pt_documents (project_id, category, lower(btrim(doc_number)))
  where doc_number is not null;
