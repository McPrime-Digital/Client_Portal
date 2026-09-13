'use client'

import { useState } from 'react'
import { Copy, Check, Link2, Loader2 } from 'lucide-react'

/**
 * Mint a single-use signing link for an outside signer.
 *
 * SHOWN ONCE, AND THE UI SAYS SO. Only the SHA-256 is stored, so there is no
 * "show it again" — the same property that makes a database leak yield no live
 * links makes this irreversible. A person who loses the link gets a new one,
 * which also invalidates nothing and is the correct outcome.
 */
export default function SigningLink({
  contractId, signerId, signerName,
}: {
  contractId: string
  signerId: string
  signerName: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [expires, setExpires] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function mint() {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/studio/contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mint-link', contractId, signerId }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(j?.error ?? 'Could not create a link.'); return }
      setUrl(j.url as string)
      setExpires(j.expiresAt as string)
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* the URL is on screen either way */ }
  }

  if (url) {
    return (
      <div className="mt-2 w-full">
        <div className="squircle-sm flex flex-wrap items-center gap-2 border border-border bg-background px-2 py-1.5">
          <code className="min-w-0 flex-1 break-all text-[11px] text-foreground">{url}</code>
          <button
            type="button" onClick={() => void copy()}
            className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-primary outline-none transition-opacity duration-[--dur-pop] hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring"
          >
            {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-faint">
          Send this to {signerName} yourself. It works once, expires
          {expires ? ` ${new Date(expires).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''},
          and cannot be shown again.
        </p>
      </div>
    )
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button" onClick={() => void mint()} disabled={busy}
        className="inline-flex items-center gap-1 text-[12px] font-medium text-primary outline-none transition-opacity duration-[--dur-pop] hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
      >
        {busy ? <Loader2 size={11} className="animate-spin" /> : <Link2 size={11} />}
        Signing link
      </button>
      {error && <span role="status" className="text-[11px] text-destructive">{error}</span>}
    </span>
  )
}
