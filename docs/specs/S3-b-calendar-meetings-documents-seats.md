# Genreline — S3-b: Schema for Calendar, Meetings, Documents & Seats

**Status:** Draft for approval.
**Date:** 2026-09-01
**Depends on:** `S0`, `S0-A`, `S0-B`, `S1`, `S2`, `S-F`, `S3-core`
**Supersedes:** nothing. Extends `S1` §5 and `S2` §4 with new tables, and alters `organization_members` and `org_budgets`.
**Scope:** the four shapes `S-F` §9 moved out of `S3-core` — the ones that exist because meetings, documents, calendar and per-member allocation entered v1.

**Ordering.** `S3-core` lands first. This document's §4 (seats and budgets) has no dependency on `S3-core` and can run in parallel if that helps sequencing. §1–§3 depend on `S3-core` §4 (retention) for their `deleted_at` columns, and §3 depends on `S3-core` §3 (file version stacking) because a signed PDF is a file version.

---

## 0. What these four shapes have in common

Each one is a v1 feature that had no schema when `S-V` §13 was written, because each was outside the cap. `S-F` §7.2 moved them in. The test from `S3-core` §0 still applies: build the feature without the shape and it gets rebuilt.

- **Calendar and bookings** — a meeting, an approval deadline and an invoice due date are the same kind of thing to a person looking at a week. Model them separately and you build three calendars.
- **Meetings** — the Review Session (`AD-006`) is v1.5 but it is a *mode* of a meeting, not a different object. Shape it now and the later work is a column, not a table.
- **Documents and signatures** — the signing record is the whole point. Get it wrong and every contract signed before the fix is legally weaker.
- **Seats and budgets** — `org_budgets` is per-organization. Per-member allocation is a new row, and it pairs with I-5's unbuilt per-call ceiling.

---

## 1. Calendar and bookings

### 1.1 The model

Two things that look similar and are not:

- **A calendar entry** is something that occupies time on someone's calendar. It may originate anywhere in the product.
- **A booking** is the result of someone choosing a slot from an availability rule.

Bookings produce calendar entries. Not everything on the calendar is a booking.

### 1.2 `calendar_entries`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `organization_id` | uuid not null | T-5 |
| `kind` | text not null | `meeting` \| `approval_deadline` \| `invoice_due` \| `shoot_day` \| `manual`. CHECK constrained |
| `source_kind` | text null | What produced it: `meeting`, `approval_stage`, `invoice`, `manual` |
| `source_id` | uuid null | Polymorphic, same trade-off as `S3-core` §2.2 |
| `project_id` | uuid null | FK projects |
| `client_id` | uuid null | FK clients. Set when the entry is client-visible |
| `title` | text not null | |
| `starts_at`, `ends_at` | timestamptz | `ends_at` nullable for milestones |
| `all_day` | boolean not null default false | |
| `created_by`, `created_at`, `deleted_at` | | ON DELETE SET NULL on the actor |

**Derived entries are not duplicated data.** An approval deadline and an invoice due date already exist on their own tables. The entry is a projection, written by the same server action that sets the deadline, and deleted when it is cleared. The alternative — computing the calendar by unioning four tables at read time — is a query that grows a join every time a feature is added, and `S0` §3 forbids unbounded shapes.

**`calendar_entry_attendees`** — `entry_id`, `user_id`, `response` (`needs_action`|`accepted`|`declined`|`tentative`). Attendance is per person, so the same entry appears correctly on several calendars.

### 1.3 `availability_rules`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `organization_id` | uuid not null | |
| `user_id` | uuid not null | Whose availability |
| `weekday` | int not null | 0–6 |
| `start_time`, `end_time` | time not null | In `timezone` |
| `timezone` | text not null | IANA name. **Stored per rule**, because a person who moves does not retroactively change past bookings |

### 1.4 `booking_types`

The Cal.com model from `S-F` §3.4, reduced to what v1 needs.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `organization_id` | uuid not null | |
| `owner_user_id` | uuid null | Null means a room-level booking type |
| `client_id` | uuid null | Set when bookable from a client portal |
| `slug` | text not null | Unique per org |
| `title`, `description` | text | |
| `duration_minutes` | int not null | |
| `buffer_before`, `buffer_after` | int not null default 0 | |
| `min_notice_minutes` | int not null default 0 | |
| `max_per_day` | int null | |
| `questions` | jsonb null | Booking questions, validated by zod at the boundary (I-7) |
| `active` | boolean not null default true | |
| `deleted_at` | timestamptz null | |

