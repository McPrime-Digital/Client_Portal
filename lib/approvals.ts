import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { recordActivity } from '@/lib/logActivity.server'
import { decodeCursor, encodeCursor, beforePredicate, type KeysetCursor } from '@/lib/keyset'
import { ensureClientRoom, ensureCrewRoom } from '@/lib/messageRooms'

/**
 * The approvals engine — Batch 22 item 2 (S3-c).
 *
 * THE SINGLE WRITE PATH for every approval mutation, the way
 * `lib/messageRooms.ts` is for rooms and `lib/messageRead.ts` is for
 * watermarks. Nothing outside this module may write `approvals`,
 * `approval_stages`, `approval_assignees`, `approval_decisions` or
 * `approval_comment_permissions`.
 *
 * ── WHAT THIS MODULE WILL NEVER DO ──────────────────────────────────────────
 * AP-1: approval NEVER blocks work. There is no function here that gates,
 * holds, defers or refuses anything outside the approval itself. The engine
 * OBSERVES the pipeline. A stage may order itself inside an approval; no
 * approval stage ever holds up work outside itself. If a future caller looks
 * like it needs that, it is a spec conflict, not a missing function.
 *
 * AP-2: silence auto-advances with outcome 'auto_advanced' and NO ACTOR, and
 * is never written as 'approved'. `advanceOnSilence` writes NO
 * approval_decisions row, because nobody decided. `expired` does not exist.
 *
 * AP-3: a stage in 'blocked_on_changes' is NOT silent — someone asked for
 * changes and the work is in flight. It must never lapse. `advanceOnSilence`
 * predicates on status = 'active' alone, which excludes it by construction.
 *
 * ── TENANCY ─────────────────────────────────────────────────────────────────
 * T-5: `orgId` is resolved by the CALLER from the verified session, never from
 * a request body, and is stamped explicitly — `approvals.organization_id` has
 * no column DEFAULT to fall back on (0038), deliberately.
 *
 * The polymorphism cost (S3-core §2.2): `subject_id` is not an FK, so the
 * database cannot check that a subject exists or that it belongs to the
 * caller's tenant. `createApproval` does both BEFORE inserting. That check is
 * the price of the polymorphism and is not optional.
 *
 * ── THE CLIENT IS A PARAMETER ───────────────────────────────────────────────
 * `db` is passed in rather than imported, so this module adds no entry to the
 * I-8 allowlist. Pass the cookie-bound USER client (AD-001) from any path with
 * a session — 0038's policies are the tenant boundary and the
 * `approval_decisions` INSERT policy is what stops a forged decision. Only the
 * auto-advance sweep (item 5) has no session, and it is already allowlisted.
 *
 * ── ATOMICITY, AND THE GAP THAT IS HONEST RATHER THAN HIDDEN ────────────────
 * The brief asks for stages, assignees and the ledger row to be created "in
 * the same transaction". supabase-js has no client-side transactions — each
 * call is its own statement. The repo answers this two ways: an RPC where
 * atomicity is load-bearing (`charge_credits`, `add_credits` — money), and
 * COMPENSATING CLEANUP everywhere else (`create-client` deletes the company
 * row if a later insert fails). This module follows the second, because a
 * half-built approval is recoverable and costs nobody money: if stages or
 * assignees fail, the approval row is deleted (the 0038 cascade takes its
 * children) and the error is thrown. The residual window is a crash between
 * insert and cleanup, which would leave an approval with no stages — visible
 * as `status='open'` with zero stages, and the shape to look for if one ever
 * appears. Upgrading to an RPC is a migration, not a rewrite of this file.
 */

// ── vocabulary (must match 0038's CHECK constraints exactly) ────────────────

export type SubjectKind = 'file_version' | 'task' | 'milestone' | 'document' | 'message'
export type ApprovalStatus =
  | 'open' | 'approved' | 'rejected' | 'changes_requested' | 'auto_advanced' | 'withdrawn'
export type StageStatus =
  | 'pending' | 'active' | 'complete' | 'auto_advanced' | 'blocked_on_changes'
export type StageMode = 'sequential' | 'parallel'
export type DecisionOutcome = 'approved' | 'rejected' | 'changes_requested'

/**
 * Where each subject kind lives, for the existence + tenant check.
 *
 * Two of these are deliberately approximate and must be revisited:
 *   · `file_version` points at `files` until migration 9 creates the version
 *     stack; a version id IS a file id today.
 *   · `milestone` points at `tasks`, because a milestone is a task with
 *     category='milestone' (live CHECK on tasks.category). There is no
 *     milestones table and S-F does not ask for one yet.
 * Every table listed here was confirmed to carry `organization_id` (live read,
 * Batch 22 item 0) — the tenant half of the check depends on it.
 */
const SUBJECT_TABLE: Record<SubjectKind, string> = {
  file_version: 'files',
  task: 'tasks',
  milestone: 'tasks',
  document: 'documents',
  message: 'messages',
}

