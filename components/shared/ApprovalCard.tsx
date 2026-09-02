'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, X, MessageSquareWarning, Clock, ShieldCheck, Hourglass } from 'lucide-react'

/**
 * The approval card in the conversation — Batch 22 item 7 (S3-c §3.1).
 *
 * ONE ROW READ THREE WAYS, never three copies kept in sync. This card holds NO
 * approval state of its own beyond what it just fetched: it renders the row,
 * and re-fetches when the room tells it something changed. The first time the
 * task board and the review page disagree, neither is trusted again — so the
 * card is a VIEW of `approvals`, and the only writes it makes go through the
 * same routes every other surface uses.
 *
 * REALTIME: this component adds NO channel. I-2 is still violated and the
 * budget was halved, not fixed (Batch 15), so a card that opened its own
 * subscription would spend what the room model saved. It re-reads when
 * RoomThread hands it a `syncKey` change — the room's EXISTING
 * `thread:${threadKey}` topic is what carries the signal.
 *
 * THE COUNTDOWN IS VISIBLE FROM THE MOMENT THE CARD APPEARS (S3-c §8 q2). An
 * auto-advance nobody saw coming is a support ticket; one with a visible
 * deadline is a deadline.
 */

type Stage = {
  id: string
  seq: number
  name: string
  status: 'pending' | 'active' | 'complete' | 'auto_advanced' | 'blocked_on_changes'
  deadline_at: string | null
  advanced_at: string | null
  assignees: { id: string; user_id: string | null; client_id: string | null; role: string | null; required: boolean }[]
  decisions: { id: string; actor_name: string; decision: string; comment: string | null; decided_at: string }[]
}

type Detail = {
  approval: {
    id: string
    title: string
    status: 'open' | 'approved' | 'rejected' | 'changes_requested' | 'auto_advanced' | 'withdrawn'
    subject_kind: string
    client_id: string | null
    review_window_hours: number | null
  }
  stages: Stage[]
}

const STATUS_LABEL: Record<Detail['approval']['status'], string> = {
  open: 'Awaiting review',
  approved: 'Approved',
  rejected: 'Rejected',
  changes_requested: 'Changes requested',
  // NEVER "approved" — a timeout and a decision must not read the same
  // (S3-c AP-2). The wording here is the short form; the certificate carries
  // the full sentence.
  auto_advanced: 'Proceeded — no response',
  withdrawn: 'Withdrawn',
}

const STATUS_TONE: Record<Detail['approval']['status'], string> = {
  open: 'var(--primary)',
  approved: 'var(--status-green, var(--primary))',
  rejected: 'var(--destructive)',
  changes_requested: 'var(--status-amber, var(--destructive))',
  auto_advanced: 'var(--muted-foreground)',
  withdrawn: 'var(--muted-foreground)',
}

function remaining(deadline: string | null): { label: string; urgent: boolean } | null {
  if (!deadline) return null
  const ms = Date.parse(deadline) - Date.now()
  if (ms <= 0) return { label: 'Review window closed', urgent: true }
  const h = Math.floor(ms / 3_600_000)
  if (h >= 48) return { label: `${Math.floor(h / 24)} days left to review`, urgent: false }
  if (h >= 1) return { label: `${h} hour${h === 1 ? '' : 's'} left to review`, urgent: h <= 12 }
  return { label: `${Math.max(1, Math.floor(ms / 60_000))} minutes left to review`, urgent: true }
}

