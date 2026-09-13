'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

/**
 * AI SPEND LIMITS — the policy first, then the exceptions.
 *
 * ── THE ORDER IS THE POINT ─────────────────────────────────────────────────
 *
 * Per-person limits do not scale on a rotating freelance bench: by the time an
 * admin has set one for every contractor, three more have been hired. So the
 * DEFAULT BY SEAT CLASS leads — "every contractor gets this" applies to people
 * who have not been hired yet — and individual rows are framed as exceptions to
 * it rather than as the normal way to work.
 *
 * That is how governance is actually administered, and it is the difference
 * between a feature somebody configures once and one they maintain forever.
 *
 * ── SOFT VS HARD IS STATED IN WORDS ────────────────────────────────────────
 *
 * "Stops calls" and "warns only" rather than a checkbox labelled hard_stop. A
 * limit that only warns is not a limit for the person spending — they never see
 * it — so the admin has to know which one they are choosing.
 */

type Seat = { seat_class: 'staff' | 'contractor'; period: string; limit_cents: number; hard_stop: boolean }
type MemberRow = { user_id: string; period: string; limit_cents: number | null; hard_stop: boolean }
type Person = { user_id: string; name: string | null; email: string; seat_class?: 'staff' | 'contractor' }

const money = (c: number) => `$${(c / 100).toFixed(2)}`
const PERIODS = ['day', 'week', 'month'] as const

