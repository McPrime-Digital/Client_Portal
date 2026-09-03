-- ============================================================================
-- 0046_membership_rls_flip.sql — S3-d migration 5: THE FLIP. Access to a
-- conversation stops being derived from tenant identity and becomes a
-- question the room_members table answers (MD-1).
--
-- Governing: S3-d §5 (this is §5.2 verbatim, plus one recorded deviation),
-- §8 step 5. Runs after 0045, and only after the 0044 backfill VERIFIED
-- (20/20, zero parity gaps) — the backfill is what makes this a change of
-- authority rather than a change of access (assertion 29).
--
-- ── THE SINGLE RISKIEST CHANGE IN THE BATCH (S3-d §5.2) ─────────────────────
-- The failure mode of a wrong predicate here is silent over-sharing, not an
-- error. Harness assertions 22–29 were written and run BEFORE this applied;
-- the full suite must be green immediately after.
--
-- ── ONE RECORDED DEVIATION FROM §5.2 ────────────────────────────────────────
-- §5.2 says the project_id scope check disappears from the message policies.
-- It does not: assertion 29 ("no user can read what they could not") is the
-- migration's stated gate, and one live crew member is scope_mode='selected'
-- TODAY — dropping the conjunct would widen their access to every sibling
-- project's tagged messages inside rooms they must keep for their in-scope
-- work. Membership answers "which rooms"; the visibility conjunct answers
-- "which tags", exactly as before. When project traffic moves into project
-- CHANNELS, the conjunct becomes vacuous and a later migration may drop it —
-- deliberately, with 13 and 10 re-run, not as a side effect here.
-- Consequence, also recorded: a pure collaborator (MD-4 — no roster) reads
-- and writes only UNTAGGED messages in their rooms; tags belong to the
-- client-room model they are not part of.
--
-- ── WHAT DISAPPEARS ─────────────────────────────────────────────────────────
-- current_org(), is_org_member(), is_client_member() and kind leave the
-- message policies entirely (MD-3). messages_crew_all's user-session UPDATE/
-- DELETE breadth goes with it: every app write is a server-side route, and a
-- crew session editing a colleague's message by direct PostgREST call was
-- never a feature. Sender-owned UPDATE survives for the sender.
--
-- The approval-comment RESTRICTIVE gate (0038) is UNTOUCHED: it narrows
-- whatever INSERT policies exist, which is exactly why it was built as
-- RESTRICTIVE (a second write path is a second thing to get wrong — MD-5).
-- ============================================================================

begin;

-- ── 1. messages ─────────────────────────────────────────────────────────────

drop policy if exists messages_crew_all on public.messages;
drop policy if exists messages_client_read on public.messages;
drop policy if exists messages_client_insert on public.messages;

drop policy if exists messages_member_read on public.messages;
create policy messages_member_read on public.messages
  for select to authenticated
  using (
    (select public.is_room_member(room_id))
    and created_at >= coalesce((select public.room_history_from(room_id)), '-infinity'::timestamptz)
    -- the recorded deviation: tag visibility, both doors, exactly as 0030
    and (project_id is null
         or public.org_project_visible(project_id)
         or public.client_project_visible(project_id))
    -- a soft-deleted room's log is closed to sessions; restore is server-side
    and exists (select 1 from public.message_rooms r
                 where r.id = messages.room_id and r.deleted_at is null)
  );

drop policy if exists messages_member_insert on public.messages;
create policy messages_member_insert on public.messages
  for insert to authenticated
  with check (
    (select public.is_room_member(room_id))
    and (select public.room_can_post(room_id))          -- MD-5
    and sender_id = (select auth.uid())                 -- I-6: no forged voice
    and organization_id = (select r.organization_id from public.message_rooms r
                            where r.id = room_id)       -- T-5 under membership
    and (project_id is null
         or public.org_project_visible(project_id)
         or public.client_project_visible(project_id))
    and exists (select 1 from public.message_rooms r
                 where r.id = messages.room_id and r.deleted_at is null
                   and r.archived_at is null)           -- archived: read-only
  );

-- The sender may edit their own message; nobody else's, and never leave the
-- room predicate. (Soft delete is an UPDATE of deleted_at through the server
-- routes; this policy also covers a future user-client edit surface.)
drop policy if exists messages_sender_update on public.messages;
create policy messages_sender_update on public.messages
  for update to authenticated
  using (
    sender_id = (select auth.uid())
    and (select public.is_room_member(room_id))
  )
  with check (
    sender_id = (select auth.uid())
    and (select public.is_room_member(room_id))
  );

-- ── 2. message_rooms — membership reads; kind never decides (MD-3) ──────────

drop policy if exists message_rooms_crew_all on public.message_rooms;
drop policy if exists message_rooms_client_read on public.message_rooms;

