-- ═══════════════════════════════════════════════════════════════════════════
-- 0062 · usage_events.project_id — cost allocation to a production
-- Closes the gap 0061's sibling left open. Additive column + backfill + index.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── WHY THIS IS THE HIGHEST-VALUE COST WORK LEFT ───────────────────────────
--
-- A studio bills its clients. Spend it cannot attribute to a production is spend
-- it cannot re-bill — so "which job did this cost go to" is not a reporting
-- nicety, it is the difference between AI being a cost centre and being a line
-- on an invoice. Neither Frame.io nor Flow Production Tracking can answer it,
-- because neither meters the generative call at all.
--
-- ── A COLUMN, NOT A JSONB KEY, AND THAT IS THE SAME ARGUMENT AS 0061 ───────
--
-- 0061's whole finding was that the ACTOR was present but misplaced: the muse
-- route wrote it into `ref` as a JSONB key, where it cannot be indexed, grouped
-- or joined, while the schema already had a column for it. Putting the
-- production in `ref` now would repeat that mistake knowingly, one field over.
-- So it is a real column with a real FK.
--
-- ON DELETE SET NULL, matching AD-003's spirit: deleting a production must not
-- delete the record that money was spent. The row survives as unallocated spend,
-- which is true, rather than vanishing — a cost that disappears when a job is
-- archived is a cost nobody can reconcile.
--
-- ── THE BACKFILL IS ONLY WHAT THE DATA CAN PROVE ───────────────────────────
--
-- `storage.bytes` rows carry `file_id`, and `files` carry `project_id`, so
-- storage allocation is RECOVERABLE — the join exists and the answer is a fact,
-- not an inference. Backfilled here.
--
-- AI rows (`ai.text.tokens`, `primeos`) carry only model and user. There is no
-- production in them and none can be invented: a guess would attribute real
-- money to the wrong client's job, which is worse than leaving it unallocated.
-- They stay null, and the WRITER is fixed in the same commit so every future AI
-- call carries the production it was made for — a backfill without the writer is
-- a one-time repair that reads as a permanent one (§12 lesson 1).
--
-- I-12: forward-only, idempotent, no policy changes.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

alter table public.usage_events
  add column if not exists project_id uuid null references public.projects(id) on delete set null;

comment on column public.usage_events.project_id is
  'The production this spend belongs to, for chargeback. A COLUMN rather than a '
  'ref key for the reason 0061 records about created_by: a JSONB value cannot be '
  'indexed, grouped or joined. NULL means unallocated, which is an honest state — '
  'never guess a production, because a wrong one bills the wrong client.';

-- Storage: recoverable from the file the event already names.
update public.usage_events u
   set project_id = f.project_id
  from public.files f
 where u.project_id is null
   and u.ref ? 'file_id'
   and u.ref->>'file_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   and f.id = (u.ref->>'file_id')::uuid
   and f.project_id is not null
   -- Never cross a tenant boundary on a join through a blob.
   and f.organization_id = u.organization_id;

-- The chargeback query: spend by production over a window, per org.
create index if not exists usage_events_project_idx
  on public.usage_events (organization_id, project_id, created_at desc)
  where project_id is not null;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION
--
-- 1 · storage rows that name a file on a production are now allocated:
--     select kind, count(*) filter (where project_id is not null) as allocated,
--            count(*) as total from usage_events group by kind;
--
-- 2 · nothing crossed a tenant:
--     select count(*) from usage_events u join projects p on p.id = u.project_id
--      where p.organization_id <> u.organization_id;   → 0
--
-- 3 · AI rows remain unallocated until the writer fills them — by design.
-- ═══════════════════════════════════════════════════════════════════════════
