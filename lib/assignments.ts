import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { recordActivity } from '@/lib/logActivity.server'
import {
  PROJECT_ROLES, SEAT_CLASSES, PROJECT_ROLE_LABEL,
  type ProjectRole, type SeatClass,
} from '@/lib/capabilities'

/**
 * THE SINGLE WRITE PATH FOR PROJECT STAFFING — S-R §3.2, R-8, R-10.
 * The shape lib/grants.ts, lib/approvals.ts and lib/rooms.ts established: one
 * module owns the write, so the invariants live in one place rather than in
 * every caller.
 *
 * ── IT WRITES ON THE USER CLIENT ────────────────────────────────────────────
 * `db` MUST be the caller's cookie-bound client, for the same reason lib/grants.ts
 * insists on it: migration 0053 put `has_cap('people.manage')` on
 * organization_member_projects' admin policy, and under the SERVICE ROLE
 * auth.uid() is null, current_org() is null, and the policy is not the control
 * any more — the write simply goes through. The route returns the message; the
 * POLICY is the control (S-R R-5).
 *
 * There are no delegation TRIGGERS on this table the way 0054 put them on the
 * rosters, so the policy is the whole of the row-level enforcement. That makes
 * handing this the service role worse here than it would be for a grant, not
 * better.
 *
 * ── WHY THE SCOPE IS NEVER TOUCHED BY AN ASSIGNMENT ─────────────────────────
 * Putting somebody on a production does NOT change their scope_mode, and taking
 * them off does not either. B1's lesson, restated at S-R §10 and again in
 * item 4: an empty project set means EVERY project under 'all' and NO project
 * under 'selected', so the two values are not interchangeable and the one on the
 * row is the only thing that says which applies. A helper that "helpfully" set
 * scope_mode='selected' on first assignment would silently narrow a staff
 * member from everything to one job.
 *
 * Scope is its own decision, with its own function and its own ledger event.
 *
 * ── REMOVAL IS A DELETE, AND THAT IS A DEPARTURE FROM THE GRANT TABLES ──────
 * `org_member_cap_grants` revokes by stamping `revoked_at`, because S-R §10 wants
 * the record of what was held. `organization_member_projects` has no such column
 * — it is a PK'd (member, project) pair from the B1–B4 work — so coming off a
 * production is a delete, and the RECORD lives in activity_log instead (R-8's
 * "no new table; R-8 needs the record, not a schema").
 *
 * That is why every function here writes a ledger row and why it is not optional:
 * for a scoped person, their assignments ARE their access, so an unlogged removal
 * is access disappearing with nothing able to say who did it. EXPIRY is the
 * non-destructive alternative and is why `expires_at` exists (G-5, 0057):
 * an expired assignment stops resolving and the row survives.
 */

export type Assignment = {
  projectId: string
  projectTitle: string | null
  projectRole: ProjectRole | null
  expiresAt: string | null
  createdAt: string
}

export type Staffing = {
  memberId: string
  name: string | null
  email: string
  role: string
  seatClass: SeatClass
  projectRole: ProjectRole | null
  expiresAt: string | null
}

type Actor = { id: string; name: string; organizationId: string }

/** Guards shared by every entry point. Values from a request body are data, not
 *  promises — a project_role the CHECK refuses would 23514 mid-write, and a
 *  seat_class it refuses would do the same, so both are rejected here with a
 *  sentence instead. */
export function isProjectRole(v: unknown): v is ProjectRole {
  return typeof v === 'string' && (PROJECT_ROLES as readonly string[]).includes(v)
}
export function isSeatClass(v: unknown): v is SeatClass {
  return typeof v === 'string' && (SEAT_CLASSES as readonly string[]).includes(v)
}

const roleWord = (r: ProjectRole | null) => (r ? PROJECT_ROLE_LABEL[r] : 'no stated role')

/** What a person is on — live and expired alike, because the surface that shows
 *  staffing has to be able to show why somebody LOST access. Sorted newest
 *  assignment first. */
