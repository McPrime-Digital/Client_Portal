import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/admin'
import { getBusinessSettings } from '@/lib/businessSettings'
import { captureError } from '@/lib/errors'

// The studio's OWN identity, as its clients know it — never the product's
// (S0-B §2/§3). A client of a studio bought from that studio; they have no
// relationship with Genreline beyond the PI-4 attribution. So every
// client-facing surface asks this module who it belongs to, and the answer
// comes out of the database.
//
// IT IS TWO TABLES, not one, and that is why this module exists rather than a
// `business_settings.business_name` read at each call site. `business_settings`
// became per-tenant in 0018 and carries the trading name; the LOGO has never
// lived there — `organizations.logo_url` is the only column that holds it
// (0001:21). "The data already exists" (S0-B §3) is true, and it is split.
//
// Precedence: business_settings.business_name → organizations.name → neutral.
// The trading name wins because it is what the studio puts on its invoices;
// organizations.name is the account name and is `not null`, so a tenant that
// exists always has *something* real to show.

/**
 * Shown when the tenant genuinely cannot be resolved — a client company with no
 * readable organization row, or a surface reached before the company exists.
 * Not a fallback tenant name: naming any studio there would be the P-1 defect
 * with a different string in it. Copy that reads badly with this stand-in
 * should drop the name from the sentence instead.
 */
export const NEUTRAL_TENANT_NAME = 'your studio'

export type TenantBrand = {
  /** The studio's name as its clients know it. */
  name: string
  /** The studio's logo, or null — surfaces fall back to its initial. */
  logoUrl: string | null
  /** False when `name` is {@link NEUTRAL_TENANT_NAME} rather than a real one. */
  resolved: boolean
}

const NEUTRAL: TenantBrand = {
  name: NEUTRAL_TENANT_NAME,
  logoUrl: null,
  resolved: false,
}

/** Name and logo of one tenant. Never throws — branding must not take a page down. */
export async function tenantBrand(
  organizationId: string | null | undefined
): Promise<TenantBrand> {
  if (!organizationId) return NEUTRAL
  try {
    const [settings, orgRes] = await Promise.all([
      getBusinessSettings(organizationId),
      supabaseAdmin
        .from('organizations')
        .select('name, logo_url')
        .eq('id', organizationId)
        .maybeSingle(),
    ])

    if (orgRes.error) {
      // Reaches a sink rather than vanishing (I-10). The page still renders —
      // a studio whose name failed to load should not be a blank portal.
      captureError(orgRes.error, {
        where: 'tenantBrand',
        organizationId,
      })
    }

    const org = orgRes.data as { name?: string | null; logo_url?: string | null } | null
    const name =
      settings?.business_name?.trim() || org?.name?.trim() || NEUTRAL_TENANT_NAME

    return {
      name,
      logoUrl: org?.logo_url?.trim() || null,
      resolved: name !== NEUTRAL_TENANT_NAME,
    }
  } catch (e) {
    captureError(e, { where: 'tenantBrand', organizationId })
    return NEUTRAL
  }
}

/**
 * The studio that owns a client company. Resolved from the company row, not
 * from the caller's JWT claim, for the reason `app/(portal)/layout.tsx` gives:
 * the company is the authority on which studio it belongs to, and a user whose
 * claim is missing would silently resolve to no tenant at all rather than
 * erroring — the empty-result failure AD-001 exists to prevent.
 */
export async function tenantBrandForClient(
  clientId: string | null | undefined
): Promise<TenantBrand> {
  if (!clientId) return NEUTRAL
  try {
    const { data, error } = await supabaseAdmin
      .from('clients')
      .select('organization_id')
      .eq('id', clientId)
      .maybeSingle()
    if (error) {
      captureError(error, { where: 'tenantBrandForClient', clientId })
      return NEUTRAL
    }
    return tenantBrand((data as { organization_id?: string } | null)?.organization_id)
  } catch (e) {
    captureError(e, { where: 'tenantBrandForClient', clientId })
    return NEUTRAL
  }
}
