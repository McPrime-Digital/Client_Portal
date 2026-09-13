import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

import { SERVICE_ROLE_ALLOWLIST } from './lib/supabase/admin-allowlist.mjs'

/**
 * `supabase.auth.getSession()` decodes the session cookie locally and returns
 * whatever it contains. It does not ask the auth server whether that token is
 * still valid, so a revoked, expired or tampered token still yields a `user`.
 * Every authorization gate must use `getUser()`, which revalidates (S2 §2).
 *
 * Banned everywhere except `lib/supabase/`, where the session helpers
 * legitimately handle raw sessions. Anywhere else, a genuine non-authorization
 * use (reading local session state in a pre-auth client flow) must carry an
 * explicit `eslint-disable-next-line` and say why — visible and reviewable,
 * rather than silently exempted by a path glob.
 */
const NO_GET_SESSION = {
  selector: "CallExpression[callee.property.name='getSession']",
  message:
    'Use auth.getUser(), not auth.getSession(). getSession() reads the cookie without revalidating it against the auth server, so it cannot gate access (S2 §2, C-1).',
}

/**
 * The service-role key bypasses RLS completely. Two shapes reach it, and the
 * ratchet has to catch both or it catches neither:
 *
 *   · importing `supabaseAdmin` — 67 modules, handled by NO_ADMIN_IMPORT below;
 *   · naming SUPABASE_SERVICE_ROLE_KEY to build a client inline — which imports
 *     nothing, so an import rule cannot see it. ONE handler still does this
 *     (`create-client:48`); `resend-invite` was the second until Batch 10.3
 *     rewrote it onto the shared client. Without this selector a third could be
 *     added tomorrow with the import rule fully green.
 */
const NO_SERVICE_ROLE_KEY = [
  {
    selector: "MemberExpression[property.name='SUPABASE_SERVICE_ROLE_KEY']",
    message:
      'The service-role key bypasses RLS. Do not construct a service-role client here — use the cookie-bound user client (AD-001). If this path genuinely has no user session, add it to lib/supabase/admin-allowlist.mjs with a justification (I-8).',
  },
  {
    selector: "Literal[value='SUPABASE_SERVICE_ROLE_KEY']",
    message:
      'The service-role key bypasses RLS. Do not read it here — use the cookie-bound user client (AD-001). If this path genuinely has no user session, add it to lib/supabase/admin-allowlist.mjs with a justification (I-8).',
  },
]

/**
 * I-8's ratchet. S0-A §4.4: allowlist every importer on day one, then shrink,
 * because during a migration this long the surface otherwise regrows behind
 * you. The allowlist and its per-category justifications live in
 * lib/supabase/admin-allowlist.mjs; removing an entry from it is the migration.
 */
const NO_ADMIN_IMPORT = {
  paths: [
    {
      name: '@/lib/supabase/admin',
      message:
        'supabaseAdmin bypasses RLS. A user-session path must use the cookie-bound client from @/lib/supabase/server (AD-001, I-8). If this path genuinely has no session, add it to lib/supabase/admin-allowlist.mjs with a justification — the list is a ratchet that shrinks, and additions need a reason in review.',
    },
  ],
}

/**
 * S0-B PI-3 / §5. Four domains are planned, so the application's own origin is
 * configuration read in exactly one place — `lib/appOrigin.ts`. Reading the
 * variable directly is banned rather than merely discouraged because the
 * failure is silent: `${process.env.NEXT_PUBLIC_APP_URL}/set-password` with the
 * variable unset interpolates to the string `undefined/set-password` and sends
 * a dead invite link that looks like a link. Six routes did exactly that.
 *
 * This is the invariant, not the cleanup (HANDOFF §12 lesson 1): converting the
 * eight sites without banning the ninth leaves a repair, not a rule.
 */
const NO_RAW_APP_URL = {
  selector: "MemberExpression[property.name='NEXT_PUBLIC_APP_URL']",
  message:
    "Read the application origin through appOrigin()/appUrl() from @/lib/appOrigin, never process.env directly. Unset, the raw variable interpolates to the string 'undefined' and ships a dead link (S0-B §5, I-11).",
}

/**
 * S-C CM-5. Supabase Auth's email templates are GLOBAL PER PROJECT, so anything
 * sent through its mailer can never name the sending studio — not with better
 * copy, not with more configuration. Batch 10.3 moved every invite and the
 * password reset onto `generateLink()` + `lib/email`, and nothing calls these
 * two any more.
 *
 * The ban is what keeps it that way. Deleting Supabase's SMTP config does NOT:
 * custom SMTP replaces the built-in sender rather than gating it, so removing
 * it reverts to Supabase's own service — unbranded, from a supabase.io address,
 * rate-limited. Neither option fails loudly, so the loud failure has to happen
 * here, at the call site, before the code ships.
 *
 * `lib/email/invite.ts` is exempt: it is the module that legitimately mints the
 * links, via generateLink, and sends them itself.
 */
const NO_SUPABASE_MAILER = [
  {
    selector: "CallExpression[callee.property.name='inviteUserByEmail']",
    message:
      "Do not send through Supabase's mailer — its templates are global per project and cannot carry the sending studio's name. Use sendTenantInvite() from @/lib/email/invite, which mints the link with generateLink() and sends it studio-branded (S-C CM-5).",
  },
  {
    selector: "CallExpression[callee.property.name='resetPasswordForEmail']",
    message:
      "Do not send through Supabase's mailer — its templates are global per project. Post to /api/auth/password-reset, which resolves the account's tenant and sends a studio-branded reset (S-C CM-5).",
  },
]