export type AssigneeInput = {
  /** A named person. */
  userId?: string | null
  /** Any active member of this client company. */
  clientId?: string | null
  /** A role, resolved against the roster at decision time — so a named person
   *  leaving cannot deadlock the approval (S3-core §2.4). */
  role?: string | null
  /** Required assignees must all be satisfied for the stage to complete.
   *  Default true. */
  required?: boolean
}

export type StageInput = {
  name: string
  mode?: StageMode
  assignees: AssigneeInput[]
}

export type CreateApprovalParams = {
  orgId: string
  actorId: string
  actorName: string
  actorRole: 'admin' | 'client'
  subjectKind: SubjectKind
  subjectId: string
  title: string
  /** null = an INTERNAL approval, invisible to every client member by
   *  construction (0038's client-side SELECT policy). */
  clientId?: string | null
  projectId?: string | null
  /** Per-approval override; null inherits organizations.approval_window_hours. */
  reviewWindowHours?: number | null
  contractId?: string | null
  subjectVersionId?: string | null
  stages: StageInput[]
}

export type ApprovalRow = {
  id: string
  organization_id: string
  subject_kind: SubjectKind
  subject_id: string
  project_id: string | null
  client_id: string | null
  title: string
  status: ApprovalStatus
  review_window_hours: number | null
  contract_id: string | null
  subject_version_id: string | null
  created_by: string | null
  created_at: string
  deleted_at: string | null
}

export type StageRow = {
  id: string
  approval_id: string
  seq: number
  name: string
  mode: StageMode
  deadline_at: string | null
  status: StageStatus
  advanced_at: string | null
}

const APPROVAL_COLUMNS =
  'id, organization_id, subject_kind, subject_id, project_id, client_id, title, status, ' +
  'review_window_hours, contract_id, subject_version_id, created_by, created_at, deleted_at'
const STAGE_COLUMNS = 'id, approval_id, seq, name, mode, deadline_at, status, advanced_at'

function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}

// ── createApproval ──────────────────────────────────────────────────────────

/**
 * Validates the subject, resolves the review window, and opens the approval
 * with its first stage ACTIVE and on the clock.
 *
 * Stage 1 is activated here rather than left 'pending': an approval whose
 * every stage is pending has no deadline, so the item-5 sweep would never see
 * it and nobody could decide on it — an approval that silently does nothing is
 * worse than one that never opened.
 */
