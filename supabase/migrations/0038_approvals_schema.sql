-- ============================================================================
-- 0038_approvals_schema.sql — Batch 22 item 1: the approvals engine's schema.
--
-- Governing: S3-c (approvals, review and live artifacts), which SUPERSEDES
-- S3-core §2 (the approvals tables), S3-core §9.2 (the expired-stage
-- recommendation) and S-F §3.3 where they disagree. Also S2 §4 (policy
-- classes — these are Class B), S1 T-5 (org stamped from the session, never a
-- DEFAULT), S3-core-A A-4 (never cascade a tag). Runs after 0037.
-- Forward-only, idempotent (I-12).
--
-- ── THE DECISION THIS SCHEMA ENCODES ────────────────────────────────────────
-- AP-1: approval NEVER blocks work. Nothing here gates anything; the engine
-- observes the pipeline. A stage may order itself INSIDE an approval; no
-- approval stage holds up work outside itself.
--
-- AP-2: silence auto-advances with outcome 'auto_advanced' and NO actor, and
-- is never written as 'approved'. `expired` does not exist in this schema.
-- The moment a timeout and a human decision share a value, every certificate,
-- query and dispute conflates them. An 'auto_advanced' stage writes NO
-- approval_decisions row — the lapse is a stage-level fact and a ledger event.
--
-- AP-4: visibility is a read filter, never a write filter. Who may COMMENT is
-- controlled; what is RECORDED is not. There is no visibility table here and
-- no per-comment filter — one check at the point of writing.
--
-- ── DEPLOY ORDER ────────────────────────────────────────────────────────────
-- ADDITIVE throughout (new tables, new NULLABLE columns, one NOT NULL column
-- with a default on a 3-row table). Applies FIRST, deploys second — the
-- opposite order from 0036/0037's drops. Reload the PostgREST schema cache
-- after applying. Nothing deployed reads or writes any of this until Batch 22
-- item 2 (lib/approvals.ts) ships, so the window between apply and deploy is
-- inert rather than merely tolerable.
--
-- ── AUDIT CORRECTIONS FOLDED IN (Batch 22 item 0) ───────────────────────────
-- 1. `is_org_member()` takes NO ARGUMENT. The brief specified
--    `is_org_member(organization_id)`, which does not exist. The live Class B
--    pattern (0021, 0027) is `organization_id = (select current_org()) and
--    (select is_org_member())`, and that is what is used below. Note this is
--    also what keeps CLIENTS out of the write policies: a client member's JWT
--    claim resolves current_org() to the STUDIO's org, so the org match alone
--    would pass — is_org_member() reads organization_members (the crew
--    roster), which a client is not on.
-- 2. `messages` has NO separate crew INSERT policy to extend. The live
--    policies are messages_crew_all (ALL), messages_client_insert (INSERT)
--    and messages_client_read (SELECT). Editing an ALL policy that governs
--    every crew read AND write to add a comment gate is the highest-risk
--    statement this batch could contain. Instead the gate is a RESTRICTIVE
--    INSERT policy: restrictive policies are AND-ed rather than OR-ed, so it
--    constrains without touching either existing policy, and because
--    approval_id is null for all 259 existing messages and every non-approval
--    send, it is trivially true and changes nothing for current traffic.
--    service_role carries BYPASSRLS, so server-side sends are unaffected.
-- 3. `messages.timecode_ms` DOES NOT EXIST. S3-c §5.1 asserts S3-core placed
--    it there; a live column read proves otherwise (S3-core §1.3 never listed
--    it; S3-b §2.2 adds it in an unrun migration). So there is no reconcili-
--    ation to make — ONE anchor model, recorded here as S3-c §6 requires:
--    a timecode anchor is anchor_kind='timecode' with anchor_value
--    {"ms": <int>}. S3-b migration 5 MUST drop its timecode_ms line.
-- 4. `message_mentions.kind` ALREADY permits 'approval' (live CHECK). No
--    mention-vocabulary change is needed here.
--
-- ── THE ONE FK THAT CAN BREAK A LIVE ROUTE ──────────────────────────────────
-- approvals.client_id is ON DELETE RESTRICT, deliberately: SET NULL would
-- silently convert a client approval into an internal one, which is A-4's
-- failure one level up. But app/api/admin/delete-client/route.ts HARD-deletes
-- the clients row (:113-116) AFTER it has already deleted the company's R2
-- blobs (:78-96) and its invoice/file rows (:109-110). So without a guard the
-- first delete of a company holding an approval is not "delete refused" — it
-- is a half-deleted company with destroyed blobs and a 500 carrying a raw
-- 23503. The paired code change (Batch 22 item 1) adds a pre-check at the top
-- of that route returning a clean 409 BEFORE any destruction. Zero approval
-- rows exist today, so the guard lands ahead of the first row that could fire
-- it.
-- ============================================================================

