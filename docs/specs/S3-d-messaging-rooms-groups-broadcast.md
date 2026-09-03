# Genreline — S3-d: Messaging — Rooms, Groups, Broadcast & Collaborators

**Status:** Draft for approval.
**Date:** 2026-09-03
**Depends on:** `S0`, `S1`, `S2`, `S-F`, `S3-core`, `S3-core-A`
**Supersedes:** `S3-core` §1.2 (the room table) and §9.1 ("build for many, ship one") where they disagree.
**Sequenced:** after Batch 22. This is migrations 0043 onward.

---

## 0. What this document is for, and what it is not

The messaging engine built across Batches 13–22 is architecturally sound and
its core decision is the one the industry converged on. What it cannot do is
express a **group of people** — and that is not missing UI, it is missing
schema.

This document is written against the LIVE database, not against the previous
specs. Every claim in §1 was verified by query on 2026-09-03.

---

## 1. The verified starting state

```
message_rooms   id, organization_id, kind, client_id, name,
                created_by, created_at, deleted_at
indexes         message_rooms_pkey
                message_rooms_one_live_client_room   (org, client) WHERE kind='client' AND deleted_at IS NULL
                message_rooms_one_live_crew_room     (org)          WHERE kind='crew'   AND deleted_at IS NULL
policies        message_rooms_crew_all    ALL     org match + is_org_member()
                message_rooms_client_read SELECT  kind='client' AND is_client_member(client_id)
live rows       7 client rooms · 1 crew room
```

Supporting tables, all keyed on the message: `message_attachments`,
`message_mentions`, `message_pins`, `message_reactions`, `message_read_state`,
`message_room_prefs`, `message_saves`.

`message_read_state` is **already** `(room_id, user_id, last_read_message_id,
last_read_at)` — per person, per room. It needs no change for groups. This is
worth stating because it is the part everyone assumes is missing.

### 1.1 The three things that block groups

1. **Two partial unique indexes make many-rooms impossible.** One live client
   room per company, one live crew room per org. A channel, a group or a DM
   cannot be inserted without dropping these.

2. **Access is DERIVED, not stored.** `is_client_member(room.client_id)` says
   "everyone in this company can read this room". There is no way to express
   *these six people and not the rest of the company* — which is what a group
   is. Membership is computed from identity rather than recorded.

3. **`kind` is entangled with `client_id`.** `message_rooms_kind_subject_check`
   requires `client_id` non-null exactly when `kind='client'`. Adding a kind
   means editing a constraint that encodes today's two cases as the only cases.

---

## 2. What the research changed

Two findings from how this problem has actually been solved at scale, and both
altered the design rather than confirming it.

**Slack encoded channel privacy in the channel ID prefix** — `C` for public,
`G` for private — and shared channels forced them to decouple it into an
explicit `is_private` flag, which then let three fragmented code paths
(channels, groups, DMs) collapse into one. `message_rooms.kind` tied to
`client_id` by CHECK is the same mistake one step earlier. **MD-3 below exists
because of this**: kind describes a room, it never determines who may read it.

**Their scaling failure was O(n) permission computation** — iterating users and
workspaces to decide access. Derived membership is exactly that shape. **MD-1
exists because of this**: membership must be a row you look up, not a set you
compute.

One finding confirmed the existing design and is recorded so nobody "improves"
it: **write once to the room's log and push to connected members**, rather than
writing a copy per recipient. Per-user inbox fan-out does not scale. Genreline
already does this. Do not change it.

One finding sets an expectation: **per-member read receipts are cheap in small
rooms and expensive in large ones.** Production systems go hybrid. §6 does.

---

## 3. The five decisions

**MD-1 — Membership is a ROW, never a derivation.** `room_members` becomes the
single authority on who may read a room. Company or crew membership becomes a
*seeding rule* — how rows get created — not the access rule itself. This is the
load-bearing change and everything else depends on it.

**MD-2 — One log per room. Never a copy per person.** A message is written once
and read by everyone entitled to the room. This is already true; it is stated
so that a future "unread inbox" feature is built as a cursor over the log
rather than as a second table of duplicated rows.

**MD-3 — `kind` is a description, not a permission.** A room's kind
(`client`, `crew`, `channel`, `group`, `dm`, `broadcast`) affects how it is
NAMED and PRESENTED. It must never appear in an access predicate. Access is
`room_members` and nothing else.

