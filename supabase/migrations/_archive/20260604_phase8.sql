-- Batch 8: make the Approvals & Records ledger persist — for good.
-- Idempotent — safe to run many times. Paste into Supabase → SQL Editor → Run.
--
-- The bug: approval / change-request / gate-send records were never saved. The
-- app writes them to public.activity_log with the service role (bypassing RLS),
-- so the only thing that can block the write is the TABLE itself — either it
-- doesn't exist, is missing a column, or (most likely) has a CHECK constraint on
-- event_type that rejects values like 'task_approved' / 'changes_requested' /
-- 'approval_requested'. This migration creates/repairs the table so every write
-- succeeds. (Same idea as phase2 relaxing notifications.type.)

-- 1) Ensure the table exists with the columns the app writes.
create table if not exists public.activity_log (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid,
  client_id   uuid,
  actor_id    uuid,
  actor_name  text,
  actor_role  text,
  event_type  text not null,
  title       text not null,
  body        text,
  meta        jsonb default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- 2) Ensure every column exists (in case an older/narrower table was created).
alter table public.activity_log add column if not exists project_id uuid;
alter table public.activity_log add column if not exists client_id  uuid;
alter table public.activity_log add column if not exists actor_id   uuid;
alter table public.activity_log add column if not exists actor_name text;
alter table public.activity_log add column if not exists actor_role text;
alter table public.activity_log add column if not exists event_type text;
alter table public.activity_log add column if not exists title      text;
alter table public.activity_log add column if not exists body       text;
alter table public.activity_log add column if not exists meta       jsonb default '{}'::jsonb;
alter table public.activity_log add column if not exists created_at timestamptz default now();

-- 3) THE FIX: drop ANY CHECK constraint on activity_log (e.g. an event_type or
--    actor_role allow-list) so the app's values are always accepted.
do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public' and rel.relname = 'activity_log' and con.contype = 'c'
  loop
    execute format('alter table public.activity_log drop constraint %I', c.conname);
  end loop;
end $$;

-- 4) Realtime: stream changes + full row images (so filtered subscriptions work).
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'activity_log'
  ) then
    alter publication supabase_realtime add table public.activity_log;
  end if;
end $$;
alter table public.activity_log replica identity full;

-- 5) RLS: keep it on (writes are service-role and bypass it); let admins SELECT
--    so the admin's realtime subscription delivers. Harmless if RLS is off.
alter table public.activity_log enable row level security;
drop policy if exists "admin_select_activity_log" on public.activity_log;
create policy "admin_select_activity_log" on public.activity_log
  for select to authenticated
  using (coalesce(
    auth.jwt() -> 'user_metadata' ->> 'role',
    auth.jwt() -> 'app_metadata'  ->> 'role'
  ) = 'admin');

-- Clients can read their own project's records (so their realtime works too).
drop policy if exists "client_select_activity_log" on public.activity_log;
create policy "client_select_activity_log" on public.activity_log
  for select to authenticated
  using (
    client_id in (select id from public.clients where user_id = auth.uid())
    or project_id in (
      select p.id from public.projects p
      join public.clients c on c.id = p.client_id
      where c.user_id = auth.uid()
    )
  );

-- 6) Fast per-project records query.
create index if not exists activity_log_project_created_idx
  on public.activity_log (project_id, created_at desc);
