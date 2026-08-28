// Declarative role → capability matrices for both sides of the house.
// UI composition (what a member's nav shows) and server gates (what an API
// permits) read from the SAME maps, so screens always match enforcement.
// Client-safe: no server imports — usable in 'use client' components.

// Type-only, so it is erased at compile time: permissions.ts takes no runtime
// dependency on spaces.ts (and drags no icon bundle into anything importing it).
import type { FeatureKey } from '@/lib/studio/spaces'

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

/** Role gives the DEFAULT capability set; `extra` holds per-member grants the
 *  owner added on top (custom access). Effective = union. */
export function clientCan(
  role: ClientRole | null | undefined,
  cap: ClientCap,
  extra?: readonly string[] | null
): boolean {
  if (extra?.includes(cap)) return true
  if (!role) return false
  return CLIENT_CAPS[role]?.includes(cap) ?? false
}

/** Client-side capabilities an owner may grant individually, with UI labels. */
export const CLIENT_GRANTABLE: { cap: ClientCap; label: string }[] = [
  { cap: 'message', label: 'Messaging' },
  { cap: 'upload', label: 'Files & uploads' },
  { cap: 'approve', label: 'Approvals' },
  { cap: 'invoices', label: 'Invoices & billing' },
  { cap: 'manage_team', label: 'Team management' },
]

/** Portal nav hrefs this role may see — the SAME matrix gates each page
 *  server-side. Hidden, not just blocked:
 *    viewer   → overview, projects, messages (read-only). Nothing else.
 *    member   → + files vault, uploads
 *    approver → + review & approvals, invoices
 *    owner    → + team, settings (company & owner information is owner-only) */
export function clientNavAllowed(
  role: ClientRole | null | undefined,
  href: string,
  extra?: readonly string[] | null
): boolean {
  switch (href) {
    case '/dashboard':
    case '/projects':
    case '/messages':
      return true
    case '/files':
      return clientCan(role, 'upload', extra)
    case '/approvals':
      return clientCan(role, 'approve', extra)
    case '/invoices':
      return clientCan(role, 'invoices', extra)
    case '/team':
    case '/dashboard/settings':
      return clientCan(role, 'manage_team', extra)
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

/** Union-of-roles capability check, plus per-member grants on top. */
export function orgCan(
  role: OrgRole | OrgRole[] | null | undefined,
  cap: OrgCap,
  extra?: readonly string[] | null
): boolean {
  if (extra?.includes(cap)) return true
  const list = Array.isArray(role) ? role : role ? [role] : []
  return list.some((r) => ORG_CAPS[r]?.includes(cap))
}

/** Org-side capabilities an owner/admin may grant individually, with labels. */
export const ORG_GRANTABLE: { cap: OrgCap; label: string }[] = [
  { cap: 'run_projects', label: 'Projects & delivery' },
  { cap: 'workspace', label: 'Workspace tools' },
  { cap: 'manage_clients', label: 'Client management' },
  { cap: 'client_money', label: 'Invoices & billing' },
  { cap: 'cost_control', label: 'Cost control' },
  { cap: 'manage_team', label: 'Team management' },
  { cap: 'org_settings', label: 'Org settings' },
]

/**
 * The COMPLETE studio feature map, keyed `${spaceId}/${slug}` — default-deny
 * discipline: every feature declares the capability that shows it. `null`
 * marks the few genuinely universal crew surfaces (chat, calendar, meetings).
 *
 * Typed `Record<FeatureKey, ...>` against the union derived from spaces.ts, so
 * "COMPLETE" is checked rather than asserted: a feature added to SPACES without
 * an entry here is a tsc error, and an entry here for a feature that no longer
 * exists is too. Before this, an unmapped slug fell through to `return true`
 * and shipped visible to every crew member.
 */
const ORG_FEATURE_CAP: Record<FeatureKey, OrgCap | null> = {
  // Crew
  'crew/chat': null,
  'crew/tasks': 'run_projects',
  'crew/calendar': null,
  'crew/meetings': null,
  'crew/crm': 'manage_clients',
  'crew/leads': 'manage_clients',
  'crew/control-tower': 'cost_control',
  'crew/directory': 'manage_team',
  'crew/settings': 'org_settings',
  // Client space (the org's window into client work)
  'client/overview': 'run_projects',
  'client/companies': 'manage_clients',
  'client/projects': 'run_projects',
  'client/review': 'run_projects',
  'client/files': 'run_projects',
  'client/documents': 'run_projects',
  'client/messages': 'run_projects',
  'client/invoices': 'client_money',
  'client/brand-kit': 'manage_clients',
  'client/guest-links': 'run_projects',
  'client/settings': 'org_settings',
  // Workspace (the craft floor)
  'workspace/script': 'workspace',
  'workspace/storyboard': 'workspace',
  'workspace/workflow': 'workspace',
  'workspace/generation': 'workspace',
  'workspace/remaster': 'workspace',
  'workspace/finishing': 'workspace',
  'workspace/ai-chat': 'workspace',
  'workspace/continuity': 'workspace',
  'workspace/arena': 'workspace',
  'workspace/studio-kits': 'workspace',
  'workspace/library': 'workspace',
  'workspace/provenance': 'workspace',
}

/**
 * spaceId/slug arrive from the URL (app/studio/[space]/[feature]), so they are
 * `string` and the lookup can genuinely miss at runtime — the FeatureKey type
 * constrains the MAP, not the caller. Hence three distinct outcomes, where
 * there used to be two:
 *
 *   undefined → not a feature we map. DENIED. An unrecognised slug, or one
 *               added to SPACES without a capability, must not be visible.
 *   null      → mapped, and deliberately ungated. ALLOWED. This is how a
 *               feature declares itself universal (crew chat, calendar,
 *               meetings); it is a decision recorded in the map, not an
 *               accident of omission, and collapsing it into the case above
 *               would make the map unable to express "everyone".
 *   a cap     → allowed iff the role or an extra_caps grant carries it.
 */
export function orgFeatureAllowed(
  role: OrgRole | OrgRole[] | null | undefined,
  spaceId: string,
  slug: string,
  extra?: readonly string[] | null
): boolean {
  const cap: OrgCap | null | undefined =
    ORG_FEATURE_CAP[`${spaceId}/${slug}` as FeatureKey]
  if (cap === undefined) return false // unmapped → denied
  if (cap === null) return true // explicitly public, deliberate
  return orgCan(role, cap, extra)
}
