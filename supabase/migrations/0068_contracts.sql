-- ═══════════════════════════════════════════════════════════════════════════
-- 0068 · contracts + fields + signers + events   (S3-b migration 6)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- S3-b §0: "The signing record is the whole point. Get it wrong and every
-- contract signed before the fix is legally weaker." That is the only sentence
-- in this document that describes a defect you cannot repair later — a bad
-- calendar is an annoyance, a bad signing record is an unenforceable agreement
-- that nobody discovers until it is contested.
--
-- ── NOT `documents`. §3.1 ──────────────────────────────────────────────────
--
-- `documents` holds Script Design content. A contract is a different thing with
-- a different lifecycle, and merging them is the collision that made S-F §8
-- decision 1 confusing. Two products, two words, two tables.
--
-- ── contract_events IS APPEND-ONLY, AND THIS GOES FURTHER THAN THE SPEC ────
--
-- §3.5: "Append-only. No UPDATE policy, no DELETE policy, for anyone, ever —
-- including org owners."
--
-- Policy ABSENCE delivers that for every caller subject to RLS. It does not
-- deliver it against the SERVICE ROLE, which bypasses RLS entirely and which
-- ~70 modules in this repo still hold (I-8). For an ordinary table that gap is
-- the known cost of the migration in progress. For the table that IS the
-- certificate of completion it is the whole property: a record an administrator
-- can quietly edit is not evidence, and "we have RLS" is not an answer in front
-- of a court.
--
-- So the guard is a TRIGGER, which the service role cannot step around, and it
-- refuses UPDATE and DELETE unconditionally. The same reasoning 0038 applied to
-- approval_decisions, one level stricter, because this one is signed.
--
-- `occurred_at` IS STAMPED, NOT SUPPLIED. A client-supplied timestamp on a
-- legal record is a backdating facility. The trigger overwrites whatever
-- arrives, on every insert.
--
-- ── IP AND USER AGENT ARE PERSONAL DATA, AND THEY STAY ─────────────────────
--
-- §3.5 records this tension rather than resolving it, and so does this
-- migration: an enforceable signature record requires them, the S3-core §4.3
-- tombstone covers the NAME field, and the IP itself must survive erasure
-- because removing it destroys the evidentiary value that is the table's reason
-- to exist. Retention for signature records is a legal-review item
-- (S-F §8 decision 2), not something a migration should decide by default.
--
-- ── WHAT IS NOT BUILT HERE ─────────────────────────────────────────────────
--
-- §3.7's single-use signing link for a signer who is NOT a platform member is a
-- service-role path and would need an I-8 allowlist entry with a written
-- justification. It is not added: the batch's standing rule is no new
-- service-role importers, and S3-b §7 answer 2 recommends v1 require signers to
-- be portal members. `contract_signers.user_id` is nullable so the outside
-- counterparty remains expressible the day that path is built.
--
-- I-12: forward-only, additive, every create policy preceded by a drop.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.contracts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id       uuid references public.clients(id)  on delete set null,
  project_id      uuid references public.projects(id) on delete set null,

  -- A template is a contract with is_template. Self-FK, SET NULL: deleting a
  -- template must never delete the agreements drawn from it.
  template_id uuid references public.contracts(id) on delete set null,
  is_template boolean not null default false,

  title text not null,
  -- Generated body (BlockNote) OR an uploaded PDF — §3.2 supports both paths.
  body           jsonb,
  source_file_id uuid references public.files(id) on delete set null,

  status     text not null default 'draft',
  expires_at timestamptz,

  final_file_id       uuid references public.files(id) on delete set null,
  certificate_file_id uuid references public.files(id) on delete set null,
  -- SHA-256 of the exact bytes presented for signature (§3.6, "association with
  -- the record"). What was signed is provable only if this is captured at send.
  content_hash text,

  created_by uuid references auth.users(id) on delete set null,   -- AD-003
  created_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint contracts_status_check check (
    status in ('draft', 'sent', 'viewed', 'partially_signed',
               'completed', 'declined', 'voided', 'expired')
  ),
  constraint contracts_template_not_self check (template_id is null or template_id <> id)
);

