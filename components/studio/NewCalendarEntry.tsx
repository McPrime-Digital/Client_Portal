'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Loader2 } from 'lucide-react'

/**
 * Add a manual calendar entry.
 *
 * OPTIMISTIC IS THE WRONG CHOICE HERE and that is deliberate (SS-3 allows it,
 * it does not require it): the row lands in a month grid the server rendered,
 * so faking it means reimplementing the day-bucketing on the client and getting
 * the local-vs-UTC day boundary right a second time. `router.refresh()` costs
 * one round trip and cannot disagree with the database.
 *
 * The form opens with NO animation. It is a keyboard-reachable control a person
 * may use many times a day, and an entrance transition on something you open
 * repeatedly reads as lag rather than polish.
 */
export default function NewCalendarEntry({ defaultDate }: { defaultDate: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(defaultDate)
  const [time, setTime] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || busy) return
    setBusy(true)
    setError(null)

    // An all-day entry is midnight LOCAL, built from the parts rather than
    // parsed from a string, so it cannot drift a day across an offset.
    const [y, m, d] = date.split('-').map(Number)
    const [hh, mm] = time ? time.split(':').map(Number) : [0, 0]
    const starts = new Date(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0)

    try {
      const res = await fetch('/api/studio/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          startsAt: starts.toISOString(),
          allDay: !time,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j?.error ?? 'Could not save that entry.')
        return
      }
      setTitle('')
      setTime('')
      setOpen(false)
      router.refresh()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="squircle-sm inline-flex items-center gap-1.5 border border-border bg-card px-3 py-1.5 text-[13px] text-foreground outline-none transition-[border-color,transform] duration-[--dur-pop] ease-[--ease-out] hover:border-[hsl(var(--glow)/0.45)] focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
      >
        <Plus size={14} /> New entry
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="squircle flex flex-wrap items-center gap-2 border border-border bg-card p-2">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What is it?"
        aria-label="Entry title"
        maxLength={300}
        className="min-w-[10rem] flex-1 bg-transparent px-1 text-[13px] text-foreground outline-none placeholder:text-faint"
      />
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        aria-label="Date"
        className="squircle-sm border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <input
        type="time"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        aria-label="Time (leave empty for all day)"
        className="squircle-sm border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <button
        type="submit"
        disabled={busy || !title.trim()}
        className="squircle-sm inline-flex items-center gap-1.5 bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground outline-none transition-[opacity,transform] duration-[--dur-pop] ease-[--ease-out] hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] disabled:opacity-40"
      >
        {busy && <Loader2 size={13} className="animate-spin" />} Add
      </button>
      <button
        type="button"
        onClick={() => { setOpen(false); setError(null) }}
        className="px-2 text-[12px] text-faint outline-none transition-colors duration-[--dur-pop] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        Cancel
      </button>
      {error && <p role="status" className="w-full px-1 text-[11px] text-destructive">{error}</p>}
    </form>
  )
}
