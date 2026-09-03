import { requireOrgFeature } from '@/lib/studio/guard'
import { createClient } from '@/lib/supabase/server'
import { userOrgId } from '@/lib/auth/role'
import { rosterName } from '@/lib/team'
import { redirect } from 'next/navigation'
import CrewChatHub from '@/components/studio/CrewChatHub'

// Crew · Chat — Batch 23 (S3-d §8 step 8). The org's internal messaging:
// General, channels, groups, broadcasts and DMs over the membership model.
// This explicit page supersedes the [space]/[feature] coming-soon card.
export default async function CrewChatPage() {
  await requireOrgFeature('crew', 'chat')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return (
    <CrewChatHub
      orgId={userOrgId(user)}
      adminName={(await rosterName(user)) ?? 'Studio'}
    />
  )
}
