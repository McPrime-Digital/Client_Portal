import { redirect } from 'next/navigation'
import { Palette } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { isAdmin, userOrgId } from '@/lib/auth/role'
import { requireOrgFeature } from '@/lib/studio/guard'
import { capGate } from '@/lib/capabilities.server'
import { tenantBrand } from '@/lib/tenantBrand'
import BrandKitEditor from '@/components/studio/BrandKitEditor'

/**
 * CLIENT · BRAND KIT — S0-B §2, the half that was missing.
 *
 * `tenantBrand()` has resolved the studio's NAME, LOGO and attribution flag
 * since Batch 9, and `organizations.branding` has existed since migration 0001
 * holding `{}` in every row with **zero readers and zero writers** — the same
 * dormant-engine shape `asset_provenance` had before 0064 and `calendar_entries`
 * had before 0074. This is its writer.
 *
 * It is in the CLIENT space and not in Settings on purpose: the thing being
 * configured is what the studio's CLIENTS see, not how the studio runs. Gated
 * on `client.manage` by `ORG_FEATURE_CAP`, written behind `org.settings.write`
 * — reading who your clients are and changing the face you present to them are
 * different decisions.
 */
export default async function BrandKitPage() {
  await requireOrgFeature('client', 'brand-kit')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) redirect('/login')

  const denied = await capGate(user, 'org.settings.write')
  if (denied) redirect('/studio')

  const brand = await tenantBrand(userOrgId(user))

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="flex items-center gap-3 font-display text-2xl font-semibold text-foreground">
          <Palette size={24} className="text-primary" />
          Brand Kit
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {brand.brand
            ? 'Your clients see your colours.'
            : 'Your clients currently see the default palette.'}
        </p>
      </div>

      <BrandKitEditor initial={brand.brand} studioName={brand.name} />
    </div>
  )
}
