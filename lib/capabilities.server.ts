import 'server-only'

import { cache } from 'react'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { userOrgId } from '@/lib/auth/role'
import {
  CAP_RESOLUTION, ORG_ROLE_BASELINE, CLIENT_ROLE_BASELINE,
  LEGACY_ORG_CAP, LEGACY_CLIENT_CAP, OWNER_ONLY, UNMAPPED,
  type Capability, type OrgRole, type ClientRole, type OrgCap, type ClientCap,
} from '@/lib/capabilities'
// The ACTION→capability maps. lib/permissions.ts is client-safe and holds no
// authority since item 8; importing it here is a lookup, not a second oracle.
import { approvalActionCap, type ApprovalAction } from '@/lib/permissions'

/**
 * THE SINGLE RESOLVER — S-R §5 steps 0 and 4-6, server side.
 *
 * S-R §5's own rule: "The rail, the space landings, the route guards and the
 * policies all answer from the same computation. Three copies of a permission
 * check drift, and the first time the rail and the route disagree, neither is
 * trusted."
 *
 * ── WHAT THIS ANSWERS, AND WHAT IT DELIBERATELY DOES NOT ────────────────────
 *   step 0  active roster row in current_org()?          → here
 *   step 1  plan permits the feature                     → orgFeatureAllowed +
 *   step 2  organizations.type permits the space         →   requireOrgFeature
 *   step 3  seat_class permits                           → NOT BUILT (Batch 25)
 *   step 4  role baseline                                → here
 *   step 5  ∪ individual grants                          → here
 *   step 6  − individual denials, DENY WINS              → here
 *           └ ITEM 8's WHOLE POINT: this step has existed since Batch 25
 *             and three quarters of the application asked a function that
 *             skipped it. See lib/permissions.ts's header.
 *   step 7  project scope admits this ROW                → a FILTER, not a cap
 *                                                          (R-5a) — projectIds
 *
 * Steps 1-2 are plan and archetype entitlement, not capability, and item 4
 * leaves them where they are. Step 3 has no column yet: `seat_class` is Batch
 * 25, so every crew member currently resolves as though permanent — stated here
 * because a resolver that silently skips a step it claims to implement is worse
 * than one that names the gap.
 *
 * ── THIS MIRRORS public.has_cap() AND THE MIRROR IS A LIABILITY ─────────────
 * The BASELINES are single-sourced: role_baseline() is generated from
 * ORG_ROLE_BASELINE and `npm run check:caps` fails on drift. The RESOLUTION
 * ALGORITHM — union the baselines, union extra_caps, union live grants, then
 * subtract live denials — exists twice: here, and in 0051's has_cap(). It has to,
 * because they answer in different places: has_cap() inside a POLICY, where the
 * only thing available is auth.uid(); this one in TypeScript, where a route can
 * return a 403 that names the missing capability. Neither can call the other.
 *
 * So the two are kept honest by a PARITY CHECK rather than by care:
 * `npm run check:caps` signs in as each harness persona and asserts that this
 * function and the live has_cap() agree on every coarse cap. Proven to catch a
 * real divergence, not just to run: disabling the deny loop below made it report
 * exactly one mismatch and exit non-zero (Batch 24 item 3).
 *
 * DENY SUBTRACTS LAST (S-R R-3), which is what makes it beat extra_caps as well
 * as the baseline — and extra_caps is still dual-written as a projection of the
 * grant rows until a later batch drops it (S-R §10), so a denial that did not
 * subtract last could be defeated by the projection it governs.
 *
 * CAPABILITY IS RESOLVED FROM THE ROSTER, NEVER FROM THE TOKEN (S-R R-2). Only
 * the tenant comes from the claim, via userOrgId(). Memoised per REQUEST with
 * react/cache, the way getCurrentUser() and orgAccessOf() are — never across
 * requests, or a revoked capability would outlive its revocation.
 *
 * ── IT RUNS ON THE USER CLIENT, AND THAT IS NOT AN ACCIDENT ─────────────────
 * NO SERVICE ROLE HERE. This resolver reads only the caller's OWN rows, and
 * every one of those reads is already permitted by an UNGATED self-read policy:
 * organization_members_self_read (`user_id = auth.uid()`, 0012),
 * organization_member_projects_self_read, client_members_team_read, and
 * org/client_member_cap_grants_self_read from 0051. So AD-001 as WRITTEN — user
 * client, RLS is the boundary — is not merely possible here, it is simpler.
 *
 * The first draft imported supabaseAdmin and the I-8 ESLint ratchet refused it.
 * That refusal was right: a new service-role importer on the hottest
 * user-session path in the authorization layer is the opposite of what S2 §7 is
 * working toward, and the allowlist entry would have needed a justification that
 * does not exist. CLAUDE.md's rule for a NEW surface is AD-001, not the
 * surrounding pattern.
 *
 * `db` is injectable for exactly one caller: scripts/gen-capability-sql.ts's
 * parity check, which has no request context and therefore no cookies. It passes
 * the SAME anon session it asks has_cap() through, which makes the parity check
 * stronger than an injected service-role read would be — both sides then answer
 * for one RLS session, under the same policies.
 */

