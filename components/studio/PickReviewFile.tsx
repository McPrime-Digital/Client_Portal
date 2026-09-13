'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Film } from 'lucide-react'

/**
 * Choose what the room is watching.
 *
 * Writes the durable sync row rather than broadcasting, deliberately: the file
 * is not a playhead tick. Everybody already in the room sees it on their next
 * refresh, and anybody joining later reads the row — which is the same path a
 * late joiner takes for position, so there is one answer to "what are we
 * watching" instead of two.
 */
export default function PickReviewFile({
  meetingId, files, current,
}: {
  meetingId: string
  files: { id: string; name: string }[]
  current: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function choose(fileId: string) {
    if (!fileId || busy) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/studio/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync', meetingId, fileId, positionMs: 0, playing: false }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j?.error ?? 'Could not set that.')
        return
      }
      router.refresh()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  if (files.length === 0) {
    return (
      <p className="text-[12px] text-muted-foreground">
        No video in the vault yet. Upload a cut and it can be reviewed here.
      </p>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Film size={14} className="text-faint" />
      <select
        defaultValue={current ?? ''}
        onChange={(e) => void choose(e.target.value)}
        disabled={busy}
        aria-label="What to review"
        className="squircle-sm max-w-[20rem] border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
      >
        <option value="">Choose what to review…</option>
        {files.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>
      {busy && <Loader2 size={13} className="animate-spin text-faint" />}
      {error && <span role="status" className="text-[12px] text-destructive">{error}</span>}
    </div>
  )
}