begin;

-- ── approvals ───────────────────────────────────────────────────────────────
create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),

  -- T-5: NO DEFAULT, deliberately. Every writer stamps the org it resolved
  -- from the session. A DEFAULT is how two rows came to disagree about their
  -- tenant in the Batch 8 finding.
  organization_id uuid not null references public.organizations(id),

  -- Polymorphic by design and deliberately NOT an FK (S3-core §2.2 records
  -- the cost: the engine must validate the subject exists AND is in the
  -- caller's tenant BEFORE insert, because the database cannot).
  -- 'file_version' and 'milestone' have no table yet (migration 9 and later);
  -- the polymorphism is what lets them arrive without a schema change.
  subject_kind text not null,
  subject_id   uuid not null,

  -- A tag, never an owner (S3-core-A A-4). Deleting a project must not delete
  -- the record of what was approved on it.
  project_id uuid references public.projects(id) on delete set null,

  -- NULL means an INTERNAL approval. This one column is the decoupling that
  -- makes internal review and client sign-off the same object, and the
  -- client-side SELECT policy's `client_id is not null` makes internal
  -- approvals invisible to every client member by construction — no branch,
  -- just the predicate. RESTRICT, not SET NULL: see the header.
  client_id uuid references public.clients(id) on delete restrict,

  title  text not null,
  status text not null default 'open',

  -- The window applied to THIS approval; null means inherit
  -- organizations.approval_window_hours (S3-c §2.1).
  review_window_hours int,

  -- The agreement that established the window (S3-c §2.6). NO FK: the
  -- contracts table does not exist until S3-b migration 6 (verified live —
  -- zero rows in information_schema.tables). When it lands, add:
  --   alter table public.approvals add constraint approvals_contract_fk
  --     foreign key (contract_id) references public.contracts(id)
  --     on delete set null;
  contract_id uuid,

  -- The frozen version from AP-5 — minting IS the snapshot. Written from
  -- Batch 23 onward; unused in this batch.
  subject_version_id uuid references public.files(id) on delete set null,

  created_by uuid references auth.users(id) on delete set null,  -- AD-003
  created_at timestamptz not null default now(),
  deleted_at timestamptz,                                        -- S3-core §4.1

  constraint approvals_subject_kind_check check (
    subject_kind in ('file_version', 'task', 'milestone', 'document', 'message')
  ),
  -- 'expired' is NOT here and never will be (S3-c §2.2). A stage that stalled
  -- described a product that waits for a client; nothing waits now.
  constraint approvals_status_check check (
    status in ('open', 'approved', 'rejected', 'changes_requested',
               'auto_advanced', 'withdrawn')
  ),
  -- A zero or negative window would lapse the moment it opened. Null is how
  -- "inherit the org default" is expressed; it is not a zero.
  constraint approvals_review_window_check check (
    review_window_hours is null or review_window_hours > 0
  )
);

create index if not exists approvals_org_status_idx
  on public.approvals (organization_id, status);
create index if not exists approvals_client_idx
  on public.approvals (client_id) where client_id is not null;
create index if not exists approvals_project_idx
  on public.approvals (project_id) where project_id is not null;
create index if not exists approvals_subject_idx
  on public.approvals (subject_kind, subject_id);

comment on column public.approvals.contract_id is
  'S3-c §2.6. The agreement that established this review window. NO FK until S3-b migration 6 creates public.contracts; add approvals_contract_fk then.';
comment on column public.approvals.client_id is
  'NULL = internal approval. ON DELETE RESTRICT: SET NULL would silently convert a client approval into an internal one. delete-client pre-checks this and returns 409.';

