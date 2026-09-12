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

async function main() {
  if (process.argv.includes('--print')) {
    console.log(orgBaselineSql())
    console.log()
    console.log(clientBaselineSql())
    return
  }
  console.log('Checking live role_baseline()/client_role_baseline() against lib/capabilities.ts …')
  const bad = await check()
  if (bad > 0) {
    console.error(`\n✗ ${bad} mismatch(es). Regenerate with --print and apply, or fix the constant.`)
    process.exit(1)
  }
  console.log('\n✓ live SQL matches lib/capabilities.ts')
}
main().catch((e) => { console.error('FAILED:', e instanceof Error ? e.message : e); process.exit(1) })
