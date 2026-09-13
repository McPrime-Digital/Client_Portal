'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, X } from 'lucide-react'
import { WEEKDAY_LABEL, defaultTimeZone, type AvailabilityRule } from '@/lib/bookings'

/**
 * When this person can be booked.
 *
 * SAVE REPLACES THE WHOLE WEEK, and the editor is built that way deliberately:
 * the absence of a window is a statement ("not available then"), so a merge
 * would make removing one impossible. The route deletes and re-inserts for the
 * same reason.
 *
 * ONE TIMEZONE FOR THE EDIT, stored on every rule. `S3-b` §1.3 keeps the zone
 * per RULE so a person who moves does not retroactively change what last
 * month's availability meant — old rules keep the zone they were written in,
 * and this only sets the zone for what is saved now.
 */
type Draft = { weekday: number; startTime: string; endTime: string }

export default function AvailabilityEditor({ rules }: { rules: AvailabilityRule[] }) {
  const router = useRouter()
  const [draft, setDraft] = useState<Draft[]>(
    rules.map((r) => ({
      weekday: r.weekday,
      startTime: r.start_time.slice(0, 5),
      endTime: r.end_time.slice(0, 5),
    }))
  )
  const [tz] = useState(rules[0]?.timezone ?? defaultTimeZone())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function add(weekday: number) {
    setDraft((d) => [...d, { weekday, startTime: '09:00', endTime: '17:00' }])
    setSaved(false)
  }
  function remove(i: number) {
    setDraft((d) => d.filter((_, j) => j !== i))
    setSaved(false)
  }
  function edit(i: number, patch: Partial<Draft>) {
    setDraft((d) => d.map((r, j) => (j === i ? { ...r, ...patch } : r)))
    setSaved(false)
  }

  async function save() {
    if (busy) return
    const bad = draft.find((r) => r.endTime <= r.startTime)
    if (bad) {
      setError(`${WEEKDAY_LABEL[bad.weekday]}: a window has to end after it starts.`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/studio/scheduling', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-availability', timezone: tz, rules: draft }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j?.error ?? 'Could not save your availability.')
        return
      }
      setSaved(true)
      router.refresh()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="squircle border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-sm font-semibold text-foreground">When you can be booked</h2>
        <span className="text-[11px] text-faint">{tz}</span>
      </div>

      <ul className="space-y-1.5">
        {[1, 2, 3, 4, 5, 6, 0].map((wd) => {
          const rows = draft
            .map((r, i) => ({ r, i }))
            .filter(({ r }) => r.weekday === wd)
          return (
            <li key={wd} className="flex flex-wrap items-center gap-2">
              <span className="w-[5.5rem] shrink-0 text-[12px] text-muted-foreground">
                {WEEKDAY_LABEL[wd]}
              </span>
              {rows.length === 0 && (
                <span className="text-[12px] text-faint">Unavailable</span>
              )}
              {rows.map(({ r, i }) => (
                <span key={i} className="inline-flex items-center gap-1">
                  <input
                    type="time" value={r.startTime}
                    onChange={(e) => edit(i, { startTime: e.target.value })}
                    aria-label={`${WEEKDAY_LABEL[wd]} start`}
                    className="squircle-sm border border-border bg-background px-1.5 py-0.5 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <span className="text-faint">–</span>
                  <input
                    type="time" value={r.endTime}
                    onChange={(e) => edit(i, { endTime: e.target.value })}
                    aria-label={`${WEEKDAY_LABEL[wd]} end`}
                    className="squircle-sm border border-border bg-background px-1.5 py-0.5 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <button
                    type="button" onClick={() => remove(i)}
                    aria-label={`Remove ${WEEKDAY_LABEL[wd]} window`}
                    className="rounded p-0.5 text-faint outline-none transition-colors duration-[--dur-pop] hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
              <button
                type="button" onClick={() => add(wd)}
                aria-label={`Add a window on ${WEEKDAY_LABEL[wd]}`}
                className="rounded p-0.5 text-faint outline-none transition-colors duration-[--dur-pop] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus size={12} />
              </button>
            </li>
          )
        })}
      </ul>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button" onClick={() => void save()} disabled={busy}
          className="squircle-sm inline-flex items-center gap-1.5 bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground outline-none transition-[opacity,transform] duration-[--dur-pop] ease-[--ease-out] hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] disabled:opacity-40"
        >
          {busy && <Loader2 size={13} className="animate-spin" />} Save availability
        </button>
        {saved && !busy && <span className="text-[12px] text-muted-foreground">Saved</span>}
        {error && <span role="status" className="text-[12px] text-destructive">{error}</span>}
      </div>
    </div>
  )
}
