-- ═══════════════════════════════════════════════════════════════════════════
-- 0078 · single-use signing links   (S3-b §3.7, the path v1 deferred)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `S3-b` §7 answer 2 put v1 on portal members and said to revisit "when a real
-- case appears". In a HYBRID production the real case is the common one: an
-- **AI-likeness and digital-double release** from a background actor, a stunt
-- double, a musician whose voice is being modelled. These people sign once and
-- will never hold an account, and telling a studio "invite them to your client
-- portal first" is telling them to use something else.
--
-- ── WHAT A SIGNING LINK IS, AND WHY IT NEEDS A TABLE ──────────────────────
--
-- It is a bearer credential for ONE contract. That makes three properties
-- non-negotiable, and none of them is available from a stateless signed token:
--
--   · REVOCABLE. A link sent to the wrong address must die on command. A JWT
--     cannot be un-issued; a row can be deleted.
--   · SINGLE-USE FOR SIGNING. The row records `used_at`, so a forwarded link
--     cannot sign a second time.
--   · AUDITABLE. Who minted it, when, for whom — on the same record the
--     certificate is printed from.
--
-- ── THE TOKEN IS NEVER STORED ─────────────────────────────────────────────
--
-- Only `token_hash` (SHA-256) lives here. A database leak then yields no working
-- links, which is the same reasoning that keeps a password out of a users table
-- and the same reasoning 0072 used to keep calendar credentials in Vault.
--
-- ── RLS DENIES EVERYONE, AND THAT IS CORRECT ──────────────────────────────
--
-- No policy is created for `authenticated`. Crew reach links through the route
-- that mints them; the SIGNING path has no session at all — an anonymous person
-- with a URL — so it necessarily runs on the service role, narrowly scoped to
-- one contract id, and belongs on the I-8 allowlist with a written
-- justification. §3.7 says exactly this, and it is the first genuinely new
-- service-role importer this batch has added.
--
-- RLS stays ENABLED with no permissive policy so a stray PostgREST call from a
-- browser reads nothing rather than everything.
--
-- ── EXPIRY IS NOT OPTIONAL ────────────────────────────────────────────────
--
-- A link with no end date is a permanent credential in somebody's inbox. The
-- column is NOT NULL and the route sets a bounded default.
--
-- I-12: forward-only, additive.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.contract_signing_links (
  id          uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  signer_id   uuid not null references public.contract_signers(id) on delete cascade,

  -- SHA-256 of the token. The token itself is shown once, at mint, and never
  -- stored anywhere.
  token_hash text not null,

  expires_at timestamptz not null,
  used_at    timestamptz,
  revoked_at timestamptz,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.contract_signing_links is
  'S3-b §3.7. A bearer credential for ONE contract, for a signer who is not a '
  'platform member — an AI-likeness release from a background actor is the case '
  'this exists for. Revocable, single-use, auditable. The token is never stored.';

create unique index if not exists contract_signing_links_token_idx
  on public.contract_signing_links (token_hash);
create index if not exists contract_signing_links_signer_idx
  on public.contract_signing_links (signer_id);

alter table public.contract_signing_links enable row level security;
-- Deliberately NO policy. See the header: the only legitimate readers are the
-- minting route and the anonymous signing path, and both are server-side.

-- A non-member signer verifies by holding the link, not by holding a session.
alter table public.contract_signers drop constraint if exists contract_signers_verification_check;
alter table public.contract_signers add constraint contract_signers_verification_check
  check (verification in ('session', 'sms_passcode', 'email_link'));

commit;

-- ── verification ───────────────────────────────────────────────────────────
-- select count(*) from pg_policies where tablename='contract_signing_links'; -- 0
-- select relrowsecurity from pg_class where relname='contract_signing_links'; -- t
