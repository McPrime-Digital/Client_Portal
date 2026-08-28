-- ============================================================================
-- 0022_access_token_hook.sql — S2 §8: the Custom Access Token Hook.
--
-- Governing: docs/specs/S2-authorization.md §8, S0 AD-001 consequence 1.
-- Runs after 0021. Forward-only and idempotent (I-12).
--
-- WHY THIS EXISTS, precisely. 0021 made the database the tenancy boundary:
-- every Class A and D policy now reads `organization_id = current_org()`, and
-- current_org() is `auth.jwt() -> 'app_metadata' ->> 'organization_id'`
-- (0001:35-37). A user whose token lacks that claim gets NULL, `col = NULL` is
-- NULL rather than true, and EVERY crew policy evaluates false. They do not get
-- an error. They log in to a working, empty application — the silent-empty
-- failure AD-001 exists to prevent, and the worst possible shape for a bug,
-- because it looks like "no data yet" to the person hitting it.
--
-- This is a SAFETY NET, not a repair. Verified against the live project before
-- writing: 13 auth users (7 real, 6 harness), 0 missing the claim, and both
-- invite routes stamp organization_id explicitly at creation
-- (app/api/admin/create-client/route.ts, app/api/admin/invite-client/route.ts).
-- Nothing is broken today. What this removes is the FAILURE CLASS: any future
-- path that creates a user without stamping the claim — a Supabase dashboard
-- invite, a social login, a seed script, an OAuth signup we have not built yet
-- — currently produces a silently empty account, and after this cannot.
--
-- THIS MIGRATION ALONE DOES NOT ACTIVATE THE HOOK. See "ENABLING" at the foot.
--
-- Do NOT touch the retired supabase/migrations/2026*_phaseN.sql series.
-- ============================================================================

begin;

-- ── the hook ────────────────────────────────────────────────────────────────
--
-- CONTRACT. GoTrue calls this once per access-token issue (login, and every
-- refresh) with
--     { "user_id": "<uuid>", "claims": { ... }, "authentication_method": "..." }
-- and uses whatever `claims` we return. Anything not returned is dropped, so
-- the function must thread the event through rather than build claims fresh.
--
-- PRECEDENCE, and this is the part worth arguing about. The roster wins over
-- the stored app_metadata claim, not the other way round. If the two disagree
-- — roster says org A, existing claim says org B — the user is TODAY failing
-- every crew policy, because is_org_member() joins the roster row against
-- current_org() and the two do not meet. Preferring the claim would preserve
-- that broken state forever; preferring the roster repairs it at next refresh.
-- CLAUDE.md states the rule this follows: the table is truth, the JWT only
-- routes. The stored claim is used only as the last fallback, for a user with
-- no roster row on either side of the house.
--
-- WHAT IS DELIBERATELY NOT TOUCHED: app_metadata.role. It is the trust anchor
-- lib/auth/role.ts and public.is_admin() read, it is set by the invite routes,
-- and deriving it from roster presence here would flip a person's admin bit as
-- a side effect of a roster edit. Out of scope for a safety net.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  -- nullif(..., 'null') as well as coalesce: an absent key gives SQL NULL, but
  -- a key present and set to JSON null gives the scalar 'null'::jsonb, and
  -- jsonb_set on a scalar raises. Both must land on '{}'.
  claims   jsonb := coalesce(nullif(event -> 'claims', 'null'::jsonb), '{}'::jsonb);
  app_meta jsonb := coalesce(nullif(event -> 'claims' -> 'app_metadata', 'null'::jsonb), '{}'::jsonb);
  uid      uuid;
  org      uuid;
  crew     record;
begin
  uid := nullif(event ->> 'user_id', '')::uuid;
  if uid is null then
    return event;
  end if;

  -- 1 · crew roster. organization_members.user_id is UNIQUE (0012:17), so this
  --     is at most one row and needs no tie-break. 'revoked' is excluded: a
  --     revoked member is no longer of that tenant. 'invited' and 'paused' are
  --     INCLUDED on purpose — the claim answers "which tenant is this person
  --     of", not "may they read anything". Whether they may read is decided by
  --     is_org_member(), which requires status = 'active' independently. A
  --     paused member therefore carries a correct org and still reads nothing,
  --     and reinstating them is a roster flip rather than a roster flip plus a
  --     token that has to be re-derived from scratch.
  select m.organization_id, m.role, m.roles, m.status
    into crew
  from public.organization_members m
  where m.user_id = uid
    and m.status <> 'revoked'
  limit 1;

  org := crew.organization_id;

  -- 2 · client-side roster. Unlike the crew table, client_members.user_id has
  --     no UNIQUE constraint, so a person may hold several rows. Ordering is
  --     explicit rather than incidental: a row already agreeing with the
  --     stored claim wins (so an established session keeps its tenant), then
  --     oldest. Never `limit 1` off an unordered scan for a security claim.
  if org is null then
    select c.organization_id
      into org
    from public.client_members c
    where c.user_id = uid
      and c.status <> 'revoked'
    order by
      (c.organization_id::text = (app_meta ->> 'organization_id')) desc,
      c.created_at asc
    limit 1;
  end if;

  -- 3 · primary client login (clients.user_id), the pre-teams path.
  if org is null then
    select cl.organization_id
      into org
    from public.clients cl
    where cl.user_id = uid
    limit 1;
  end if;

  -- 4 · last resort: whatever the token already carried. Leaves a user with no
  --     roster row anywhere exactly as they are — this hook never REMOVES a
  --     claim, it only supplies a missing one or corrects it from the roster.
  if org is null then
    org := nullif(app_meta ->> 'organization_id', '')::uuid;
  end if;

  if org is not null then
    app_meta := jsonb_set(app_meta, '{organization_id}', to_jsonb(org::text), true);
  end if;

  -- roles[] — ADVISORY ONLY, and it must stay that way until something
  -- deliberately opts in. Nothing reads this claim today: lib/permissions.ts
  -- resolves roles through orgAccessOf() and the RLS helpers read the roster
  -- directly, both of which see a role change on the next query. A JWT claim
  -- does not; see STALENESS below. It is stamped because a policy that wants
  -- to avoid a roster subquery will want it, and because it makes a token
  -- self-describing when debugging an empty screen. Only 'active' members get
  -- roles: unlike the org claim, this one is about permission, so it tracks
  -- the same status gate the helpers use.
  app_meta := jsonb_set(
    app_meta,
    '{roles}',
    case
      when crew.status = 'active'
        then to_jsonb(array_remove(array[crew.role] || coalesce(crew.roles, '{}'::text[]), null))
      else '[]'::jsonb
    end,
    true
  );

  claims := jsonb_set(claims, '{app_metadata}', app_meta, true);
  return jsonb_set(event, '{claims}', claims, true);