-- ── approval_stages ─────────────────────────────────────────────────────────
create table if not exists public.approval_stages (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null references public.approvals(id) on delete cascade,
  seq  int  not null,
  name text not null,
  mode text not null default 'sequential',
  deadline_at timestamptz,
  status text not null default 'pending',
  -- When it advanced, by decision OR by lapse. The distinction lives in
  -- `status`, never here — a lapse and a decision must never be one value.
  advanced_at timestamptz,
  created_at  timestamptz not null default now(),

  constraint approval_stages_mode_check check (mode in ('sequential', 'parallel')),
  -- 'blocked_on_changes' is AP-3's whole point: a stage where someone
  -- requested changes is NOT silent, so it must never lapse. The sweep
  -- (item 5) predicates on status = 'active' alone, which excludes it.
  constraint approval_stages_status_check check (
    status in ('pending', 'active', 'complete', 'auto_advanced', 'blocked_on_changes')
  ),
  constraint approval_stages_seq_unique unique (approval_id, seq)
);

create index if not exists approval_stages_approval_idx
  on public.approval_stages (approval_id, seq);
-- The auto-advance sweep's index (item 5): active stages ordered by deadline.
-- Partial, so pending/complete/auto_advanced/blocked_on_changes stages never
-- enter it.
create index if not exists approval_stages_sweep_idx
  on public.approval_stages (deadline_at) where status = 'active';

-- ── approval_assignees ──────────────────────────────────────────────────────
-- Role assignment matters and is not a convenience: a NAMED person leaving
-- must not deadlock an approval (S3-core §2.4). A role-shaped assignee is
-- resolved against the roster at decision time, so departure is survivable.
create table if not exists public.approval_assignees (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.approval_stages(id) on delete cascade,
  user_id   uuid references auth.users(id) on delete set null,   -- AD-003
  client_id uuid references public.clients(id) on delete cascade,
  role      text,
  required  boolean not null default true,
  created_at timestamptz not null default now(),

  constraint approval_assignees_target_check check (
    user_id is not null or client_id is not null or role is not null
  )
);

create index if not exists approval_assignees_stage_idx
  on public.approval_assignees (stage_id);
create index if not exists approval_assignees_user_idx
  on public.approval_assignees (user_id) where user_id is not null;

