-- ═══════════════════════════════════════════════════════════════════════════
-- 0064 · provenance stops being a dormant table and becomes a record of ACTIONS
-- S-S Phase D. Aligns `asset_provenance` and `rights` to C2PA / CAWG.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `asset_provenance` and `rights` have existed since 0001 with **zero code
-- references anywhere in the repo** and zero rows. S-S §2.1 calls Content
-- Credentials parity "an engine away, not a rewrite" — this is that engine's
-- schema half, and the reason it is worth doing now rather than later is that
-- both tables are EMPTY, so every constraint below is free today and expensive
-- the moment the first row lands.
--
-- ── WHY THE STANDARD, AND WHY NOT THE SDK ──────────────────────────────────
--
-- C2PA (Coalition for Content Provenance and Authenticity, spec 2.4) is what
-- the industry converged on, and the CAI's own SDKs (`c2pa-rs`, `c2pa-js`) are
-- dual MIT / Apache-2.0. They are NOT a dependency here, deliberately: those
-- libraries embed a signed manifest into a BINARY asset, and the AI in this
-- product today is text — a writing assistant whose output lands in a
-- `documents` row. There is no image to sign. Pulling a Rust/WASM toolchain in
-- to serve zero current assets would be a dependency bought on a forecast.
--
-- What IS adopted is the DATA MODEL, so that when a generation pipeline does
-- produce media, emitting a real manifest is a serialization step and not a
-- schema migration:
--
--   C2PA concept              already here            added here
--   ─────────────────────     ────────────────────    ──────────────────
--   c2pa.actions.v2           (implicit)              `action`
--   digitalSourceType         (absent)                `digital_source_type`
--   softwareAgent             `model`                 —
--   c2pa.ingredient.v3        `parent_asset_id`       —
--   claim signature           `signature`             —
--   action parameters         `params`                `chars`
--
-- `prompt` and `seed` are OURS and go beyond C2PA, which standardises no field
-- for either. They are kept because for a film production "which model, on what
-- prompt, wrote this passage" is the question that actually gets asked.
--
-- ── THE SUBJECT IS A DOCUMENT, NOT ONLY A FILE ─────────────────────────────
--
-- The table shipped with `file_id` alone. Every AI call this product makes today
-- produces TEXT (usage_events: 15 `primeos`, 3 `ai.text.tokens`, and not one
-- image meter), so a file-only writer would have written zero rows — the same
-- dormant-engine outcome this migration exists to end. `document_id` is a real
-- column with a real FK rather than a key in `params`, for the reason 0061 and
-- 0062 both gave: a JSONB value cannot be indexed, grouped or joined.
--
-- ── RIGHTS LEARNS THE CAWG PERMISSION TRIPLE ───────────────────────────────
--
-- The Creator Assertions Working Group's `cawg.training-mining` assertion is
-- the standard answer to "may this be used for AI", and it is three separate
-- questions, not one flag: data mining, AI inference, and generative training.
-- Each takes `allowed` | `notAllowed` | `constrained`.
--
-- THE DEFAULT IS `notAllowed`, AND THAT IS A DECISION. CAWG treats an absent
-- assertion as "no statement made". A database is not a manifest: a row with no
-- answer still gets read, and the failure mode of a permissive default is a
-- studio's unreleased dailies becoming training data because nobody filled in a
-- form. Consent is granted, never assumed — which is the same rule the
-- `talent_consent` column on this table already encodes.
--
-- ── SCOPING, BECAUSE 0059/0060 EXIST NOW ───────────────────────────────────
--
-- Both policies are today `organization_id = current_org() AND is_org_member()`
-- with no project predicate — written before project scoping did. A provenance
-- row about a document is as sensitive as the document, so it gains the same
-- predicate through the 0060 helper, plus a new `org_file_visible()` cut to the
-- same pattern for the file branch.
--
-- SECURITY DEFINER on that helper is required, not stylistic, and 0060 states
-- why: it must read the PARENT to find its project, and the caller may be unable
-- to see that parent — which is the entire point.
--
-- NARROWS NOTHING LIVE. Both tables hold 0 rows, and every live crew member is
-- `scope_mode='all'`, so `org_project_visible()` is true for them everywhere.
-- Rule Zero holds.
--
-- I-12: forward-only, additive, every create policy preceded by a drop, one
-- transaction.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── the file-visibility helper, cut to 0060's pattern ──────────────────────
create or replace function public.org_file_visible(f_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.files f
    where f.id = f_id
      and (f.project_id is null or public.org_project_visible(f.project_id))
  )
$function$;

