import 'server-only'

import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { orgAccessOf, type OrgAccess } from '@/lib/team'
import { orgFeatureAllowed } from '@/lib/permissions'
import { getSpace } from '@/lib/studio/spaces'
import { tenantBrand } from '@/lib/tenantBrand'
import { planAllows } from '@/lib/billing/plans'
import { userOrgId } from '@/lib/auth/role'

/** Server gate for a studio feature route: the nav hides what a crew member's
 *  roles + grants don't cover, and this makes typing the URL useless too.
 *
 *  NO ROLES MEANS NO FEATURE. This used to read
 *  `access.roles.length ? access.roles : ['member']`, re-inventing the roster
 *  fallback locally — so removing it from `orgRolesOf` alone would have closed
 *  nothing here. A claim-holder with no active roster row now fails every
 *  feature gate rather than passing the member-level ones. */
export async function requireOrgFeature(spaceId: string, slug: string): Promise<OrgAccess> {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const access = await orgAccessOf(user)
  if (access.roles.length === 0) redirect('/studio')
  if (!orgFeatureAllowed(access.roles, spaceId, slug, access.extraCaps)) redirect('/studio')

  // Plan entitlement on top of role capability: a feature carrying a
  // `planFeature` exists only for orgs whose plan grants it (today: the house
  // org's internal.pipeline tools). The exemption is the plan, never the org id
  // (lib/billing/plans.ts) — and tenantBrand() is request-memoized, so this
  // costs nothing when the layout already resolved the brand.
  const feature = getSpace(spaceId)?.features.find((f) => f.slug === slug)
  if (feature?.planFeature) {
    const { plan } = await tenantBrand(userOrgId(user))
    if (!planAllows(plan, feature.planFeature)) redirect('/studio')
  }
  return access
}
