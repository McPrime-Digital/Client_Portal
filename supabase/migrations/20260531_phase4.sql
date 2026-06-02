-- Batch 4: persistent welcome banner, client-approval audit trail + auto-proceed,
-- and invoice receipt verification flow. Idempotent — safe to run once or many times.
-- Paste into Supabase → SQL Editor → Run.

-- ── clients: remember when the client dismissed their welcome banner ─────
-- Banner shows until this is set; once dismissed it never returns.
alter table public.clients add column if not exists welcome_dismissed_at timestamptz;

-- ── tasks: approval review tracking + auto-proceed ──────────────────────
-- When an approval gate enters "review", we stamp when the client's review
-- was requested. If no response arrives within the threshold, a scheduled
-- check auto-proceeds and records that the response was not received.
alter table public.tasks add column if not exists review_requested_at timestamptz;
alter table public.tasks add column if not exists auto_proceeded boolean default false;

-- ── invoices: receipt / proof-of-payment verification workflow ──────────
-- receipt_file_id already links the uploaded file (see invoicing migration).
-- receipt_status:  none | submitted (client uploaded, awaiting admin) | verified
-- receipt_uploaded_by:  client | admin   (admin uploads = proof of payment)
alter table public.invoices add column if not exists receipt_status text default 'none';
alter table public.invoices add column if not exists receipt_uploaded_by text;
alter table public.invoices add column if not exists receipt_submitted_at timestamptz;

-- Make sure the receipt file link exists even if the invoicing migration
-- was skipped on this database.
alter table public.invoices add column if not exists receipt_file_id uuid;
