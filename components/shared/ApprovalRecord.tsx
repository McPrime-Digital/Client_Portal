'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ScanEye, Clock, FileText, ChevronRight } from 'lucide-react'
import { approvalTimeline, TIMELINE_TONE } from '@/lib/approvalTimeline'
import type { Clearance } from '@/lib/rights'
import ClearancePanel from '@/components/shared/ClearancePanel'

/**
 * The Review & Approval record — Batch 22 item 9 (S3-c §3.2).
 *
 * THE THIRD SURFACE, and the one whose purpose is being un-arguable. Every
 * review, decision, reminder, lapse and late objection, timestamped,
 * attributed, in order. This is the export surface and the dispute surface.
 *
 * AP-4, and it is a rule about this component specifically: ALL COMMENTS ARE
 * VISIBLE TO EVERYONE IN THE REVIEW. There is a capability check on WRITE
 * (0038's comment-permission policy) and NOTHING on read — no visibility
 * table, no per-comment filter, no read-side branching anywhere below. The
 * moment a permission can make a review look cleaner than it was, this page
 * stops being the thing you cannot argue with.
 *
 * LATE OBJECTIONS ARE SHOWN, NOT HIDDEN (S3-c §2.5). A decision recorded
 * against a stage that already advanced is rendered with its timestamp and
 * labelled as what it is. "We proceeded on day 4; you objected on day 6" is a
 * fact worth holding, and hiding it would be the same error as writing a
 * timeout as an approval.
 */

type Decision = {
  id: string
  actor_name: string
  decision: 'approved' | 'rejected' | 'changes_requested'
  comment: string | null
  decided_at: string
}

type Stage = {
  id: string
  seq: number
  name: string
  status: 'pending' | 'active' | 'complete' | 'auto_advanced' | 'blocked_on_changes' | 'blocked_on_permission'
  deadline_at: string | null
  advanced_at: string | null
  decisions: Decision[]
}

type Event = {
  id: string
  event_type: string
  title: string
  body: string | null
  actor_name: string
  created_at: string
  meta: Record<string, unknown> | null
}

type Detail = {
  approval: {
    id: string
    title: string
    status: 'open' | 'approved' | 'rejected' | 'changes_requested' | 'auto_advanced' | 'withdrawn'
    subject_kind: string
    client_id: string | null
    created_at: string
    review_window_hours: number | null
  }
  stages: Stage[]
  events: Event[]
  /** Rights and AI disclosure on the asset, where the subject is a file and
   *  anything is recorded. Null is "not applicable here", never "cleared" —
   *  `lib/rights.ts` is the only thing allowed to answer that question. */
  clearance?: Clearance | null
}

type Row = { id: string; title: string; status: Detail['approval']['status']; created_at: string }

const STATUS_LABEL: Record<Detail['approval']['status'], string> = {
  open: 'Awaiting review',
  approved: 'Approved',
  rejected: 'Rejected',
  changes_requested: 'Changes requested',
  auto_advanced: 'Proceeded — no response',
  withdrawn: 'Withdrawn',
}

const ts = (s: string) =>
  new Date(s).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })

/**
 * The timeline moved to `lib/approvalTimeline.ts` (S-S Phase C) so this
 * accordion and the addressable record page at
 * /studio/client/review/[id] render the SAME chain from the same code.
 * Two copies of a dispute document is the one duplication that cannot be
 * allowed to drift.
 */
const timeline = approvalTimeline
const TONE = TIMELINE_TONE

