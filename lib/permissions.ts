// Declarative role → capability matrices for both sides of the house.
// UI composition (what a member's nav shows) and server gates (what an API
// permits) read from the SAME maps, so screens always match enforcement.
// Client-safe: no server imports — usable in 'use client' components.

// Type-only, so it is erased at compile time: permissions.ts takes no runtime
// dependency on spaces.ts (and drags no icon bundle into anything importing it).
import type { FeatureKey } from '@/lib/studio/spaces'

// ── AND IT ANSWERS NO CAPABILITY QUESTION AT ALL (Batch 26 item 8) ──────────
// It stopped being a SOURCE in Batch 25. It has now stopped being an ORACLE.
//
// `orgCan`, `clientCan`, `orgCanApproval` and `clientCanApproval` are DELETED.
// Every one of them answered `baseline(role) OR extra_caps.includes(cap)`, and
// `extra_caps` is a projection of the GRANT rows only (lib/grants.ts:149-153) —
// "a denial is not an absence". So none of the four could see a denial, and
// between them they answered 28 call sites: every studio page guard, both rails,
// all seven portal page guards, and fourteen route handlers.
//
// What that meant concretely, worked through with money.invoices denied on an
// admin: the rail still drew the Invoices tile, requireOrgFeature still admitted
// them, and the page read through supabaseAdmin — so the invoices rendered in
// full. The deny row's only live effect was on the PostgREST door
// (invoices_crew_all's has_cap predicate). A permission an owner had deliberately
// withdrawn was decorative in the product that offered it.
//
// This is the THIRD instance of one shape. The first two are recorded in the
// ORG_APPROVAL_CAP comment below and in HANDOFF §6's Batch 25 row: the R-11
// sweep's first implementation called clientCanApproval() and a DENIED assignee
// still read as able to decide, found by probe. That fix reached exactly one
// consumer. This one fixes the shape: nothing in this file resolves authority
// any more, and the only thing that does is lib/capabilities.server.ts.
//
// WHAT STAYS, and why it is not the same thing: the FEATURE MAP and the
// APPROVAL-ACTION MAP. Those are lookups — "which stored capability answers this
// feature / this action" — with no roster read, no baseline, and no union. They
// take a RESOLVED set and test membership. A lookup that cannot answer yes on
// its own cannot answer yes wrongly.
//
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
// ORG_ROLE_BASELINE / CLIENT_ROLE_BASELINE and the two LEGACY_* alias tables are
// gone from this file's imports with the four functions that used them. The
// aliases are not deleted — they are still honoured, in the ONE place that
// resolves a capability (lib/capabilities.server.ts) and in SQL (0052). A second
// copy of the alias path here was a second thing to remember to delete.
import type { OrgRole, OrgCap, ClientCap } from '@/lib/capabilities'

/* clientCan() WAS HERE. Deleted in Batch 26 item 8 — see this file's header.
   Its replacement is `can(user, 'portal.upload')` in lib/capabilities.server.ts,
   which resolves the same baseline and the same extra_caps and then subtracts
   the denials this function could not see. The portal keys are identity entries
   in CAP_RESOLUTION for exactly this reason: the call sites did not have to
   learn a new vocabulary to stop being wrong. */

/** Client-side capabilities an owner may grant individually, with UI labels. */
export const CLIENT_GRANTABLE: { cap: ClientCap; label: string }[] = [
  { cap: 'portal.message', label: 'Messaging' },
  { cap: 'portal.upload', label: 'Files & uploads' },
  { cap: 'portal.approve', label: 'Approvals' },
  { cap: 'portal.invoices', label: 'Invoices & billing' },
  { cap: 'portal.team', label: 'Team management' },
]

/**
 * Which stored capability a portal nav href requires, or null for the three that
 * every portal member reaches. A LOOKUP — no roster, no baseline, no union.
 *
 * Kept beside CLIENT_NAV_CAP rather than inlined in the rail so the page guard
 * and the rail cannot disagree about which href needs what, which is the half of
 * S-R §5's "one resolver" that is about the MAP rather than the resolution.
 */
const CLIENT_NAV_CAP: Readonly<Record<string, ClientCap | null>> = {
  '/dashboard': null,
  '/projects': null,
  '/messages': null,
  '/files': 'portal.upload',
  '/approvals': 'portal.approve',
  '/invoices': 'portal.invoices',
  '/team': 'portal.team',
  '/dashboard/settings': 'portal.team',
}

export function clientNavCap(href: string): ClientCap | null | undefined {
  return CLIENT_NAV_CAP[href]
}

/**
 * Portal nav hrefs a RESOLVED capability set may see — the SAME map gates each
 * page server-side. Hidden, not just blocked:
 *    viewer   → overview, projects, messages (read-only). Nothing else.
 *    member   → + files vault, uploads
 *    approver → + review & approvals, invoices
 *    owner    → + team, settings (company & owner information is owner-only)
 *
 * TAKES THE RESOLVED SET, NOT A ROLE (Batch 26 item 8). The rail is a client
 * component and cannot run the resolver; the layout runs it once and passes the
 * array through `capList()`. Set membership is not a capability decision.
 *
 * An href this map does not know returns TRUE, unchanged from the `default:`
 * that preceded it — the portal rail's sections are a fixed list in
 * components/layout/Sidebar.tsx, not URL input, so an unknown href here is a
 * link somebody added to that list and not an attack surface. This is the
 * OPPOSITE of orgFeatureAllowed's unmapped→deny, and the difference is exactly
 * that one takes a URL segment and this one does not.
 */
