import * as Sentry from '@sentry/nextjs'

/**
 * The single error-sink boundary (I-10). Call sites use captureError and never
 * import Sentry directly — so the vendor can be swapped by editing one file,
 * and so every capture carries structured context instead of ad-hoc strings.
 *
 * Universal module: safe in server, edge and client code alike. With no DSN
 * configured Sentry.init is disabled and captureException is a no-op, so this
 * degrades to the console — it never throws, because an error sink that can
 * take down the action it observes is worse than none.
 */
export function captureError(err: unknown, context?: Record<string, unknown>): void {
  // Keep the local trace: Vercel/terminal logs stay useful, DSN or not.
  console.error('[captureError]', context?.where ?? '', err)
  try {
    Sentry.captureException(err, context ? { extra: context } : undefined)
  } catch {
    // Never let telemetry throw into the caller.
  }
}
