import 'server-only'

import type { User } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isAdmin, userClientId } from '@/lib/auth/role'

// Server-side role resolution for teams & roles. THE TABLE IS TRUTH: every
// gate that protects an action reads these, never the JWT (app_metadata only
// routes/identifies). A revoked member is dead the moment the row flips.

export type OrgRole = 'owner' | 'admin' | 'producer' | 'member'
export type ClientRole = 'owner' | 'approver' | 'member' | 'viewer'

/** Every org-side role this admin user holds (primary + additional).
 *  LEAST PRIVILEGE by default: an admin with no membership row is 'member' —
 *  unless the roster is completely empty (fresh environment), where the sole
 *  admin bootstraps as owner. Empty array for non-admins / inactive members. */
export async function orgRolesOf(user: User): Promise<OrgRole[]> {
  if (!isAdmin(user)) return []
  const { data } = await supabaseAdmin
    .from('organization_members')
    .select('role, roles, status')
    .eq('user_id', user.id)
    .single()
  if (!data) {
    const { count } = await supabaseAdmin
      .from('organization_members')
      .select('*', { count: 'exact', head: true })
    return (count ?? 0) === 0 ? ['owner'] : ['member']
  }
  if (data.status !== 'active') return []
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
}

/** Roles + custom grants + custom title in one read. */
export async function orgAccessOf(user: User): Promise<OrgAccess> {
  const roles = await orgRolesOf(user)
  if (roles.length === 0) return { roles, extraCaps: [], title: null }
  const { data } = await supabaseAdmin
    .from('organization_members')
    .select('extra_caps, title')
    .eq('user_id', user.id)
    .single()
  return {
    roles,
    extraCaps: Array.isArray(data?.extra_caps) ? data!.extra_caps : [],
    title: data?.title ?? null,
  }
}

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

function ownName(user: User, fallback: string | null | undefined): string {
  return (
    (user.user_metadata?.name as string | undefined) ??
    fallback ??
    user.email?.split('@')[0] ??
    'Member'
  )
}

/** Resolve the client company + this user's role in it. Legacy primary logins
 *  (clients.user_id) are owners; invited teammates come from client_members. */
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
    const { data: c } = await supabaseAdmin
      .from('clients')
      .select('id, user_id, name')
      .eq('id', claimed)
      .single()
    if (c?.user_id === user.id) {
      return { clientId: c.id, role: 'owner', name: ownName(user, c.name), extraCaps: [], title: null }
    }
    const { data: m } = await supabaseAdmin
      .from('client_members')
      .select('client_id, role, status, name, extra_caps, title')
      .eq('client_id', claimed)
      .eq('user_id', user.id)
      .single()
    if (m && m.status === 'active') return fromRow(user, m as MemberRow)
    return null
  }
  // legacy sessions without the client_id claim
  const { data: c } = await supabaseAdmin
    .from('clients')
    .select('id, name')
    .eq('user_id', user.id)
    .single()
  if (c) return { clientId: c.id, role: 'owner', name: ownName(user, c.name), extraCaps: [], title: null }
  const { data: m } = await supabaseAdmin
    .from('client_members')
    .select('client_id, role, name, extra_caps, title')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()
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
 *  null means unscoped. Primary logins (clients.user_id) are never scoped. */
export async function portalAccess(user: User): Promise<PortalAccess | null> {
  const membership = await clientMembershipOf(user)
  if (!membership) return null
  if (membership.role === 'owner') {
    return {
      clientId: membership.clientId, role: 'owner', name: membership.name,
      extraCaps: [], title: null, historyFrom: null, projectIds: null,
    }
  }
  const { data: m } = await supabaseAdmin
    .from('client_members')
    .select('id, history_from')
    .eq('client_id', membership.clientId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()
  let projectIds: string[] | null = null
  if (m) {
    const { data: scoped } = await supabaseAdmin
      .from('client_member_projects')
      .select('project_id')
      .eq('member_id', m.id)
    if (scoped && scoped.length > 0) projectIds = scoped.map((r) => r.project_id)
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

/** Same resolution from a bare user id (for helpers without the User object). */
export async function portalClientIdByUserId(userId: string): Promise<string> {
  const { data: c } = await supabaseAdmin.from('clients').select('id').eq('user_id', userId).single()
  if (c) return c.id
  const { data: m } = await supabaseAdmin
    .from('client_members')
    .select('client_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single()
  return m?.client_id ?? NO_CLIENT
}

/** True when this client role may approve deliverables / request changes. */
export function canApprove(role: ClientRole): boolean {
  return role === 'owner' || role === 'approver'
}
