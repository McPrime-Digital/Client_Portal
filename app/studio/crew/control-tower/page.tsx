import Link from 'next/link'
import { requireOrgFeature } from '@/lib/studio/guard'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { can } from '@/lib/capabilities.server'
import { loadCostIntel } from '@/lib/costIntel'
import Sparkline from '@/components/studio/Sparkline'

/**
 * CONTROL TOWER — AI spend governance, over an engine live since the credit
 * batch that has never had a page.
 *
 * ── WHAT IS AHEAD OF THE MARKET HERE ───────────────────────────────────────
 *
 * Frame.io and Flow Production Tracking have NO AI cost governance: spend on
 * generative work is invisible inside the tool that produces it. General FinOps
 * products have burn and forecast but sit outside the workflow and do not know
 * who the crew are. This is inside the production tool AND knows the roster —
 * so it can answer "who spent it", which is the first question an organisation
 * asks and the one neither side can answer.
 *
 * ── IT READS ON THE USER CLIENT, SO 0053 IS THE CONTROL ────────────────────
 *
 * usage_events, org_credits, org_budgets and credit_ledger all carry a
 * has_cap('money.costs') predicate in RLS. Reading them on the cookie-bound
 * client makes the POLICY the control and the route guard only the message
 * (R-5). A crew or coordinator member never arrives: crew/control-tower maps to
 * money.costs, so requireOrgFeature redirects and the rail never drew the tile.
 *
 * ── THE HOUSE ORG IS NOT EXEMPTED, AND MUST NOT BE ─────────────────────────
 *
 * Spend is METERED for every tenant including the house org — the plan exemption
 * is about being blocked or charged, not about being counted. A cost surface
 * that hid the house org's own spend would blind the one tenant most likely to
 * notice a runaway bill.
 *
 * ── EVERY FIGURE STATES ITS OWN CONFIDENCE ─────────────────────────────────
 *
 * A projection from three days of data is a guess with a decimal point, so
 * lib/costIntel.ts withholds it below a sample floor and this page says how many
 * days the burn rate rests on. On a surface where numbers get forwarded to a
 * finance lead, a confident wrong figure is worse than no figure.
 */
export const dynamic = 'force-dynamic'

