-- ============================================================================
-- 0026_drop_clients_user_id.sql — Batch 8 item 6: retire the deprecated
-- primary-login pointer.
--
-- Governing: S1 §5.2 (client_members is the sole authority), S1 §10 q2,
-- S2 §11 q4 — both close here. Runs after 0025. Forward-only, idempotent
-- (I-12).
--
-- Printed as 0025 in Batch 7 and never applied; renumbered to 0026 so that
-- 0025_client_member_presence.sql, which must be applied first, keeps filename
-- order equal to apply order.
--
-- ── WHY IT IS SAFE NOW ──────────────────────────────────────────────────────
--   · 0020:110 dropped the `or clients.user_id = auth.uid()` branch from
--     is_client_member(); 0021 replaced every client-side policy that keyed on
--     the column (0021:120, :431-437), and 0021:474 deliberately refused it an
--     UPDATE grant, so no `authenticated` session can write it.
--   · Batch 6.8 removed lib/team.ts's primary-login branches.
--   · Batch 7.6 moved auth/callback and onboarding/page.
--   · Batch 8.1 made BOTH create paths write the paired client_members row —
--     the precondition that blocked this file. It was not a backfill gap: the
--     create path had never written one, so every company created after 6.8
--     shipped would have had no membership at all.
--   · Batch 8.2/8.3 moved the last three readers (presence/heartbeat,
--     lib/notify, delete-client) plus one the earlier greps missed,
--     ProjectDetail.tsx:399, which reached the column through `select('*')`.
--   · Batch 8.6 removed the two insert-time writers, the Client type field and
--     the harness seed's primary-login step.
--
-- Live state, read 2026-08-28: all 8 client companies have an active `owner`
-- in client_members, and every clients.user_id value appears on one of those
-- rows. Nothing is lost by the drop.
--
-- ── THE HOOK, AND WHY IT IS IN THIS FILE ────────────────────────────────────
-- 0022's custom_access_token_hook — ENABLED IN PRODUCTION, called by GoTrue on
-- every login and every token refresh — reads clients.user_id at 0022:111-118
-- as its third org-resolution fallback.
--
-- No guard would have caught it. Postgres does not track column dependencies
-- inside a PL/pgSQL body, so `drop column` succeeds and the function breaks at
-- its NEXT call; and the previous version of this file scanned pg_policies
-- only, which is a different catalog. The failure would then have been silent
-- in the worst way: the hook's own `exception when others` handler (0022:154,
-- deliberately there so a hook fault can never lock everyone out) would absorb
-- the 42703 and return the event unenriched — for EVERY user, not just primary
-- logins. Nobody would be locked out; they would log in to a working, empty
-- application, which is the exact failure AD-001 and 0022 exist to prevent.
--
-- Step 3 is redundant as well as fatal: step 2 already resolves the org from
-- client_members, which since 8.1 every client login has. It is removed here,
-- in the same transaction as the drop, so no window exists between them.
-- Everything else in the function is byte-identical to 0022.
--
-- ── BEFORE APPLYING — one check the repo cannot make ────────────────────────
-- Policies and function bodies are live state. Run this first; expect 0 rows:
--
--   select 'policy' as kind, policyname as name from pg_policies
--    where schemaname = 'public'
--      and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~ 'clients[^;]*user_id'
--      and policyname <> 'users_manage_own_push'
--   union all
--   select 'function', p.proname from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.prosrc ~ 'clients[^;]*user_id'
--      and p.proname <> 'custom_access_token_hook';   -- replaced below
--
-- A hit here means a live object still reads the column. Stop and move it.
-- ============================================================================

begin;

