import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { listClientEntries, type CalendarEntry } from '@/lib/calendar'

/**
 * THE CLIENT'S CALENDAR — dates that say what happens if you do nothing.
 *
 * ── WHAT THE MARKET DOES ─────────────────────────────────────────────────
 *
 * Every client portal in this category — the agency ones, the accounting ones,
 * Moxo, Assembly, Copilot — offers the same thing: a list of pending items with
 * due dates, an escalating reminder ladder (a nudge at 3 days, urgency at 1, an
 * overdue flag after), and an approval history for compliance. Genreline already
 * has all three: the sweep's reminder ladder, `approval_decisions`, and the
 * printable certificate.
 *
 * **AND ALL OF THEM ARE PASSIVE.** The deadline reminds you; if you ignore it,
 * the only thing that happens is the badge turns red. That is the whole category.
 *
 * ── WHAT THIS DOES: THE DEADLINE ACTS ───────────────────────────────────
 *
 * `S3-c` made silence a decision — an active stage with a deadline auto-advances
 * and is recorded as `auto_advanced` with no actor. So this calendar can write a
 * sentence no other product is able to write truthfully:
 *
 *     "If nobody responds by Thursday 5:00 PM, this is approved and the
 *      production moves on."
 *
 * Google Calendar cannot say it. Neither can any portal that merely displays a
 * date, because the sentence is only true in the system that will actually do
 * the thing. **This is the one place where being the whole production system
 * instead of a calendar is worth something to the client rather than to us.**
 *
 * ── AND THE ORDER IS BY WHOSE MOVE IT IS, NOT BY DATE ───────────────────
 *
 * A chronological list buries the one row that costs money under three shoot
 * days somebody is merely being informed about. `move` answers "is this mine?"
 * first; the date orders within that.
 *
 * ── WHAT IS DELIBERATELY ABSENT ─────────────────────────────────────────
 *
 * `approvalIntel`'s grading. The studio sees how well its own record would hold
 * up in a dispute; the client does not (CLAUDE.md). A CONSEQUENCE is a different
 * thing from a grade — it is a fact about what this system will do next, and the
 * client is the party entitled to it.
 */

export type Move = 'you' | 'studio' | 'noone'

export type AgendaItem = {
  entry: CalendarEntry
  move: Move
  /** What happens if nobody acts. Null where nothing happens — a shoot day
   *  passes whether or not anybody reads about it, and inventing urgency for it
   *  would make the rows that matter worth less. */
  consequence: string | null
  /** Already past its moment. Kept and shown rather than hidden: a client must
   *  never learn after the fact that something lapsed on their silence. */
  lapsed: boolean
  href: string | null
}

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

/**
 * The agenda, decorated.
 *
 * `db` is the USER client throughout, so `calendar_entries_client_read` decides
 * what exists and the stage/assignee reads run through 0038's read-through-the-
 * parent policies. Nothing here filters in application code — a filter would be
 * a second access rule that drifts from the first.
 */
