-- ============================================================================
-- 0030_messages_room_constraints.sql — Batch 13 item 6: the room becomes the
-- key. NOT NULL, the thread rules, the re-scoped RLS, the keyset index, and
-- A-4's cascade defusal.
--
-- Governing: S3-core §1.3 (thread rule, tag inheritance), §1.6 (RLS) as
-- amended by S3-core-A A-4 (project FK → SET NULL, in THIS migration), A-5
-- (call member_history_from(), never restate the cutoff), §1.7 (indexes).
-- Runs after 0029. Forward-only, idempotent (I-12).
--
-- ── DEPLOY ORDER ────────────────────────────────────────────────────────────
-- CONSTRAINING + POLICY CHANGE. Apply only after 0029 is verified (V1 = 0).
-- No code change pairs with this file — application reads run on the service
-- role and are unaffected; what changes is what an AUTHENTICATED session
-- (i.e. Realtime) can see. Reload the PostgREST schema cache after applying.
-- A-8: after apply, click-test both filtered subscriptions
-- (ProjectDetail.tsx:225, AdminProjectDetail.tsx:246) — a too-strict policy
-- stops replication silently, and only a live browser proves it didn't.
--
-- ── THE PREDICATE IS STRICTER, NOT LOOSER ───────────────────────────────────
-- A scoped client teammate was filtered by the project on the QUERY; now RLS
-- filters them, and untagged messages are handled explicitly (visible to the
-- whole room) rather than by accident. Fewer readable rows for the scoped
-- persona than before is the fix working, not a regression.
-- ============================================================================

-- ── 1. room_id NOT NULL — verified in-migration, failing loudly ────────────
do $$
declare n int;
begin
  select count(*) into n from public.messages where room_id is null;
  if n > 0 then
    raise exception
      '0030 refused: % messages have null room_id. Apply 0029 (and deploy the Batch 13.5 send path) first.', n;
  end if;
end $$;

alter table public.messages alter column room_id set not null;

-- ── 2 + 3. Thread rules, in the database because RLS depends on the tag ────
-- §1.3 says "a CHECK that the parent's thread_root_id is null" — a CHECK
-- constraint cannot read another row, so the same rule is enforced here as a
-- BEFORE trigger: same semantics, different mechanism, stated rather than
-- silently substituted. The trigger also OVERWRITES the reply's project_id
-- with its root's (tag inheritance): a reply the caller tags differently
-- from its root would otherwise dodge the per-project RLS scoping.
create or replace function public.enforce_message_thread_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare root record;
begin
  if new.thread_root_id is null then
    return new; -- a root message; no thread rules apply
  end if;
  if new.thread_root_id = new.id then
    raise exception 'a message cannot be its own thread root';
  end if;
  select id, thread_root_id, project_id, room_id
    into root
    from public.messages
   where id = new.thread_root_id;
  if root.id is null then
    raise exception 'thread root % does not exist', new.thread_root_id;
  end if;
  if root.thread_root_id is not null then
    raise exception 'a reply must point at a thread ROOT; % is itself a reply', new.thread_root_id;
  end if;
  if root.room_id is distinct from new.room_id then
    raise exception 'a reply must live in its root''s room';
  end if;
  new.project_id := root.project_id; -- tag inheritance (§1.3)
  return new;
end;
$$;

drop trigger if exists messages_thread_rules on public.messages;
create trigger messages_thread_rules
  before insert or update of thread_root_id, project_id, room_id
  on public.messages
  for each row
  when (new.thread_root_id is not null)
  execute function public.enforce_message_thread_rules();

-- ── 4. A-4: defuse the cascade in the same migration that changes the role ─
-- ON DELETE CASCADE was correct while project_id was the room key; as a tag
-- it would delete a company's conversation when a project is deleted, while
-- the room survives. A deleted project now leaves its messages untagged.
-- (Company deletion still removes messages — clients → message_rooms →
-- messages, the cascade chain stated in 0027/0028.)
alter table public.messages drop constraint if exists messages_project_id_fkey;
alter table public.messages add constraint messages_project_id_fkey
  foreign key (project_id) references public.projects(id) on delete set null;

-- ── 5. RLS re-scoped to the room (§1.6, A-5) ───────────────────────────────
-- Crew: unchanged in shape from 0021 — org match, roster membership, project
-- scoping where scoped, untagged visible. Re-stated so this file is the
-- complete record of the policies on this table.
drop policy if exists messages_crew_all on public.messages;
create policy messages_crew_all on public.messages
  for all to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
  );

-- Client read: member of the ROOM's company, AND the tag is absent or
-- visible to them, AND after their history cutoff. member_history_from() is
-- the one definition of the cutoff (A-5); deleted_at is deliberately NOT
-- here — §4.1's sweep (migration 10) owns that predicate, and adding it now
-- would silently stop the delete-tombstone UPDATE event from replicating.
drop policy if exists messages_client_read on public.messages;
create policy messages_client_read on public.messages
  for select to authenticated
  using (
    exists (
      select 1 from public.message_rooms r
       where r.id = messages.room_id
         and r.kind = 'client'
         and r.deleted_at is null
         and public.is_client_member(r.client_id)
    )
    and (project_id is null or public.client_project_visible(project_id))
    and created_at >= coalesce((select public.member_history_from()), '-infinity'::timestamptz)
  );

drop policy if exists messages_client_insert on public.messages;
create policy messages_client_insert on public.messages
  for insert to authenticated
  with check (
    exists (
      select 1 from public.message_rooms r
       where r.id = room_id
         and r.kind = 'client'
         and r.deleted_at is null
         and public.is_client_member(r.client_id)
    )
    and (project_id is null or public.client_project_visible(project_id))
  );

-- ── 6. Indexes (§1.7) ───────────────────────────────────────────────────────
-- The keyset index I-1's first paginated surface will use. The QUERIES do not
-- exist yet — the index landing here does not upgrade I-1's status.
create index if not exists messages_room_keyset_idx
  on public.messages (room_id, created_at desc, id desc);

create index if not exists messages_thread_idx
  on public.messages (thread_root_id, created_at)
  where thread_root_id is not null;

-- §1.7's (project_id) WHERE NOT NULL is deliberately skipped:
-- idx_messages_project_id (full, from the baseline) already serves the tag
-- lookups, and a partial twin of it would be pure duplication.

-- ── VERIFY (run after apply) ────────────────────────────────────────────────
-- 1) NOT NULL took:
--      select is_nullable from information_schema.columns
--       where table_schema='public' and table_name='messages' and column_name='room_id';
--      -- expect 'NO'
-- 2) The FK is SET NULL:
--      select pg_get_constraintdef(oid) from pg_constraint
--       where conname = 'messages_project_id_fkey';   -- expect ON DELETE SET NULL
-- 3) Trigger exists:
--      select tgname from pg_trigger
--       where tgrelid = 'public.messages'::regclass and tgname = 'messages_thread_rules';
-- 4) Three policies, exactly:
--      select policyname from pg_policies
--       where schemaname='public' and tablename='messages' order by 1;
-- 5) Reload the schema cache:  notify pgrst, 'reload schema';
-- 6) A-8 click-test: send a message in a project thread from each side and
--    watch it arrive live on the other — both hubs, no refresh.