-- ── approval_decisions ──────────────────────────────────────────────────────
-- APPEND-ONLY, for everyone, including org owners. There is no UPDATE policy
-- and no DELETE policy below — a changed mind is a NEW ROW. This is the table
-- the Review & Approval page exists to make un-arguable, and a record that
-- can be edited by the party it might indict is not a record.
create table if not exists public.approval_decisions (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.approval_stages(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,    -- AD-003

  -- Resolved from the ROSTER at decision time (rosterName(), lib/team.ts),
  -- never user_metadata — which the user can rewrite via updateUser({data})
  -- and so can impersonate with. This is the 7.8 / 11.5 defect through a new
  -- door, and the column is NOT NULL so it cannot be skipped.
  actor_name text not null,

  decision   text not null,
  comment    text,
  decided_at timestamptz not null default now(),

  constraint approval_decisions_decision_check check (
    decision in ('approved', 'rejected', 'changes_requested')
  )
);

create index if not exists approval_decisions_stage_idx
  on public.approval_decisions (stage_id, decided_at);

-- ── approval_comment_permissions ────────────────────────────────────────────
-- An ABSENT row means the default for that person's role (S3-c §6), which is
-- resolved in can_comment_on_approval() below: participants may comment,
-- everyone else may not. A row is how a capability-holder overrides that in
-- either direction.
create table if not exists public.approval_comment_permissions (
  approval_id uuid not null references public.approvals(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  can_comment boolean not null,
  set_by      uuid references auth.users(id) on delete set null,
  set_at      timestamptz not null default now(),
  primary key (approval_id, user_id)
);

-- ── messages: the anchor model + the approval link ──────────────────────────
alter table public.messages
  add column if not exists approval_id uuid references public.approvals(id) on delete set null;
alter table public.messages add column if not exists anchor_kind  text;
alter table public.messages add column if not exists anchor_value jsonb;

alter table public.messages drop constraint if exists messages_anchor_kind_check;
alter table public.messages add constraint messages_anchor_kind_check
  check (anchor_kind is null or anchor_kind in ('timecode', 'block', 'panel', 'region'));

-- Both or neither. A kind with no value anchors nothing; a value with no kind
-- cannot be interpreted.
alter table public.messages drop constraint if exists messages_anchor_pair_check;
alter table public.messages add constraint messages_anchor_pair_check
  check ((anchor_kind is null) = (anchor_value is null));

create index if not exists messages_approval_idx
  on public.messages (approval_id) where approval_id is not null;

comment on column public.messages.anchor_value is
  'S3-c §5.1, one anchor model. timecode => {"ms": <int>}; block => a block/line range; panel => a panel or shot ref; region => a box on the image. messages.timecode_ms was never created (verified live) — S3-b migration 5 must drop its timecode_ms line.';

-- ── organizations: the org-level review window default ──────────────────────
-- 120 hours = five days (S3-c §2.1). NOT NULL with a default on a 3-row
-- table; PG11+ adds this without a rewrite.
alter table public.organizations
  add column if not exists approval_window_hours int not null default 120;

alter table public.organizations drop constraint if exists organizations_approval_window_check;
alter table public.organizations add constraint organizations_approval_window_check
  check (approval_window_hours > 0);

-- ============================================================================
-- HELPERS — all STABLE SECURITY DEFINER, owned by postgres, search_path
-- pinned. messages has relforcerowsecurity = false (verified live), so a
-- definer function owned by the table owner bypasses RLS inside its body:
-- that is what lets can_comment_on_message() read the thread root WITHOUT a
-- recursive policy on messages. Same posture as is_org_member() /
-- is_client_member() (0020): each reports only on the CURRENT caller, so
-- leaving EXECUTE at its default tells an attacker nothing about anyone else.
-- ============================================================================

-- Is the caller an assignee of this stage — by name, by company, or by role?
-- Role matching is TENANT-SCOPED: an assignee row saying 'approver' must not
-- let every approver in every tenant decide. It resolves against the
-- approval's OWN org (crew roles, primary or deep) or its OWN client company.
create or replace function public.is_stage_assignee(p_stage_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
      from approval_assignees asg
      join approval_stages    s on s.id = asg.stage_id
      join approvals          a on a.id = s.approval_id
     where asg.stage_id = p_stage_id
       and (
            asg.user_id = auth.uid()
         or (asg.client_id is not null and public.is_client_member(asg.client_id))
         or (asg.role is not null and (
              exists (
                select 1 from organization_members om
                 where om.user_id = auth.uid()
                   and om.status  = 'active'
                   and om.organization_id = a.organization_id
                   and (om.role = asg.role
                        or asg.role = any(coalesce(om.roles, array[]::text[])))
              )
              or (a.client_id is not null and exists (
                select 1 from client_members cm
                 where cm.user_id = auth.uid()
                   and cm.status  = 'active'
                   and cm.client_id = a.client_id
                   and cm.role = asg.role
              ))
            ))
       )
  )
$function$;

-- The approval_decisions INSERT gate. Enforced in the POLICY and not only in
-- the engine (S3-core §2.6), so a direct PostgREST write cannot forge a
-- decision on a stage the caller is not on, or on a stage that is not open.
create or replace function public.can_decide_on_stage(p_stage_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
           select 1 from approval_stages s
            where s.id = p_stage_id and s.status = 'active'
         )
     and public.is_stage_assignee(p_stage_id)
$function$;

-- Who may comment (S3-c §5.2). An explicit row wins in either direction; with
-- no row, PARTICIPANTS may comment and nobody else may. Note this governs the
-- WRITE only — every participant READS every comment (AP-4), which is why
-- there is no visibility table anywhere in this file.
create or replace function public.can_comment_on_approval(p_approval_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select p.can_comment
       from approval_comment_permissions p
      where p.approval_id = p_approval_id
        and p.user_id = auth.uid()),
    (select (
         exists (select 1 from organization_members om
                  where om.user_id = auth.uid()
                    and om.status  = 'active'
                    and om.organization_id = a.organization_id)
         or (a.client_id is not null and public.is_client_member(a.client_id))
       )
       from approvals a where a.id = p_approval_id),
    false
  )
$function$;

-- The restrictive INSERT policy's predicate. A message is gated when it
-- CARRIES an approval_id, or when its thread ROOT does (a review comment is a
-- thread reply — S3-c §5.1 — so the gate has to follow the thread).
--
-- FAIL-OPEN for non-approval traffic and fail-closed only inside an approval.
-- That direction is deliberate and load-bearing: this predicate runs on EVERY
-- message insert in the product, and a bug that returned false by default
-- would stop all messaging. Ordinary sends never reach a lookup.
create or replace function public.can_comment_on_message(
  p_approval_id uuid,
  p_thread_root_id uuid
)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    when p_approval_id is not null then
      public.can_comment_on_approval(p_approval_id)
    when p_thread_root_id is not null then
      coalesce(
        (select case
                  when m.approval_id is null then true
                  else public.can_comment_on_approval(m.approval_id)
                end
           from messages m where m.id = p_thread_root_id),
        true)   -- root not found: not an approval thread, and the 0030
                -- trigger owns thread validity, not this function
    else true
  end
$function$;

-- ============================================================================
-- RLS — Class B (S2 §4), in the 0021/0027 house style: org match plus WRAPPED
-- SUBSELECT helpers so the planner runs them once per statement (InitPlan)
-- rather than once per row.
-- ============================================================================

alter table public.approvals                     enable row level security;
alter table public.approval_stages               enable row level security;
alter table public.approval_assignees            enable row level security;
alter table public.approval_decisions            enable row level security;
alter table public.approval_comment_permissions  enable row level security;

-- ── approvals ───────────────────────────────────────────────────────────────
drop policy if exists approvals_crew_read on public.approvals;
create policy approvals_crew_read on public.approvals
  for select to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
    and deleted_at is null
  );