-- ── 1 · the access-token hook loses its clients.user_id fallback ────────────
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
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
  --     is at most one row. 'revoked' excluded; 'invited'/'paused' included —
  --     the claim answers "which tenant is this person of", not "may they read
  --     anything". See the 0022 header for the full argument.
  select m.organization_id, m.role, m.roles, m.status
    into crew
  from public.organization_members m
  where m.user_id = uid
    and m.status <> 'revoked'
  limit 1;

  org := crew.organization_id;

  -- 2 · client-side roster. client_members.user_id has no UNIQUE constraint,
  --     so a person may hold several rows: a row already agreeing with the
  --     stored claim wins, then oldest. Never `limit 1` off an unordered scan
  --     for a security claim.
  --
  --     THIS IS NOW THE ONLY CLIENT-SIDE SOURCE. 0022's step 3 fell back to
  --     clients.user_id; that column is dropped below. The fallback was already
  --     unreachable — every live company's primary login holds an active owner
  --     row here, and since Batch 8.1 both create paths write one before the
  --     claim is stamped — and leaving it would have broken token enrichment
  --     for everyone the moment the column went, absorbed by the exception
  --     handler at the foot of this function.
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

  -- 3 · last resort: whatever the token already carried. This hook never
  --     REMOVES a claim; it supplies a missing one or corrects it from the
  --     roster.
  if org is null then
    org := nullif(app_meta ->> 'organization_id', '')::uuid;
  end if;

  if org is not null then
    app_meta := jsonb_set(app_meta, '{organization_id}', to_jsonb(org::text), true);
  end if;

  -- roles[] — ADVISORY ONLY. Nothing authorizes on it; see 0022's STALENESS
  -- section before anything starts to.
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
    -- token and NOBODY IN ANY TENANT CAN LOG IN. Absorbed deliberately; the
    -- raise log below is the only sink available inside a GoTrue hook.
    raise log 'custom_access_token_hook failed for user %: % (%)', uid, sqlerrm, sqlstate;
    return event;
end;
$$;

comment on function public.custom_access_token_hook(jsonb) is
  'S2 §8. Stamps app_metadata.organization_id (roster-first) and advisory app_metadata.roles at token issue. Client-side org resolves from client_members only — 0026 removed the clients.user_id fallback with the column. Claims are stale until refresh; see 0022 header.';

-- Grants are re-asserted: `create or replace` keeps existing ACLs, but a future
-- environment built from these files forward must not depend on 0022 having
-- run first for the hook to be callable.
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

-- ── 2 · the column ─────────────────────────────────────────────────────────
-- Postgres drops the dependent objects with it: clients_user_id_fkey (0000:270)
-- and idx_clients_user_id (0000:293).
alter table public.clients drop column if exists user_id;

notify pgrst, 'reload schema';

commit;

-- ── TABLE-SHAPE CHANGE — deploy discipline (the Batch 2 lesson) ─────────────
--   1. Apply 0025 and deploy the Batch 8 code FIRST, and let it settle. That
--      code no longer reads or writes this column anywhere.
--   2. Apply this migration.
--   3. Reload the PostgREST schema cache immediately (`notify pgrst` above does
--      it in-transaction; confirm in the dashboard) — a stale cache keeps
--      advertising the dropped column and every insert naming it fails.
--
-- ── VERIFY AFTER APPLYING ───────────────────────────────────────────────────
-- 1. The column is gone:
--      select count(*) from information_schema.columns
--       where table_schema='public' and table_name='clients' and column_name='user_id';
--      -- expect: 0
--
-- 2. Token issue still enriches. This is the half that would fail silently, so
--    it is checked from a real token, not from the database: sign in as a
--    CLIENT (not an admin), decode the access token, and confirm
--    app_metadata.organization_id is present. Then check the Postgres log for
--    'custom_access_token_hook failed' — it must be absent.
--
-- 3. Creating a client company still yields a usable login end to end:
--    create one, accept the invite, and confirm the portal is not empty. The
--    membership row is what makes that work now:
--      select c.name, m.email, m.role, m.status
--        from public.clients c
--        join public.client_members m on m.client_id = c.id
--       where c.created_at > now() - interval '1 hour';
