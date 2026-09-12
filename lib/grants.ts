import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { recordActivity } from '@/lib/logActivity.server'
import { LEGACY_ORG_CAP, LEGACY_CLIENT_CAP, type OrgCap, type ClientCap } from '@/lib/capabilities'

/**
 * THE SINGLE WRITE PATH FOR CAPABILITY GRANTS — S-R §6, R-8, item 8.
 * The shape lib/approvals.ts and lib/rooms.ts established: one module owns the
 * write, so the invariants live in one place instead of in each caller.
 *
 * ── IT WRITES ON THE USER CLIENT, AND THAT IS THE WHOLE POINT ───────────────
 * `db` MUST be the caller's cookie-bound client. Migration 0054's triggers —
 * G-1 (you cannot grant what you do not hold), G-2 (platform.* and typos are
 * ungrantable), G-3 (no self-edit, no admin-touches-owner), G-4 (never zero
 * owners) — all read auth.uid(), and under the SERVICE ROLE auth.uid() is null
 * and they PASS THE WRITE THROUGH. Handing this function supabaseAdmin would
 * therefore disable every delegation rule while looking identical at the call
 * site. The route is the message; the trigger is the control (S-R R-5).
 *
 * ── extra_caps IS A PROJECTION, NOT A SECOND SOURCE ─────────────────────────
 * The grant ROWS are the truth. `extra_caps` keeps being written because it is
 * live and read by lib/permissions.ts today (S-R §10, Rule Zero) — the same
 * dual-write shape Batch 22 used for the six legacy task columns. It carries
 * GRANTS only: a denial is not an absence of a grant, and has_cap() subtracts
 * denials last precisely so a stale projection cannot defeat one.
 *
 * ── REVOCATION IS A STAMP ───────────────────────────────────────────────────
 * `revoked_at`, never a delete: the record of what was held and when is the
 * thing R-8 exists to keep. The partial unique index is on the LIVE rows only,
 * so the same capability can be granted again afterwards.
 */

export type CapMode = 'grant' | 'deny'

export type DesiredGrant = {
  capability: string
  mode: CapMode
  /** null = permanent (G-5). For a freelance bench, access granted for one
   *  production should not accumulate across every job a person has touched. */
  expiresAt?: string | null
}

export type GrantResult = {
  added: { capability: string; mode: CapMode; expiresAt: string | null }[]
  revoked: { capability: string; mode: CapMode }[]
}

type Side = 'crew' | 'client'

const TABLE: Record<Side, string> = {
  crew: 'org_member_cap_grants',
  client: 'client_member_cap_grants',
}
const ROSTER: Record<Side, string> = {
  crew: 'organization_members',
  client: 'client_members',
}

function normalize(side: Side, cap: string): string {
  return side === 'crew' ? (LEGACY_ORG_CAP[cap] ?? cap) : (LEGACY_CLIENT_CAP[cap] ?? cap)
}

/**
 * Reconcile one member's individual grants to `desired`, as the caller.
 *
 * `desired` is the COMPLETE live set the caller wants, not a delta — the UI
 * shows a person's whole grant list, so a delta API would make "I removed one"
 * and "I sent a stale list" indistinguishable.
 */