export async function createApproval(
  db: SupabaseClient,
  params: CreateApprovalParams
): Promise<{ approval: ApprovalRow; stages: StageRow[] }> {
  const {
    orgId, actorId, actorName, actorRole, subjectKind, subjectId, title,
    clientId = null, projectId = null, reviewWindowHours = null,
    contractId = null, subjectVersionId = null, stages,
  } = params

  if (!orgId) throw new Error('createApproval: orgId is required (T-5)')
  if (!subjectId) throw new Error('createApproval: subjectId is required')
  if (!title.trim()) throw new Error('createApproval: title is required')
  if (stages.length === 0) throw new Error('createApproval: at least one stage is required')
  for (const s of stages) {
    if (s.assignees.length === 0) {
      throw new Error(`createApproval: stage "${s.name}" has no assignees — nobody could decide on it`)
    }
    for (const a of s.assignees) {
      if (!a.userId && !a.clientId && !a.role) {
        throw new Error(`createApproval: an assignee on stage "${s.name}" names nobody`)
      }
    }
  }
  if (reviewWindowHours != null && reviewWindowHours <= 0) {
    throw new Error('createApproval: reviewWindowHours must be positive; null inherits the org default')
  }

  // ── the polymorphism cost: the subject must exist AND be in this tenant ──
  const subjectTable = SUBJECT_TABLE[subjectKind]
  const { data: subject, error: subjectErr } = await db
    .from(subjectTable)
    .select('id')
    .eq('id', subjectId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (subjectErr) {
    throw new Error(`createApproval: subject lookup failed (${subjectTable} ${subjectId}): ${subjectErr.message}`)
  }
  if (!subject) {
    // One message for "absent" and "another tenant's": a probe must not learn
    // which (the /api/activity NOT_FOUND posture).
    throw new Error(`createApproval: no ${subjectKind} ${subjectId} in this organization`)
  }

  // The counterparty and the tag are tenant-checked for the same reason.
  if (clientId) {
    const { data: co } = await db
      .from('clients').select('id').eq('id', clientId).eq('organization_id', orgId).maybeSingle()
    if (!co) throw new Error(`createApproval: no client company ${clientId} in this organization`)
  }
  if (projectId) {
    const { data: pr } = await db
      .from('projects').select('id').eq('id', projectId).eq('organization_id', orgId).maybeSingle()
    if (!pr) throw new Error(`createApproval: no project ${projectId} in this organization`)
  }

  // ── the window: per-approval override, else the org default ──────────────
  let windowHours = reviewWindowHours
  if (windowHours == null) {
    const { data: org, error: orgErr } = await db
      .from('organizations').select('approval_window_hours').eq('id', orgId).maybeSingle()
    if (orgErr) throw new Error(`createApproval: org window lookup failed: ${orgErr.message}`)
    windowHours = (org as { approval_window_hours?: number } | null)?.approval_window_hours ?? 120
  }

  const { data: approvalData, error: approvalErr } = await db
    .from('approvals')
    .insert({
      organization_id: orgId, // stamped, never defaulted (T-5)
      subject_kind: subjectKind,
      subject_id: subjectId,
      project_id: projectId,
      client_id: clientId,
      title: title.trim(),
      status: 'open',
      review_window_hours: reviewWindowHours,
      contract_id: contractId,
      subject_version_id: subjectVersionId,
      created_by: actorId,
    })
    .select(APPROVAL_COLUMNS)
    .single()
  if (approvalErr || !approvalData) {
    throw new Error(`createApproval: insert failed: ${approvalErr?.message ?? 'no row returned'}`)
  }
  const approval = approvalData as unknown as ApprovalRow

  // Everything past this point compensates on failure — see the header.
  try {
    const stageRows = stages.map((s, i) => ({
      approval_id: approval.id,
      seq: i + 1,
      name: s.name,
      mode: s.mode ?? 'sequential',
      // Only the first stage is on the clock. Later stages get their deadline
      // when they are activated, not now — a stage that has not started has
      // not consumed any of the client's window.
      status: i === 0 ? 'active' : 'pending',
      deadline_at: i === 0 ? hoursFromNow(windowHours) : null,
    }))

    const { data: insertedStages, error: stageErr } = await db
      .from('approval_stages').insert(stageRows).select(STAGE_COLUMNS).order('seq')
    if (stageErr || !insertedStages) {
      throw new Error(`stage insert failed: ${stageErr?.message ?? 'no rows returned'}`)
    }

    const assigneeRows = (insertedStages as StageRow[]).flatMap((row, i) =>
      stages[i].assignees.map((a) => ({
        stage_id: row.id,
        user_id: a.userId ?? null,
        client_id: a.clientId ?? null,
        role: a.role ?? null,
        required: a.required ?? true,
      }))
    )
    const { error: assigneeErr } = await db.from('approval_assignees').insert(assigneeRows)
    if (assigneeErr) throw new Error(`assignee insert failed: ${assigneeErr.message}`)

    await recordActivity({
      projectId, clientId, organizationId: orgId,
      actorId, actorName, actorRole,
      eventType: 'approval_created',
      title: `Approval opened: “${approval.title}”`,
      body: null,
      meta: {
        approval_id: approval.id,
        subject_kind: subjectKind,
        subject_id: subjectId,
        review_window_hours: windowHours,
        window_source: reviewWindowHours == null ? 'organization_default' : 'per_approval',
        stage_count: insertedStages.length,
      },
    })

    // ── THE CARD (S3-c §3.1) ────────────────────────────────────────────
    // "A message can be an approval gate. The conversation and the
    // contractual record are the same object." So opening an approval POSTS
    // ONE, here, in the engine — not in whichever call site remembers to.
    //
    // This was the gap that made item 7 not work end to end: the card
    // component and the renderer both existed, and nothing ever wrote a
    // message carrying approval_id, so a production gate opened an approval
    // whose card never appeared. Putting it in the engine means every path —
    // the task bridge, the routes, anything built later — gets one.
    //
    // Inside the try DELIBERATELY: if the card cannot be posted the approval
    // is rolled back. An approval the client never sees is the defect being
    // fixed, and recreating it silently is worse than a failed create the
    // studio can retry.
    const room = clientId
      ? await ensureClientRoom(db, orgId, clientId, actorId)
      : await ensureCrewRoom(db, orgId, actorId)
    const { error: cardErr } = await db.from('messages').insert({
      room_id: room.id,
      organization_id: orgId, // stamped, never defaulted (T-5)
      project_id: projectId,
      sender_id: actorId,
      sender_name: actorName,
      body: `Approval requested · “${approval.title}”`,
      // What makes it a card rather than a bubble. RoomThread renders
      // ApprovalCard for any message carrying this.
      approval_id: approval.id,
    })
    if (cardErr) throw new Error(`approval card insert failed: ${cardErr.message}`)

    return { approval, stages: insertedStages as StageRow[] }
  } catch (e) {
    // Compensate: the 0038 cascade removes stages and assignees with the row.
    await db.from('approvals').delete().eq('id', approval.id)
    throw new Error(
      `createApproval: rolled back approval ${approval.id} — ${e instanceof Error ? e.message : String(e)}`
    )
  }
}

// ── recordDecision ──────────────────────────────────────────────────────────

export type RecordDecisionParams = {
  stageId: string
  actorId: string
  /** Resolved from the ROSTER via rosterName() (lib/team.ts) by the CALLER,
   *  never from user_metadata — which the user can rewrite. This is the
   *  7.8 / 11.5 defect through a new door. */
  actorName: string
  actorRole: 'admin' | 'client'
  decision: DecisionOutcome
  comment?: string | null
}

/**
 * Records a decision, advances the stage, and recomputes the approval.
 *
 * THE TRANSITION IS NOT COMPUTED HERE. 0039's AFTER INSERT trigger on
 * approval_decisions derives it from the recorded decisions and applies it.
 * This function inserts the decision and then RE-READS — the database is the
 * authority on what advanced.
 *
 * That is not a style choice. `approval_stages` is crew-writable only (0038),
 * correctly, so a CLIENT advancing their own stage from here was a PostgREST
 * UPDATE matching zero rows — no error, no advance, proven live. The approval
 * would then sit open until the item-5 sweep lapsed it, and the permanent
 * record would say "no response was received" about a client who had
 * responded. Because 0038 also permits an assignee to insert a decision
 * DIRECTLY, any fix living above the table could be walked around; the trigger
 * cannot be.
 *
 * The rule it applies (kept here so the reader knows what to expect): a stage
 * completes when EVERY `required` assignee is satisfied by an approving
 * decision, with company and role assignees resolved against the roster and
 * scoped to this approval's tenant. `mode` ('sequential' | 'parallel') is
 * stored but does NOT yet differentiate, because the difference is an ordering
 * among assignees and `approval_assignees` has no ordering column. Requiring
 * all is the safe direction — the alternative UNDER-requires approvals in a
 * system whose purpose is being un-arguable. A known gap, not a silent no-op.
 */
export async function recordDecision(
  db: SupabaseClient,
  params: RecordDecisionParams
): Promise<{ stage: StageRow; approvalStatus: ApprovalStatus }> {
  const { stageId, actorId, actorName, actorRole, decision, comment = null } = params
  if (!actorName?.trim()) {
    throw new Error('recordDecision: actorName is required and must come from the roster')
  }

  const { data: stageData, error: stageErr } = await db
    .from('approval_stages').select(STAGE_COLUMNS).eq('id', stageId).maybeSingle()
  if (stageErr) throw new Error(`recordDecision: stage lookup failed: ${stageErr.message}`)
  if (!stageData) throw new Error(`recordDecision: no stage ${stageId}`)
  const stage = stageData as StageRow

  if (stage.status !== 'active') {
    throw new Error(
      `recordDecision: stage ${stageId} is '${stage.status}', not 'active' — only an open stage takes a decision`
    )
  }

  const { data: approvalData, error: aErr } = await db
    .from('approvals').select(APPROVAL_COLUMNS).eq('id', stage.approval_id).maybeSingle()
  if (aErr) throw new Error(`recordDecision: approval lookup failed: ${aErr.message}`)
  if (!approvalData) throw new Error(`recordDecision: no approval for stage ${stageId}`)
  const approval = approvalData as unknown as ApprovalRow

  const { error: decisionErr } = await db.from('approval_decisions').insert({
    stage_id: stageId,
    actor_id: actorId,
    actor_name: actorName.trim(),
    decision,
    comment,
  })
  if (decisionErr) {
    // 42501 here is 0038's INSERT policy refusing a non-assignee or a stage
    // that is not active. That refusal is the protection, not a bug.
    throw new Error(`recordDecision: decision insert refused: ${decisionErr.message}`)
  }

  // 0039's trigger has now applied the transition. Re-read rather than
  // recompute: a second implementation here would be the copies-drift failure
  // S3-c §3 names, and this side cannot write approval_stages as a client
  // anyway.
  const { data: freshStage } = await db
    .from('approval_stages').select(STAGE_COLUMNS).eq('id', stageId).maybeSingle()
  const { data: freshApproval } = await db
    .from('approvals').select('status').eq('id', approval.id).maybeSingle()

  const stageAfter = (freshStage as StageRow | null) ?? stage
  const approvalStatus =
    ((freshApproval as { status?: ApprovalStatus } | null)?.status) ?? approval.status

  await recordActivity({
    projectId: approval.project_id, clientId: approval.client_id,
    organizationId: approval.organization_id,
    actorId, actorName, actorRole,
    eventType: 'approval_decided',
    title: `${actorName} recorded “${decision}” on “${approval.title}”`,
    body: comment ?? null,
    meta: {
      approval_id: approval.id, stage_id: stageId, stage_seq: stage.seq,
      decision,
      approval_status: approvalStatus,
      stage_status: stageAfter.status,
      // Whether THIS decision moved the stage, read back from the database
      // rather than predicted.
      advanced: stageAfter.status !== 'active',
    },
  })

  return { stage: stageAfter, approvalStatus }
}

/** Activate the next stage in sequence and put it on the clock. */
async function activateNextStage(
  db: SupabaseClient,
  approval: ApprovalRow,
  fromSeq: number
): Promise<StageRow | null> {
  const { data: next } = await db
    .from('approval_stages').select(STAGE_COLUMNS)
    .eq('approval_id', approval.id).gt('seq', fromSeq).eq('status', 'pending')
    .order('seq', { ascending: true }).limit(1).maybeSingle()
  if (!next) return null

  const windowHours = approval.review_window_hours ?? (await orgWindowHours(db, approval.organization_id))
  const { data: updated, error } = await db
    .from('approval_stages')
    .update({ status: 'active', deadline_at: hoursFromNow(windowHours) })
    .eq('id', (next as StageRow).id)
    .select(STAGE_COLUMNS).single()
  if (error) throw new Error(`activateNextStage: ${error.message}`)
  return updated as StageRow
}

async function orgWindowHours(db: SupabaseClient, orgId: string): Promise<number> {
  const { data } = await db
    .from('organizations').select('approval_window_hours').eq('id', orgId).maybeSingle()
  return (data as { approval_window_hours?: number } | null)?.approval_window_hours ?? 120
}

// ── advanceOnSilence ────────────────────────────────────────────────────────

/**
 * The lapse. AP-2 in one function.
 *
 * Sets the stage to 'auto_advanced' with `advanced_at`, and writes NO
 * approval_decisions row — because nobody decided. The ledger row is the ONLY
 * record of the lapse, which is why it carries the window and the deadline it
 * passed: S3-c §2.4 makes proceeding-without-a-response defensible only if the
 * record proves the response was sought.
 *
 * AP-3 is enforced by the caller's predicate AND re-checked here: only an
 * 'active' stage can lapse. A 'blocked_on_changes' stage is not silent.
 */
export async function advanceOnSilence(
  db: SupabaseClient,
  stageId: string
): Promise<{ stage: StageRow; approvalStatus: ApprovalStatus } | null> {
  const { data: stageData } = await db
    .from('approval_stages').select(STAGE_COLUMNS).eq('id', stageId).maybeSingle()
  if (!stageData) return null
  const stage = stageData as StageRow
  if (stage.status !== 'active') return null // AP-3, re-checked at the write

  const { data: approvalData } = await db
    .from('approvals').select(APPROVAL_COLUMNS).eq('id', stage.approval_id).maybeSingle()
  if (!approvalData) return null
  const approval = approvalData as unknown as ApprovalRow

  const now = new Date().toISOString()
  const { data: updated, error } = await db
    .from('approval_stages')
    .update({ status: 'auto_advanced', advanced_at: now })
    .eq('id', stageId)
    .eq('status', 'active') // idempotent under a concurrent sweep
    .select(STAGE_COLUMNS).maybeSingle()
  if (error) throw new Error(`advanceOnSilence: stage update failed: ${error.message}`)
  if (!updated) return null // another run took it

  const nextStage = await activateNextStage(db, approval, stage.seq)
  // 'auto_advanced', NEVER 'approved' — the whole point of AP-2.
  const approvalStatus: ApprovalStatus = nextStage ? 'open' : 'auto_advanced'
  if (approvalStatus !== approval.status) {
    const { error: upErr } = await db
      .from('approvals').update({ status: approvalStatus }).eq('id', approval.id)
    if (upErr) throw new Error(`advanceOnSilence: approval status update failed: ${upErr.message}`)
  }

  await recordActivity({
    projectId: approval.project_id, clientId: approval.client_id,
    organizationId: approval.organization_id,
    // NO ACTOR. activity_log.actor_id and actor_role are nullable; actor_name
    // is NOT NULL, so the lapse names itself rather than naming a person.
    actorId: null, actorName: 'System', actorRole: null,
    eventType: 'approval_auto_advanced',
    title: `No response by the review date on “${approval.title}” — work proceeded`,
    body: null,
    meta: {
      approval_id: approval.id, stage_id: stageId, stage_seq: stage.seq,
      deadline_at: stage.deadline_at, lapsed_at: now,
      review_window_hours: approval.review_window_hours,
      approval_status: approvalStatus, next_stage_id: nextStage?.id ?? null,
      is_client_approval: approval.client_id != null,
    },
  })

  return { stage: updated as StageRow, approvalStatus }
}

// ── the smaller mutations ───────────────────────────────────────────────────

/**
 * Who may comment (S3-c §5.2). An explicit row wins in either direction; with
 * no row, participants may comment. This governs the WRITE only — every
 * participant READS every comment (AP-4), and there is no read-side filter
 * anywhere in this engine.
 */
export async function setCommentPermission(
  db: SupabaseClient,
  params: { approvalId: string; userId: string; canComment: boolean; setBy: string }
): Promise<void> {
  const { approvalId, userId, canComment, setBy } = params
  const { error } = await db
    .from('approval_comment_permissions')
    .upsert(
      { approval_id: approvalId, user_id: userId, can_comment: canComment, set_by: setBy, set_at: new Date().toISOString() },
      { onConflict: 'approval_id,user_id' }
    )
  if (error) throw new Error(`setCommentPermission: ${error.message}`)
}

/**
 * Change the window on an OPEN approval, and move the active stage's deadline
 * with it — a window that changes without moving the clock is a number in a
 * column that nothing obeys.
 */
export async function setReviewWindow(
  db: SupabaseClient,
  params: { approvalId: string; hours: number | null; actorId: string; actorName: string; actorRole: 'admin' | 'client' }
): Promise<void> {
  const { approvalId, hours, actorId, actorName, actorRole } = params
  if (hours != null && hours <= 0) {
    throw new Error('setReviewWindow: hours must be positive; null inherits the org default')
  }

  const { data: approvalData } = await db
    .from('approvals').select(APPROVAL_COLUMNS).eq('id', approvalId).maybeSingle()
  if (!approvalData) throw new Error(`setReviewWindow: no approval ${approvalId}`)
  const approval = approvalData as unknown as ApprovalRow

  const { error } = await db
    .from('approvals').update({ review_window_hours: hours }).eq('id', approvalId)
  if (error) throw new Error(`setReviewWindow: ${error.message}`)

  const effective = hours ?? (await orgWindowHours(db, approval.organization_id))
  const { data: active } = await db
    .from('approval_stages').select('id, advanced_at')
    .eq('approval_id', approvalId).eq('status', 'active').maybeSingle()
  if (active) {
    // Re-based on NOW, deliberately: extending a window that has already
    // lapsed should give the client the new window from the moment it was
    // granted, not retroactively from a deadline they already missed.
    await db.from('approval_stages')
      .update({ deadline_at: hoursFromNow(effective) })
      .eq('id', (active as { id: string }).id)
  }

  await recordActivity({
    projectId: approval.project_id, clientId: approval.client_id,
    organizationId: approval.organization_id,
    actorId, actorName, actorRole,
    eventType: 'approval_created', // no distinct type; the meta carries the change
    title: `Review window set to ${effective}h on “${approval.title}”`,
    body: null,
    meta: { approval_id: approvalId, review_window_hours: hours, effective_hours: effective, change: 'review_window' },
  })
}

/** Withdraw an approval. The record stays; only its status changes. */
export async function withdrawApproval(
  db: SupabaseClient,
  params: { approvalId: string; actorId: string; actorName: string; actorRole: 'admin' | 'client'; reason?: string | null }
): Promise<void> {
  const { approvalId, actorId, actorName, actorRole, reason = null } = params

  const { data: approvalData } = await db
    .from('approvals').select(APPROVAL_COLUMNS).eq('id', approvalId).maybeSingle()
  if (!approvalData) throw new Error(`withdrawApproval: no approval ${approvalId}`)
  const approval = approvalData as unknown as ApprovalRow

  const { error } = await db
    .from('approvals').update({ status: 'withdrawn' }).eq('id', approvalId)
  if (error) throw new Error(`withdrawApproval: ${error.message}`)

  // Take every live stage off the clock so the sweep cannot lapse a withdrawn
  // approval — an auto-advance on something nobody is waiting for would write
  // a lapse into the permanent record for no reason.
  const { error: stageErr } = await db
    .from('approval_stages')
    .update({ status: 'complete', advanced_at: new Date().toISOString() })
    .eq('approval_id', approvalId)
    .in('status', ['active', 'pending'])
  if (stageErr) throw new Error(`withdrawApproval: stage close failed: ${stageErr.message}`)

  await recordActivity({
    projectId: approval.project_id, clientId: approval.client_id,
    organizationId: approval.organization_id,
    actorId, actorName, actorRole,
    eventType: 'approval_withdrawn',
    title: `Approval withdrawn: “${approval.title}”`,
    body: reason,
    meta: { approval_id: approvalId, previous_status: approval.status },
  })
}

// ── reads ───────────────────────────────────────────────────────────────────

/**
 * I-1: nothing unbounded. The cap is STATED, not implied by a caller's limit,
 * and the walk is keyset — `lib/keyset.ts`, the same helper messages use, so
 * approvals do not become a third cursor implementation.
 *
 * Note for whoever profiles this: there is no (organization_id, created_at,
 * id) index yet. 0038 indexes (organization_id, status), which serves the
 * filter but not the ordered walk. With zero rows today it is a note, not a
 * problem — add the index when the first studio has thousands.
 */
export const APPROVAL_PAGE_SIZE = 50

export type AssigneeRow = {
  id: string
  stage_id: string
  user_id: string | null
  client_id: string | null
  role: string | null
  required: boolean
}

export type DecisionRow = {
  id: string
  stage_id: string
  actor_id: string | null
  actor_name: string
  decision: DecisionOutcome
  comment: string | null
  decided_at: string
}

/** A ledger row about this approval — reminders and lapses, which are facts
 *  about the review that no decision row records (S3-c §2.4). */
export type ApprovalEvent = {
  id: string
  event_type: string
  title: string
  body: string | null
  actor_name: string
  created_at: string
  meta: Record<string, unknown> | null
}

export type ApprovalDetail = {
  approval: ApprovalRow
  stages: (StageRow & { assignees: AssigneeRow[]; decisions: DecisionRow[] })[]
  /** The reminder ladder and the lapse, in order. Empty rather than absent
   *  when the reader cannot see activity_log — a thinner record, never an
   *  error, and never a reason to hide the rest. */
  events: ApprovalEvent[]
}

export type ListApprovalsParams = {
  /** Crew reads pass the org; portal reads pass the company. Both are
   *  resolved from the SESSION by the route, never from the query string
   *  (I-6), and both are stated explicitly rather than left to RLS (I-9) —
   *  RLS is the boundary, the filter is the intent. */
  orgId?: string
  clientId?: string
  projectId?: string | null
  status?: ApprovalStatus | null
  cursor?: string | null
  limit?: number
}

export async function listApprovals(
  db: SupabaseClient,
  params: ListApprovalsParams
): Promise<{ approvals: ApprovalRow[]; nextCursor: string | null; hasMore: boolean }> {
  const { orgId, clientId, projectId, status, cursor = null } = params
  const limit = Math.min(Math.max(params.limit ?? APPROVAL_PAGE_SIZE, 1), APPROVAL_PAGE_SIZE)

  let decoded: KeysetCursor | null = null
  try {
    decoded = decodeCursor(cursor)
  } catch {
    throw new Error('Malformed cursor')
  }

  let q = db.from('approvals').select(APPROVAL_COLUMNS).is('deleted_at', null)
  if (orgId) q = q.eq('organization_id', orgId)
  if (clientId) q = q.eq('client_id', clientId)
  if (projectId) q = q.eq('project_id', projectId)
  if (status) q = q.eq('status', status)
  if (decoded) q = q.or(beforePredicate(decoded))

  // limit + 1 is how "hasMore" is answered without a second count query.
  const { data, error } = await q
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)
  if (error) throw new Error(`listApprovals: ${error.message}`)

  const rows = (data ?? []) as unknown as ApprovalRow[]
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const last = page[page.length - 1]
  return {
    approvals: page,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor({ t: last.created_at, id: last.id }) : null,
  }
}

