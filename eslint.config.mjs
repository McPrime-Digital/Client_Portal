import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

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
      'no-restricted-syntax': ['error', NO_GET_SESSION],
    },
  },
  {
    // The three Supabase client factories own session handling itself.
    files: ['lib/supabase/**'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
]

export default eslintConfig
