'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

/**
 * Pick a day, see what is genuinely free, take it.
 *
 * THE SLOTS COME FROM THE SERVER, not from the browser. The arithmetic needs the
 * owner's availability rules (which the viewer may not be able to read) and
 * every confirmed booking against them, and a client-side copy would be a second
 * implementation of `slotsForDay` that drifts from the one the database
 * ultimately enforces.
 *
 * LOSING THE RACE IS AN ANSWER, NOT AN ERROR. 0066's exclusion constraint is
 * what actually prevents a double booking, so a slot can disappear between
 * rendering and clicking. That comes back as a sentence telling the person to
 * pick another time, and the list refreshes under them.
 */
export default function BookSlot({ typeId, title }: { typeId: string; title: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(() => {
    const t = new Date()
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
  })
  const [slots, setSlots] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load(forDate: string) {
    setBusy(true)
    setError(null)
    setSlots(null)
    try {
      const res = await fetch(`/api/studio/scheduling?type=${typeId}&date=${forDate}`)
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(j?.error ?? 'Could not load times.'); return }
      setSlots((j.slots ?? []) as string[])
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  async function book(startsAt: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/studio/scheduling', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'book', bookingTypeId: typeId, startsAt }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j?.error ?? 'Could not book that.')
        await load(date)
        return
      }
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
        onClick={() => { setOpen(true); void load(date) }}
        className="text-[12px] font-medium text-primary outline-none transition-opacity duration-[--dur-pop] hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring"
      >
        Book a slot
      </button>
    )
  }

  return (
    <div className="mt-2 w-full">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date" value={date}
          onChange={(e) => { setDate(e.target.value); void load(e.target.value) }}
          aria-label={`Date for ${title}`}
          className="squircle-sm border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {busy && <Loader2 size={13} className="animate-spin text-faint" />}
        <button
          type="button" onClick={() => { setOpen(false); setError(null) }}
          className="text-[12px] text-faint outline-none transition-colors duration-[--dur-pop] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          Close
        </button>
      </div>

      {slots && slots.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {slots.map((s) => (
            <button
              key={s} type="button" onClick={() => void book(s)} disabled={busy}
              className="squircle-sm border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none transition-[border-color,transform] duration-[--dur-pop] ease-[--ease-out] hover:border-[hsl(var(--glow)/0.45)] focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] disabled:opacity-40"
            >
              {new Date(s).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </button>
          ))}
        </div>
      )}

      {slots && slots.length === 0 && !busy && (
        // SS-6 — say which of the two reasons it is, because they need
        // different actions from the reader.
        <p className="mt-2 text-[12px] text-muted-foreground">
          Nothing free that day. Either the whole window is booked, or there is no
          availability set for it.
        </p>
      )}

      {error && <p role="status" className="mt-2 text-[12px] text-destructive">{error}</p>}
    </div>
  )
}
