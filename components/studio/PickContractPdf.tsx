'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Loader2 } from 'lucide-react'

/**
 * Point the contract at a PDF that is already in the vault.
 *
 * Deliberately NOT a second upload path. Uploads already have presigning,
 * multipart, scope resolution and metering (AD-004-R); a contract-only uploader
 * would be a fourth copy of all of it and the first one to drift. Choosing an
 * existing file also means the scope rules that govern every file govern this
 * one — you cannot attach a PDF you could not already see.
 */
export default function PickContractPdf({
  contractId, files, current,
}: {
  contractId: string
  files: { id: string; name: string }[]
  current: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function choose(fileId: string) {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/studio/contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-source', contractId, fileId: fileId || null }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j?.error ?? 'Could not attach that.')
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
    <div className="flex flex-wrap items-center gap-2">
      <FileText size={14} className="text-faint" />
      <select
        defaultValue={current ?? ''}
        onChange={(e) => void choose(e.target.value)}
        disabled={busy}
        aria-label="Sign a PDF instead of the typed text"
        className="squircle-sm max-w-[22rem] border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
      >
        <option value="">Sign the typed text (no PDF)</option>
        {files.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>
      {busy && <Loader2 size={13} className="animate-spin text-faint" />}
      {error && <span role="status" className="text-[12px] text-destructive">{error}</span>}
    </div>
  )
}
