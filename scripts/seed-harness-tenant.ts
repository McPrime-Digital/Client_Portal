/**
 * scripts/seed-harness-tenant.ts — S2 §6, Part A.
 *
 * Creates a PERMANENT second organization in the live database so the RLS
 * harness has a real tenant boundary to read across. One tenant cannot prove
 * isolation: with only McPrime in the database, every "reads zero rows of the
 * other tenant" assertion passes because there is no other tenant.
 *
 * SAFETY MODEL
 *   1. Dry-run by default. Writes only with --apply. The plan it prints is the
 *      exact set of statements it would execute.
 *   2. Every row carries an explicit organization_id, and seedRows() refuses
 *      any payload whose organization_id is not the harness org. Relying on
 *      the column DEFAULT would land the entire seed inside McPrime's tenant
 *      (T-5) and the harness would prove nothing.
 *   3. Nothing in this file reads, updates or deletes a McPrime row.
 *   4. Fixed uuids on every public.* row, so each write is an upsert on a
 *      known primary key and a second run changes nothing.
 *
 * This is the ONLY script permitted to hold the service-role key. The harness
 * itself must never construct an admin client — see scripts/test-rls.ts.
 *
 * Usage:
 *   npx tsx scripts/seed-harness-tenant.ts            # print the plan, write nothing
 *   npx tsx scripts/seed-harness-tenant.ts --apply    # execute it
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'

import {
  MCPRIME_ORG_ID, HARNESS_ORG_ID, HARNESS_ORG_NAME, DECOY_ORG_ID, DECOY_ORG_NAME,
  COMPANY_1_ID, COMPANY_2_ID, PROJECT_1_ID, PROJECT_2_ID, PROJECT_3_ID,
  PERSONA_LIST, PERSONAS, type PersonaKey,
  MANIFEST_PATH, type Manifest,
  loadEnv, requireEnv, assertEnvLocalIgnored,
} from './harness-constants'

const APPLY = process.argv.includes('--apply')

// Fixed ids for the roster rows. Local to the seed — the harness never needs
// a member id, only company/project ids and the personas' credentials.
const OM_OWNER_ID   = '0f0f0f0f-0004-4000-8000-000000000001'
const OM_CREW_ID    = '0f0f0f0f-0004-4000-8000-000000000002'
const OM_REVOKED_ID = '0f0f0f0f-0004-4000-8000-000000000003'
const CM_C1OWN_ID   = '0f0f0f0f-0003-4000-8000-000000000001'
const CM_C1MATE_ID  = '0f0f0f0f-0003-4000-8000-000000000002'
const CM_C2OWN_ID   = '0f0f0f0f-0003-4000-8000-000000000003'

const now = new Date()
const at = (msAgo: number) => new Date(now.getTime() - msAgo).toISOString()
const DAY = 86_400_000

/**
 * The teammate's history cutoff. NOT now(): every row this script writes is
 * created at or before now, so a cutoff of now() would put ALL seeded messages
 * on the hidden side and assertion 5 could never tell enforcement apart from a
 * teammate who simply cannot read the table at all. Two days back puts four
 * messages either side of the line.
 */
const HISTORY_CUTOFF = at(2 * DAY)

type Row = Record<string, unknown>

// ── plan recording ──────────────────────────────────────────────────────────

const plan: string[] = []
function record(sql: string) { plan.push(sql) }

function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (Array.isArray(v)) return `array[${v.map(sqlLiteral).join(', ')}]`
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`
  return `'${String(v).replace(/'/g, "''")}'`
}

function recordUpsert(table: string, rows: Row[], conflict: string) {
  for (const r of rows) {
    const cols = Object.keys(r)
    record(
      `insert into public.${table} (${cols.join(', ')})\n` +
      `  values (${cols.map((c) => sqlLiteral(r[c])).join(', ')})\n` +
      `  on conflict (${conflict}) do update set ` +
      cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ') + ';',
    )
  }
}

// ── the guard that makes this safe ──────────────────────────────────────────

/**
 * Structural refusal to write outside the harness tenant. Called on every
 * payload before it reaches the database, so a forgotten organization_id is an
 * abort rather than a silent write into tenant zero.
 */
