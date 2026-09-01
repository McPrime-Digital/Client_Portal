-- ============================================================================
-- 0027_message_rooms.sql — Batch 13 item 1: the room the message model moves
-- into. (The batch brief was titled "Batch 10"; the repo already has one — the
-- email batch. This series is Batch 13.)
--
-- Governing: S3-core §1.2 (table), §1.6 (Class B RLS), S3-core-A A-9 (the
-- verified starting state), S2 §4 (policy classes), S1 T-5 (org stamped from
-- the session, never a DEFAULT). Runs after 0026. Forward-only, idempotent
-- (I-12).
--
-- ── SHAPE ───────────────────────────────────────────────────────────────────
-- One row per conversation surface. kind='client' rooms belong to a client
-- company (client_id required); kind='crew' rooms are org-internal
-- (client_id must be null). The partial unique index makes "one live room per
-- company" a database fact rather than a code convention — the item-3 helper
-- leans on it for idempotent get-or-create instead of check-then-insert.
--
-- ── DEPLOY ORDER ────────────────────────────────────────────────────────────
-- ADDITIVE. Nothing deployed reads or writes this table until Batch 13 item 5
-- ships, so this file may be applied at any time after 0026. The operator
-- backlog is now: 0025 → 0026 (each per its own header) → 0027 → 0028 →
-- deploy item-5 code → 0029 → verify counts → stop (per the batch brief).
-- ============================================================================

create table if not exists public.message_rooms (
  id              uuid primary key default gen_random_uuid(),

  -- T-5: NO DEFAULT here, deliberately. Every writer stamps the org it
  -- resolved from the session (or, in the 0029 backfill, from the client
  -- row). A DEFAULT is how two rows came to disagree about their tenant in
  -- the Batch 8 finding.
  organization_id uuid not null references public.organizations(id),

  kind            text not null,
  -- ON DELETE CASCADE: delete-client hard-deletes the company's rows
  -- (Batch 12.2), and the company's rooms go with it. Once S3-core
  -- migration 4 turns messages.project_id into ON DELETE SET NULL (A-4),
  -- this cascade — via messages.room_id (0028) — becomes the path that
  -- removes a deleted company's messages, preserving today's semantics.
  client_id       uuid references public.clients(id) on delete cascade,
  -- Crew rooms are named ("General" until channels ship); client rooms take
  -- the company name AT RENDER TIME from the clients row — a copied name
  -- here would be the same stale-denormalisation defect as sender_role
  -- (S3-core-A A-6), so client rooms leave this null.
  name            text,
  created_by      uuid references auth.users(id) on delete set null, -- AD-003
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz, -- S3-core §4.1

  constraint message_rooms_kind_check check (kind in ('client', 'crew')),
  -- §1.2: client_id is required exactly when the room is a client room.
  constraint message_rooms_kind_subject_check check (
    (kind = 'client' and client_id is not null)
    or (kind = 'crew' and client_id is null)
  )
);

-- One LIVE room per company per org (§1.2). Soft-deleted rooms fall out of
-- the index, so a company whose room was deleted can get a fresh one.
create unique index if not exists message_rooms_one_live_client_room
  on public.message_rooms (organization_id, client_id)
  where kind = 'client' and deleted_at is null;

-- §9.1: "build for many, ship one." The TABLE allows many crew rooms (name
-- exists); this index is the "ship one" — it makes the item-3 helper's crew
-- get-or-create race-free the same way the client index does. When channels
-- ship, dropping this index is the whole migration.
create unique index if not exists message_rooms_one_live_crew_room
  on public.message_rooms (organization_id)
  where kind = 'crew' and deleted_at is null;

-- ── RLS — Class B (S2 §4, in the 0021 house style: org match + wrapped
--    subselect helpers so the planner runs them once per statement) ─────────

alter table public.message_rooms enable row level security;

-- Crew: full management of their own org's rooms, deleted included — the
-- studio is the side that restores. The §4.1 deleted_at sweep (S3-core
-- migration 10) revisits every SELECT policy; crew's restore visibility is
-- decided THERE, not silently here.
drop policy if exists message_rooms_crew_all on public.message_rooms;
create policy message_rooms_crew_all on public.message_rooms
  for all to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
  );

-- Client: read their own company's live room. No INSERT/UPDATE/DELETE —
-- rooms are created server-side (item 3's helper) and managed by the studio.
-- deleted_at is in the predicate from birth: a client must never see a
-- deleted room, and there is no client-side restore concept for it to hide.
drop policy if exists message_rooms_client_read on public.message_rooms;
create policy message_rooms_client_read on public.message_rooms
  for select to authenticated
  using (
    kind = 'client'
    and client_id is not null
    and public.is_client_member(client_id)
    and deleted_at is null
  );

-- ── VERIFY (run after apply) ────────────────────────────────────────────────
-- 1) Table exists and is empty:
--      select count(*) from public.message_rooms;            -- expect 0
-- 2) RLS is on and both policies exist:
--      select policyname from pg_policies
--       where schemaname = 'public' and tablename = 'message_rooms';
--      -- expect message_rooms_crew_all, message_rooms_client_read
-- 3) The partial unique indexes exist:
--      select indexname from pg_indexes
--       where schemaname = 'public' and tablename = 'message_rooms';
