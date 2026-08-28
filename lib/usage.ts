import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/admin'
import { captureError } from '@/lib/errors'

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
    const { error } = await supabaseAdmin.from('usage_events').insert({
      organization_id: organizationId,
      kind,
      units,
      cost_cents: Math.round(costCents),
      ref,
      created_by: createdBy ?? null,
    })
    // supabase-js does not throw on a failed insert — it RETURNS the error.
    // The old catch-only shape meant a rejected metering row vanished without
    // a trace, which is how storage.bytes wrote nothing for months while the
    // function looked fine (Batch 6 item 5).
    if (error) {
      captureError(new Error(`usage insert rejected: ${error.message}`), {
        where: 'recordUsage', kind, organizationId, units,
      })
    }
  } catch (err) {
    // Metering must never take down the action it measures — but the failure
    // must reach the sink (I-10).
    captureError(err, { where: 'recordUsage', kind, organizationId, units })
  }
}
