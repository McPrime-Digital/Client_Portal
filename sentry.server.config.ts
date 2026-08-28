import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Errors only. Tracing and profiling burn free-tier quota (S0 §6: nothing
  // with a fixed monthly floor) and the current need is "failures stop being
  // invisible", not performance telemetry.
  tracesSampleRate: 0,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
})