function assertHarnessOnly(table: string, rows: Row[]) {
  for (const r of rows) {
    const org = r.organization_id
    if (org !== HARNESS_ORG_ID) {
      throw new Error(
        `REFUSING to write ${table}: row organization_id is ${String(org)}, expected the harness org ` +
        `${HARNESS_ORG_ID}. Every seeded row must be explicitly stamped — relying on the column ` +
        `default puts it in McPrime's tenant.`,
      )
    }
  }
}

async function seedRows(admin: SupabaseClient, table: string, rows: Row[], conflict = 'id') {
  assertHarnessOnly(table, rows)
  recordUpsert(table, rows, conflict)
  if (!APPLY) return
  const { error } = await admin.from(table).upsert(rows, { onConflict: conflict })
  if (error) throw new Error(`${table}: ${error.message}`)
  console.log(`  ✓ ${table.padEnd(28)} ${rows.length} row(s)`)
}

// ── auth users ──────────────────────────────────────────────────────────────

async function findUserByEmail(admin: SupabaseClient, email: string) {
  // The project has ~13 users; a bounded scan is cheaper and clearer than
  // maintaining a lookup table. Raise the page cap if that stops being true.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(`listUsers: ${error.message}`)
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (hit) return hit
    if (data.users.length < 200) return null
  }
  return null
}

const newPassword = () => randomBytes(24).toString('base64url')

async function upsertPersona(
  admin: SupabaseClient,
  key: PersonaKey,
  password: string,
  clientId: string | null,
): Promise<string> {
  const p = PERSONAS[key]
  const app_metadata: Record<string, unknown> = {
    role: p.role,
    organization_id: HARNESS_ORG_ID,
    ...(clientId ? { client_id: clientId } : {}),
  }

  record(
    `-- auth.users: ${p.email}  (role=${p.role}, organization_id=${HARNESS_ORG_ID}` +
    `${clientId ? `, client_id=${clientId}` : ''})\n` +
    `--   created via auth.admin.createUser / updateUserById, email_confirm: true`,
  )
  if (!APPLY) return '00000000-0000-0000-0000-000000000000'

  const existing = await findUserByEmail(admin, p.email)
  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password, app_metadata, email_confirm: true,
    })
    if (error) throw new Error(`updateUser ${p.email}: ${error.message}`)
    console.log(`  ✓ auth user (rotated)        ${p.email}`)
    return existing.id
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: p.email, password, email_confirm: true, app_metadata,
  })
  if (error || !data.user) throw new Error(`createUser ${p.email}: ${error?.message}`)
  console.log(`  ✓ auth user (created)        ${p.email}`)
  return data.user.id
}

// ── credentials ─────────────────────────────────────────────────────────────