comment on table public.contracts is
  'S3-b §3.2. NOT `documents` — that table holds Script Design content (§3.1). '
  'Either a generated body or an uploaded source_file_id.';

create index if not exists contracts_org_idx
  on public.contracts (organization_id, created_at desc) where deleted_at is null;
create index if not exists contracts_client_idx
  on public.contracts (client_id) where client_id is not null;
create index if not exists contracts_project_idx
  on public.contracts (project_id) where project_id is not null;
create index if not exists contracts_template_idx
  on public.contracts (template_id) where template_id is not null;

create table if not exists public.contract_signers (
  id          uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  -- NULL for a signer who is not a platform member (§3.4). See the header for
  -- why that path is expressible but not yet reachable.
  user_id     uuid references auth.users(id) on delete set null,   -- AD-003

  email text not null,
  name  text not null,
  seq   int  not null,

  status       text not null default 'pending',
  verification text not null default 'session',
  signed_at    timestamptz,
  signature_image_file_id uuid references public.files(id) on delete set null,

  created_at timestamptz not null default now(),

  constraint contract_signers_status_check check (
    status in ('pending', 'sent', 'viewed', 'signed', 'declined')
  ),
  constraint contract_signers_verification_check check (
    verification in ('session', 'sms_passcode', 'email_link')
  ),
  constraint contract_signers_seq_check check (seq >= 0),
  constraint contract_signers_seq_unique unique (contract_id, seq)
);

create index if not exists contract_signers_contract_idx
  on public.contract_signers (contract_id);

create table if not exists public.contract_fields (
  id          uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  signer_id   uuid references public.contract_signers(id) on delete cascade,

  kind text not null,
  -- Positions are stored so the field renders identically on every device and
  -- in the final PDF (§3.3). Fractions of the page, not pixels.
  page int not null default 1,
  x numeric not null,
  y numeric not null,
  w numeric not null,
  h numeric not null,

  required  boolean not null default true,
  value     text,
  filled_at timestamptz,

  created_at timestamptz not null default now(),

  constraint contract_fields_kind_check check (
    kind in ('signature', 'initials', 'date', 'text', 'checkbox')
  ),
  constraint contract_fields_page_check check (page >= 1)
);

create index if not exists contract_fields_contract_idx
  on public.contract_fields (contract_id);
create index if not exists contract_fields_signer_idx
  on public.contract_fields (signer_id) where signer_id is not null;

-- ── the legal record ───────────────────────────────────────────────────────
create table if not exists public.contract_events (
  id          uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  -- SET NULL, never CASCADE: removing a signer must not delete the evidence
  -- that they were sent the contract and opened it.
  signer_id   uuid references public.contract_signers(id) on delete set null,

  event      text not null,
  actor_name text not null,
  ip_address inet,
  user_agent text,
  occurred_at timestamptz not null default now(),
  meta       jsonb not null default '{}'::jsonb,

  constraint contract_events_event_check check (
    event in ('created', 'sent', 'opened', 'viewed', 'consented',
              'field_filled', 'signed', 'declined', 'reminded', 'expired', 'voided')
  )
);

comment on table public.contract_events is
  'S3-b §3.5. THE certificate of completion. Append-only for everyone including '
  'the service role — see contract_events_immutable(). occurred_at is stamped, '
  'never supplied, because a client-set timestamp is a backdating facility.';

create index if not exists contract_events_contract_idx
  on public.contract_events (contract_id, occurred_at);

create or replace function public.contract_events_stamp()
returns trigger
language plpgsql
as $function$
begin
  new.occurred_at := now();
  return new;
end
$function$;

create or replace function public.contract_events_immutable()
returns trigger
language plpgsql
as $function$
begin
  raise exception
    'contract_events is append-only: % is refused on the signing record (S3-b §3.5)',
    tg_op
    using errcode = 'restrict_violation';
end
$function$;

