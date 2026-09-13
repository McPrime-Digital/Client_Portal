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
  ORG_ROLE_BASELINE, CLIENT_ROLE_BASELINE, PROJECT_ROLE_BASELINE,
  ORG_CAPS_ALL, CLIENT_CAPS_ALL, type ProjectRole,
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

/**
 * `project_role_baseline(text) → text[]`, generated from PROJECT_ROLE_BASELINE.
 *
 * WHY THIS EXISTS IN SQL AT ALL, when no policy reads it yet: the PARITY CHECK
 * demands it. Phase 2 signs in as each persona and asserts that resolveCaps()
 * and has_cap() agree on every coarse cap. Item 5 teaches resolveCaps() to union
 * project-role baselines (S-R §5 step 4), so the moment a persona holds a project
 * role — item 9 seeds exactly that — the two sides would disagree and phase 2
 * would fail. Generating the function and teaching has_cap() to use it is what
 * keeps "one resolver" true rather than aspirational.
 *
 * That is a stronger reason than the house style, and it is worth stating,
 * because a generated function with no consumer is `is_admin()` — which has had
 * zero database consumers since 0021 and survives only as a trap.
 */
export function projectRoleBaselineSql(): string {
  const arms = (Object.keys(PROJECT_ROLE_BASELINE) as ProjectRole[])
    .map((r) => `    when ${lit(r)} then array[${PROJECT_ROLE_BASELINE[r].map(lit).join(', ')}]::text[]`)
    .join('\n')
  return `create or replace function public.project_role_baseline(p_role text)
returns text[]
language sql
immutable
set search_path = public
as $fn$
  -- GENERATED from lib/capabilities.ts PROJECT_ROLE_BASELINE. See role_baseline
  -- above for the drift rule. An unknown role — and a NULL project_role, which
  -- 0057 admits and which means "on the production, no stated role" — both return
  -- the EMPTY array. \`observer\` also returns empty, deliberately: S-R §3.2 has it
  -- exist so somebody can be put on a production read-only without inventing a
  -- denial for every write capability.
  select case p_role
${arms}
    else array[]::text[]
  end
$fn$;`
}

/** `valid_org_cap(text)` / `valid_client_cap(text)`, generated from the coarse
 *  vocabularies. Migration 0054's G-2 trigger uses them so a grant row can only
 *  ever hold a DECLARED capability: a typo'd grant would otherwise be stored
 *  happily, resolve to nothing, and read as "the grant did not work". It is also
 *  how platform.* is refused — those keys are OWNER_ONLY and ungrantable (G-2),
 *  and they are deliberately absent from both lists. */
