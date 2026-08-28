/**
 * scripts/provision-tenant.ts — Batch 7 item 5, step 1.
 *
 * Onboards a new tenant: an organization, its per-tenant settings row, its
 * budget row, and its first owner — an active `organization_members` row plus
 * the claims that route them into the studio.
 *
 * WHY THIS EXISTS. Nothing in the application creates an organization. There is
 * no signup surface (deliberately — a signup flow is a product decision outside
 * the v1 cap, S-V §13), and the only `organization_members` insert in the
 * codebase is the invitee row in `app/api/admin/team/route.ts`, which requires
 * a caller who is already an org admin. So a second tenant had exactly one way
 * to exist: someone stamped an `app_metadata` claim by hand and relied on
 * `orgRolesOf()` inferring `['owner']` from an empty roster. That inference is
 * what Batch 7 item 5 step 3 deletes, and this script is its replacement.
 *
 * That inference was also a trap. The count it read had no status filter, so
 * the moment the bootstrap owner invited their first crew member the roster
 * stopped being empty and their own resolution flipped `['owner']` → `['member']`
 * — locking them out of their own org's team management with no way back except
 * direct SQL. A real roster row cannot do that.
 *
 * ORDER IS THE POINT, and it is the same order the invite route now uses:
 *
 *     organization  →  roster row (status='active')  →  claims
 *
 * Claims last, always. A claim without a roster row is the state that used to
 * grant silent member-level access; after step 3 it grants nothing, so a
 * failure between the last two steps leaves a person who cannot log in rather
 * than one who can log in as something nobody granted.
 *
 * TRANSACTIONALITY. PostgREST has no multi-statement transaction, so this is
 * not one BEGIN/COMMIT. It is the next best thing and says so plainly: every
 * step is ordered so that a failure leaves a strictly safe partial state, and
 * anything this run created before the failure is rolled back explicitly (see
 * `undo`). Re-running after a failure is safe — every write is keyed and
 * idempotent.
 *
 * SAFETY MODEL (the harness precedent, scripts/seed-harness-tenant.ts):
 *   1. Dry-run by default. Writes only with --apply. The plan it prints is the
 *      exact set of statements it would execute.
 *   2. Refuses an organization id that already exists, and refuses the McPrime
 *      sentinel outright.
 *   3. Refuses an owner who already holds a crew roster row anywhere —
 *      `organization_members.user_id` is UNIQUE (T-1, 0012:17), so a person is
 *      crew at one studio and the insert would fail after the org existed.
 *   4. Every row carries an explicit organization_id. Relying on the column
 *      DEFAULT (0001:40-50) would land the tenant inside McPrime (T-5).
 *
 * Usage:
 *   npx tsx scripts/provision-tenant.ts --name "Second Studio" \
 *     --owner-email owner@secondstudio.com --owner-name "Jane Doe"
 *   # …prints the plan and a generated org id, writes nothing.
 *
 *   npx tsx scripts/provision-tenant.ts --name "Second Studio" \
 *     --owner-email owner@secondstudio.com --owner-name "Jane Doe" --apply
 *
 * Options:
 *   --org-id <uuid>    reuse a chosen id instead of generating one
 *   --type <t>         client_serving (default) | internal | solo   (S1 §4)
 *   --region <r>       default us-east                              (AD-002-R)
 *   --plan <p>         default agency
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomBytes, randomUUID } from 'node:crypto'

import { MCPRIME_ORG_ID, loadEnv, requireEnv } from './harness-constants'

const APPLY = process.argv.includes('--apply')

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

const ORG_TYPES = ['client_serving', 'internal', 'solo'] as const

type Row = Record<string, unknown>

// ── plan recording ──────────────────────────────────────────────────────────

const plan: string[] = []
const record = (sql: string) => plan.push(sql)

function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  // organization_members.roles is text[] (0015:11), not jsonb — the printed
  // plan has to be runnable, not merely indicative.
  if (Array.isArray(v)) return `array[${v.map(sqlLiteral).join(', ')}]::text[]`
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`
  return `'${String(v).replace(/'/g, "''")}'`
}

function recordInsert(table: string, row: Row, conflict: string) {
  const cols = Object.keys(row)
  record(
    `insert into public.${table} (${cols.join(', ')})\n` +
    `  values (${cols.map((c) => sqlLiteral(row[c])).join(', ')})\n` +
    `  on conflict (${conflict}) do nothing;`,
  )
}

// ── the guard that makes this safe ──────────────────────────────────────────

/**
 * Structural refusal to write outside the tenant being provisioned. Called on
 * every payload before it reaches the database, so a forgotten organization_id
 * is an abort rather than a silent write into tenant zero (T-5).
 */
function assertStamped(table: string, row: Row, orgId: string) {
  const org = table === 'organizations' ? row.id : row.organization_id
  if (org !== orgId) {
    throw new Error(
      `REFUSING to write ${table}: row org is ${String(org)}, expected ${orgId}. ` +
      `Every row must be explicitly stamped — the column default puts it in McPrime's tenant.`,
    )
  }
}

