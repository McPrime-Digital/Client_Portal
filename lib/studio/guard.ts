import 'server-only'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { orgAccessOf, type OrgAccess } from '@/lib/team'
import { orgFeatureAllowed } from '@/lib/permissions'

/** Server gate for a studio feature route: the nav hides what a crew member's
 *  roles + grants don't cover, and this makes typing the URL useless too.
 *
 *  NO ROLES MEANS NO FEATURE. This used to read
 *  `access.roles.length ? access.roles : ['member']`, re-inventing the roster
 *  fallback locally — so removing it from `orgRolesOf` alone would have closed
 *  nothing here. A claim-holder with no active roster row now fails every
 *  feature gate rather than passing the member-level ones. */
export async function requireOrgFeature(spaceId: string, slug: string): Promise<OrgAccess> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const access = await orgAccessOf(user)
  if (access.roles.length === 0) redirect('/studio')
  if (!orgFeatureAllowed(access.roles, spaceId, slug, access.extraCaps)) redirect('/studio')
  return access
}
