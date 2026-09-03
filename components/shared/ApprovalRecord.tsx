'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ScanEye, Clock, FileText, ChevronRight } from 'lucide-react'

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
  status: 'pending' | 'active' | 'complete' | 'auto_advanced' | 'blocked_on_changes'
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

/** One flattened, ordered timeline: decisions and ledger events interleaved. */
function timeline(d: Detail) {
  const out: { at: string; who: string; what: string; detail: string | null; kind: string }[] = []
  for (const s of d.stages) {
    for (const dec of s.decisions) {
      const late = s.status === 'auto_advanced' && s.advanced_at && dec.decided_at > s.advanced_at
      out.push({
        at: dec.decided_at,
        who: dec.actor_name,
        what: late
          // Shown, never hidden (S3-c §2.5).
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
  for (const e of d.events) {
    if (e.event_type === 'approval_reminded') {
      const m = e.meta ?? {}
      out.push({
        at: e.created_at,
        who: 'System',
        what: e.title,
        // Channel and recipient, because that is what makes proceeding
        // without a response defensible (S3-c §2.4).
        detail: `${String(m.channel ?? 'email')} → ${String(m.recipient ?? 'recipient')}${m.delivered === false ? ' (delivery failed)' : ''}`,
        kind: 'reminder',
      })
    } else if (e.event_type === 'approval_created' || e.event_type === 'approval_withdrawn') {
      out.push({ at: e.created_at, who: e.actor_name, what: e.title, detail: e.body, kind: e.event_type })
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at))
}

const TONE: Record<string, string> = {
  approved: 'var(--primary)',
  rejected: 'var(--destructive)',
  changes_requested: 'var(--status-amber, var(--destructive))',
  auto_advanced: 'var(--muted-foreground)',
  late: 'var(--destructive)',
  reminder: 'var(--muted-foreground)',
}

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

  // Nothing yet, or nothing ever: render nothing rather than an empty shell.
  // The legacy task queue below on both pages is still the live surface until
  // its columns drop, so an empty record must not push it down the page.
  if (!rows || rows.length === 0) return null

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
                <Link
                  href={
                    side === 'studio'
                      ? `/studio/client/review/${r.id}/certificate`
                      : `/approvals/${r.id}/certificate`
                  }
                  className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-medium text-primary hover:underline"
                >
                  Open printable certificate <ChevronRight size={11} />
                </Link>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