const money = (cents: number) => {
  const v = cents / 100
  return v >= 1000
    ? `$${Math.round(v).toLocaleString('en-US')}`
    : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

export default async function ControlTowerPage() {
  await requireOrgFeature('crew', 'control-tower')
  const user = await getCurrentUser()
  if (!user) return null
  const supabase = await createClient()

  const [creditsRes, budgetRes] = await Promise.all([
    supabase.from('org_credits').select('balance_cents').maybeSingle(),
    supabase.from('org_budgets').select('monthly_cap_cents, alert_pct, hard_stop').maybeSingle(),
  ])

  const balance = creditsRes.data?.balance_cents ?? 0
  const cap = budgetRes.data?.monthly_cap_cents ?? null
  const hardStop = budgetRes.data?.hard_stop ?? false

  const intel = await loadCostIntel(supabase, { balanceCents: balance, capCents: cap })

  if (intel.readFailed) {
    // A failed read is NOT a month of zero spend. Rendering one would be a claim
    // the query never supported, on the surface where a wrong zero costs most.
    return (
      <div className="mx-auto max-w-2xl pt-[8vh]">
        <h1 className="font-display text-[22px] font-semibold text-foreground">Control Tower</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">
          Spend data couldn&apos;t be loaded, so nothing here would be accurate. Reload to try again.
        </p>
      </div>
    )
  }

  const [{ data: roster }, canTopUp] = await Promise.all([
    intel.byActor.length
      ? supabase.from('organization_members').select('user_id, name, email')
          .in('user_id', intel.byActor.map((a) => a.userId))
      : Promise.resolve({ data: [] as { user_id: string; name: string | null; email: string }[] }),
    can(user, 'money.credits.topup'),
  ])
  const nameOf = (id: string) => {
    const m = (roster ?? []).find((r) => r.user_id === id)
    return m?.name ?? m?.email ?? 'Someone no longer on the team'
  }

  const billedTotal = intel.byKind.reduce((s, k) => s + k.cents, 0)
  const peak = Math.max(...intel.daily.map((d) => d.cents), 1)

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-7">
        <h1 className="font-display text-[22px] font-semibold tracking-[-0.01em] text-foreground">
          Control Tower
        </h1>
        <p className="mt-0.5 text-[13px] text-faint">AI spend, credits and who is using them</p>
      </header>

      {/* THE ANOMALY LEADS, or nothing does. A spike is the only thing on this
          page that is time-sensitive, so it goes above the numbers that are true
          every day. Below it the page reads calmly. */}
      {intel.anomaly && (
        <div className="squircle mb-5 border border-[hsl(var(--status-amber)/0.4)] bg-[hsl(var(--status-amber)/0.08)] px-4 py-3">
          <p className="text-[14px] text-foreground">
            Today&apos;s spend is{' '}
            <span className="font-display font-semibold tabular-nums">{intel.anomaly.multiple}×</span>{' '}
            a normal day — {money(intel.anomaly.todayCents)} against a usual {money(intel.anomaly.medianCents)}.
          </p>
        </div>
      )}

      {/* ── THE PRIMARY NUMBER, and it changes with the situation ──────────
          With a cap, the question is "are we going to blow it". Without one it
          is "how long do the credits last". Showing both as equal tiles would
          make the reader decide which matters, which is the page's job. */}
      <section className="squircle-lg mb-5 border border-border bg-card p-5">
        {cap !== null ? (
          <>
            <p className="font-display text-[34px] font-semibold leading-none tabular-nums text-foreground">
              {money(intel.monthCents)}
              <span className="ml-2 text-[15px] font-normal text-faint">of {money(cap)} this month</span>
            </p>
            {intel.projectedPctOfCap !== null && (
              <p className="mt-2 text-[13.5px] text-muted-foreground">
                On track for {money(intel.projectedMonthCents!)} — {intel.projectedPctOfCap}% of the cap
                {intel.projectedPctOfCap >= 100 && hardStop && ' , which would stop AI calls before month end'}
                {intel.projectedPctOfCap >= 100 && !hardStop && ' , which the cap will not block'}
                .
              </p>
            )}
          </>
        ) : (
          <>
            <p className="font-display text-[34px] font-semibold leading-none tabular-nums text-foreground">
              {money(balance)}
              <span className="ml-2 text-[15px] font-normal text-faint">in credits</span>
            </p>
            <p className="mt-2 text-[13.5px] text-muted-foreground">
              {intel.burnPerDayCents > 0 ? (
                <>
                  Spending {money(Math.round(intel.burnPerDayCents))} a day
                  {intel.runwayDays !== null
                    ? <> — about {intel.runwayDays} days left at that rate.</>
                    : <>.</>}
                  {intel.burnSampleDays < 7 && (
                    <span className="text-faint"> Based on {intel.burnSampleDays} day
                      {intel.burnSampleDays === 1 ? '' : 's'} so far.</span>
                  )}
                </>
              ) : (
                <>No AI spend in the last 30 days.</>
              )}
            </p>
            {/* Empty state as onboarding: name the thing that would help. */}
            <p className="mt-3 text-[12.5px] text-faint">
              No monthly cap set — spend is tracked but never blocked.
            </p>
          </>
        )}

        {billedTotal > 0 && (
          <div className="mt-4">
            <Sparkline points={intel.daily.map((d) => d.cents)} peak={peak} />
            <div className="mt-1 flex justify-between text-[10.5px] text-faint">
              <span>{day(intel.daily[0].day)}</span>
              <span>{day(intel.daily[intel.daily.length - 1].day)}</span>
            </div>
          </div>
        )}
      </section>

      {/* ── WHO SPENT IT — the question no competitor can answer ───────────
          Possible only because migration 0061 recovered created_by on billed
          rows; before it, every row that cost money was anonymous. */}
      {intel.byActor.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-2 font-display text-[13px] font-semibold text-muted-foreground">Who spent it</h2>
          <div className="squircle overflow-hidden border border-border bg-card">
            {intel.byActor.map((a) => (
              <div key={a.userId} className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0">
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{nameOf(a.userId)}</span>
                <span className="text-[11px] text-faint">{a.events} call{a.events === 1 ? '' : 's'}</span>
                <span className="w-16 text-right text-sm tabular-nums text-muted-foreground">{money(a.cents)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {intel.byKind.some((k) => k.cents > 0) && (
        <section className="mb-5">
          <h2 className="mb-2 font-display text-[13px] font-semibold text-muted-foreground">What it went on</h2>
          <div className="squircle overflow-hidden border border-border bg-card">
            {intel.byKind.filter((k) => k.cents > 0).map((k) => (
              <div key={k.kind} className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0">
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{k.kind}</span>
                <span className="text-[11px] text-faint">{k.units.toLocaleString()} units</span>
                <span className="w-16 text-right text-sm tabular-nums text-muted-foreground">{money(k.cents)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {billedTotal === 0 && (
        <p className="text-[15px] text-muted-foreground">
          Nothing has been spent on AI in the last 30 days.
        </p>
      )}

      {canTopUp && (
        <Link
          href="/studio/crew/settings"
          className="squircle-sm mt-6 inline-flex items-center border border-border bg-card px-3 py-1.5 text-[13px] text-foreground outline-none transition-[border-color,transform] duration-[--dur-pop] ease-[--ease-out] hover:border-[hsl(var(--glow)/0.45)] focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
        >
          Add credits
        </Link>
      )}
    </div>
  )
}
