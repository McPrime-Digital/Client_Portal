import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { withSentryConfig } from '@sentry/nextjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root — a stray package-lock.json in the home dir
  // otherwise makes Next infer the wrong root.
  turbopack: {
    root: __dirname,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '50gb',
    },
  },
};

// Sentry wraps the config to upload source maps during the Vercel build.
// With SENTRY_AUTH_TOKEN unset it warns and skips the upload — the build never
// fails on missing telemetry credentials (I-11 in spirit).
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
});