-- Internal approvals (client_id is null) are invisible to every client member
-- BY CONSTRUCTION — the first predicate, not a branch.
drop policy if exists approvals_client_read on public.approvals;
create policy approvals_client_read on public.approvals
  for select to authenticated
  using (
    client_id is not null
    and public.is_client_member(client_id)
    and (project_id is null or public.client_project_visible(project_id))
    and deleted_at is null
  );

-- WHO may create, set a window or withdraw is the TypeScript matrix's job
-- (AD-001, lib/permissions.ts — Batch 22 item 3), not the policy's. The
-- policy answers only "is this caller crew in this tenant".
drop policy if exists approvals_crew_insert on public.approvals;
create policy approvals_crew_insert on public.approvals
  for insert to authenticated
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
  );

drop policy if exists approvals_crew_update on public.approvals;
create policy approvals_crew_update on public.approvals
  for update to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
  );

-- No DELETE policy, for anyone. The record is permanent (S3-c §3.2);
-- withdrawal is a status and removal is deleted_at, both UPDATEs.

-- ── child tables: SELECT inherits via EXISTS against approvals ──────────────
-- The subquery is itself filtered by approvals' RLS, so the scoping predicate
-- (tenant, project scope, client visibility, deleted_at) is inherited rather
-- than restated. Restating it is how two policies come to disagree.
--
-- The WRITE policies do restate one thing and must: `is_org_member()`. A
-- client member's claim resolves current_org() to the studio's org, so the
-- EXISTS alone would admit them — is_org_member() reads the CREW roster,
-- which is what actually holds the line.

drop policy if exists approval_stages_read on public.approval_stages;
create policy approval_stages_read on public.approval_stages
  for select to authenticated
  using (exists (select 1 from public.approvals a where a.id = approval_stages.approval_id));

drop policy if exists approval_stages_crew_write on public.approval_stages;
create policy approval_stages_crew_write on public.approval_stages
  for all to authenticated
  using (exists (
    select 1 from public.approvals a
     where a.id = approval_stages.approval_id
       and a.organization_id = (select public.current_org())
       and (select public.is_org_member())))
  with check (exists (
    select 1 from public.approvals a
     where a.id = approval_stages.approval_id
       and a.organization_id = (select public.current_org())
       and (select public.is_org_member())));

drop policy if exists approval_assignees_read on public.approval_assignees;
create policy approval_assignees_read on public.approval_assignees
  for select to authenticated
  using (exists (select 1 from public.approval_stages s where s.id = approval_assignees.stage_id));

drop policy if exists approval_assignees_crew_write on public.approval_assignees;
create policy approval_assignees_crew_write on public.approval_assignees
  for all to authenticated
  using (exists (
    select 1 from public.approval_stages s
      join public.approvals a on a.id = s.approval_id
     where s.id = approval_assignees.stage_id
       and a.organization_id = (select public.current_org())
       and (select public.is_org_member())))
  with check (exists (
    select 1 from public.approval_stages s
      join public.approvals a on a.id = s.approval_id
     where s.id = approval_assignees.stage_id
       and a.organization_id = (select public.current_org())
       and (select public.is_org_member())));

drop policy if exists approval_comment_permissions_read on public.approval_comment_permissions;
create policy approval_comment_permissions_read on public.approval_comment_permissions
  for select to authenticated
  using (exists (select 1 from public.approvals a where a.id = approval_comment_permissions.approval_id));

