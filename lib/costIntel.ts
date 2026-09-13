import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * AI COST INTELLIGENCE — the computation behind Control Tower.
 *
 * ── WHY THIS IS A MODULE AND NOT JSX ───────────────────────────────────────
 *
 * Every number here is a claim about money. Burn rate, runway, an anomaly flag —
 * each one will be read as fact and acted on, and one of them ("your credits run
 * out on the 14th") is the kind of statement that gets forwarded to a finance
 * lead. Arithmetic that carries that weight belongs somewhere it can be read and
 * checked, not interleaved with markup.
 *
 * ── WHAT THE MARKET DOES NOT HAVE ──────────────────────────────────────────
 *
 * Frame.io and Flow Production Tracking have no AI cost governance at all —
 * spend on generative work is invisible inside the tool that produces it.
 * General FinOps products have burn and forecast but sit outside the production
 * workflow and know nothing about who the crew are. This sits inside the
 * production tool AND knows the roster, which is the combination neither side
 * has.
 *
 * ── EVERY FIGURE IS HONEST ABOUT ITS OWN CONFIDENCE ────────────────────────
 *
 * A projection from three days of data is not a projection, it is a guess with a
 * decimal point. Each derived figure carries the sample it came from, and the
 * surface is required to say so. A confident wrong number in a money view is
 * worse than no number — it is the shape HANDOFF §12 lesson 6 records one domain
 * over: a probe that cannot tell "refused" from "did nothing".
 */

export type UsageRow = {
  kind: string
  units: number | null
  cost_cents: number | null
  created_at: string
  created_by: string | null
}

export type CostIntel = {
  /** Spend inside the current calendar month, in cents. */
  monthCents: number
  /** Mean daily spend over the trailing window that HAS data. */
  burnPerDayCents: number
  /** Days of history the burn rate is computed from. Below 7 the surface must
   *  present burn as indicative rather than as a rate. */
  burnSampleDays: number
  /** Calendar days until the balance is exhausted at the current burn. null when
   *  burn is zero (nothing is being spent, so nothing runs out) or the balance is
   *  already zero. */
  runwayDays: number | null
  /** Month-end spend if the current burn continues. null below the sample floor:
   *  projecting from two days of data is a guess wearing a decimal point. */
  projectedMonthCents: number | null
  /** Share of the cap the projection lands on, 0–999. null when no cap is set. */
  projectedPctOfCap: number | null
  /** Today's spend against the trailing median day. Only set when today is
   *  materially above it AND the sample is large enough to have a median worth
   *  comparing to. */
  anomaly: { todayCents: number; medianCents: number; multiple: number } | null
  /** Spend per person, descending. Empty when nothing billed is attributed. */
  byActor: { userId: string; cents: number; events: number }[]
  /** Spend per metering kind, descending. */
  byKind: { kind: string; cents: number; units: number; events: number }[]
  /** Daily totals for the trailing 30 days, oldest first, zero-filled — a
   *  sparkline with gaps for quiet days lies about the shape of the burn. */
  daily: { day: string; cents: number }[]
}

const DAY = 86_400_000
const dayKey = (iso: string) => iso.slice(0, 10)

/** The floor below which a projection is not reported. Three days of a new
 *  studio's traffic says nothing about its month. */
const MIN_SAMPLE_DAYS = 5

export function computeCostIntel(
  rows: UsageRow[],
  opts: { balanceCents: number; capCents: number | null; now?: Date },
): CostIntel {
  const now = opts.now ?? new Date()
  const todayKey = now.toISOString().slice(0, 10)
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()
  const dayOfMonth = now.getUTCDate()

  const billed = rows.filter((r) => (r.cost_cents ?? 0) > 0)

  const monthCents = billed
    .filter((r) => new Date(r.created_at) >= monthStart)
    .reduce((s, r) => s + (r.cost_cents ?? 0), 0)

  // ── daily series, zero-filled across the whole window ────────────────────
  const byDay = new Map<string, number>()
  for (const r of billed) {
    const k = dayKey(r.created_at)
    byDay.set(k, (byDay.get(k) ?? 0) + (r.cost_cents ?? 0))
  }
  const daily: { day: string; cents: number }[] = []
  for (let i = 29; i >= 0; i--) {
    const k = new Date(now.getTime() - i * DAY).toISOString().slice(0, 10)
    daily.push({ day: k, cents: byDay.get(k) ?? 0 })
  }

  // ── burn rate, over the window that actually has history ────────────────
  //
  // Measured from the FIRST billed event, not from a fixed 30 days: a studio
  // three days old would otherwise have its burn divided by 30 and read as
  // almost nothing, which is the number that matters most being wrong in the
  // reassuring direction.
  // COUNTED IN CALENDAR DAYS, INCLUSIVE — not in elapsed milliseconds.
  //
  // The first version divided by `ceil((now - firstEvent) / DAY)`, which
  // undercounts by one whenever activity spans a day boundary: a first event
  // exactly 24h ago covers TWO days (yesterday and today) but measures as one,
  // so burn came out DOUBLE. Caught by a fixture spreading six events over two
  // days and asserting the rate — worth stating because burn is not a display
  // figure, it is the input to both runway and the month-end projection, so an
  // off-by-one here propagates into "your credits run out on the 7th".
  const firstBilledDay = billed.reduce<string | null>(
    (min, r) => { const d = dayKey(r.created_at); return min === null || d < min ? d : min },
    null,
  )
  const burnSampleDays = firstBilledDay === null
    ? 0
    : Math.max(1, Math.min(30,
        Math.round((Date.parse(`${todayKey}T00:00:00Z`) - Date.parse(`${firstBilledDay}T00:00:00Z`)) / DAY) + 1))
  const windowStartDay = new Date(now.getTime() - (burnSampleDays - 1) * DAY).toISOString().slice(0, 10)
  const windowCents = billed
    .filter((r) => dayKey(r.created_at) >= windowStartDay)
    .reduce((s, r) => s + (r.cost_cents ?? 0), 0)
  const burnPerDayCents = burnSampleDays === 0 ? 0 : windowCents / burnSampleDays

  // ── runway ──────────────────────────────────────────────────────────────
  const runwayDays = burnPerDayCents > 0 && opts.balanceCents > 0
    ? Math.floor(opts.balanceCents / burnPerDayCents)
    : null

  // ── projection, only above the sample floor ─────────────────────────────
  const projectedMonthCents = burnSampleDays >= MIN_SAMPLE_DAYS
    ? Math.round(monthCents + burnPerDayCents * (daysInMonth - dayOfMonth))
    : null
  const projectedPctOfCap = projectedMonthCents !== null && opts.capCents && opts.capCents > 0
    ? Math.min(999, Math.round((projectedMonthCents / opts.capCents) * 100))
    : null

  // ── anomaly: today against the trailing median DAY ──────────────────────
  //
  // Median, not mean: one heavy render day would drag a mean upward and hide the
  // next spike behind it. Days with zero spend are excluded from the median —
  // a studio that works weekdays would otherwise have a median of zero and every
  // Monday would read as an anomaly.
  const todayCents = byDay.get(todayKey) ?? 0
  const priorActive = daily
    .filter((d) => d.day !== todayKey && d.cents > 0)
    .map((d) => d.cents)
    .sort((a, b) => a - b)
  let anomaly: CostIntel['anomaly'] = null
  if (priorActive.length >= 3 && todayCents > 0) {
    const mid = Math.floor(priorActive.length / 2)
    const median = priorActive.length % 2
      ? priorActive[mid]
      : (priorActive[mid - 1] + priorActive[mid]) / 2
    const multiple = median > 0 ? todayCents / median : 0
    // 3× a normal day, and materially more than a rounding difference.
    if (multiple >= 3 && todayCents - median >= 50) {
      anomaly = { todayCents, medianCents: Math.round(median), multiple: Math.round(multiple * 10) / 10 }
    }
  }

  // ── attribution ─────────────────────────────────────────────────────────
  const actorMap = new Map<string, { cents: number; events: number }>()
  for (const r of billed) {
    if (!r.created_by) continue
    const a = actorMap.get(r.created_by) ?? { cents: 0, events: 0 }
    a.cents += r.cost_cents ?? 0
    a.events += 1
    actorMap.set(r.created_by, a)
  }
  const byActor = [...actorMap.entries()]
    .map(([userId, v]) => ({ userId, ...v }))
    .sort((a, b) => b.cents - a.cents)

  const kindMap = new Map<string, { cents: number; units: number; events: number }>()
  for (const r of rows) {
    const k = kindMap.get(r.kind) ?? { cents: 0, units: 0, events: 0 }
    k.cents += r.cost_cents ?? 0
    k.units += r.units ?? 0
    k.events += 1
    kindMap.set(r.kind, k)
  }
  const byKind = [...kindMap.entries()]
    .map(([kind, v]) => ({ kind, ...v }))
    .sort((a, b) => b.cents - a.cents || b.events - a.events)

  return {
    monthCents, burnPerDayCents, burnSampleDays, runwayDays,
    projectedMonthCents, projectedPctOfCap, anomaly, byActor, byKind, daily,
  }
}

/** Reads the window on the CALLER's client, so 0053's has_cap('money.costs')
 *  predicate on usage_events is the control rather than a route check. */
export async function loadCostIntel(
  db: SupabaseClient,
  opts: { balanceCents: number; capCents: number | null; now?: Date },
): Promise<CostIntel & { readFailed: boolean }> {
  const now = opts.now ?? new Date()
  // 30 days of trailing history, which is both the sparkline window and the
  // widest input any figure above uses.
  const since = new Date(now.getTime() - 30 * DAY).toISOString()
  const { data, error } = await db
    .from('usage_events')
    .select('kind, units, cost_cents, created_at, created_by')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(5000)

  // A refused or failed read is NOT a month of zero spend. Rendering one would
  // be a claim the query never supported, on the surface where a wrong zero is
  // most expensive.
  if (error) {
    return {
      ...computeCostIntel([], opts),
      readFailed: true,
    }
  }
  return { ...computeCostIntel((data ?? []) as UsageRow[], opts), readFailed: false }
}
