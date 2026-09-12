-- ============================================================================
-- 0054_delegation_triggers.sql — Batch 24 item 7. S-R §6, G-1 … G-4.
--
-- Runs after 0053. Forward-only, idempotent.
--
-- ── WHY TRIGGERS AND NOT ROUTE CHECKS ───────────────────────────────────────
-- organization_members, client_members and the two grant tables are Class C
-- tables with RLS, and 0053 gives an admin (or anyone granted people.manage)
-- UPDATE on them. That admin can therefore write any role string and any
-- capability array straight through PostgREST, past every check in the codebase.
--
-- HANDOFF §12 lesson 6, which cost Batch 22 three defects: "when a policy
-- permits a direct write, every invariant about that row has to live at or
-- below the row." 0039 and 0040 are the shape this follows.
--
-- ── THE LIMIT, STATED RATHER THAN DISCOVERED ────────────────────────────────
-- Under the SERVICE ROLE auth.uid() is NULL, and these triggers then PASS THE
-- WRITE THROUGH. That is deliberate and it is the same posture 0039/0040 took
-- ("service-role paths keep what they supplied"): every roster write the
-- application makes today goes through supabaseAdmin — the invite route, the
-- bootstrap, provision-tenant, memberAccess — so enforcing against a null actor
-- would refuse every invite in the product.
--
-- So these triggers constrain a SESSION. The threat they answer is the one that
-- is actually reachable: a person with a JWT writing directly to PostgREST. A
-- service-role path is the application's own trusted code, already enumerated on
-- the I-8 allowlist. When the I-8 migration moves roster writes onto the user
-- client, these triggers start covering them with no change.
--
-- NAMED ERRORS. Each refusal raises a distinct SQLSTATE in the 'GR' class so a
-- route can translate it into a sentence a human can act on. A trigger that
-- fails with a generic message is the silent-stall defect from Batch 22 wearing
-- a different hat.
--   GR001 G-1  grant exceeds the granter's own set
--   GR002 G-2  platform.* / undeclared capability
--   GR003 G-3  self-edit of role, caps or status
--   GR004 G-3  an admin touching an owner
--   GR005 G-4  would leave zero active owners
-- ============================================================================

create or replace function public.valid_org_cap(p_cap text)
returns boolean language sql immutable set search_path = public as $fn$
  -- GENERATED from lib/capabilities.ts ORG_CAPS_ALL. npm run check:caps diffs it.
  select p_cap = any (array['work.projects', 'work.suite', 'client.manage', 'people.manage', 'money.invoices', 'money.costs', 'org.settings', 'record.approval_policy']::text[])
$fn$;

create or replace function public.valid_client_cap(p_cap text)
returns boolean language sql immutable set search_path = public as $fn$
  -- GENERATED from lib/capabilities.ts CLIENT_CAPS_ALL.
  select p_cap = any (array['portal.view', 'portal.message', 'portal.upload', 'portal.approve', 'portal.invoices', 'portal.team']::text[])
$fn$;

-- ── is the CALLER an active owner of this org / this client company? ────────
create or replace function public.actor_is_org_owner(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.organization_members m
     where m.user_id = auth.uid() and m.organization_id = p_org
       and m.status = 'active' and m.role = 'owner'
  )
$fn$;

create or replace function public.actor_is_client_owner(p_client uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.client_members m
     where m.user_id = auth.uid() and m.client_id = p_client
       and m.status = 'active' and m.role = 'owner'
  )
$fn$;

-- ── G-1 + G-2 + G-3, on the CREW grant table ───────────────────────────────
create or replace function public.guard_org_cap_grant()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_actor uuid := auth.uid();
  v_target_user uuid;
  v_target_role text;
