import * as Sentry from '@sentry/nextjs'

// Next.js instrumentation hook: loads the right Sentry init per runtime.
// The DSN is optional — absent, init is disabled and everything no-ops (I-11:
// nothing here throws on a missing env var).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

// Captures errors from nested React Server Components and route handlers that
// would otherwise only reach the terminal.
export const onRequestError = Sentry.captureRequestError
