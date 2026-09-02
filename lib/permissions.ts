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
  // The Suite's capability keeps its pre-rename name: 'workspace' is stored in
  // organization_members.extra_caps rows, so renaming the string would strip
  // every member's granted Suite access. The SPACE is 'suite'; the CAP stays.
  | 'workspace'       // the Suite — script, storyboard, PrimeOS, generation tools
  | 'cost_control'    // Control Tower, budgets, usage
  // Setting the TERMS of an approval, as opposed to taking part in one
  // (S3-c §2.1). The review window is a commercial commitment — it belongs in
  // the production agreement (§2.6) — and withdrawing an approval or deciding
  // who may speak in the record are the same kind of authority. Participating
  // (opening one, deciding on one) rides 'run_projects' instead, so a member
  // who runs projects can raise an approval without being able to move the
  // deadline the studio promised its client.
  | 'approval_policy'

const ORG_CAPS: Record<OrgRole, OrgCap[]> = {
  owner: ['org_settings', 'manage_team', 'manage_clients', 'client_money', 'run_projects', 'workspace', 'cost_control', 'approval_policy'],
  admin: ['org_settings', 'manage_team', 'manage_clients', 'client_money', 'run_projects', 'workspace', 'cost_control', 'approval_policy'],
  producer: ['manage_clients', 'run_projects', 'workspace', 'cost_control', 'approval_policy'],
  finance: ['client_money', 'cost_control'],
  editor: ['run_projects', 'workspace'],
  member: ['run_projects', 'workspace'],
}

export const ORG_ROLE_HELP: Record<OrgRole, string> = {
  owner: 'Everything, including billing and ownership',
  admin: 'Manage team, clients, settings, and money',
  producer: 'Run projects and the client relationship',
  finance: 'Invoices, billing, and cost control',
  editor: 'Suite craft — script, storyboard, AI tools',
  member: 'Work inside projects and the Suite',
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
  { cap: 'workspace', label: 'Suite tools' },
  { cap: 'manage_clients', label: 'Client management' },
  { cap: 'client_money', label: 'Invoices & billing' },
  { cap: 'cost_control', label: 'Cost control' },
  { cap: 'manage_team', label: 'Team management' },
  { cap: 'org_settings', label: 'Org settings' },
  { cap: 'approval_policy', label: 'Approval terms & review windows' },
]

// ── approvals, both rosters (S3-c) ──────────────────────────────────────────
/**
 * The five things a person can do to an approval. Named as ACTIONS rather than
 * added as five capability strings: the OrgCap/ClientCap matrices are
 * feature-area coarse by design, and every new cap string is a value that can
 * end up stored in an `extra_caps` row — renaming or removing one later strips
 * granted access (the lesson the 'workspace' cap records above).
 */
export type ApprovalAction =
  | 'create'                  // open an approval against a subject
  | 'decide'                  // approve / reject / request changes
  | 'set_window'              // set or override the review window
  | 'withdraw'                // withdraw an open approval
  | 'set_comment_permission'  // control who may comment on the record

/**
 * Typed as a total Record, so adding an ApprovalAction without deciding who
 * holds it is a tsc error rather than a silent grant — the same default-deny
 * discipline as ORG_FEATURE_CAP below.
 */
const ORG_APPROVAL_CAP: Record<ApprovalAction, OrgCap> = {
  create: 'run_projects',
  decide: 'run_projects',
  set_window: 'approval_policy',
  withdraw: 'approval_policy',
  set_comment_permission: 'approval_policy',
}

/**
 * The client side is a PARALLEL entitlement tree, not the studio's minus some
 * (S1 §0) — so 'never' here is a statement about the PRODUCT, not a trimmed
 * copy of the studio's list:
 *
 *   · create — the studio MINTS approvals; making an artifact available for
 *     review is what opens one (S3-c §4.1/AP-5). A client does not raise an
 *     approval against the studio's work.
 *   · set_window — the window is the studio's commitment, stated in the
 *     production agreement (§2.6). A client who could extend their own
 *     deadline could postpone it forever, which is auto-advance deleted.
 *   · withdraw — retracting the request belongs to whoever made it.
 *   · set_comment_permission — and this one is also enforced BELOW this file:
 *     0038's approval_comment_permissions write policy is crew-only. A
 *     capability that answered true here would promise what the database
 *     refuses, which is worse than having no key at all.
 *
 * `decide` maps to the EXISTING 'approve' cap (owner + approver), so the
 * client-side approval right keeps the meaning it already had, and the
 * per-member `extra_caps` grant keeps working unchanged.
 *
 * Note 'never' is a deliberate sentinel, NOT `null`: `null` already means
 * "explicitly allowed to everyone" in ORG_FEATURE_CAP, and reusing it here
 * with the opposite meaning is exactly the trap that reads as safe.
 */
const CLIENT_APPROVAL_CAP: Record<ApprovalAction, ClientCap | 'never'> = {
  create: 'never',
  decide: 'approve',
  set_window: 'never',
  withdraw: 'never',
  set_comment_permission: 'never',
}

/** May this crew member take this action on an approval? Default-deny. */
export function orgCanApproval(
  role: OrgRole | OrgRole[] | null | undefined,
  action: ApprovalAction,
  extra?: readonly string[] | null
): boolean {
  const cap = ORG_APPROVAL_CAP[action]
  if (!cap) return false // unmapped action → denied
  return orgCan(role, cap, extra)
}

/**
 * May this portal member take this action on an approval? Default-deny.
 *
 * This answers ROLE authority only. Whether a given person may decide on a
 * given STAGE is a question about assignment, and it is answered by 0038's
 * approval_decisions INSERT policy (can_decide_on_stage) — in the database,
 * where a direct write cannot route around it.
 */
export function clientCanApproval(
  role: ClientRole | null | undefined,
  action: ApprovalAction,
  extra?: readonly string[] | null
): boolean {
  const cap = CLIENT_APPROVAL_CAP[action]
  if (!cap || cap === 'never') return false
  return clientCan(role, cap, extra)
}

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
  // Suite (the craft floor) — the VALUE 'workspace' is the stored capability
  // name (see OrgCap above); only the space half of the key was renamed.
  'suite/script': 'workspace',
  'suite/storyboard': 'workspace',
  'suite/workflow': 'workspace',
  'suite/generation': 'workspace',
  'suite/remaster': 'workspace',
  'suite/finishing': 'workspace',
  'suite/ai-chat': 'workspace',
  'suite/continuity': 'workspace',
  'suite/arena': 'workspace',
  'suite/studio-kits': 'workspace',
  'suite/library': 'workspace',
  'suite/provenance': 'workspace',
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
