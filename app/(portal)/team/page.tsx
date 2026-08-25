import { clientCan } from '@/lib/permissions'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { clientMembershipOf } from '@/lib/team'
import ClientTeamManager from '@/components/portal/ClientTeamManager'

// The client company's team — the account owner's surface alone (roster,
// invites, roles, holds). Teammates neither see nor reach it.
export default async function ClientTeamPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const membership = await clientMembershipOf(user)
  if (!membership || !clientCan(membership.role, 'manage_team', membership.extraCaps)) redirect('/dashboard')

  return <ClientTeamManager />
}
