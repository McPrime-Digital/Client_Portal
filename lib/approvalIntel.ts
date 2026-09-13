/**
 * APPROVAL INTELLIGENCE — the strength of the record, computed before anybody
 * needs it.
 *
 * `S3-c` makes approval a RECORD rather than a status, and `S-S` §2.1 calls that
 * the strongest differentiator in the product. But a record's value is entirely
 * in how it reads ON THE DAY IT IS DISPUTED, and that is the one day you cannot
 * go back and improve it. Every competitor shows you an approval's STATE. None
 * of them shows you how well your own audit trail would hold up.
 *
 * That is what this file answers, in one sentence per approval, while there is
 * still time to fix it.
 *
 * THE SENTENCE THAT HAS TO SURVIVE CONTACT WITH A LAWYER is the one
 * `ApprovalCertificate` prints on an auto-advance:
 *
 *   No response was received by the agreed review date. Work proceeded under the
 *   review window in the production agreement. This is not a client approval.
 *
 * That sentence is strong when three things are true — there was an agreed date,
 * somebody was actually asked, and the asking was DELIVERED. It is worthless
 * when any of them is false, and the engine will produce it either way. So this
 * grades the evidence:
 *
 *   strong — an agreed deadline, a named recipient, reminders that landed
 *   thin   — proceeding is arguable, but the trail is thinner than it should be
 *   broken — the record would assert silence it cannot support
 *
 * BROKEN IS NOT HYPOTHETICAL, and the path to it is a supported operation.
 * `approval_assignees.client_id` is `on delete cascade` (0038:199). Deleting a
 * client company therefore deletes the assignee rows pointing at it, and the
 * sweep's `anyAssigneeCanDecide()` deliberately returns `any: true` for a stage
 * with zero recipients (approval-sweep:172, citing `S3-core` §2.4 — "a departed
 * member neither blocks nor receives"). That reasoning is sound for ONE departed
 * assignee among several. Where it empties the stage, the window still lapses
 * and the certificate still prints the sentence above — about a review nobody
 * was ever able to receive.
 *
 * This file does not change that behaviour. Auto-advance semantics are
 * `S3-core` §2.4's to settle and the decision is the owner's, not a side effect
 * of building a surface. What it does is refuse to let it be invisible.
 *
 * Pure, synchronous, no I/O, no imports: a server page and a client component
 * both call it, and `now` is injected so the result is testable.
 *
 * ONE PRECONDITION, AND IT IS A PERMISSION. The reminder ladder lives in
 * `activity_log`, so a caller whose read of that table is NARROWER than its read
 * of the approval will see zero reminders and be told the record is `broken` —
 * a false alarm produced by invisibility rather than by a thin trail. On the
 * studio side the two match by construction (`activity_log_crew_all` and
 * `approvals_crew_read` carry the same org + membership + `org_project_visible`
 * predicate, so an approval you can see is one whose ledger you can see). Before
 * calling this from anywhere else — the portal especially, where
 * `activity_log_client_read` additionally clips on `member_history_from()` —
 * check that the two reads agree, or the grade is measuring access.
 */

export type Defensibility = 'strong' | 'thin' | 'broken'

/** Who the next move belongs to. Not a status — a status says what HAPPENED. */
export type WaitingOn = 'studio' | 'client' | 'nobody'

export type BlockedReason = 'permission' | 'no_assignees'

export type IntelAssignee = {
  user_id?: string | null
  client_id?: string | null
  role?: string | null
}

export type IntelDecision = {
  decision: string
  decided_at: string
}

export type IntelStage = {
  id: string
  seq: number
  name: string
  status: string
  deadline_at: string | null
  advanced_at: string | null
  assignees?: IntelAssignee[] | null
  decisions?: IntelDecision[] | null
}

export type IntelEvent = {
  event_type: string
  created_at: string
  meta?: Record<string, unknown> | null
}