begin
  -- Service role: pass through. See the file header.
  if v_actor is null then return new; end if;

  -- G-2 — the capability must be a DECLARED coarse cap. platform.* is absent
  -- from the generated list on purpose: billing, org deletion, erasure and the
  -- grant itself are owner-only and NOT grantable (an admin who can grant the
  -- grant is an owner with extra steps). This also refuses a typo, which would
  -- otherwise store happily, resolve to nothing, and read as "it did not work".
  if not public.valid_org_cap(new.capability) then
    raise exception 'GR002: % is not a grantable capability', new.capability
      using errcode = 'GR002';
  end if;

  select m.user_id, m.role into v_target_user, v_target_role
    from public.organization_members m where m.id = new.member_id;

  -- G-3 — nobody grants themselves anything. Self-elevation, closed at the row.
  if v_target_user = v_actor then
    raise exception 'GR003: you cannot change your own capabilities'
      using errcode = 'GR003';
  end if;

  -- G-3 — an admin never edits an owner. Lateral capture, closed: without this
  -- an admin could DENY the owner's people.manage and lock them out of their own
  -- organization, which is G-4's failure mode reached through the grant table.
  if v_target_role = 'owner' and not public.actor_is_org_owner(new.organization_id) then
    raise exception 'GR004: only an owner may change an owner''s capabilities'
      using errcode = 'GR004';
  end if;

  -- G-1 — you cannot GRANT what you do not hold. Applied to grants only: a
  -- denial REDUCES another person's access, so the ceiling that matters is on
  -- giving. (S-R G-1 says "you cannot grant what you do not hold"; it does not
  -- say you cannot withhold what you lack, and the two are not symmetric.)
  if new.mode = 'grant' and not public.has_cap(new.capability) then
    raise exception 'GR001: you cannot grant % because you do not hold it', new.capability
      using errcode = 'GR001';
  end if;

  return new;
end
$fn$;

drop trigger if exists org_cap_grant_guard on public.org_member_cap_grants;
create trigger org_cap_grant_guard
  before insert or update on public.org_member_cap_grants
  for each row execute function public.guard_org_cap_grant();

-- ── the same four rules on the PORTAL grant table ──────────────────────────
create or replace function public.guard_client_cap_grant()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_actor uuid := auth.uid();
  v_target_user uuid;
  v_target_role text;
  v_target_client uuid;
begin
  if v_actor is null then return new; end if;

  if not public.valid_client_cap(new.capability) then
    raise exception 'GR002: % is not a grantable capability', new.capability
      using errcode = 'GR002';
  end if;

  select m.user_id, m.role, m.client_id
    into v_target_user, v_target_role, v_target_client
    from public.client_members m where m.id = new.member_id;

  if v_target_user = v_actor then
    raise exception 'GR003: you cannot change your own capabilities'
      using errcode = 'GR003';
  end if;

  -- TWO CEILINGS, not one (S-R §6). A client company's owner is bounded by their
  -- own set; the STUDIO's people.manage holder sits above them. So an owner of
  -- the company may act, OR a crew member holding people.manage may.
  if v_target_role = 'owner'
     and not public.actor_is_client_owner(v_target_client)
     and not public.has_cap('people.manage') then
    raise exception 'GR004: only the company''s owner or the studio may change an owner''s capabilities'
      using errcode = 'GR004';
  end if;

  -- G-1 on the portal side: a company owner may only give what they hold. A
  -- STUDIO actor holding people.manage is administering the company rather than
  -- delegating their own portal access, and holds no portal.* caps at all — so
  -- the ceiling that applies to them is the studio's, checked above.
  if new.mode = 'grant'
     and not public.has_cap('people.manage')
     and not public.has_cap(new.capability) then
    raise exception 'GR001: you cannot grant % because you do not hold it', new.capability
      using errcode = 'GR001';
  end if;

  return new;
end
$fn$;

drop trigger if exists client_cap_grant_guard on public.client_member_cap_grants;
create trigger client_cap_grant_guard
  before insert or update on public.client_member_cap_grants
  for each row execute function public.guard_client_cap_grant();

-- ── G-3 + G-4 on the CREW roster itself ────────────────────────────────────
create or replace function public.guard_org_member_change()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_actor uuid := auth.uid();
  v_owners int;
