-- ============================================================================
-- 0021_policy_classes.sql — S2 Batch 4: Classes A, B, D and E.
--
-- Governing: docs/specs/S2-authorization.md §4, S1 §5–6, S0 AD-001.
-- Runs after 0020. Forward-only and idempotent (I-12).
--
-- This is the batch that closes the DATABASE path. 0020 gave the predicates a
-- vocabulary and fixed the membership tables; batch 3 closed the application
-- path by org-scoping the service-role reads behind every studio surface.
-- Neither touched the fact that a second tenant's admin, holding nothing but
-- the anon key, could read 176 messages and 139 tasks belonging to tenant zero
-- (harness assertion 1). That is what this file ends.
--
-- EVERY OLD is_admin() POLICY ON THESE TABLES IS DROPPED. Permissive policies
-- OR together, so one leftover `using (is_admin())` grants back everything the
-- new predicate denies. The drops below were generated from a live read of
-- pg_policies across all 22 tables — 50 policies, every one accounted for.
--
-- SUBSELECT RULE (0020). Uncorrelated helper calls are wrapped —
-- (select public.is_org_member()) — so Postgres hoists them into a once-per-
-- query InitPlan. Row-dependent calls — client_project_visible(project_id),
-- is_client_member(client_id) — are correlated by definition, cannot become
-- InitPlans, and are written bare. Wrapping those would be cargo cult.
--
-- Do NOT touch the retired supabase/migrations/2026*_phaseN.sql series.
-- ============================================================================

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- CLASS A · org-internal. No client access at all.
--
-- These eleven already carried `is_admin() and organization_id =
-- current_org()`, so the tenant boundary was there — but admin was a JWT claim
-- rather than a roster fact, which is what let a paused or revoked crew member
-- keep reading (harness assertion 6). is_org_member() reads the roster, where
-- status lives, so revocation takes effect without waiting for a token refresh.
-- ════════════════════════════════════════════════════════════════════════════

-- ── the seven workspace tables share one shape exactly ──────────────────────
-- Written as a loop rather than seven copy-pasted blocks: one visible policy
-- shape is easier to audit than seven chances to mistype one of them.
do $$
declare t text;
begin
  foreach t in array array[
    'documents', 'document_versions', 'document_comments',
    'storyboards', 'storyboard_shots', 'asset_provenance', 'rights'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_org_all', t);
    execute format($f$
      create policy %I on public.%I
        for all to authenticated
        using       (organization_id = (select public.current_org()) and (select public.is_org_member()))
        with check  (organization_id = (select public.current_org()) and (select public.is_org_member()))
    $f$, t || '_org_all', t);
  end loop;
end $$;

-- ── the money tables stay READ-ONLY to members ──────────────────────────────
-- DELIBERATELY NARROWER THAN §4's single `for all` predicate, and the deviation
-- is the point: usage_events is the metering trail, credit_ledger is the
-- append-only record of every charge, and org_credits holds the balance. A
-- `for all` policy would let any active member forge ledger rows or top up
-- their own balance from the browser. Writes belong to charge_credits() and
-- add_credits() (0011, security definer) and to the service role. Each of these
-- three is SELECT-only today; that is preserved, with the predicate swapped.
drop policy if exists usage_events_admin_read on public.usage_events;
drop policy if exists usage_events_org_read on public.usage_events;
create policy usage_events_org_read on public.usage_events
  for select to authenticated
  using (organization_id = (select public.current_org()) and (select public.is_org_member()));

drop policy if exists org_credits_admin_read on public.org_credits;
drop policy if exists org_credits_org_read on public.org_credits;
create policy org_credits_org_read on public.org_credits
  for select to authenticated
  using (organization_id = (select public.current_org()) and (select public.is_org_member()));

drop policy if exists credit_ledger_admin_read on public.credit_ledger;
drop policy if exists credit_ledger_org_read on public.credit_ledger;
create policy credit_ledger_org_read on public.credit_ledger
  for select to authenticated
  using (organization_id = (select public.current_org()) and (select public.is_org_member()));

-- ── budgets: everyone reads the cap, only admins move it ────────────────────
-- Also narrower than §4 on purpose. org_budgets is the spend ceiling, including
-- hard_stop; a `for all` member policy would let the person hitting the cap
-- raise it.
drop policy if exists org_budgets_admin_all on public.org_budgets;
drop policy if exists org_budgets_org_read on public.org_budgets;
drop policy if exists org_budgets_admin_write on public.org_budgets;
create policy org_budgets_org_read on public.org_budgets
  for select to authenticated
  using (organization_id = (select public.current_org()) and (select public.is_org_member()));
create policy org_budgets_admin_write on public.org_budgets
  for all to authenticated
  using       (organization_id = (select public.current_org()) and (select public.is_org_admin()))
  with check  (organization_id = (select public.current_org()) and (select public.is_org_admin()));


-- ════════════════════════════════════════════════════════════════════════════
-- CLASS B · client work. Two audiences, so two policies (three where the
-- portal also writes).
--
-- HOW THE CLIENT SIDE REACHES ITS TENANT, per table. §4's shape assumes a
-- client_id column; three of these eight do not have one, and a fourth has one
-- that is null on 42% of its rows. Those four go through the parent project:
--
--   messages, tasks, project_phases  — no client_id column at all
--   activity_log                     — has one, but 23 of 55 live rows are null
--
-- Reaching through the parent costs nothing, because client_project_visible()
-- (0020 A5) joins projects and requires p.client_id = m.client_id for an ACTIVE
-- client_members row. It therefore proves membership AND project scope in one
-- call — the parent traversal is not a weaker check, it is the same check.
--
-- Every client policy replaces a `clients.user_id = auth.uid()` predicate. That
-- is S0-A AD-001-C: no work table used is_client_member(), so an invited
-- teammate matched nothing anywhere. It is why harness assertions 4 and 5 read
-- VACUOUS rather than PASS.
-- ════════════════════════════════════════════════════════════════════════════

-- ── projects ────────────────────────────────────────────────────────────────
drop policy if exists "Admins manage projects" on public.projects;
drop policy if exists admin_realtime_select_projects on public.projects;
drop policy if exists clients_read_own_projects on public.projects;
drop policy if exists projects_crew_all on public.projects;
drop policy if exists projects_client_read on public.projects;

create policy projects_crew_all on public.projects
  for all to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and public.org_project_visible(id)
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
  );

