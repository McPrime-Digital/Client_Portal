import { requireOrgFeature } from '@/lib/studio/guard'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { userOrgId } from '@/lib/auth/role'
import { can } from '@/lib/capabilities.server'
import { Gauge, CircleAlert } from 'lucide-react'
import Link from 'next/link'

/**
 * CREW · CONTROL TOWER — the cost surface, over an engine that has been live
 * since the credit-metering batch and has never had a page.
 *
 * `org_credits` (balance), `org_budgets` (monthly cap, alert %, hard stop),
 * `credit_ledger` (18 rows) and `usage_events` (49 rows) are all live, written by
 * `lib/credits.ts` and `lib/usage.ts` on every AI call, and topped up through the
 * Stripe checkout route. The rail has carried a `COST` badge pointing at a
 * "Phase 3 · coming soon" card the whole time.
 *
 * ── IT READS ON THE USER CLIENT, SO 0053 IS THE CONTROL ────────────────────
 *
 * All four tables carry a `has_cap('money.costs')` predicate in RLS since
 * migration 0053. Reading them here on the cookie-bound client means the POLICY
 * decides, and the route guard (`money.costs` via ORG_FEATURE_CAP) only decides
 * what to SAY — which is R-5 exactly: "a clear 403 beats a silent empty set, but
 * the route is the message, not the control."
 *
 * A crew or coordinator member never reaches this page: `crew/control-tower` maps
 * to `money.costs` in ORG_FEATURE_CAP, so requireOrgFeature redirects them, and
 * the rail never drew the tile. `finance` and `producer` hold it; `producer` on
 * the strength of S-R §3.1's "budget on their own productions".
 *
 * ── THE HOUSE ORG IS NOT EXEMPTED HERE, AND MUST NOT BE ────────────────────
 *
 * Spend is METERED for every tenant including the house org — the exemption in
 * lib/billing/plans.ts is about being BLOCKED or CHARGED, not about being
 * counted. A cost surface that hid the house org's own spend would make the one
 * tenant most likely to notice a runaway bill the one least able to see it.
 */
export const dynamic = 'force-dynamic'

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default async function ControlTowerPage() {
  await requireOrgFeature('crew', 'control-tower')
  const user = await getCurrentUser()
  if (!user) return null
  const orgId = userOrgId(user)
  const supabase = await createClient()

  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)

  const [creditsRes, budgetRes, usageRes, ledgerRes] = await Promise.all([
    supabase.from('org_credits').select('balance_cents').eq('organization_id', orgId).maybeSingle(),
    supabase.from('org_budgets').select('monthly_cap_cents, alert_pct, hard_stop').eq('organization_id', orgId).maybeSingle(),
    supabase.from('usage_events').select('kind, units, cost_cents, created_at')
      .eq('organization_id', orgId).gte('created_at', monthStart.toISOString()).limit(1000),
    supabase.from('credit_ledger').select('delta_cents, reason, created_at')
      .eq('organization_id', orgId).order('created_at', { ascending: false }).limit(10),
  ])

  // A read that was REFUSED and a tenant with no rows are different facts. The
  // policy refuses by returning no rows rather than an error, so only a genuine
  // error is reported as one — anything else renders as the zero it is.
  if (creditsRes.error || usageRes.error) {
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-card p-8 text-center">
        <CircleAlert size={22} className="mx-auto text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">Cost data could not be loaded. Try again.</p>
      </div>
    )
  }

  const balance = creditsRes.data?.balance_cents ?? 0
  const cap = budgetRes.data?.monthly_cap_cents ?? null
  const alertPct = budgetRes.data?.alert_pct ?? 80
  const hardStop = budgetRes.data?.hard_stop ?? false

  type Ev = { kind: string; units: number | null; cost_cents: number | null; created_at: string }
  const events = (usageRes.data ?? []) as Ev[]
  const spent = events.reduce((s, e) => s + (e.cost_cents ?? 0), 0)
  const byKind = new Map<string, { n: number; cents: number }>()
  for (const e of events) {
    const k = byKind.get(e.kind) ?? { n: 0, cents: 0 }
    k.n += e.units ?? 1
    k.cents += e.cost_cents ?? 0
    byKind.set(e.kind, k)
  }
  const pct = cap && cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : null
  const topUp = await can(user, 'money.credits.topup')

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6 flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-secondary text-primary">
          <Gauge size={18} />
        </span>
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">Control Tower</h1>
          <p className="text-xs text-muted-foreground">AI spend and credits, this month</p>
        </div>
      </header>

      <div className="mb-5 grid gap-2 sm:grid-cols-3">
        <div className="glass-inset squircle border border-border p-4">
          <p className="font-display text-2xl font-semibold text-foreground">{money(balance)}</p>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">Credit balance</p>
          {topUp && (
            <Link href="/studio/crew/settings" className="mt-1.5 inline-block text-[11px] text-primary hover:underline">
              Top up
            </Link>
          )}
        </div>
        <div className="glass-inset squircle border border-border p-4">
          <p className="font-display text-2xl font-semibold text-foreground">{money(spent)}</p>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">Spent this month</p>
        </div>
        <div className="glass-inset squircle border border-border p-4">
          <p className="font-display text-2xl font-semibold text-foreground">
            {cap === null ? '—' : money(cap)}
          </p>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            {cap === null ? 'No monthly cap set' : hardStop ? 'Monthly cap · hard stop' : 'Monthly cap · alert only'}
          </p>
        </div>
      </div>

      {pct !== null && (
        <div className="mb-6">
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-destructive' : pct >= alertPct ? 'bg-primary' : 'bg-primary/60'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {pct}% of the monthly cap
            {pct >= alertPct && pct < 100 && ' · past the alert threshold'}
            {/* Says what HAPPENS, not just what is configured: "hard stop" means
                calls are refused, and somebody reading this at 100% needs to know
                that before they go looking for a bug in the Suite. */}
            {pct >= 100 && (hardStop ? ' · new AI calls are being refused' : ' · over cap, calls still allowed')}
          </p>
        </div>
      )}

      <section className="mb-6">
        <h2 className="mb-2 font-display text-sm font-semibold text-foreground">Where it went</h2>
        {byKind.size === 0 ? (
          <div className="rounded-2xl border border-border bg-card px-5 py-6 text-center">
            <p className="text-sm text-muted-foreground">No usage recorded this month.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            {[...byKind.entries()].sort((a, b) => b[1].cents - a[1].cents).map(([kind, v]) => (
              <div key={kind} className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0">
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{kind}</span>
                <span className="text-[11px] text-faint">{v.n.toLocaleString()} units</span>
                <span className="w-20 text-right text-sm tabular-nums text-muted-foreground">{money(v.cents)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {(ledgerRes.data ?? []).length > 0 && (
        <section>
          <h2 className="mb-2 font-display text-sm font-semibold text-foreground">Recent credit movement</h2>
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            {(ledgerRes.data as { delta_cents: number; reason: string | null; created_at: string }[]).map((l, i) => (
              <div key={i} className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0">
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{l.reason ?? 'Adjustment'}</span>
                <span className="text-[11px] text-faint">
                  {new Date(l.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
                <span className={`w-20 text-right text-sm tabular-nums ${l.delta_cents >= 0 ? 'text-primary' : 'text-muted-foreground'}`}>
                  {l.delta_cents >= 0 ? '+' : ''}{money(l.delta_cents)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
