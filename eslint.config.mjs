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
      'no-restricted-syntax': ['error', NO_GET_SESSION, ...NO_SERVICE_ROLE_KEY, NO_RAW_APP_URL, ...NO_SUPABASE_MAILER],
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
      'no-restricted-syntax': ['error', NO_GET_SESSION, NO_RAW_APP_URL, ...NO_SUPABASE_MAILER],
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
      'no-restricted-syntax': ['error', NO_GET_SESSION, ...NO_SERVICE_ROLE_KEY, ...NO_SUPABASE_MAILER],
    },
  },
  {
    // The module that legitimately mints auth links and sends them itself.
    // Only the mailer ban is lifted here; the rest are restated.
    files: ['lib/email/invite.ts'],
    rules: {
      'no-restricted-syntax': ['error', NO_GET_SESSION, NO_RAW_APP_URL],
    },
  },
]

export default eslintConfig
