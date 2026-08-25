import 'server-only'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { orgAccessOf, type OrgAccess } from '@/lib/team'
import { orgFeatureAllowed } from '@/lib/permissions'

/** Server gate for a studio feature route: the nav hides what a crew member's
 *  roles + grants don't cover, and this makes typing the URL useless too. */
export async function requireOrgFeature(spaceId: string, slug: string): Promise<OrgAccess> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const access = await orgAccessOf(user)
  const roles = access.roles.length ? access.roles : (['member'] as const)
  if (!orgFeatureAllowed([...roles], spaceId, slug, access.extraCaps)) redirect('/studio')
  return access
}
