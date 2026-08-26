import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/admin'
import type { BusinessSettings } from '@/lib/types/database'

// business_settings is PER-TENANT as of migration 0018 (S1 §7 A3 / T-3): the
// row is keyed by organization_id and the legacy `id text default 'singleton'`
// column is gone. The table holds tenant identity, address and BANK DETAILS,
// so a lookup that isn't org-scoped hands one studio another's account number.
//
// Every read and write in the app goes through this module. Nothing else may
// touch the table — a `.limit(1).single()` anywhere else silently reads
// whichever tenant Postgres returns first.

export type { BusinessSettings } from '@/lib/types/database'

/** This tenant's business/payment settings, or null when never filled in. */
export async function getBusinessSettings(
  organizationId: string
): Promise<BusinessSettings | null> {
  const { data } = await supabaseAdmin
    .from('business_settings')
    .select('*')
    .eq('organization_id', organizationId)
    .maybeSingle()
  return (data as BusinessSettings | null) ?? null
}

/** Create or update this tenant's row. The tenant is the caller's, resolved
 *  server-side — `organization_id` (and the retired `id`) are stripped from the
 *  patch so a request body can never redirect the write at another tenant (I-6). */
export async function upsertBusinessSettings(
  organizationId: string,
  patch: Record<string, unknown>
) {
  const safe: Record<string, unknown> = { ...patch }
  delete safe.id
  delete safe.organization_id
  return supabaseAdmin
    .from('business_settings')
    .upsert(
      { ...safe, organization_id: organizationId, updated_at: new Date().toISOString() },
      { onConflict: 'organization_id' }
    )
    .select()
    .single()
}

/** Stamp the admin presence heartbeat for one tenant. Admins have no `clients`
 *  row, so their last-seen lives here. Best-effort: presence is a nicety. */
export async function touchAdminLastSeen(organizationId: string): Promise<void> {
  await supabaseAdmin
    .from('business_settings')
    .update({ admin_last_seen_at: new Date().toISOString() })
    .eq('organization_id', organizationId)
}
