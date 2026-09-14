/**
 * scripts/test-rls.ts — S2 §6, Part B. The RLS test harness.
 *
 * FIFTY-SEVEN assertions, numbered 1–57, none reserved. Slot 21 was held open for
 * the retention-purge assertion — "cannot be written against a function that
 * does not exist" — and 0071 built the function, so it is filled.
 * This count was "Twenty-nine" until Batch 26 item 1 and had been
 * stale since Batch 25 added seven; a header that miscounts the thing it heads is
 * the §12 lesson 4 shape inside the test file, so it is corrected here rather
 * than left for the recompile to contradict. Keep it correct.
 *
 *   1–10   S2 §6
 *   11–14  S3-core §7 (Batch 13 item 7)
 *   15     the watermark privacy assertion (Batch 14 item 6)
 *   16–20  S3-c §7 (Batch 22 item 6) — internal approvals, decision forgery,
 *          comment permission, comment visibility, and the one that keeps a
 *          lapse from ever reading as approval
 *   21     S3-core §4.2 — the activity ledger refuses deletion inside its
 *          7-year window (FILLED by 0071; the slot was reserved for it)
 *   22–29  S3-d §7 (Batch 23) — membership as a ROW: non-member isolation, the
 *          collaborator's blast radius, can_post, leaving without erasure,
 *          per-seat history, DM privacy against the org owner, same-company
 *          group isolation, and access parity across the 0046 flip
 *   30–36  S-R §11 (Batch 25) — the money boundary, a denial beating a role
 *          baseline, and the four delegation rules no route test can prove
 *   37     S-R-A A-3 (Batch 26 item 1) — a grant and a deny held at once, which
 *          the tables could not hold before migration 0055
 *   46–49  S3-b (0065, 0068) — the calendar scopes on BOTH axes, and the
 *          signing record refuses UPDATE and DELETE from everyone
 *   52     0074 — a projected calendar entry is owned by its source: it
 *          survives a hand edit and a hand delete
 *   53     0068 — a signature is IDENTITY: a colleague on the same company
 *          cannot mark somebody else as having signed
 *   54     0078 — a signing link is a bearer credential and no session, owner
 *          included, can read one
 *   55     0067 — client_id is the boundary between the studio's internal floor
 *          and a room a client may walk into; the media token follows the row
 *   56     0082 — MD-4's roster-less collaborator reaches a meeting through the
 *          SEAT they already hold, and reaches no other
 *   57     0083 — the job queue is READ-ONLY to every session: a tenant can see
 *          its own work and forge none into it
 *   50–51  0070/0073, 0072 — a soft-deleted row disappears for the CLIENT
 *          (crew keep it by design, so restore stays possible), and calendar
 *          credentials are invisible to everyone but the person they belong to,
 *          org owner included
 *   44–45  0064 — content provenance cannot be forged: a disclosure can only
 *          be written by somebody who can see the script it is about
 *   42–43  0063 — per-member AI spend limits: a member sees their own cap and
 *          cannot raise it
 *   38–41  S-R §2, §3.2, R-10, G-5 (Batch 26 item 9) — the SCOPED seat: a
 *          contractor with no assignments reads nothing, a scoped member cannot
 *          reach a sibling production, an expired assignment stops resolving
 *          without being deleted, and a project role grants its baseline while
 *          widening no rows
 *
 * Most are a row count that must be zero; 12 and 19 are deliberately POSITIVE
 * assertions, because both models' failure mode is hiding what they must show. Every one runs through a
 * REAL user session obtained with signInWithPassword against the anon key.
 * This script never constructs a service-role client and never reads
 * SUPABASE_SERVICE_ROLE_KEY — a service-role read bypasses RLS entirely and
 * would pass EVERY ONE of them while proving nothing. assertAnonKey() below
 * enforces that at runtime rather than by convention. (This said "all ten" —
 * true of the original ten, and left behind by four batches of growth.)
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
 * WHAT TO EXPECT NOW: all 57 green on a freshly seeded tenant. This paragraph
 * used to read "expect most of this to be RED today" — true when S2 §6 asked for
 * a failing baseline, and false since the policy classes landed. Left as written
 * it tells the next reader that red output is normal, which is the one thing a
 * test harness's header must never say. If anything here is red, something broke.
 *
 * Corrected in Batch 26 item 1 alongside the assertion count above; both had
 * gone stale the same way, and both were describing a harness that no longer
 * exists.
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

import { takeLock, releaseLock } from './harness-lock'
import {
  HARNESS_ORG_ID, COMPANY_1_ID, COMPANY_2_ID,
  PROJECT_1_ID, PROJECT_2_ID, PROJECT_3_ID,
  DECOY_ORG_ID, PERSONAS, type PersonaKey,
  APPROVAL_CLIENT_ID, APPROVAL_CLIENT_STAGE_ID, APPROVAL_INTERNAL_ID,
  APPROVAL_LAPSED_STAGE_ID, APPROVAL_DECIDED_STAGE_ID,
  ROOM_GROUP_A_ID, ROOM_GROUP_B_ID, ROOM_DM_ID,
  GA_MSG_OLD_ID, GA_MSG_NEW_ID, GA_MSG_CREW_ID,
  ALL_TABLES, readManifest, loadEnv, requireEnv,
  OM_OWNER_ID, OM_CREW_ID, OM_FINANCE_ID,
  DOC_P1_ID, DOC_P2_ID,
  CAL_C1_ID, CAL_P2_ID, CONTRACT_C1_ID, CONTRACT_EVENT_ID,
  MEETING_CLIENT_ID, MEETING_INTERNAL_ID, MEETING_ROOM_ID, JOB_ID,
  FILE_P2_ID, SHARE_LINK_P1_ID, SHARE_LINK_P2_ID, SHARE_VIEW_P1_ID,
  FILE_P1_ID, RIGHTS_P1_ID, RIGHTS_P3_ID, PROV_DOC_P1_ID,
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

/**
 * `public.has_cap(cap)` AS THE PERSONA — the policy layer's own answer, asked
 * through the persona's own session because the function reads `auth.uid()` and
 * `current_org()`. Asked as the service role it would answer about nobody.
 *
 * Returns `boolean | null`, and the null matters: an RPC ERROR is not `false`.
 * Folding the two together is the trap HANDOFF §12 lesson 6 records in its
 * second half — a probe that cannot tell "refused" from "did nothing" is
 * dangerous in reverse, and here it would let a missing grant on the function
 * masquerade as a capability correctly withheld.
 */