export default function SpendLimits({ people }: { people: Person[] }) {
  const [seats, setSeats] = useState<Seat[]>([])
  const [members, setMembers] = useState<MemberRow[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const fetchAll = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/budgets')
      if (!res.ok) return { error: 'Limits could not be loaded.' }
      const j = await res.json()
      return { seats: (j.seats ?? []) as Seat[], members: (j.members ?? []) as MemberRow[] }
    } catch { return { error: 'Limits could not be loaded.' } }
  }, [])

  const apply = useCallback((r: { seats?: Seat[]; members?: MemberRow[]; error?: string }) => {
    if (r.seats) setSeats(r.seats)
    if (r.members) setMembers(r.members)
    if (r.error) setError(r.error)
  }, [])

  useEffect(() => {
    if (!open) return
    const alive = { current: true }
    fetchAll().then((r) => { if (alive.current) apply(r) })
    return () => { alive.current = false }
  }, [open, fetchAll, apply])

  const reload = useCallback(async () => { apply(await fetchAll()) }, [fetchAll, apply])

  async function save(method: 'PUT' | 'PATCH', body: Record<string, unknown>, key: string) {
    setBusy(key); setError(null)
    try {
      const res = await fetch('/api/admin/budgets', {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!res.ok) setError((await res.json()).error ?? 'Could not save.')
      else await reload()
    } catch { setError('Could not save.') }
    setBusy(null)
  }

  const seatOf = (c: 'staff' | 'contractor') => seats.find((s) => s.seat_class === c)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="squircle-sm border border-border bg-card px-3 py-1.5 text-[13px] text-foreground outline-none transition-[border-color,transform] duration-[--dur-pop] ease-[--ease-out] hover:border-[hsl(var(--glow)/0.45)] focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
      >
        Set spend limits
      </button>
    )
  }

  return (
    <section className="squircle-lg border border-border bg-card p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-display text-[13px] font-semibold text-foreground">AI spend limits</h2>
        <button type="button" onClick={() => setOpen(false)} className="text-[12px] text-faint hover:text-foreground">
          close
        </button>
      </div>
      {error && <p className="mb-3 text-[12.5px] text-destructive">{error}</p>}

      {/* ── THE POLICY, WHICH IS WHAT SCALES ─────────────────────────────── */}
      <p className="mb-2 text-[12px] text-faint">
        Applies to everyone on that seat, including people hired later.
      </p>
      {(['staff', 'contractor'] as const).map((cls) => {
        const s = seatOf(cls)
        return (
          <div key={cls} className="mb-2 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2 first:border-t-0">
            <span className="w-24 text-sm capitalize text-foreground">{cls}</span>
            <input
              type="number" min={0} step={1} defaultValue={s ? s.limit_cents / 100 : ''}
              placeholder="no limit"
              aria-label={`${cls} limit in dollars`}
              onBlur={(e) => {
                const v = e.target.value.trim()
                if (v === '' && s) return void save('PATCH', { seatClass: cls, clear: true }, cls)
                if (v === '') return
                void save('PATCH', {
                  seatClass: cls, period: s?.period ?? 'month',
                  limitCents: Math.round(parseFloat(v) * 100), hardStop: s?.hard_stop ?? true,
                }, cls)
              }}
              className="w-24 rounded-md border border-border bg-background px-2 py-1 text-[13px] text-foreground"
            />
            <select
              value={s?.period ?? 'month'} disabled={!s || busy === cls}
              aria-label={`${cls} period`}
              onChange={(e) => void save('PATCH', { seatClass: cls, period: e.target.value, limitCents: s!.limit_cents, hardStop: s!.hard_stop }, cls)}
              className="rounded-md border border-border bg-background px-2 py-1 text-[13px] text-foreground"
            >
              {PERIODS.map((p) => <option key={p} value={p}>per {p}</option>)}
            </select>
            <select
              value={s?.hard_stop === false ? 'warn' : 'stop'} disabled={!s || busy === cls}
              aria-label={`${cls} enforcement`}
              onChange={(e) => void save('PATCH', { seatClass: cls, period: s!.period, limitCents: s!.limit_cents, hardStop: e.target.value === 'stop' }, cls)}
              className="rounded-md border border-border bg-background px-2 py-1 text-[13px] text-foreground"
            >
              <option value="stop">stops calls</option>
              <option value="warn">warns only</option>
            </select>
            {busy === cls && <Loader2 size={13} className="animate-spin text-faint" />}
          </div>
        )
      })}

      {/* ── EXCEPTIONS ───────────────────────────────────────────────────── */}
      {people.length > 0 && (
        <>
          <p className="mb-2 mt-4 text-[12px] text-faint">
            Exceptions — a personal limit overrides the seat default.
          </p>
          {people.map((p) => {
            const row = members.find((m) => m.user_id === p.user_id)
            return (
              <div key={p.user_id} className="flex flex-wrap items-center gap-2 border-t border-border/60 py-1.5">
                <span className="w-40 min-w-0 truncate text-sm text-foreground">{p.name ?? p.email}</span>
                <input
                  type="number" min={0} step={1} defaultValue={row?.limit_cents != null ? row.limit_cents / 100 : ''}
                  placeholder={seatOf(p.seat_class ?? 'staff') ? `${money(seatOf(p.seat_class ?? 'staff')!.limit_cents)} default` : 'no limit'}
                  aria-label={`Limit for ${p.name ?? p.email}`}
                  onBlur={(e) => {
                    const v = e.target.value.trim()
                    if (v === '' && row) return void save('PUT', { userId: p.user_id, clear: true }, p.user_id)
                    if (v === '') return
                    void save('PUT', {
                      userId: p.user_id, period: row?.period ?? 'month',
                      limitCents: Math.round(parseFloat(v) * 100), hardStop: row?.hard_stop ?? true,
                    }, p.user_id)
                  }}
                  className="w-28 rounded-md border border-border bg-background px-2 py-1 text-[13px] text-foreground"
                />
                {row && (
                  <select
                    value={row.period} disabled={busy === p.user_id}
                    aria-label={`Period for ${p.name ?? p.email}`}
                    onChange={(e) => void save('PUT', { userId: p.user_id, period: e.target.value, limitCents: row.limit_cents, hardStop: row.hard_stop }, p.user_id)}
                    className="rounded-md border border-border bg-background px-2 py-1 text-[13px] text-foreground"
                  >
                    {PERIODS.map((x) => <option key={x} value={x}>per {x}</option>)}
                  </select>
                )}
                {busy === p.user_id && <Loader2 size={13} className="animate-spin text-faint" />}
              </div>
            )
          })}
        </>
      )}
    </section>
  )
}
