-- 0034: per-user preferences that survive logout, refresh and DEVICE CHANGE.
--
-- Batch 20.3. The chat settings (wallpaper pattern + intensity, sound,
-- focus mode, mention trigger, sticky project tag) lived only in
-- localStorage — durable on one browser, gone on the next. This table is
-- the durable copy; localStorage stays as the zero-latency cache that the
-- app hydrates from the DB at mount and writes through on every change.
--
-- One row per auth user, one jsonb blob. Class C RLS: a user reads and
-- writes their own row and nothing else; no admin path exists or is
-- needed. The application accesses this table with the USER client only
-- (AD-001 — new surfaces do not touch supabaseAdmin).

create table if not exists public.user_prefs (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  chat       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_prefs enable row level security;

-- I-12: every create policy guarded by a drop.
drop policy if exists user_prefs_select_own on public.user_prefs;
create policy user_prefs_select_own on public.user_prefs
  for select using (user_id = auth.uid());

drop policy if exists user_prefs_insert_own on public.user_prefs;
create policy user_prefs_insert_own on public.user_prefs
  for insert with check (user_id = auth.uid());

drop policy if exists user_prefs_update_own on public.user_prefs;
create policy user_prefs_update_own on public.user_prefs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
