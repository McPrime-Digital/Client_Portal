-- Batch 11: Web Push subscriptions (device notifications).
-- One row per browser/device endpoint. Writes go through the service role
-- (push/subscribe route + server senders), so RLS stays closed to clients.
-- Idempotent. The app degrades gracefully without this (push simply no-ops and
-- the subscribe route returns a "run phase11" message).

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  role        text not null default 'client',
  client_id   uuid,
  endpoint    text not null unique,
  subscription jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
create index if not exists push_subscriptions_role_idx on public.push_subscriptions (role);

alter table public.push_subscriptions enable row level security;
-- No client-facing policies: all access is via the service role.

notify pgrst, 'reload schema';
