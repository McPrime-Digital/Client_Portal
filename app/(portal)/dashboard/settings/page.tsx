import { can } from '@/lib/capabilities.server'
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
  // Resolved, not derived (Batch 26 item 8): `can()` subtracts DENIALS, which
  // clientCan() could not see. The `access &&` precondition is deliberately
  // unchanged — a session with no client_members row skips this guard today,
  // which is a separate pre-existing hole reported in HANDOFF, not one this
  // item closes by side effect.
  if (membership && !(await can(user, 'portal.team'))) redirect('/dashboard')

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
