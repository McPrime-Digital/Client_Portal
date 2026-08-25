import { clientCan } from '@/lib/permissions'
import { portalClientId, clientMembershipOf } from '@/lib/team'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import ClientSettings from
  '@/components/portal/ClientSettings'

export default async function SettingsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Company & owner information is the account owner's alone.
  const membership = await clientMembershipOf(user)
  if (membership && !clientCan(membership.role, 'manage_team', membership.extraCaps)) redirect('/dashboard')

  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('*')
    .eq('id', await portalClientId(user))
    .single()

  return (
    <ClientSettings
      user={user}
      client={client}
    />
  )
}