/**
 * S-R §5's "one resolver", as a ratchet (Batch 26 item 8).
 *
 * The role baselines are DATA — `lib/capabilities.ts` declares them and
 * `scripts/gen-capability-sql.ts` generates `role_baseline()` in SQL from them.
 * Reading them to ANSWER a permission question is the defect item 8 removed from
 * 28 call sites: `baseline(role) OR extra_caps.includes(cap)` cannot see a
 * DENIAL, because `extra_caps` is a projection of the grant rows only
 * (lib/grants.ts:149-153). Four functions did exactly that and are deleted.
 *
 * This is the invariant rather than the cleanup, for the reason NO_RAW_APP_URL
 * states above and HANDOFF §12 lesson 1 states generally: converting 28 sites
 * without banning the 29th leaves a repair. And the 29th is easy to write —
 * `ORG_ROLE_BASELINE[role]?.includes(cap)` reads as obviously correct, is one
 * line, and is wrong in a direction nothing tests.
 *
 * THREE readers are legitimate and each is exempted below with its reason:
 *   · lib/capabilities.server.ts   — IS the resolver
 *   · scripts/gen-capability-sql.ts — generates the SQL and checks the parity
 *   · app/api/cron/approval-sweep/route.ts — answers about SOMEBODY ELSE, with
 *     no session to resolve through, and it already subtracts denials (it is the
 *     one consumer that was correct before this batch)
 */
const NO_BASELINE_AS_ORACLE = [
  {
    selector: "ImportSpecifier[imported.name='ORG_ROLE_BASELINE']",
    message:
      'Do not resolve capability from a role baseline — it cannot see a DENIAL (extra_caps carries grants only). Ask can()/hasCap() from @/lib/capabilities.server, the one resolver (S-R §5, R-3).',
  },
  {
    selector: "ImportSpecifier[imported.name='CLIENT_ROLE_BASELINE']",
    message:
      'Do not resolve capability from a role baseline — it cannot see a DENIAL (extra_caps carries grants only). Ask can()/hasCap() from @/lib/capabilities.server, the one resolver (S-R §5, R-3).',
  },
  {
    // Added with R-10's baselines (Batch 26 item 5). Same hazard, one axis over:
    // a project role grants capabilities too, so reading this table to answer a
    // permission question skips the denial subtraction in exactly the same way.
    selector: "ImportSpecifier[imported.name='PROJECT_ROLE_BASELINE']",
    message:
      'Do not resolve capability from a project-role baseline — it cannot see a DENIAL. Ask can()/hasCap() from @/lib/capabilities.server, the one resolver (S-R §5, R-3, R-10).',
  },
]

/**
 * EVERY syntax rule, in one place — so the restatement blocks below can subtract
 * what they exempt instead of re-listing what they keep.
 *
 * Written this way because the blocks USED to re-list, and that made every new
 * rule a four-place edit whose failure mode is silence: forget one line and the
 * rule is simply off for 69 files, with lint fully green. The getSession comment
 * on the allowlist block already names that hazard; this removes it rather than
 * warning about it again.
 */
const ALL_SYNTAX = [
  NO_GET_SESSION, ...NO_SERVICE_ROLE_KEY, NO_RAW_APP_URL, ...NO_SUPABASE_MAILER,
  ...NO_BASELINE_AS_ORACLE,
]
const except = (...lifted) => ALL_SYNTAX.filter((r) => !lifted.flat().includes(r))

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'scratch/**',
      // Ad-hoc one-off scripts at repo root (see CLAUDE.md), not part of the app.
      'test-*.ts',
      'fix-schema.ts',
      'update_components.py',
    ],
  },
  {
    rules: {
      'no-restricted-syntax': ['error', ...ALL_SYNTAX],
      'no-restricted-imports': ['error', NO_ADMIN_IMPORT],
    },
  },
  {
    // The I-8 allowlist. Only the service-role rules are lifted here — the
    // getSession ban is restated rather than dropped, because turning
    // `no-restricted-syntax` off wholesale for 69 files would silently
    // un-ban getSession across most of the application.
    files: SERVICE_ROLE_ALLOWLIST,
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-syntax': ['error', ...except(NO_SERVICE_ROLE_KEY)],
    },
  },
  {
    // The three Supabase client factories own session handling itself, and
    // admin.ts is where the service-role key is legitimately read.
    files: ['lib/supabase/**'],
    rules: {
      'no-restricted-syntax': 'off',
      'no-restricted-imports': 'off',
    },
  },
  {
    // The one place NEXT_PUBLIC_APP_URL is read. Only that ban is lifted; the
    // others are restated, for the reason given on the allowlist block above.
    files: ['lib/appOrigin.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...except(NO_RAW_APP_URL)],
    },
  },
  {
    // The module that legitimately mints auth links and sends them itself.
    // Only the mailer ban is lifted here; the rest are restated.
    files: ['lib/email/invite.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...except(NO_SUPABASE_MAILER, NO_SERVICE_ROLE_KEY)],
    },
  },
  {
    // The TWO legitimate readers of a role baseline (see NO_BASELINE_AS_ORACLE).
    // Only that ban is lifted; everything else is still in force, which is the
    // whole point of `except()`.
    //
    // THE RATCHET SHRANK BY ONE. app/api/cron/approval-sweep/route.ts was the
    // third, because it hand-rolled the resolution to answer about somebody else.
    // That copy had drifted three ways and is deleted — it now calls
    // resolveCapsForMember(), so it reads no baseline and needs no exemption.
    // Removing an entry is the migration; this is what that looks like.
    files: [
      'lib/capabilities.server.ts',
      'scripts/gen-capability-sql.ts',
    ],
    rules: {
      'no-restricted-syntax': ['error', ...except(NO_BASELINE_AS_ORACLE)],
    },
  },
]

export default eslintConfig
