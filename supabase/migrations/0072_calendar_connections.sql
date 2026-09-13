-- ═══════════════════════════════════════════════════════════════════════════
-- 0072 · calendar_connections   (S3-b migration 4 — the one that was blocked)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- S3-b §1.6 is the only item in that document that says **"stop and decide this
-- before writing the migration — it is the one item that should not be
-- improvised."** The question was where third-party calendar tokens live.
--
-- ── THE DECISION: SUPABASE VAULT ───────────────────────────────────────────
--
-- §1.6 offered three answers — Vault, an encrypted column with the key outside
-- the database, or deferring sync entirely. **Vault**, and the reason it is not
-- a close call: it is ALREADY INSTALLED on this project (the `vault` schema,
-- with `create_secret`, `update_secret`, `secrets` and `decrypted_secrets`,
-- verified live before this was written). Choosing the encrypted column would
-- mean writing a key-management scheme, deciding where the key lives, how it
-- rotates and what happens when it does not — which is exactly the improvisation
-- the spec forbids, in order to reimplement something the platform ships.
--
-- **THIS TABLE HAS NO TOKEN COLUMN AND MUST NEVER GAIN ONE.** It stores
-- `token_secret_id`, a reference into `vault.secrets`. A refresh token in a
-- plain column is a credential that reaches every log, every backup, every
-- `select *` and every screenshare — S2 §4 Class D's reasoning about bank
-- details, with more force, because this one grants access to a system that is
-- not ours.
--
-- No FOREIGN KEY into `vault.secrets`, deliberately: `vault` is a
-- Supabase-managed schema and a cross-schema FK into it is a hard dependency on
-- an internal shape we do not control. The cost is that deleting a connection
-- must also delete its secret, and that is the application's job — stated here
-- rather than assumed.
--
-- ── RLS: user_id = auth.uid(), FOR EVERY OPERATION, INCLUDING ADMINS ───────
--
-- §1.7 is unusually absolute about this and it is right: "Nobody else reads a
-- person's calendar credentials." There is no org predicate, no
-- `has_cap('people.manage')` escape and no owner exception — an org owner
-- reading a crew member's Google token is not administration, it is access to
-- that person's private calendar and mailbox.
--
-- This is the ONLY table in the schema whose policy does not mention
-- `current_org()`, and that asymmetry is the point rather than an oversight.
-- `organization_id` is still stored, for T-5 and so a tenant's connections can
-- be counted and cleaned up — but it is NOT what authorizes the read.
--
-- The service role still bypasses RLS, which is correct here: the sync job has
-- no session and must read the connection to refresh it. That path is the one
-- legitimate reader and belongs on the I-8 allowlist when it is built.
--
-- ── SYNC ITSELF IS NOT BUILT ───────────────────────────────────────────────
--
-- §7 answer 1 recommends deferring external sync. This migration lands the
-- SHAPE — the schema question §1.6 says to answer now — without the Google,
-- Outlook, Apple or CalDAV integrations, which are a later batch with their own
-- OAuth surfaces. A table with no writer is a cost this repo has paid twice
-- (0064 woke two of them), so it is worth being explicit: this one is deliberate
-- and is the answer to a question that blocks nothing else.
--
-- I-12: forward-only, additive.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.calendar_connections (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,

  provider            text not null,
  external_account_id text not null,

  -- A REFERENCE INTO vault.secrets. Never the token itself.
  token_secret_id uuid,

  -- The provider's incremental cursor. Not a credential.
  sync_token     text,
  last_synced_at timestamptz,
  status         text not null default 'active',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint calendar_connections_provider_check check (
    provider in ('google', 'outlook', 'apple', 'caldav')
  ),
  constraint calendar_connections_status_check check (
    status in ('active', 'needs_reauth', 'revoked')
  ),
  -- One connection per account per provider per person. Reconnecting the same
  -- Google account must update the row, not accumulate a second one with a
  -- stale token that the sync job may still pick up.
  constraint calendar_connections_unique unique (user_id, provider, external_account_id)
);

comment on table public.calendar_connections is
  'S3-b §1.6. External calendar links. NO TOKEN COLUMN — token_secret_id '
  'references vault.secrets. RLS is user_id = auth.uid() for every operation, '
  'including org admins and owners (§1.7).';
comment on column public.calendar_connections.token_secret_id is
  'vault.secrets(id). No FK: `vault` is a Supabase-managed schema. Deleting a '
  'connection must also delete its secret — the application''s job.';

create index if not exists calendar_connections_user_idx
  on public.calendar_connections (user_id);
-- The sync job's own sweep: due connections, oldest first.
create index if not exists calendar_connections_sync_idx
  on public.calendar_connections (last_synced_at) where status = 'active';

alter table public.calendar_connections enable row level security;

-- ONE policy, and it names a person rather than a tenant. See the header.
drop policy if exists calendar_connections_self_only on public.calendar_connections;
create policy calendar_connections_self_only on public.calendar_connections
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

commit;

-- ── verification ───────────────────────────────────────────────────────────
-- select count(*) from information_schema.columns
--  where table_name='calendar_connections'
--    and column_name in ('token','access_token','refresh_token');   -- MUST be 0
-- select qual from pg_policies where tablename='calendar_connections';
--   -- MUST NOT mention current_org()
