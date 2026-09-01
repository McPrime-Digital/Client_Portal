/**
 * scripts/test-rls.ts — S2 §6, Part B. The RLS test harness.
 *
 * Fourteen assertions (10 from S2 §6; 11–14 from S3-core §7, Batch 13 item 7 —
 * rooms tenant-scoped, untagged visibility, sibling-tag isolation, history in
 * the room). Most are a row count that must be zero; 12 is deliberately a
 * POSITIVE assertion, because the room model's failure mode is hiding messages
 * it must show. Every one runs through a
 * REAL user session obtained with signInWithPassword against the anon key.
 * This script never constructs a service-role client and never reads
 * SUPABASE_SERVICE_ROLE_KEY — a service-role read bypasses RLS entirely and
 * would pass all ten while proving nothing. assertAnonKey() below enforces
 * that at runtime rather than by convention.
 *
 * VACUITY IS TRACKED SEPARATELY, and this is the part that matters.
 * "Reads zero of the other tenant's rows" is also satisfied by a persona who
 * can read nothing at all — which is the live state for an invited client
 * teammate, who satisfies no client-side policy on any work table (S0-A
 * AD-001-C). Reporting that as PASS would manufacture a green result out of a
 * known defect. So each isolation assertion carries a positive control: the
 * rows that persona SHOULD see. Control zero → the assertion is reported
 * VACUOUS, not PASS, and the run does not exit clean.
 *
 * Expect most of this to be RED today. That failing output is the baseline
 * S2 §6 calls for; later batches turn groups green one policy class at a time.
 *
 * Usage:  npm run test:rls        (seed first: npx tsx scripts/seed-harness-tenant.ts --apply)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import {
  HARNESS_ORG_ID, COMPANY_1_ID, COMPANY_2_ID,
  PROJECT_1_ID, PROJECT_2_ID, PROJECT_3_ID,
  DECOY_ORG_ID, PERSONAS, type PersonaKey,
  ALL_TABLES, readManifest, loadEnv, requireEnv,
} from './harness-constants'

// ── result model ────────────────────────────────────────────────────────────

type Status = 'PASS' | 'FAIL' | 'VACUOUS' | 'ERROR'

interface Result {
  n: number
  title: string
  status: Status
  detail: string
}

const results: Result[] = []

function record(n: number, title: string, status: Status, detail = '') {
  results.push({ n, title, status, detail })
}

/**
 * The shared shape of assertions 1–6 and 10: a leak count that must be zero,
 * plus a control count that must be non-zero for the zero to mean anything.
 */
function judge(n: number, title: string, leaks: string[], control: number | null) {
  if (leaks.length > 0) {
    record(n, title, 'FAIL', leaks.join(', '))
  } else if (control !== null && control === 0) {
    record(n, title, 'VACUOUS', 'leak count 0, but the positive control is also 0 — this persona reads nothing at all, so the zero proves nothing')
  } else {
    record(n, title, 'PASS', control !== null ? `control ${control} row(s) visible` : '')
  }
}

// ── query helpers ───────────────────────────────────────────────────────────

type Scalar = string | number | boolean
type Filter =
  | { op: 'eq'; col: string; val: Scalar }
  | { op: 'neq'; col: string; val: Scalar }
  | { op: 'lt'; col: string; val: string }
  | { op: 'gte'; col: string; val: string }
  | { op: 'is_null'; col: string }

async function countRows(c: SupabaseClient, table: string, filters: Filter[] = []): Promise<number> {
  let q = c.from(table).select('*', { count: 'exact', head: true })
  for (const f of filters) {
    if (f.op === 'eq') q = q.eq(f.col, f.val)
    else if (f.op === 'neq') q = q.neq(f.col, f.val)
    else if (f.op === 'lt') q = q.lt(f.col, f.val)
    else if (f.op === 'is_null') q = q.is(f.col, null)
    else q = q.gte(f.col, f.val)
  }
  const { count, error } = await q
  // A policy denial in Postgres is an empty result, not an error. An error here
  // means something structural (missing grant, bad column) and must not be
  // silently folded into "0 rows visible".
  if (error) throw new Error(`${table}: ${error.message}`)
  return count ?? 0
}