export type ResolvedCaps = {
  /** Which roster answered. null = no active row anywhere: deny everything. */
  side: 'crew' | 'portal' | null
  /** Crew roles held (primary + roles[]); empty portal-side. */
  roles: OrgRole[]
  /** Portal role, or null crew-side. */
  clientRole: ClientRole | null
  /** The resolved COARSE capability set (S-R §5 steps 4-6). */
  caps: ReadonlySet<string>
  memberId: string | null
  /** Step 7's filter, not a capability. null = all projects (the footgun:
   *  no rows means ALL, which is why scope_mode states it — S-R §10). */
  projectIds: string[] | null
  /** True only for an active roster row whose role is owner. platform.* keys
   *  are owner-only and ungrantable (G-2), so they are answered from this and
   *  never from the cap set. */
  isOwner: boolean
}

const DENIED: ResolvedCaps = {
  side: null, roles: [], clientRole: null, caps: new Set<string>(),
  memberId: null, projectIds: null, isOwner: false,
}

/** Accept a legacy snake_case value on read for one release (0051's alias
 *  table). A row written before the rename must keep resolving while a
 *  mid-deploy session is live; deletion is owed in HANDOFF §9. */
function normalizeOrgCap(v: string): string { return LEGACY_ORG_CAP[v] ?? v }
function normalizeClientCap(v: string): string { return LEGACY_CLIENT_CAP[v] ?? v }

export const resolveCaps = cache(async (
  user: User,
  /** Defaults to the cookie-bound user client. Injected only by the parity
   *  check, which has no request context and therefore no cookies. */
  db?: SupabaseClient,
): Promise<ResolvedCaps> => {
  const sb = db ?? (await createClient())
  const orgId = userOrgId(user)

  // ── crew side ────────────────────────────────────────────────────────────
  const { data: om } = await sb
    .from('organization_members')
    .select('id, role, roles, extra_caps, status, scope_mode')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (om && om.status === 'active') {
    const roles: OrgRole[] = [
      om.role as OrgRole,
      ...((Array.isArray(om.roles) ? om.roles : []) as OrgRole[]).filter((r) => r !== om.role),
    ]
    const caps = new Set<string>()
    for (const r of roles) for (const c of ORG_ROLE_BASELINE[r] ?? []) caps.add(c)
    for (const c of (Array.isArray(om.extra_caps) ? om.extra_caps : [])) caps.add(normalizeOrgCap(c))

    const { data: grants } = await sb
      .from('org_member_cap_grants')
      .select('capability, mode, expires_at')
      .eq('member_id', om.id)
      .is('revoked_at', null)
    const now = Date.now()
    const live = (grants ?? []).filter((g) => !g.expires_at || Date.parse(g.expires_at) > now)
    for (const g of live) if (g.mode === 'grant') caps.add(normalizeOrgCap(g.capability))
    // DENY LAST.
    for (const g of live) if (g.mode === 'deny') caps.delete(normalizeOrgCap(g.capability))

    let projectIds: string[] | null = null
    if (om.scope_mode === 'selected') {
      const { data: scoped } = await sb
        .from('organization_member_projects').select('project_id').eq('member_id', om.id)
      projectIds = (scoped ?? []).map((r) => r.project_id as string)
    }
    return {
      side: 'crew', roles, clientRole: null, caps, memberId: om.id, projectIds,
      isOwner: roles.includes('owner'),
    }
  }

  // ── portal side ──────────────────────────────────────────────────────────
  const { data: cm } = await sb
    .from('client_members')
    .select('id, role, extra_caps, status, scope_mode')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!cm || cm.status !== 'active') return DENIED

  const clientRole = cm.role as ClientRole
  const caps = new Set<string>()
  for (const c of CLIENT_ROLE_BASELINE[clientRole] ?? []) caps.add(c)
  for (const c of (Array.isArray(cm.extra_caps) ? cm.extra_caps : [])) caps.add(normalizeClientCap(c))

  const { data: grants } = await sb
    .from('client_member_cap_grants')
    .select('capability, mode, expires_at')
    .eq('member_id', cm.id)
    .is('revoked_at', null)
  const now = Date.now()
  const live = (grants ?? []).filter((g) => !g.expires_at || Date.parse(g.expires_at) > now)
  for (const g of live) if (g.mode === 'grant') caps.add(normalizeClientCap(g.capability))
  for (const g of live) if (g.mode === 'deny') caps.delete(normalizeClientCap(g.capability))

  let projectIds: string[] | null = null
  if (cm.scope_mode === 'selected') {
    const { data: scoped } = await sb
      .from('client_member_projects').select('project_id').eq('member_id', cm.id)
    projectIds = (scoped ?? []).map((r) => r.project_id as string)
  }
  return {
    side: 'portal', roles: [], clientRole, caps, memberId: cm.id, projectIds,
    isOwner: clientRole === 'owner',
  }
})

