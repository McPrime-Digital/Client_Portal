-- ============================================================================
-- 0032_message_supporting_tables.sql — Batch 14 item 2: reactions, mentions,
-- pins, saves, room prefs, attachments. (S3-core migration 6.)
--
-- Governing: S3-core §1.5, §1.6. Runs after 0031. Forward-only, idempotent
-- (I-12).
--
-- ── THE RLS SHAPE, and why it is an EXISTS ──────────────────────────────────
-- Everything that hangs off a message inherits visibility FROM the message:
-- `exists (select 1 from messages m where m.id = message_id)` runs as the
-- querying user, so the room membership, the project-scope predicate and the
-- history_from cutoff all apply without being restated. A restatement is a
-- second definition that eventually disagrees with the first (A-5's point
-- about member_history_from(), one table out).
--
-- mentions and attachments have NO insert/update/delete policies at all:
-- they are written server-side only (I-6) — a body-parsed mention or a
-- tenant-checked file reference is not something a browser asserts.
--
-- ── DEPLOY ORDER ────────────────────────────────────────────────────────────
-- ADDITIVE. Apply before deploying Batch 14 item-3/4 code; reload the schema
-- cache after applying.
-- ============================================================================

-- ── reactions ───────────────────────────────────────────────────────────────
create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji),
  constraint message_reactions_emoji_len check (char_length(emoji) between 1 and 16)
);

alter table public.message_reactions enable row level security;

drop policy if exists message_reactions_read on public.message_reactions;
create policy message_reactions_read on public.message_reactions
  for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id));

drop policy if exists message_reactions_insert on public.message_reactions;
create policy message_reactions_insert on public.message_reactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.messages m where m.id = message_id)
  );

drop policy if exists message_reactions_delete on public.message_reactions;
create policy message_reactions_delete on public.message_reactions
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ── mentions (server-written only — I-6) ────────────────────────────────────
create table if not exists public.message_mentions (
  id         uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  kind       text not null,
  target_id  uuid not null,
  created_at timestamptz not null default now(),
  constraint message_mentions_kind_check
    check (kind in ('user', 'project', 'file', 'task', 'approval'))
);

create index if not exists message_mentions_target_idx
  on public.message_mentions (kind, target_id);
create index if not exists message_mentions_message_idx
  on public.message_mentions (message_id);

alter table public.message_mentions enable row level security;

drop policy if exists message_mentions_read on public.message_mentions;
create policy message_mentions_read on public.message_mentions
  for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id));
-- no write policies: the send path parses the body and writes these itself.

-- ── pins ────────────────────────────────────────────────────────────────────
create table if not exists public.message_pins (
  room_id    uuid not null references public.message_rooms(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  pinned_by  uuid references auth.users(id) on delete set null, -- AD-003
  pinned_at  timestamptz not null default now(),
  primary key (room_id, message_id)
);

alter table public.message_pins enable row level security;

drop policy if exists message_pins_read on public.message_pins;
create policy message_pins_read on public.message_pins
  for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id));

drop policy if exists message_pins_insert on public.message_pins;
create policy message_pins_insert on public.message_pins
  for insert to authenticated
  with check (
    pinned_by = (select auth.uid())
    and exists (select 1 from public.messages m where m.id = message_id)
  );

-- Anyone who can see the room's messages may unpin — Slack's model, and a
-- pin is room furniture, not the pinner's property.
drop policy if exists message_pins_delete on public.message_pins;
create policy message_pins_delete on public.message_pins
  for delete to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id));

-- ── saves (private per user) ────────────────────────────────────────────────
create table if not exists public.message_saves (
  user_id    uuid not null references auth.users(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  saved_at   timestamptz not null default now(),
  primary key (user_id, message_id)
);

alter table public.message_saves enable row level security;

drop policy if exists message_saves_self on public.message_saves;
create policy message_saves_self on public.message_saves
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.messages m where m.id = message_id)
  );

-- ── room notification prefs (absent row = 'all') ────────────────────────────
create table if not exists public.message_room_prefs (
  room_id    uuid not null references public.message_rooms(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  level      text not null default 'all',
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id),
  constraint message_room_prefs_level_check check (level in ('all', 'mentions', 'muted'))
);

alter table public.message_room_prefs enable row level security;

drop policy if exists message_room_prefs_self on public.message_room_prefs;
create policy message_room_prefs_self on public.message_room_prefs
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.message_rooms r where r.id = room_id)
  );

-- ── attachments (server-written only — I-6; replaces "bucket::path") ────────
create table if not exists public.message_attachments (
  message_id uuid not null references public.messages(id) on delete cascade,
  file_id    uuid not null references public.files(id) on delete cascade,
  seq        int  not null default 1,
  primary key (message_id, seq)
);

create index if not exists message_attachments_file_idx
  on public.message_attachments (file_id);

alter table public.message_attachments enable row level security;

drop policy if exists message_attachments_read on public.message_attachments;
create policy message_attachments_read on public.message_attachments
  for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id));
-- no write policies: the send path validates the file's tenant and writes.

-- ── VERIFY (run after apply) ────────────────────────────────────────────────
-- 1) Six tables, all with RLS on:
--      select tablename, rowsecurity from pg_tables
--       where schemaname='public' and tablename like 'message_%'
--       order by 1;
-- 2) Policy census:
--      select tablename, count(*) from pg_policies
--       where schemaname='public' and tablename in
--         ('message_reactions','message_mentions','message_pins',
--          'message_saves','message_room_prefs','message_attachments')
--       group by 1 order by 1;
--      -- expect: attachments 1, mentions 1, pins 3, reactions 3, prefs 1, saves 1
