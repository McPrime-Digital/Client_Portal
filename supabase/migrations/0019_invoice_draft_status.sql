-- ============================================================================
-- 0019_invoice_draft_status.sql — let an invoice be a draft
--
-- invoices_status_check (0000:257) permits only unpaid|paid|overdue|partial,
-- but the admin UI offers "Draft" (components/admin/NewInvoiceForm.tsx:49) and
-- the write path stores it (app/api/admin/invoice-actions/route.ts:77). Saving
-- a draft invoice therefore fails with Postgres 23514 every time.
--
-- The constraint is what is wrong, not the code: draft is a real state in the
-- product (an invoice prepared but not yet issued to the client).
--
-- Idempotent and forward-only. INDEPENDENT OF 0018 — this file touches only
-- public.invoices and can be applied before it, after it, or alone.
-- ============================================================================

begin;

alter table public.invoices drop constraint if exists invoices_status_check;
alter table public.invoices add constraint invoices_status_check
  check (status = any (array['draft','unpaid','paid','overdue','partial']));

commit;