export async function setMemberGrants(
  db: SupabaseClient,
  input: {
    side: Side
    memberId: string
    organizationId: string
    /** Ledger scope for the portal side; null crew-side. */
    clientId?: string | null
    projectId?: string | null
    desired: DesiredGrant[]
    actorId: string
    /** Resolved from the ROSTER at grant time, never user_metadata — the
     *  7.8 / 11.5 rule. `granted_by_name` is NOT NULL so the record can never
     *  say "somebody" about a permission change. */
    actorName: string
    actorRole: 'admin' | 'client'
    /** For the ledger sentence only. */
    targetName?: string | null
  },
): Promise<GrantResult> {
  const { side, memberId, organizationId, desired, actorId, actorName } = input
  const table = TABLE[side]

  const { data: live, error: readErr } = await db
    .from(table)
    .select('id, capability, mode, expires_at')
    .eq('member_id', memberId)
    .is('revoked_at', null)
  if (readErr) throw new Error(`grants: cannot read current grants — ${readErr.message}`)

  const want = new Map<string, DesiredGrant>()
  for (const d of desired) {
    const cap = normalize(side, d.capability)
    want.set(`${cap}|${d.mode}`, { ...d, capability: cap })
  }
  const have = new Map<string, { id: string; capability: string; mode: CapMode }>()
  for (const r of live ?? []) {
    have.set(`${r.capability}|${r.mode}`, {
      id: r.id as string, capability: r.capability as string, mode: r.mode as CapMode,
    })
  }

  const result: GrantResult = { added: [], revoked: [] }

  // ── revoke what is no longer wanted ──────────────────────────────────────
  for (const [key, row] of have) {
    if (want.has(key)) continue
    const { error } = await db
      .from(table).update({ revoked_at: new Date().toISOString() }).eq('id', row.id)
    // Surfaced, never swallowed (I-10): a revoke that silently failed leaves a
    // capability the UI has already stopped showing.
    if (error) throw new Error(`grants: cannot revoke ${row.capability} — ${error.message}`)
    result.revoked.push({ capability: row.capability, mode: row.mode })
  }

  // ── add what is new ──────────────────────────────────────────────────────
  for (const [key, d] of want) {
    if (have.has(key)) continue
    const { error } = await db.from(table).insert({
      organization_id: organizationId,
      member_id: memberId,
      capability: d.capability,
      mode: d.mode,
      granted_by: actorId,
      granted_by_name: actorName,
      expires_at: d.expiresAt ?? null,
    })
    if (error) {
      // 0054's named errors reach the caller intact so a route can translate
      // them into a sentence. A generic 500 here is the silent-stall defect
      // from Batch 22 wearing a different hat.
      throw Object.assign(new Error(error.message), { code: error.code })
    }
    result.added.push({ capability: d.capability, mode: d.mode, expiresAt: d.expiresAt ?? null })
  }

  if (result.added.length === 0 && result.revoked.length === 0) return result

  // ── project extra_caps (grants only) ─────────────────────────────────────
  const liveGrants = [...want.values()].filter((d) => d.mode === 'grant').map((d) => d.capability)
  const { error: projErr } = await db
    .from(ROSTER[side]).update({ extra_caps: liveGrants }).eq('id', memberId)
  if (projErr) throw new Error(`grants: rows written but the extra_caps projection failed — ${projErr.message}`)

  // ── the ledger, server-side, one row per change (R-8) ────────────────────
  const who = input.targetName ? `“${input.targetName}”` : 'a member'
  for (const a of result.added) {
    await recordActivity({
      projectId: input.projectId ?? null,
      clientId: input.clientId ?? null,
      organizationId,
      actorId, actorName, actorRole: input.actorRole,
      eventType: a.mode === 'grant' ? 'member_cap_granted' : 'member_cap_denied',
      title: `${a.mode === 'grant' ? 'Granted' : 'Denied'} ${a.capability} to ${who}`,
      body: null,
      meta: {
        member_id: memberId, capability: a.capability, mode: a.mode,
        expires_at: a.expiresAt, side,
      },
    })
  }
  for (const r of result.revoked) {
    await recordActivity({
      projectId: input.projectId ?? null,
      clientId: input.clientId ?? null,
      organizationId,
      actorId, actorName, actorRole: input.actorRole,
      eventType: 'member_cap_revoked',
      title: `Revoked ${r.capability} from ${who}`,
      body: null,
      meta: { member_id: memberId, capability: r.capability, mode: r.mode, side },
    })
  }
  return result
}

/** The ledger half of a ROLE change (R-8). The role write itself belongs to the
 *  team routes, which already own it; this is the record of it. */
export async function recordRoleChange(input: {
  organizationId: string
  clientId?: string | null
  memberId: string
  from: string
  to: string
  actorId: string
  actorName: string
  actorRole: 'admin' | 'client'
  targetName?: string | null
}): Promise<void> {
  if (input.from === input.to) return
  await recordActivity({
    projectId: null,
    clientId: input.clientId ?? null,
    organizationId: input.organizationId,
    actorId: input.actorId, actorName: input.actorName, actorRole: input.actorRole,
    eventType: 'member_role_changed',
    title: `Changed ${input.targetName ? `“${input.targetName}”` : 'a member'} from ${input.from} to ${input.to}`,
    body: null,
    meta: { member_id: input.memberId, from: input.from, to: input.to },
  })
}

/** Every live grant on a member, for the surface that displays them. */
export async function listMemberGrants(
  db: SupabaseClient,
  side: Side,
  memberIds: string[],
): Promise<Map<string, { capability: string; mode: CapMode; grantedByName: string; grantedAt: string; expiresAt: string | null }[]>> {
  const out = new Map<string, { capability: string; mode: CapMode; grantedByName: string; grantedAt: string; expiresAt: string | null }[]>()
  if (memberIds.length === 0) return out
  const { data } = await db
    .from(TABLE[side])
    .select('member_id, capability, mode, granted_by_name, granted_at, expires_at')
    .in('member_id', memberIds)
    .is('revoked_at', null)
    .order('granted_at', { ascending: true })
  for (const r of data ?? []) {
    const list = out.get(r.member_id as string) ?? []
    list.push({
      capability: r.capability as string,
      mode: r.mode as CapMode,
      grantedByName: r.granted_by_name as string,
      grantedAt: r.granted_at as string,
      expiresAt: (r.expires_at as string | null) ?? null,
    })
    out.set(r.member_id as string, list)
  }
  return out
}

export type { OrgCap, ClientCap }
