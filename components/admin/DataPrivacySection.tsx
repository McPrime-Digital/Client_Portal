'use client'

import { useState } from 'react'
import { Eraser, AlertCircle, Check, Loader2, ShieldAlert } from 'lucide-react'

// Platform-operator erasure console (AD-003 / S0 §5). Rendered only when the
// caller's org plan carries 'platform.erasure' AND they hold the owner role —
// the page computes that server-side; the route re-checks both, so this
// component is presentation, never the gate.
export default function DataPrivacySection() {
  const [email, setEmail] = useState('')
  const [confirm, setConfirm] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{
    pseudonym: string
    touched: Record<string, number>
    warnings: string[]
  } | null>(null)

  const ready = email.trim() !== '' && email.trim().toLowerCase() === confirm.trim().toLowerCase()

  async function runErasure(e: React.FormEvent) {
    e.preventDefault()
    if (!ready || running) return
    setRunning(true); setError(''); setResult(null)
    try {
      const res = await fetch('/api/admin/erase-person', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), confirmEmail: confirm.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Erasure failed.')
      setResult({ pseudonym: json.pseudonym, touched: json.touched ?? {}, warnings: json.warnings ?? [] })
      setEmail(''); setConfirm('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erasure failed.')
    } finally {
      setRunning(false)
    }
  }

  const inputClass = 'w-full px-4 py-3 rounded-lg text-sm outline-none transition-all'
  const inputStyle = { backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' } as const
  const labelClass = 'block text-xs font-semibold uppercase tracking-wider mb-2'
  const labelStyle = { color: 'hsl(var(--muted-foreground))' } as const

  return (
    <form onSubmit={runErasure} className="p-6 rounded-xl space-y-5" style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'hsl(var(--destructive) / 0.1)' }}>
          <Eraser size={17} style={{ color: 'hsl(var(--destructive))' }} />
        </div>
        <div>
          <h2 className="font-display text-base font-semibold" style={{ color: 'hsl(var(--foreground))' }}>Data & Privacy</h2>
          <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>Erase a departed person&apos;s identity — platform operator only</p>
        </div>
      </div>

      <div className="rounded-lg p-4 space-y-2 text-[13px] leading-relaxed" style={{ backgroundColor: 'hsl(var(--destructive) / 0.06)', border: '1px solid hsl(var(--destructive) / 0.2)', color: 'hsl(var(--muted-foreground))' }}>
        <p className="flex items-start gap-2">
          <ShieldAlert size={15} className="mt-0.5 flex-shrink-0" style={{ color: 'hsl(var(--destructive))' }} />
          <span>
            <b style={{ color: 'hsl(var(--foreground))' }}>Deleting a person never deletes their work.</b>{' '}
            Their messages, files and comments stay — every display name is rewritten to a stable
            pseudonym, their address is scrubbed from notifications and logs, and the login itself is
            deleted. The person must already be off every roster. This cannot be undone.
          </span>
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass} style={labelStyle}>Email to erase</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="person@example.com" className={inputClass} style={inputStyle} />
        </div>
        <div>
          <label className={labelClass} style={labelStyle}>Retype to confirm</label>
          <input type="email" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat the address" className={inputClass} style={inputStyle} />
          {confirm && !ready && (
            <p className="mt-1.5 text-[11px]" style={{ color: 'hsl(var(--destructive))' }}>Addresses do not match.</p>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2">
          <AlertCircle size={13} style={{ color: 'hsl(var(--destructive))' }} />
          <p className="text-sm" style={{ color: 'hsl(var(--destructive))' }}>{error}</p>
        </div>
      )}

      {result && (
        <div className="rounded-lg p-4 space-y-1.5 text-[13px]" style={{ backgroundColor: 'hsl(var(--status-green) / 0.08)', border: '1px solid hsl(var(--status-green) / 0.25)' }}>
          <p className="flex items-center gap-2 font-semibold" style={{ color: 'hsl(var(--status-green))' }}>
            <Check size={14} /> Erased{result.pseudonym ? ` — now "${result.pseudonym}"` : ''}
          </p>
          <ul className="space-y-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
            {Object.entries(result.touched).filter(([, n]) => n > 0).map(([table, n]) => (
              <li key={table}>{n} {table.replace(/_/g, ' ')} record{n === 1 ? '' : 's'} rewritten or removed</li>
            ))}
          </ul>
          {result.warnings.map((w) => (
            <p key={w} className="flex items-start gap-1.5" style={{ color: 'hsl(var(--primary))' }}>
              <AlertCircle size={12} className="mt-0.5 flex-shrink-0" /> {w}
            </p>
          ))}
        </div>
      )}

      <button
        type="submit"
        disabled={!ready || running}
        className="flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold transition-all disabled:opacity-40"
        style={{ backgroundColor: 'hsl(var(--destructive))', color: 'hsl(var(--destructive-foreground))' }}
      >
        {running
          ? <><Loader2 size={13} className="animate-spin" /> Erasing…</>
          : <><Eraser size={13} /> Erase this person</>}
      </button>
    </form>
  )
}