async function capOf(c: SupabaseClient, cap: string): Promise<boolean | null> {
  const { data, error } = await c.rpc('has_cap', { p_cap: cap })
  if (error) return null
  return data as boolean
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
  takeLock('test:rls')
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
  const finance = await signIn(url, anonKey, 'finance', env)
  const contractor = await signIn(url, anonKey, 'contractor', env)
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

  // ── 30-36 · S-R §6 and §9: the capability layer (Batch 24 item 10) ────────
  //
  // Assertions 32-35 are the ones that make S-R §6 true rather than intended,
  // and NONE of them can be proven by a route test, because the route is not the
  // control (S-R R-5): migration 0053 gives a people.manage holder UPDATE on the
  // rosters, so every rule about those rows has to live at or below the row.
  //
  // Every one runs as a real persona on the anon key. A mutation that RLS
  // refuses matches ZERO ROWS and PostgREST returns NO ERROR — so each write
  // probe below asks for rows back and treats an empty result as refused. Item
  // 7's first probe read "no error" as "accepted" and reported four working
  // triggers as broken; that trap is recorded in HANDOFF §12 and it is this one.
  {
    const rowsOf = async (
      c: SupabaseClient, table: string, payload: Record<string, unknown>,
    ): Promise<{ ok: boolean; code: string | null }> => {
      const { data, error } = await c.from(table).insert(payload).select('id')
      if (error) return { ok: false, code: error.code ?? 'ERR' }
      return { ok: (data ?? []).length > 0, code: (data ?? []).length > 0 ? null : 'RLS-ZERO-ROWS' }
    }
    const updOf = async (
      c: SupabaseClient, table: string, patch: Record<string, unknown>,
      id: string | null, filters?: Filter[],
    ): Promise<{ ok: boolean; code: string | null }> => {
      // `filters` is for composite-key tables (member_budgets is keyed on
      // organization_id + user_id and has no `id`). The returned column follows
      // the table, because .select('id') on a table without one errors and would
      // read as a refusal.
      let q = c.from(table).update(patch)
      if (id !== null) q = q.eq('id', id)
      for (const f of filters ?? []) q = q.eq(f.col, (f as { val: Scalar }).val)
      const { data, error } = await q.select(id !== null ? 'id' : 'organization_id')
      if (error) return { ok: false, code: error.code ?? 'ERR' }
      return { ok: (data ?? []).length > 0, code: (data ?? []).length > 0 ? null : 'RLS-ZERO-ROWS' }
    }
    function grant(
      member: string, cap: string, mode = 'grant', expires: string | null = null,
    ): Record<string, unknown> {
      return {
        organization_id: HARNESS_ORG_ID, member_id: member, capability: cap, mode,
        granted_by_name: 'Harness', expires_at: expires,
      }
    }

    // 30 · a crew member cannot read an invoice. Control: finance can.
    {
      const crewSees = await countRows(crew, 'invoices')
      const finSees = await countRows(finance, 'invoices')
      judge(30, 'a crew member reads zero invoices (control: finance reads them)',
        crewSees > 0 ? [`invoices=${crewSees}`] : [], finSees)
    }

    // 31 · a denial beats the ROLE BASELINE.
    //
    // NOT "a deny row beats a grant row on the same capability", which S-R R-3's
    // wording suggests and §10's own unique index makes UNREACHABLE: the partial
    // index is on (member_id, capability) where revoked_at is null, so the two
    // rows cannot coexist. The semantic that matters — and the example R-3 itself
    // gives, a Producer denied rates — is a denial beating what the ROLE grants.
    // Reported to S-R-A rather than asserted against a state the schema forbids.
    {
      const before = await countRows(finance, 'invoices')   // baseline permits
      const d = await rowsOf(owner, 'org_member_cap_grants', grant(OM_FINANCE_ID, 'money.invoices', 'deny'))
      const after = d.ok ? await countRows(finance, 'invoices') : -1
      if (!d.ok) {
        record(31, 'a denial beats the role baseline', 'ERROR', `deny row refused: ${d.code}`)
      } else {
        judge(31, 'a denial beats the role baseline (control: without it, finance reads)',
          after > 0 ? [`invoices still readable=${after}`] : [], before)
      }
      await owner.from('org_member_cap_grants').delete()
        .eq('member_id', OM_FINANCE_ID).eq('capability', 'money.invoices')
      await owner.from('organization_members').update({ extra_caps: [] }).eq('id', OM_FINANCE_ID)
    }

    // 32 · an admin cannot change their OWN role or caps. Control: another's.
    {
      const own = await updOf(owner, 'organization_members', { role: 'crew' }, OM_OWNER_ID)
      const other = await updOf(owner, 'organization_members', { title: 'Harness' }, OM_FINANCE_ID)
      const leaks: string[] = []
      if (own.ok) leaks.push('owner changed their OWN role')
      if (own.code !== 'GR003' && !own.ok) leaks.push(`refused, but not by G-3 (${own.code})`)
      judge(32, 'nobody changes their own role or capabilities (control: another member)',
        leaks, other.ok ? 1 : 0)
      await owner.from('organization_members').update({ title: null }).eq('id', OM_FINANCE_ID)
    }

    // 33 · an admin cannot modify an OWNER's row. Control: an owner can.
    {
      // finance is granted people.manage so it reaches the table at all —
      // otherwise 0053 refuses first and the trigger never runs, which is
      // exactly how item 7's first probe misread itself.
      const g = await rowsOf(owner, 'org_member_cap_grants', grant(OM_FINANCE_ID, 'people.manage'))
      const asAdmin = g.ok
        ? await updOf(finance, 'organization_members', { title: 'nope' }, OM_OWNER_ID)
        : { ok: false, code: 'SETUP' }
      const asOwner = await updOf(owner, 'organization_members', { title: 'Harness Owner' }, OM_OWNER_ID)
      const leaks: string[] = []
      if (!g.ok) leaks.push(`setup grant refused: ${g.code}`)
      if (asAdmin.ok) leaks.push('a non-owner holding people.manage edited the OWNER')
      judge(33, 'only an owner may edit an owner (control: the owner can)', leaks, asOwner.ok ? 1 : 0)
      await owner.from('organization_members').update({ title: null }).eq('id', OM_OWNER_ID)
    }

    // 34 · nobody grants a capability they do not hold. Control: one they hold.
    {
      // finance still holds people.manage from 33, and holds no work.suite.
      const over = await rowsOf(finance, 'org_member_cap_grants', grant(OM_CREW_ID, 'work.suite'))
      const within = await rowsOf(finance, 'org_member_cap_grants', grant(OM_CREW_ID, 'money.costs'))
      const leaks: string[] = []
      if (over.ok) leaks.push('granted work.suite without holding it')
      else if (over.code !== 'GR001') leaks.push(`refused, but not by G-1 (${over.code})`)
      judge(34, 'nobody grants a capability they do not hold (control: one they do)',
        leaks, within.ok ? 1 : 0)
      await owner.from('org_member_cap_grants').delete().eq('member_id', OM_CREW_ID)
      await owner.from('organization_members').update({ extra_caps: [] }).eq('id', OM_CREW_ID)
    }

    // 35 · the last active owner cannot be removed. Control: with two, one can.
    {
      const sole = await (async () => {
        const { data, error } = await owner.from('organization_members').delete().eq('id', OM_OWNER_ID).select('id')
        if (error) return { ok: false, code: error.code ?? 'ERR' }
        return { ok: (data ?? []).length > 0, code: null as string | null }
      })()
      // Control: make finance an owner too, then the same delete is permitted.
      await owner.from('organization_members').update({ role: 'owner' }).eq('id', OM_FINANCE_ID)
      const withTwo = await updOf(owner, 'organization_members', { role: 'crew' }, OM_FINANCE_ID)
      const leaks: string[] = []
      if (sole.ok) leaks.push('the sole active owner was DELETED')
      else if (sole.code !== 'GR005') leaks.push(`refused, but not by G-4 (${sole.code})`)
      judge(35, 'an org keeps at least one active owner (control: with two, one may go)',
        leaks, withTwo.ok ? 1 : 0)
      await owner.from('organization_members').update({ role: 'finance' }).eq('id', OM_FINANCE_ID)
      await owner.from('org_member_cap_grants').delete().eq('member_id', OM_FINANCE_ID)
      await owner.from('organization_members').update({ extra_caps: [] }).eq('id', OM_FINANCE_ID)
    }

    // 36 · an expired grant does not resolve. Control: the same grant, unexpired.
    {
      const past = new Date(Date.now() - 3600_000).toISOString()
      const e = await rowsOf(owner, 'org_member_cap_grants', grant(OM_CREW_ID, 'money.invoices', 'grant', past))
      const whileExpired = e.ok ? await countRows(crew, 'invoices') : -1
      await owner.from('org_member_cap_grants').delete().eq('member_id', OM_CREW_ID)
      const f = await rowsOf(owner, 'org_member_cap_grants', grant(OM_CREW_ID, 'money.invoices'))
      const whileLive = f.ok ? await countRows(crew, 'invoices') : 0
      const leaks: string[] = []
      if (!e.ok) leaks.push(`expired grant row refused: ${e.code}`)
      if (whileExpired > 0) leaks.push(`expired grant resolved (invoices=${whileExpired})`)
      judge(36, 'an expired grant does not resolve (control: the same grant, live)', leaks, whileLive)
      await owner.from('org_member_cap_grants').delete().eq('member_id', OM_CREW_ID)
      await owner.from('organization_members').update({ extra_caps: [] }).eq('id', OM_CREW_ID)
    }

    // ── 37 · A GRANT AND A DENY, HELD AT ONCE — DENY WINS ──────────────────
    //
    // THE ASSERTION S-R-A A-3 NAMES AS OWED, and it exists because of what
    // assertion 31 canNOT witness. 31 tests a denial beating the ROLE BASELINE,
    // which was constructible under the narrow index and is R-3's own
    // Producer/rates example — so 31 is not vacuous and is deliberately not
    // rewritten. But it passes IDENTICALLY before and after migration 0055, so
    // it cannot prove the behaviour the migration exists to enable. A migration
    // whose justification no test can see is indistinguishable from a migration
    // nobody needed (HANDOFF §12 lesson 9, one step later in time).
    //
    // THE PERSONA IS `finance` AND THE CAPABILITY IS work.suite, DELIBERATELY:
    // the finance baseline carries money.invoices and money.costs and NOT
    // work.suite, so the only thing that can grant it here is the GRANT ROW.
    // That isolates grant-vs-deny with no baseline in the answer — which is the
    // state the tables could never hold, and it is why this cannot be folded
    // into 31.
    //
    // THE CONTROL IS THE GRANT ALONE, reached by REVOKING the deny rather than
    // by deleting it and re-inserting. That ordering is the point: A-3 chose
    // widening over "latest row wins" because revoking a denial must RESTORE the
    // underlying grant. Under latest-wins the grant row would have been
    // overwritten and revoking the deny would leave nothing — the person
    // silently below where an admin put them. So this control does not merely
    // make the zero mean something; it asserts the reason the index is shaped
    // this way.
    {
      const g = await rowsOf(owner, 'org_member_cap_grants', grant(OM_FINANCE_ID, 'work.suite', 'grant'))
      const d = await rowsOf(owner, 'org_member_cap_grants', grant(OM_FINANCE_ID, 'work.suite', 'deny'))
      const leaks: string[] = []
      let control = 0
      if (!g.ok) leaks.push(`grant row refused: ${g.code}`)
      // The whole precondition. Before 0055 this insert failed with a
      // unique_violation on org_member_cap_grants_live_idx, and an assertion
      // whose precondition cannot be constructed reports nothing and looks like
      // a pass. It must FAIL loudly instead.
      if (!d.ok) leaks.push(`deny row refused — the 0055 index widening is NOT applied: ${d.code}`)
      if (g.ok && d.ok) {
        const held = await capOf(finance, 'work.suite')
        if (held !== false) leaks.push(`deny did not win: has_cap('work.suite') = ${held}`)
        // Control: revoke the DENY, and the GRANT must come back.
        await owner.from('org_member_cap_grants')
          .update({ revoked_at: new Date().toISOString() })
          .eq('member_id', OM_FINANCE_ID).eq('capability', 'work.suite').eq('mode', 'deny')
        control = (await capOf(finance, 'work.suite')) === true ? 1 : 0
      }
      judge(37, 'a grant and a deny on one capability coexist and the deny wins (control: revoking the deny restores the grant)',
        leaks, control)
      await owner.from('org_member_cap_grants').delete().eq('member_id', OM_FINANCE_ID)
    }

    // ── 38-41 · S-R §2, §3.2, R-10 and G-5: the SCOPED seat (Batch 26) ──────
    //
    // These four are why the `contractor` persona exists. It holds the SAME
    // company role as the staff crew persona — `crew`, baseline work.projects +
    // work.suite — and differs only in seat_class and scope_mode. That pairing is
    // what makes 38's zero mean "scope did it" rather than "they hold nothing",
    // which an owner control could never distinguish (the same argument the
    // `finance` persona settles for assertion 30).

    // 38 · a contractor with NO assignments reads nothing. Control: the owner,
    // scope_mode 'all', reads the same tables.
    //
    // THE FIXTURE IS THE ABSENCE. B1's footgun is that an empty project set means
    // EVERY project under scope_mode 'all' and NO project under 'selected', so
    // this assertion is the one that proves the STATED value is what gets read.
    // If scope were ever inferred from row count, this persona would read the
    // whole tenant and this assertion would be the thing that said so.
    {
      const leaks: string[] = []
      for (const t of ['projects', 'tasks', 'files', 'messages']) {
        const n = await countRows(contractor, t)
        if (n > 0) leaks.push(`${t}=${n}`)
      }
      const control = await countRows(owner, 'projects')
      judge(38, 'a contractor with no project assignments reads no projects, tasks, files or messages (control: an all-scope member reads them)',
        leaks, control)
    }

    // 39 · a SCOPED member cannot read a sibling production's rows. Control: they
    // read their own production's. The crew persona is assigned to PROJECT_1 only.
    {
      const sibling = await countRows(crew, 'tasks', [{ col: 'project_id', op: 'eq', val: PROJECT_2_ID }])
      const own = await countRows(crew, 'tasks', [{ col: 'project_id', op: 'eq', val: PROJECT_1_ID }])
      judge(39, 'a scoped member reads zero of a sibling production\'s tasks (control: their own production\'s)',
        sibling > 0 ? [`sibling tasks=${sibling}`] : [], own)
    }

    // 40 · G-5 (0057): an EXPIRED assignment does not resolve. Control: the same
    // assignment before expiry.
    //
    // Nothing is deleted — the row survives with its expiry, which is the whole
    // difference between expiry and removal and the reason expires_at exists for a
    // freelance bench (S-R §6 G-5). Asserted on `projects` because that is the
    // table whose entire visibility is the assignment.
    {
      const before = await countRows(crew, 'projects')
      const past = new Date(Date.now() - 3600_000).toISOString()
      // Written inline rather than through updOf(): this table's PK is
      // (member_id, project_id) and it has no `id` column, which updOf assumes.
      // Still asks for rows back — a policy refusal is an empty result with no
      // error (§12 lesson 6), and here that would silently make the assertion
      // measure nothing.
      const { data: stamped, error: stampErr } = await owner
        .from('organization_member_projects').update({ expires_at: past })
        .eq('member_id', OM_CREW_ID).eq('project_id', PROJECT_1_ID).select('project_id')
      const e = { ok: !stampErr && (stamped ?? []).length > 0, code: stampErr?.code ?? 'RLS-ZERO-ROWS' }
      const whileExpired = e.ok ? await countRows(crew, 'projects') : -1
      // The row must still be there: an expiry that deleted the record would pass
      // the visibility half of this assertion and destroy what R-8 exists to keep.
      const { data: survives } = await owner.from('organization_member_projects')
        .select('project_id, expires_at')
        .eq('member_id', OM_CREW_ID).eq('project_id', PROJECT_1_ID)
      const leaks: string[] = []
      if (!e.ok) leaks.push(`could not set expires_at: ${e.code}`)
      if (whileExpired > 0) leaks.push(`expired assignment still resolves (projects=${whileExpired})`)
      if ((survives ?? []).length === 0) leaks.push('the assignment row was DELETED rather than expired')
      await owner.from('organization_member_projects').update({ expires_at: null })
        .eq('member_id', OM_CREW_ID).eq('project_id', PROJECT_1_ID)
      judge(40, 'an expired project assignment does not resolve, and the row survives (control: the same assignment before expiry)',
        leaks, before)
    }

    // 41 · R-10 (0058): a project role carries a capability baseline on the
    // assigned production. Control: an `observer` on the SAME production gets none.
    //
    // The capability is `record.approval_policy` and the role is `line_producer`,
    // deliberately: the crew COMPANY baseline is work.projects + work.suite, so a
    // role granting either of those would prove nothing — the persona already holds
    // them. record.approval_policy is held by neither, so the only thing that can
    // put it in the set is the project role.
    //
    // "AND NOWHERE ELSE" is the second half and is asserted as the ROW FILTER
    // rather than as a second capability set: S-R §5 produces ONE set and then
    // filters rows (R-5a), so the honest statement is that the capability resolves
    // while the sibling production stays unreadable. The imprecision that follows
    // from that model — a colorist on A and an observer on B holds work.suite on
    // both — is recorded in PROJECT_ROLE_BASELINE's comment, not asserted away.
    {
      const CAP = 'record.approval_policy'
      const setRole = (r: string | null) => owner.from('organization_member_projects')
        .update({ project_role: r }).eq('member_id', OM_CREW_ID).eq('project_id', PROJECT_1_ID).select('project_id')

      await setRole('line_producer')
      const withRole = await capOf(crew, CAP)
      const stillScoped = await countRows(crew, 'tasks', [{ col: 'project_id', op: 'eq', val: PROJECT_2_ID }])

      await setRole('observer')
      const asObserver = await capOf(crew, CAP)

      await setRole(null)
      const leaks: string[] = []
      if (withRole !== true) leaks.push(`line_producer did not grant ${CAP} (got ${withRole})`)
      if (asObserver !== false) leaks.push(`observer granted ${CAP} (got ${asObserver})`)
      if (stillScoped > 0) leaks.push(`the role widened row visibility: sibling tasks=${stillScoped}`)
      judge(41, 'a project role grants its baseline on the assigned production and widens no rows (control: an observer on the same production gets none)',
        leaks, withRole === true ? 1 : 0)
    }

    // ── 21 · S3-core §4.2 — the ledger the purge must never touch ──────────
    //
    // This slot has been RESERVED since the retention engine was specified.
    // 0071 built it, so it is filled here.
    //
    // The guard is a TRIGGER rather than an omission from the purge's table
    // list, because the defect it closes was a CASCADE: `activity_log`'s
    // project and client FKs were ON DELETE CASCADE, so deleting a client
    // company destroyed its ledger without anyone writing a delete statement.
    {
      const seeded = await owner.from('activity_log').insert({
        organization_id: HARNESS_ORG_ID, actor_name: 'Harness',
        event_type: 'project_created', title: 'zz retention probe',
      }).select('id').maybeSingle()

      if (!seeded.data) {
        record(21, 'the activity ledger refuses deletion inside its 7-year window', 'ERROR',
          `could not seed a ledger row: ${seeded.error?.message ?? 'no row returned'}`)
      } else {
        const rowId = (seeded.data as { id: string }).id
        const del = await owner.from('activity_log').delete().eq('id', rowId).select('id')
        const stillThere = await countRows(owner, 'activity_log', [{ op: 'eq', col: 'id', val: rowId }])
        // THE ROW IS THE WITNESS (§12 lesson 11). Here the trigger DOES raise,
        // so `error` is meaningful — but the property is that the row survived,
        // and that is what is asserted.
        judge(21, 'the activity ledger refuses deletion inside its 7-year window (control: the same row still reads)',
          stillThere === 0 ? ['a ledger row inside the 7-year window was deleted'] : [],
          stillThere)
        if (!del.error && stillThere === 0) {
          // Unreachable if the trigger works; left as a tripwire.
          await owner.from('activity_log').delete().eq('id', rowId)
        }
      }
    }

    // ── 50-51 · 0070, 0072: soft delete, and calendar credentials ──────────
    {
      // 50 · SOFT DELETE, AND THE BOUNDARY IT ACTUALLY ENFORCES.
      //
      // 0073 settled where the predicate lives, on evidence: CLIENTS are
      // blocked by RLS, crew are not. Crew keep an unfiltered policy because
      // that is what makes the soft delete writable at all — a `FOR ALL`
      // policy's USING is applied to the NEW row, so `deleted_at is null`
      // there refuses the very update that sets it (HANDOFF §12 lesson 11,
      // learned in Batch 26 and contradicted by 0070).
      //
      // So the assertion is the client's view, which is the security boundary,
      // and the control is that they could see the row a moment earlier.
      const t = await owner.from('tasks').insert({
        organization_id: HARNESS_ORG_ID, project_id: PROJECT_1_ID,
        title: 'zz soft-delete probe', visible_to_client: true,
      }).select('id').maybeSingle()

      if (!t.data) {
        record(50, 'a soft-deleted task disappears for the client', 'ERROR',
          `could not seed a task: ${t.error?.message ?? 'no row returned'}`)
      } else {
        const taskId = (t.data as { id: string }).id
        const clientSawBefore = await countRows(c1own, 'tasks', [{ op: 'eq', col: 'id', val: taskId }])

        const soft = await owner.from('tasks')
          .update({ deleted_at: new Date().toISOString() }).eq('id', taskId).select('id')
        const clientSeesAfter = await countRows(c1own, 'tasks', [{ op: 'eq', col: 'id', val: taskId }])

        const leaks: string[] = []
        if ((soft.data ?? []).length === 0) {
          leaks.push(`the soft delete itself was refused (${soft.error?.code ?? 'zero rows'})`)
        }
        if (clientSeesAfter > 0) leaks.push('the client still reads a soft-deleted task')
        judge(50, 'a soft-deleted task disappears for the client (control: the client could read it a moment before)',
          leaks, clientSawBefore)

        await owner.from('tasks').delete().eq('id', taskId)
      }

      // 51 · S3-b §1.7, and it is absolute: "Nobody else reads a person's
      // calendar credentials." No org predicate, no people.manage escape, no
      // owner exception — an owner reading a crew member's Google token is
      // access to that person's private calendar, not administration.
      const { data: crewUser } = await owner.from('organization_members')
        .select('user_id').eq('id', OM_CREW_ID).maybeSingle()
      const crewUid = (crewUser?.user_id as string) ?? null

      if (!crewUid) {
        record(51, 'a calendar connection is invisible to everyone but its owner', 'ERROR',
          'no crew user_id to bind a connection to')
      } else {
        // Seeded BY THE CREW MEMBER: the policy is `user_id = auth.uid()`, so
        // nobody else — the owner included — could create it for them.
        const seeded = await crew.from('calendar_connections').insert({
          organization_id: HARNESS_ORG_ID, user_id: crewUid,
          provider: 'google', external_account_id: 'zz-harness@example.com',
        }).select('id').maybeSingle()

        const theirs = seeded.data ? await countRows(crew, 'calendar_connections') : -1
        const ownerSees = seeded.data ? await countRows(owner, 'calendar_connections') : -1
        judge(51, 'an org OWNER reads none of a crew member\'s calendar connections (control: the crew member reads their own)',
          !seeded.data ? [`could not seed: ${seeded.error?.message ?? 'no row'}`]
            : ownerSees > 0 ? [`the owner read ${ownerSees} calendar credential row(s)`] : [],
          theirs)

        await crew.from('calendar_connections').delete().eq('user_id', crewUid)
      }
    }

    // ── 46-49 · S3-b (0065, 0068): the calendar and the signing record ─────
    //
    // S3-b §6 asks for six assertions. Three of its six land here; §6.3
    // (calendar_connections) has no table because migration 4 is deferred by the
    // spec's own recommendation, and §6.6 (member_budgets) is already 42–43.
    {
      // 46 · the PRODUCTION axis. A crew member scoped to PROJECT_1 must not
      // read an entry on its sibling, even though both are internal and both
      // are their own org's.
      const own = await countRows(crew, 'calendar_entries', [{ op: 'eq', col: 'id', val: CAL_C1_ID }])
      const sibling = await countRows(crew, 'calendar_entries', [{ op: 'eq', col: 'id', val: CAL_P2_ID }])
      judge(46, 'a scoped member reads no calendar entry from a sibling production (control: the entry on their own)',
        sibling > 0 ? [`${sibling} sibling-production entr${sibling === 1 ? 'y' : 'ies'} visible`] : [],
        own)

      // 47 · the COMPANY axis, on the same table. Different failure, same row.
      const mine = await countRows(c1own, 'calendar_entries', [{ op: 'eq', col: 'id', val: CAL_C1_ID }])
      const theirs = await countRows(c2own, 'calendar_entries', [{ op: 'eq', col: 'id', val: CAL_C1_ID }])
      judge(47, 'a client member reads no other company\'s calendar entry (control: their own company\'s)',
        theirs > 0 ? ['another company\'s calendar entry was visible'] : [], mine)

      // 48 · the same two axes on the signing record.
      const myContract = await countRows(c1own, 'contracts', [{ op: 'eq', col: 'id', val: CONTRACT_C1_ID }])
      const theirContract = await countRows(c2own, 'contracts', [{ op: 'eq', col: 'id', val: CONTRACT_C1_ID }])
      judge(48, 'a client member reads no other company\'s contract (control: their own company\'s)',
        theirContract > 0 ? ['another company\'s contract was visible'] : [], myContract)

      // 49 · S3-b §6 calls this "the important one", and it is: the only
      // assertion in the suite proving a NEGATIVE CAPABILITY rather than a
      // scoping boundary. A certificate of completion that an administrator can
      // edit is not evidence.
      // THE ROW IS THE WITNESS, NOT THE ERROR — §12 lesson 6, and the first
      // draft of this assertion walked straight into it. There is no UPDATE
      // policy and no DELETE policy on contract_events, so RLS refuses by
      // matching ZERO ROWS and PostgREST returns NO ERROR. Testing `error`
      // reported a table that is working exactly as designed as a breach.
      //
      // Two layers protect this table and only one is testable from here. RLS
      // (policy absence) is what a persona meets; the TRIGGER in 0068 is what
      // the service role meets, and the harness runs as personas so it cannot
      // reach that half — it was proven separately against a superuser
      // connection, which is stricter than the service role.
      const leaks: string[] = []
      const upd = await owner.from('contract_events')
        .update({ event: 'signed' }).eq('id', CONTRACT_EVENT_ID).select('id')
      if ((upd.data ?? []).length > 0) leaks.push('an org OWNER updated the signing record')
      const del = await owner.from('contract_events')
        .delete().eq('id', CONTRACT_EVENT_ID).select('id')
      if ((del.data ?? []).length > 0) leaks.push('an org OWNER deleted from the signing record')

      // And the property itself, which neither of the above actually asserts:
      // the record is still there, and it still says what it said.
      const { data: after } = await owner.from('contract_events')
        .select('id, event').eq('id', CONTRACT_EVENT_ID).maybeSingle()
      if (!after) leaks.push('the signing record row is gone after the delete attempt')
      else if ((after as { event: string }).event !== 'created') {
        leaks.push(`the signing record was altered to '${(after as { event: string }).event}'`)
      }

      // The control is a SELECT: if the row were simply unreadable, every
      // refusal above would be satisfied by an empty table.
      const readable = await countRows(owner, 'contract_events', [{ op: 'eq', col: 'id', val: CONTRACT_EVENT_ID }])
      judge(49, 'contract_events survives UPDATE and DELETE from an org owner, unchanged (control: the same row reads fine)',
        leaks, readable)
    }

    // ── 53 · 0068 — nobody signs on somebody else's behalf ─────────────────
    //
    // Every other portal permission asks "may this ROLE do this". A signature
    // asks something stricter: are you THE PERSON NAMED. A client owner holding
    // every capability in the matrix still must not be able to sign for a
    // colleague, and `contract_signers_self_update` is what makes that true on
    // the row rather than in a route.
    {
      const { data: mine } = await c1own.from('contract_signers')
        .select('id').eq('contract_id', CONTRACT_C1_ID).limit(1).maybeSingle()

      if (!mine) {
        record(53, 'a client member cannot sign as another signer', 'ERROR',
          'no signer row seeded on the harness contract')
      } else {
        const signerId = (mine as { id: string }).id
        // c1mate is on the SAME company and can read the contract — which is
        // what makes this a real test rather than a tenancy one.
        const forged = await c1mate.from('contract_signers')
          .update({ status: 'signed', signed_at: new Date().toISOString() })
          .eq('id', signerId).select('id')
        const { data: after } = await c1own.from('contract_signers')
          .select('status').eq('id', signerId).maybeSingle()

        const leaks: string[] = []
        if ((forged.data ?? []).length > 0) leaks.push('a colleague wrote to another person\'s signer row')
        if ((after as { status: string } | null)?.status === 'signed') {
          leaks.push('a colleague marked another person as having signed')
        }
        const readable = await countRows(c1mate, 'contract_signers', [{ op: 'eq', col: 'id', val: signerId }])
        judge(53, 'a client member cannot mark a colleague as having signed (control: they can READ the same row)',
          leaks, readable)
      }
    }

    // ── 57 · 0083 — a tenant sees its own queue and can forge nothing into it ─
    //
    // `jobs` carries a crew READ policy and NO write policy, deliberately: a
    // queue nobody can see is a queue nobody can debug, and a queue anybody can
    // write to is a way to make the worker act for you. The worker holds the
    // service role; everybody else reads.
    {
      const leaks: string[] = []
      const forged = await owner.from('jobs').insert({
        organization_id: HARNESS_ORG_ID, kind: 'media.transcode', payload: {},
      }).select('id')
      if ((forged.data ?? []).length > 0) leaks.push('a session enqueued a job')

      // And a job cannot be steered once queued — an UPDATE would let somebody
      // repoint a transcode at a file they do not own.
      const steered = await owner.from('jobs')
        .update({ payload: { file_id: 'forged' } }).eq('id', JOB_ID).select('id')
      if ((steered.data ?? []).length > 0) leaks.push('a session rewrote a queued job')

      // CONTROL: a REAL read of the seeded row. The first version of this
      // assertion had a control expression that evaluated to 1 unconditionally,
      // which proved nothing — the whole point of a control is that it can fail.
      const readable = await countRows(owner, 'jobs', [{ op: 'eq', col: 'id', val: JOB_ID }])
      judge(57, 'no session enqueues or rewrites a job, and the tenant still reads its own queue (control: the seeded job)',
        leaks, readable)
    }

    // ── 58 · 0085 — a viewing record is EVIDENCE, so no session may touch it ─
    //
    // `share_link_views` records what a guest actually watched before they
    // approved a cut, which is the thing this product has that Frame.io,
    // Dropbox Replay and MediaSilo do not: they record views for a chart, and a
    // chart nobody relies on does not have to be tamper-proof.
    //
    // Once a studio can edit it, "watched 4 seconds" becomes "watched it
    // through" on the day it matters, and the record is worth exactly nothing.
    // Same reasoning that made `contract_events` append-only. The viewer's own
    // heartbeat writes these rows, server-side, through a resolved token.
    {
      const leaks: string[] = []
      const forged = await owner.from('share_link_views').insert({
        link_id: SHARE_LINK_P1_ID, organization_id: HARNESS_ORG_ID,
        viewer_email: 'forged@rls-harness.example.com',
        seconds_watched: 600, furthest_ms: 600_000, duration_ms: 600_000,
      }).select('id')
      if ((forged.data ?? []).length > 0) leaks.push('a session wrote a viewing record')

      // The one that actually matters: rewriting how much somebody saw.
      const rewritten = await owner.from('share_link_views')
        .update({ furthest_ms: 600_000, seconds_watched: 600 })
        .eq('id', SHARE_VIEW_P1_ID).select('id')
      if ((rewritten.data ?? []).length > 0) leaks.push('a session rewrote how much a guest watched')

      const erased = await owner.from('share_link_views')
        .delete().eq('id', SHARE_VIEW_P1_ID).select('id')
      if ((erased.data ?? []).length > 0) leaks.push('a session deleted a viewing record')

      // CONTROL: a real read of the seeded view — the studio must still SEE the
      // evidence it cannot edit, or the surface has nothing to show.
      const readable = await countRows(owner, 'share_link_views',
        [{ op: 'eq', col: 'id', val: SHARE_VIEW_P1_ID }])
      judge(58, 'no session writes, rewrites or deletes a guest viewing record, and the studio still reads it (control: the seeded view)',
        leaks, readable)
    }

    // ── 59 · 0087 — a screening link is as visible as what it points at ─────
    //
    // 0085 shipped with `organization_id = current_org() and is_org_member()`
    // and nothing else, so a contractor scoped to one production could list
    // every link the studio had minted. **That is R-6's leak wearing a UI
    // convention** — a row reading "Netflix Pilot · reel 3 · 4 views" discloses
    // the production AND its schedule to somebody RLS hides it from.
    //
    // The `crew` persona is scoped to PROJECT_1 only, so the two seeded links
    // on sibling productions are exactly the pair that can tell the two halves
    // apart. A single link would prove only that crew read links.
    {
      const leaks: string[] = []
      const other = await countRows(crew, 'share_links',
        [{ op: 'eq', col: 'id', val: SHARE_LINK_P2_ID }])
      if (other > 0) leaks.push('a scoped member read a link to a production they cannot see')

      // 0059's half, and the reason WITH CHECK is written separately: INSERT is
      // the one command USING cannot reach, so without it a scoped member could
      // MINT a screener against a production they may not read and then watch
      // it through the guest page — access laundering, one table over.
      const minted = await crew.from('share_links').insert({
        organization_id: HARNESS_ORG_ID, subject_kind: 'file', subject_id: FILE_P2_ID,
        token_hash: `harness-probe-${randomUUID()}`,
      }).select('id')
      if ((minted.data ?? []).length > 0) {
        leaks.push('a scoped member minted a link against a production they cannot see')
        await owner.from('share_links').delete().eq('id', (minted.data ?? [])[0].id)
      }

      // And the views follow the link, through it (0038's idiom), so a link
      // they cannot read carries evidence they cannot read either.
      const otherViews = await countRows(crew, 'share_link_views',
        [{ op: 'eq', col: 'link_id', val: SHARE_LINK_P2_ID }])
      if (otherViews > 0) leaks.push('a scoped member read views of a link they cannot see')

      // CONTROL: the link on the production they ARE assigned to.
      const theirs = await countRows(crew, 'share_links',
        [{ op: 'eq', col: 'id', val: SHARE_LINK_P1_ID }])
      judge(59, 'a scoped member reads no screening link outside their assignments and cannot mint one (control: the link on their own production)',
        leaks, theirs)
    }

    // ── 60 · the brand kit — a studio's FACE is not editable by everyone ────
    //
    // `organizations.branding` is what every client of this studio sees: their
    // portal, the review pages sent to them, the guest screening links, the
    // signing pages, and the colour on a sealed contract PDF. A crew member who
    // could rewrite it could deface the studio in front of its own clients,
    // and the studio would find out from a client.
    //
    // `organizations_admin_write` (0021) is `id = current_org() and
    // is_org_admin()`, so role — not mere membership — is the control. The route
    // asks `org.settings.write` on top; this asserts the ROW underneath it,
    // because a route being careful is not a control (Batch 22).
    {
      const leaks: string[] = []
      const defaced = await crew.from('organizations')
        .update({ branding: { input: { colour: '#ff0000' }, tokens: { light: {}, dark: {} } } })
        .eq('id', HARNESS_ORG_ID).select('id')
      if ((defaced.data ?? []).length > 0) leaks.push('a crew member rewrote the studio brand')

      // CONTROL: the owner CAN — otherwise this asserts that branding is broken
      // rather than that it is governed.
      const byOwner = await owner.from('organizations')
        .update({ branding: {} }).eq('id', HARNESS_ORG_ID).select('id')
      judge(60, 'a crew member cannot rewrite the studio brand its clients see (control: an org admin can)',
        leaks, (byOwner.data ?? []).length)

      // Left as `{}` either way: the harness tenant must not end a run wearing
      // a colour a later assertion did not put there.
      await owner.from('organizations').update({ branding: {} }).eq('id', HARNESS_ORG_ID)
    }

    // ── 61 · 0088 — the disclosure reaches the client, and stops there ──────
    //
    // 0079 makes a signed release WRITE the rights row it proves, and until
    // 0088 NOTHING read it back — the studio held the evidence the New York
    // (9 June 2026) and EU AI Act (2 August 2026) disclosure rules require and
    // could not see it, while the client who runs the advertisement and takes
    // the penalty was told nothing at all.
    //
    // Opening a table to clients is exactly where a scope mistake is expensive,
    // so this asserts three boundaries at once: the right company, the right
    // SUBJECT (asset yes, script no), and read-only.
    {
      const leaks: string[] = []

      // Another company's asset. The rights row exists and must be invisible.
      const other = await countRows(c1own, 'rights', [{ op: 'eq', col: 'id', val: RIGHTS_P3_ID }])
      if (other > 0) leaks.push("a client read the rights on another company's asset")

      // DOCUMENT provenance is the studio's script. A client reads none of it,
      // whichever production it belongs to.
      const script = await countRows(c1own, 'asset_provenance',
        [{ op: 'eq', col: 'id', val: PROV_DOC_P1_ID }])
      if (script > 0) leaks.push('a client read the AI provenance of a script')

      // READ ONLY. A rights row is a consequence of a signature (0079); a
      // beneficiary who could assert their own clearance would make it a claim
      // again, which is the whole thing the trigger exists to prevent.
      const asserted = await c1own.from('rights')
        .update({ talent_consent: true, ai_generative_training: 'allowed' })
        .eq('id', RIGHTS_P1_ID).select('id')
      if ((asserted.data ?? []).length > 0) leaks.push('a client granted themselves rights')

      const forged = await c1own.from('rights').insert({
        organization_id: HARNESS_ORG_ID, file_id: FILE_P1_ID, license: 'appearance',
        commercial_ok: true, talent_consent: true,
      }).select('id')
      if ((forged.data ?? []).length > 0) {
        leaks.push('a client wrote a rights row')
        await owner.from('rights').delete().eq('id', (forged.data ?? [])[0].id)
      }

      // CONTROL: their OWN company's asset, which they must read — otherwise
      // this asserts that the disclosure is broken rather than that it is
      // scoped, and the whole feature would be invisible while passing.
      const theirs = await countRows(c1own, 'rights', [{ op: 'eq', col: 'id', val: RIGHTS_P1_ID }])
      judge(61, "a client reads the rights on their own company's asset and nothing else, and cannot write one (control: their own asset)",
        leaks, theirs)

      // And the one that proves the FILE side of the provenance split is live
      // rather than merely not-crashing: the same client reads the ASSET's
      // disclosure. Folded into 61's control would have hidden a zero here.
      const assetProv = await countRows(c1own, 'asset_provenance',
        [{ op: 'eq', col: 'file_id', val: FILE_P1_ID }])
      if (assetProv === 0) {
        record(61, "a client reads the rights on their own company's asset and nothing else, and cannot write one (control: their own asset)",
          'FAIL', 'the client could not read the AI disclosure on their own asset — the feature is scoped to nothing')
      }
    }

    // ── 56 · 0082 — the collaborator's SEAT is the invite ──────────────────
    //
    // S3-d MD-4's external collaborator has NO roster row anywhere: not crew,
    // not client, just a room_members seat. Every meeting policy before 0082
    // missed them — `meetings_crew_all` wants is_org_member(),
    // `meetings_client_read` wants is_client_member() — so the VFX artist in the
    // project room could read the conversation about a shot and could not join
    // the review session about it.
    //
    // AND BECAUSE THE MEDIA TOKEN FOLLOWS THE ROW (S3-b §2.3 — no read, no
    // token, no way in), this assertion is also the access control on the video.
    {
      // The meeting on THEIR room: admitted by the seat.
      const theirs = await countRows(collab, 'meetings', [{ op: 'eq', col: 'id', val: MEETING_ROOM_ID }])
      // An internal meeting on NO room: a seat somewhere else admits nothing.
      const other = await countRows(collab, 'meetings', [{ op: 'eq', col: 'id', val: MEETING_INTERNAL_ID }])
      judge(56, 'a roster-less collaborator reads the meeting on their own room and no other (control: the one on their room)',
        other > 0 ? ['a collaborator read a meeting outside their room'] : [], theirs)
    }

    // ── 55 · 0067 — the company column is the boundary for MEETINGS ────────
    //
    // A meeting with no client_id is the studio's internal floor. Batch 24
    // settled this exact split for rooms after the crew hub filtered on the
    // wrong thing and put a conversation with a client's person on the internal
    // floor; this is the same rule one table over, and a client walking into an
    // internal call is a far worse version of it.
    //
    // The media token follows the row: no read, no token, no way into the room
    // (S3-b §2.3). So this assertion is also the access control on the video.
    {
      const internal = await countRows(c1own, 'meetings', [{ op: 'eq', col: 'id', val: MEETING_INTERNAL_ID }])
      const theirs = await countRows(c1own, 'meetings', [{ op: 'eq', col: 'id', val: MEETING_CLIENT_ID }])
      judge(55, 'a client reads no INTERNAL meeting (control: the one addressed to their company)',
        internal > 0 ? ['a client could read the studio\'s internal meeting'] : [], theirs)
    }

    // ── 54 · 0078 — a signing link is invisible to EVERY session ───────────
    //
    // A signing link is a bearer credential for a legal document. The table has
    // RLS enabled and NO POLICY AT ALL, so the only readers are the minting
    // route and the anonymous signing path, both server-side. If any persona
    // can read a token hash, the whole design is decoration.
    {
      const seen = await Promise.all([
        countRows(owner, 'contract_signing_links'),
        countRows(crew, 'contract_signing_links'),
        countRows(c1own, 'contract_signing_links'),
        countRows(finance, 'contract_signing_links'),
      ])
      const leaks = seen.some((n) => n > 0)
        ? [`a session read ${Math.max(...seen)} signing-link row(s)`] : []
      // CONTROL: the same owner reads the CONTRACT those links belong to — so
      // the four zeros above cannot be explained by a blind session.
      const control = await countRows(owner, 'contracts', [{ op: 'eq', col: 'id', val: CONTRACT_C1_ID }])
      judge(54, 'no session reads a signing link, owner included (control: the owner reads the contract it belongs to)',
        leaks, control)
    }

    // ── 52 · 0074 — a projected calendar entry is not editable by hand ─────
    //
    // An approval deadline on the calendar is a PROJECTION of its stage. If a
    // person could drag it, the next save of that stage would overwrite the
    // change and the edit would silently vanish — worse than not offering it.
    // The route refuses it too, but a route being careful is not a control when
    // the table accepts direct writes (§12).
    {
      const { data: derived } = await owner.from('calendar_entries')
        .select('id').eq('organization_id', HARNESS_ORG_ID)
        .not('source_id', 'is', null).limit(1).maybeSingle()

      if (!derived) {
        record(52, 'a projected calendar entry cannot be edited by hand', 'ERROR',
          'no projected entry in the harness org to test against')
      } else {
        const derivedId = (derived as { id: string }).id
        await owner.from('calendar_entries').delete().eq('id', derivedId)
        const survived = await countRows(owner, 'calendar_entries', [{ op: 'eq', col: 'id', val: derivedId }])

        const edit = await owner.from('calendar_entries')
          .update({ title: 'zz forged' }).eq('id', derivedId).select('id')
        const { data: after } = await owner.from('calendar_entries')
          .select('title').eq('id', derivedId).maybeSingle()

        const leaks: string[] = []
        if (survived === 0) leaks.push('a projected entry was deleted by hand')
        if ((edit.data ?? []).length > 0 || (after as { title: string } | null)?.title === 'zz forged') {
          leaks.push('a projected entry was retitled by hand')
        }

        // CONTROL: the same person, the same table, a MANUAL entry — which must
        // work, or the refusals above prove only that the table is locked.
        const mine = await owner.from('calendar_entries').insert({
          organization_id: HARNESS_ORG_ID, kind: 'manual',
          title: 'zz manual probe', starts_at: new Date().toISOString(),
        }).select('id').maybeSingle()
        let controlRows = 0
        if (mine.data) {
          const del = await owner.from('calendar_entries')
            .delete().eq('id', (mine.data as { id: string }).id).select('id')
          controlRows = (del.data ?? []).length
        }

        judge(52, 'a projected calendar entry survives a hand edit and a hand delete (control: a manual entry deletes fine)',
          leaks, controlRows)
      }
    }

    // ── 44-45 · 0064: content provenance cannot be forged ──────────────────
    //
    // A provenance record is a disclosure a studio may have to stand behind in
    // front of a union, a broadcaster or a financier. Its whole value is that
    // it could only have been written by somebody who could see the script —
    // so the assertion that matters is not "can a member write one" but "can
    // they write one against a production they are scoped out of".
    {
      const prov = (docId: string) => ({
        organization_id: HARNESS_ORG_ID,
        document_id: docId,
        action: 'c2pa.placed',
        digital_source_type: 'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia',
        model: 'anthropic/claude-sonnet',
        prompt: 'harness',
        chars: 120,
        params: {},
      })

      // 44 · the scoped member writes against the production they HOLD, and is
      // refused against its sibling. One assertion, both directions.
      const inScope = await rowsOf(crew, 'asset_provenance', prov(DOC_P1_ID))
      const sibling = await rowsOf(crew, 'asset_provenance', prov(DOC_P2_ID))
      judge(44, 'a scoped member cannot record provenance against a sibling production\'s script (control: their own production\'s script accepts it)',
        sibling.ok ? ['provenance written against a script outside the caller\'s scope'] : [],
        inScope.ok ? 1 : 0)

      // 45 · the contractor holds NO assignments, so every script is out of
      // scope — including the one the crew member just wrote against.
      const byContractor = await rowsOf(contractor, 'asset_provenance', prov(DOC_P1_ID))
      const byOwner = await rowsOf(owner, 'asset_provenance', prov(DOC_P1_ID))
      judge(45, 'an unassigned contractor records provenance against no script at all (control: the all-scope owner records one)',
        byContractor.ok ? ['an unassigned seat forged a disclosure'] : [],
        byOwner.ok ? 1 : 0)

      await owner.from('asset_provenance').delete().eq('organization_id', HARNESS_ORG_ID)
    }

    // ── 42-43 · 0063: per-member AI spend limits ───────────────────────────
    //
    // A spending cap is only a cap if the person it bounds cannot lift it. These
    // two assert the halves that matter: they can SEE their own limit (a refused
    // AI call must be explicable, or it reads as a bug) and they cannot WRITE
    // one — not their own, not anybody's.
    {
      const row = {
        organization_id: HARNESS_ORG_ID, user_id: null as string | null,
        period: 'week', limit_cents: 500, hard_stop: true,
      }
      // Seeded by the owner, who holds money.costs through the owner baseline.
      const { data: crewUser } = await owner.from('organization_members')
        .select('user_id').eq('id', OM_CREW_ID).maybeSingle()
      row.user_id = (crewUser?.user_id as string) ?? null

      if (!row.user_id) {
        record(42, 'a member reads their own spend limit', 'ERROR', 'no crew user_id to bind a budget to')
        record(43, 'a member cannot set a spend limit', 'ERROR', 'no crew user_id to bind a budget to')
      } else {
        // Inserted directly, not through rowsOf(): that helper asks for `id`
        // back, and member_budgets is keyed on (organization_id, user_id) with
        // no id column — the select would ERROR and read as a refusal.
        const ins = await owner.from('member_budgets').insert(row).select('organization_id')
        const seeded = { ok: !ins.error && (ins.data ?? []).length > 0, code: ins.error?.code ?? null }
        // 42 · self-read is UNGATED, deliberately: a person must be able to see
        // the cap they are working under.
        const mine = seeded.ok ? await countRows(crew, 'member_budgets') : -1
        const ownerSees = await countRows(owner, 'member_budgets')
        judge(42, 'a member reads their OWN spend limit without money.costs (control: the owner reads it too)',
          !seeded.ok ? [`could not seed: ${seeded.code}`] : mine !== 1 ? [`member sees ${mine} rows, expected their own 1`] : [],
          ownerSees)

        // 43 · and cannot write one. A cap the capped can raise is not a cap.
        const selfRaise = await updOf(crew, 'member_budgets', { limit_cents: 99999999 }, null,
          [{ col: 'organization_id', op: 'eq', val: HARNESS_ORG_ID }, { col: 'user_id', op: 'eq', val: row.user_id }])
        const ownerRaise = await updOf(owner, 'member_budgets', { limit_cents: 600 }, null,
          [{ col: 'organization_id', op: 'eq', val: HARNESS_ORG_ID }, { col: 'user_id', op: 'eq', val: row.user_id }])
        judge(43, 'a member cannot raise their own spend limit (control: an owner can)',
          selfRaise.ok ? ['the capped member raised their own cap'] : [], ownerRaise.ok ? 1 : 0)

        await owner.from('member_budgets').delete()
          .eq('organization_id', HARNESS_ORG_ID).eq('user_id', row.user_id)
      }
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

  releaseLock()
  process.exit(fail + vac + err === 0 ? 0 : 1)
}

main().catch((e) => {
  // Released on the failure path too, or one crash leaves the lock behind and
  // every later run refuses — a guard that turns into an outage is worse than
  // the race it prevents.
  releaseLock()
  console.error(`\n✖ ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