export default function ApprovalCard({
  approvalId,
  side,
  syncKey = 0,
  onChanged,
}: {
  approvalId: string
  /** Which API to read and write through. The two are separate routes with
   *  separate capability checks — never one route with a role flag. */
  side: 'studio' | 'portal'
  /** Bumped by RoomThread when the room's existing topic reports a change. */
  syncKey?: number
  onChanged?: () => void
}) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [noteFor, setNoteFor] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [, setTick] = useState(0)
  const alive = useRef(true)

  const base = side === 'studio' ? '/api/studio/approvals' : '/api/portal/approvals'

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${base}/${approvalId}`)
      if (!res.ok) {
        // 404 is the honest answer for "not yours" as well as "gone" — say
        // nothing more specific than the API did.
        if (alive.current) setDetail(null)
        return
      }
      const json = (await res.json()) as Detail
      if (alive.current) setDetail(json)
    } catch {
      /* leave the last good render up rather than blanking the card */
    }
  }, [base, approvalId])

  useEffect(() => {
    alive.current = true
    // Not a synchronous setState: `load` awaits a fetch before it touches
    // state, and the `alive` ref drops the result if this card unmounted
    // first. The rule cannot see across the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    return () => { alive.current = false }
  }, [load, syncKey])

  // Re-render the countdown once a minute. No polling — this touches no
  // network (I-3); it only re-computes the label already on screen.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])

  const decide = useCallback(
    async (stageId: string, decision: 'approved' | 'rejected' | 'changes_requested', comment?: string) => {
      setBusy(true)
      setError(null)
      try {
        const res = await fetch(`${base}/actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            side === 'studio'
              ? { action: 'decide', stageId, decision, comment: comment ?? null }
              : { stageId, decision, comment: comment ?? null }
          ),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          // Surface the reason rather than a mute failure (I-10).
          setError(json?.error ?? 'Could not record that.')
          return
        }
        setNoteFor(null)
        setNote('')
        await load()
        onChanged?.()
      } catch {
        setError('Could not reach the server.')
      } finally {
        setBusy(false)
      }
    },
    [base, side, load, onChanged]
  )

  if (!detail) return null
  const { approval, stages } = detail
  const active = stages.find((s) => s.status === 'active') ?? null
  const clock = remaining(active?.deadline_at ?? null)
  const tone = STATUS_TONE[approval.status]

  return (
    <div
      className="my-2 w-full max-w-xl overflow-hidden rounded-2xl border bg-card"
      style={{ borderColor: `hsl(${tone} / 0.35)` }}
    >
      <div
        className="flex items-center gap-2 px-4 py-2.5"
        style={{ backgroundColor: `hsl(${tone} / 0.08)` }}
      >
        <ShieldCheck size={15} style={{ color: `hsl(${tone})` }} />
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: `hsl(${tone})` }}>
          {STATUS_LABEL[approval.status]}
        </span>
        {clock && approval.status === 'open' && (
          <span
            className="ml-auto flex items-center gap-1 text-[11px] font-medium"
            style={{ color: clock.urgent ? 'hsl(var(--destructive))' : 'hsl(var(--muted-foreground))' }}
          >
            <Clock size={11} />
            {clock.label}
          </span>
        )}
      </div>

      <div className="px-4 py-3">
        <p className="font-display text-sm font-semibold text-foreground">{approval.title}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {approval.subject_kind.replace('_', ' ')} ·{' '}
          {approval.client_id ? 'client approval' : 'internal review'}
        </p>

        <ol className="mt-3 space-y-1.5">
          {stages.map((s) => {
            const done = s.status === 'complete' || s.status === 'auto_advanced'
            return (
              <li key={s.id} className="flex items-start gap-2 text-xs">
                <span
                  className="mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border text-[8px]"
                  style={{
                    borderColor: s.status === 'active' ? `hsl(${tone} / 0.6)` : 'hsl(var(--border))',
                    backgroundColor: done ? `hsl(${tone} / 0.15)` : 'transparent',
                  }}
                >
                  {done ? <Check size={8} /> : s.status === 'active' ? <Hourglass size={8} /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={s.status === 'active' ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                    {s.name}
                  </span>
                  {s.status === 'auto_advanced' && (
                    // Plain language, never "approved" (AP-2).
                    <span className="ml-1.5 text-[10px] text-muted-foreground">
                      · proceeded without a response
                    </span>
                  )}
                  {s.status === 'blocked_on_changes' && (
                    <span className="ml-1.5 text-[10px]" style={{ color: 'hsl(var(--status-amber, var(--destructive)))' }}>
                      · changes requested
                    </span>
                  )}
                  {s.decisions.map((d) => (
                    <span key={d.id} className="mt-0.5 block text-[10px] text-muted-foreground">
                      {d.actor_name} · {d.decision.replace('_', ' ')}
                      {d.comment ? ` — “${d.comment}”` : ''}
                    </span>
                  ))}
                </span>
              </li>
            )
          })}
        </ol>

        {error && (
          <p className="mt-2 text-[11px]" style={{ color: 'hsl(var(--destructive))' }}>
            {error}
          </p>
        )}

        {/* Decisions are made HERE, in the conversation (S3-c §3.1). The
            buttons render for everyone who can see the card; the POLICY
            decides whether the write lands, and a refusal surfaces above as
            "no longer open to you" rather than being hidden by a guess about
            who is an assignee. */}
        {active && approval.status !== 'withdrawn' && (
          noteFor === active.id ? (
            <div className="mt-3">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="What needs to change?"
                className="w-full resize-none rounded-lg border border-border bg-background px-2.5 py-2 text-xs text-foreground outline-none focus:border-primary/50"
              />
              <div className="mt-1.5 flex gap-1.5">
                <button
                  type="button"
                  disabled={busy || !note.trim()}
                  onClick={() => void decide(active.id, 'changes_requested', note.trim())}
                  className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium disabled:opacity-50"
                  style={{ backgroundColor: 'hsl(var(--destructive) / 0.12)', color: 'hsl(var(--destructive))' }}
                >
                  Send request
                </button>
                <button
                  type="button"
                  onClick={() => { setNoteFor(null); setNote('') }}
                  className="rounded-lg px-2.5 py-1.5 text-[11px] text-muted-foreground"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => void decide(active.id, 'approved')}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50"
                style={{ backgroundColor: 'hsl(var(--primary) / 0.12)', color: 'hsl(var(--primary))' }}
              >
                <Check size={12} /> Approve
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setNoteFor(active.id)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium disabled:opacity-50"
                style={{ backgroundColor: 'hsl(var(--secondary))', color: 'hsl(var(--muted-foreground))' }}
              >
                <MessageSquareWarning size={12} /> Request changes
              </button>
              {side === 'studio' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide(active.id, 'rejected')}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium disabled:opacity-50"
                  style={{ backgroundColor: 'hsl(var(--secondary))', color: 'hsl(var(--muted-foreground))' }}
                >
                  <X size={12} /> Reject
                </button>
              )}
            </div>
          )
        )}
      </div>
    </div>
  )
}
