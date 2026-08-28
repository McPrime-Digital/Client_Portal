# _archive — the retired `2026*` migration series

**Status: NOT APPLIED as files. Never apply anything in this directory.**

## What this series was

Thirteen hand-applied migrations from the portal's first build-out
(2026-05-31 → 2026-06-06): phases 2–12 of the original feature plan, the
invoicing schema, and a phase re-seed script. Everything they created that
survived is **already baked into `0000_baseline_schema.sql`**, which was
captured from the live database after this series had been applied and
selectively corrected. The `00NN` series is the sole source of truth.

## Why these files are retained rather than deleted

`0000` was hand-captured, not generated. These files are the only record of
where parts of it came from — the original DDL, the comments explaining why
columns exist, the seed data. Deleting them would erase the provenance of the
baseline. They are documents now, not migrations.

## Why they were moved out of `migrations/`

Lexicographic ordering. `0000…0023` sorts **before** `2026…`, so any
filename-ordered migration runner pointed at `supabase/migrations/` would
apply this retired series **last** — on top of the corrected baseline.
That is not merely wasteful; two of these files would reintroduce closed
security holes and one would destroy data:

- **`20260603_phase7.sql:44-52`** and **`20260604_phase8.sql:69-75`** create
  RLS policies that read the caller's role from **`user_metadata` first** —
  which the end user can edit via `supabase.auth.updateUser({ data })`.
  Re-applying them reintroduces the privilege-escalation hole that `0000` was
  captured specifically to close (role/identity live in `app_metadata` only;
  see `lib/auth/role.ts`).
- **`20260531_reseed_phases.sql`** **deletes every project's phases** and
  re-seeds them. Running it against production destroys live phase data.

Production was read before the move (Batch 6, 2026-08-28): the
`user_metadata`-keyed policies are **not** present in the live database. The
hazard was entirely about a future runner, and this directory is the fence.

## Rules

1. Nothing in `_archive/` is ever applied, by hand or by tooling.
2. Any migration runner adopted later (S6 owns the choice) must point at
   `supabase/migrations/` **non-recursively**, or explicitly exclude
   `_archive/`. There is no runner in the repo today; migrations are applied
   by hand in the Supabase SQL editor, in `00NN` filename order.
3. Do not "reinstate" a file from here to recover a feature — whatever it
   built already exists in `0000` in corrected form. If something seems
   missing, the gap is in the `00NN` series and gets a new forward migration.