**MD-4 — A collaborator is a member with no roster.** External people —
freelancers, a client's agency, a composer — get a `room_members` row and
nothing else: no `client_members` row, no `organization_members` row. They see
that room and the people in it, and no other part of the tenant.
Profile visibility follows the rule Slack arrived at: **you can see someone iff
you share a room with them.**

**MD-5 — Broadcast is a MEMBERSHIP property, not a room type.**
`room_members.can_post` makes one-writer-many-readers a column rather than a
second policy shape. An announcements channel is a room where most members have
`can_post = false`. This keeps the INSERT policy singular, which matters
because a second write path is a second thing to get wrong.

---

## 4. Schema

### 4.1 `room_members` — the new authority

```
id             uuid pk
room_id        uuid not null → message_rooms(id) on delete cascade
user_id        uuid not null → auth.users(id) on delete cascade
role           text not null default 'member'
               check in ('owner','admin','member','viewer')
can_post       boolean not null default true    -- MD-5
joined_at      timestamptz not null default now()
added_by       uuid null → auth.users(id) on delete set null
left_at        timestamptz null                 -- soft, so history keeps its author
history_from   timestamptz null                 -- what they may read back to
notify         text not null default 'all' check in ('all','mentions','muted')
unique (room_id, user_id)
```

`history_from` moves here from `client_members`/`organization_members`.
Joining a room mid-project should not hand someone eight months of backlog, and
today that decision lives on the wrong table — it is per-person-per-tenant when
it needs to be per-person-per-room.

`notify` moves here from `message_room_prefs`, which becomes redundant.

Indexes: `(user_id) where left_at is null`, `(room_id) where left_at is null`.

### 4.2 `message_rooms` — additive

```
kind           gains 'channel','group','dm','broadcast'
topic          text null
is_private     boolean not null default true    -- explicit, per §2
archived_at    timestamptz null
last_message_at timestamptz null   -- denormalised for room-list ordering
```

`client_id` stays and keeps its meaning for `client` rooms — it is the
counterparty, the same role it plays on `approvals`. It is no longer consulted
for access.

**Both partial unique indexes are dropped.** They are replaced by:
`unique (organization_id, client_id) where kind='client' and deleted_at is null`
— kept, because exactly one primary room per client company is still correct —
and nothing for crew, because many crew rooms is the entire point.

### 4.3 A DM is a room

No separate table. A DM is `kind='dm'` with exactly two members. Slack's
consolidation is the precedent: one code path is worth more than a specialised
table.

---

## 5. Authorization — the rewrite

This is the dangerous part. A wrong predicate here leaks one company's
messages to another, which is why it gets its own section and its own
assertions.

### 5.1 The helper

```sql
create function public.is_room_member(rid uuid) returns boolean
  language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from room_members m
     where m.room_id = rid and m.user_id = auth.uid() and m.left_at is null
  )
$$;
```

One function, mirroring `is_client_member` / `is_org_member`. Every message
policy becomes a call to it.

### 5.2 The message policies

```
messages SELECT   is_room_member(room_id)
                  AND created_at >= coalesce(room_history_from(room_id), '-infinity')
messages INSERT   is_room_member(room_id) AND room_can_post(room_id)
                  AND the Batch 22 approval-comment RESTRICTIVE gate, unchanged
```

**What disappears:** `current_org()`, `is_org_member()`, `is_client_member()`
and the `project_id` scope check, from the message policies. Project scope
stops being a message-level predicate — a project channel is a ROOM, so scope
is expressed by not being a member.

**This is the single riskiest change in the batch.** It replaces a
tenant-derived predicate with a membership-derived one, and the failure mode is
silent over-sharing rather than an error. Hence §7.

### 5.3 The seeding rule

Membership rows are created, never inferred:

| Event | Rows created |
|---|---|
| A client company is created | every active `client_members` user → its client room |
| A person is invited to a company | that user → the company's client room |
| A crew member is activated | that user → the org's default crew room |
| A project channel is created | its crew scope + the client's members, per the creator |
| A collaborator is invited | one row, that room only |
| A person is removed from a roster | `left_at` stamped on their rows, never deleted |

The backfill (migration 2 below) writes these for every existing row. It must
be printed with a predicted count and verified against it — the 0029 pattern.

