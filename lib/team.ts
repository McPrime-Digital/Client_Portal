import 'server-only'

import type { User } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isAdmin, userClientId } from '@/lib/auth/role'

// Server-side role resolution for teams & roles. THE TABLE IS TRUTH: every
// gate that protects an action reads these, never the JWT (app_metadata only
// routes/identifies). A revoked member is dead the moment the row flips.

export type OrgRole = 'owner' | 'admin' | 'producer' | 'member'
export type ClientRole = 'owner' | 'approver' | 'member' | 'viewer'

/** The org-side role of an admin user. Bootstrap: an admin with no membership
 *  row (pre-teams account) is treated as owner. Null for non-admins. */
export async function orgRoleOf(user: User): Promise<OrgRole | null> {
  if (!isAdmin(user)) return null
  const { data } = await supabaseAdmin
    .from('organization_members')
    .select('role, status')
    .eq('user_id', user.id)
    .single()
  if (!data) return 'owner'
  if (data.status !== 'active') return null
  return data.role as OrgRole
}

/** True when the admin may manage the org team / settings / billing. */
export function canManageOrg(role: OrgRole | null): boolean {
  return role === 'owner' || role === 'admin'
}

/** Resolve the client company + this user's role in it. Legacy primary logins
 *  (clients.user_id) are owners; invited teammates come from client_members. */
export async function clientMembershipOf(
  user: User
): Promise<{ clientId: string; role: ClientRole } | null> {
  const claimed = userClientId(user as never)
  if (claimed) {
    const { data: c } = await supabaseAdmin
      .from('clients')
      .select('id, user_id')
      .eq('id', claimed)
      .single()
    if (c?.user_id === user.id) return { clientId: c.id, role: 'owner' }
    const { data: m } = await supabaseAdmin
      .from('client_members')
      .select('client_id, role, status')
      .eq('client_id', claimed)
      .eq('user_id', user.id)
      .single()
    if (m && m.status === 'active') return { clientId: m.client_id, role: m.role as ClientRole }
    return null
  }
  // legacy sessions without the client_id claim
  const { data: c } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('user_id', user.id)
    .single()
  if (c) return { clientId: c.id, role: 'owner' }
  const { data: m } = await supabaseAdmin
    .from('client_members')
    .select('client_id, role')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()
  return m ? { clientId: m.client_id, role: m.role as ClientRole } : null
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
    return { clientId: membership.clientId, role: 'owner', historyFrom: null, projectIds: null }
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
