import { can } from '@/lib/capabilities.server'
import { portalClientId } from '@/lib/team'
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
  // Resolved, not derived: `can()` subtracts DENIALS, which the deleted
  // clientCan() could not see.
  //
  // AND IT IS NO LONGER SKIPPED. This read `if (access && !(await can(…)))` —
  // so a session with NO active client_members row bypassed the guard entirely
  // and reached the page. It saw nothing (portalClientId returns the NO_CLIENT
  // sentinel, which matches no rows), so nothing leaked; but "we never asked"
  // is not the same as "we asked and the answer was no", and only one of those
  // is a guard.
  //
  // `can()` already answers false for that session — resolveCaps returns
  // `side: null` with an empty cap set when no active roster row exists on
  // either side — so the precondition was doing nothing except suppressing the
  // right answer. Two live identities are affected and both are documented
  // orphans that already resolve to nothing: the MD-4 external collaborator
  // (roster-less by design) and the `.con` typo'd address in HANDOFF §8.3
  // item 19. They now land on /dashboard, which carries no capability gate, so
  // there is no redirect loop.
  if (!(await can(user, 'portal.team'))) redirect('/dashboard')

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