-- Members see their rooms. Crew additionally DISCOVER public rooms of their
-- own org (is_private=false — the browsable channel directory). That clause
-- is org-derived by design: discovery is a tenant question; access to the
-- MESSAGES stays membership-only.
drop policy if exists message_rooms_member_read on public.message_rooms;
create policy message_rooms_member_read on public.message_rooms
  for select to authenticated
  using (
    deleted_at is null
    and (
      (select public.is_room_member(id))
      -- The creator reads a room they created even before their first-seat
      -- membership row lands. Without this the room_members bootstrap policy
      -- below could never see the room it checks (its subquery runs under
      -- the CALLER's RLS) and no user-created room could gain a manager.
      or created_by = (select auth.uid())
      or (
        is_private = false
        and organization_id = (select public.current_org())
        and (select public.is_org_member())
      )
    )
  );

-- Crew create the new kinds. client/crew rooms stay server-minted
-- (lib/messageRooms via service role), so they are deliberately absent here.
drop policy if exists message_rooms_crew_insert on public.message_rooms;
create policy message_rooms_crew_insert on public.message_rooms
  for insert to authenticated
  with check (
    kind in ('channel', 'group', 'dm', 'broadcast')
    and organization_id = (select public.current_org())
    and (select public.is_org_member())
    and created_by = (select auth.uid())
  );

-- The one client-side creation right (owner decision, 2026-09-03): a client
-- company's owner or approver may open a DM. WHO the counterparty may be
-- (org owner/approver only) is enforced by the create route, which owns
-- seating; this policy owns tenancy and kind.
drop policy if exists message_rooms_client_dm_insert on public.message_rooms;
create policy message_rooms_client_dm_insert on public.message_rooms
  for insert to authenticated
  with check (
    kind = 'dm'
    and organization_id = (select public.current_org())
    and created_by = (select auth.uid())
    and exists (
      select 1 from public.client_members cm
       where cm.user_id = (select auth.uid())
         and cm.status = 'active'
         and cm.organization_id = public.message_rooms.organization_id
         and cm.role in ('owner', 'approver')
    )
  );

-- Room managers update their room (name, topic, privacy, archive). Org
-- owner/admin may additionally manage PUBLIC rooms of their org — private
-- rooms are private from the org too (Slack's model; the DM leak this
-- prevents is "who is talking to whom").
drop policy if exists message_rooms_manager_update on public.message_rooms;
create policy message_rooms_manager_update on public.message_rooms
  for update to authenticated
  using (
    (select public.is_room_manager(id))
    or (is_private = false
        and organization_id = (select public.current_org())
        and (select public.is_org_admin()))
  )
  with check (
    (select public.is_room_manager(id))
    or (is_private = false
        and organization_id = (select public.current_org())
        and (select public.is_org_admin()))
  );

-- ── 3. room_members — the write policies 0043 deferred ──────────────────────

-- Managers seat people. Crew self-join PUBLIC rooms of their org. The
-- creator seats THEMSELF as owner of a room they just created — the
-- first-seat bootstrap, without which no user-created room could ever gain
-- its first manager.
drop policy if exists room_members_insert on public.room_members;
create policy room_members_insert on public.room_members
  for insert to authenticated
  with check (
    (select public.is_room_manager(room_id))
    or (
      user_id = (select auth.uid())
      and role = 'owner'
      and exists (select 1 from public.message_rooms r
                   where r.id = room_id
                     and r.created_by = (select auth.uid())
                     and r.deleted_at is null)
    )
    or (
      user_id = (select auth.uid())
      and role = 'member'
      and (select public.is_org_member())
      and exists (select 1 from public.message_rooms r
                   where r.id = room_id
                     and r.is_private = false
                     and r.deleted_at is null
                     and r.archived_at is null
                     and r.organization_id = (select public.current_org()))
    )
  );

drop policy if exists room_members_manager_update on public.room_members;
create policy room_members_manager_update on public.room_members
  for update to authenticated
  using ((select public.is_room_manager(room_id)))
  with check ((select public.is_room_manager(room_id)));

commit;

-- ── VERIFY (run after apply) ────────────────────────────────────────────────
-- 1) select policyname, cmd from pg_policies where tablename='messages';
--    -- expect: messages_member_read SELECT · messages_member_insert INSERT ·
--    --         messages_sender_update UPDATE · messages_approval_comment_gate INSERT
-- 2) select policyname from pg_policies where tablename='message_rooms';
--    -- expect: member_read, crew_insert, client_dm_insert, manager_update
-- 3) select policyname from pg_policies where tablename='room_members';
--    -- expect: member_read, self_update, insert, manager_update
-- 4) npm run test:rls — the FULL suite, 29 assertions, green. Assertion 29 is
--    this migration's gate; a single FAIL here is a rollback, not a note.