---

## 6. Read state and presence in a group

`message_read_state` is already `(room_id, user_id)` and needs no change.

**Receipts go hybrid, and the threshold is stated rather than discovered.**
Under 12 members, show per-person receipts. At or above, show a count. Reading
every member's watermark to render one tick is O(members) per message, and a
50-person channel makes it visible.

Presence (`lib/presenceView`, Batch 22) already carries WHICH view a person is
reading. In a group it becomes "3 reading", with names on hover.

**The watermark stays private.** Harness assertion 15 proves a member cannot
read a colleague's `message_read_state`, and the ORG OWNER cannot either. That
holds. A group makes the surveillance surface bigger, not smaller.

---

## 7. Harness additions — assertions 22–29

Non-negotiable, and written BEFORE the RLS flip, not after.

22. A non-member reads zero messages of a room. Control: a member reads them.
23. A collaborator reads their room and **zero rows of every other table in
    that tenant** — the MD-4 blast radius, and the assertion that makes
    "external" mean something.
24. A member with `can_post = false` cannot insert into that room. Control: a
    permitted member can. (MD-5.)
25. A person with `left_at` set reads nothing new, and their historical
    messages still render with their name. (AD-003 applied to rooms.)
26. `history_from` on a room member hides everything before it. Control: they
    read everything after.
27. A DM is readable by exactly its two members and by nobody else —
    specifically not by the org owner.
28. Two members of the same COMPANY in different groups read zero of each
    other's group. This is the assertion that proves membership replaced
    company identity; without it the whole batch could pass while access was
    still tenant-derived.
29. After the backfill, every user who could read a room BEFORE the flip can
    still read it, and no user can read one they could not. Run as a diff over
    all six personas, both directions.

Assertion 29 is the migration's real gate. 22–28 prove the new model; 29 proves
the transition did not change anyone's access by accident.

---

## 8. Migration sequence

Order matters, and each step is separately revertible.

1. **`room_members` + `is_room_member()`** — additive. Nothing reads it.
2. **Backfill** — every existing derivable membership, with a printed
   prediction verified against the result (7 client rooms + 1 crew room →
   expected row count stated before it runs).
3. **`message_rooms` additive columns** — `topic`, `is_private`, `archived_at`,
   `last_message_at`, widened `kind` CHECK.
4. **Harness 22–29 written and RED**, against the new tables, before any policy
   changes.
5. **Flip the message policies** onto `is_room_member`. Harness must go green,
   INCLUDING 29.
6. **Drop the crew-room unique index.** Many crew rooms become possible.
7. **Retire `message_room_prefs`** into `room_members.notify`.
8. UI: room list, create-channel, member management, DMs, broadcast.

Steps 1–3 are additive and safe against the running deploy. Step 5 is the one
that requires the deploy and the migration to land together, and it is the only
step in this document that can leak data if it is wrong.

---

## 9. What this does NOT include

Stated so the scope is a decision rather than an omission:

- **Cross-TENANT shared channels.** Slack's hardest problem. A collaborator
  (MD-4) is an external *person*; two studios sharing a room is a different
  and much larger question. Not v1.
- **Threads as channels.** The one-level-deep thread model (0030) stands.
- **Message editing history.** `edited_at` exists; a revision log does not, and
  is not required by anything asking for it.
- **Federation, retention per room, compliance export.** S3-core §4 and the
  retention batch own those.

---

## 10. Open

1. **Who may create a channel?** A new capability, or `manage_team`? Leaning
   toward a new one — creating a room that clients can see is closer to
   `manage_clients` than to team admin.
2. **Can a client company create a group?** MD-1 makes it expressible. S1 §0
   says the portal is a parallel tree, not a subset, so the answer is probably
   yes for their own people — but it is a product decision, not a schema one.
3. **Does a DM survive a person leaving the org?** AD-003 says their work
   survives them. A two-person DM where one is gone is a room with one member;
   that is coherent, but somebody should say so deliberately.
4. **Room-list ordering at scale.** `last_message_at` is denormalised for it.
   Denormalised columns drift — this one needs a trigger, and that trigger
   needs to be in the migration that adds the column, not a later one.

---

*End of S3-d. Next: migration 0043 and harness assertions 22–29, in that order.*