**Round-robin and collective types are v1.5** (`S-F` §7.3). The table carries no `mode` column now; adding one is additive.

### 1.5 `bookings`

`id`, `organization_id`, `booking_type_id`, `booked_by_user_id` (nullable — a client contact books as themselves), `client_id`, `starts_at`, `ends_at`, `status` (`confirmed`|`cancelled`|`rescheduled`), `answers` jsonb, `calendar_entry_id`, `meeting_id` (nullable), `created_at`, `deleted_at`.

**Double-booking is prevented in the database,** not in the application: an exclusion constraint on overlapping ranges per `owner_user_id` where `status='confirmed'`. Postgres has `EXCLUDE USING gist` with `tstzrange` for exactly this. Application-side checks lose the race; a constraint does not.

### 1.6 External calendar sync

Google, Outlook, Apple and CalDAV sync is what `S-F` §3.4's baseline expects. **The tokens are the schema question and it is answered now** even though the sync itself is a later batch: `calendar_connections` — `user_id`, `provider`, `external_account_id`, encrypted token reference, `sync_token`, `last_synced_at`, `status`.

**Tokens are not stored in plain columns.** They are third-party credentials and `S2` §4 Class D's reasoning about bank details applies with more force. Store a reference to a secret, or an encrypted value with the key outside the database. **Stop and decide this before writing the migration** — it is the one item in this document that should not be improvised.

### 1.7 RLS

`calendar_entries`, Class B: crew see their org's entries subject to project scoping; client members see entries where `client_id` matches their company and the project is visible to them.

`availability_rules`, `booking_types` owned by a user: readable by the org (you must see availability to book it), writable only by the owner or an org admin.

`bookings`: crew by org, client by `client_id`.

`calendar_connections`: **`user_id = auth.uid()` only, for every operation, including admins.** Nobody else reads a person's calendar credentials.

---

## 2. Meetings

