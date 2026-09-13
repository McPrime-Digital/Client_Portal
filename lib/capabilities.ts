/**
 * THE CAPABILITY VOCABULARY — one source of truth for TypeScript and SQL.
 *
 * Governing: S-R §4 (the namespace), S-R §5 (resolution order), Batch 24
 * ruling 1 AS SUPERSEDED (option A) and ruling 2 (one exported OrgRole).
 *
 * ── THE SHAPE, AND WHY IT IS NOT WHAT S-R §4 LITERALLY SAYS ─────────────────
 * S-R §4 enumerates 38 FINE keys. `lib/permissions.ts` has always stored 14
 * COARSE ones. The original ruling read that difference as spelling —
 * snake_case vs dot — and it is not: it is GRANULARITY. Migrating a stored
 * `run_projects` grant into ten fine keys asserts that a grant made months ago
 * meant all ten, which is an intent nobody recorded (HANDOFF §12 lesson 1: a
 * migration that repairs state while inventing the invariant behind it).
 *
 * So there are two vocabularies and they do different jobs:
 *
 *   FINE keys (S-R §4)   — the vocabulary of QUESTIONS the code asks.
 *                          `can('money.invoice.send')`
 *   COARSE caps (these)  — the vocabulary of what is STORED and GRANTED.
 *                          one value per extra_caps row, one per grant row
 *
 * A fine question resolves to the coarse cap that answers it, through
 * CAP_RESOLUTION below. That is not a new pattern: ORG_APPROVAL_CAP in
 * lib/permissions.ts already resolves five ApprovalActions onto three stored
 * caps, for the reason written there — every stored string is a value that can
 * end up in an extra_caps row, and renaming or removing one strips granted
 * access.
 *
 * Consequence, stated because it inverts a settled document: WHERE THIS TABLE
 * AND S-R §4 DISAGREE, THIS TABLE WINS, and §4 is corrected to match it in
 * `S-R-A` (owed before Batch 25; S-R is settled at b8cf4aa and is never edited
 * in place). Two gaps in §4 this table fills:
 *
 *   · `org.settings` — §4 has no business-settings key at all, and folding it
 *     into `platform.billing` would be wrong twice: billing is owner-only and
 *     ungrantable under G-2, while business settings are legitimately an
 *     admin's. Own key, grantable, distinct.
 *   · `portal.*` — §4 enumerates the CREW side only. The client portal is a
 *     parallel entitlement tree (S1 §0), not the studio's minus some, so its
 *     six capabilities get their own domain.
 *
 * ON THE NAME `portal.*`, WHICH THE BRIEF CALLED `client.*`: `client.*` is
 * already taken in §4 for the STUDIO's authority over its client companies
 * (client.company.create, client.portal.configure). Using it for the portal
 * member's own authority would put two different meanings behind one prefix —
 * the organization_members-vs-client_members `member` trap one layer up, and
 * item 8's grant surface groups by domain, so a reader would have to know which
 * table a key came from to know what it means. `portal.*` matches what this
 * codebase already calls that tree: app/(portal)/, portalAccess, PortalAccess.
 * One constant to reverse if that is the wrong call.
 */

// ── the roles ────────────────────────────────────────────────────────────────

/**
 * THE ONE OrgRole (ruling 2). lib/team.ts exported a four-value union of the
 * same name while lib/permissions.ts exported a six-value one, and `orgRolesOf`
 * laundered the gap with `data.role as OrgRole` — so Gabby's live
 * roles=['editor'] flowed through a union that excluded it and worked only
 * because ORG_CAPS happened to have the key at runtime. Nothing ever flagged
 * it, which is why two disagreeing TypeScript types are worse than TS and SQL
 * disagreeing.
 *
 * S-R §3.1's six, plus the two aliases migration 0050 keeps in the DB CHECK.
 */
export type OrgRole =
  | 'owner' | 'admin' | 'producer' | 'coordinator' | 'finance' | 'crew'
  | 'editor' | 'member'

/** S-R §8's four. Unchanged, and `member` here is LIVE — see 0050's header. */
export type ClientRole = 'owner' | 'approver' | 'member' | 'viewer'

