-- Batch 5: bank address on business/payment settings.
-- Idempotent — safe to run once or many times.
-- Paste into Supabase → SQL Editor → Run.

-- ── business_settings: bank address shown alongside wire details ─────────
-- business_address already exists (see invoicing migration); add the bank's
-- address so unpaid invoices can show both the bank and business addresses.
alter table public.business_settings add column if not exists bank_address text;
