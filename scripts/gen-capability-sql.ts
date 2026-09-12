/**
 * THE CAPABILITY TABLE IS DATA IN ONE PLACE — this script is what keeps that
 * true across the TS/SQL boundary (Batch 24 ruling 2).
 *
 *   npx tsx scripts/gen-capability-sql.ts --print   → emit the SQL bodies
 *   npm run check:caps                              → compare LIVE SQL to the TS
 *
 * lib/capabilities.ts is the SOURCE. `public.role_baseline()` and
 * `public.client_role_baseline()` are GENERATED from it, and the check mode
 * calls the live functions and diffs their output against the same constants.
 * A Postgres function and a TypeScript constant maintained by hand will
 * diverge, and the first time they do neither is trusted (S-R §5's one
 * resolver). This script is the thing that fails loudly instead.
 */
import { readFileSync } from 'fs'
import {
  ORG_ROLE_BASELINE, CLIENT_ROLE_BASELINE, ORG_CAPS_ALL, CLIENT_CAPS_ALL,
  type OrgRole, type ClientRole,
} from '../lib/capabilities'

function lit(s: string) { return `'${s.replace(/'/g, "''")}'` }

/** `role_baseline(text) → text[]`, generated from ORG_ROLE_BASELINE. */
export function orgBaselineSql(): string {
  const arms = (Object.keys(ORG_ROLE_BASELINE) as OrgRole[])
    .map((r) => `    when ${lit(r)} then array[${ORG_ROLE_BASELINE[r].map(lit).join(', ')}]::text[]`)
    .join('\n')
  return `create or replace function public.role_baseline(p_role text)
returns text[]
language sql
immutable
set search_path = public
as $fn$
  -- GENERATED from lib/capabilities.ts ORG_ROLE_BASELINE by
  -- scripts/gen-capability-sql.ts. Do not edit by hand: npm run check:caps
  -- compares this function's live output against that constant and fails on
  -- drift. An unknown role returns the EMPTY array, never null — so a role this
  -- function has never heard of grants nothing rather than making every
  -- comparison against it null (and therefore not-true, but for the wrong
  -- reason and invisibly).
  select case p_role
${arms}
    else array[]::text[]
  end
$fn$;`
}

/** `client_role_baseline(text) → text[]`, generated from CLIENT_ROLE_BASELINE. */
export function clientBaselineSql(): string {
  const arms = (Object.keys(CLIENT_ROLE_BASELINE) as ClientRole[])
    .map((r) => `    when ${lit(r)} then array[${CLIENT_ROLE_BASELINE[r].map(lit).join(', ')}]::text[]`)
    .join('\n')
  return `create or replace function public.client_role_baseline(p_role text)
returns text[]
language sql
immutable
set search_path = public
as $fn$
  -- GENERATED from lib/capabilities.ts CLIENT_ROLE_BASELINE. See above.
  -- NOTE: 'member' here is a LIVE S-R §8 role, unlike organization_members.role
  -- 'member' which 0050 deprecates. Same word, opposite fates, two tables.
  select case p_role
${arms}
    else array[]::text[]
  end
$fn$;`
}

