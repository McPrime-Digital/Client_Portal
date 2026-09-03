-- ============================================================================
-- 0049_person_avatars.sql — Batch 23: people get faces, and a collaborator
-- gets a name.
--
-- The owner's ask, verbatim: "member in the group should have a circular
-- bubble heads on their messages — display images if they have one." There
-- was no per-PERSON image anywhere: clients.avatar_url is the COMPANY logo.
-- The avatar belongs on the roster row (the same place the display name
-- lives), one column per tree — a person in both trees may present
-- differently to each, which is a feature, not drift.
--
-- room_members.display_name exists for the one kind of person with NO roster
-- row to carry a name: the MD-4 collaborator. Null for everyone else — the
-- roster stays the name authority for roster-holders (A-6's lesson: a copied
-- name is a stale name).
--
-- ADDITIVE and safe against the running deploy. Runs after 0048 in file
-- order but has no dependency on it — 0048 stays gated on deploy.
-- ============================================================================

alter table public.organization_members add column if not exists avatar_url text;
alter table public.client_members       add column if not exists avatar_url text;
alter table public.room_members         add column if not exists display_name text;
alter table public.room_members         add column if not exists avatar_url text;

-- VERIFY:
-- select count(*) from information_schema.columns
--  where (table_name, column_name) in (
--    ('organization_members','avatar_url'), ('client_members','avatar_url'),
--    ('room_members','display_name'), ('room_members','avatar_url'));
-- expect 4
