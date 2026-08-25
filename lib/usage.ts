import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/admin'

// The single metering write path. EVERY billable boundary calls this — even
// while the surface is priced at zero — so the metered-vs-subscription launch
// decision stays a pricing decision, not an engineering one. The house org is
// metered like everyone else (its usage is the ground truth pricing is built
// on); gating/charging is a separate concern (lib/billing, lib/credits).
//
// kinds in use:
//   'primeos'        units = tokens (charged via charge_credits at the AI boundary)
//   'storage.bytes'  units = bytes committed to R2
//   'sms.sent'       units = messages sent (pass-through cost)
//   'seat.invited'   units = 1 per member invite (org or client side)
// New surfaces add a kind here — never a second write path.
export async function recordUsage(
  organizationId: string,
  kind: string,
  units: number,
  costCents = 0,
  ref: Record<string, unknown> = {},
  createdBy?: string
): Promise<void> {
  try {
    await supabaseAdmin.from('usage_events').insert({
      organization_id: organizationId,
      kind,
      units,
      cost_cents: Math.round(costCents),
      ref,
      created_by: createdBy ?? null,
    })
  } catch {
    // Metering must never take down the action it measures.
  }
}
