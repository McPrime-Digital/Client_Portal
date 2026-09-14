import 'server-only'

import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { orgFeatureAllowed } from '@/lib/permissions'
import { resolveCaps, type ResolvedCaps } from '@/lib/capabilities.server'
import { getSpace } from '@/lib/studio/spaces'
import { tenantBrand } from '@/lib/tenantBrand'
import { planAllows } from '@/lib/billing/plans'
import { userOrgId } from '@/lib/auth/role'

/** Server gate for a studio feature route: the nav hides what a crew member's
 *  capabilities don't cover, and this makes typing the URL useless too.
 *
 *  IT ASKS THE RESOLVER NOW (Batch 26 item 8). It used to call
 *  `orgFeatureAllowed(access.roles, …, access.extraCaps)` against `orgAccessOf`,
 *  which read `organization_members` and nothing else — so a DENIAL was
 *  invisible to it. `extra_caps` is a projection of the GRANT rows only
 *  (lib/grants.ts:149-153), which is why passing it was not enough: a denial is
 *  not an absence, and there was nothing here that could subtract one.
 *
 *  `resolveCaps()` reads the roster row, the extras AND the live grant rows, and
 *  subtracts the denials last (S-R R-3). It runs on the USER client against the
 *  ungated self-read policies, and it is memoised per request — so on a studio
 *  page where the layout has already resolved, this costs nothing.
 *
 *  NO ROSTER ROW MEANS NO FEATURE, unchanged in substance: `resolveCaps` returns
 *  `side: null` for a claim-holder with no active row, and an empty cap set fails
 *  every mapped feature. The explicit check stays because it redirects for a
 *  DIFFERENT reason — not "you may not see this feature" but "you are not a
 *  member of anything" — and S-R §7's eviction rule is about landing people
 *  somewhere they hold, not about being terse.
 *
 *  Where it sends them: `/studio`, which redirects to `/studio/crew`, whose
 *  space landing carries no capability gate at all. So the fallback always
 *  renders and there is no redirect loop — checked, not assumed. */
export async function requireOrgFeature(spaceId: string, slug: string): Promise<ResolvedCaps> {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const resolved = await resolveCaps(user)
  if (resolved.side !== 'crew') redirect('/studio')
  if (!orgFeatureAllowed(resolved.caps, spaceId, slug)) redirect('/studio')

  // Plan entitlement on top of capability: a feature carrying a `planFeature`
  // exists only for orgs whose plan grants it. NOTHING carries one today —
  // `internal.pipeline` went with CRM · Pipeline and Lead-Gen on 2026-09-14 —
  // and this stays because it is the gate that must already be correct the day
  // something does. The exemption is the plan, never the org id
  // (lib/billing/plans.ts) — and tenantBrand() is request-memoized, so this
  // costs nothing when the layout already resolved the brand.
  //
  // S-R §5 steps 1-2, and they stay OUTSIDE the resolver deliberately: plan and
  // archetype are entitlement, not capability, and a plan that does not carry a
  // feature is not a permission anyone can be granted.
  const feature = getSpace(spaceId)?.features.find((f) => f.slug === slug)
  if (feature?.planFeature) {
    const { plan } = await tenantBrand(userOrgId(user))
    if (!planAllows(plan, feature.planFeature)) redirect('/studio')
  }
  return resolved
}
