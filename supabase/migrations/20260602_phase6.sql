-- Batch 6: per-user notification dismissal for the realtime bell.
-- Idempotent — safe to run once or many times.
-- Paste into Supabase → SQL Editor → Run.

-- ── notifications: dismiss (close) from the bell without losing the audit ──
-- "Dismiss" (the X on a bell row) sets dismissed_at so the row drops out of the
-- bell stream. The underlying action stays recorded in activity_log, so nothing
-- leaves the audit trail — only the bell entry is cleared. This is distinct from
-- read_at ("mark read"), which keeps the row in the bell, just de-highlighted.
alter table public.notifications add column if not exists dismissed_at timestamptz;

-- Speeds the bell's "unread, not dismissed, newest first" query per recipient.
create index if not exists notifications_client_active_idx
  on public.notifications (client_id, created_at desc)
  where dismissed_at is null;

create index if not exists notifications_admin_active_idx
  on public.notifications (for_admin, created_at desc)
  where dismissed_at is null;