/**
 * One approval with its whole chain — the Review & Approval page's read
 * (S3-c §3.2) and the certificate's (item 10).
 *
 * EVERY decision and EVERY comment is returned to EVERY reader who can see the
 * approval. That is AP-4 and it is deliberate: who may COMMENT is controlled,
 * what is RECORDED is not, and a read-side filter here would be the thing that
 * makes a review look cleaner than it was. Returns null when RLS hides the
 * approval, which is also how "not in your tenant" arrives — one answer for
 * absent and forbidden, so a probe learns nothing.
 */
export async function readApproval(
  db: SupabaseClient,
  approvalId: string
): Promise<ApprovalDetail | null> {
  const { data: approvalData, error } = await db
    .from('approvals').select(APPROVAL_COLUMNS).eq('id', approvalId).is('deleted_at', null).maybeSingle()
  if (error) throw new Error(`readApproval: ${error.message}`)
  if (!approvalData) return null
  const approval = approvalData as unknown as ApprovalRow

  const { data: stageData } = await db
    .from('approval_stages').select(STAGE_COLUMNS).eq('approval_id', approvalId).order('seq')
  const stages = (stageData ?? []) as unknown as StageRow[]
  const stageIds = stages.map((s) => s.id)

  // Reminders and the lapse. Bounded (I-1) — a review with more than 200
  // ledger events is pathological, and the cap is stated rather than implied.
  const { data: eventData } = await db
    .from('activity_log')
    .select('id, event_type, title, body, actor_name, created_at, meta')
    .eq('meta->>approval_id', approvalId)
    .order('created_at', { ascending: true })
    .limit(200)
  const events = (eventData ?? []) as unknown as ApprovalEvent[]

  if (stageIds.length === 0) return { approval, stages: [], events }

  const [{ data: assigneeData }, { data: decisionData }] = await Promise.all([
    db.from('approval_assignees')
      .select('id, stage_id, user_id, client_id, role, required').in('stage_id', stageIds),
    db.from('approval_decisions')
      .select('id, stage_id, actor_id, actor_name, decision, comment, decided_at')
      .in('stage_id', stageIds).order('decided_at', { ascending: true }),
  ])
  const assignees = (assigneeData ?? []) as unknown as AssigneeRow[]
  const decisions = (decisionData ?? []) as unknown as DecisionRow[]

  return {
    approval,
    events,
    stages: stages.map((s) => ({
      ...s,
      assignees: assignees.filter((a) => a.stage_id === s.id),
      // A LATE OBJECTION is a decision recorded against a stage that has
      // already advanced (S3-c §2.5). It is returned here like any other,
      // with its timestamp, because hiding it is the same error as writing a
      // timeout as an approval.
      decisions: decisions.filter((d) => d.stage_id === s.id),
    })),
  }
}

