-- ═══════════════════════════════════════════════════════════════════════════
-- 0057 · organization_member_projects.project_role + expires_at
-- S-R §3.2 (the project-role axis) and §6 G-5 (grants may expire).
-- Batch 26 item 3. ADDITIVE columns; ONE function widens, as a no-op today.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── THIS IS AN ALTER, NOT A CREATE, AND THAT IS S-R-A A-1 ──────────────────
--
-- `S-R` §2's axis table says the project-role axis "Does not exist anywhere,"
-- and §10 lists `organization_member_projects` under *Additive* as a table to
-- CREATE. The table exists. It landed with the B1–B4 crew-scoping work and
-- carries member_id, project_id, organization_id, created_at — verified live
-- again in Batch 26 item 0, with 1 row (a harness fixture; zero production rows).
--
-- A `create table` here would fail, or — written defensively with IF NOT EXISTS —
-- would SILENTLY DO NOTHING while reporting success, and every later item would
-- then be building on a column that does not exist. A-1 exists because that
-- distinction is the whole difference between this file and a wasted batch.
--
-- What genuinely does not exist is the COLUMN, not the table.
--
-- ── project_role IS NULLABLE, AND THE NULL MEANS SOMETHING ─────────────────
--
-- Every existing row predates this axis. Inventing a role for them would be
-- ASSERTING AN INTENT NOBODY RECORDED — Batch 25's Option B, refused on exactly
-- this ground, and HANDOFF §12 lesson 1's shape (a migration that repairs state
-- while inventing the invariant behind it).
--
-- So a NULL project_role means "on the production, no stated role," and it
-- resolves to NO BASELINE (item 5). It is not a degraded `observer` and it is not
-- a wildcard: `observer` is a DECISION that somebody is read-only, and null is the
-- absence of a decision. Collapsing them would make the absence of a record look
-- like a record.
--
-- ── THE VOCABULARY IS ONE CHECK, BOTH ARCHETYPES ───────────────────────────
--
-- S-R §3.2. Film's thirteen plus agency's three, in one constraint, because
-- `S1-P` targets O-2 (creative agencies) as a FIRST-CLASS archetype rather than a
-- variant: "a person invited into a tool that calls them the wrong thing stops
-- trusting the tool." An agency's `account_director` resolves to the same
-- capability baseline as a `producer` (item 5); the words differ because the
-- studios differ.
--
-- `observer` is in the list so there is a way to put somebody on a production
-- READ-ONLY without inventing a denial for every write capability (S-R §3.2).
--
-- NOTE the collision this vocabulary does NOT have, and why it is safe where
-- 0056's was not: `producer`, `coordinator` and `editor` appear in BOTH this
-- CHECK and organization_members_role_check. That is deliberate and harmless —
-- they are the same word for the same craft at two different SCOPES (studio-wide
-- vs on one production), which is precisely S-R R-1's point that a person is a
-- producer on one job and an editor on another. 0056's clash was different in
-- kind: `seat_class='crew'` and `role='crew'` would have meant UNRELATED things
-- on one row.
--
-- ── expires_at IS G-5, AND EXPIRY IS NOT DELETION ──────────────────────────
--
-- S-R §6 G-5: "For a freelance bench this is what you actually want — access
-- granted for a production should not accumulate across every job a person has
-- ever touched." Null means permanent.
--
-- An expired assignment DOES NOT RESOLVE, and nothing is deleted: the record of
-- who was on what, and when, survives. That is the same shape as an expired
-- GRANT (0051's has_cap filters `expires_at > now()` rather than pruning rows)
-- and the same shape as AD-003 for people.
--
-- WHICH MEANS THE FILTER HAS TO LAND SOMEWHERE, AND THERE ARE EXACTLY THREE
-- READERS of this table — enumerated by grep, not assumed:
--   · public.org_project_visible(uuid)          ← widened below
--   · lib/team.ts orgAccessOf()                 ← same commit
--   · lib/capabilities.server.ts resolveCaps()  ← same commit
-- A column that exists and is ignored is `organizations.plan` all over again
-- (§12 lesson 7: a column with only a default tells you its default). All three
-- move in this commit so the column never has a release in which it means nothing.
--
-- `lib/notify.ts` reads client_member_projects, NOT this table — client-side
-- scoping is untouched by this batch, deliberately.
--
-- ── THE FUNCTION CHANGE IS A NO-OP TODAY, AND THAT IS THE POINT ────────────
--
-- org_project_visible() is read by EIGHT live policies (projects, tasks, files,
-- messages, project_phases, activity_log, approvals, invoices). Widening it is
-- therefore the riskiest line in this file — so it is written to be provably
-- inert: every existing row has expires_at NULL (the column is created in this
-- same transaction), and `expires_at is null` is the permitted branch. Verified
-- by count after applying, not asserted.
--
-- It keeps its `uuid` ARGUMENT and is therefore still un-wrappable as an
-- InitPlan — the live exception to 0021's wrapped-subselect rule, which is
-- CORRECT rather than an oversight (Batch 25 q14, restated here because this is
-- the file a reader lands on when they wonder why it is not `(select ...)`).
--
-- I-12: forward-only. No policies created, so no `drop policy if exists` is owed;
-- the columns and the constraint are each guarded so a re-run is a no-op.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1 · the two columns ────────────────────────────────────────────────────
alter table public.organization_member_projects
  add column if not exists project_role text null;

alter table public.organization_member_projects
  add column if not exists expires_at timestamptz null;

alter table public.organization_member_projects
  drop constraint if exists organization_member_projects_project_role_check;

alter table public.organization_member_projects
  add constraint organization_member_projects_project_role_check
  check (
    project_role is null
    or project_role in (
      -- film (S-R §3.2)
      'director', 'producer', 'line_producer', 'writer', 'coordinator',
      'post_supervisor', 'editor', 'assistant_editor', 'colorist', 'sound',
      'vfx', 'motion', 'observer',
      -- agency (S-R §3.2 — O-2 is a first-class archetype, not a variant)
      'account_director', 'creative_director', 'strategist'
    )
  );

comment on column public.organization_member_projects.project_role is
  'S-R §3.2 axis 3 — what someone IS on this production, as opposed to that they '
  'are on it. NULL means "on the production, no stated role" and resolves to NO '
  'baseline; it is NOT a degraded observer, because observer is a decision that '
  'somebody is read-only and null is the absence of a decision. Film and agency '
  'vocabularies share one CHECK.';

comment on column public.organization_member_projects.expires_at is
  'S-R §6 G-5. NULL = permanent. An expired assignment DOES NOT RESOLVE and is '
  'never deleted — the record of who was on what, and when, survives. Enforced in '
  'org_project_visible() and in the two TS readers (lib/team.ts, '
  'lib/capabilities.server.ts); all three moved in the same commit.';

-- ── 2 · expiry reaches the policies, via the one function they all read ────
--
-- Unchanged except for the expires_at conjunct. scope_mode is still read as a
-- STATED value and never inferred from row count (B1's lesson, S-R §10): no rows
-- + 'all' means everything, no rows + 'selected' means nothing.
create or replace function public.org_project_visible(pid uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.organization_members m
    join public.projects p
      on p.id = pid
     and p.organization_id = m.organization_id
    where m.user_id = auth.uid()
      and m.status  = 'active'
      and m.organization_id = public.current_org()
      and (
        m.scope_mode = 'all'
        or exists (
          select 1
          from public.organization_member_projects mp
          where mp.member_id  = m.id
            and mp.project_id = p.id
            -- G-5: an expired assignment does not resolve. Nothing is deleted.
            and (mp.expires_at is null or mp.expires_at > now())
        )
      )
  )
$function$;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION — run after applying. Expected results in comments.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 1 · the two columns, both NULLABLE with no default:
--     select column_name, data_type, is_nullable, column_default
--       from information_schema.columns
--      where table_name='organization_member_projects'
--        and column_name in ('project_role','expires_at');
--     → project_role text YES (null) · expires_at timestamptz YES (null)
--
-- 2 · THE FUNCTION CHANGE IS INERT TODAY, by count rather than by claim:
--     select count(*) as total,
--            count(*) filter (where expires_at is null) as unexpiring,
--            count(*) filter (where project_role is null) as unroled
--       from organization_member_projects;
--     → total = unexpiring = unroled  (1 row today, all null)
--
-- 3 · the CHECK admits the vocabulary and refuses anything else:
--     a real update to 'gaffer' raises 23514
--     organization_member_projects_project_role_check; 'colorist' and
--     'account_director' are accepted; NULL is accepted.
--
-- 4 · org_project_visible still carries its uuid argument (so it stays
--     un-wrappable — the correct live exception to 0021's InitPlan rule):
--     select pg_get_function_identity_arguments(oid) from pg_proc
--      where proname='org_project_visible';  → 'pid uuid'
--
-- 5 · AND THE ONE THAT MATTERS FOR RULE ZERO: the owner and Gabby still read
--     every project. Both are scope_mode='all', which short-circuits before the
--     organization_member_projects lookup is reached at all — so this change
--     cannot narrow them. Probed live as the harness owner and as a scoped crew
--     member before and after.
--
-- Harness assertion 39/40 (item 9) makes (2) and (3) standing tests: an expired
-- assignment does not resolve, with the same assignment before expiry as its
-- positive control.
-- ═══════════════════════════════════════════════════════════════════════════