async function query(sql: string): Promise<Record<string, unknown>[]> {
  const env: Record<string, string> = {}
  for (const raw of readFileSync('.env.local', 'utf8').split('\n')) {
    const l = raw.trim(); if (!l || l.startsWith('#')) continue
    const i = l.indexOf('='); if (i < 0) continue
    env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    },
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`)
  return res.json()
}

async function check(): Promise<number> {
  let bad = 0
  const same = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')

  for (const [fn, table] of [
    ['role_baseline', ORG_ROLE_BASELINE],
    ['client_role_baseline', CLIENT_ROLE_BASELINE],
  ] as const) {
    for (const role of Object.keys(table)) {
      const rows = await query(`select public.${fn}(${lit(role)}) as caps;`)
      const live = (rows[0]?.caps as string[] | null) ?? null
      const want = (table as Record<string, readonly string[]>)[role]
      if (live === null) { console.error(`✗ ${fn}(${role}) returned null`); bad++; continue }
      if (!same(live, want)) {
        console.error(`✗ ${fn}(${role}) DRIFT\n    live: ${[...live].sort().join(' ')}\n    ts:   ${[...want].sort().join(' ')}`)
        bad++
      } else {
        console.log(`  ✓ ${fn}(${role.padEnd(11)}) ${live.length} cap(s)`)
      }
    }
    // An unknown role must return the empty array, not null.
    const rows = await query(`select public.${fn}('nonexistent_role') as caps;`)
    const live = (rows[0]?.caps as string[] | null) ?? null
    if (live === null || live.length !== 0) {
      console.error(`✗ ${fn}('nonexistent_role') should be {} — got ${JSON.stringify(live)}`); bad++
    } else {
      console.log(`  ✓ ${fn}(unknown) → {} (denies)`)
    }
  }

  // Every cap a baseline names must be a declared coarse cap. A typo in a
  // baseline is otherwise a capability nothing can ever grant.
  const declared = new Set<string>([...ORG_CAPS_ALL, ...CLIENT_CAPS_ALL])
  for (const [label, table] of [['org', ORG_ROLE_BASELINE], ['client', CLIENT_ROLE_BASELINE]] as const) {
    for (const [role, caps] of Object.entries(table as Record<string, readonly string[]>)) {
      for (const c of caps) {
        if (!declared.has(c)) { console.error(`✗ ${label} baseline ${role} names undeclared cap ${c}`); bad++ }
      }
    }
  }
  return bad
}

/**
 * PHASE 2 — TS/SQL PARITY, as the personas.
 *
 * The baselines are single-sourced (phase 1 proves the generated function
 * matches the constant). The RESOLUTION ALGORITHM is not: it exists in
 * lib/capabilities.server.ts AND in 0051's has_cap(), because they answer for
 * different callers — an RLS session via auth.uid(), and a server component
 * reading with the service role where auth.uid() is null.
 *
 * So this signs in as each harness persona and asserts the two agree on every
 * coarse cap. Skipped with a LOUD notice when the harness passwords are absent,
 * never silently: a parity check that quietly does nothing is worse than none,
 * because its green tick is then a lie (HANDOFF §12 lesson 2).
 */
async function parity(env: Record<string, string>): Promise<number> {
  const { createClient } = await import('@supabase/supabase-js')
  const { ORG_CAPS_ALL: OC, CLIENT_CAPS_ALL: CC } = await import('../lib/capabilities')
  const ALL = [...OC, ...CC] as string[]

  const people: [string, string][] = [
    ['harness-owner@rls-harness.example.com', env.HARNESS_OWNER_PASSWORD],
    ['harness-crew@rls-harness.example.com', env.HARNESS_CREW_PASSWORD],
    ['harness-revoked@rls-harness.example.com', env.HARNESS_REVOKED_PASSWORD],
    ['harness-c1-own@rls-harness.example.com', env.HARNESS_C1_OWN_PASSWORD],
    ['harness-c1-mate@rls-harness.example.com', env.HARNESS_C1_MATE_PASSWORD],
  ]
  if (people.some(([, pw]) => !pw)) {
    console.log('\n  ! PARITY SKIPPED — harness passwords absent from .env.local.')
    console.log('    Run `npm run seed:harness -- --apply` first. This is a SKIP, not a pass.')
    return 0
  }

  // NO SERVICE ROLE. resolveCaps() takes an injectable client and reads only the
  // caller's own rows, so the parity check hands it the SAME anon session it
  // asks has_cap() through. That is what makes this a real comparison: both
  // sides answer for one RLS session, under the same policies.
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= env.NEXT_PUBLIC_SUPABASE_URL
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const { resolveCaps } = await import('../lib/capabilities.server')

  let bad = 0
  for (const [email, pw] of people) {
    const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    const { data: signed, error } = await c.auth.signInWithPassword({ email, password: pw })
    if (error || !signed.user) { console.error(`✗ parity: ${email} sign-in failed`); bad++; continue }

    const ts = await resolveCaps(signed.user as never, c as never)
    const diffs: string[] = []
    for (const cap of ALL) {
      const { data: sql } = await c.rpc('has_cap', { p_cap: cap })
      const tsHas = ts.caps.has(cap)
      if (Boolean(sql) !== tsHas) diffs.push(`${cap} sql=${Boolean(sql)} ts=${tsHas}`)
    }
    await c.auth.signOut()
    if (diffs.length) { console.error(`✗ parity ${email}\n    ${diffs.join('\n    ')}`); bad += diffs.length }
    else console.log(`  ✓ parity ${email.padEnd(42)} ${ts.caps.size} cap(s) agree`)
  }
  return bad
}

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const raw of readFileSync('.env.local', 'utf8').split('\n')) {
    const l = raw.trim(); if (!l || l.startsWith('#')) continue
    const i = l.indexOf('='); if (i < 0) continue
    env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
  return env
}

async function main() {
  if (process.argv.includes('--print')) {
    console.log(orgBaselineSql())
    console.log()
    console.log(clientBaselineSql())
    return
  }
  console.log('1/2 · live role_baseline()/client_role_baseline() vs lib/capabilities.ts …')
  let bad = await check()
  console.log('\n2/2 · TS resolveCaps() vs SQL has_cap(), as each persona …')
  bad += await parity(loadEnv())
  if (bad > 0) {
    console.error(`\n✗ ${bad} mismatch(es). Regenerate with --print and apply, or fix the constant.`)
    process.exit(1)
  }
  console.log('\n✓ the capability table, the generated SQL and the TS resolver all agree')
}
main().catch((e) => { console.error('FAILED:', e instanceof Error ? e.message : e); process.exit(1) })
