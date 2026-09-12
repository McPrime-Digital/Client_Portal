'use client'

import { CAP_DOMAIN_LABEL, capDomain } from '@/lib/capabilities'

/**
 * THE GRANT SURFACE — S-R §8 / Batch 24 item 8. One component, both rosters.
 *
 * Written once because the capability vocabulary has been duplicated four times
 * in this codebase already (two OrgRole types, two OrgCap types, and three
 * untyped write allowlists), and every copy went stale. A fifth copy of the
 * grant UI would go the same way.
 *
 * What it shows, per S-R §8 and R-8:
 *   · the capabilities a person has been granted or DENIED individually,
 *     grouped by domain — "not forty checkboxes" (S-R §13)
 *   · who granted each one and when, because a permission change is precisely
 *     the fact you need a record of when something has gone wrong (R-8)
 *   · an expiry per grant, defaulting to never (G-5)
 *
 * G-1 IS OFFERED, NOT JUST ENFORCED. A capability the granter does not hold is
 * rendered disabled WITH THE REASON rather than hidden: migration 0054's trigger
 * will refuse it either way, and a refusal the user could not have predicted
 * reads as a bug. The trigger stays the control; this is the courtesy.
 *
 * THREE STATES, and the third is why this is not a checkbox: nothing → granted →
 * denied → nothing. A role baseline can already carry a capability, so "not
 * granted" and "denied" are different answers (S-R R-3) and the UI has to be
 * able to say both.
 */

export type Grant = {
  capability: string
  mode: 'grant' | 'deny'
  grantedByName: string
  grantedAt: string
  expiresAt: string | null
}

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'

export default function CapabilityGrants({
  grantable,
  grants,
  myCaps,
  busy = false,
  onCycle,
  onExpiry,
}: {
  /** The stored (coarse) capabilities this roster can grant, with UI labels. */
  grantable: readonly { cap: string; label: string }[]
  /** The target's LIVE grant and deny rows. */
  grants: Grant[]
  /** The GRANTER's own resolved set — G-1's ceiling. */
  myCaps: string[]
  busy?: boolean
  onCycle: (cap: string) => void
  onExpiry: (cap: string, isoDate: string) => void
}) {
  const byDomain = grantable.reduce<Record<string, { cap: string; label: string }[]>>((acc, g) => {
    const d = capDomain(g.cap)
    ;(acc[d] ??= []).push(g)
    return acc
  }, {})

  return (
    <div className="rounded-xl border border-border/70 bg-secondary/30 p-2.5">
      {Object.entries(byDomain).map(([domain, caps]) => (
        <div key={domain} className="mb-2 last:mb-0">
          <p className="mb-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-faint">
            {CAP_DOMAIN_LABEL[domain] ?? domain}
          </p>
          <div className="flex flex-wrap items-center gap-1">
            {caps.map(({ cap, label }) => {
              const live = grants.find((g) => g.capability === cap)
              const state = live?.mode ?? null
              const mayGrant = myCaps.includes(cap)
              const locked = !mayGrant && !state
              return (
                <button
                  key={cap}
                  type="button"
                  disabled={busy || locked}
                  onClick={() => onCycle(cap)}
                  title={
                    locked
                      ? `You do not hold “${label}” yourself, so you cannot grant it`
                      : state === 'grant' ? 'Granted — click to deny'
                      : state === 'deny' ? 'Denied — click to clear'
                      : `Grant “${label}” on top of their role`
                  }
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                    state === 'grant' ? 'border-primary/40 bg-primary/10 text-primary'
                    : state === 'deny' ? 'border-destructive/40 bg-destructive/10 text-destructive line-through'
                    : locked ? 'cursor-not-allowed border-border/50 text-faint/50'
                    : 'border-border text-faint hover:text-muted-foreground'
                  }`}
                >
                  {state === 'deny' ? '−' : state === 'grant' ? '+' : ''}{label}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {grants.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-border/60 pt-2">
          {grants.map((g) => (
            <div key={`${g.capability}-${g.mode}`} className="flex flex-wrap items-center gap-1.5 text-[10px] text-faint">
              <span className={g.mode === 'deny' ? 'text-destructive' : 'text-primary'}>
                {g.mode === 'deny' ? 'denied' : 'granted'}
              </span>
              <span className="font-medium text-muted-foreground">{g.capability}</span>
              <span>by {g.grantedByName} · {fmt(g.grantedAt)}</span>
              <label className="ml-auto flex items-center gap-1">
                <span className="text-[9px] uppercase tracking-wide">expires</span>
                <input
                  type="date"
                  defaultValue={g.expiresAt ? g.expiresAt.slice(0, 10) : ''}
                  onChange={(e) => onExpiry(g.capability, e.target.value)}
                  className="rounded border border-border bg-background px-1 py-0.5 text-[9.5px] text-foreground"
                />
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** The summary chip — the resolved answer in one line, detail on demand. */
export function GrantSummary({ grants }: { grants: Grant[] }) {
  const granted = grants.filter((g) => g.mode === 'grant').length
  const denied = grants.filter((g) => g.mode === 'deny').length
  if (!granted && !denied) return <>Access · role only</>
  return <>Access · {granted ? `+${granted}` : ''}{granted && denied ? ' ' : ''}{denied ? `−${denied}` : ''}</>
}