/** The roles a human may be OFFERED. `editor` and `member` resolve but are
 *  never offered: offering a retired name is how it stops being retired. */
export const ORG_ROLES_ASSIGNABLE: readonly OrgRole[] = [
  'admin', 'producer', 'coordinator', 'finance', 'crew',
] as const

// ── seat class: S-R §2's first axis, S3-b §4.1's column (0056) ───────────────

/**
 * THE FOURTH AXIS, and the one S-R §2 calls load-bearing for this product:
 * "A permanent producer joining should see the studio. A freelance colorist
 * joining should see the one job they were hired for. Those are opposite
 * defaults, and today there is one default: everything."
 *
 * VALUES ARE 'staff' AND 'contractor', not S-R §2 / S3-b §4.1's
 * `crew` / `collaborator`. Both spec words were already taken, in two different
 * ways, and 0056's header carries the full argument:
 *   · `collaborator` names S3-d MD-4's roster-LESS room seat — the opposite shape
 *     from a property of a roster row;
 *   · `crew` is already a value of `organization_members.role`, so
 *     seat_class='crew' and role='crew' would mean unrelated things on one row.
 */
export type SeatClass = 'staff' | 'contractor'

export const SEAT_CLASSES: readonly SeatClass[] = ['staff', 'contractor'] as const

/**
 * THE SCOPE A SEAT CLASS IMPLIES — and the point is that it is written to the
 * row, never re-derived from it.
 *
 * S3-b §4.1 and S-R §2: the scoping default splits by class. This table says
 * WHAT TO WRITE at invite time (item 4). It must never be consulted to decide
 * what an EXISTING row means — that is what `scope_mode` on the row is for, and
 * the difference is B1's whole lesson restated at S-R §10:
 *
 *   no rows + scope_mode 'all'      → EVERY project
 *   no rows + scope_mode 'selected' → NO projects
 *
 * so an empty project set means opposite things depending on a value that must
 * therefore be STATED. A reader that inferred scope from seat class would
 * reintroduce the footgun one axis up: change somebody's seat class and their
 * access silently changes with it, with no record of the decision.
 *
 * Typed as a total Record so adding a seat class without deciding its scope is a
 * tsc error rather than an undefined that writes `undefined` to the column.
 */
export const SEAT_CLASS_SCOPE_MODE: Readonly<Record<SeatClass, 'all' | 'selected'>> = {
  staff: 'all',
  contractor: 'selected',
} as const

/** Invite-form copy. Says what the choice DOES, because the consequence is
 *  invisible until the person signs in and sees an empty studio (S-R §8 S-3). */
export const SEAT_CLASS_HELP: Readonly<Record<SeatClass, string>> = {
  staff: 'Permanent team. Sees every production in the studio.',
  contractor: 'Freelance. Sees only the productions they are assigned to — none until you assign one.',
} as const

export const SEAT_CLASS_LABEL: Readonly<Record<SeatClass, string>> = {
  staff: 'Staff',
  contractor: 'Contractor',
} as const

// ── the stored (coarse) vocabulary ───────────────────────────────────────────

/**
 * What a grant row and an extra_caps row may contain, crew side. Dot form, one
 * value per grant. These are renames of the eight snake_case caps and nothing
 * more — no cap gained or lost scope in the rename, so extra_caps migrates 1→1
 * and no row changes meaning.
 */
export type OrgCap =
  | 'work.projects'           // was run_projects   — projects, tasks, files, messages
  | 'work.suite'              // was workspace      — the Suite (script, storyboard, AI)
  | 'client.manage'           // was manage_clients — companies, client teams, invite policy
  | 'people.manage'           // was manage_team    — crew invites, roles, removal, grants
  | 'money.invoices'          // was client_money   — invoices: read, create, send, mark paid
  | 'money.costs'             // was cost_control   — Control Tower, budgets, credits, usage
  | 'org.settings'            // was org_settings   — business settings (NOT billing)
  | 'record.approval_policy'  // was approval_policy — the TERMS of an approval (S3-c §2.1)