create policy projects_client_read on public.projects
  for select to authenticated
  using (public.is_client_member(client_id) and public.client_project_visible(id));

-- ── files ───────────────────────────────────────────────────────────────────
drop policy if exists "Admins manage files" on public.files;
drop policy if exists admin_realtime_select_files on public.files;
drop policy if exists "Client view own project files" on public.files;
drop policy if exists clients_read_own_files on public.files;
-- three duplicate client INSERT policies had accumulated on this table
drop policy if exists "Client insert own project files" on public.files;
drop policy if exists "Client upload to own projects" on public.files;
drop policy if exists clients_upload_own_files on public.files;
drop policy if exists files_crew_all on public.files;
drop policy if exists files_client_read on public.files;
drop policy if exists files_client_insert on public.files;

create policy files_crew_all on public.files
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

create policy files_client_read on public.files
  for select to authenticated
  using (
    public.is_client_member(client_id)
    and (project_id is null or public.client_project_visible(project_id))
  );

-- Replaces the three duplicates above with one. The portal uploads through
-- /api/files/commit, but the policy must still permit it for the day that route
-- moves to the user client (AD-001 consequence 4).
create policy files_client_insert on public.files
  for insert to authenticated
  with check (
    public.is_client_member(client_id)
    and (project_id is null or public.client_project_visible(project_id))
  );

-- ── messages · parent traversal + the history cutoff ────────────────────────
drop policy if exists "Admins manage messages" on public.messages;
drop policy if exists admin_realtime_select_messages on public.messages;
drop policy if exists clients_read_own_messages on public.messages;
drop policy if exists clients_send_messages on public.messages;
drop policy if exists messages_crew_all on public.messages;
drop policy if exists messages_client_read on public.messages;
drop policy if exists messages_client_insert on public.messages;

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

-- history_from lands here and on activity_log ONLY. A teammate invited in
-- August must not read July's thread. Enforced in application code today and
-- nowhere in the database — this is the first time the cutoff is a database
-- fact. NULL means full history, hence the coalesce to -infinity.
create policy messages_client_read on public.messages
  for select to authenticated
  using (
    project_id is not null
    and public.client_project_visible(project_id)
    and created_at >= coalesce((select public.member_history_from()), '-infinity'::timestamptz)
  );

create policy messages_client_insert on public.messages
  for insert to authenticated
  with check (project_id is not null and public.client_project_visible(project_id));