function writeHarnessPasswords(passwords: Record<string, string>) {
  const file = path.join(process.cwd(), '.env.local')
  let text = readFileSync(file, 'utf8')
  const append: string[] = []

  for (const [k, v] of Object.entries(passwords)) {
    const re = new RegExp(`^${k}=.*$`, 'm')
    if (re.test(text)) text = text.replace(re, `${k}=${v}`)
    else append.push(`${k}=${v}`)
  }

  if (append.length) {
    text = text.replace(/\s*$/, '\n')
    text += `\n# RLS harness personas — generated by scripts/seed-harness-tenant.ts\n`
    text += `# Live credentials for accounts in the ZZ-HARNESS organization. Never commit.\n`
    text += append.join('\n') + '\n'
  }
  writeFileSync(file, text, { mode: 0o600 })
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  // Widened deliberately: as literal types these never overlap and tsc rejects
  // the comparison, but the guard must survive someone editing a constant.
  if ((HARNESS_ORG_ID as string) === (MCPRIME_ORG_ID as string)) {
    throw new Error('harness org id collides with tenant zero')
  }

  assertEnvLocalIgnored()
  const env = loadEnv()
  const url = requireEnv(env, 'NEXT_PUBLIC_SUPABASE_URL')
  const serviceKey = requireEnv(env, 'SUPABASE_SERVICE_ROLE_KEY')

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  console.log(APPLY ? '\n▶ APPLYING harness seed\n' : '\n▶ DRY RUN — nothing will be written. Re-run with --apply to execute.\n')

  // 1 · tenants
  record(`-- ═══ tenants ═══`)
  const orgs = [
    { id: HARNESS_ORG_ID, name: HARNESS_ORG_NAME, type: 'client_serving', region: 'us-east', plan: 'agency' },
    { id: DECOY_ORG_ID, name: DECOY_ORG_NAME, type: 'client_serving', region: 'us-east', plan: 'agency' },
  ]
  recordUpsert('organizations', orgs, 'id')
  if (APPLY) {
    const { error } = await admin.from('organizations').upsert(orgs, { onConflict: 'id' })
    if (error) throw new Error(`organizations: ${error.message}`)
    console.log(`  ✓ organizations              2 row(s)`)
  }

  record(`\n-- ═══ tenant settings ═══`)
  await seedRows(admin, 'business_settings', [{
    organization_id: HARNESS_ORG_ID,
    business_name: 'ZZ-HARNESS Studio',
    business_email: 'billing@rls-harness.example.com',
    bank_name: 'HARNESS BANK — synthetic',
    account_name: 'ZZ-HARNESS Studio',
    account_number: '0000000000',
  }], 'organization_id')

  // 2 · client companies
  record(`\n-- ═══ client companies ═══`)
  const companies = [
    { id: COMPANY_1_ID, organization_id: HARNESS_ORG_ID, name: 'ZZ-HARNESS Company One',
      email: 'company-one@rls-harness.example.com', company: 'ZZ-HARNESS Company One',
      is_active: true, invite_policy: 'open' },
    { id: COMPANY_2_ID, organization_id: HARNESS_ORG_ID, name: 'ZZ-HARNESS Company Two',
      email: 'company-two@rls-harness.example.com', company: 'ZZ-HARNESS Company Two',
      is_active: true, invite_policy: 'open' },
  ]
  await seedRows(admin, 'clients', companies)

  // 3 · auth users
  record(`\n-- ═══ auth users ═══`)
  const passwords: Record<string, string> = {}
  const userIds = {} as Record<PersonaKey, string>
  const clientOf: Record<PersonaKey, string | null> = {
    owner: null, crew: null, revoked: null,
    c1own: COMPANY_1_ID, c1mate: COMPANY_1_ID, c2own: COMPANY_2_ID,
  }
  for (const p of PERSONA_LIST) {
    const pw = newPassword()
    passwords[p.envKey] = pw
    userIds[p.key] = await upsertPersona(admin, p.key, pw, clientOf[p.key])
  }

  // 4 · projects
  //
  // (A "primary logins" step wrote clients.user_id here. The column is retired
  // by 0026 — client_members is the sole authority (S1 §5.2) — and the personas
  // that step named already get explicit owner rows in the client rosters
  // below, so nothing the harness asserts depended on it.)
  record(`\n-- ═══ projects ═══`)
  await seedRows(admin, 'projects', [
    { id: PROJECT_1_ID, organization_id: HARNESS_ORG_ID, client_id: COMPANY_1_ID,
      title: 'ZZ-HARNESS Project One', type: 'Film', status: 'Active', progress: 40 },
    { id: PROJECT_2_ID, organization_id: HARNESS_ORG_ID, client_id: COMPANY_1_ID,
      title: 'ZZ-HARNESS Project Two', type: 'Film', status: 'Active', progress: 10 },
    { id: PROJECT_3_ID, organization_id: HARNESS_ORG_ID, client_id: COMPANY_2_ID,
      title: 'ZZ-HARNESS Project Three', type: 'Film', status: 'Active', progress: 60 },
  ])

  // 5 · rosters
  record(`\n-- ═══ crew roster ═══`)
  await seedRows(admin, 'organization_members', [
    { id: OM_OWNER_ID, organization_id: HARNESS_ORG_ID, user_id: userIds.owner,
      name: 'Harness Owner', email: PERSONAS.owner.email, role: 'owner', status: 'active',
      scope_mode: 'all', accepted_at: at(0) },
    { id: OM_CREW_ID, organization_id: HARNESS_ORG_ID, user_id: userIds.crew,
      name: 'Harness Crew', email: PERSONAS.crew.email, role: 'member', status: 'active',
      scope_mode: 'selected', accepted_at: at(0) },
    { id: OM_REVOKED_ID, organization_id: HARNESS_ORG_ID, user_id: userIds.revoked,
      name: 'Harness Revoked', email: PERSONAS.revoked.email, role: 'member', status: 'revoked',
      scope_mode: 'all' },
  ])

  record(`\n-- ═══ client rosters ═══`)
  await seedRows(admin, 'client_members', [
    { id: CM_C1OWN_ID, client_id: COMPANY_1_ID, organization_id: HARNESS_ORG_ID, user_id: userIds.c1own,
      name: 'Harness C1 Owner', email: PERSONAS.c1own.email, role: 'owner', status: 'active',
      scope_mode: 'all', accepted_at: at(0) },
    { id: CM_C1MATE_ID, client_id: COMPANY_1_ID, organization_id: HARNESS_ORG_ID, user_id: userIds.c1mate,
      name: 'Harness C1 Teammate', email: PERSONAS.c1mate.email, role: 'member', status: 'active',
      scope_mode: 'selected', history_from: HISTORY_CUTOFF, accepted_at: at(0) },
    { id: CM_C2OWN_ID, client_id: COMPANY_2_ID, organization_id: HARNESS_ORG_ID, user_id: userIds.c2own,
      name: 'Harness C2 Owner', email: PERSONAS.c2own.email, role: 'owner', status: 'active',
      scope_mode: 'all', accepted_at: at(0) },
  ])

  record(`\n-- ═══ project scoping ═══`)
  await seedRows(admin, 'organization_member_projects',
    [{ member_id: OM_CREW_ID, project_id: PROJECT_1_ID, organization_id: HARNESS_ORG_ID }],
    'member_id,project_id')
  await seedRows(admin, 'client_member_projects',
    [{ member_id: CM_C1MATE_ID, project_id: PROJECT_1_ID, organization_id: HARNESS_ORG_ID }],
    'member_id,project_id')

  // 6 · work rows
  // Rooms are GET-OR-CREATE rather than fixed-id upserts, deliberately: the
  // 0029 backfill already created the live rooms with generated ids, and
  // 0027's one-live-room-per-company index would (correctly) reject a second.
  // The seed honors the invariant instead of fighting it.
  record(`\n-- ═══ message_rooms (get-or-create; 0029 may already own the live row) ═══`)
  async function ensureRoom(clientId: string): Promise<string> {
    const { data: hit, error: selErr } = await admin
      .from('message_rooms').select('id')
      .eq('organization_id', HARNESS_ORG_ID).eq('kind', 'client')
      .eq('client_id', clientId).is('deleted_at', null).maybeSingle()
    if (selErr) throw new Error(`message_rooms: ${selErr.message}`)
    if (hit) { console.log(`  ✓ message_rooms              live room for …${clientId.slice(-4)}`); return hit.id as string }
    if (!APPLY) { console.log(`  · message_rooms              would create room for …${clientId.slice(-4)}`); return `<room:${clientId}>` }
    const { data: made, error: insErr } = await admin
      .from('message_rooms')
      .insert({ organization_id: HARNESS_ORG_ID, kind: 'client', client_id: clientId })
      .select('id').single()
    if (insErr) throw new Error(`message_rooms: ${insErr.message}`)
    console.log(`  ✓ message_rooms              created room for …${clientId.slice(-4)}`)
    return made.id as string
  }
  const roomC1 = await ensureRoom(COMPANY_1_ID)
  const roomC2 = await ensureRoom(COMPANY_2_ID)

  record(`\n-- ═══ messages (2 either side of the history cutoff ${HISTORY_CUTOFF}) ═══`)
  const projects = [
    { id: PROJECT_1_ID, n: 1, room: roomC1 }, { id: PROJECT_2_ID, n: 2, room: roomC1 },
    { id: PROJECT_3_ID, n: 3, room: roomC2 },
  ]
  // sender_id, not sender_role (Batch 21 item 3; migration 12 drops the
  // column): the sender's side derives from the roster, so the seeds must
  // carry the real harness user ids — which also repairs the 14 null-sender
  // rows earlier seeds left (re-running upserts these same fixed ids).
  const messageRows: Row[] = [
    ...projects.flatMap((p, i) => [
      { id: `0f0f0f0f-0005-4000-8000-00000000${i}001`, organization_id: HARNESS_ORG_ID, project_id: p.id, room_id: p.room,
        sender_id: userIds.owner, sender_name: 'Harness Owner', body: `P${p.n} · before cutoff · 7d`, created_at: at(7 * DAY) },
      { id: `0f0f0f0f-0005-4000-8000-00000000${i}002`, organization_id: HARNESS_ORG_ID, project_id: p.id, room_id: p.room,
        sender_id: userIds.c1own, sender_name: 'Harness C1 Owner', body: `P${p.n} · before cutoff · 5d`, created_at: at(5 * DAY) },
      { id: `0f0f0f0f-0005-4000-8000-00000000${i}003`, organization_id: HARNESS_ORG_ID, project_id: p.id, room_id: p.room,
        sender_id: userIds.owner, sender_name: 'Harness Owner', body: `P${p.n} · after cutoff · 1d`, created_at: at(1 * DAY) },
      { id: `0f0f0f0f-0005-4000-8000-00000000${i}004`, organization_id: HARNESS_ORG_ID, project_id: p.id, room_id: p.room,
        sender_id: userIds.c1own, sender_name: 'Harness C1 Owner', body: `P${p.n} · after cutoff · 2h`, created_at: at(2 * 3_600_000) },
    ]),
    // Untagged (room-level) messages — the shape the company-room model
    // introduced. One either side of the cutoff so assertions 12 and 14 can
    // tell enforcement from a persona that reads nothing.
    { id: '0f0f0f0f-0005-4000-8000-000000000101', organization_id: HARNESS_ORG_ID, project_id: null, room_id: roomC1,
      sender_id: userIds.owner, sender_name: 'Harness Owner', body: 'ROOM · untagged · before cutoff · 5d', created_at: at(5 * DAY) },
    { id: '0f0f0f0f-0005-4000-8000-000000000102', organization_id: HARNESS_ORG_ID, project_id: null, room_id: roomC1,
      sender_id: userIds.owner, sender_name: 'Harness Owner', body: 'ROOM · untagged · after cutoff · 2h', created_at: at(2 * 3_600_000) },
  ]
  await seedRows(admin, 'messages', messageRows)

  // Watermark rows for assertion 15 (S3-core §7.8). Written directly rather
  // than through seedRows: message_read_state has no organization_id column
  // for assertHarnessOnly to check — its tenancy is inherited through the
  // room FK, and both rows key to the harness room + harness persona ids.
  record(`\n-- ═══ message_read_state (assertion 15: the watermark is private) ═══`)
  if (APPLY) {
    const { error: wmErr } = await admin.from('message_read_state').upsert([
      { room_id: roomC1, user_id: userIds.c1own,
        last_read_message_id: '0f0f0f0f-0005-4000-8000-000000000003', last_read_at: at(1 * DAY) },
      { room_id: roomC1, user_id: userIds.c1mate,
        last_read_message_id: '0f0f0f0f-0005-4000-8000-000000000004', last_read_at: at(2 * 3_600_000) },
    ], { onConflict: 'room_id,user_id' })
    if (wmErr) throw new Error(`message_read_state: ${wmErr.message}`)
    console.log(`  ✓ ${'message_read_state'.padEnd(28)} 2 row(s)`)
  }

  record(`\n-- ═══ tasks (visible_to_client so the client policy can match) ═══`)
  await seedRows(admin, 'tasks', projects.flatMap((p, i) => [
    { id: `0f0f0f0f-0006-4000-8000-00000000${i}001`, organization_id: HARNESS_ORG_ID, project_id: p.id,
      title: `P${p.n} · harness task A`, status: 'pending', priority: 'medium', category: 'deliverable', visible_to_client: true },
    { id: `0f0f0f0f-0006-4000-8000-00000000${i}002`, organization_id: HARNESS_ORG_ID, project_id: p.id,
      title: `P${p.n} · harness task B`, status: 'in_progress', priority: 'high', category: 'deliverable', visible_to_client: true },
  ]))

  record(`\n-- ═══ files ═══`)
  await seedRows(admin, 'files', projects.map((p, i) => ({
    id: `0f0f0f0f-0007-4000-8000-00000000${i}001`, organization_id: HARNESS_ORG_ID,
    project_id: p.id, client_id: p.n === 3 ? COMPANY_2_ID : COMPANY_1_ID,
    file_name: `harness-p${p.n}.txt`, file_path: `harness/p${p.n}/synthetic.txt`,
    file_size: 12, file_type: 'text/plain', mime_type: 'text/plain',
    bucket: 'r2', direction: 'delivery', uploaded_by_role: 'admin', uploaded_by_name: 'Harness Owner',
  })))

  record(`\n-- ═══ activity_log ═══`)
  await seedRows(admin, 'activity_log', projects.flatMap((p, i) => [
    { id: `0f0f0f0f-0008-4000-8000-00000000${i}001`, organization_id: HARNESS_ORG_ID, project_id: p.id,
      client_id: p.n === 3 ? COMPANY_2_ID : COMPANY_1_ID, actor_name: 'Harness Owner', actor_role: 'admin',
      event_type: 'harness.seed', title: `P${p.n} · harness activity A`, created_at: at(6 * DAY) },
    { id: `0f0f0f0f-0008-4000-8000-00000000${i}002`, organization_id: HARNESS_ORG_ID, project_id: p.id,
      client_id: p.n === 3 ? COMPANY_2_ID : COMPANY_1_ID, actor_name: 'Harness Owner', actor_role: 'admin',
      event_type: 'harness.seed', title: `P${p.n} · harness activity B`, created_at: at(1 * DAY) },
  ]))

  record(`\n-- ═══ invoices + notifications ═══`)
  await seedRows(admin, 'invoices', [
    { id: '0f0f0f0f-0009-4000-8000-000000000001', organization_id: HARNESS_ORG_ID, client_id: COMPANY_1_ID,
      project_id: PROJECT_1_ID, title: 'ZZ-HARNESS invoice C1', amount: 100, status: 'unpaid', invoice_number: 'ZZH-0001' },
    { id: '0f0f0f0f-0009-4000-8000-000000000002', organization_id: HARNESS_ORG_ID, client_id: COMPANY_2_ID,
      project_id: PROJECT_3_ID, title: 'ZZ-HARNESS invoice C2', amount: 200, status: 'unpaid', invoice_number: 'ZZH-0002' },
  ])
  await seedRows(admin, 'notifications', [
    { id: '0f0f0f0f-000a-4000-8000-000000000001', organization_id: HARNESS_ORG_ID, client_id: COMPANY_1_ID,
      project_id: PROJECT_1_ID, type: 'harness.seed', title: 'ZZ-HARNESS notification C1' },
    { id: '0f0f0f0f-000a-4000-8000-000000000002', organization_id: HARNESS_ORG_ID, client_id: COMPANY_2_ID,
      project_id: PROJECT_3_ID, type: 'harness.seed', title: 'ZZ-HARNESS notification C2' },
  ])

  // ── output ────────────────────────────────────────────────────────────────
  if (!APPLY) {
    console.log(plan.join('\n'))
    console.log(`\n▶ DRY RUN complete — ${plan.length} statement group(s). Nothing was written.`)
    console.log('  Re-run with --apply to execute.\n')
    return
  }

  const manifest: Manifest = { seededAt: now.toISOString(), historyCutoff: HISTORY_CUTOFF, userIds }
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n')
  writeHarnessPasswords(passwords)

  console.log('\n── PERSONA CREDENTIALS ─────────────────────────────────────────')
  console.log('   Written to .env.local (gitignored). Printed once — not stored anywhere else.\n')
  for (const p of PERSONA_LIST) {
    console.log(`   ${p.email.padEnd(42)} ${passwords[p.envKey]}`)
  }
  console.log(`\n   Manifest: ${path.relative(process.cwd(), MANIFEST_PATH)}`)
  console.log('\n✅ Seed complete. Run the harness:  npm run test:rls\n')
}

if (!existsSync(path.join(process.cwd(), 'package.json'))) {
  console.error('Run from the repository root.')
  process.exit(1)
}

main().catch((e) => { console.error(`\n✖ ${e instanceof Error ? e.message : String(e)}\n`); process.exit(1) })