export async function listForMember(
  db: SupabaseClient, memberId: string,
): Promise<Assignment[]> {
  const { data, error } = await db
    .from('organization_member_projects')
    .select('project_id, project_role, expires_at, created_at, projects(title)')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`assignments: ${error.message}`)
  return (data ?? []).map((r) => ({
    projectId: r.project_id as string,
    projectTitle: (() => {
      const raw = r.projects as unknown as { title?: string } | { title?: string }[] | null
      const p = Array.isArray(raw) ? (raw[0] ?? null) : raw
      return p?.title ?? null
    })(),
    projectRole: (r.project_role as ProjectRole | null) ?? null,
    expiresAt: (r.expires_at as string | null) ?? null,
    createdAt: r.created_at as string,
  }))
}

/** Who is on a production, and as what. The other direction of the same table. */
export async function listForProject(
  db: SupabaseClient, projectId: string,
): Promise<Staffing[]> {
  const { data, error } = await db
    .from('organization_member_projects')
    .select('member_id, project_role, expires_at, organization_members(id, name, email, role, seat_class)')
    .eq('project_id', projectId)
  if (error) throw new Error(`staffing: ${error.message}`)
  return (data ?? []).map((r) => {
    // PostgREST types an embedded to-one as an ARRAY here; it is one row because
    // member_id is a FK to a PK. Narrowed rather than asserted, so a genuinely
    // empty embed reads as null instead of throwing on property access.
    type Embedded = { id: string; name: string | null; email: string; role: string; seat_class: SeatClass }
    const raw = r.organization_members as unknown as Embedded | Embedded[] | null
    const m: Embedded | null = Array.isArray(raw) ? (raw[0] ?? null) : raw
    return {
      memberId: r.member_id as string,
      name: m?.name ?? null,
      email: m?.email ?? '',
      role: m?.role ?? '',
      seatClass: m?.seat_class ?? 'staff',
      projectRole: (r.project_role as ProjectRole | null) ?? null,
      expiresAt: (r.expires_at as string | null) ?? null,
    }
  })
}

/**
 * Put somebody on a production, or change what they are on it.
 *
 * Upsert on the PK, so this is idempotent and a role change is the same call as
 * a first assignment — with the ledger distinguishing them, because "added to the
 * production" and "changed from editor to colorist" are different facts and a
 * single `member_assigned_project` for both would make the history unreadable.
 */
export async function assign(
  db: SupabaseClient,
  actor: Actor,
  input: {
    memberId: string
    projectId: string
    projectRole: ProjectRole | null
    expiresAt: string | null
    targetName: string | null
    projectTitle: string | null
  },
): Promise<{ created: boolean }> {
  const { data: existing } = await db
    .from('organization_member_projects')
    .select('project_role, expires_at')
    .eq('member_id', input.memberId).eq('project_id', input.projectId)
    .maybeSingle()

  const { data: written, error } = await db
    .from('organization_member_projects')
    .upsert({
      member_id: input.memberId,
      project_id: input.projectId,
      organization_id: actor.organizationId,
      project_role: input.projectRole,
      expires_at: input.expiresAt,
    }, { onConflict: 'member_id,project_id' })
    .select('member_id')
  if (error) throw new Error(`assign: ${error.message}`)
  // A policy refusal matches ZERO ROWS and returns NO ERROR (§12 lesson 6). Ask
  // for rows back and treat an empty result as refused, distinctly from an error.
  if ((written ?? []).length === 0) {
    throw new Error('assign: refused by policy — people.manage is required on this organization.')
  }

  const who = input.targetName ? `“${input.targetName}”` : 'a member'
  const what = input.projectTitle ? `“${input.projectTitle}”` : 'a production'
  const created = !existing
  await recordActivity({
    projectId: input.projectId,
    clientId: null,
    organizationId: actor.organizationId,
    actorId: actor.id, actorName: actor.name, actorRole: 'admin',
    eventType: created ? 'member_assigned_project' : 'member_project_role_changed',
    title: created
      ? `Put ${who} on ${what} as ${roleWord(input.projectRole)}`
      : `Changed ${who} on ${what} from ${roleWord((existing.project_role as ProjectRole | null) ?? null)} to ${roleWord(input.projectRole)}`,
    body: null,
    meta: {
      member_id: input.memberId,
      project_id: input.projectId,
      from: created ? null : (existing.project_role ?? null),
      to: input.projectRole,
      expires_at: input.expiresAt,
      // Recorded because an expiry CHANGE is invisible in the title above and is
      // the difference between access ending on Friday and access ending never.
      expires_from: created ? null : (existing.expires_at ?? null),
    },
  })
  return { created }
}