begin
  if v_actor is null then return coalesce(new, old); end if;

  if tg_op = 'UPDATE' then
    -- G-3 — nobody edits their OWN role, caps or status. Name and title are
    -- theirs to change; authority is not.
    if old.user_id = v_actor and (
         new.role is distinct from old.role
      or new.roles is distinct from old.roles
      or new.extra_caps is distinct from old.extra_caps
      or new.status is distinct from old.status
    ) then
      raise exception 'GR003: you cannot change your own role, capabilities or status'
        using errcode = 'GR003';
    end if;

    -- G-3 — an admin never edits an owner's row.
    if old.role = 'owner' and not public.actor_is_org_owner(old.organization_id) then
      raise exception 'GR004: only an owner may change an owner''s membership'
        using errcode = 'GR004';
    end if;
  end if;

  -- G-4 — never zero active owners.
  --
  -- THE COUNT CARRIES A STATUS FILTER, and Batch 7.5 is why: the old bootstrap
  -- counted rows without one, so a bootstrap owner's first invite made the
  -- roster non-empty and demoted them out of their own team management. A count
  -- that includes invited or revoked rows is not a count of owners.
  if (tg_op = 'DELETE')
     or (tg_op = 'UPDATE' and old.role = 'owner'
         and (new.role is distinct from 'owner' or new.status is distinct from 'active')) then
    select count(*) into v_owners
      from public.organization_members m
     where m.organization_id = coalesce(old.organization_id, new.organization_id)
       and m.status = 'active' and m.role = 'owner'
       and m.id <> old.id;
    if v_owners = 0 and old.role = 'owner' and old.status = 'active' then
      raise exception 'GR005: an organization must keep at least one active owner'
        using errcode = 'GR005';
    end if;
  end if;

  return coalesce(new, old);
end
$fn$;

drop trigger if exists org_member_change_guard on public.organization_members;
create trigger org_member_change_guard
  before update or delete on public.organization_members
  for each row execute function public.guard_org_member_change();

-- ── G-3 + G-4 on the PORTAL roster, per COMPANY ────────────────────────────
create or replace function public.guard_client_member_change()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_actor uuid := auth.uid();
  v_owners int;
begin
  if v_actor is null then return coalesce(new, old); end if;

  if tg_op = 'UPDATE' then
    if old.user_id = v_actor and (
         new.role is distinct from old.role
      or new.extra_caps is distinct from old.extra_caps
      or new.status is distinct from old.status
    ) then
      raise exception 'GR003: you cannot change your own role, capabilities or status'
        using errcode = 'GR003';
    end if;

    if old.role = 'owner'
       and not public.actor_is_client_owner(old.client_id)
       and not public.has_cap('people.manage') then
      raise exception 'GR004: only the company''s owner or the studio may change an owner''s membership'
        using errcode = 'GR004';
    end if;
  end if;

  -- G-4, scoped to the COMPANY: "a change leaving an organization, OR A CLIENT
  -- COMPANY, without an active owner is refused" (S-R §6 G-4).
  if (tg_op = 'DELETE')
     or (tg_op = 'UPDATE' and old.role = 'owner'
         and (new.role is distinct from 'owner' or new.status is distinct from 'active')) then
    select count(*) into v_owners
      from public.client_members m
     where m.client_id = old.client_id
       and m.status = 'active' and m.role = 'owner'
       and m.id <> old.id;
    if v_owners = 0 and old.role = 'owner' and old.status = 'active' then
      raise exception 'GR005: a client company must keep at least one active owner'
        using errcode = 'GR005';
    end if;
  end if;

  return coalesce(new, old);
end
$fn$;

drop trigger if exists client_member_change_guard on public.client_members;
create trigger client_member_change_guard
  before update or delete on public.client_members
  for each row execute function public.guard_client_member_change();

comment on function public.guard_org_member_change() is
  'Batch 24 item 7 (S-R §6 G-3/G-4). Refuses a self-edit of role/roles/extra_caps/status, an admin editing an owner, and any change leaving the org with zero ACTIVE owners (the status filter is Batch 7.5''s lesson). Service-role writes (auth.uid() null) pass through — every roster write the app makes today is service-role.';