export type IntelApproval = {
  status: string
  client_id?: string | null
  review_window_hours?: number | null
  created_at: string
}

export type IntelInput = {
  approval: IntelApproval
  stages: IntelStage[]
  events?: IntelEvent[] | null
}

export type ApprovalIntel = {
  waitingOn: WaitingOn
  /** The stage the approval is actually sitting on, if any. */
  activeStage: { id: string; name: string; seq: number } | null
  deadlineAt: string | null
  /** Negative when the deadline has passed. Null when there is no deadline. */
  hoursLeft: number | null
  overdue: boolean
  remindersDelivered: number
  remindersFailed: number
  /** Distinct recipients a reminder actually REACHED. Zero is the headline. */
  peopleReached: number
  blocked: BlockedReason | null
  /** True once the record rests on silence rather than on a decision. */
  restsOnSilence: boolean
  defensibility: Defensibility
  /** One plain sentence. Written for the owner, not for a developer. */
  because: string
}

const HOUR = 3_600_000

const TERMINAL = new Set(['approved', 'rejected', 'withdrawn'])

/**
 * A stage is addressed to the CLIENT when any assignee names a client company.
 * Otherwise it is the studio's own move — including a role-only assignee, which
 * is a crew role by construction (a client-side role is expressed as the
 * company). Stated rather than inferred, because guessing the side wrong turns
 * "waiting on you" into "waiting on them", which is the one thing this number
 * must never get backwards.
 */
function sideOf(stage: IntelStage): 'client' | 'studio' {
  const a = stage.assignees ?? []
  return a.some((x) => x.client_id != null) ? 'client' : 'studio'
}

/** Reminders belong to a stage when the ledger says so, and to the approval
 *  otherwise — older rows predate `stage_id` in meta and must still count. */
function remindersFor(events: IntelEvent[], stageId: string | null) {
  const rows = events.filter((e) => e.event_type === 'approval_reminded')
  const mine = stageId
    ? rows.filter((e) => {
        const s = e.meta?.stage_id
        return s == null || s === stageId
      })
    : rows

  let delivered = 0
  let failed = 0
  const reached = new Set<string>()
  for (const e of mine) {
    // `delivered` is absent on older rows and absence is not failure — the
    // ladder recorded the send before it recorded the outcome.
    if (e.meta?.delivered === false) {
      failed += 1
      continue
    }
    delivered += 1
    const who = e.meta?.recipient
    if (typeof who === 'string' && who.length > 0) reached.add(who)
  }
  return { delivered, failed, reached: reached.size }
}