/** Take somebody off a production. See the module header on why this deletes and
 *  why expiry is the non-destructive alternative. */
export async function unassign(
  db: SupabaseClient,
  actor: Actor,
  input: { memberId: string; projectId: string; targetName: string | null; projectTitle: string | null },
): Promise<void> {
  const { data: gone, error } = await db
    .from('organization_member_projects')
    .delete()
    .eq('member_id', input.memberId).eq('project_id', input.projectId)
    .select('member_id')
  if (error) throw new Error(`unassign: ${error.message}`)
  if ((gone ?? []).length === 0) {
    throw new Error('unassign: refused by policy, or the assignment does not exist.')
  }
  const who = input.targetName ? `“${input.targetName}”` : 'a member'
  const what = input.projectTitle ? `“${input.projectTitle}”` : 'a production'
  await recordActivity({
    projectId: input.projectId,
    clientId: null,
    organizationId: actor.organizationId,
    actorId: actor.id, actorName: actor.name, actorRole: 'admin',
    eventType: 'member_unassigned_project',
    title: `Took ${who} off ${what}`,
    body: null,
    meta: { member_id: input.memberId, project_id: input.projectId },
  })
}

/** The seat class on the roster. A LABEL — it does not move scope_mode, for the
 *  reason in the module header. */
export async function setSeatClass(
  db: SupabaseClient,
  actor: Actor,
  input: { memberId: string; seatClass: SeatClass; from: SeatClass; targetName: string | null },
): Promise<void> {
  if (input.from === input.seatClass) return
  const { data, error } = await db
    .from('organization_members')
    .update({ seat_class: input.seatClass })
    .eq('id', input.memberId)
    .select('id')
  if (error) throw new Error(`seat class: ${error.message}`)
  if ((data ?? []).length === 0) {
    throw new Error('seat class: refused by policy — people.manage is required.')
  }
  await recordActivity({
    projectId: null, clientId: null, organizationId: actor.organizationId,
    actorId: actor.id, actorName: actor.name, actorRole: 'admin',
    eventType: 'member_seat_class_changed',
    title: `Changed ${input.targetName ? `“${input.targetName}”` : 'a member'} from ${input.from} to ${input.seatClass}`,
    body: null,
    meta: { member_id: input.memberId, from: input.from, to: input.seatClass },
  })
}

/**
 * The scope itself — the access decision, separate from the label.
 *
 * This is the ONLY function in the codebase that changes a live member's
 * scope_mode, and it exists so that widening or narrowing somebody is an explicit
 * act with a ledger row behind it rather than a side effect of relabelling them.
 */
export async function setScopeMode(
  db: SupabaseClient,
  actor: Actor,
  input: { memberId: string; scopeMode: 'all' | 'selected'; from: string; targetName: string | null },
): Promise<void> {
  if (input.from === input.scopeMode) return
  const { data, error } = await db
    .from('organization_members')
    .update({ scope_mode: input.scopeMode })
    .eq('id', input.memberId)
    .select('id')
  if (error) throw new Error(`scope: ${error.message}`)
  if ((data ?? []).length === 0) {
    throw new Error('scope: refused by policy — people.manage is required.')
  }
  await recordActivity({
    projectId: null, clientId: null, organizationId: actor.organizationId,
    actorId: actor.id, actorName: actor.name, actorRole: 'admin',
    eventType: 'member_scope_changed',
    title: input.scopeMode === 'all'
      ? `Gave ${input.targetName ? `“${input.targetName}”` : 'a member'} every production`
      : `Limited ${input.targetName ? `“${input.targetName}”` : 'a member'} to their assigned productions`,
    body: null,
    meta: { member_id: input.memberId, from: input.from, to: input.scopeMode },
  })
}
