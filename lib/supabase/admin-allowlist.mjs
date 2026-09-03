/**
 * The I-8 service-role allowlist — a RATCHET, not an inventory.
 *
 * S0 I-8: "No service-role access on a user-session path. Allowlist only, each
 * entry justified in comment." S0-A §4.4 sets the strategy and the reason:
 * allowlist every importer on day one, then shrink it, because without the lint
 * rule in place during a migration this long the surface regrows behind you.
 *
 * So this file starts WRONG on purpose. Almost every path below is a violation
 * — a cookie-bound user request reading through a client that bypasses RLS
 * entirely. The rule's job today is not to make them legal; it is to stop a
 * 70th from appearing while the read paths move off one surface at a time
 * (S2 §7 order: helpers → harness → policies → reads → writes → shrink).
 *
 * HOW TO USE IT
 *   · Removing a path is the migration. That is the only edit that improves
 *     anything here.
 *   · Adding a path requires a reason in review. If the surface has a user
 *     session, the answer is the user client and RLS (AD-001), not an entry.
 *   · PERMANENT entries are the four categories S2 §7 enumerates. They stay
 *     when the list is otherwise empty, and each carries its justification.
 *
 * Consumed by eslint.config.mjs. Two rules back it, because two shapes reach
 * the service role:
 *   · `no-restricted-imports` on '@/lib/supabase/admin' — the 69 importers.
 *   · `no-restricted-syntax` on SUPABASE_SERVICE_ROLE_KEY — the handler that
 *     constructs its own client inline and so imports nothing
 *     (create-client:48), plus anything new that tries. There were two until
 *     Batch 10.3; resend-invite now uses the shared client.
 *
 * NOT IN SCOPE HERE, deliberately: migrating any of these files, the
 * getSupabaseAdmin() lazy accessor (I-11), and the read-path flips. S0-A §4.3
 * makes I-8 and I-11 one pass over the same files — doing half of it now would
 * mean touching them twice.
 *
 * Count note: HANDOFF §4's figure of 71 is right, and the ratchet proved it on
 * its first run. A grep for the import specifier finds 67 files; ESLint, which
 * parses instead of matching text, found two more whose import is split across
 * lines so the specifier does not share a line with `from`
 * (app/(admin)/admin/clients/page.tsx and .../clients/[id]/page.tsx). That is
 * 69 importers, plus the 2 handlers that construct a client inline and import
 * nothing — 71 modules touching the service role. A text-based inventory of
 * this list would have shipped wrong by two, which is the argument for the rule
 * rather than a checklist.
 */

/**
 * PERMANENT — the four categories S2 §7 enumerates. These do not shrink.
 * Each is here because there is no user session to bind to, or because the
 * operation is one only the service role can perform.
 */
export const PERMANENT = [
  // No session by construction: Stripe posts to this endpoint, not a browser.
  // The signature is the authentication.
  'app/api/webhooks/stripe/route.ts',

  // Cron. GET is bearer-authenticated by CRON_SECRET and has no user session.
  // CAVEAT, recorded rather than hidden: the POST half of this route IS a
  // user-session path — PresencePulse calls it on every page load — and it runs
  // the same service-role scan. That half is not permanent and is not fixed
  // here; it belongs to the S2 §7 write-path pass.
  // BATCH 22 narrowed the COST but not the SHAPE: the app-load trigger is now
  // throttled to once per 15 minutes per organization, so the scan no longer
  // runs per page load. Deleting the POST half was considered and rejected —
  // it is the only near-real-time coverage between once-daily crons, so
  // removing it would turn a 5-hour nudge into as much as 29. The structural
  // violation stands and is still S2 §7's.
  'app/api/cron/message-nudge/route.ts',

  // The approvals auto-advance sweep (Batch 22 item 5). GET only, bearer-
  // authenticated by CRON_SECRET, no user session — a lapse has NO actor by
  // definition (S3-c AP-2), so there is no session to run it as.
  // DELIBERATELY NOT the shape above it: this route has NO POST half, because
  // the caveat on message-nudge describes a real defect and this route writes
  // into a contractual record and sends mail as a studio. PERMANENT.
  'app/api/cron/approval-sweep/route.ts',

  // Supabase Auth admin calls — inviteUserByEmail / createUser /
  // updateUserById / listUsers require the service role by design; there is no
  // user-client equivalent. PERMANENT FOR THE AUTH CALLS ONLY. Every one of
  // these files also does ordinary table work through the same client, and that
  // half is transitional — the file-level granularity of an ESLint allowlist
  // cannot express the split, so it is written down instead.
  'app/api/admin/team/route.ts',
  'app/api/portal/team/route.ts',
  'app/api/admin/client-team/route.ts',
  'app/api/admin/invite-client/route.ts',
  'app/api/admin/create-client/route.ts',
  'app/api/admin/resend-invite/route.ts',
  'lib/memberAccess.ts',

  // push_subscriptions has no FK to clients and no reliable tenant predicate,
  // so RLS cannot express who may read a row (S2 §4, "Not covered by RLS").
  // Same caveat as above: subscribe/route.ts also reads other tables.
  'lib/push.ts',
  'app/api/push/subscribe/route.ts',

  // Operator scripts. No session exists at all — they run from a terminal
  // against .env.local, which is the only place the key legitimately lives
  // outside the server runtime.
  //   provision-tenant creates an organization and its first owner; it is the
  //   replacement for the orgRolesOf() bootstrap fallback (Batch 7 item 5) and
  //   necessarily predates any session that could authorize it.
  'scripts/provision-tenant.ts',
  'scripts/seed-harness-tenant.ts',

  // ADDED IN BATCH 12.2 — person-level erasure (AD-003 tombstone + account
  // delete, S0 §5). Two reasons it cannot be the user client: the auth-admin
  // calls (listUsers, deleteUser) exist only on the service role, and the
  // tombstone rewrites rows by user id ACROSS tenants — an identity may span
  // them (S1 §2), so no single tenant's RLS view could reach every row an
  // erasure must touch. The ROUTE (erase-person) gates it to an owner on the
  // plan carrying 'platform.erasure' — the house plan only — until S3 ships
  // per-tenant erasure.
  'lib/erasure.ts',
]

