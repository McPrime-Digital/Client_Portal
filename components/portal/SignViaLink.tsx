'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, PenLine } from 'lucide-react'

/**
 * Signing without an account.
 *
 * The TOKEN is the only thing sent. No contract id, no signer id, no identity —
 * every one of those is derived server-side from the token, so this component
 * cannot point a valid link at a different document even if somebody edits it.
 *
 * The consent step and its exact wording are identical to the logged-in path,
 * because the legal requirement does not soften for somebody without a login.
 * What DOES differ is honestly recorded on the row: `verification = 'email_link'`
 * rather than `'session'`, since holding a link is weaker identity proof than
 * holding an account, and a record that blurred the two would be worth less than
 * one that admits it.
 */
export default function SignViaLink({
  token, consentText, alreadyConsented,
}: {
  token: string
  consentText: string
  alreadyConsented: boolean
}) {
  const router = useRouter()
  const [agreed, setAgreed] = useState(alreadyConsented)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function post(action: 'consent' | 'sign' | 'decline', extra: Record<string, unknown> = {}) {
    const res = await fetch('/api/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, token, ...extra }),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(j?.error ?? 'That did not work.')
    return j
  }

  async function signNow() {
    if (busy) return
    setBusy(true); setError(null)
    try {
      if (!alreadyConsented) await post('consent')
      await post('sign')
      setDone(true)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  async function decline() {
    if (busy) return
    const reason = window.prompt('Anything you want on the record about why?') ?? null
    setBusy(true); setError(null)
    try {
      await post('decline', { reason })
      setDone(true)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <p className="squircle border border-border bg-card p-4 text-[14px] text-foreground">
        Thank you — that is recorded. You can close this page; the link will not work again.
      </p>
    )
  }

  return (
    <div className="squircle border border-border bg-card p-4">
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
        />
        <span className="text-[12px] leading-relaxed text-muted-foreground">{consentText}</span>
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button
          type="button" onClick={() => void signNow()} disabled={!agreed || busy}
          className="squircle-sm inline-flex items-center gap-1.5 bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground outline-none transition-[opacity,transform] duration-[--dur-pop] ease-[--ease-out] hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] disabled:opacity-40"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <PenLine size={14} />}
          Sign this document
        </button>
        <button
          type="button" onClick={() => void decline()} disabled={busy}
          className="text-[12px] font-medium text-muted-foreground outline-none transition-colors duration-[--dur-pop] hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        >
          Decline
        </button>
      </div>

      {error && <p role="status" className="mt-3 text-[12px] text-destructive">{error}</p>}
    </div>
  )
}
