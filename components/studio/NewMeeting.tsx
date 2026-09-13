'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Loader2 } from 'lucide-react'

/** Start a call, or a review session. The MODE is the only real choice here —
 *  a review session is the same object with a shared playhead (S3-b §2.1). */
export default function NewMeeting({
  companies, basePath = '/studio/crew/meetings',
}: {
  /** When present, the meeting is addressed to a company and lands in the
   *  Client space. Absent means the internal floor. */
  companies?: { id: string; name: string }[]
  basePath?: string
} = {}) {
  const router = useRouter()
  const [clientId, setClientId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create(mode: 'call' | 'review_session') {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/studio/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create', mode, clientId: clientId || null,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(j?.error ?? 'Could not create that.'); return }
      router.push(`${basePath}/${j.id}`)
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  const needsCompany = !!companies && !clientId

  return (
    <div className="flex flex-wrap items-center gap-2">
      {companies && (
        <select
          value={clientId} onChange={(e) => setClientId(e.target.value)}
          aria-label="Which company"
          className="squircle-sm border border-border bg-background px-2 py-1.5 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Choose a company…</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
      <button
        type="button" onClick={() => void create('review_session')} disabled={busy || needsCompany}
        className="squircle-sm inline-flex items-center gap-1.5 bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground outline-none transition-[opacity,transform] duration-[--dur-pop] ease-[--ease-out] hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] disabled:opacity-40"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={14} />}
        Start a review session
      </button>
      <button
        type="button" onClick={() => void create('call')} disabled={busy || needsCompany}
        className="squircle-sm inline-flex items-center gap-1.5 border border-border bg-card px-3 py-1.5 text-[13px] text-foreground outline-none transition-[border-color,transform] duration-[--dur-pop] ease-[--ease-out] hover:border-[hsl(var(--glow)/0.45)] focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] disabled:opacity-40"
      >
        Plain call
      </button>
      {error && <p role="status" className="w-full text-[12px] text-destructive">{error}</p>}
    </div>
  )
}
