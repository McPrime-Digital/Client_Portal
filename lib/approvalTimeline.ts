/**
 * ONE flattened, ordered timeline: decisions and ledger events interleaved.
 *
 * Lifted out of `ApprovalRecord` so the accordion and the addressable record
 * page render the SAME chain from the same code. Two copies of this would drift
 * the way every other duplicated reader in this repo has, and the thing that
 * drifts here is a dispute document.
 *
 * The rules it encodes are `S3-c`'s, not presentation choices:
 *
 *   · LATE OBJECTIONS ARE SHOWN, NOT HIDDEN (§2.5). A decision recorded against
 *     a stage that already advanced is rendered with its timestamp and labelled
 *     as what it is. "We proceeded on day 4; you objected on day 6" is a fact
 *     worth holding, and hiding it is the same error as writing a timeout as an
 *     approval.
 *   · A REMINDER CARRIES ITS CHANNEL AND RECIPIENT (§2.4), because that is what
 *     makes proceeding without a response defensible — and a FAILED delivery is
 *     shown, since a reminder that bounced is evidence against the studio, not
 *     for it.
 *   · R-11's lockout is an entry of its own. Without it the timeline simply
 *     ends, and the reader infers the client ignored the request.
 *
 * Pure and synchronous — no I/O, no React.
 */

export type TimelineKind =
  | 'approved'
  | 'rejected'
  | 'changes_requested'
  | 'auto_advanced'
  | 'blocked_on_permission'
  | 'late'
  | 'reminder'
  | 'approval_created'
  | 'approval_withdrawn'

export type TimelineEntry = {
  at: string
  who: string
  what: string
  detail: string | null
  kind: TimelineKind | string
}

type TDecision = {
  actor_name: string
  decision: string
  comment: string | null
  decided_at: string
}

type TStage = {
  name: string
  status: string
  advanced_at: string | null
  decisions?: TDecision[] | null
}

type TEvent = {
  event_type: string
  title: string
  body: string | null
  actor_name: string
  created_at: string
  meta?: Record<string, unknown> | null
}

export function approvalTimeline(d: {
  stages: TStage[]
  events?: TEvent[] | null
}): TimelineEntry[] {
  const out: TimelineEntry[] = []

  for (const s of d.stages) {
    for (const dec of s.decisions ?? []) {
      const late =
        s.status === 'auto_advanced' && !!s.advanced_at && dec.decided_at > s.advanced_at
      out.push({
        at: dec.decided_at,
        who: dec.actor_name,
        what: late
          ? `${dec.decision.replace('_', ' ')} — recorded AFTER the review window closed`
          : dec.decision.replace('_', ' '),
        detail: dec.comment,
        kind: late ? 'late' : dec.decision,
      })
    }
    if (s.status === 'auto_advanced' && s.advanced_at) {
      out.push({
        at: s.advanced_at,
        who: 'System',
        what: `No response received on “${s.name}” — work proceeded`,
        detail: null,
        kind: 'auto_advanced',
      })
    }
  }

  for (const e of d.events ?? []) {
    if (e.event_type === 'approval_reminded') {
      const m = e.meta ?? {}
      out.push({
        at: e.created_at,
        who: 'System',
        what: e.title,
        detail: `${String(m.channel ?? 'email')} → ${String(m.recipient ?? 'recipient')}${
          m.delivered === false ? ' (delivery failed)' : ''
        }`,
        kind: 'reminder',
      })
    } else if (e.event_type === 'approval_blocked_on_permission') {
      out.push({
        at: e.created_at,
        who: 'System',
        what: e.title,
        detail: 'The review window did not lapse — nobody assigned could approve it.',
        kind: 'blocked_on_permission',
      })
    } else if (e.event_type === 'approval_created' || e.event_type === 'approval_withdrawn') {
      out.push({
        at: e.created_at,
        who: e.actor_name,
        what: e.title,
        detail: e.body,
        kind: e.event_type,
      })
    }
  }

  return out.sort((a, b) => a.at.localeCompare(b.at))
}

/** Colour per entry kind, as CSS custom-property expressions. */
export const TIMELINE_TONE: Record<string, string> = {
  approved: 'var(--primary)',
  rejected: 'var(--destructive)',
  changes_requested: 'var(--status-amber, var(--destructive))',
  auto_advanced: 'var(--muted-foreground)',
  blocked_on_permission: 'var(--destructive)',
  late: 'var(--destructive)',
  reminder: 'var(--muted-foreground)',
}
