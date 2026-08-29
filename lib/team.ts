import 'server-only'

import { cache } from 'react'

import type { User } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isAdmin, userClientId, userOrgId } from '@/lib/auth/role'

// Server-side role resolution for teams & roles. THE TABLE IS TRUTH: every
// gate that protects an action reads these, never the JWT (app_metadata only
// routes/identifies). A revoked member is dead the moment the row flips.

export type OrgRole = 'owner' | 'admin' | 'producer' | 'member'
export type ClientRole = 'owner' | 'approver' | 'member' | 'viewer'

/** Every org-side role this admin user holds (primary + additional).
 *
 *  THE ROSTER IS THE ONLY SOURCE. No active `organization_members` row means no
 *  roles — empty array — for a non-admin, an inactive member, and an admin
 *  claim with no row alike.
 *
 *  There used to be a fallback here: no row inferred `['owner']` when the org's
 *  roster was empty and `['member']` otherwise. It existed because nothing in
 *  the codebase could create an organization, so the first admin of a new
 *  tenant had no other way to become its owner. `scripts/provision-tenant.ts`
 *  now writes that roster row, which is what made deleting the inference
 *  possible (Batch 7 item 5 — step 1 before step 3, deliberately).
 *
 *  Deleting it closes two holes. A removed crew member whose claim survived the
 *  cut kept member-level studio access; so did anyone whose row was deleted by
 *  hand. And the `['owner']` half was itself a trap: the count it read had no
 *  status filter, so a bootstrap owner's first invite made the roster non-empty
 *  and demoted them to 'member' — out of their own org's team management.
 *
 *  Scoped to the caller's claim org and `maybeSingle()`, not `.single()`: zero
 *  rows is an ordinary answer here, not an error to be inferred from. The org
 *  predicate is explicit per I-9 and is the seam S1 §2 needs for multi-org (v2)
 *  — verified 2026-08-28 that every admin's claim org matches their roster row,
 *  so it narrows nothing today. */
export async function orgRolesOf(user: User): Promise<OrgRole[]> {
  if (!isAdmin(user)) return []
  const { data } = await supabaseAdmin
    .from('organization_members')
    .select('role, roles, status')
    .eq('user_id', user.id)
    .eq('organization_id', userOrgId(user))
    .maybeSingle()
  if (!data || data.status !== 'active') return []
  const extras = Array.isArray((data as { roles?: string[] }).roles)
    ? ((data as { roles?: string[] }).roles as OrgRole[])
    : []
  return [data.role as OrgRole, ...extras.filter((r) => r !== data.role)]
}

/** The primary org-side role (first of orgRolesOf), or null. */
export async function orgRoleOf(user: User): Promise<OrgRole | null> {
  const roles = await orgRolesOf(user)
  return roles[0] ?? null
}

export type OrgAccess = {
  roles: OrgRole[]
  /** Owner-granted capabilities on top of the roles (custom access). */
  extraCaps: string[]
  /** Custom role name for the UI; null = the primary role's standard label. */
  title: string | null
  /** Projects this crew member may see; null = all of the org's projects.
   *  An empty array means none — see the scope_mode note on portalAccess. */
  projectIds: string[] | null
}

/** Roles + custom grants + custom title + project scope in one read.
 *
 *  Memoised per request: app/studio/layout.tsx and lib/studio/guard.ts both
 *  resolve this on every admin page load, and it costs 2-3 queries each time.
 *  Keyed on the user object, which getCurrentUser() keeps stable per request. */
export const orgAccessOf = cache(async (user: User): Promise<OrgAccess> => {
  const roles = await orgRolesOf(user)
  if (roles.length === 0) return { roles, extraCaps: [], title: null, projectIds: null }
  const { data } = await supabaseAdmin
    .from('organization_members')
    .select('id, extra_caps, title, scope_mode')
    .eq('user_id', user.id)
    .single()
  let projectIds: string[] | null = null
  if (data?.scope_mode === 'selected') {
    const { data: scoped } = await supabaseAdmin
      .from('organization_member_projects')
      .select('project_id')
      .eq('member_id', data.id)
    projectIds = (scoped ?? []).map((r) => r.project_id)
  }
  return {
    roles,
    extraCaps: Array.isArray(data?.extra_caps) ? data!.extra_caps : [],
    title: data?.title ?? null,
    projectIds,
  }
})

/** True when the admin may manage the org team / settings / billing. */
export function canManageOrg(role: OrgRole | OrgRole[] | null): boolean {
  const list = Array.isArray(role) ? role : role ? [role] : []
  return list.includes('owner') || list.includes('admin')
}

export type ClientMembership = {
  clientId: string
  role: ClientRole
  /** The member's OWN display name — never the company owner's. */
  name: string
  /** Owner-granted capabilities on top of the role (custom access). */
  extraCaps: string[]
  /** Custom role name shown in the UI; null = the role's standard label. */
  title: string | null
}

/** The member's display name, THE ROSTER FIRST.
 *
 *  `user_metadata` is user-editable — `supabase.auth.updateUser({ data })` is a
 *  browser call — so preferring it let anyone choose the name that gets written
 *  into `messages.sender_name` and into `activity_log.actor_name` on every
 *  approval and change request they make. Batch 6.1 closed that on the ledger
 *  route by resolving from the roster; this closes it everywhere else, because
 *  `ownName()` feeds the same two persisted fields through
 *  `app/api/portal/actions/route.ts:28`.
 *
 *  `roster` is the `client_members.name` an admin or company owner set when
 *  they invited the person — a name the subject cannot rewrite. It wins
 *  whenever it holds anything; `user_metadata` survives only as the fallback
 *  for a roster row with no name, where the alternative is an email prefix. */