// ── the legacy task projection (RULE ZERO) ──────────────────────────────────
//
// There is no function here, and that is the decision.
//
// RULE ZERO: the tasks-based approval path is LIVE. `requires_approval`,
// `approval_status`, `visible_to_client` — and three MORE the brief did not
// name, which the item-0 audit found: `approved_at`, `approval_note` and
// `auto_proceeded` — are read by both existing approval pages, TaskBoard, both
// project details, both badge routes and the Batch 12.2 rail badges. Nothing
// stops writing them. The approval rows are the AUTHORITY; those columns are a
// PROJECTION, and they drop in a later batch once this has been live.
//
// The projection was first written HERE, in TypeScript, and it could not work:
// `tasks` is crew-writable only (tasks_client_read is SELECT), so the portal
// decide path would have produced a PostgREST update matching zero rows and
// returning no error — the identical silent no-op that 0039 exists to end, one
// table over. So it lives in 0041 as a trigger on `approvals`, which fires for
// every writer including 0039's own nested update, and needs no privilege the
// caller does not have.
//
// See supabase/migrations/0041_task_projection.sql for the mapping, including
// the one that matters: 'auto_advanced' projects as 'auto_advanced', never as
// 'approved' and never as the retired 'auto_approved'.

// ── the task bridge (item 8) ────────────────────────────────────────────────

