-- ═══════════════════════════════════════════════════════════════════════════
-- 0088 · the rights record gets a reader, and the client is one of them
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── THE ENGINE HAS BEEN HALF-BUILT SINCE 0079 ────────────────────────────
--
-- 0079 is described in CLAUDE.md as "the join nobody else can make": a completed
-- release WRITES the `rights` row it proves, so `talent_consent` stops being a
-- box somebody ticks and becomes a consequence of a signature.
--
-- **And a live grep finds ZERO readers of `rights` anywhere in the repository.**
-- The write path exists; nothing reads it back. That is the same dormant shape
-- as `asset_provenance` before 0064 and `calendar_entries` before 0074, except
-- worse: this one has a writer, so the rows are accumulating where nobody can
-- see them.
--
-- ── AND THE OBLIGATION IS NOW LAW, NOT A ROADMAP ITEM ────────────────────
--
-- As of today these are in force, not proposed:
--
--   · **New York, effective 9 June 2026** — conspicuous disclosure is required
--     when an advertisement features an AI-generated SYNTHETIC PERFORMER, and it
--     binds any ad reaching New York consumers wherever the advertiser sits.
--     $1,000 for a first violation, $5,000 for each after.
--   · **EU AI Act, 2 August 2026** — AI-generated images must be machine-readable
--     and labelled when published.
--   · The NO FAKES Act (federal digital-replica right) advanced out of committee
--     in June 2026.
--
-- So the studio is holding exactly the evidence it needs and cannot read it —
-- and **the client, who runs the advertisement and takes the penalty, is never
-- told at all.** Closing that is what this migration is for.
--
-- ── READ THROUGH THE FILE, NOT BESIDE IT ─────────────────────────────────
--
-- 0038's idiom. `files_client_read` already answers "may this client see this
-- asset" — company membership plus project visibility plus not soft-deleted —
-- so restating it here would be a second copy that keeps working after somebody
-- changes the first. An `exists` subquery inside a policy runs under the
-- caller's own RLS, so these two inherit whatever `files` admits, including
-- every future change to it.
--
-- ── WHY THE CLIENT SEES IT AT ALL ────────────────────────────────────────
--
-- Because they are the party the disclosure law acts on. A brand approving a
-- spot that contains a synthetic performer needs to know before it runs, and the
-- studio telling them by email is not a record. This is the same reasoning that
-- gives the client the approval certificate and not the studio's grading of it:
-- facts about the work, yes; the studio's assessment of its own evidence, no.
--
-- READ ONLY. A client cannot write a rights row, and must not be able to: the
-- whole point of 0079 is that the row is a consequence of a signature.
--
-- I-12: forward-only, additive, every create policy preceded by a drop.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── the rights on an asset a client can see ────────────────────────────────
drop policy if exists rights_client_read on public.rights;
create policy rights_client_read on public.rights
  for select to authenticated
  using (
    file_id is not null
    and exists (select 1 from public.files f where f.id = file_id)
  );

comment on policy rights_client_read on public.rights is
  '0088. Reached THROUGH the file, so it inherits files_client_read and cannot '
  'drift from it. Read only — a rights row is a consequence of a signature '
  '(0079), never something the beneficiary asserts.';

-- ── and the AI provenance of it ────────────────────────────────────────────
--
-- FILE-SCOPED ONLY, deliberately. `asset_provenance` also carries
-- `document_id`, and a document is the studio's script — a client has no
-- business reading which lines of a screenplay a model drafted. The disclosure
-- that concerns them is about the ASSET they are approving and will publish, so
-- the policy names `file_id is not null` rather than trusting the join to
-- happen to exclude it.
drop policy if exists asset_provenance_client_read on public.asset_provenance;
create policy asset_provenance_client_read on public.asset_provenance
  for select to authenticated
  using (
    file_id is not null
    and exists (select 1 from public.files f where f.id = file_id)
  );

comment on policy asset_provenance_client_read on public.asset_provenance is
  '0088. The AI disclosure on an ASSET, for the party that has to publish it. '
  'Document provenance stays crew-only: which lines of a script a model drafted '
  'is not the client''s business.';

commit;

-- ── verification ───────────────────────────────────────────────────────────
-- -- a client member reads the rights on their own company's file and NOT on
-- -- another company's; and reads zero DOCUMENT provenance rows in either case.
