/**
 * scripts/test-rls.ts — S2 §6, Part B. The RLS test harness.
 *
 * Twenty-nine assertions (10 from S2 §6; 11–14 from S3-core §7, Batch 13 item
 * 7; 15 — the watermark privacy assertion, Batch 14 item 6; 16–20 from S3-c
 * §7, Batch 22 item 6 — internal approvals, decision forgery, comment
 * permission, comment visibility, and the one that keeps a lapse from ever
 * reading as approval; 22–29 from S3-d §7, Batch 23 — membership as a ROW:
 * non-member isolation, the collaborator's blast radius, can_post, leaving
 * without erasure, per-seat history, DM privacy against the org owner,
 * same-company group isolation, and access parity across the 0046 flip).
 * Most are a row count that must be zero; 12 and 19 are deliberately POSITIVE
 * assertions, because both models' failure mode is hiding what they must show. Every one runs through a
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
 * Assertions 17 and 18 WRITE. 17's positive control inserts a real decision and
 * approval_decisions is append-only for everyone (0038 gives it no DELETE
 * policy), so that fixture is SINGLE-USE: re-seed between runs. A spent fixture
 * reports VACUOUS with the reason rather than FAIL, because a missing re-seed
 * is not a broken policy.
 *
 * Usage:  npm run test:rls        (seed first: npx tsx scripts/seed-harness-tenant.ts --apply)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

import {
  HARNESS_ORG_ID, COMPANY_1_ID, COMPANY_2_ID,
  PROJECT_1_ID, PROJECT_2_ID, PROJECT_3_ID,
  DECOY_ORG_ID, PERSONAS, type PersonaKey,
  APPROVAL_CLIENT_ID, APPROVAL_CLIENT_STAGE_ID, APPROVAL_INTERNAL_ID,
  APPROVAL_LAPSED_STAGE_ID, APPROVAL_DECIDED_STAGE_ID,
  ROOM_GROUP_A_ID, ROOM_GROUP_B_ID, ROOM_DM_ID,
  GA_MSG_OLD_ID, GA_MSG_NEW_ID, GA_MSG_CREW_ID,
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
  const c2own   = await signIn(url, anonKey, 'c2own', env)
  const collab  = await signIn(url, anonKey, 'collab', env)
  const anon    = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })

  // Company 1's room, read as the client rather than carried as a constant —
  // message_rooms ids are minted by the seed, and reading it here also proves
  // the client can (0027's client_read policy) before assertions 18/19 lean
  // on it.
  const roomIdC1 = ((await c1own.from('message_rooms')
    .select('id').eq('client_id', COMPANY_1_ID).is('deleted_at', null).maybeSingle()
  ).data as { id?: string } | null)?.id ?? null

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
        // No sender_role: the column drops with migration 12 (Batch 21), and
        // a probe naming it would then fail on 42703 instead of on RLS —
        // a vacuous pass wearing a real one's clothes.
        row: {
          id: '0f0f0f0f-00ff-4000-8000-000000000002', organization_id: HARNESS_ORG_ID,
          project_id: PROJECT_3_ID, sender_name: 'Harness C1 Owner',
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

  // ── 15 · the watermark is private (S3-core §7 assertion 8) ────────────────
  // A read watermark records when a person opened a message. A colleague who
  // can read it has a surveillance surface nobody asked for — Class C means
  // user_id = auth.uid() for EVERYONE, org owners included.
  {
    const leaks: string[] = []
    const colleague = await countRows(c1mate, 'message_read_state',
      [{ op: 'eq', col: 'user_id', val: manifest.userIds.c1own }])
    if (colleague > 0) leaks.push(`message_read_state(c1mate→c1own)=${colleague}`)
    const ownerPeek = await countRows(owner, 'message_read_state',
      [{ op: 'eq', col: 'user_id', val: manifest.userIds.c1mate }])
    if (ownerPeek > 0) leaks.push(`message_read_state(org-owner→c1mate)=${ownerPeek}`)
    const control = await countRows(c1mate, 'message_read_state',
      [{ op: 'eq', col: 'user_id', val: manifest.userIds.c1mate }])
    judge(15, 'a member cannot read another member\'s message_read_state', leaks, control)
  }

  // ══ Batch 22 · the approvals engine (S3-c, migrations 0038–0040) ══════════

  // ── 16 · an INTERNAL approval is invisible to every client member ─────────
  // The decoupling S3-c §2 puts in ONE column: client_id null means the studio
  // is reviewing its own work. 0038's client policy opens with
  // `client_id is not null`, so this is structural, not a filter a route
  // remembers to write.
  {
    const leaks: string[] = []
    const internal = await countRows(c1own, 'approvals', [{ op: 'eq', col: 'id', val: APPROVAL_INTERNAL_ID }])
    if (internal > 0) leaks.push(`approvals(c1own→internal)=${internal}`)
    const mateInternal = await countRows(c1mate, 'approvals', [{ op: 'eq', col: 'id', val: APPROVAL_INTERNAL_ID }])
    if (mateInternal > 0) leaks.push(`approvals(c1mate→internal)=${mateInternal}`)
    // The control is the point: this persona DOES read approvals, so the zero
    // above is about the internal one and not about reading nothing at all.
    const control = await countRows(c1own, 'approvals', [{ op: 'eq', col: 'id', val: APPROVAL_CLIENT_ID }])
    judge(16, 'a client member cannot read an INTERNAL approval', leaks, control)
  }

  // ── 17 · only an assignee of an ACTIVE stage may record a decision ────────
  // Enforced in the POLICY (0038), not only in the engine, so a direct
  // PostgREST write cannot forge a decision (S3-core §2.6).
  {
    const stageRows = await c1own.from('approval_stages')
      .select('status').eq('id', APPROVAL_CLIENT_STAGE_ID).maybeSingle()
    const stageStatus = (stageRows.data as { status?: string } | null)?.status
    if (stageStatus !== 'active') {
      // This assertion's positive control WRITES, and approval_decisions is
      // append-only for everyone (0038 gives it no DELETE policy), so the
      // fixture is single-use. Say so instead of failing: a spent fixture is a
      // missing re-seed, not a broken policy.
      record(17, 'a non-assignee cannot insert an approval_decisions row', 'VACUOUS',
        `fixture stage is '${stageStatus ?? 'unreadable'}', not 'active' — re-run npm run seed:harness -- --apply`)
    } else {
      const leaks: string[] = []
      // c1mate is a member of the same company but is NOT an assignee.
      const { data: forged } = await c1mate.from('approval_decisions')
        .insert({ stage_id: APPROVAL_CLIENT_STAGE_ID, actor_name: 'Harness C1 Mate', decision: 'approved' })
        .select('id')
      if (forged && forged.length > 0) leaks.push(`approval_decisions(non-assignee c1mate)=${forged.length}`)

      // Positive control: the assignee CAN. Without it a zero above would
      // pass just as well against a table nobody can write at all.
      const { data: allowed } = await c1own.from('approval_decisions')
        .insert({ stage_id: APPROVAL_CLIENT_STAGE_ID, actor_name: 'Harness C1 Owner', decision: 'approved' })
        .select('id')
      judge(17, 'a non-assignee cannot insert an approval_decisions row', leaks, allowed?.length ?? 0)
    }
  }

  // ── 18 · comment permission gates the WRITE (AP-4) ────────────────────────
  // c1mate carries an explicit can_comment = false row; c1own carries none and
  // falls to the participant default. Enforced by a RESTRICTIVE policy on
  // messages, so it narrows the existing insert policies without replacing
  // them — an ordinary message (no approval_id) is untouched.
  {
    const leaks: string[] = []
    // Fresh ids per run: a fixed id collides on the PRIMARY KEY the second
    // time, which reads as "the policy blocked it" and would have made this
    // assertion quietly vacuous instead of failing loudly. The seed prunes
    // approval-carrying messages, so these do not accumulate across seeds.
    const deniedId = randomUUID()
    const permittedId = randomUUID()
    // sender_id rides both probes since 0046: the membership INSERT policy
    // pins sender_id = auth.uid() (I-6), so a probe without it would fail on
    // the pin rather than on the gate under test — a vacuous pass in FAIL's
    // clothing for the denied half, and a broken control for the permitted.
    const { data: denied } = await c1mate.from('messages').insert({
      id: deniedId, room_id: roomIdC1,
      organization_id: HARNESS_ORG_ID, project_id: null,
      sender_id: manifest.userIds.c1mate,
      sender_name: 'Harness C1 Mate', body: 'ZZ-HARNESS denied review comment',
      approval_id: APPROVAL_CLIENT_ID,
    }).select('id')
    if (denied && denied.length > 0) {
      leaks.push(`messages(can_comment=false)=${denied.length}`)
      await c1mate.from('messages').delete().eq('id', deniedId)
    }
    const { data: permitted } = await c1own.from('messages').insert({
      id: permittedId, room_id: roomIdC1,
      organization_id: HARNESS_ORG_ID, project_id: null,
      sender_id: manifest.userIds.c1own,
      sender_name: 'Harness C1 Owner', body: 'ZZ-HARNESS permitted review comment',
      approval_id: APPROVAL_CLIENT_ID,
    }).select('id')
    judge(18, 'can_comment = false blocks a message carrying that approval_id', leaks, permitted?.length ?? 0)
  }

  // ── 19 · every participant reads every comment (AP-4) ─────────────────────
  // Visibility is a READ of the whole record, never a per-comment filter. Who
  // may comment is controlled (assertion 18); what is recorded is not.
  {
    const leaks: string[] = []
    const outsider = await countRows(c2own, 'messages', [{ op: 'eq', col: 'approval_id', val: APPROVAL_CLIENT_ID }])
    if (outsider > 0) leaks.push(`messages(c2own→approval comments)=${outsider}`)
    // c1mate may NOT comment, and still reads every comment — that is the
    // asymmetry AP-4 asserts, and the sharpest version of this control.
    const mateReads = await countRows(c1mate, 'messages', [{ op: 'eq', col: 'approval_id', val: APPROVAL_CLIENT_ID }])
    const ownReads = await countRows(c1own, 'messages', [{ op: 'eq', col: 'approval_id', val: APPROVAL_CLIENT_ID }])
    if (mateReads !== ownReads) {
      leaks.push(`participants disagree on comment count (c1own=${ownReads}, c1mate=${mateReads})`)
    }
    judge(19, 'every participant reads every comment on an approval', leaks, ownReads)
  }

  // ── 20 · a lapse is not a decision (AP-2) ─────────────────────────────────
  // The assertion that keeps "auto_advanced" from ever becoming "approved" in
  // a query, a certificate or a dispute.
  {
    const leaks: string[] = []
    const lapsedDecisions = await countRows(c1own, 'approval_decisions',
      [{ op: 'eq', col: 'stage_id', val: APPROVAL_LAPSED_STAGE_ID }])
    if (lapsedDecisions > 0) leaks.push(`approval_decisions(auto_advanced stage)=${lapsedDecisions}`)
    const decided = await countRows(c1own, 'approval_decisions',
      [{ op: 'eq', col: 'stage_id', val: APPROVAL_DECIDED_STAGE_ID }])
    if (decided !== 1) leaks.push(`decided stage carries ${decided} decision rows, expected exactly 1`)
    judge(20, 'an auto_advanced stage has zero approval_decisions rows', leaks, decided)
  }

  // ══ Batch 23 · membership becomes a row (S3-d, migrations 0043–0046) ══════
  // Written BEFORE the 0046 flip and run against the pre-flip database (where
  // several are VACUOUS or FAIL by design — a group is unreadable to its own
  // members until the flip); all green only after 0046. S3-d §7.

  // ── 22 · a non-member reads zero messages of a room ───────────────────────
  {
    const leaks = await leaksAcross(c1mate, [
      { table: 'messages', filters: [{ op: 'eq', col: 'room_id', val: ROOM_GROUP_A_ID }] },
    ])
    const control = await countRows(c1own, 'messages',
      [{ op: 'eq', col: 'room_id', val: ROOM_GROUP_A_ID }])
    judge(22, 'a non-member (c1mate) reads zero messages of group A', leaks, control)
  }

  // ── 23 · the collaborator's blast radius is their room and NOTHING else ───
  // MD-4's assertion — the one that makes "external" mean something. Their
  // room's rows are the control; every other table in the tenant is a leak.
  {
    const leaks = await leaksAcross(collab, ALL_TABLES.map((table) => ({
      table,
      filters:
        table === 'messages' ? [{ op: 'neq', col: 'room_id', val: ROOM_GROUP_A_ID } as Filter]
        : table === 'message_rooms' ? [{ op: 'neq', col: 'id', val: ROOM_GROUP_A_ID } as Filter]
        : table === 'room_members' ? [{ op: 'neq', col: 'room_id', val: ROOM_GROUP_A_ID } as Filter]
        : [],
    })))
    const control = await countRows(collab, 'messages',
      [{ op: 'eq', col: 'room_id', val: ROOM_GROUP_A_ID }])
    judge(23, 'the collaborator reads their room and zero rows of every other table', leaks, control)
  }

  // ── 24 · can_post = false cannot insert (MD-5) ────────────────────────────
  // Broadcast as a MEMBERSHIP property: the read stays open, the write is a
  // per-member column, and the policy — not the route — enforces it.
  {
    const leaks: string[] = []
    const { data: muted } = await c1mate.from('messages').insert({
      id: randomUUID(), room_id: ROOM_GROUP_B_ID,
      organization_id: HARNESS_ORG_ID, project_id: null,
      sender_id: manifest.userIds.c1mate, sender_name: 'Harness C1 Mate',
      body: 'ZZ-HARNESS-24 muted member probe',
    }).select('id')
    if (muted && muted.length > 0) leaks.push(`messages(can_post=false)=${muted.length}`)
    // Control: a permitted member CAN. Fresh id per run; the seed prunes.
    const { data: allowed } = await owner.from('messages').insert({
      id: randomUUID(), room_id: ROOM_GROUP_B_ID,
      organization_id: HARNESS_ORG_ID, project_id: null,
      sender_id: manifest.userIds.owner, sender_name: 'Harness Owner',
      body: 'ZZ-HARNESS-24 permitted control',
    }).select('id')
    judge(24, 'a member with can_post = false cannot insert into that room', leaks, allowed?.length ?? 0)
  }

  // ── 25 · leaving is not erasure (AD-003 applied to rooms) ─────────────────
  // crew LEFT group A: they read nothing new; the message they sent before
  // leaving still renders to the remaining members, name attached.
  {
    const leaks = await leaksAcross(crew, [
      { table: 'messages', filters: [{ op: 'eq', col: 'room_id', val: ROOM_GROUP_A_ID }] },
    ])
    const { data: history } = await c1own.from('messages')
      .select('id, sender_name').eq('id', GA_MSG_CREW_ID).maybeSingle()
    const survives = history && (history as { sender_name?: string }).sender_name === 'Harness Crew' ? 1 : 0
    judge(25, 'a LEFT member reads nothing new; their history survives with their name', leaks, survives)
  }

  // ── 26 · history_from on the MEMBERSHIP row hides the backlog ─────────────
  // Per-person-per-room (S3-d §4.1) — the cutoff moved off the tenant roster
  // onto the seat. The collaborator joined mid-stream and reads forward only.
  {
    const leaks = await leaksAcross(collab, [
      { table: 'messages', filters: [{ op: 'eq', col: 'id', val: GA_MSG_OLD_ID }] },
    ])
    const control = await countRows(collab, 'messages', [{ op: 'eq', col: 'id', val: GA_MSG_NEW_ID }])
    judge(26, 'room_members.history_from hides everything before it (control: after)', leaks, control)
  }

  // ── 27 · a DM is its two members — SPECIFICALLY not the org owner ─────────
  // The sharpest edge of MD-1: before the flip the org owner read every org
  // message by construction. If this passes, membership replaced tenancy.
  {
    const leaks: string[] = []
    const bossPeek = await countRows(owner, 'messages', [{ op: 'eq', col: 'room_id', val: ROOM_DM_ID }])
    if (bossPeek > 0) leaks.push(`messages(org-owner→dm)=${bossPeek}`)
    const outsider = await countRows(c2own, 'messages', [{ op: 'eq', col: 'room_id', val: ROOM_DM_ID }])
    if (outsider > 0) leaks.push(`messages(c2own→dm)=${outsider}`)
    const a = await countRows(crew, 'messages', [{ op: 'eq', col: 'room_id', val: ROOM_DM_ID }])
    const b = await countRows(c1own, 'messages', [{ op: 'eq', col: 'room_id', val: ROOM_DM_ID }])
    judge(27, 'a DM is readable by exactly its two members — not by the org owner', leaks, Math.min(a, b))
  }

  // ── 28 · same company, different groups, zero cross-read ──────────────────
  // The assertion that proves membership replaced company identity (S3-d §7):
  // without it the whole batch could pass while access was still tenant-derived.
  {
    const leaks: string[] = []
    const ownIntoB = await countRows(c1own, 'messages', [{ op: 'eq', col: 'room_id', val: ROOM_GROUP_B_ID }])
    if (ownIntoB > 0) leaks.push(`messages(c1own→groupB)=${ownIntoB}`)
    const mateIntoA = await countRows(c1mate, 'messages', [{ op: 'eq', col: 'room_id', val: ROOM_GROUP_A_ID }])
    if (mateIntoA > 0) leaks.push(`messages(c1mate→groupA)=${mateIntoA}`)
    const ownA = await countRows(c1own, 'messages', [{ op: 'eq', col: 'room_id', val: ROOM_GROUP_A_ID }])
    const mateB = await countRows(c1mate, 'messages', [{ op: 'eq', col: 'room_id', val: ROOM_GROUP_B_ID }])
    judge(28, 'two members of one COMPANY in different groups read zero of each other\'s', leaks, Math.min(ownA, mateB))
  }

  // ── 29 · the flip changed the AUTHORITY, not anyone's access ──────────────
  // The migration's real gate (S3-d §7). Its full form is the entire suite:
  // 1–21 encode pre-flip access and must stay green through 0046 — that IS
  // the "before" half of the diff. What is asserted here is the equality the
  // suite cannot see: the crew door and the client door agree exactly on a
  // room both fully-sighted personas occupy, in both directions.
  {
    const leaks: string[] = []
    if (roomIdC1) {
      const viaCrewDoor = await countRows(owner, 'messages', [{ op: 'eq', col: 'room_id', val: roomIdC1 }])
      const viaClientDoor = await countRows(c1own, 'messages', [{ op: 'eq', col: 'room_id', val: roomIdC1 }])
      if (viaCrewDoor !== viaClientDoor) {
        leaks.push(`room C1 disagrees across the doors (owner=${viaCrewDoor}, c1own=${viaClientDoor})`)
      }
      // Scoped crew and scoped client agree on the P1 thread they both keep.
      const crewP1 = await countRows(crew, 'messages',
        [{ op: 'eq', col: 'room_id', val: roomIdC1 }, { op: 'eq', col: 'project_id', val: PROJECT_1_ID }])
      const ownP1 = await countRows(c1own, 'messages',
        [{ op: 'eq', col: 'room_id', val: roomIdC1 }, { op: 'eq', col: 'project_id', val: PROJECT_1_ID }])
      if (crewP1 !== ownP1) {
        leaks.push(`P1 thread disagrees (scoped crew=${crewP1}, c1own=${ownP1})`)
      }
      judge(29, 'access parity across the flip: both doors agree, both directions', leaks, viaClientDoor)
    } else {
      record(29, 'access parity across the flip: both doors agree, both directions', 'ERROR',
        'company-1 room unresolvable — cannot run the parity probes')
    }
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
