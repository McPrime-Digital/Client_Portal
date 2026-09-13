'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Loader2 } from 'lucide-react'

/**
 * Draft a contract.
 *
 * PLAIN TEXT, and that is a v1 decision rather than an oversight. `contracts.body`
 * is jsonb and holds `{ text }`; a rich editor and PDF field placement are the
 * next layer. What matters for enforceability is settled already — the exact
 * bytes are hashed at SEND and the hash never moves — and a formatting toolbar
 * would not change that.
 */
export default function NewContract({ companies }: { companies: { id: string; name: string }[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [clientId, setClientId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy || !title.trim() || !bodyText.trim()) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/studio/contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          title: title.trim(),
          bodyText: bodyText.trim(),
          clientId: clientId || null,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(j?.error ?? 'Could not create that.'); return }
      router.push(`/studio/client/contracts/${j.id}`)
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
        <Plus size={14} /> New contract
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="squircle w-full space-y-2 border border-border bg-card p-3">
      <input
        autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
        placeholder="Appearance release, location agreement, deal memo…"
        aria-label="Title" maxLength={300}
        className="w-full bg-transparent text-[14px] font-medium text-foreground outline-none placeholder:text-faint"
      />
      <textarea
        value={bodyText} onChange={(e) => setBodyText(e.target.value)}
        placeholder="The agreement itself. This exact text is what gets hashed and signed."
        aria-label="Contract text" rows={8} maxLength={200_000}
        className="squircle-sm w-full border border-border bg-background p-2 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={clientId} onChange={(e) => setClientId(e.target.value)}
          aria-label="Client company"
          className="squircle-sm border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">No company</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button
          type="submit" disabled={busy || !title.trim() || !bodyText.trim()}
          className="squircle-sm inline-flex items-center gap-1.5 bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground outline-none transition-[opacity,transform] duration-[--dur-pop] ease-[--ease-out] hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] disabled:opacity-40"
        >
          {busy && <Loader2 size={13} className="animate-spin" />} Create draft
        </button>
        <button
          type="button" onClick={() => { setOpen(false); setError(null) }}
          className="px-2 text-[12px] text-faint outline-none transition-colors duration-[--dur-pop] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          Cancel
        </button>
      </div>
      {error && <p role="status" className="text-[12px] text-destructive">{error}</p>}
    </form>
  )
}
