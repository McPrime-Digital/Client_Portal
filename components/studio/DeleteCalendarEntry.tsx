'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'

/**
 * Remove a MANUAL calendar entry.
 *
 * Rendered only where it can succeed. A derived entry (an approval deadline, an
 * invoice due date) has no control at all — the database refuses the delete
 * (0074's projection guard), and a button that always fails is worse than no
 * button.
 *
 * The removal is a SOFT delete: `deleted_at`, not a row removal, so the purge
 * (0071) takes it 90 days later and an undelete stays an ordinary update.
 *
 * No confirmation dialog, deliberately: this is a reversible write on a small
 * object, and a modal for it would be the kind of ceremony that trains people to
 * click through dialogs without reading them.
 */
export default function DeleteCalendarEntry({ id, title }: { id: string; title: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function remove() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/studio/calendar', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (res.ok) router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void remove()}
      disabled={busy}
      aria-label={`Remove ${title}`}
      title="Remove"
      className="shrink-0 rounded p-0.5 text-faint opacity-0 outline-none transition-[opacity,color] duration-[--dur-pop] hover:text-destructive focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/entry:opacity-100 disabled:opacity-40"
    >
      <X size={11} />
    </button>
  )
}