/**
 * TRANSITIONAL — every remaining service-role importer. All violations of I-8.
 * This is the list that must reach zero, one surface at a time, in S2 §7's
 * order: portal reads first (highest traffic, easiest to verify), then studio,
 * then writes. Grouped as the conformance report groups them so a surface can
 * be crossed off as a unit.
 */
export const TRANSITIONAL = [
  // ── portal page components — S2 §7 step 4, the first surfaces to flip ─────
  'app/(portal)/layout.tsx',
  'app/(portal)/dashboard/page.tsx',
  'app/(portal)/dashboard/invoices/page.tsx',
  'app/(portal)/dashboard/settings/page.tsx',
  'app/(portal)/approvals/page.tsx',
  'app/(portal)/files/page.tsx',
  'app/(portal)/invoices/page.tsx',
  'app/(portal)/messages/page.tsx',
  'app/(portal)/projects/page.tsx',
  'app/(portal)/projects/[id]/page.tsx',
  'app/onboarding/page.tsx',

  // ── portal route handlers ────────────────────────────────────────────────
  'app/api/portal/actions/route.ts',
  'app/api/portal/avatar/route.ts',
  'app/api/portal/badge-counts/route.ts',
  'app/api/portal/messages/route.ts',
  'app/api/portal/messages/attachment/route.ts',
  'app/api/portal/messages/delete/route.ts',
  'app/api/portal/messages/edit/route.ts',
  'app/api/portal/notifications/route.ts',
  'app/api/portal/onboarding/route.ts',

  // ── rooms (Batch 23, S3-d) — layered deliberately: creation, seating and
  //    sends run on the USER client under the 0046 policies (AD-001); the
  //    service role here does only what a session rightly cannot — resolve
  //    names/avatars across both roster trees, presign R2, and stamp
  //    delivered on OTHER people's rows. Shrinks with the S2 §7 read flips.
  'app/api/rooms/route.ts',
  'app/api/rooms/[roomId]/route.ts',
  'app/api/rooms/[roomId]/members/route.ts',
  'app/api/rooms/[roomId]/messages/route.ts',
  'app/api/project-tasks/route.ts',
  'app/api/presence/heartbeat/route.ts',

  // ── shared route handlers (both sides of the house) ──────────────────────
  'app/api/files/commit/route.ts',
  'app/api/files/signed-url/route.ts',
  'app/api/files/[id]/route.ts',
  'app/api/files/[id]/download/route.ts',
  'app/api/files/[id]/raw/route.ts',

  // ── studio / admin route handlers ────────────────────────────────────────
  'app/api/admin/badge-counts/route.ts',
  'app/api/admin/create-project/route.ts',
  'app/api/admin/deadline-check/route.ts',
  'app/api/admin/delete-client/route.ts',
  'app/api/admin/invoice-actions/route.ts',
  'app/api/admin/messages/route.ts',
  'app/api/admin/notifications/route.ts',
  'app/api/admin/project-actions/route.ts',
  'app/api/admin/project-image/route.ts',
  'app/api/admin/update-client/route.ts',

  // ── studio page components ───────────────────────────────────────────────
  'app/studio/layout.tsx',
  'app/studio/client/review/page.tsx',

  // ── the (admin) route group — dead code, unreachable behind the proxy ─────
  // These flip by DELETION, not migration, once S4 answers where the canonical
  // modules live (HANDOFF §11 q5). Listed so the count is honest.
  'app/(admin)/admin/page.tsx',
  'app/(admin)/admin/dashboard/page.tsx',
  'app/(admin)/admin/files/page.tsx',
  'app/(admin)/admin/messages/page.tsx',
  'app/(admin)/admin/clients/page.tsx',
  'app/(admin)/admin/clients/[id]/page.tsx',
  'app/(admin)/admin/clients/[id]/edit/page.tsx',
  'app/(admin)/admin/invoices/page.tsx',
  'app/(admin)/admin/invoices/new/page.tsx',
  'app/(admin)/admin/projects/page.tsx',
  'app/(admin)/admin/projects/new/page.tsx',
  'app/(admin)/admin/projects/[id]/page.tsx',
  'app/(admin)/admin/projects/[id]/edit/page.tsx',

  // ADDED IN BATCH 10 (S-C §6). STORAGE ONLY, and the file says so in its
  // header: the `organizations` row it writes goes through the COOKIE-BOUND
  // USER CLIENT so `organizations_admin_write` (0021:393) is the tenant
  // boundary, and the write is checked for zero affected rows rather than
  // assumed. The service role appears solely because `storage.objects` has no
  // policy covering an `org/<orgId>/` path; writing one is S2 §7 work, not this
  // route's. When that policy exists this entry is removable without touching
  // the route's authorization at all.
  'app/api/studio/organization/logo/route.ts',

  // ADDED IN BATCH 11.6. Runs mid-invite, for someone who has just exchanged a
  // token for a session, to answer "who are you and where do you belong".
  //
  // Why not the user client and RLS, which AD-001 asks of a NEW surface: the
  // portal policies resolve through `current_org()` / `client_id`, i.e. the
  // JWT's claims — and this is the ONE moment those are least reliable, because
  // the claims were stamped by the invite route seconds earlier and the token
  // in hand may predate them. RLS would return zero rows rather than error, and
  // the page would silently fall back to neutral branding: the empty-result
  // failure AD-001 exists to prevent, on the screen where getting the tenant
  // right matters most.
  //
  // The exposure is bounded by construction rather than by a policy: EVERY
  // query here is `.eq('user_id', user.id)` against the caller's own session,
  // and the single `clients` read follows the membership row that lookup
  // returned. It cannot address another person's row, let alone another
  // tenant's. Moves with the portal in the S2 §7 flip.
  'app/api/auth/welcome-context/route.ts',

  // ── lib modules ──────────────────────────────────────────────────────────
  // These are called FROM session paths rather than being one themselves, so
  // they move when their callers do — not before, and not independently.
  'lib/businessSettings.ts',
  'lib/credits.ts',
  'lib/logActivity.server.ts',
  'lib/notify.ts',
  // ADDED IN BATCH 10.3. Auth-admin calls only: generateLink() creates the
  // account and mints the action link, which no user-session client can do.
  // Same category as the invite routes already on this list — PERMANENT in
  // spirit, listed here because the S2 §7 pass has not reclassified it yet.
  'lib/email/invite.ts',
  'lib/team.ts',
  // ADDED IN BATCH 9.2, and it grows this list by one — recorded rather than
  // quietly absorbed. It resolves a tenant's own name and logo for the client
  // portal, from business_settings (already here) and organizations.
  //
  // Why not the user client and RLS, which AD-001 would normally require of a
  // NEW surface: `organizations_member_read` (0021:389) matches on
  // `id = current_org()`, i.e. the caller's JWT claim. The portal deliberately
  // resolves the tenant from the CLIENT COMPANY ROW instead — the company is
  // the authority on which studio it belongs to (app/(portal)/layout.tsx:99-104)
  // — and a client whose claim is missing would read zero rows and silently
  // render the neutral stand-in instead of the studio's name. That is the
  // empty-result failure AD-001 exists to prevent, so this reads the way the
  // rest of the portal reads and moves with it in the S2 §7 portal flip.
  'lib/tenantBrand.ts',
  'lib/uploadScope.ts',
  'lib/usage.ts',
]

/**
 * ESLint flat-config `files` patterns are globs, and the (portal) / (admin)
 * route-group directories contain parentheses — extglob syntax to minimatch.
 * Escaping them keeps the paths literal; without this, eleven (admin) entries
 * and eleven (portal) entries would silently match nothing and the rule would
 * fire on files the list is supposed to cover.
 */
const escapeGlob = (p) => p.replace(/[()[\]]/g, (c) => `\\${c}`)

export const SERVICE_ROLE_ALLOWLIST = [...PERMANENT, ...TRANSITIONAL].map(escapeGlob)