/** What a grant row may contain, portal side. Renames of the six ClientCaps. */
export type ClientCap =
  | 'portal.view'       // was view        — overview, projects, files, approvals, messages
  | 'portal.message'    // was message     — send messages
  | 'portal.upload'     // was upload      — upload files
  | 'portal.approve'    // was approve     — approve / request changes
  | 'portal.invoices'   // was invoices    — see & pay invoices
  | 'portal.team'       // was manage_team — invite / roles / remove teammates

/**
 * READ ALIASES, one release only (ruling 1, retained). A stored row still
 * holding a snake_case value must keep resolving while a mid-deploy session is
 * live — the alternative is a member losing granted access for the length of a
 * rollout. Migration 0051 rewrites the rows; this table is what makes the
 * rewrite safe rather than necessary.
 *
 * DELETION IS OWED and recorded in HANDOFF §9. Every entry here is a second
 * spelling of a live authority, which is the thing this whole rename exists to
 * stop having.
 */
export const LEGACY_ORG_CAP: Readonly<Record<string, OrgCap>> = {
  run_projects: 'work.projects',
  workspace: 'work.suite',
  manage_clients: 'client.manage',
  manage_team: 'people.manage',
  client_money: 'money.invoices',
  cost_control: 'money.costs',
  org_settings: 'org.settings',
  approval_policy: 'record.approval_policy',
} as const

export const LEGACY_CLIENT_CAP: Readonly<Record<string, ClientCap>> = {
  view: 'portal.view',
  message: 'portal.message',
  upload: 'portal.upload',
  approve: 'portal.approve',
  invoices: 'portal.invoices',
  manage_team: 'portal.team',
} as const

// ── the role baselines ───────────────────────────────────────────────────────

/**
 * S-R §3.1, as DATA. This constant is THE SOURCE — `public.role_baseline()` in
 * migration 0051 is GENERATED from it by scripts/gen-capability-sql.ts, and
 * `npm run check:caps` fails when the live function and this table disagree.
 * A Postgres function and a TypeScript constant maintained by hand will
 * diverge, and the first time they do neither is trusted (S-R §5).
 */
export const ORG_ROLE_BASELINE: Readonly<Record<OrgRole, readonly OrgCap[]>> = {
  owner: ['work.projects', 'work.suite', 'client.manage', 'people.manage',
          'money.invoices', 'money.costs', 'org.settings', 'record.approval_policy'],
  admin: ['work.projects', 'work.suite', 'client.manage', 'people.manage',
          'money.invoices', 'money.costs', 'org.settings', 'record.approval_policy'],
  producer: ['work.projects', 'work.suite', 'client.manage', 'money.costs',
             'record.approval_policy'],
  // No money, no roster (S-R §3.1) and no Suite: §8 gives a coordinator
  // schedule, tasks, files and client messaging, and puts the craft floor
  // elsewhere. One who needs a Suite seat gets it as a grant.
  coordinator: ['work.projects'],
  finance: ['money.invoices', 'money.costs'],
  crew: ['work.projects', 'work.suite'],
  // Deprecated aliases for `crew`, resolving the same baseline.
  editor: ['work.projects', 'work.suite'],
  member: ['work.projects', 'work.suite'],
} as const

export const CLIENT_ROLE_BASELINE: Readonly<Record<ClientRole, readonly ClientCap[]>> = {
  owner: ['portal.view', 'portal.message', 'portal.upload', 'portal.approve',
          'portal.invoices', 'portal.team'],
  approver: ['portal.view', 'portal.message', 'portal.upload', 'portal.approve',
             'portal.invoices'],
  member: ['portal.view', 'portal.message', 'portal.upload'],
  viewer: ['portal.view'],
} as const

// ── the fine vocabulary, and how it resolves ─────────────────────────────────

/**
 * S-R §4's 38 keys: the questions the code asks. Adding one here without an
 * entry in CAP_RESOLUTION is a tsc error, not a silent grant.
 */
