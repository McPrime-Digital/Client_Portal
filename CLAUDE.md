# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

Next.js 16 (App Router, React Server Components by default), React 19, TypeScript strict, Tailwind + shadcn/ui, Supabase (Postgres + Auth), Cloudflare R2 (S3-compatible) for storage, Stripe for invoicing, Resend for email, Zustand for client state, React Hook Form + Zod for forms. Package manager: npm.

Note: dynamic-route `params` and `next/headers` `cookies()` are async (Promises) — always `await` them.

## Commands

- `npm run dev` — Next.js dev server on :3000
- `npm run build` — production build
- `npm run lint` — ESLint flat config (`eslint.config.mjs`, extends `eslint-config-next` core-web-vitals + typescript)

There is no test framework configured. Do not invent one or claim tests passed.

## Build / lint quirks

- Next 16 removed `next lint`. Linting runs via `eslint .` (flat config in `eslint.config.mjs`) and is **not** run during `next build` — run `npm run lint` explicitly to surface issues. Lint failures do not fail the build.
- `experimental.serverActions.bodySizeLimit` is `"50gb"` — a historical setting from when uploads were buffered through Server Actions. Uploads now go direct browser→R2 (see "Uploads" below), so this limit no longer governs them; it only affects any remaining Server Actions.
- `next.config.mjs` pins `turbopack.root` to the project dir — a stray `package-lock.json` in the home directory otherwise makes Next infer the wrong workspace root.

## Supabase clients — pick the right one

Three distinct clients in `lib/supabase/`. Using the wrong one breaks RLS or leaks privileges.

- `lib/supabase/server.ts` → `createServerClient()` — use in Server Components, Route Handlers, Server Actions. Reads the user's session from cookies; subject to RLS as that user.
- `lib/supabase/client.ts` → `createBrowserClient()` — use only in `"use client"` components. Anon key, subject to RLS.
- `lib/supabase/admin.ts` → `supabaseAdmin` — service-role key, **bypasses RLS.** Server-only. Use sparingly and never import from a client component.

## RLS is load-bearing

Row-Level Security policies enforce role-based access on every table. Before adding or modifying a query, or changing a table's schema, check that the relevant policies still hold. Don't paper over an RLS failure by switching to `supabaseAdmin` — that hides a real authorization bug.

## Proxy / middleware redirects (`proxy.ts`)

Next 16 renamed the `middleware` convention to `proxy`: the logic lives in `proxy.ts` and exports `proxy()` (plus the `config` matcher). It refreshes the Supabase session on every request and enforces role routing. Subtle rules — don't break them:

- `/set-password` must pass through even when unauthenticated (otherwise password-reset users hit a redirect loop).
- `/auth/callback` is reserved for future OAuth — leave it routable.
- Admins hitting `/dashboard` → redirected to `/admin`; clients hitting `/admin` → redirected to `/dashboard`.
- Logged-in users hitting `/login` → redirected to their role-appropriate home.

When editing the proxy, walk through each of these paths mentally before saving.

## Route groups

- `app/(auth)/` — public auth flows (`/login`, `/reset-password`, `/set-password`).
- `app/(portal)/` — client-facing protected area (`/dashboard`, `/projects`, `/files`, `/messages`, `/invoices`). Layout does the session + role check.
- `app/(admin)/` — admin-only (`/admin`). Layout enforces `role === 'admin'`.
- `app/api/` — route handlers for files, portal, admin, and webhooks (Stripe).

## Uploads — direct-to-R2 (presigned)

All file/attachment uploads go **straight from the browser to Cloudflare R2** via a presigned PUT URL — the bytes never pass through a serverless function, so there is no request-body size limit (this is what makes uploads work on Vercel, which hard-caps function bodies at ~4.5MB).

Flow (`lib/uploadClient.ts` → two route handlers):
1. `POST /api/files/presign` — auth + authorize for the project, mint a collision-safe key `<clientId>/<projectId>/<rand>` and return a presigned PUT URL. The key is always server-generated; the message-attachment route derives the owning client from the first path segment, so keep that namespacing.
2. Browser `PUT`s the file to R2 (Content-Type must match what was presigned).
3. `POST /api/files/commit` — re-authorize, verify the key prefix, insert the `files` row with `bucket: 'r2'`.

Reads already branch on `bucket === 'r2'`: `getSignedDownloadUrl` (2-min download / longer inline) and `getR2ObjectStream` (the same-origin `/raw` proxy). **Do not reintroduce server-side upload routes that buffer the file** (`req.formData()` → upload) — they break on Vercel above 4.5MB. Direct browser→R2 needs a CORS policy on the bucket allowing `PUT` from the app origin.

Avatars/logos are the one exception: small images still upload through `/api/portal/avatar` to Supabase Storage (`client-files`), which can mint the ~10-year signed URL the sidebar needs (R2 presigned URLs max out at 7 days).

`lib/r2.ts` still exports the legacy `uploadToR2`/multipart helpers, but nothing calls them now.

## Required env vars

Loaded from `.env.local` (gitignored). All required for the app to boot:

- Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- Stripe: `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- Resend: `RESEND_API_KEY`
- R2: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`
- App: `NEXT_PUBLIC_APP_URL`

## Assets

- `public/mcprime-logo.jpg` — the McPrime Digital brand lockup. Render it via the `McPrimeLogo` component (`components/McPrimeLogo.tsx`), which wraps it in a rounded tile so the black-background art reads on both themes. Use it only for McPrime's own branding (auth screens, admin chrome) — never for a client's company logo (the client sidebar shows the client's uploaded avatar, falling back to their initial).
