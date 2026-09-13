'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, UserPlus } from 'lucide-react'

/**
 * Name who signs, and in what order.
 *
 * The address must already be on a client team. v1 signs through a real account
 * rather than an emailed link (S3-b §7 answer 2), so a contract addressed to
 * somebody with no way in is refused HERE rather than discovered when they
 * cannot open it.
 */
export default function AddSigner({ contractId }: { contractId: string }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [external, setExternal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy || !name.trim() || !email.trim()) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/studio/contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add-signer', contractId, name: name.trim(), email: email.trim(), external,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j?.error ?? 'Could not add that signer.')
        return
      }
      setName(''); setEmail('')
      router.refresh()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-wrap items-center gap-2">
      <input
        value={name} onChange={(e) => setName(e.target.value)}
        placeholder="Name" aria-label="Signer name" maxLength={200}
        className="squircle-sm w-36 border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-ring"
      />
      <input
        type="email" value={email} onChange={(e) => setEmail(e.target.value)}
        placeholder="their@email" aria-label="Signer email" maxLength={320}
        className="squircle-sm w-52 border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-ring"
      />
      <label className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <input
          type="checkbox" checked={external} onChange={(e) => setExternal(e.target.checked)}
          className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
        />
        {/* The case this exists for: a background actor signing an AI-likeness
            release, who will never hold an account. */}
        Outside signer (no account)
      </label>
      <button
        type="submit" disabled={busy || !name.trim() || !email.trim()}
        className="inline-flex items-center gap-1 text-[12px] font-medium text-primary outline-none transition-opacity duration-[--dur-pop] hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />} Add signer
      </button>
      {error && <p role="status" className="w-full text-[12px] text-destructive">{error}</p>}
    </form>
  )
}