export default function ApprovalRecord({ side }: { side: 'studio' | 'portal' }) {
  const base = side === 'studio' ? '/api/studio/approvals' : '/api/portal/approvals'
  const [rows, setRows] = useState<Row[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(base)
      .then((r) => (r.ok ? r.json() : { approvals: [] }))
      .then((j) => { if (!cancelled) setRows((j.approvals ?? []) as Row[]) })
      .catch(() => { if (!cancelled) setRows([]) })
    return () => { cancelled = true }
  }, [base])

  const open = useCallback(async (id: string) => {
    if (openId === id) { setOpenId(null); setDetail(null); return }
    setOpenId(id)
    setDetail(null)
    try {
      const res = await fetch(`${base}/${id}`)
      if (res.ok) setDetail((await res.json()) as Detail)
    } catch { /* the list stays; the chain simply does not open */ }
  }, [base, openId])

  // Still loading: nothing, rather than a shell that resolves into a different
  // shape a moment later.
  if (!rows) return null

  // EMPTY IS ONBOARDING, NOT ABSENCE (SS-6). This used to return null, which
  // meant the strongest thing in the product was invisible to every studio that
  // had not already used it — you cannot discover a differentiator that renders
  // nothing. It stays ONE LINE, because the legacy task queue below is still
  // the live surface on both pages until its columns drop, and an empty record
  // must not push a working queue down the page.
  if (rows.length === 0) {
    return (
      <section className="mb-8 flex items-center gap-2 text-[12px] text-muted-foreground">
        <ScanEye size={14} className="shrink-0 text-faint" />
        <span>
          Every review, decision, reminder and lapse is recorded here — timestamped and
          attributed — as soon as the first approval is sent.
        </span>
      </section>
    )
  }

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <ScanEye size={16} className="text-primary" />
        <h2 className="font-display text-sm font-semibold text-foreground">The record</h2>
        <span className="text-[11px] text-muted-foreground">
          every review, decision, reminder and lapse — timestamped and attributed
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {rows.map((r) => (
          <div key={r.id} className="border-b border-border last:border-0">
            <button
              type="button"
              onClick={() => void open(r.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/40"
            >
              <FileText size={14} className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-foreground">{r.title}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {STATUS_LABEL[r.status]} · opened {ts(r.created_at)}
                </span>
              </span>
              <ChevronRight
                size={14}
                className="shrink-0 text-muted-foreground transition-transform"
                style={{ transform: openId === r.id ? 'rotate(90deg)' : undefined }}
              />
            </button>

            {openId === r.id && detail && (
              <div className="border-t border-border bg-background/40 px-4 py-3">
                {/* WHAT YOU ARE BEING ASKED TO APPROVE, AND WHAT IT IS CLEARED
                    FOR — above the chain, because it is a precondition of the
                    decision rather than a note about it. The same component the
                    studio's record renders: two renderings of a clearance is
                    two things that can disagree. */}
                {detail.clearance && (
                  <div className="mb-3">
                    <ClearancePanel clearance={detail.clearance} audience="client" />
                  </div>
                )}
                <ol className="space-y-2.5">
                  {timeline(detail).map((e, i) => (
                    <li key={i} className="flex gap-2.5 text-xs">
                      <span
                        className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: `hsl(${TONE[e.kind] ?? 'var(--border)'})` }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="text-foreground">
                          <strong className="font-medium">{e.who}</strong> · {e.what}
                        </span>
                        {e.detail && (
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">{e.detail}</span>
                        )}
                        <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Clock size={9} /> {ts(e.at)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>

                {timeline(detail).length === 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    Nothing has happened on this approval yet.
                  </p>
                )}

                {/* Two routes, not one with a role flag: the sides have
                    different gates (client capability matrix vs the studio
                    feature gate + crew roster), and a single branching route
                    is how one of those checks eventually goes missing. */}
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                  {/* The addressable record — S-S Phase C. Studio-side only,
                      and that asymmetry is deliberate: the client gets the
                      RECORD (this chain, and the certificate), the studio gets
                      the record plus a reading of how well its own evidence
                      would hold up. Grading the studio's trail is intelligence
                      for the party that has to act on it, not for the party it
                      may one day be used against. */}
                  {side === 'studio' && (
                    <Link
                      href={`/studio/client/review/${r.id}`}
                      className="inline-flex items-center gap-1.5 text-[11px] font-medium text-primary hover:underline"
                    >
                      Open full record <ChevronRight size={11} />
                    </Link>
                  )}
                  <Link
                    href={
                      side === 'studio'
                        ? `/studio/client/review/${r.id}/certificate`
                        : `/approvals/${r.id}/certificate`
                    }
                    className="inline-flex items-center gap-1.5 text-[11px] font-medium text-primary hover:underline"
                  >
                    Open printable certificate <ChevronRight size={11} />
                  </Link>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
