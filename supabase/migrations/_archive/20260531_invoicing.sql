-- Invoicing workflow + connectors migration
-- Safe to run multiple times (idempotent). Paste into Supabase → SQL Editor → Run.

-- ── invoices: bank/wire workflow + receipts + Stripe-ready ──────────────
alter table public.invoices add column if not exists title           text;
alter table public.invoices add column if not exists notes           text;
alter table public.invoices add column if not exists line_items      jsonb default '[]'::jsonb;
alter table public.invoices add column if not exists payment_method   text default 'bank_transfer';
alter table public.invoices add column if not exists receipt_file_id  uuid;
alter table public.invoices add column if not exists paid_at          timestamptz;
alter table public.invoices add column if not exists updated_at       timestamptz default now();

-- Normalise status to free text (lets us use draft|unpaid|paid|overdue
-- regardless of whether it was previously an enum or had a CHECK).
alter table public.invoices alter column status type text using status::text;
alter table public.invoices alter column status set default 'unpaid';

-- Receipt links to a Files Vault row (kept if the file is later removed).
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'invoices_receipt_file_id_fkey'
  ) then
    alter table public.invoices
      add constraint invoices_receipt_file_id_fkey
      foreign key (receipt_file_id) references public.files(id) on delete set null;
  end if;
end $$;

-- ── files: explicit category override (receipts / invoice docs) ─────────
alter table public.files add column if not exists category text;
-- Allow client-scoped files (e.g. an invoice receipt with no project).
alter table public.files alter column project_id drop not null;

-- ── clients: invite counter for Sent / Resent status ───────────────────
alter table public.clients add column if not exists invite_count int default 0;

-- ── business_settings: single-row payment + business identity ───────────
create table if not exists public.business_settings (
  id                  text primary key default 'singleton',
  business_name       text,
  business_email      text,
  business_address    text,
  bank_name           text,
  account_name        text,
  account_number      text,
  routing_number      text,
  swift               text,
  payment_instructions text,
  updated_at          timestamptz default now()
);

-- Admin-only: RLS on, no anon/auth policies. The app reads/writes it with
-- the service-role key (which bypasses RLS), and passes payment details to
-- clients through server components — clients never query this table.
alter table public.business_settings enable row level security;

-- Seed the singleton row so upserts/updates always have a target.
insert into public.business_settings (id)
values ('singleton')
on conflict (id) do nothing;
