-- Batch 10: presence heartbeats + notification preferences.
-- Powers (a) "away vs in-app" detection for deferred alerts and (b) the
-- per-category / per-channel notification preferences in Settings.
-- Idempotent — safe to run multiple times. The app degrades gracefully if this
-- hasn't been applied yet (heartbeats + deferred alerts simply no-op, and the
-- admin notification-prefs save surfaces a "run phase10" message), so deploying
-- the code before this migration never breaks anything.

-- ── clients: last-seen heartbeat (PresencePulse beats every ~30s) ──────────
alter table public.clients
  add column if not exists last_seen_at timestamptz;

-- ── business_settings: admin presence + workspace notification prefs ───────
-- notification_prefs shape: { "<category>": { "push": bool, "sms": bool, "email": bool } }
-- categories: messages | tasks | files | status | invoices
alter table public.business_settings
  add column if not exists admin_last_seen_at timestamptz;
alter table public.business_settings
  add column if not exists notification_prefs jsonb default '{}'::jsonb;

-- Make sure PostgREST notices the new columns immediately (otherwise the first
-- reads/writes can fail with "Could not find the 'notification_prefs' column").
notify pgrst, 'reload schema';