/**
 * THE ASSERTION EVERY ROUTE USES. Takes a FINE key (S-R §4's vocabulary of
 * questions) and resolves it to the coarse cap that answers it.
 *
 * Three outcomes, and the third is the one that matters:
 *   a coarse cap → held iff it is in the resolved set
 *   OWNER_ONLY   → the roster role must be owner, and no grant can confer it
 *                  (G-2: an admin who can grant the grant is an owner with
 *                  extra steps)
 *   UNMAPPED     → false. money.rates.read has no surface and no coarse cap;
 *                  "nothing answers true" is the correct answer until both
 *                  exist, and it must not fold into money.costs, which a
 *                  producer holds.
 */
export async function can(user: User, cap: Capability, db?: SupabaseClient): Promise<boolean> {
  const resolved = db ? await resolveCaps(user, db) : await resolveCaps(user)
  if (resolved.side === null) return false
  const target = CAP_RESOLUTION[cap]
  if (target === UNMAPPED) return false
  if (target === OWNER_ONLY) return resolved.isOwner
  return resolved.caps.has(target)
}

/** Coarse form, for the surfaces that genuinely grant/deny by stored cap —
 *  the grant picker. Prefer `can()` everywhere else: a fine key says what the
 *  caller actually does, and since Batch 26 item 8 it answers portal keys too. */
export async function hasCap(user: User, cap: OrgCap | ClientCap, db?: SupabaseClient): Promise<boolean> {
  const resolved = db ? await resolveCaps(user, db) : await resolveCaps(user)
  return resolved.side !== null && resolved.caps.has(cap)
}

/**
 * APPROVAL ACTIONS, RESOLVED — the direct replacement for `orgCanApproval` and
 * `clientCanApproval`, which Batch 26 item 8 deleted.
 *
 * Two questions, and keeping them apart is the whole point. `approvalActionCap`
 * answers "which stored capability does this ACTION need" — a map, in
 * lib/permissions.ts, and it was always right. This answers "does this PERSON
 * hold it" — and that is the half the two deleted functions got wrong, because
 * they ORed the role baseline with `extra_caps` and `extra_caps` carries grants
 * only. A denied assignee read as able to decide.
 *
 * That defect is on the record twice already: the R-11 sweep's first
 * implementation shipped it and was caught by probe (HANDOFF §6, Batch 25), and
 * `approvalActionCap` was exported specifically so the sweep could resolve the
 * set itself. Six other call sites went on asking the wrong function. This is
 * that export's reasoning made available to all of them instead of one.
 *
 * The client side's `'never'` sentinel is answered here rather than at each call
 * site: it means NO capability can grant the action (a client does not open an
 * approval against the studio's work, or move the deadline the studio promised),
 * which is a different fact from "this person lacks a capability" and must not be
 * flattened into a cap lookup that happens to miss.
 */
export async function canApproval(
  user: User, side: 'crew' | 'client', action: ApprovalAction,
): Promise<boolean> {
  const cap = side === 'crew' ? approvalActionCap('crew', action) : approvalActionCap('client', action)
  if (cap === 'never') return false
  return hasCap(user, cap)
}

/**
 * THE RESOLVED SET, AS A PROP — for the two rails, which are client components.
 *
 * `StudioSidebar` and the portal `Sidebar` used to receive roles + extraCaps and
 * re-derive authority in the browser through `orgCan`/`clientCan`. That put a
 * third copy of the resolution algorithm in the one place that cannot run the
 * resolver, and it was the copy that could not see a DENIAL: `extra_caps` is a
 * projection of the GRANT rows only (lib/grants.ts:149-153), so a deny row was
 * invisible to the rail and the tile stayed lit.
 *
 * Now the layout resolves once, server-side, and the rail filters on set
 * membership — which is not a capability decision, it is a lookup. A `Set` does
 * not cross the server/client boundary, so this returns an array.
 */
export async function capList(user: User): Promise<string[]> {
  return [...(await resolveCaps(user)).caps]
}

/**
 * ROUTE GATE — the message, not the control (S-R R-5).
 *
 * Returns null when the caller holds the capability, or a ready 403 NAMING what
 * is required when they do not. The row-level policies are the control; a route
 * that only returns an empty result leaves the caller unable to tell "nothing
 * here" from "not allowed", and leaves the next engineer unable to tell either.
 *
 * 403 and not 401: these callers are authenticated. A 401 tells a signed-in
 * person to sign in again, which is a bug report waiting to happen.
 */
export async function capGate(user: User, cap: Capability): Promise<{ error: string; cap: Capability } | null> {
  return (await can(user, cap)) ? null : { error: `You do not have permission for this. Required: ${cap}.`, cap }
}