/**
 * Get-or-open the live approval for a task gate, and reopen it on a re-send.
 *
 * This is where the LEGACY gate flow meets the engine. Both existing send
 * paths (`resend_approval` and `attach_task_media`) funnel through
 * `recordGateSent`, so hooking there means every gate send — today's and
 * tomorrow's — opens a real approval without either call site changing shape.
 *
 * IDEMPOTENT, because `recordGateSent` is not guaranteed to run once: a live
 * approval for the task is reused rather than duplicated. Two approvals
 * against one task would be two records disagreeing about the same sign-off,
 * which is the failure S3-c §3 opens with.
 *
 * A RE-SEND after "changes requested" REOPENS rather than creating a second
 * approval. The stage goes back to 'active' with a FRESH deadline — the
 * client's window restarts when the new work is offered, not from the original
 * request, because they cannot be expected to review something that did not
 * exist yet. The blocked stage's decisions stay exactly where they are: the
 * request for changes is part of the permanent record (AP-4), not something
 * the re-send erases.
 *
 * Returns null when the task is not a client-facing gate — internal tasks and
 * invisible ones open nothing, and that is not an error.
 */
export async function ensureApprovalForTaskGate(
  db: SupabaseClient,
  params: {
    orgId: string
    taskId: string
    taskTitle: string
    projectId: string | null
    clientId: string | null
    actorId: string
    actorName: string
  }
): Promise<ApprovalRow | null> {
  const { orgId, taskId, taskTitle, projectId, clientId, actorId, actorName } = params
  if (!clientId) return null // an internal task gates nothing external

  const { data: existingData } = await db
    .from('approvals')
    .select(APPROVAL_COLUMNS)
    .eq('subject_kind', 'task')
    .eq('subject_id', taskId)
    .eq('organization_id', orgId)
    // THE COUNTERPARTY IS PART OF THE IDENTITY. Without this, a client gate
    // would reuse an INTERNAL approval (client_id null) that happens to be
    // open against the same task — silently turning the studio's own review
    // into the client's sign-off, and inheriting its card, its assignees and
    // its window. That is S3-core-A A-4's failure (a null counterparty
    // converting the meaning of a record) reached from the other direction.
    // Found by probe: the harness's internal fixture was reused for a client
    // gate on the same task.
    .eq('client_id', clientId)
    .is('deleted_at', null)
    .in('status', ['open', 'changes_requested'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const existing = existingData as unknown as ApprovalRow | null

  if (existing) {
    if (existing.status !== 'changes_requested') return existing

    // Reopen: the blocked stage becomes active again on a fresh clock.
    const hours = existing.review_window_hours ?? (await orgWindowHours(db, orgId))
    const { data: blocked } = await db
      .from('approval_stages').select('id')
      .eq('approval_id', existing.id).eq('status', 'blocked_on_changes')
      .order('seq').limit(1).maybeSingle()
    if (blocked) {
      await db.from('approval_stages')
        .update({ status: 'active', deadline_at: hoursFromNow(hours), advanced_at: null })
        .eq('id', (blocked as { id: string }).id)
    }
    await db.from('approvals').update({ status: 'open' }).eq('id', existing.id)
    return { ...existing, status: 'open' }
  }

  const { approval } = await createApproval(db, {
    orgId, actorId, actorName, actorRole: 'admin',
    subjectKind: 'task', subjectId: taskId,
    title: taskTitle || 'Approval',
    clientId, projectId,
    stages: [
      {
        name: 'Client sign-off',
        // Addressed to the COMPANY, not a named person: whoever holds the
        // seat can act, and someone leaving cannot deadlock it
        // (S3-core §2.4).
        assignees: [{ clientId }],
      },
    ],
  })
  return approval
}
