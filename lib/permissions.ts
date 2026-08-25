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

/** Portal nav hrefs this role may see — the SAME matrix gates each page
 *  server-side. Hidden, not just blocked:
 *    viewer   → overview, projects, messages (read-only). Nothing else.
 *    member   → + files vault, uploads
 *    approver → + review & approvals, invoices
 *    owner    → + team, settings (company & owner information is owner-only) */
export function clientNavAllowed(role: ClientRole | null | undefined, href: string): boolean {
  switch (href) {
    case '/dashboard':
    case '/projects':
    case '/messages':
      return true
    case '/files':
      return clientCan(role, 'upload')
    case '/approvals':
      return clientCan(role, 'approve')
    case '/invoices':
      return clientCan(role, 'invoices')
    case '/team':
    case '/dashboard/settings':
      return clientCan(role, 'manage_team')
    default:
      return true
  }
}

// ── organization side (studio) ──────────────────────────────────────────────
// Deep crew roles — a member holds a primary role plus any number of
// additional roles; their capabilities are the UNION of everything they hold.
//   owner/admin  run the org (settings, team, money, everything)
//   producer     runs production and the client relationship
//   finance      invoices, billing, cost control — nothing else extra
//   editor       the workspace craft seats (script, storyboard, AI tools)
//   member       baseline: project work + workspace
// The finer per-feature matrix (finishing, generation, budgets…) deepens as
// those features ship — these gates are the enforcement spine.
export type OrgRole = 'owner' | 'admin' | 'producer' | 'finance' | 'editor' | 'member'

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
  finance: ['client_money', 'cost_control'],
  editor: ['run_projects', 'workspace'],
  member: ['run_projects', 'workspace'],
}

export const ORG_ROLE_HELP: Record<OrgRole, string> = {
  owner: 'Everything, including billing and ownership',
  admin: 'Manage team, clients, settings, and money',
  producer: 'Run projects and the client relationship',
  finance: 'Invoices, billing, and cost control',
  editor: 'Workspace craft — script, storyboard, AI tools',
  member: 'Work inside projects and the workspace',
}

/** Union-of-roles capability check: pass one role or everything they hold. */
export function orgCan(role: OrgRole | OrgRole[] | null | undefined, cap: OrgCap): boolean {
  const list = Array.isArray(role) ? role : role ? [role] : []
  return list.some((r) => ORG_CAPS[r]?.includes(cap))
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

export function orgFeatureAllowed(role: OrgRole | OrgRole[] | null | undefined, spaceId: string, slug: string): boolean {
  const cap = ORG_FEATURE_CAP[`${spaceId}/${slug}`]
  if (!cap) return true
  return orgCan(role, cap)
}
