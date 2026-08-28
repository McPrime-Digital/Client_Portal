import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/admin'
import { captureError } from '@/lib/errors'
import { recordUsage } from '@/lib/usage'

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

// Cost from a REAL token count. This is the path every AI call should take:
// all three providers report usage and S-V §11 requires provider-reported
// figures, never estimates. Min 1 cent so every metered call is recorded.
export function costCentsForTokens(modelId: string, tokensIn: number, tokensOut: number): number {
  const rate = RATE_CENTS_PER_1K[modelId] ?? 1.0
  return Math.max(1, Math.ceil(((tokensIn + tokensOut) / 1000) * rate))
}

// FALLBACK ONLY — ~4 chars per token. Reached when a stream is cancelled or a
// provider frame carrying usage never arrives, so a call is still charged
// rather than free. Rows produced this way carry ref.measured = false; do not
// mix them with measured rows in a pricing analysis (S-V §11 defect 1 is
// exactly what happens when two units share one label).
export function estimateCostCents(modelId: string, inChars: number, outChars: number): number {
  return costCentsForTokens(modelId, Math.ceil(inChars / 4), Math.ceil(outChars / 4))
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

  // NO ROW MEANS ON, not off (S0 §4 — hard stop is on by default, opt-out
  // only). 0024 flips the column default, but a DEFAULT only applies to an
  // INSERT, and nothing in the application inserts org_budgets: an org that has
  // never had a budget configured has no row at all, and this fallback is the
  // only thing that decides for it. `?? false` meant every new tenant billed
  // past zero until someone remembered to create the row.
  //
  // THE OPT-OUT IS A STATED VALUE, NOT AN IDENTITY TEST. This read
  // `orgId === DEFAULT_ORG_ID ? false : …`, which is a hardcoded McPrime
  // identity — S0 P-1 calls that a defect, not a shortcut, and it is the shape
  // where "convenient for McPrime" and "correct for a tenant" diverge: no other
  // org could ever be granted the same exemption without editing this line.
  // 0024 already writes the house org an explicit `hard_stop = false` row, so
  // the exemption is recorded where every other per-org decision is recorded.
  // Same precedent as scope_mode (0018 A5): a stated decision, never an
  // inferred default.
  //
  // The consequence is deliberate. Delete the house org's row and the house org
  // gets gated like anyone else, because the statement IS the row — which is
  // exactly what makes it a statement. 0024's insert-if-absent restores it.
  const hardStop = budgetRes.data?.hard_stop ?? true
  return { balanceCents: creditRes.data?.balance_cents ?? 0, hardStop }
}

export async function chargeCredits(
  orgId: string,
  cents: number,
  reason: string,
  ref: Record<string, unknown> = {},
  /** NATIVE units for the usage row (e.g. tokens for AI calls). The ledger
   *  charge stays in cents; the usage row must not (S-V §11 defect 1 — a
   *  units column mixing cents and tokens is incomparable across rows and
   *  poisons pricing analysis). Falls back to cents when the caller has no
   *  native measure, which keeps old call shapes working. */
  units?: number,
  /** The metering kind for usage_events (S-V §11's taxonomy: 'ai.text.tokens',
   *  'ai.image.count', …). Deliberately SEPARATE from `reason`, which is the
   *  credit_ledger's money-category label ('primeos' | 'topup' | … — 0011:16).
   *  They are two vocabularies over one event: the ledger answers "what was
   *  this charge for", the taxonomy answers "what was consumed". Collapsing
   *  them would force 'topup' — which consumes nothing — into the metering
   *  taxonomy. Defaults to `reason` so existing call shapes are unchanged. */
  kind?: string,
): Promise<number | null> {
  // Journal the raw usage event through THE write path (lib/usage.ts —
  // "never a second"), not a local insert. Control Tower reads usage_events.
  await recordUsage(orgId, kind ?? reason, units ?? cents, cents, ref)
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