drop trigger if exists contract_events_stamp_t on public.contract_events;
create trigger contract_events_stamp_t
  before insert on public.contract_events
  for each row execute function public.contract_events_stamp();

-- A TRIGGER, not merely an absent policy: the service role bypasses RLS, and
-- this is the one table where that gap is the whole property.
drop trigger if exists contract_events_immutable_t on public.contract_events;
create trigger contract_events_immutable_t
  before update or delete on public.contract_events
  for each row execute function public.contract_events_immutable();

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.contracts        enable row level security;
alter table public.contract_signers enable row level security;
alter table public.contract_fields  enable row level security;
alter table public.contract_events  enable row level security;

drop policy if exists contracts_crew_all on public.contracts;
create policy contracts_crew_all on public.contracts
  for all
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
  );

-- A client reads a contract addressed to their company, and never a DRAFT: a
-- draft is the studio's working copy and showing it would leak terms nobody has
-- agreed to send.
drop policy if exists contracts_client_read on public.contracts;
create policy contracts_client_read on public.contracts
  for select
  using (
    client_id is not null
    and public.is_client_member(client_id)
    and (project_id is null or public.client_project_visible(project_id))
    and status <> 'draft'
    and is_template = false
    and deleted_at is null
  );

drop policy if exists contract_signers_read on public.contract_signers;
create policy contract_signers_read on public.contract_signers
  for select
  using (exists (select 1 from public.contracts c where c.id = contract_id));

drop policy if exists contract_signers_crew_write on public.contract_signers;
create policy contract_signers_crew_write on public.contract_signers
  for all
  using (
    exists (
      select 1 from public.contracts c
      where c.id = contract_id
        and c.organization_id = (select public.current_org())
        and (select public.is_org_member())
    )
  )
  with check (
    exists (
      select 1 from public.contracts c
      where c.id = contract_id
        and c.organization_id = (select public.current_org())
        and (select public.is_org_member())
    )
  );

-- A signer marks THEMSELVES signed. Narrow on purpose: it is the one write a
-- client-side session must be able to make, and widening it to the row would
-- let one signer decline on another's behalf.
drop policy if exists contract_signers_self_update on public.contract_signers;
create policy contract_signers_self_update on public.contract_signers
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists contract_fields_read on public.contract_fields;
create policy contract_fields_read on public.contract_fields
  for select
  using (exists (select 1 from public.contracts c where c.id = contract_id));

drop policy if exists contract_fields_crew_write on public.contract_fields;
create policy contract_fields_crew_write on public.contract_fields
  for all
  using (
    exists (
      select 1 from public.contracts c
      where c.id = contract_id
        and c.organization_id = (select public.current_org())
        and (select public.is_org_member())
    )
  )
  with check (
    exists (
      select 1 from public.contracts c
      where c.id = contract_id
        and c.organization_id = (select public.current_org())
        and (select public.is_org_member())
    )
  );

-- A signer fills their OWN fields.
drop policy if exists contract_fields_signer_update on public.contract_fields;
create policy contract_fields_signer_update on public.contract_fields
  for update
  using (
    exists (
      select 1 from public.contract_signers s
      where s.id = signer_id and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.contract_signers s
      where s.id = signer_id and s.user_id = auth.uid()
    )
  );

-- SELECT for anyone who can see the contract; INSERT likewise. There is NO
-- update policy and NO delete policy, and the trigger above makes that binding
-- rather than merely conventional.
drop policy if exists contract_events_read on public.contract_events;
create policy contract_events_read on public.contract_events
  for select
  using (exists (select 1 from public.contracts c where c.id = contract_id));

drop policy if exists contract_events_insert on public.contract_events;
create policy contract_events_insert on public.contract_events
  for insert
  with check (exists (select 1 from public.contracts c where c.id = contract_id));

commit;

-- ── verification ───────────────────────────────────────────────────────────
-- update contract_events set event='signed';   -- MUST raise restrict_violation
-- delete from contract_events;                 -- MUST raise restrict_violation
