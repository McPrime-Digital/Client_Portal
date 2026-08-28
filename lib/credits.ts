import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/admin'
import { captureError } from '@/lib/errors'

// SaaS credit metering. Credits are held in cents on org_credits.balance_cents.
// The company's keys are server-side; each AI action estimates a cost, gates on
// the org's balance/budget, and charges via the atomic charge_credits() RPC.

// Blended rate (cents per 1k tokens, incl. SaaS margin). Tune per real pricing.
const RATE_CENTS_PER_1K: Record<string, number> = {
  'anthropic/claude-opus': 3.0,
  'anthropic/claude-sonnet': 1.2,
  'anthropic/claude-haiku': 0.25,
  'openai/gpt-5': 2.0,
  'openai/gpt-4o': 1.0,
  'openai/o-series': 2.5,
  'google/gemini-pro': 0.8,
  'google/gemini-flash': 0.12,
}

// ~4 chars per token; min 1 cent so every metered call is recorded.
export function estimateCostCents(modelId: string, inChars: number, outChars: number): number {
  const rate = RATE_CENTS_PER_1K[modelId] ?? 1.0
  const tokens = (inChars + outChars) / 4
  return Math.max(1, Math.ceil((tokens / 1000) * rate))
}

export async function getCreditState(orgId: string): Promise<{ balanceCents: number; hardStop: boolean }> {
  const [creditRes, budgetRes] = await Promise.all([
    supabaseAdmin.from('org_credits').select('balance_cents').eq('organization_id', orgId).maybeSingle(),
    supabaseAdmin.from('org_budgets').select('hard_stop').eq('organization_id', orgId).maybeSingle(),
  ])
  // A read error here silently becomes "0 balance, no hard stop" — i.e. the
  // gate evaluates against invented numbers. Surface it (I-10); the fallback
  // behaviour itself is unchanged.
  if (creditRes.error) captureError(new Error(`org_credits read failed: ${creditRes.error.message}`), { where: 'getCreditState', orgId })
  if (budgetRes.error) captureError(new Error(`org_budgets read failed: ${budgetRes.error.message}`), { where: 'getCreditState', orgId })
  return { balanceCents: creditRes.data?.balance_cents ?? 0, hardStop: budgetRes.data?.hard_stop ?? false }
}

export async function chargeCredits(
  orgId: string,
  cents: number,
  reason: string,
  ref: Record<string, unknown> = {},
): Promise<number | null> {
  // journal the raw usage event too (Control Tower reads usage_events)
  const { error: journalError } = await supabaseAdmin.from('usage_events').insert({
    organization_id: orgId,
    kind: reason,
    units: cents,
    cost_cents: cents,
    ref,
  })
  if (journalError) {
    captureError(new Error(`usage journal insert rejected: ${journalError.message}`), {
      where: 'chargeCredits', orgId, reason, cents,
    })
  }
  const { data, error } = await supabaseAdmin.rpc('charge_credits', {
    p_org: orgId,
    p_cents: cents,
    p_reason: reason,
    p_ref: ref,
  })
  // A failed charge returning null reads as "RPC missing / no balance row" to
  // the caller — which is survivable, but must never be invisible: this is
  // the money path.
  if (error) captureError(new Error(`charge_credits failed: ${error.message}`), { where: 'chargeCredits', orgId, reason, cents })
  return typeof data === 'number' ? data : null
}