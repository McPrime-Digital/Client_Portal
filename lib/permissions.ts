// Declarative role → capability matrices for both sides of the house.
// UI composition (what a member's nav shows) and server gates (what an API
// permits) read from the SAME maps, so screens always match enforcement.
// Client-safe: no server imports — usable in 'use client' components.

// Type-only, so it is erased at compile time: permissions.ts takes no runtime
// dependency on spaces.ts (and drags no icon bundle into anything importing it).
import type { FeatureKey } from '@/lib/studio/spaces'

// ── THIS FILE IS A CONSUMER NOW (Batch 24 item 4) ───────────────────────────
// It used to be a SECOND source of authorization: its own OrgRole, its own cap
// unions, and its own role→capability matrices, maintained beside the ones in
// the database. Every type and every baseline now comes from
// lib/capabilities.ts, which is also what generates the SQL (ruling 2).
//
// What STAYS here is the part that is not capability: feature and space gating
// (S-R §5 steps 1-2 — plan entitlement and organizations.type), the nav
// projections, and the default-deny discipline around ORG_FEATURE_CAP. Those are
// entitlement and UI composition, not authority.
//
// Still client-safe: no server imports, so 'use client' components may import
// it. The server-side assertion is can() in lib/capabilities.server.ts.
export type { OrgRole, ClientRole, OrgCap, ClientCap } from '@/lib/capabilities'
import {
  ORG_ROLE_BASELINE, CLIENT_ROLE_BASELINE, LEGACY_ORG_CAP, LEGACY_CLIENT_CAP,
  type OrgRole, type ClientRole, type OrgCap, type ClientCap,
} from '@/lib/capabilities'

/** Role gives the DEFAULT capability set; `extra` holds per-member grants the
 *  owner added on top (custom access). Effective = union. */
export function clientCan(
  role: ClientRole | null | undefined,
  cap: ClientCap,
  extra?: readonly string[] | null
): boolean {
  // A stored row may still hold a pre-0051 snake_case value while a mid-deploy
  // session is live, so extras are normalized on READ through the alias table
  // (deletion owed — HANDOFF §9). Without this, the rename would silently
  // strip granted access for the length of a rollout.
  if (extra?.some((e) => (LEGACY_CLIENT_CAP[e] ?? e) === cap)) return true
  if (!role) return false
  return CLIENT_ROLE_BASELINE[role]?.includes(cap) ?? false
}

/** Client-side capabilities an owner may grant individually, with UI labels. */
export const CLIENT_GRANTABLE: { cap: ClientCap; label: string }[] = [
  { cap: 'portal.message', label: 'Messaging' },
  { cap: 'portal.upload', label: 'Files & uploads' },
  { cap: 'portal.approve', label: 'Approvals' },
  { cap: 'portal.invoices', label: 'Invoices & billing' },
  { cap: 'portal.team', label: 'Team management' },
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
      return clientCan(role, 'portal.upload', extra)
    case '/approvals':
      return clientCan(role, 'portal.approve', extra)
    case '/invoices':
      return clientCan(role, 'portal.invoices', extra)
    case '/team':
    case '/dashboard/settings':
      return clientCan(role, 'portal.team', extra)
    default:
      return true
  }
}

// ── organization side (studio) ──────────────────────────────────────────────
// The role→capability matrix used to live here. It now lives in
// lib/capabilities.ts as ORG_ROLE_BASELINE, which is also what generates
// public.role_baseline() — so the studio UI, the route guards and the RLS
// policies all answer from one table (S-R §5's one resolver).
//
// A crew member holds a primary role plus any number of additional roles, and
// their capabilities are the UNION of everything they hold, plus per-member
// grants.

export const ORG_ROLE_HELP: Record<OrgRole, string> = {
  owner: 'Everything, including billing and ownership',
  admin: 'Manage team, clients, settings, and money',
  producer: 'Run projects and the client relationship',
  coordinator: 'Schedule, tasks, files, and client messaging',
  finance: 'Invoices, billing, and cost control',
  crew: 'Work inside projects and the Suite',
  editor: 'Suite craft — script, storyboard, AI tools',
  member: 'Work inside projects and the Suite',
}


/** Union-of-roles capability check, plus per-member grants on top. */
export function orgCan(
  role: OrgRole | OrgRole[] | null | undefined,
  cap: OrgCap,
  extra?: readonly string[] | null
): boolean {
  // Extras are normalized on READ through 0051's alias table, so a row still
  // holding a pre-rename snake_case value keeps resolving for the length of a
  // rollout. Without it the rename would silently strip granted access.
  if (extra?.some((e) => (LEGACY_ORG_CAP[e] ?? e) === cap)) return true
  const list = Array.isArray(role) ? role : role ? [role] : []
  return list.some((r) => ORG_ROLE_BASELINE[r]?.includes(cap))
}

/** Org-side capabilities an owner/admin may grant individually, with labels. */
export const ORG_GRANTABLE: { cap: OrgCap; label: string }[] = [
  { cap: 'work.projects', label: 'Projects & delivery' },
  { cap: 'work.suite', label: 'Suite tools' },
  { cap: 'client.manage', label: 'Client management' },
  { cap: 'money.invoices', label: 'Invoices & billing' },
  { cap: 'money.costs', label: 'Cost control' },
  { cap: 'people.manage', label: 'Team management' },
  { cap: 'org.settings', label: 'Org settings' },
  { cap: 'record.approval_policy', label: 'Approval terms & review windows' },
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
  create: 'work.projects',
  decide: 'work.projects',
  set_window: 'record.approval_policy',
  withdraw: 'record.approval_policy',
  set_comment_permission: 'record.approval_policy',
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
  decide: 'portal.approve',
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
  'crew/tasks': 'work.projects',
  'crew/calendar': null,
  'crew/meetings': null,
  'crew/crm': 'client.manage',
  'crew/leads': 'client.manage',
  'crew/control-tower': 'money.costs',
  'crew/directory': 'people.manage',
  'crew/settings': 'org.settings',
  // Client space (the org's window into client work)
  'client/overview': 'work.projects',
  'client/companies': 'client.manage',
  'client/projects': 'work.projects',
  'client/review': 'work.projects',
  'client/files': 'work.projects',
  'client/documents': 'work.projects',
  'client/messages': 'work.projects',
  'client/invoices': 'money.invoices',
  'client/brand-kit': 'client.manage',
  'client/guest-links': 'work.projects',
  'client/settings': 'org.settings',
  // Suite (the craft floor) — the VALUE 'workspace' is the stored capability
  // name (see OrgCap above); only the space half of the key was renamed.
  'suite/script': 'work.suite',
  'suite/storyboard': 'work.suite',
  'suite/workflow': 'work.suite',
  'suite/generation': 'work.suite',
  'suite/remaster': 'work.suite',
  'suite/finishing': 'work.suite',
  'suite/ai-chat': 'work.suite',
  'suite/continuity': 'work.suite',
  'suite/arena': 'work.suite',
  'suite/studio-kits': 'work.suite',
  'suite/library': 'work.suite',
  'suite/provenance': 'work.suite',
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