export function approvalIntel(input: IntelInput, opts?: { now?: Date }): ApprovalIntel {
  const now = opts?.now ?? new Date()
  const events = input.events ?? []
  const stages = [...input.stages].sort((a, b) => a.seq - b.seq)

  const active = stages.find((s) => s.status === 'active') ?? null
  const lapsed = stages.filter((s) => s.status === 'auto_advanced')
  const permissionBlocked = stages.find((s) => s.status === 'blocked_on_permission') ?? null

  // The stage the evidence is ABOUT: the one in flight, or the last one that
  // proceeded without an answer.
  const subject = active ?? lapsed[lapsed.length - 1] ?? null
  const { delivered, failed, reached } = remindersFor(events, subject?.id ?? null)

  const emptyStage = subject != null && (subject.assignees ?? []).length === 0
  const blocked: BlockedReason | null = permissionBlocked
    ? 'permission'
    : active && emptyStage
      ? 'no_assignees'
      : null

  // WAITING ON. `changes_requested` is the case a status-shaped model gets
  // wrong: the client HAS responded, and the ball is the studio's.
  let waitingOn: WaitingOn
  if (input.approval.status === 'changes_requested') {
    waitingOn = 'studio'
  } else if (TERMINAL.has(input.approval.status)) {
    waitingOn = 'nobody'
  } else if (active) {
    waitingOn = emptyStage ? 'nobody' : sideOf(active)
  } else {
    waitingOn = 'nobody'
  }

  const deadlineAt = subject?.deadline_at ?? null
  const hoursLeft = deadlineAt
    ? (Date.parse(deadlineAt) - now.getTime()) / HOUR
    : null
  const overdue = hoursLeft != null && hoursLeft < 0

  const decided = stages.some((s) => (s.decisions ?? []).length > 0)
  // The record rests on silence once a stage has lapsed, and — the useful half —
  // it WILL rest on silence for anything still open on a deadline.
  const restsOnSilence =
    lapsed.length > 0 || input.approval.status === 'auto_advanced' || (active != null && deadlineAt != null)

  let defensibility: Defensibility
  let because: string

  if (blocked === 'permission') {
    defensibility = 'broken'
    because = 'Nobody assigned can approve this. The window is not running, and the record would show a lockout rather than a non-response.'
  } else if (blocked === 'no_assignees' || (emptyStage && lapsed.length > 0)) {
    defensibility = 'broken'
    // Tense matters here more than anywhere else on this surface. "If it
    // lapses" is advice; "it already did" is a liability that exists now, and
    // the first live run of this file said the former about the latter.
    because = subject?.status === 'auto_advanced'
      ? 'This stage was addressed to nobody, and it has already proceeded. The certificate asserts that no response was received from a person who was never asked.'
      : 'This stage is addressed to nobody. If it lapses, the certificate asserts that no response was received from a person who was never asked.'
  } else if (active && deadlineAt == null) {
    // NOT "strong". A stage with no date can never lapse — `advanceOnSilence`
    // is only ever reached through a deadline — so this one waits forever, and
    // an earlier version of this file graded it well-evidenced while a client
    // sat on it. Waiting indefinitely is a failure state that looks like calm.
    defensibility = 'thin'
    because = 'No review date is set, so this stage can never lapse. It waits indefinitely unless somebody responds.'
  } else if (!restsOnSilence) {
    // A human decided, or nothing is pending. Evidence is not load-bearing.
    defensibility = 'strong'
    because = decided
      ? 'Decided by a person, on the record. Nothing here depends on silence.'
      : 'Nothing is waiting on a review window.'
  } else if (delivered === 0) {
    defensibility = 'broken'
    because = failed > 0
      ? `Every reminder failed to deliver (${failed}). Proceeding on silence is not defensible when nothing arrived.`
      : 'No reminder has been delivered yet. Proceeding on silence needs evidence that somebody was asked.'
  } else if (deadlineAt == null) {
    defensibility = 'thin'
    because = 'No review date is set, so there is no agreed moment for silence to become a decision.'
  } else if (failed > 0 && delivered < 2) {
    defensibility = 'thin'
    because = `${failed} of ${failed + delivered} reminders failed to deliver. One that landed is thin ground for proceeding.`
  } else if (delivered < 2) {
    defensibility = 'thin'
    because = 'One reminder delivered. A second, before the date, is what makes proceeding hard to argue with.'
  } else {
    defensibility = 'strong'
    because = `${delivered} reminders delivered to ${reached || 1} recipient${(reached || 1) === 1 ? '' : 's'} against an agreed date. Proceeding on silence is well supported.`
  }

  return {
    waitingOn,
    activeStage: active ? { id: active.id, name: active.name, seq: active.seq } : null,
    deadlineAt,
    hoursLeft,
    overdue,
    remindersDelivered: delivered,
    remindersFailed: failed,
    peopleReached: reached,
    blocked,
    restsOnSilence,
    defensibility,
    because,
  }
}

/** Short label for the badge. The sentence carries the meaning; this is a tag. */
export const DEFENSIBILITY_LABEL: Record<Defensibility, string> = {
  strong: 'Well evidenced',
  thin: 'Thin evidence',
  broken: 'Would not hold',
}