export async function clientAgenda(
  db: SupabaseClient, userId: string, opts?: { from?: Date; to?: Date }
): Promise<AgendaItem[]> {
  const from = opts?.from ?? new Date(Date.now() - 30 * 86_400_000)
  const to = opts?.to ?? new Date(Date.now() + 120 * 86_400_000)
  // NO organization filter — see `listClientEntries`. The client policy is the
  // whole scope, and an org predicate on a claim a client may not carry would
  // render an empty calendar instead of an error.
  const entries = await listClientEntries(db, from, to)

  const stageIds = entries
    .filter((e) => e.source_kind === 'approval_stage' && e.source_id)
    .map((e) => e.source_id as string)
  const invoiceIds = entries
    .filter((e) => e.source_kind === 'invoice' && e.source_id)
    .map((e) => e.source_id as string)

  // TWO QUERIES FOR THE WHOLE PAGE, not two per row. The same argument
  // `listApprovalChains` makes about the Review surface.
  const [stagesRes, mineRes, invRes] = await Promise.all([
    stageIds.length
      ? db.from('approval_stages')
          .select('id, approval_id, status, deadline_at, name').in('id', stageIds)
      : Promise.resolve({ data: [] as unknown[] }),
    stageIds.length
      ? db.from('approval_assignees')
          .select('stage_id').in('stage_id', stageIds).eq('user_id', userId)
      : Promise.resolve({ data: [] as unknown[] }),
    // A client member WITHOUT `portal.invoices` reads zero rows here (0053), and
    // that is correct rather than a bug to work around: they still see the date,
    // they just do not learn the amount or whether it is outstanding.
    invoiceIds.length
      ? db.from('invoices').select('id, status').in('id', invoiceIds)
      : Promise.resolve({ data: [] as unknown[] }),
  ])

  const stages = new Map(
    ((stagesRes.data ?? []) as unknown[]).map((r) => {
      const s = r as { id: string; approval_id: string; status: string; deadline_at: string | null }
      return [s.id, s]
    })
  )
  const mine = new Set(
    ((mineRes.data ?? []) as unknown[]).map((r) => (r as { stage_id: string }).stage_id)
  )
  const invoices = new Map(
    ((invRes.data ?? []) as unknown[]).map((r) => {
      const i = r as { id: string; status: string }
      return [i.id, i.status]
    })
  )

  const now = Date.now()

  return entries.map<AgendaItem>((entry) => {
    const at = Date.parse(entry.starts_at)
    const lapsed = at < now

    if (entry.kind === 'approval_deadline' && entry.source_id) {
      const stage = stages.get(entry.source_id)
      const active = stage?.status === 'active'
      return {
        entry,
        // Assignee first, because naming the person is strictly better than
        // naming the company. Falling back to the company is still true: the
        // approval reached this calendar because it is addressed to them.
        move: active ? 'you' : 'noone',
        consequence: active
          // ── THE TENSE IS A CORRECTNESS PROPERTY, NOT A STYLE ONE ───────
          //
          // An ACTIVE stage whose deadline has already passed is the state
          // between the deadline and the next sweep, and it is common — the
          // sweep runs daily. "If you do nothing by Tuesday" about last Tuesday
          // is grammatical, confident and FALSE, and somebody would act on it.
          //
          // This is the same defect `approvalIntel` shipped once and had to be
          // corrected for (HANDOFF §12), arriving in a second module written by
          // somebody who had read the lesson. A probe found it here before it
          // reached a client, which is the only reason to write probes that
          // read the sentence rather than the row.
          ? lapsed
            ? `The deadline has passed. Unless somebody responds now, this is approved automatically the next time the record is swept — and it goes down as an automatic advance, not as a sign-off.`
            : mine.has(entry.source_id)
              ? `You are being waited on. If you do nothing by ${when(entry.starts_at)}, this is approved automatically and the production moves on.`
              : `Your company is being waited on. If nobody responds by ${when(entry.starts_at)}, this is approved automatically and the production moves on.`
          : stage?.status === 'auto_advanced'
            // THE PART NOBODY IS TOLD ANYWHERE ELSE. It already happened, on
            // silence, and hiding it would make the record something the client
            // discovers from its consequences.
            ? 'Nobody responded in time, so this was approved automatically. It is on the record as an automatic advance, not as a sign-off.'
            : null,
        lapsed,
        href: stage ? `/approvals/${stage.approval_id}` : '/approvals',
      }
    }

    if (entry.kind === 'invoice_due' && entry.source_id) {
      const status = invoices.get(entry.source_id)
      const outstanding = status !== undefined && status !== 'paid'
      return {
        entry,
        move: outstanding ? 'you' : 'noone',
        consequence: outstanding && lapsed
          ? 'This was due and is still outstanding.'
          : outstanding
            ? 'Payment is due on this date.'
            : null,
        lapsed,
        href: '/invoices',
      }
    }

    if (entry.kind === 'meeting') {
      return { entry, move: 'noone', consequence: null, lapsed, href: '/dashboard/meetings' }
    }

    // Shoot days and anything the studio typed by hand: information, and it
    // should read as information. No urgency is manufactured for it.
    return { entry, move: 'noone', consequence: null, lapsed, href: null }
  })
}

/**
 * Yours first, then by date.
 *
 * A chronological list is the obvious ordering and the wrong one: it buries the
 * decision that will lapse on Thursday under three shoot days in between.
 * Lapsed items sink, because the actionable version of the past is short.
 */
export function orderAgenda(items: AgendaItem[]): AgendaItem[] {
  // A LAPSED ROW THAT IS STILL YOUR MOVE STAYS AT THE TOP. An active stage past
  // its deadline is the single most urgent thing this page can show — it is
  // about to be decided by silence — and sorting it into "already passed" would
  // file the emergency under history.
  const rank = (i: AgendaItem) =>
    i.move === 'you' ? 0 : i.lapsed ? 2 : 1
  return [...items].sort((a, b) => {
    const r = rank(a) - rank(b)
    if (r !== 0) return r
    const at = Date.parse(a.entry.starts_at)
    const bt = Date.parse(b.entry.starts_at)
    // Within the lapsed group the most RECENT is the interesting one; elsewhere
    // the soonest is.
    return a.lapsed ? bt - at : at - bt
  })
}

/** How long until it matters, in the words a person would use. */
export function untilPhrase(iso: string, now = Date.now()): string {
  const ms = Date.parse(iso) - now
  if (ms < 0) {
    const d = Math.floor(-ms / 86_400_000)
    if (d === 0) return 'earlier today'
    return d === 1 ? 'yesterday' : `${d} days ago`
  }
  const hours = ms / 3_600_000
  if (hours < 1) return `in ${Math.max(1, Math.round(ms / 60_000))} minutes`
  if (hours < 24) return `in ${Math.round(hours)} hour${Math.round(hours) === 1 ? '' : 's'}`
  const days = Math.round(hours / 24)
  return days === 1 ? 'tomorrow' : `in ${days} days`
}