async function insertRow(admin: SupabaseClient, table: string, row: Row, orgId: string, conflict: string) {
  assertStamped(table, row, orgId)
  recordInsert(table, row, conflict)
  if (!APPLY) return
  const { error } = await admin.from(table).upsert(row, { onConflict: conflict, ignoreDuplicates: true })
  if (error) throw new Error(`${table}: ${error.message}`)
  console.log(`  ✓ ${table.padEnd(24)} 1 row`)
}

// ── auth ────────────────────────────────────────────────────────────────────

async function findUserByEmail(admin: SupabaseClient, email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(`listUsers: ${error.message}`)
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (hit) return hit
    if (data.users.length < 200) return null
  }
  return null
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  const name = arg('name')
  const ownerEmail = arg('owner-email')?.trim().toLowerCase()
  const ownerName = arg('owner-name')
  const orgId = arg('org-id') ?? randomUUID()
  const type = arg('type') ?? 'client_serving'
  const region = arg('region') ?? 'us-east'
  const orgPlan = arg('plan') ?? 'agency'

  if (!name || !ownerEmail || !ownerName) {
    throw new Error(
      'Required: --name "<studio name>" --owner-email <email> --owner-name "<person>"\n' +
      'Optional: --org-id <uuid> --type <client_serving|internal|solo> --region <r> --plan <p> --apply',
    )
  }
  if (!ORG_TYPES.includes(type as (typeof ORG_TYPES)[number])) {
    throw new Error(`--type must be one of ${ORG_TYPES.join(' | ')} (S1 §4)`)
  }
  if (orgId === MCPRIME_ORG_ID) {
    throw new Error('REFUSING: that is the McPrime sentinel org. This script provisions NEW tenants only.')
  }

  const env = loadEnv()
  const admin = createClient(
    requireEnv(env, 'NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv(env, 'SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  console.log(
    APPLY
      ? `\n▶ PROVISIONING tenant "${name}"\n`
      : `\n▶ DRY RUN — nothing will be written. Re-run with --apply to execute.\n`,
  )

  // ── guard 1: the org must not already exist ───────────────────────────────
  const { data: existingOrg, error: orgReadErr } = await admin
    .from('organizations').select('id, name').eq('id', orgId).maybeSingle()
  if (orgReadErr) throw new Error(`organizations read: ${orgReadErr.message}`)
  if (existingOrg) {
    throw new Error(
      `REFUSING: organization ${orgId} already exists ("${existingOrg.name}"). ` +
      `This script provisions a NEW tenant; it will not write into an existing one.`,
    )
  }

  // ── guard 2: the owner must not already be crew somewhere ─────────────────
  // organization_members.user_id is UNIQUE (T-1, 0012:17). Catching this here
  // means the refusal happens before the organization row exists, rather than
  // as a constraint violation with a half-provisioned tenant behind it.
  const existingUser = await findUserByEmail(admin, ownerEmail)
  if (existingUser) {
    const { data: crew, error: crewErr } = await admin
      .from('organization_members')
      .select('organization_id, role, status')
      .eq('user_id', existingUser.id)
      .maybeSingle()
    if (crewErr) throw new Error(`organization_members read: ${crewErr.message}`)
    if (crew) {
      throw new Error(
        `REFUSING: ${ownerEmail} is already crew in organization ${crew.organization_id} ` +
        `(${crew.role}/${crew.status}). organization_members.user_id is UNIQUE — a person is crew ` +
        `at one studio in v1 (T-1, S1 §2). Use a different address, or land the multi-org migration first.`,
      )
    }
    console.log(`  · auth user for ${ownerEmail} already exists — it will be reused and re-claimed.`)
  }

  // Anything this run creates, so a later failure can be undone. Only ever
  // holds rows THIS run wrote — a reused auth user is never deleted.
  const undo: Array<{ what: string; run: () => Promise<void> }> = []
  const rollback = async () => {
    if (!APPLY || undo.length === 0) return
    console.error('\n✗ Failed. Rolling back what this run created:')
    for (const step of undo.reverse()) {
      try { await step.run(); console.error(`  ↩ ${step.what}`) }
      catch (e) { console.error(`  ! could not undo ${step.what}: ${(e as Error).message}`) }
    }
  }

  try {
    // ── 1 · the organization ────────────────────────────────────────────────
    record(`-- ═══ 1 · organization ═══`)
    await insertRow(admin, 'organizations',
      { id: orgId, name, type, region, plan: orgPlan }, orgId, 'id')
    if (APPLY) {
      undo.push({
        what: `organizations ${orgId}`,
        run: async () => { await admin.from('organizations').delete().eq('id', orgId) },
      })
    }

    // ── 2 · per-tenant settings and budget ──────────────────────────────────
    // business_settings is per-tenant since 0018 (T-3) and holds this studio's
    // own name and bank details. Seeded with the name so no surface has to fall
    // back to a hardcoded "McPrime Digital" (P-1).
    record(`\n-- ═══ 2 · tenant settings + budget ═══`)
    await insertRow(admin, 'business_settings',
      { organization_id: orgId, business_name: name, business_email: ownerEmail },
      orgId, 'organization_id')

    // hard_stop is STATED, not inherited. 0024 makes true the column default
    // and lib/credits.ts treats a missing row as gated — but an explicit row
    // means the tenant's money gate is visible in the table rather than implied
    // by two defaults agreeing.
    await insertRow(admin, 'org_budgets',
      { organization_id: orgId, hard_stop: true }, orgId, 'organization_id')

    // ── 3 · the owner's auth account ────────────────────────────────────────
    record(`\n-- ═══ 3 · owner auth account ═══`)
    record(
      `-- auth.users: ${ownerEmail}\n` +
      `--   created via auth.admin.createUser (email_confirm: true), no claims yet`,
    )
    let ownerId = existingUser?.id ?? '00000000-0000-0000-0000-000000000000'
    let generatedPassword: string | null = null
    if (APPLY && !existingUser) {
      generatedPassword = randomBytes(24).toString('base64url')
      const { data, error } = await admin.auth.admin.createUser({
        email: ownerEmail,
        password: generatedPassword,
        email_confirm: true,
        user_metadata: { name: ownerName },
      })
      if (error || !data.user) throw new Error(`createUser ${ownerEmail}: ${error?.message}`)
      ownerId = data.user.id
      undo.push({
        what: `auth user ${ownerEmail}`,
        run: async () => { await admin.auth.admin.deleteUser(ownerId) },
      })
      console.log(`  ✓ auth user              ${ownerEmail}`)
    }

    // ── 4 · THE ROSTER ROW — before any claim ───────────────────────────────
    // This is the row whose absence the old bootstrap was papering over. It is
    // written before the claims so that a failure here leaves an account with
    // no crew claim (harmless) rather than a claim with no row (which used to
    // mean silent member access, and after step 3 means a dead login).
    record(`\n-- ═══ 4 · owner roster row (BEFORE claims) ═══`)
    await insertRow(admin, 'organization_members', {
      organization_id: orgId,
      user_id: APPLY ? ownerId : '<owner-user-id>',
      name: ownerName,
      email: ownerEmail,
      role: 'owner',
      roles: [],
      status: 'active',
      scope_mode: 'all',
      accepted_at: new Date().toISOString(),
    }, orgId, 'user_id')
    if (APPLY) {
      undo.push({
        what: `organization_members for ${ownerEmail}`,
        run: async () => { await admin.from('organization_members').delete().eq('user_id', ownerId) },
      })
    }

    // ── 5 · claims, last ────────────────────────────────────────────────────
    // role: 'admin' opens the studio; the roster row above decides what they
    // may actually do there (lib/team.ts — the table is truth, the JWT routes).
    record(`\n-- ═══ 5 · claims (LAST) ═══`)
    record(
      `-- auth.admin.updateUserById(<owner>, { app_metadata: {\n` +
      `--     role: 'admin', organization_id: '${orgId}', org_role: 'owner' } })`,
    )
    if (APPLY) {
      const { error } = await admin.auth.admin.updateUserById(ownerId, {
        app_metadata: { role: 'admin', organization_id: orgId, org_role: 'owner' },
      })
      if (error) throw new Error(`claims for ${ownerEmail}: ${error.message}`)
      console.log(`  ✓ claims                 role=admin org=${orgId}`)
    }

    // ── report ──────────────────────────────────────────────────────────────
    console.log('\n─── plan ───────────────────────────────────────────────────')
    console.log(plan.join('\n'))
    console.log('────────────────────────────────────────────────────────────\n')

    if (!APPLY) {
      console.log(`Would create organization ${orgId} ("${name}", type=${type}, region=${region}, plan=${orgPlan})`)
      console.log(`Would make ${ownerEmail} its active owner.`)
      console.log(`\nRe-run with --apply to execute.\n`)
      return
    }

    console.log('Created:')
    console.log(`  organization   ${orgId}  "${name}"  type=${type} region=${region} plan=${orgPlan}`)
    console.log(`  settings       business_settings row (business_name = "${name}")`)
    console.log(`  budget         org_budgets row, hard_stop = true`)
    console.log(`  owner          ${ownerName} <${ownerEmail}>  role=owner status=active`)
    console.log(`  claims         role=admin, organization_id=${orgId}, org_role=owner`)
    if (generatedPassword) {
      console.log(`\n  ONE-TIME PASSWORD for ${ownerEmail}:  ${generatedPassword}`)
      console.log(`  Shown once, stored nowhere. Have them sign in and change it immediately.`)
    } else {
      console.log(`\n  Existing auth account reused — its password is unchanged.`)
    }
    console.log(`\nVerify: sign in as ${ownerEmail} and open /studio. The sidebar must read Owner,`)
    console.log(`and /studio/crew/settings must be reachable (owner-only). If it is not, the`)
    console.log(`roster row did not land — do not proceed to removing the ['member'] fallbacks.\n`)
  } catch (err) {
    await rollback()
    throw err
  }
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}\n`)
  process.exit(1)
})
