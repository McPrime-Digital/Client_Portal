-- ─────────────────────────────────────────────────────────────────────────────
-- 0036 — documents.kind: settle the vocabulary (S-F §8 decision 1; Batch 21
-- item 2 — the gate on Suite work: AD-005 makes FDX the Script Design
-- adoption gate, FDX is screenplay-specific, and S0-A §4.7 says FDX gets
-- redone if types arrive later; S3-c §4 mints script artifacts for review
-- against the same axis).
--
-- THE BRIEF'S PREMISE WAS WRONG, and this file is a reconciliation, not an
-- addition: `kind` has existed since 0004 as `text not null default
-- 'script'` (comment: "'script' | 'concept' | ...") with four live code
-- sites reading/writing 'script' (components/studio/ScriptHome.tsx). The
-- settled vocabulary is
--
--     screenplay | treatment | bible | breakdown | document
--
-- so 'script' is renamed 'screenplay' (rows and code move together), the
-- default flips to 'document' (an unstated kind asserts nothing), and the
-- CHECK pins the list.
--
-- Backfill evidence (live probe 2026-09-02): exactly ONE row exists, kind
-- 'script', created 2026-08-27 through Script Design's own create path —
-- confidently a screenplay. Zero rows default to 'document' for lack of
-- evidence.
--
-- ORDERING — this is DROP-shaped, not additive: the CHECK rejects the value
-- the old deploy writes. Code deploys first (Batch 21.2), this file applies
-- second, schema cache reloads third. Applied against the old deploy it
-- breaks Script Design's create ('script' fails the CHECK) and empties its
-- list until the deploy lands — tolerable only because Script Design has
-- one user today (the owner; live row count 1). 0035 sorts before this
-- file and lands with Batch 21.3; filename order stays apply order.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

update public.documents set kind = 'screenplay' where kind = 'script';

alter table public.documents alter column kind set default 'document';

alter table public.documents drop constraint if exists documents_kind_check;
alter table public.documents add constraint documents_kind_check
  check (kind in ('screenplay', 'treatment', 'bible', 'breakdown', 'document'));

commit;

-- ── VERIFY (run after apply) ────────────────────────────────────────────────
-- 1) select kind, count(*) from public.documents group by kind;
--      expect: screenplay = 1 and nothing else.
-- 2) select column_default from information_schema.columns
--      where table_schema='public' and table_name='documents'
--        and column_name='kind';
--      expect: 'document'::text
-- 3) A write of the retired value must fail:
--      insert into public.documents (kind, title) values ('script', 'x');
--      expect: 23514 (documents_kind_check). Do not commit it.