function ownName(user: User, roster: string | null | undefined): string {
  return (
    roster?.trim() ||
    (user.user_metadata?.name as string | undefined) ||
    user.email?.split('@')[0] ||
    'Member'
  )
}

/** Resolve the client company + this user's role in it. client_members is the
 *  SOLE authority (S1 §5.2): the clients.user_id primary-login branches are
 *  gone — the 0012 backfill put every primary login in client_members as an
 *  owner (re-verified against production in Batch 6 before this landed), so a
 *  primary login is just a member whose row says owner. clients.user_id is
 *  DEPRECATED: nothing reads it; the column drops in Batch 7. */
type MemberRow = {
  client_id: string
  role: string
  status?: string
  name: string | null
  extra_caps?: string[] | null
  title?: string | null
}

function fromRow(user: User, m: MemberRow): ClientMembership {
  return {
    clientId: m.client_id,
    role: m.role as ClientRole,
    name: ownName(user, m.name),
    extraCaps: Array.isArray(m.extra_caps) ? m.extra_caps : [],
    title: m.title ?? null,
  }
}

export async function clientMembershipOf(user: User): Promise<ClientMembership | null> {
  const claimed = userClientId(user as never)
  if (claimed) {
    const { data: m } = await supabaseAdmin
      .from('client_members')
      .select('client_id, role, status, name, extra_caps, title')
      .eq('client_id', claimed)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    return m ? fromRow(user, m as MemberRow) : null
  }
  // Legacy sessions without the client_id claim. DETERMINISTIC on multiple
  // memberships: oldest active row wins. The old .single() ERRORED on two
  // rows and resolved the person to no client at all — which took uploads
  // down with it via lib/uploadScope.ts (S0-A §2).
  const { data: m } = await supabaseAdmin
    .from('client_members')
    .select('client_id, role, name, extra_caps, title')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return m ? fromRow(user, m as MemberRow) : null
}

// Matches no row — lookups against it behave exactly like today's failed
// user_id lookup (no client found) without null-handling at every call site.
const NO_CLIENT = '00000000-0000-0000-0000-000000000000'

/** The client company id this user belongs to (primary login or teammate). */
export async function portalClientId(user: User): Promise<string> {
  const m = await clientMembershipOf(user)
  return m?.clientId ?? NO_CLIENT
}

export type PortalAccess = {
  clientId: string
  role: ClientRole
  /** The member's OWN display name — never the company owner's. */
  name: string
  /** Owner-granted capabilities on top of the role (custom access). */
  extraCaps: string[]
  /** Custom role name for the UI; null = the role's standard label. */
  title: string | null
  /** Only messages at/after this instant are visible; null = full history. */
  historyFrom: string | null
  /** Projects this member may see; null = all of the company's projects. */
  projectIds: string[] | null
}

/** The member's full access context — role, message-history cutoff, project
 *  scope. Pages apply `projectIds` with .in() and `historyFrom` with .gte();
 *  null means unscoped. EVERY role resolves through its membership row —
 *  owners included, so a billing-contact owner CAN now be given a narrower
 *  role or a project scope (S1 §5.2; the old owner short-circuit hardcoded
 *  historyFrom/projectIds to null for every owner).
 *
 *  Scope is STATED, not inferred (migration 0018 A5). scope_mode 'all' means
 *  every project; 'selected' means exactly the client_member_projects rows —
 *  including none of them. Previously an empty scoping set was read as "all",
 *  so deleting a member's scoping rows silently granted them the whole
 *  company instead of revoking their access. */
export async function portalAccess(user: User): Promise<PortalAccess | null> {
  const membership = await clientMembershipOf(user)
  if (!membership) return null
  const { data: m } = await supabaseAdmin
    .from('client_members')
    .select('id, history_from, scope_mode')
    .eq('client_id', membership.clientId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  let projectIds: string[] | null = null
  if (m?.scope_mode === 'selected') {
    const { data: scoped } = await supabaseAdmin
      .from('client_member_projects')
      .select('project_id')
      .eq('member_id', m.id)
    projectIds = (scoped ?? []).map((r) => r.project_id)
  }
  return {
    clientId: membership.clientId,
    role: membership.role,
    name: membership.name,
    extraCaps: membership.extraCaps,
    title: membership.title,
    historyFrom: m?.history_from ?? null,
    projectIds,
  }
}

/** Same resolution from a bare user id (for helpers without the User object).
 *  Every upload authorization routes through here (lib/uploadScope.ts), so the
 *  old clients.user_id-then-.single() shape mattered: two active memberships
 *  errored into NO_CLIENT and 403'd every upload. Oldest active row wins. */
export async function portalClientIdByUserId(userId: string): Promise<string> {
  const { data: m } = await supabaseAdmin
    .from('client_members')
    .select('client_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return m?.client_id ?? NO_CLIENT
}

/** True when this client role may approve deliverables / request changes. */
export function canApprove(role: ClientRole): boolean {
  return role === 'owner' || role === 'approver'
}
