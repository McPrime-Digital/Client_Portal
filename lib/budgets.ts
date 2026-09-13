import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/admin'

/**
 * PER-MEMBER AI BUDGETS — S3-b §4.3, extended to day and week (0063).
 *
 * ── ONE GATE, WHICH THE SPEC IS EXPLICIT ABOUT ─────────────────────────────
 *
 * §4.3: "The gate reads both. A call is permitted only if the org has budget
 * AND the member has budget. Two checks, one gate… building them separately
 * means touching the gate three times." So `checkSpendAllowed()` answers for the
 * ORG and the PERSON together, and the route asks once.
 *
 * ── WHY THE WINDOW IS COMPUTED, NOT STORED ─────────────────────────────────
 *
 * §4.3 keys the table on (organization_id, user_id, period_start), which means a
 * row PER PERSON PER PERIOD — twelve rows a year that all say the same thing, and
 * a cap that silently lapses the first period nobody mints a row for. Here one
 * row states the standing rule and the window is derived at read time, so a limit
 * set once keeps applying and nothing has to run on a schedule to keep it alive.
 *
 * Windows are CALENDAR-ALIGNED, not rolling. A rolling 24h window is harder to
 * game, but it also means a person cannot answer "when does my budget reset" —
 * and a cap nobody can predict produces a support ticket rather than restraint.
 * Calendar alignment also matches org_budgets' monthly cap, so the two never
 * disagree about which period a call fell in. Weeks start Monday.
 *
 * ── IT RUNS ON THE SERVICE ROLE, AND THAT IS DELIBERATE ────────────────────
 *
 * This is called from the AI gate BEFORE the work happens, to decide whether a
 * person may spend. It must read the CALLER's own limit and their own usage —
 * which RLS would permit — but also the SEAT-CLASS DEFAULT and the org's balance,
 * which a plain member cannot read. A gate that could only see what the person
 * being gated can see would be a gate they could widen by not being an admin.
 * The route has already authenticated the user; this is enforcement, not display.
 */

export type BudgetPeriod = 'day' | 'week' | 'month'

export type SpendDecision = {
  allowed: boolean
  /** Which rule stopped it. null when allowed. */
  blockedBy: 'org' | 'member' | null
  /** The person's own window, for the message and for the surface. */
  member: {
    limitCents: number | null
    spentCents: number
    period: BudgetPeriod
    hardStop: boolean
    /** Where the limit came from, so a surface can say "your team's default". */
    source: 'personal' | 'seat-default' | 'none'
    resetsAt: string
  }
  orgBalanceCents: number
}

/** Calendar-aligned window start, in UTC. Weeks start Monday. */
export function windowStart(period: BudgetPeriod, now = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  if (period === 'day') return d
  if (period === 'month') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  // Monday-start week: getUTCDay() is 0 for Sunday, which is 6 days into the week.
  const dow = (d.getUTCDay() + 6) % 7
  return new Date(d.getTime() - dow * 86_400_000)
}

export function windowEnd(period: BudgetPeriod, now = new Date()): Date {
  const s = windowStart(period, now)
  if (period === 'day') return new Date(s.getTime() + 86_400_000)
  if (period === 'week') return new Date(s.getTime() + 7 * 86_400_000)
  return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 1))
}

/**
 * May this person spend on AI right now?
 *
 * Returns a DECISION rather than throwing, because the caller has to distinguish
 * three outcomes that look alike from the outside: out of org credit, over a
 * personal cap that stops, and over a personal cap that only warns. The last one
 * proceeds — a soft limit is a signal to whoever set it, not a wall for the
 * person working.
 */
export async function checkSpendAllowed(
  orgId: string,
  userId: string,
): Promise<SpendDecision> {
  const [{ data: credit }, { data: orgBudget }, { data: budget }, { data: om }] = await Promise.all([
    supabaseAdmin.from('org_credits').select('balance_cents').eq('organization_id', orgId).maybeSingle(),
    supabaseAdmin.from('org_budgets').select('hard_stop').eq('organization_id', orgId).maybeSingle(),
    supabaseAdmin.from('member_budgets').select('period, limit_cents, hard_stop')
      .eq('organization_id', orgId).eq('user_id', userId).maybeSingle(),
    supabaseAdmin.from('organization_members').select('seat_class')
      .eq('organization_id', orgId).eq('user_id', userId).maybeSingle(),
  ])

  const orgBalanceCents = credit?.balance_cents ?? 0

  // The seat-class default applies only when the person has NO row of their own.
  // A row with a null limit is an explicit "no cap for them", which must beat the
  // default — otherwise an exception an admin deliberately granted would be
  // silently reverted by a policy set later.
  let limitCents: number | null = null
  let period: BudgetPeriod = 'month'
  let hardStop = true
  let source: SpendDecision['member']['source'] = 'none'

  if (budget) {
    limitCents = budget.limit_cents as number | null
    period = (budget.period as BudgetPeriod) ?? 'month'
    hardStop = budget.hard_stop as boolean
    source = limitCents === null ? 'none' : 'personal'
  } else if (om?.seat_class) {
    const { data: seat } = await supabaseAdmin
      .from('org_seat_budgets').select('period, limit_cents, hard_stop')
      .eq('organization_id', orgId).eq('seat_class', om.seat_class).maybeSingle()
    if (seat) {
      limitCents = seat.limit_cents as number
      period = (seat.period as BudgetPeriod) ?? 'month'
      hardStop = seat.hard_stop as boolean
      source = 'seat-default'
    }
  }

  const from = windowStart(period)
  const to = windowEnd(period)

  // Spend in the window, by this person. usage_events.created_by is only
  // trustworthy for this because 0061 recovered it — before that every billed
  // row was anonymous and a per-member cap could not have been enforced at all.
  const { data: rows } = await supabaseAdmin
    .from('usage_events')
    .select('cost_cents')
    .eq('organization_id', orgId)
    .eq('created_by', userId)
    .gte('created_at', from.toISOString())
    .lt('created_at', to.toISOString())
    .limit(5000)
  const spentCents = (rows ?? []).reduce((s, r) => s + (r.cost_cents ?? 0), 0)

  const overPersonal = limitCents !== null && spentCents >= limitCents
  // THE ORG GATE KEEPS ITS EXISTING MEANING EXACTLY — hard stop AND no balance.
  //
  // The first draft of this dropped the hard_stop conjunct and blocked on an
  // empty balance alone, which would have taken every studio that has never set
  // a budget off the air the moment their credits hit zero. That is a silent
  // behaviour change for ALL of them, arriving inside a feature about per-person
  // limits. The route's original condition is reproduced, not reinterpreted.
  const orgHardStop = orgBudget?.hard_stop ?? false
  const orgBlocked = orgHardStop && orgBalanceCents <= 0

  return {
    allowed: !(overPersonal && hardStop) && !orgBlocked,
    blockedBy: orgBlocked ? 'org' : overPersonal && hardStop ? 'member' : null,
    member: { limitCents, spentCents, period, hardStop, source, resetsAt: to.toISOString() },
    orgBalanceCents,
  }
}
