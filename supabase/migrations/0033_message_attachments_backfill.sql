-- ============================================================================
-- 0033_message_attachments_backfill.sql — Batch 14 item 4: the string becomes
-- a foreign key. (S3-core migration 7.)
--
-- Governing: S3-core §1.5, S3-core-A A-9 (the sizing: 11 messages carry an
-- attachment, formats r2:: ×8 and client-uploads:: ×3, ALL ELEVEN resolve to
-- a files row by exact file_path match). Runs after 0032. Forward-only,
-- idempotent (I-12).
--
-- ── EXPECTATION: 11 in, 11 out ──────────────────────────────────────────────
-- Any attachment_url that fails to resolve is a STOP, not a guess — the
-- verify query below must return 0 unresolved. Deleted messages whose refs
-- were nulled by the pre-A-2 delete route are correctly absent from both
-- sides of the join.
--
-- Re-runnable: ON CONFLICT DO NOTHING against the (message_id, seq) pk.
-- ============================================================================

insert into public.message_attachments (message_id, file_id, seq)
select m.id, f.id, 1
  from public.messages m
  join public.files f
    on f.file_path = substring(m.attachment_url from position('::' in m.attachment_url) + 2)
 where m.attachment_url like '%::%'
on conflict (message_id, seq) do nothing;

-- ── VERIFY (run after apply) ────────────────────────────────────────────────
-- 1) 11 in, 11 out (re-run the "in" count at apply time — the system is live):
--      select count(*) from public.messages where attachment_url like '%::%';
--      select count(*) from public.message_attachments;
-- 2) Zero unresolved refs:
--      select count(*) from public.messages m                      -- expect 0
--       where m.attachment_url like '%::%'
--         and not exists (select 1 from public.message_attachments a
--                          where a.message_id = m.id);
-- 3) Every FK row's file shares the message's tenant:
--      select count(*) from public.message_attachments a           -- expect 0
--        join public.messages m on m.id = a.message_id
--        join public.files f on f.id = a.file_id
--       where f.organization_id is distinct from m.organization_id;
