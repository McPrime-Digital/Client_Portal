/**
 * Shared identifiers for the RLS harness (S2 §6).
 *
 * The seed (scripts/seed-harness-tenant.ts) and the harness
 * (scripts/test-rls.ts) must agree on every id in this file. Duplicating the
 * literals across both scripts is exactly how a harness starts asserting
 * against rows that no longer exist and reports a vacuous PASS, so they live
 * in one place and neither script defines its own.
 *
 * Every public.* row the seed writes carries a FIXED uuid. That is what makes
 * the seed idempotent: each write is an upsert on a known primary key, so a
 * second run changes nothing. Auth user ids cannot be fixed — GoTrue's admin
 * createUser does not accept an id — so those are discovered at seed time and
 * recorded in the manifest.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

// ── tenants ─────────────────────────────────────────────────────────────────

/** Tenant zero. The harness reads across this boundary and must NEVER write to it. */
export const MCPRIME_ORG_ID = '00000000-0000-0000-0000-000000000001'

/** The permanent second tenant. Everything the seed creates belongs here. */
export const HARNESS_ORG_ID = '0f0f0f0f-0000-4000-8000-000000000001'
export const HARNESS_ORG_NAME = 'ZZ-HARNESS — do not delete'

/**
 * A third, empty organization that exists for exactly one purpose: assertion 7
 * needs a real FK target to prove `clients.organization_id` is writable by a
 * client session.
 *
 * Pointing that probe at McPrime's org id would mean that a PASSING attack —
 * the column being unprotected, which is the defect S2 §4 Class E describes —
 * moves a harness client company INTO tenant zero. The decoy absorbs that
 * write instead. Using a random non-existent uuid would not work: the FK would
 * reject it and the harness would report a false PASS.
 */
export const DECOY_ORG_ID = '0f0f0f0f-0000-4000-8000-0000000000de'
export const DECOY_ORG_NAME = 'ZZ-HARNESS-DECOY — do not delete'

// ── client companies + projects ─────────────────────────────────────────────

export const COMPANY_1_ID = '0f0f0f0f-0001-4000-8000-000000000001'
export const COMPANY_2_ID = '0f0f0f0f-0001-4000-8000-000000000002'

export const PROJECT_1_ID = '0f0f0f0f-0002-4000-8000-000000000001' // company 1
export const PROJECT_2_ID = '0f0f0f0f-0002-4000-8000-000000000002' // company 1
export const PROJECT_3_ID = '0f0f0f0f-0002-4000-8000-000000000003' // company 2

// ── personas ────────────────────────────────────────────────────────────────

/**
 * `.example.com` is reserved by RFC 2606 and can never route to a real
 * mailbox, so an accidental invite or nudge email is undeliverable by
 * construction rather than by convention.
 */
const DOMAIN = 'rls-harness.example.com'

export type PersonaKey =
  | 'owner' | 'crew' | 'revoked' | 'c1own' | 'c1mate' | 'c2own'

export interface Persona {
  key: PersonaKey
  email: string
  /** Key under which the generated password is stored in .env.local. */
  envKey: string
  /**
   * app_metadata.role. Crew-side personas carry 'admin' deliberately: ~40
   * existing policies gate on is_admin(), so a crew persona without it would
   * match no policy, read nothing, and every isolation assertion about them
   * would pass for the wrong reason.
   */
  role: 'admin' | 'client'
  label: string
}

export const PERSONAS: Record<PersonaKey, Persona> = {
  owner: {
    key: 'owner',
    email: `harness-owner@${DOMAIN}`,
    envKey: 'HARNESS_OWNER_PASSWORD',
    role: 'admin',
    label: 'studio B owner (org admin, scope_mode all)',
  },
  crew: {
    key: 'crew',
    email: `harness-crew@${DOMAIN}`,
    envKey: 'HARNESS_CREW_PASSWORD',
    role: 'admin',
    label: 'studio B crew (scope_mode selected → project 1 only)',
  },
  revoked: {
    key: 'revoked',
    email: `harness-revoked@${DOMAIN}`,
    envKey: 'HARNESS_REVOKED_PASSWORD',
    role: 'admin',
    label: 'studio B crew, status revoked',
  },
  c1own: {
    key: 'c1own',
    email: `harness-c1-own@${DOMAIN}`,
    envKey: 'HARNESS_C1_OWN_PASSWORD',
    role: 'client',
    label: 'company 1 owner (primary login, scope_mode all)',
  },
  c1mate: {
    key: 'c1mate',
    email: `harness-c1-mate@${DOMAIN}`,
    envKey: 'HARNESS_C1_MATE_PASSWORD',
    role: 'client',
    label: 'company 1 teammate (scope_mode selected → project 1, history_from set)',
  },
  c2own: {
    key: 'c2own',
    email: `harness-c2-own@${DOMAIN}`,
    envKey: 'HARNESS_C2_OWN_PASSWORD',
    role: 'client',
    label: 'company 2 owner',
  },
}

export const PERSONA_LIST: Persona[] = Object.values(PERSONAS)

// ── the tables every "reads zero from everywhere" assertion sweeps ──────────

export const WORK_TABLES = [
  'projects', 'files', 'messages', 'tasks', 'invoices',
  'activity_log', 'clients', 'notifications', 'project_phases',
] as const

export const MEMBERSHIP_TABLES = ['organization_members', 'client_members'] as const

export const ALL_TABLES = [...WORK_TABLES, ...MEMBERSHIP_TABLES] as const

// ── manifest ────────────────────────────────────────────────────────────────

/**
 * Written by the seed, read by the harness. It carries the auth user ids
 * (which cannot be fixed constants) and the history_from cutoff.
 *
 * This file is what keeps the service-role key OUT of the harness entirely:
 * without it the harness would need an admin client just to look up ids, and
 * a service-role client in the same process as an assertion is one typo away
 * from a test that bypasses RLS and passes while proving nothing.
 */
export const MANIFEST_PATH = path.join(process.cwd(), 'scripts', '.harness-manifest.json')

export interface Manifest {
  seededAt: string
  historyCutoff: string
  userIds: Record<PersonaKey, string>
}

export function readManifest(): Manifest {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(
      `No harness manifest at ${MANIFEST_PATH}.\nRun the seed first:  npx tsx scripts/seed-harness-tenant.ts`,
    )
  }
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest
}

// ── env ─────────────────────────────────────────────────────────────────────

/**
 * Minimal .env.local reader. Deliberately not `dotenv` — this is the only
 * place in the repo that needs it, and the dependency list already carries
 * four packages nothing imports (CLAUDE.md).
 */
export function loadEnv(): Record<string, string> {
  const file = path.join(process.cwd(), '.env.local')
  if (!existsSync(file)) throw new Error(`.env.local not found at ${file}`)

  const out: Record<string, string> = {}
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
  }
  return out
}

export function requireEnv(env: Record<string, string>, name: string): string {
  const v = env[name]
  if (!v) throw new Error(`Missing ${name} in .env.local`)
  return v
}

/**
 * Refuses to continue unless git will ignore .env.local. The seed writes six
 * live production passwords into that file; committing them would be the
 * single worst outcome of this batch.
 */
export function assertEnvLocalIgnored(): void {
  try {
    execFileSync('git', ['check-ignore', '-q', '.env.local'], { stdio: 'ignore' })
  } catch {
    throw new Error(
      '.env.local is NOT gitignored. Refusing to write credentials into a tracked file.\n' +
      'Add `.env*.local` to .gitignore and re-run.',
    )
  }
}