-- ── tasks · parent traversal ────────────────────────────────────────────────
drop policy if exists admin_full_tasks on public.tasks;
drop policy if exists admin_realtime_select_tasks on public.tasks;
drop policy if exists "Client view own project tasks" on public.tasks;
drop policy if exists tasks_crew_all on public.tasks;
drop policy if exists tasks_client_read on public.tasks;

create policy tasks_crew_all on public.tasks
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

-- visible_to_client is retained from the policy this replaces: internal tasks
-- stay internal, and dropping it here would expose the studio's private task
-- list to every client the moment the portal moves to the user client.
create policy tasks_client_read on public.tasks
  for select to authenticated
  using (
    visible_to_client = true
    and project_id is not null
    and public.client_project_visible(project_id)
  );

-- ── invoices ────────────────────────────────────────────────────────────────
drop policy if exists admin_full_invoices on public.invoices;
drop policy if exists admin_realtime_select_invoices on public.invoices;
drop policy if exists "Client view own invoices" on public.invoices;
drop policy if exists "Clients see own invoices" on public.invoices;
drop policy if exists invoices_crew_all on public.invoices;
drop policy if exists invoices_client_read on public.invoices;

create policy invoices_crew_all on public.invoices
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

-- Draft invoices stay invisible to the client (0019 / commit 1). The status
-- predicate is carried into the policy so the rule survives a caller that
-- forgets to filter.
create policy invoices_client_read on public.invoices
  for select to authenticated
  using (
    public.is_client_member(client_id)
    and (project_id is null or public.client_project_visible(project_id))
    and status <> 'draft'
  );

-- ── notifications ───────────────────────────────────────────────────────────
drop policy if exists admin_full_notifications on public.notifications;
drop policy if exists admin_realtime_select_notifications on public.notifications;
drop policy if exists "Clients see own notifications" on public.notifications;
drop policy if exists "Clients update own notifications" on public.notifications;
drop policy if exists notifications_crew_all on public.notifications;
drop policy if exists notifications_client_read on public.notifications;
drop policy if exists notifications_client_update on public.notifications;

create policy notifications_crew_all on public.notifications
  for all to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
  );

-- for_admin rows are the studio's own bell and are never a client's.
-- 3 of 107 live rows carry a null project_id, so the project clause is
-- permissive on null rather than requiring one.
create policy notifications_client_read on public.notifications
  for select to authenticated
  using (
    for_admin = false
    and public.is_client_member(client_id)
    and (project_id is null or public.client_project_visible(project_id))
  );

create policy notifications_client_update on public.notifications
  for update to authenticated
  using       (for_admin = false and public.is_client_member(client_id))
  with check  (for_admin = false and public.is_client_member(client_id));

-- ── project_phases · parent traversal ───────────────────────────────────────
drop policy if exists "Admins manage phases" on public.project_phases;
drop policy if exists admin_realtime_select_project_phases on public.project_phases;
drop policy if exists clients_read_own_phases on public.project_phases;
drop policy if exists project_phases_crew_all on public.project_phases;
drop policy if exists project_phases_client_read on public.project_phases;

create policy project_phases_crew_all on public.project_phases
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

create policy project_phases_client_read on public.project_phases
  for select to authenticated
  using (project_id is not null and public.client_project_visible(project_id));

-- ── activity_log · parent traversal + the history cutoff ────────────────────
drop policy if exists admin_full_activity_log on public.activity_log;
drop policy if exists admin_select_activity_log on public.activity_log;
drop policy if exists admin_realtime_select_activity_log on public.activity_log;
drop policy if exists client_select_activity_log on public.activity_log;
drop policy if exists activity_log_crew_all on public.activity_log;
drop policy if exists activity_log_client_read on public.activity_log;

create policy activity_log_crew_all on public.activity_log
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

-- client_id is null on 23 of 55 live rows, so it cannot be the key here; every
-- row has a project_id, and client_project_visible() proves company membership
-- as a side effect of proving project scope.
create policy activity_log_client_read on public.activity_log
  for select to authenticated
  using (
    project_id is not null
    and public.client_project_visible(project_id)
    and created_at >= coalesce((select public.member_history_from()), '-infinity'::timestamptz)
  );