export function clientNavAllowed(caps: readonly string[] | ReadonlySet<string>, href: string): boolean {
  const cap = CLIENT_NAV_CAP[href]
  if (cap === undefined) return true
  if (cap === null) return true
  return holds(caps, cap)
}

/** Set-or-array membership. The rails receive an array (props do not carry a
 *  Set); server callers hold the ReadonlySet resolveCaps returns. */
function holds(caps: readonly string[] | ReadonlySet<string>, cap: string): boolean {
  return Array.isArray(caps) ? caps.includes(cap) : (caps as ReadonlySet<string>).has(cap)
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


/* orgCan() WAS HERE. Deleted in Batch 26 item 8 — see this file's header.
   Its replacement is `can(user, 'money.invoice.send')` / `hasCap(user, cap)`.
   Two of its four call sites are worth recording because they were wrong in
   DIFFERENT ways: app/api/admin/invoice-actions/route.ts passed extra_caps and
   so honoured grants but not denials, while
   app/api/studio/organization/logo/route.ts passed NO extras at all — so a
   GRANTED org.settings was refused there, the mirror image of the Batch 25
   roster-route defect, in the route that writes the studio's own logo. */

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

/**
 * The STORED capability an approval action resolves to, or 'never'.
 *
 * Exported because orgCanApproval/clientCanApproval cannot express a DENIAL:
 * they OR the role baseline, by design, so subtracting a denial from the extras
 * alone leaves the answer unchanged. Anything that has to honour a deny — the
 * R-11 sweep, which exists precisely because someone LOST the ability to decide
 * — must resolve the full set itself (baseline ∪ extras ∪ grants − denials) and
 * then ask whether this cap is in it.
 *
 * Found by probe: the first version of that sweep check called
 * clientCanApproval() and a denied assignee still read as able to decide,
 * because `owner` carries portal.approve in its baseline.
 */
export function approvalActionCap(side: 'crew', action: ApprovalAction): OrgCap
export function approvalActionCap(side: 'client', action: ApprovalAction): ClientCap | 'never'
export function approvalActionCap(side: 'crew' | 'client', action: ApprovalAction): string {
  return side === 'crew' ? ORG_APPROVAL_CAP[action] : CLIENT_APPROVAL_CAP[action]
}

/* orgCanApproval() WAS HERE, and clientCanApproval() below it. Both deleted in
   Batch 26 item 8. `approvalActionCap()` above already exposes the stored cap an
   action resolves to — which is what the R-11 sweep uses, and it is the ONE
   consumer that was already correct — so a caller now writes
   `hasCap(user, approvalActionCap('crew', 'create'))` and gets the denial
   subtracted. The comment on approvalActionCap explains why it had to be
   exported; item 8 is that reasoning applied to every other caller instead of
   one. */

/**
 * The stored capability a portal approval action needs, or the `'never'`
 * sentinel. `approvalActionCap('client', action)` is the same answer through the
 * overloaded accessor; this exists because 'never' is not a ClientCap and a
 * caller must be able to tell "no capability can grant this" from "resolve this
 * capability".
 *
 * This answers ROLE authority only. Whether a given person may decide on a
 * given STAGE is a question about assignment, and it is answered by 0038's
 * approval_decisions INSERT policy (can_decide_on_stage) — in the database,
 * where a direct write cannot route around it.
 */
export function clientApprovalCapOrNever(action: ApprovalAction): ClientCap | 'never' {
  return CLIENT_APPROVAL_CAP[action]
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
export function orgFeatureCap(spaceId: string, slug: string): OrgCap | null | undefined {
  return ORG_FEATURE_CAP[`${spaceId}/${slug}` as FeatureKey]
}

/**
 * TAKES THE RESOLVED SET, NOT A ROLE (Batch 26 item 8). Both callers —
 * lib/studio/guard.ts for a typed URL and components/studio/StudioSidebar.tsx
 * for the rail — now pass the set `resolveCaps()` produced, so a denial hides
 * the tile and refuses the URL in the same tick. Before this, neither could see
 * one: the rail drew every tile the ROLE carried and the guard admitted every
 * URL the role carried, whatever an owner had withdrawn.
 *
 * The three outcomes are unchanged, and the unmapped→deny one is why this
 * function still exists rather than collapsing into a set lookup at the call
 * site: spaceId and slug arrive from the URL.
 */
export function orgFeatureAllowed(
  caps: readonly string[] | ReadonlySet<string>,
  spaceId: string,
  slug: string,
): boolean {
  const cap = orgFeatureCap(spaceId, slug)
  if (cap === undefined) return false // unmapped → denied
  if (cap === null) return true // explicitly public, deliberate
  return holds(caps, cap)
}