/** Counts foreign rows across several tables, returning "table=n" for each leak. */
async function leaksAcross(
  c: SupabaseClient,
  spec: Array<{ table: string; filters: Filter[] }>,
): Promise<string[]> {
  const out: string[] = []
  for (const { table, filters } of spec) {
    try {
      const n = await countRows(c, table, filters)
      if (n > 0) out.push(`${table}=${n}`)
    } catch (e) {
      out.push(`${table}=ERR(${e instanceof Error ? e.message : String(e)})`)
    }
  }
  return out
}

const notHarness: Filter[] = [{ op: 'neq', col: 'organization_id', val: HARNESS_ORG_ID }]

// ── session setup ───────────────────────────────────────────────────────────

/**
 * Decodes the JWT's `role` claim and refuses anything but `anon`. This is the
 * guard on the harness's central rule: assertions must run as a real user
 * under RLS, never as service_role.
 */
function assertAnonKey(key: string) {
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64').toString('utf8'))
    if (payload.role !== 'anon') {
      throw new Error(`key carries role="${payload.role}" — the harness must use the anon key only`)
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('anon key only')) throw e
    throw new Error('could not decode NEXT_PUBLIC_SUPABASE_ANON_KEY as a JWT')
  }
}

async function signIn(
  url: string, anonKey: string, key: PersonaKey, env: Record<string, string>,
): Promise<SupabaseClient> {
  const p = PERSONAS[key]
  const password = requireEnv(env, p.envKey)
  const c = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await c.auth.signInWithPassword({ email: p.email, password })
  if (error) throw new Error(`sign-in failed for ${p.email}: ${error.message}`)
  return c
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  const env = loadEnv()
  const url = requireEnv(env, 'NEXT_PUBLIC_SUPABASE_URL')
  const anonKey = requireEnv(env, 'NEXT_PUBLIC_SUPABASE_ANON_KEY')
  assertAnonKey(anonKey)

  const manifest = readManifest()
  const cutoff = manifest.historyCutoff

  console.log('\n  RLS HARNESS — S2 §6')
  console.log(`  seeded ${manifest.seededAt} · history cutoff ${cutoff}\n`)

  const owner   = await signIn(url, anonKey, 'owner', env)
  const crew    = await signIn(url, anonKey, 'crew', env)
  const revoked = await signIn(url, anonKey, 'revoked', env)
  const c1own   = await signIn(url, anonKey, 'c1own', env)
  const c1mate  = await signIn(url, anonKey, 'c1mate', env)
  const anon    = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })

  // ── 1 · studio B reads none of studio A's work ────────────────────────────
  {
    const leaks = await leaksAcross(owner, [
      'projects', 'files', 'messages', 'tasks', 'invoices', 'activity_log', 'clients',
    ].map((table) => ({ table, filters: notHarness })))
    const control = await countRows(owner, 'projects', [{ op: 'eq', col: 'organization_id', val: HARNESS_ORG_ID }])
    judge(1, 'harness-owner reads zero of McPrime\'s work rows', leaks, control)
  }

  // ── 2 · studio B reads none of studio A's rosters ─────────────────────────
  {
    const leaks = await leaksAcross(owner, [
      { table: 'organization_members', filters: notHarness },
      { table: 'client_members', filters: notHarness },
    ])
    const control = await countRows(owner, 'organization_members',
      [{ op: 'eq', col: 'organization_id', val: HARNESS_ORG_ID }])
    judge(2, 'harness-owner reads zero of McPrime\'s rosters', leaks, control)
  }

  // ── 3 · company 1 reads none of company 2 ─────────────────────────────────
  {
    const byClient: Filter[] = [{ op: 'eq', col: 'client_id', val: COMPANY_2_ID }]
    const leaks = await leaksAcross(c1own, [
      { table: 'clients', filters: [{ op: 'eq', col: 'id', val: COMPANY_2_ID }] },
      { table: 'projects', filters: byClient },
      { table: 'invoices', filters: byClient },
      { table: 'files', filters: byClient },
      { table: 'notifications', filters: byClient },
      { table: 'activity_log', filters: byClient },
      { table: 'messages', filters: [{ op: 'eq', col: 'project_id', val: PROJECT_3_ID }] },
      { table: 'tasks', filters: [{ op: 'eq', col: 'project_id', val: PROJECT_3_ID }] },
    ])
    const control = await countRows(c1own, 'projects', [{ op: 'eq', col: 'client_id', val: COMPANY_1_ID }])
    judge(3, 'harness-c1-own reads zero rows of company 2', leaks, control)
  }

  // ── 4 · project-scoped teammate reads none of project 2 ───────────────────
  {
    const p2: Filter[] = [{ op: 'eq', col: 'project_id', val: PROJECT_2_ID }]
    const leaks = await leaksAcross(c1mate, [
      { table: 'tasks', filters: p2 },
      { table: 'activity_log', filters: p2 },
    ])
    const control = await countRows(c1mate, 'tasks', [{ op: 'eq', col: 'project_id', val: PROJECT_1_ID }])
    judge(4, 'harness-c1-mate reads zero tasks/activity of project 2', leaks, control)
  }

  // ── 5 · history_from cutoff ───────────────────────────────────────────────
  {
    const leaks = await leaksAcross(c1mate, [{
      table: 'messages',
      filters: [{ op: 'eq', col: 'project_id', val: PROJECT_1_ID }, { op: 'lt', col: 'created_at', val: cutoff }],
    }])
    const control = await countRows(c1mate, 'messages',
      [{ op: 'eq', col: 'project_id', val: PROJECT_1_ID }, { op: 'gte', col: 'created_at', val: cutoff }])
    judge(5, 'harness-c1-mate reads zero messages older than history_from', leaks, control)
  }

  // ── 6 · revoked member reads nothing, anywhere ────────────────────────────
  {
    // ONE ROW IS EXCLUDED, and the exclusion is a statement about the model,
    // not a concession to a failing test. organization_members_self_read
    // (0012:72-74) is `user_id = auth.uid()` with no status predicate, so a
    // revoked member still reads their own roster row — deliberately. Status
    // lives on that row; without it the app cannot tell "your access was
    // revoked" from "you were never here", and revocation would surface as an
    // empty Workspace, the silent-empty failure S0 AD-001 exists to prevent.
    // Reading the record of your own revocation is not a leak. Every OTHER
    // row on that table, and every row on the other ten, still must be zero —
    // the neq below narrows one table, it does not exempt it.
    const { data: me, error: meErr } = await revoked.auth.getUser()
    if (meErr || !me.user) {
      record(6, 'harness-revoked reads zero rows from every table', 'ERROR',
        meErr ? meErr.message : 'signed in but no user on the session')
    } else {
      const notSelf: Filter[] = [{ op: 'neq', col: 'user_id', val: me.user.id }]
      const leaks = await leaksAcross(revoked, ALL_TABLES.map((table) => ({
        table,
        filters: table === 'organization_members' ? notSelf : [],
      })))
      // No positive control: apart from that one row, a revoked member must
      // see nothing, so there is no row whose absence would make this vacuous.
      judge(6, 'harness-revoked reads zero rows from every table (bar their own roster row)', leaks, null)
    }
  }

  // ── 7 · column-level write protection on clients ──────────────────────────
  {
    const { data: before, error } = await c1own.from('clients')
      .select('is_active, invite_policy, organization_id').eq('id', COMPANY_1_ID).maybeSingle()

    if (error || !before) {
      record(7, 'harness-c1-own cannot write is_active / invite_policy / organization_id', 'ERROR',
        error ? error.message : 'own clients row not readable — cannot run the probe')
    } else {
      const probes: Array<{ col: string; to: Scalar }> = [
        { col: 'is_active', to: !before.is_active },
        { col: 'invite_policy', to: before.invite_policy === 'locked' ? 'open' : 'locked' },
        // Targets the decoy org, never McPrime: a successful attack must not
        // move a harness company into tenant zero.
        { col: 'organization_id', to: DECOY_ORG_ID },
      ]
      const wrote: string[] = []
      for (const probe of probes) {
        await c1own.from('clients').update({ [probe.col]: probe.to }).eq('id', COMPANY_1_ID)
        const { data: after } = await c1own.from('clients')
          .select(probe.col).eq('id', COMPANY_1_ID).maybeSingle()
        const val = (after as Record<string, unknown> | null)?.[probe.col]
        if (after && val === probe.to) {
          wrote.push(probe.col)
          // Put it back immediately — the same session that changed it can
          // change it back, and leaving the harness org mangled would poison
          // every later run.
          const original = (before as Record<string, Scalar>)[probe.col]
          await c1own.from('clients').update({ [probe.col]: original }).eq('id', COMPANY_1_ID)
        }
      }
      if (wrote.length) {
        record(7, 'harness-c1-own cannot write is_active / invite_policy / organization_id',
          'FAIL', `writable: ${wrote.join(', ')} (reverted)`)
      } else {
        record(7, 'harness-c1-own cannot write is_active / invite_policy / organization_id', 'PASS')
      }
    }
  }

  // ── 8 · cross-company insert ──────────────────────────────────────────────
  {
    // organization_id is stamped explicitly on both probes. Without it the
    // column DEFAULT would put a successful attack inside McPrime's tenant —
    // the harness must never write there, even when demonstrating a hole.
    const probes = [
      {
        table: 'notifications',
        row: {
          id: '0f0f0f0f-00ff-4000-8000-000000000001', organization_id: HARNESS_ORG_ID,
          client_id: COMPANY_2_ID, type: 'harness.probe', title: 'ZZ-HARNESS cross-company probe',
        },
      },
      {
        table: 'messages',
        row: {
          id: '0f0f0f0f-00ff-4000-8000-000000000002', organization_id: HARNESS_ORG_ID,
          project_id: PROJECT_3_ID, sender_role: 'client', sender_name: 'Harness C1 Owner',
          body: 'ZZ-HARNESS cross-company probe',
        },
      },
    ]
    const landed: string[] = []
    for (const p of probes) {
      const { data } = await c1own.from(p.table).insert(p.row).select('id')
      if (data && data.length > 0) {
        landed.push(p.table)
        await c1own.from(p.table).delete().eq('id', p.row.id)
      }
    }
    if (landed.length) {
      record(8, 'harness-c1-own cannot insert rows for company 2', 'FAIL',
        `inserted into: ${landed.join(', ')} (deleted)`)
    } else {
      record(8, 'harness-c1-own cannot insert rows for company 2', 'PASS')
    }
  }

  // ── 9 · unauthenticated ───────────────────────────────────────────────────
  {
    const leaks = await leaksAcross(anon, ALL_TABLES.map((table) => ({ table, filters: [] })))
    judge(9, 'unauthenticated session reads zero rows from every table', leaks, null)
  }

  // ── 10 · crew project scoping ─────────────────────────────────────────────
  {
    const p2: Filter[] = [{ op: 'eq', col: 'project_id', val: PROJECT_2_ID }]
    const leaks = await leaksAcross(crew, [
      { table: 'projects', filters: [{ op: 'eq', col: 'id', val: PROJECT_2_ID }] },
      { table: 'messages', filters: p2 },
      { table: 'tasks', filters: p2 },
      { table: 'files', filters: p2 },
      { table: 'activity_log', filters: p2 },
    ])
    const control = await countRows(crew, 'tasks', [{ op: 'eq', col: 'project_id', val: PROJECT_1_ID }])
    judge(10, 'harness-crew (scoped to project 1) reads zero rows of project 2', leaks, control)
  }

  // ── 11 · rooms are tenant-scoped (S3-core §7.1) ───────────────────────────
  // Both doors: the crew policy (owner must not see another org's rooms) and
  // the client policy (a company-1 member must not see company 2's room).
  {
    const leaks = await leaksAcross(owner, [
      { table: 'message_rooms', filters: notHarness },
    ])
    const c1ownForeignRoom = await countRows(c1own, 'message_rooms',
      [{ op: 'eq', col: 'client_id', val: COMPANY_2_ID }])
    if (c1ownForeignRoom > 0) leaks.push(`message_rooms(c1own→company2)=${c1ownForeignRoom}`)
    const ownerOwn = await countRows(owner, 'message_rooms',
      [{ op: 'eq', col: 'organization_id', val: HARNESS_ORG_ID }])
    const c1ownOwn = await countRows(c1own, 'message_rooms',
      [{ op: 'eq', col: 'client_id', val: COMPANY_1_ID }])
    judge(11, 'tenant two reads zero of tenant one\'s rooms (crew + client doors)',
      leaks, Math.min(ownerOwn, c1ownOwn))
  }

  // ── 12 · scoped teammate reads untagged + own-project tagged (§7.2) ───────
  // A POSITIVE assertion: the room model must not hide the room from a scoped
  // member. Reading zero here is a failure of the model, not a leak.
  {
    const untagged = await countRows(c1mate, 'messages',
      [{ op: 'is_null', col: 'project_id' }, { op: 'gte', col: 'created_at', val: cutoff }])
    const taggedOwn = await countRows(c1mate, 'messages',
      [{ op: 'eq', col: 'project_id', val: PROJECT_1_ID }, { op: 'gte', col: 'created_at', val: cutoff }])
    if (untagged > 0 && taggedOwn > 0) {
      record(12, 'harness-c1-mate reads untagged room messages + own project\'s tagged', 'PASS',
        `untagged ${untagged} + tagged ${taggedOwn} visible`)
    } else {
      record(12, 'harness-c1-mate reads untagged room messages + own project\'s tagged', 'FAIL',
        `untagged=${untagged} tagged=${taggedOwn} — the room model is hiding messages it must show`)
    }
  }

  // ── 13 · scoped teammate reads zero sibling-tagged messages (§7.3) ────────
  // The exact leak this batch exists to prevent: one room now carries both
  // projects' traffic, and only RLS separates them for a scoped member.
  {
    const leaks = await leaksAcross(c1mate, [
      { table: 'messages', filters: [{ op: 'eq', col: 'project_id', val: PROJECT_2_ID }] },
    ])
    const control = await countRows(c1mate, 'messages',
      [{ op: 'eq', col: 'project_id', val: PROJECT_1_ID }, { op: 'gte', col: 'created_at', val: cutoff }])
    judge(13, 'harness-c1-mate reads zero messages tagged to sibling project 2', leaks, control)
  }

  // ── 14 · history_from holds on UNTAGGED messages too (§7.4) ───────────────
  // Assertion 5 already proves the cutoff on tagged messages; untagged rows
  // are new with the room model and must obey the same line.
  {
    const leaks = await leaksAcross(c1mate, [{
      table: 'messages',
      filters: [{ op: 'is_null', col: 'project_id' }, { op: 'lt', col: 'created_at', val: cutoff }],
    }])
    const control = await countRows(c1mate, 'messages',
      [{ op: 'is_null', col: 'project_id' }, { op: 'gte', col: 'created_at', val: cutoff }])
    judge(14, 'history_from holds inside the company room (untagged messages)', leaks, control)
  }

  // ── report ────────────────────────────────────────────────────────────────
  const mark: Record<Status, string> = { PASS: '  PASS   ', FAIL: '  FAIL   ', VACUOUS: 'VACUOUS  ', ERROR: ' ERROR   ' }
  console.log('  ─────────────────────────────────────────────────────────────────────────')
  for (const r of results.sort((a, b) => a.n - b.n)) {
    console.log(`  ${String(r.n).padStart(2)}. ${mark[r.status]} ${r.title}`)
    if (r.detail) console.log(`               ↳ ${r.detail}`)
  }
  console.log('  ─────────────────────────────────────────────────────────────────────────')

  const pass = results.filter((r) => r.status === 'PASS').length
  const fail = results.filter((r) => r.status === 'FAIL').length
  const vac  = results.filter((r) => r.status === 'VACUOUS').length
  const err  = results.filter((r) => r.status === 'ERROR').length
  console.log(`  ${pass} pass · ${fail} fail · ${vac} vacuous · ${err} error   (of ${results.length})\n`)

  // ── beyond the ten: diagnostics S2 §4 names but §6 does not assert ────────
  const bankLeak = await countRows(owner, 'business_settings', notHarness)
  console.log(`  [diagnostic] business_settings rows of other tenants visible to harness-owner: ${bankLeak}`)
  console.log('               business_settings holds bank details (S2 §4 Class D).\n')

  process.exit(fail + vac + err === 0 ? 0 : 1)
}

main().catch((e) => { console.error(`\n✖ ${e instanceof Error ? e.message : String(e)}\n`); process.exit(1) })