-- ════════════════════════════════════════════════════════════════════════════
-- CLASS D · tenant root.
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists org_admin_manage on public.organizations;
drop policy if exists org_select_own on public.organizations;
drop policy if exists organizations_member_read on public.organizations;
drop policy if exists organizations_admin_write on public.organizations;

create policy organizations_member_read on public.organizations
  for select to authenticated
  using (id = (select public.current_org()));

create policy organizations_admin_write on public.organizations
  for all to authenticated
  using       (id = (select public.current_org()) and (select public.is_org_admin()))
  with check  (id = (select public.current_org()) and (select public.is_org_admin()));

-- ── business_settings · this closes the bank-details diagnostic ─────────────
-- Its ONLY policy was `for all using (is_admin())` with no tenant predicate,
-- and the table holds bank_name, account_name, account_number, routing_number
-- and swift. Any admin of any organization could read every other studio's
-- account number from the browser. The harness reports this as
-- "[diagnostic] business_settings rows of other tenants visible: 1".
--
-- Read is org-wide (the invoice footer and studio chrome need the business
-- name); write is admins only, because this is where money is collected.
drop policy if exists admin_full_business_settings on public.business_settings;
drop policy if exists business_settings_org_read on public.business_settings;
drop policy if exists business_settings_admin_write on public.business_settings;

create policy business_settings_org_read on public.business_settings
  for select to authenticated
  using (organization_id = (select public.current_org()) and (select public.is_org_member()));

create policy business_settings_admin_write on public.business_settings
  for all to authenticated
  using       (organization_id = (select public.current_org()) and (select public.is_org_admin()))
  with check  (organization_id = (select public.current_org()) and (select public.is_org_admin()));


-- ════════════════════════════════════════════════════════════════════════════
-- CLASS E · clients — the row policy AND the column grants.
--
-- RLS controls rows, not columns. `Client can update own record` (0000:416) is
-- an unrestricted-column UPDATE: a client with a session could set is_active,
-- override an owner's invite_policy='locked', or move their company to another
-- tenant by writing organization_id. Harness assertion 7 confirms all three are
-- writable today.
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists admin_full_clients on public.clients;
drop policy if exists "Client can view own record" on public.clients;
drop policy if exists clients_read_own on public.clients;
drop policy if exists "Client can update own record" on public.clients;
drop policy if exists clients_crew_all on public.clients;
drop policy if exists clients_member_read on public.clients;
drop policy if exists clients_member_update on public.clients;

create policy clients_crew_all on public.clients
  for all to authenticated
  using       (organization_id = (select public.current_org()) and (select public.is_org_member()))
  with check  (organization_id = (select public.current_org()) and (select public.is_org_member()));

-- Membership, not clients.user_id (S1 §5.2). The two duplicate SELECT policies
-- this replaces both keyed on user_id, so an invited teammate could not read
-- their own company's record.
create policy clients_member_read on public.clients
  for select to authenticated
  using (public.is_client_member(id));

create policy clients_member_update on public.clients
  for update to authenticated
  using       (public.is_client_member(id))
  with check  (public.is_client_member(id));

-- ── column grants — the half RLS cannot express ─────────────────────────────
-- VERIFIED AGAINST THE CODE BEFORE WRITING, because a column the app writes and
-- the grant omits breaks that flow silently. Every write to public.clients was
-- traced; only TWO run as `authenticated` (everything else is service role and
-- is unaffected by these grants):
--
--   app/auth/callback/route.ts:111        onboarded_at    ← granted below
--   app/(auth)/set-password/page.tsx:110  user_id         ← deliberately NOT
--
-- onboarded_at is added to §4's list. It carries no authorization weight, and
-- omitting it would silently stop the first-login stamp inside a catch{} that
-- is explicitly written never to block the auth flow — the worst failure shape.
--
-- user_id is REFUSED, and §4's list is right to omit it. Granting it would let
-- a client point another company's row at their own auth user: total account
-- takeover, strictly worse than the hole being closed. That write is also
-- already dead — both creation paths set user_id at INSERT through the service
-- role (create-client:144, invite-client:78), and the policy it runs under
-- (user_id = auth.uid()) only matches when the value is ALREADY the caller's,
-- so it can never link an unlinked row. It updates a column to the value it
-- already holds. Revoking it breaks nothing.
revoke update on public.clients from authenticated;
grant update (
  name,
  phone,
  avatar_url,
  notification_prefs,
  welcome_dismissed_at,
  onboarded_at
) on public.clients to authenticated;

commit;
