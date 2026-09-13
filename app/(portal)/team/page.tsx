import { can } from '@/lib/capabilities.server'
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

  // Resolved, not derived (Batch 26 item 8) — a denial now withdraws this page.
  const membership = await clientMembershipOf(user)
  if (!membership || !(await can(user, 'portal.team'))) redirect('/dashboard')

  return <ClientTeamManager />
}