drop policy if exists approval_comment_permissions_crew_write on public.approval_comment_permissions;
create policy approval_comment_permissions_crew_write on public.approval_comment_permissions
  for all to authenticated
  using (exists (
    select 1 from public.approvals a
     where a.id = approval_comment_permissions.approval_id
       and a.organization_id = (select public.current_org())
       and (select public.is_org_member())))
  with check (exists (
    select 1 from public.approvals a
     where a.id = approval_comment_permissions.approval_id
       and a.organization_id = (select public.current_org())
       and (select public.is_org_member())));

-- ── approval_decisions — SELECT and INSERT ONLY ─────────────────────────────
drop policy if exists approval_decisions_read on public.approval_decisions;
create policy approval_decisions_read on public.approval_decisions
  for select to authenticated
  using (exists (select 1 from public.approval_stages s where s.id = approval_decisions.stage_id));

-- Permitted ONLY to an assignee of a stage whose status is 'active'.
drop policy if exists approval_decisions_insert on public.approval_decisions;
create policy approval_decisions_insert on public.approval_decisions
  for insert to authenticated
  with check (public.can_decide_on_stage(stage_id));

-- Deliberately absent: approval_decisions UPDATE and DELETE policies. With
-- RLS enabled and no policy, both are denied for every authenticated role
-- including org owners. A changed mind is a new row (S3-c §6).

-- ── messages: the comment gate, as a RESTRICTIVE policy ─────────────────────
-- RESTRICTIVE policies are AND-ed with the permissive ones, so this NARROWS
-- without modifying messages_crew_all or messages_client_insert. For every
-- message that carries no approval_id and whose thread root carries none —
-- which is all 259 rows today and every ordinary send — the predicate is
-- true and nothing changes. service_role has BYPASSRLS, so server-side sends
-- never evaluate it at all.
drop policy if exists messages_approval_comment_gate on public.messages;
create policy messages_approval_comment_gate on public.messages
  as restrictive
  for insert to authenticated
  with check (public.can_comment_on_message(approval_id, thread_root_id));

commit;

-- Reload the PostgREST schema cache in the same session (new tables + new
-- columns on messages and organizations).
notify pgrst, 'reload schema';

-- ── VERIFY (run after apply) ────────────────────────────────────────────────
-- 1) All five tables exist and are empty:
--      select table_name from information_schema.tables
--       where table_schema='public'
--         and table_name in ('approvals','approval_stages','approval_assignees',
--                            'approval_decisions','approval_comment_permissions');
--      -- expect 5 rows
--      select (select count(*) from public.approvals),
--             (select count(*) from public.approval_stages),
--             (select count(*) from public.approval_assignees),
--             (select count(*) from public.approval_decisions),
--             (select count(*) from public.approval_comment_permissions);
--      -- expect 0,0,0,0,0
--
-- 2) 'expired' appears in NO check constraint, and the new vocabularies hold:
--      select conname, pg_get_constraintdef(oid) from pg_constraint
--       where conrelid in ('public.approvals'::regclass,
--                          'public.approval_stages'::regclass) and contype='c';
--      -- expect auto_advanced present, expired absent
--
-- 3) RLS is on for all five, and approval_decisions has EXACTLY two policies
--    (no UPDATE, no DELETE):
--      select tablename, policyname, cmd, permissive from pg_policies
--       where schemaname='public'
--         and tablename like 'approval%' order by tablename, policyname;
--      -- expect approval_decisions_read (SELECT) + approval_decisions_insert
--      --        (INSERT) and nothing else on approval_decisions
--
-- 4) The messages gate is RESTRICTIVE and INSERT-scoped:
--      select policyname, cmd, permissive from pg_policies
--       where schemaname='public' and tablename='messages';
--      -- expect messages_approval_comment_gate / INSERT / RESTRICTIVE
--
-- 5) messages row count UNCHANGED, and the new columns are all null:
--      select count(*) as total,
--             count(approval_id)  as with_approval,
--             count(anchor_kind)  as with_anchor
--        from public.messages;
--      -- expect total = 259 (the 0037 count), with_approval = 0, with_anchor = 0
--
-- 6) Every organization carries the window default:
--      select id, name, approval_window_hours from public.organizations;
--      -- expect approval_window_hours = 120 on all 3
--
-- 7) A probe insert of a decision by a NON-ASSIGNEE is rejected. Run as an
--    authenticated non-assignee (the harness does this properly in item 6 —
--    assertion 17 with its positive control). Direct probe:
--      insert into public.approval_decisions (stage_id, actor_name, decision)
--      values ('<a real stage id>', 'probe', 'approved');
--      -- expect 42501 new row violates row-level security policy.
--      -- Do NOT commit it. With zero stages today this is item 6's job.
