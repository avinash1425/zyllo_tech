-- Rollback of 226_project_tracker_commercial_documents.sql.
-- Quotations / invoices / sales orders / purchase orders are kept but moved to the
-- 'contract' section (their number is copied into the title first), then the number
-- column is removed. Uploaded files are not touched.
update public.pt_documents
   set title = left(doc_number || ' — ' || title, 200)
 where doc_number is not null and position(doc_number in title) = 0;
update public.pt_documents set category = 'contract'
 where category in ('quotation', 'invoice', 'sales_order', 'purchase_order');
drop index if exists public.pt_documents_number_key;
alter table public.pt_documents drop constraint if exists pt_documents_doc_number_check;
alter table public.pt_documents drop column if exists doc_number;
alter table public.pt_documents drop constraint if exists pt_documents_category_check;
alter table public.pt_documents add constraint pt_documents_category_check
  check (category in ('handover', 'mom', 'revision', 'contract', 'other'));
