-- Batch 12: message nudge dedupe.
-- Marks when a "you have an unread message" nudge was sent for a message, so the
-- 5h-no-reply nudge (/api/cron/message-nudge) fires at most once per unanswered
-- batch. Idempotent.

alter table public.messages
  add column if not exists nudged_at timestamptz;

create index if not exists messages_unread_nudge_idx
  on public.messages (project_id, sender_role, created_at)
  where read_at is null and nudged_at is null;

notify pgrst, 'reload schema';