export function validCapSql(): string {
  const org = ORG_CAPS_ALL.map(lit).join(', ')
  const cli = CLIENT_CAPS_ALL.map(lit).join(', ')
  return `create or replace function public.valid_org_cap(p_cap text)
returns boolean language sql immutable set search_path = public as $fn$
  -- GENERATED from lib/capabilities.ts ORG_CAPS_ALL. npm run check:caps diffs it.
  select p_cap = any (array[${org}]::text[])
$fn$;

create or replace function public.valid_client_cap(p_cap text)
returns boolean language sql immutable set search_path = public as $fn$
  -- GENERATED from lib/capabilities.ts CLIENT_CAPS_ALL.
  select p_cap = any (array[${cli}]::text[])
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
    ['project_role_baseline', PROJECT_ROLE_BASELINE],
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

  // The generated validity functions must agree with the declared vocabularies,
  // in BOTH directions: every declared cap accepted, and a plausible-looking
  // undeclared one (a platform.* key, which G-2 makes ungrantable) refused.
  for (const [fn, list, decoy] of [
    ['valid_org_cap', ORG_CAPS_ALL, 'platform.billing'],
    ['valid_client_cap', CLIENT_CAPS_ALL, 'portal.everything'],
  ] as const) {
    for (const cap of list) {
      const rows = await query(`select public.${fn}(${lit(cap)}) as ok;`)
      if (rows[0]?.ok !== true) { console.error(`✗ ${fn}(${cap}) should accept`); bad++ }
    }
    const rows = await query(`select public.${fn}(${lit(decoy)}) as ok;`)
    if (rows[0]?.ok !== false) { console.error(`✗ ${fn}(${decoy}) should REFUSE`); bad++ }
    else console.log(`  ✓ ${fn}: ${list.length} accepted, ${decoy} refused`)
  }

  // Every cap a baseline names must be a declared coarse cap. A typo in a
  // baseline is otherwise a capability nothing can ever grant.
  const declared = new Set<string>([...ORG_CAPS_ALL, ...CLIENT_CAPS_ALL])
  for (const [label, table] of [
    ['org', ORG_ROLE_BASELINE], ['client', CLIENT_ROLE_BASELINE],
    ['project', PROJECT_ROLE_BASELINE],
  ] as const) {
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

/**
 * PHASE 3 — THE LEGACY ALIAS PATH, which phase 2 cannot reach.
 *
 * Every harness persona has extra_caps = '{}', so phase 2 never executes the
 * aliasing branch on either side. It passed green while TS normalized a legacy
 * value and has_cap() did not — the route would have said yes and the policy no,
 * a silent empty result (found by probe, fixed in 0052). A guard proves what it
 * looks at and nothing else (HANDOFF §12 lesson 2).
 *
 * So this WRITES a pre-rename snake_case value onto the harness crew row,
 * asserts both resolvers agree, and reverts in a finally block. It touches the
 * harness org only, and never tenant zero.
 */
async function legacyAliasParity(env: Record<string, string>): Promise<number> {
  const CREW_MEMBER_ID = '0f0f0f0f-0004-4000-8000-000000000002'
  const CREW_EMAIL = 'harness-crew@rls-harness.example.com'
  if (!env.HARNESS_CREW_PASSWORD) {
    console.log('  ! SKIPPED — no harness password. This is a SKIP, not a pass.')
    return 0
  }
  const { createClient } = await import('@supabase/supabase-js')
  const { resolveCaps } = await import('../lib/capabilities.server')

  // [stored legacy value, the NEW key it must resolve to]
  const cases: [string, string][] = [
    ['client_money', 'money.invoices'],
    ['workspace', 'work.suite'],
    ['manage_team', 'people.manage'],
  ]
  let bad = 0
  try {
    for (const [legacy, expected] of cases) {
      await query(
        `update public.organization_members set extra_caps = array['${legacy}']::text[]
          where id = '${CREW_MEMBER_ID}';`,
      )
      const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
      const { data: signed, error } = await c.auth.signInWithPassword({
        email: CREW_EMAIL, password: env.HARNESS_CREW_PASSWORD,
      })
      if (error || !signed.user) { console.error(`✗ alias: sign-in failed`); bad++; continue }
      const { data: sql } = await c.rpc('has_cap', { p_cap: expected })
      const ts = await resolveCaps(signed.user as never, c as never)
      await c.auth.signOut()
      const tsHas = ts.caps.has(expected)
      if (Boolean(sql) !== tsHas || !tsHas) {
        console.error(`✗ alias {${legacy}} → ${expected}: sql=${Boolean(sql)} ts=${tsHas} (both must be true)`)
        bad++
      } else {
        console.log(`  ✓ alias {${legacy}}`.padEnd(28) + `→ ${expected} resolves in BOTH`)
      }
    }
  } finally {
    await query(
      `update public.organization_members set extra_caps = array[]::text[]
        where id = '${CREW_MEMBER_ID}';`,
    )
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
    console.log()
    console.log(projectRoleBaselineSql())
    console.log()
    console.log(validCapSql())
    return
  }
  console.log('1/3 · live role_baseline()/client_role_baseline()/project_role_baseline() vs lib/capabilities.ts …')
  let bad = await check()
  const env = loadEnv()
  console.log('\n2/3 · TS resolveCaps() vs SQL has_cap(), as each persona …')
  bad += await parity(env)
  console.log('\n3/3 · the legacy snake_case alias path, on a real row …')
  bad += await legacyAliasParity(env)
  if (bad > 0) {
    console.error(`\n✗ ${bad} mismatch(es). Regenerate with --print and apply, or fix the constant.`)
    process.exit(1)
  }
  console.log('\n✓ the capability table, the generated SQL and the TS resolver all agree')
}
main().catch((e) => { console.error('FAILED:', e instanceof Error ? e.message : e); process.exit(1) })