### 2.1 `meetings`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `organization_id` | uuid not null | |
| `room_id` | uuid null | FK `message_rooms` — a meeting started from a chat room |
| `project_id`, `client_id` | uuid null | |
| `mode` | text not null | `call` \| `review_session`. **`review_session` is v1.5**; the column exists now so the later work is a value, not a migration |
| `provider` | text not null | `livekit` — recorded so the provider is data, not an assumption (`S-V` §10's reasoning applied to media) |
| `provider_room_name` | text not null | |
| `status` | text not null | `scheduled` \| `live` \| `ended` \| `cancelled` |
| `scheduled_for`, `started_at`, `ended_at` | timestamptz null | |
| `created_by`, `created_at`, `deleted_at` | | |

**`meeting_participants`** — `meeting_id`, `user_id`, `role` (`host`|`participant`|`observer`), `joined_at`, `left_at`, `duration_seconds`.

`duration_seconds` is the metering input. Meeting minutes are a consumable and go through the single write path (`recordUsage`) with kind `meeting.minutes`. Every participant-minute counts, which is how LiveKit bills and therefore how Genreline must measure. Recording it from day one is the same argument `S-V` §11 makes about AI tokens: usage cannot be backfilled.

### 2.2 Review Session, pre-shaped

`AD-006` needs synced playback: everyone on the same frame. That is a `meeting_sync_state` row — `meeting_id`, `file_id`, `frame`, `playing`, `updated_by`, `updated_at` — broadcast over Realtime, plus comments carrying a timecode.

**Not built in v1.** Specified here because `S-F` §3.4 requires the Meetings page to admit the session as a mode rather than a new page, and because the comment model in `S3-core` §1 must be able to carry a timecode without a schema change. Add `timecode_ms int null` to `messages` in this document's migration, unused until the session ships.

### 2.3 Tokens and access

LiveKit access tokens are minted server-side per participant, scoped to one room, short-lived. **No token is ever issued to a browser that has not passed the same RLS-backed check that would let it read the meeting row.** The token is the media-plane equivalent of a JWT claim, and `S2`'s rule holds: the claim routes, the roster decides.

---

## 3. Documents and signatures

`S-F` §3.5 is the feature. This is the record.

### 3.1 The naming problem, resolved

`documents` already exists and holds Script Design content. Contracts are a different thing. **They do not share a table.** The new tables are `contracts`, `contract_fields`, `contract_signers`, `contract_events`.

*(This is the same collision that made `S-F` §8 decision 1 confusing. Two products, two words, now two names.)*

### 3.2 `contracts`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `organization_id` | uuid not null | |
| `client_id`, `project_id` | uuid null | |
| `template_id` | uuid null | Self-FK; a template is a contract with `is_template` |
| `is_template` | boolean not null default false | |
| `title` | text not null | |
| `body` | jsonb null | BlockNote content for generated contracts |
| `source_file_id` | uuid null | FK files — an uploaded PDF instead of generated body |
| `status` | text not null | `draft` \| `sent` \| `viewed` \| `partially_signed` \| `completed` \| `declined` \| `voided` \| `expired` |
| `expires_at` | timestamptz null | |
| `final_file_id` | uuid null | FK files — the signed PDF |
| `certificate_file_id` | uuid null | FK files — the certificate of completion |
| `content_hash` | text null | SHA-256 of the exact bytes signed |
| `created_by`, `created_at`, `deleted_at` | | |

**Any document type is supported** (`S-F` §8 decision 1 as answered): generated from a template, or uploaded as a PDF. `source_file_id` is the second path.

### 3.3 `contract_fields`

`id`, `contract_id`, `signer_id`, `kind` (`signature`|`initials`|`date`|`text`|`checkbox`), `page`, `x`, `y`, `w`, `h`, `required`, `value` (text null), `filled_at`.

Positions are stored so the field renders identically on every device and in the final PDF.

### 3.4 `contract_signers`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `contract_id` | uuid not null | |
| `user_id` | uuid null | Null for a signer who is not a platform member |
| `email` | text not null | |
| `name` | text not null | |
| `seq` | int not null | Signing order |
| `status` | text not null | `pending` \| `sent` \| `viewed` \| `signed` \| `declined` |
| `verification` | text not null | `session` \| `sms_passcode` \| `email_link` |
| `signed_at` | timestamptz null | |
| `signature_image_file_id` | uuid null | |

### 3.5 `contract_events` — the legal record

`id`, `contract_id`, `signer_id` (nullable), `event` (`created`|`sent`|`opened`|`viewed`|`consented`|`field_filled`|`signed`|`declined`|`reminded`|`expired`|`voided`), `actor_name`, `ip_address` (inet), `user_agent` (text), `occurred_at`, `meta` (jsonb).

**Append-only. No UPDATE policy, no DELETE policy, for anyone, ever — including org owners.** This table is the certificate of completion. `S-F` §3.5's baseline is what a certificate must contain: signer identity, verified email, IP, timestamps for sent, viewed and completed, and a tamper-evident seal.

**IP address and user agent are personal data.** They are collected because an enforceable signature record requires them, retained for the contract's life, and covered by the tombstone in `S3-core` §4.3 for the name field — but the IP itself stays, because removing it destroys the record's evidentiary value. This tension is real and is recorded rather than resolved silently: the retention policy for signature records is a legal-review item (`S-F` §8 decision 2), not an architectural one.

### 3.6 Consent, ESIGN and UETA

The enforceability requirements are process, not product. The schema supports them:

- **Intent to sign** — the `signed` event with a timestamp.
- **Consent to transact electronically** — the `consented` event, recorded before any field can be filled. The consent text version is in `meta`.
- **Association with the record** — `content_hash`, computed over the exact bytes presented, so what was signed is provable.
- **Retention and reproduction** — `final_file_id` and `certificate_file_id`, both `files` rows, so they inherit the vault, metering and retention.

**Per `S-F` §8 decision 2, every contract carries wording advising legal review before signing,** shown in the signing flow and recorded in `meta` on the `consented` event. And the flow itself gets an attorney's review before the first real contract. Neither is a code question.

### 3.7 RLS

`contracts`: crew by org with project scoping; client members by `client_id`. A signer who is not a platform member reaches the document through a **single-use signing link**, not through RLS — that path is service-role, narrowly scoped to one contract id, and belongs on the I-8 allowlist with a written justification (`S2` §7).

`contract_events`: SELECT for anyone who can see the contract; INSERT server-side only; no UPDATE, no DELETE.

---

## 4. Seat class and per-member budgets

### 4.1 `organization_members.seat_class`

`text not null default 'crew'`, CHECK in (`crew`, `collaborator`). `S-F` §1.3.

**And it settles `HANDOFF` §11.2.** The scoping default splits by class: crew default `scope_mode='all'`, collaborators default `scope_mode='scoped'`. Written as a stated value on the row at invite time, never inferred — the `scope_mode` lesson from Batch B1.

Backfill: every existing member is `crew`.

### 4.2 Seat counting

Soft caps of 100 crew and 100 collaborators (`S-F` §1.3), counted separately, raisable per tenant like every cap in `S0` §4. Counting is a query, not a column — a stored count drifts.

### 4.3 `member_budgets`

| Column | Type | Notes |
|---|---|---|
| `organization_id` | uuid not null | |
| `user_id` | uuid not null | |
| `period_start` | date not null | Monthly |
| `credit_limit_cents` | int null | Null means no personal limit |
| `hard_stop` | boolean not null default true | Matching the org default fixed in Batch 7 |

Primary key `(organization_id, user_id, period_start)`.

**The gate reads both.** A call is permitted only if the org has budget *and* the member has budget. Two checks, one gate, in the same place `S-V` §10 already describes. This is where I-5's unbuilt per-call ceiling lands too — the three checks belong together and building them separately means touching the gate three times.

**Each member sees their own limit and usage.** RLS: `user_id = auth.uid()` for read, org admins for write. Usage comes from `usage_events` filtered by actor, which the single write path already records.

---

## 5. Migration sequence

Runs after `S3-core`. Additive first.

| # | Contents | Shape |
|---|---|---|
| 1 | `organization_members.seat_class` + backfill; `member_budgets` + RLS | Additive |
| 2 | `calendar_entries`, `calendar_entry_attendees` + RLS | Additive |
| 3 | `availability_rules`, `booking_types`, `bookings` + exclusion constraint + RLS | Additive |
| 4 | `calendar_connections` + RLS — **blocked on the token-storage decision in §1.6** | Additive |
| 5 | `meetings`, `meeting_participants` + RLS; `messages.timecode_ms` | Additive |
| 6 | `contracts`, `contract_fields`, `contract_signers`, `contract_events` + RLS | Additive |

Every migration here is additive, so each is apply-then-deploy. No destructive step. Rules from `HANDOFF` §10 apply throughout: printed never applied, forward-only, idempotent, `drop policy if exists` first.

Migration 1 has no dependency on `S3-core` and may run early.

---

## 6. Harness additions

Six assertions, each with a positive control.

1. A client member cannot read a calendar entry for another company. Control: reads their own.
2. A project-scoped member cannot see an entry for a project they lack. Control: sees one they have.
3. Nobody but the owner reads a `calendar_connections` row — **including an org admin.** Control: the owner reads it.
4. A client member cannot read another company's contract. Control: reads their own.
5. `contract_events` rejects UPDATE and DELETE from every role. Control: SELECT succeeds.
6. A member reads their own `member_budgets` row and not a colleague's. Control: reads their own.

Assertion 5 is the important one. It is the only assertion in the suite that proves a *negative capability* rather than a scoping boundary, and it is what makes the certificate of completion worth anything.

---

## 7. Open questions

1. **Calendar token storage** (§1.6). Blocks migration 4 only. Options: Supabase Vault, an encrypted column with a key in the environment, or deferring external sync entirely to v1.5 and shipping the internal calendar first. **Recommendation: defer external sync.** The internal calendar is most of the value, and it removes a credential-storage decision from the critical path.

2. **Non-member signers.** §3.7 routes them through a single-use link on the service role. **Recommendation: v1 requires signers to be portal members.** A client's own people already have logins; an outside counterparty is the exception, and the exception is what adds an unauthenticated surface to a legal document. Revisit when a real case appears.

3. **Meeting recording storage.** Recording is v1.5 (job queue), but a recorded meeting is a large file against the 5 TiB cap and it changes the storage curve. Flagged for pricing, not for schema.

---

*End of S3-b. Next: the messaging build.*
