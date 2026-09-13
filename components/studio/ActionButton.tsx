'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

/**
 * POST a JSON body to an endpoint, then refresh.
 *
 * One component rather than a handler per button. Every scheduling action —
 * archive a type, cancel a booking — is the same three steps and the same
 * failure handling, and three copies of it is three places for the error branch
 * to go missing.
 *
 * THE ERROR IS SHOWN, not swallowed (I-10). A cancel that silently fails leaves
 * somebody believing a slot is free.
 */
export default function ActionButton({
  endpoint, body, label, title, tone = 'quiet', confirm,
}: {
  endpoint: string
  body: Record<string, unknown>
  label: React.ReactNode
  title?: string
  tone?: 'quiet' | 'danger'
  /** Shown before acting. Only for things that are awkward to undo. */
  confirm?: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    if (busy) return
    if (confirm && !window.confirm(confirm)) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j?.error ?? 'That did not work.')
        return
      }
      router.refresh()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        title={title}
        className={`inline-flex items-center gap-1 text-[12px] font-medium outline-none transition-colors duration-[--dur-pop] focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 ${
          tone === 'danger'
            ? 'text-muted-foreground hover:text-destructive'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        {busy && <Loader2 size={11} className="animate-spin" />}
        {label}
      </button>
      {error && <span role="status" className="text-[11px] text-destructive">{error}</span>}
    </span>
  )
}