export type Capability =
  // money.*
  | 'money.invoice.read' | 'money.invoice.write' | 'money.invoice.send'
  | 'money.credits.read' | 'money.credits.topup'
  | 'money.budget.read' | 'money.budget.write' | 'money.rates.read'
  // people.*
  | 'people.roster.read' | 'people.invite' | 'people.remove'
  | 'people.role.set' | 'people.caps.grant' | 'people.caps.deny'
  // client.*  (the STUDIO's authority over its client companies)
  | 'client.company.read' | 'client.company.create' | 'client.company.update'
  | 'client.company.delete' | 'client.message.send' | 'client.portal.configure'
  // work.*
  | 'work.project.read' | 'work.project.create' | 'work.project.update'
  | 'work.project.archive'
  | 'work.file.read' | 'work.file.upload' | 'work.file.version' | 'work.file.delete'
  | 'work.task.read' | 'work.task.write'
  | 'work.suite.script' | 'work.suite.storyboard'
  // record.*
  | 'record.ledger.read' | 'record.certificate.export'
  // org.*  — S-R-A A-5's own capability. §4 enumerates no business-settings
  // key; read and write are genuinely different questions here (the rail asks
  // read, the logo writer asks write), which is the only reason both exist.
  | 'org.settings.read' | 'org.settings.write'
  // portal.*  — THE PORTAL TREE, AND THESE ARE IDENTITY ENTRIES.
  //
  // Batch 26 item 8 brought the portal onto this table so ONE function answers
  // every capability question on both rosters. The six keys are the six stored
  // ClientCaps unchanged, not a finer re-spelling of them, and that is
  // deliberate: S-R-A A-4 says §4's fine keys are the vocabulary of QUESTIONS,
  // and a portal capability is ALREADY a question ('portal.message' IS "may
  // they send messages"). Inventing 'portal.message.send' beside it would add a
  // layer with no distinction in it — ceremony, and a second string per grant
  // to keep honest. Where fine and coarse coincide, they coincide.
  | 'portal.view' | 'portal.message' | 'portal.upload' | 'portal.approve'
  | 'portal.invoices' | 'portal.team'
  // platform.*  — owner-only and UNGRANTABLE (S-R §6 G-2)
  | 'platform.billing' | 'platform.org.delete' | 'platform.erasure'
  | 'platform.grant'

/**
 * Owner-only and ungrantable. A deliberate sentinel and NOT `null`: `null`
 * already means "deliberately ungated" in ORG_FEATURE_CAP, and reusing it with
 * the opposite meaning is the trap that reads as safe. Same reasoning as
 * CLIENT_APPROVAL_CAP's `'never'`.
 */
export const OWNER_ONLY = 'owner_only' as const

/**
 * NOT YET ANSWERABLE. The capability exists, deliberately, before the surface
 * does (S-R §4 on money.rates.read) — and it must not fold into an existing
 * coarse cap, because every candidate over-grants: `money.costs` is held by
 * `producer`, and S-R §3.1 gives a producer "budget on their own productions —
 * not the company's books", while rates are the most sensitive thing a
 * production company holds. Unmapped therefore DENIES, which is the correct
 * answer until a rates table and a rates cap exist together.
 * Reported rather than chosen; recorded in HANDOFF §9 as owed.
 */
export const UNMAPPED = 'unmapped' as const

/**
 * THE RESOLUTION TABLE — the artifact. Every fine question names the single
 * coarse cap that answers it. Total Record, so a new Capability without a
 * decision here fails tsc.
 */
export const CAP_RESOLUTION: Readonly<
  Record<Capability, OrgCap | ClientCap | typeof OWNER_ONLY | typeof UNMAPPED>
