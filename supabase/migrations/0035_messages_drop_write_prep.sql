-- ─────────────────────────────────────────────────────────────────────────────
-- 0035 — prepare messages for the migration-12 drops (Batch 21 item 3).
--
-- Two things, both required BEFORE the code stops writing the legacy
-- columns, neither in the brief:
--
-- 1) `sender_role` is NOT NULL with NO DEFAULT (live probe 2026-09-02).
--    The brief's plan — stop writing it, deploy, drop later — would have
--    23502'd EVERY send in the window between the deploy and the drop.
--    Relaxing nullability first makes the stop-write survivable; the CHECK
--    passes NULL and needs no change (it drops with the column in 0037).
--
-- 2) Side attribution is about to move from the column to the roster
--    (sender_id → organization_members / client_members). 16 of 250 live
--    rows have sender_id NULL; for those the column is the ONLY record of
--    which side spoke, and the drop destroys it. While the column still
--    exists to verify against, recover sender_id where the persisted
--    sender_name names exactly ONE roster member of the recorded side in
--    that room. Ambiguous or unmatched rows stay null and will derive as
--    studio-voiced — correct for system messages, which is what the
--    remainder is.
--
-- Safe against the running deploy (relaxation + data repair only): apply
-- immediately; no code ordering constraint.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

with candidates as (
  select m.id as message_id, r.user_id
    from public.messages m
    join public.message_rooms mr on mr.id = m.room_id
    join lateral (
      select cm.user_id, cm.name, 'client'::text as side
        from public.client_members cm
       where cm.client_id = mr.client_id and cm.user_id is not null
      union all
      select om.user_id, om.name, 'admin'::text as side
        from public.organization_members om
       where om.organization_id = mr.organization_id and om.user_id is not null
    ) r on r.name = m.sender_name and r.side = m.sender_role
   where m.sender_id is null
),
unambiguous as (
  select message_id, min(user_id::text)::uuid as user_id
    from candidates
   group by message_id
  having count(distinct user_id) = 1
)
update public.messages m
   set sender_id = u.user_id
  from unambiguous u
 where m.id = u.message_id;

alter table public.messages alter column sender_role drop not null;

commit;

-- ── VERIFY (run after apply) ────────────────────────────────────────────────
-- 1) select is_nullable from information_schema.columns
--      where table_schema='public' and table_name='messages'
--        and column_name='sender_role';
--      expect: YES
-- 2) select sender_role, sender_name, count(*) from public.messages
--      where sender_id is null group by 1, 2;
--      expect: only system-voiced studio rows remain (probe found 16 null
--      senders before: 14 harness + 2 real; the harness rows and the one
--      real client row should recover — remainder ≈ 1, name 'McPrime
--      Digital').
-- 3) The roster must still reproduce the column for every attributed row:
--      select count(*) from public.messages m
--       where m.sender_id is not null
--         and exists (select 1 from public.organization_members om
--                      where om.user_id = m.sender_id)
--         and m.sender_role <> 'admin';
--      expect: 0 (and the client-side mirror of it, also 0).
