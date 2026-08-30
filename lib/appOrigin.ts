// The single source of truth for this application's public origin (S0-B §5,
// PI-3). Four domains are planned — genreline.com, .studio, .io, .ai — so the
// hostname is configuration, and every absolute link the server builds (invite
// redirects, password-reset redirects, Stripe return URLs, push deep links) is
// built from here and nowhere else.
//
// LAZY AND GUARDED, per I-11 (S0-A §4.3). A module-scope
// `const ORIGIN = process.env.NEXT_PUBLIC_APP_URL!` freezes the value at import
// time and, when the variable is absent, becomes the *string* "undefined". That
// is not hypothetical: six invite routes interpolated the raw variable, so an
// unset variable shipped `undefined/set-password` to Supabase as the redirect
// target. The invite send succeeds, the email arrives, and the link is dead —
// a broken link that looks like a link is worse than a failed request (I-10).
//
// Written as a literal member access, never `process.env[SOME_CONST]`: Next
// inlines `NEXT_PUBLIC_*` into the client bundle by exact textual match, so an
// indexed read resolves to undefined in the browser.

const ENV_VAR = 'NEXT_PUBLIC_APP_URL'

/** Normalised origin, or null when unset **or** unusable. Never throws. */
function configured(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL
  if (!raw) return null
  const origin = raw.trim().replace(/\/+$/, '')
  if (!origin) return null
  // A scheme-less value ("genreline.com") is not an origin: interpolated into
  // `${origin}/set-password` it yields a relative path, which Supabase's
  // redirect allowlist rejects and a mail client cannot resolve. Treated as
  // unset so the required accessor below reports it rather than propagating it.
  if (!/^https?:\/\//i.test(origin)) return null
  return origin
}

/**
 * This application's public origin, e.g. `https://genreline.com` — no trailing
 * slash. Throws when the variable is unset or is not an absolute http(s)
 * origin. Use this wherever a link must be absolute to work at all.
 */
export function appOrigin(): string {
  const origin = configured()
  if (!origin) {
    throw new Error(
      `${ENV_VAR} is not set to an absolute http(s) origin (e.g. ` +
        `https://genreline.com). Every invite link, password-reset link and ` +
        `payment return URL is built from it, so it cannot be defaulted.`
    )
  }
  return origin
}

/**
 * The origin, or null when it is not configured. Exists for the one caller —
 * push deep links — where a relative path is a legitimate answer rather than a
 * degraded one: the service worker resolves `/messages` against its own origin,
 * so an origin-relative URL is correct there. Do not reach for this to make a
 * link "optional"; an email or a redirect target needs {@link appOrigin}.
 */
export function appOriginOrNull(): string | null {
  return configured()
}

/**
 * Absolute URL for a path on this origin. `path` is joined with exactly one
 * slash whether or not it carries a leading one.
 */
export function appUrl(path: string): string {
  return `${appOrigin()}${path.startsWith('/') ? path : `/${path}`}`
}
