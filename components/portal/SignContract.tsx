'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, PenLine } from 'lucide-react'

/**
 * The signing ceremony, such as it is in v1.
 *
 * TWO STEPS, AND THE ORDER IS THE POINT. ESIGN/UETA want consent to transact
 * electronically recorded BEFORE the signature, so the button is disabled until
 * the box is ticked and the server refuses a signature with no `consented`
 * event regardless of what this component does. The checkbox is the courtesy;
 * `sign()` is the control.
 *
 * The consent wording is server-owned (`CONSENT_TEXT`) and stored on the event,
 * because "they consented" is worth nothing in a dispute without "to this text".
 *
 * NO SIGNATURE CANVAS. A drawn squiggle adds nothing to enforceability — intent,
 * consent and association with the record are what carry it, and all three are
 * recorded. A canvas would suggest the picture is the legally operative part.
 */
export default function SignContract({
  contractId, consentText, alreadyConsented, disabledReason,
}: {
  contractId: string
  consentText: string
  alreadyConsented: boolean
  /** Why this person cannot sign right now, if they cannot. */
  disabledReason: string | null
}) {
  const router = useRouter()
  const [agreed, setAgreed] = useState(alreadyConsented)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function post(action: 'consent' | 'sign' | 'decline', extra: Record<string, unknown> = {}) {
    const res = await fetch('/api/portal/contracts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, contractId, ...extra }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      throw new Error(j?.error ?? 'That did not work.')
    }
  }

  async function signNow() {
    if (busy) return
    setBusy(true); setError(null)
    try {
      if (!alreadyConsented) await post('consent')
      await post('sign')
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
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  if (disabledReason) {
    return <p className="text-[13px] text-muted-foreground">{disabledReason}</p>
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
