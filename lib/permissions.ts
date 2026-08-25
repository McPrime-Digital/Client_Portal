// Declarative role → capability matrices for both sides of the house.
// UI composition (what a member's nav shows) and server gates (what an API
// permits) read from the SAME maps, so screens always match enforcement.
// Client-safe: no server imports — usable in 'use client' components.

// ── client-side (portal) ────────────────────────────────────────────────────
export type ClientRole = 'owner' | 'approver' | 'member' | 'viewer'

export type ClientCap =
  | 'view'            // overview, projects, files, approvals queue, messages
  | 'message'         // send messages
  | 'upload'          // upload files
  | 'approve'         // approve deliverables / request changes
  | 'invoices'        // see & pay invoices
  | 'manage_team'     // invite / roles / remove

const CLIENT_CAPS: Record<ClientRole, ClientCap[]> = {
  owner: ['view', 'message', 'upload', 'approve', 'invoices', 'manage_team'],
  approver: ['view', 'message', 'upload', 'approve', 'invoices'],
  member: ['view', 'message', 'upload'],
  viewer: ['view'],
}

export function clientCan(role: ClientRole | null | undefined, cap: ClientCap): boolean {
  if (!role) return false
  return CLIENT_CAPS[role]?.includes(cap) ?? false
}

/** Portal nav hrefs this role may see. Everything else is filtered out of the
 *  sidebar AND gated server-side on its page. */
export function clientNavAllowed(role: ClientRole | null | undefined, href: string): boolean {
  if (href === '/invoices') return clientCan(role, 'invoices')
  return true // overview/projects/approvals/files/messages/team/settings: visible to all roles
}

// ── organization side (studio) ──────────────────────────────────────────────
// Deep crew roles. owner/admin run the org; producer runs production and the
// client relationship; member creates inside Workspace. The finer per-feature
// matrix (finishing, generation, budgets…) is specced in the Teams/Rooms/Roles
// document and lands as those features ship — gates here are the v1 spine.
export type OrgRole = 'owner' | 'admin' | 'producer' | 'member'

export type OrgCap =
  | 'org_settings'    // business settings, billing, plans
  | 'manage_team'     // crew invites / roles / removal
  | 'manage_clients'  // create/edit clients, client teams, invite policies
  | 'client_money'    // invoices: create, send, mark paid
  | 'run_projects'    // projects, tasks, approvals, files, messages
  | 'workspace'       // script, storyboard, PrimeOS, generation tools
  | 'cost_control'    // Control Tower, budgets, usage

const ORG_CAPS: Record<OrgRole, OrgCap[]> = {
  owner: ['org_settings', 'manage_team', 'manage_clients', 'client_money', 'run_projects', 'workspace', 'cost_control'],
  admin: ['org_settings', 'manage_team', 'manage_clients', 'client_money', 'run_projects', 'workspace', 'cost_control'],
  producer: ['manage_clients', 'run_projects', 'workspace', 'cost_control'],
  member: ['run_projects', 'workspace'],
}

export function orgCan(role: OrgRole | null | undefined, cap: OrgCap): boolean {
  if (!role) return false
  return ORG_CAPS[role]?.includes(cap) ?? false
}

/** Which studio features a crew role sees, keyed `${spaceId}/${slug}`.
 *  Unlisted features are visible to every crew role. */
const ORG_FEATURE_CAP: Record<string, OrgCap> = {
  'crew/settings': 'org_settings',
  'crew/directory': 'manage_team',
  'crew/control-tower': 'cost_control',
  'crew/crm': 'manage_clients',
  'crew/leads': 'manage_clients',
  'client/invoices': 'client_money',
  'client/companies': 'manage_clients',
  'client/settings': 'org_settings',
}

export function orgFeatureAllowed(role: OrgRole | null | undefined, spaceId: string, slug: string): boolean {
  const cap = ORG_FEATURE_CAP[`${spaceId}/${slug}`]
  if (!cap) return true
  return orgCan(role, cap)
}