comment on function public.org_file_visible(uuid) is
  'S-S Phase D / 0064. Does the caller''s project scope admit this FILE? The '
  'companion to org_document_visible (0060), for tables that reference a file '
  'and carry no project_id of their own. A file with no project is org-scoped.';

-- ── asset_provenance · the C2PA action record ──────────────────────────────
alter table public.asset_provenance
  add column if not exists document_id         uuid references public.documents(id) on delete cascade,
  add column if not exists action              text not null default 'c2pa.created',
  add column if not exists digital_source_type text,
  add column if not exists chars               integer;

comment on column public.asset_provenance.action is
  'C2PA c2pa.actions.v2 action name. c2pa.created = this asset was generated; '
  'c2pa.placed = generated content was inserted into an existing asset.';
comment on column public.asset_provenance.digital_source_type is
  'IPTC digitalsourcetype URL. trainedAlgorithmicMedia for wholly generated, '
  'compositeWithTrainedAlgorithmicMedia where generated content joins human work.';
comment on column public.asset_provenance.chars is
  'How much generated content actually entered the subject. The disclosure '
  'question is proportion, not presence.';

alter table public.asset_provenance drop constraint if exists asset_provenance_action_check;
alter table public.asset_provenance add constraint asset_provenance_action_check
  check (action in ('c2pa.created', 'c2pa.edited', 'c2pa.placed', 'c2pa.opened'));

-- The IPTC scheme is an open vocabulary, so the constraint holds the NAMESPACE
-- rather than the terms: a typo is caught, a new term from IPTC is not blocked.
alter table public.asset_provenance drop constraint if exists asset_provenance_dst_check;
alter table public.asset_provenance add constraint asset_provenance_dst_check
  check (
    digital_source_type is null
    or digital_source_type like 'http://cv.iptc.org/newscodes/digitalsourcetype/%'
  );

-- A provenance row must be ABOUT something. Free to add at 0 rows; impossible
-- to add later without a backfill that would be guesswork.
alter table public.asset_provenance drop constraint if exists asset_provenance_subject_check;
alter table public.asset_provenance add constraint asset_provenance_subject_check
  check (file_id is not null or document_id is not null);

create index if not exists asset_provenance_document_idx
  on public.asset_provenance (document_id) where document_id is not null;
create index if not exists asset_provenance_file_idx
  on public.asset_provenance (file_id) where file_id is not null;
create index if not exists asset_provenance_org_created_idx
  on public.asset_provenance (organization_id, created_at desc);
create index if not exists asset_provenance_parent_idx
  on public.asset_provenance (parent_asset_id) where parent_asset_id is not null;

-- ── rights · the CAWG training-mining triple ───────────────────────────────
alter table public.rights
  add column if not exists data_mining            text not null default 'notAllowed',
  add column if not exists ai_inference           text not null default 'notAllowed',
  add column if not exists ai_generative_training text not null default 'notAllowed';

comment on column public.rights.ai_generative_training is
  'CAWG cawg.training-mining: may this asset train a generative model? '
  'allowed | notAllowed | constrained. Defaults to notAllowed — consent is '
  'granted, never assumed.';

alter table public.rights drop constraint if exists rights_training_mining_check;
alter table public.rights add constraint rights_training_mining_check
  check (
    data_mining            in ('allowed', 'notAllowed', 'constrained')
    and ai_inference       in ('allowed', 'notAllowed', 'constrained')
    and ai_generative_training in ('allowed', 'notAllowed', 'constrained')
  );

create index if not exists rights_file_idx on public.rights (file_id) where file_id is not null;

-- ── RLS · the same tenancy, now with project scope ─────────────────────────
drop policy if exists asset_provenance_org_all on public.asset_provenance;
create policy asset_provenance_org_all on public.asset_provenance
  for all
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (document_id is null or public.org_document_visible(document_id))
    and (file_id is null or public.org_file_visible(file_id))
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (document_id is null or public.org_document_visible(document_id))
    and (file_id is null or public.org_file_visible(file_id))
  );

drop policy if exists rights_org_all on public.rights;
create policy rights_org_all on public.rights
  for all
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (file_id is null or public.org_file_visible(file_id))
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (file_id is null or public.org_file_visible(file_id))
  );

commit;

-- ── verification (run after apply) ─────────────────────────────────────────
-- select count(*) from asset_provenance;                        -- expect 0
-- select count(*) from rights;                                  -- expect 0
-- select conname from pg_constraint
--   where conrelid = 'public.asset_provenance'::regclass;        -- 4 new checks
-- select policyname, qual from pg_policies
--   where tablename in ('asset_provenance','rights');            -- scoped
-- select public.org_file_visible(id) from files limit 1;         -- true for all-scope