exception
  when others then
    -- A raised exception here does not fail one query — GoTrue cannot issue the
    -- token, and NOBODY IN ANY TENANT CAN LOG IN. That is a strictly worse
    -- outcome than an un-enriched token, which merely leaves the user in the
    -- state they were in before this file existed. So the failure is absorbed
    -- and the event returned untouched.
    --
    -- This is the one place the I-10 "no silent catch" rule is deliberately
    -- inverted, and it is not silent: raise log writes to the Postgres log with
    -- the user and SQLSTATE, which is the only sink available inside a GoTrue
    -- hook (it has no HTTP context and no error reporter). If tenants report
    -- empty Workspaces, this log line is the first thing to grep.
    raise log 'custom_access_token_hook failed for user %: % (%)', uid, sqlerrm, sqlstate;
    return event;
end;
$$;

comment on function public.custom_access_token_hook(jsonb) is
  'S2 §8. Stamps app_metadata.organization_id (roster-first) and advisory app_metadata.roles at token issue, so current_org() can never be NULL for a user with a roster row. Claims are stale until refresh — see 0022 header.';

-- ── grants ──────────────────────────────────────────────────────────────────
-- GoTrue calls this as supabase_auth_admin, which is not otherwise a user of
-- the public schema. The revoke matters: `create function` grants EXECUTE to
-- PUBLIC by default, and an end user able to call this could feed it a
-- fabricated event. It returns claims rather than a token, so that is not
-- itself escalation, but a security definer function reading roster rows is not
-- something to leave world-callable.
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

commit;

-- ============================================================================
-- ENABLING — REQUIRED, AND NOT DONE BY THIS FILE
--
-- Applying this migration creates the function and nothing else. Until the hook
-- is registered, GoTrue never calls it and this file is inert. Do not record
-- S2 §8 as done on the strength of the migration having run.
--
--   Hosted:  Dashboard → Authentication → Hooks → Customize Access Token (JWT)
--            Claims → select `public.custom_access_token_hook` → Enable.
--   Local:   supabase/config.toml
--              [auth.hook.custom_access_token]
--              enabled = true
--              uri = "pg-functions://postgres/public/custom_access_token_hook"
--            (the repo has no config.toml today — it has no Supabase CLI setup)
--
-- Verify after enabling: sign in as a user, decode the access token, and check
-- app_metadata.organization_id is present. supabase/checks/0022_verify.sql
-- covers the database half; the claim itself can only be confirmed from a real
-- token, so 0022_verify.sql ends with that instruction rather than pretending.
--
-- ============================================================================
-- STALENESS — the property that makes claims different from table reads
--
-- A claim is fixed at token issue and stays fixed for the token's whole life.
-- Between issue and refresh, the roster and the JWT can disagree, and every
-- consumer of the claim reads the OLD value:
--
--   • Pausing or revoking a crew member does NOT cut their org claim mid-token.
--     This is why 0020's is_org_member() reads organization_members.status on
--     every call instead of trusting a claim — revocation takes effect on the
--     next query, not the next refresh. That property must be preserved: no
--     authorization may move from the roster to app_metadata.roles.
--   • A role grant or removal is invisible until refresh, for the same reason.
--
-- So anything that starts consuming app_metadata.roles needs ONE of:
--   (a) a short access-token TTL — Supabase default is 3600s; the window is
--       whatever TTL is configured, and shortening it costs refresh traffic; or
--   (b) a forced refresh on the roles-changed event — the writer that edits a
--       roster row also calls supabase.auth.refreshSession() for that user, or
--       signs them out. Deterministic, and the only option that closes the
--       window rather than shrinking it.
-- Until one of those exists, app_metadata.roles stays advisory. It is stamped,
-- it is documented, and nothing authorizes on it.
--
-- MULTI-ORG SWITCHING (v2) MUST NOT USE A CLAIM.
-- When a person belongs to several organizations, "which org am I in right
-- now" cannot be a JWT claim. Two reasons, and the second is the one that
-- decides it:
--   1. Latency. Switching org would require a token refresh, so every switch
--      is a round trip to the auth server before any data can load.
--   2. Revocation. Removing someone from org A while they hold a token minted
--      for org A leaves them reading org A until that token expires. A claim
--      cannot be withdrawn; only waited out.
-- The resolution is a URL segment (/studio/:orgSlug/...) validated against the
-- roster on every request: it changes instantly, it is revocable instantly, and
-- it makes the active tenant visible in the address bar rather than hidden in a
-- token. current_org() would then read that resolved value rather than a claim.
-- The single-org claim below is correct only while a user belongs to exactly
-- one org, which organization_members.user_id UNIQUE currently enforces.
-- ============================================================================
