'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Loader2 } from 'lucide-react'

/**
 * Create something that can be booked.
 *
 * The slug is offered, not demanded: it is derived from the title and stays
 * editable. A field a person must invent before they can proceed is a field most
 * people put the title in anyway.
 */
export default function NewBookingType() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [minutes, setMinutes] = useState(60)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function onTitle(v: string) {
    setTitle(v)
    if (!slugTouched) {
      setSlug(v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60))
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy || !title.trim() || !slug) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/studio/scheduling', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create-type', title: title.trim(), slug, durationMinutes: minutes,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j?.error ?? 'Could not create that.')
        return
      }
      setTitle(''); setSlug(''); setSlugTouched(false); setOpen(false)
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
        type="button" onClick={() => setOpen(true)}
        className="squircle-sm inline-flex items-center gap-1.5 border border-border bg-card px-3 py-1.5 text-[13px] text-foreground outline-none transition-[border-color,transform] duration-[--dur-pop] ease-[--ease-out] hover:border-[hsl(var(--glow)/0.45)] focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
      >
        <Plus size={14} /> New booking type
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="squircle flex flex-wrap items-center gap-2 border border-border bg-card p-2">
      <input
        autoFocus value={title} onChange={(e) => onTitle(e.target.value)}
        placeholder="Casting session, grade suite…" aria-label="Title" maxLength={200}
        className="min-w-[12rem] flex-1 bg-transparent px-1 text-[13px] text-foreground outline-none placeholder:text-faint"
      />
      <input
        value={slug}
        onChange={(e) => { setSlugTouched(true); setSlug(e.target.value) }}
        aria-label="Link" placeholder="link" maxLength={60}
        className="w-28 squircle-sm border border-border bg-background px-2 py-1 text-[12px] text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <label className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
        <input
          type="number" min={5} max={480} step={5} value={minutes}
          onChange={(e) => setMinutes(Number(e.target.value))}
          aria-label="Duration in minutes"
          className="w-16 squircle-sm border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        min
      </label>
      <button
        type="submit" disabled={busy || !title.trim() || !slug}
        className="squircle-sm inline-flex items-center gap-1.5 bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground outline-none transition-[opacity,transform] duration-[--dur-pop] ease-[--ease-out] hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] disabled:opacity-40"
      >
        {busy && <Loader2 size={13} className="animate-spin" />} Create
      </button>
      <button
        type="button" onClick={() => { setOpen(false); setError(null) }}
        className="px-2 text-[12px] text-faint outline-none transition-colors duration-[--dur-pop] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        Cancel
      </button>
      {error && <p role="status" className="w-full px-1 text-[11px] text-destructive">{error}</p>}
    </form>
  )
}
