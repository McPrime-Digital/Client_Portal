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

/** One recorded viewing of the thing being approved, flattened to the three
 *  numbers that matter. `durationMs` null means the asset's length was never
 *  learned — an honest gap, and the reason `share` can be null. */
export type IntelView = {
  at: string
  who: string | null
  furthestMs: number
  durationMs: number | null
}

export type IntelInput = {
  approval: IntelApproval
  stages: IntelStage[]
  events?: IntelEvent[] | null
  /**
   * Recorded viewings of the subject through a screening link (0085).
   *
   * OPTIONAL AND UNDEFINED IS NOT EMPTY. `undefined` means "this caller did not
   * ask"; `[]` means "asked, and nothing was recorded". They must not grade the
   * same, which is why the type is not `IntelView[]`.
   */
  views?: IntelView[] | null
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
  /** What the approver actually saw, where anything was recorded. Null when
   *  nothing was — see `watchEvidence` on why that is not a finding. */
  viewing: WatchEvidence | null
}

/**
 * WHAT THE APPROVER ACTUALLY SAW.
 *
 * DocuSign's certificate of completion records that a document was VIEWED, when,
 * and from which IP — and nothing about how much of it was consumed, because a
 * page of text has no duration. Frame.io, Dropbox Replay and MediaSilo record
 * view analytics and never attach them to a decision. **Nobody joins the two**,
 * and in a production the join is the interesting part: somebody who opened a cut
 * for four seconds and approved it is not the same record as somebody who
 * watched ninety-two percent and approved it.
 *
 * ── ABSENCE OF EVIDENCE IS NOT EVIDENCE OF ABSENCE, AND THIS IS THE RULE ──
 *
 * The portal has its own player and it records nothing. So a client who watched
 * the whole cut inside the portal and then approved it leaves NO viewing rows,
 * and a grader that read that as "approved without watching" would be
 * confidently defaming the careful client while saying nothing about the
 * careless one.
 *
 * Therefore: this only ever speaks from POSITIVE evidence. No views → no
 * finding, and `defensibility` is untouched. A recorded token look → said
 * plainly, and `strong` drops to `thin` because that specific record genuinely
 * is thinner. It never reaches `broken`: `broken` is about a certificate
 * asserting silence it cannot support, which is a different claim entirely.
 */
export type WatchEvidence = {
  /** The furthest point reached across every recorded viewing, as a share of
   *  the asset. Null when no viewing knew the asset's length. */
  share: number | null
  views: number
  lastAt: string
  /** True only where a share IS known and it is token. */
  token: boolean
  sentence: string
}

const TOKEN_SHARE = 0.1

export function watchEvidence(views: IntelView[] | null | undefined): WatchEvidence | null {
  if (!views || views.length === 0) return null

  let furthest = 0
  let share: number | null = null
  let lastAt = views[0].at
  for (const v of views) {
    if (v.furthestMs > furthest) furthest = v.furthestMs
    if (v.durationMs && v.durationMs > 0) {
      const s = Math.min(1, v.furthestMs / v.durationMs)
      if (share === null || s > share) share = s
    }
    if (Date.parse(v.at) > Date.parse(lastAt)) lastAt = v.at
  }

  const n = views.length
  const plural = n === 1 ? 'viewing' : 'viewings'
  const token = share !== null && share < TOKEN_SHARE

  const sentence =
    share === null
      // No duration was ever reported — the player never learned it, or the
      // asset is not timed. Say what IS known rather than compute a share of
      // nothing.
      ? `${n} recorded ${plural} through a screening link. How much was watched is not known.`
      : token
        ? `The furthest anybody reached was ${Math.round(share * 100)}% of it, across ${n} ${plural}.`
        : share >= 0.95
          ? `Watched through, across ${n} ${plural}.`
          : `The furthest anybody reached was ${Math.round(share * 100)}%, across ${n} ${plural}.`

  return { share, views: n, lastAt, token, sentence }
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

  // ── WATCH EVIDENCE, APPLIED LAST AND ONLY DOWNWARD ─────────────────────
  //
  // A record that is otherwise well evidenced, about a cut whose only recorded
  // viewing reached three percent, is thinner than the reminder count alone
  // suggests. It never lifts a grade and never reaches `broken`: absent
  // evidence says nothing (the portal's own player records none), and `broken`
  // is a claim about a certificate asserting silence it cannot support.
  const viewing = watchEvidence(input.views)
  if (viewing?.token && defensibility === 'strong') {
    defensibility = 'thin'
    because = `${because} But ${viewing.sentence.charAt(0).toLowerCase()}${viewing.sentence.slice(1)}`
  }

  return {
    waitingOn,
    viewing,
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