> = {
  // money — invoices are one authority; budgets, credits and usage another
  'money.invoice.read': 'money.invoices',
  'money.invoice.write': 'money.invoices',
  'money.invoice.send': 'money.invoices',
  'money.credits.read': 'money.costs',
  'money.credits.topup': 'money.costs',
  'money.budget.read': 'money.costs',
  'money.budget.write': 'money.costs',
  'money.rates.read': UNMAPPED,

  // people — reading the roster is the same authority as changing it today.
  // That is a NARROWING from current behaviour, not a widening: GET
  // /api/admin/team returns the whole roster to any crew member right now.
  'people.roster.read': 'people.manage',
  'people.invite': 'people.manage',
  'people.remove': 'people.manage',
  'people.role.set': 'people.manage',
  'people.caps.grant': 'people.manage',
  'people.caps.deny': 'people.manage',

  // client — the studio's side. Messaging a client rides the work cap, which is
  // where it lives today (run_projects covered "projects, tasks, approvals,
  // files, messages"), so a coordinator can talk to a client without being able
  // to create or delete the company.
  'client.company.read': 'client.manage',
  'client.company.create': 'client.manage',
  'client.company.update': 'client.manage',
  'client.company.delete': 'client.manage',
  // Same cause as the record note below, more mildly: work.projects is by a
  // distance the broadest coarse cap and the one most likely to need splitting
  // first. Mapped here because it is where messaging lives today, and it
  // produces S-R §3.1's coordinator exactly — talk to a client, but never
  // create or delete the company.
  'client.message.send': 'work.projects',
  'client.portal.configure': 'client.manage',

  // work
  'work.project.read': 'work.projects',
  'work.project.create': 'work.projects',
  'work.project.update': 'work.projects',
  'work.project.archive': 'work.projects',
  'work.file.read': 'work.projects',
  'work.file.upload': 'work.projects',
  'work.file.version': 'work.projects',
  'work.file.delete': 'work.projects',
  'work.task.read': 'work.projects',
  'work.task.write': 'work.projects',
  'work.suite.script': 'work.suite',
  'work.suite.storyboard': 'work.suite',

  // record — KNOWN COARSENESS, recorded rather than shipped silently.
  //
  // The approval record and the certificate are the DISPUTE surface (S3-c §3.2).
  // Folding them into work.projects means anyone who can touch a project can
  // export the certificate proving what a client signed off — and nothing above
  // them can narrow that without also removing their ability to work. The
  // record surface has no grant of its own, so it cannot be given or withheld
  // independently of the work.
  //
  // Mapped this way because it is what is true today and this is a RENAME, not a
  // re-grant: splitting it here would be full re-granulation through a side
  // door, asserting an intent nobody recorded. The split is a later decision
  // that needs a real case — a studio wanting a coordinator to run jobs without
  // exporting sign-off certificates. Owed in HANDOFF §9.
  'record.ledger.read': 'work.projects',
  'record.certificate.export': 'work.projects',

  // org — A-5. NOT platform.billing: billing is owner-only and ungrantable
  // under G-2, while the studio's business profile is legitimately an admin's.
  'org.settings.read': 'org.settings',
  'org.settings.write': 'org.settings',

  // portal — identity, per the note on the Capability union above. A crew
  // session's resolved set holds OrgCaps only, so asking a portal key on the
  // studio side answers false, and vice versa. That is the parallel-tree
  // property S1 §0 states, falling out of default-deny rather than a branch.
  'portal.view': 'portal.view',
  'portal.message': 'portal.message',
  'portal.upload': 'portal.upload',
  'portal.approve': 'portal.approve',
  'portal.invoices': 'portal.invoices',
  'portal.team': 'portal.team',

  // platform — G-2: owner-only, and platform.grant is not itself grantable
  'platform.billing': OWNER_ONLY,
  'platform.org.delete': OWNER_ONLY,
  'platform.erasure': OWNER_ONLY,
  'platform.grant': OWNER_ONLY,
} as const

/** Every coarse cap, for the grant surface and the drift check. */
export const ORG_CAPS_ALL: readonly OrgCap[] = [
  'work.projects', 'work.suite', 'client.manage', 'people.manage',
  'money.invoices', 'money.costs', 'org.settings', 'record.approval_policy',
] as const

export const CLIENT_CAPS_ALL: readonly ClientCap[] = [
  'portal.view', 'portal.message', 'portal.upload', 'portal.approve',
  'portal.invoices', 'portal.team',
] as const

/** S-R §4's five domains plus the two this table adds — item 8 groups by these. */
export const CAP_DOMAIN_LABEL: Readonly<Record<string, string>> = {
  money: 'Money',
  people: 'People',
  client: 'Clients',
  work: 'The work',
  record: 'The record',
  org: 'Studio settings',
  portal: 'Portal access',
  platform: 'Platform',
} as const

/** The domain of a cap — the segment before the first dot. */
export function capDomain(cap: string): string {
  return cap.split('.')[0] ?? ''
}
