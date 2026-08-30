# Genreline

A film-production OS built to sell. Studios run their craft work and their
client relationships in one place; their clients get a portal that wears the
studio's brand, not ours.

The product was called **Throughline** through the spec phase. `S0-B` retires
that name — see [`docs/specs/S0-B-product-identity.md`](docs/specs/S0-B-product-identity.md).

## Read these first, in this order

1. **[`HANDOFF.md`](HANDOFF.md)** — the verified project state: what is built,
   what is open (with `file:line`), what to do next. Compiled from the code and
   the live database, never from memory.
2. **[`CLAUDE.md`](CLAUDE.md)** — the working mechanics: commands, which Supabase
   client to use where, route groups, env vars, the quirks that bite.
3. **[`docs/specs/`](docs/specs/)** — the reasoning. `S0` → `S0-A` → `S0-B` →
   `S0-conformance` → `S1-P` → `S-V` → `S1` → `S2`.

Where two documents disagree, the later amendment wins: `S0-A` supersedes named
`S0` entries, and `S0-B` supersedes the product name everywhere. Prior documents
are not edited — their text stands as the record of what was believed at the time.

## Stack

Next.js 16 (App Router, RSC) · React 19 · TypeScript strict · Tailwind v3 with
CSS custom-property design tokens · Supabase (Postgres, Auth, Realtime) ·
Cloudflare R2 via presigned direct-to-R2 uploads · Zustand · BlockNote + Yjs ·
Sentry. Deployed on Vercel.

## Commands

```bash
npm run dev              # dev server on :3000
npm run build            # production build
npm run lint             # eslint . — Next 16 removed `next lint`, and lint
                         # does NOT run during the build
npm run test:rls         # the RLS harness — run after anything touching
                         # policies, auth or tenancy
npm run seed:harness     # seed the isolation-test tenants
npm run provision:tenant # create a new tenant and its first owner
```

There is no unit-test framework. `scripts/test-rls.ts` is the only test harness;
do not claim tests passed on the strength of anything else.

## Configuration

Copy `.env.example` to `.env.local` and fill it in. Two things are worth knowing
before you change either:

- **`NEXT_PUBLIC_APP_URL`** is the product's public origin, read in exactly one
  place (`lib/appOrigin.ts`). Every invite link, password-reset link and payment
  return URL is built from it.
- **Changing the domain is not only that variable.** Supabase Auth holds its own
  Site URL and redirect allowlist as project configuration. Miss those and every
  invite and reset link breaks silently, for everyone.

## Migrations

`supabase/migrations/`, applied by hand in `00NN` filename order, forward-only
and idempotent. `_archive/` is never applied — read `_archive/README.md` before
touching it. There is no migration runner yet; which one to adopt is open (S6).
