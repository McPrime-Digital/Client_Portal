import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isAdmin } from '@/lib/auth/role'
import { orgRoleOf } from '@/lib/team'
import StudioSidebar from '@/components/studio/StudioSidebar'
import StudioTopbar from '@/components/studio/StudioTopbar'
import SessionDock from '@/components/studio/SessionDock'
import PrimeOSDock from '@/components/studio/PrimeOSDock'
import PresencePulse from '@/components/shared/PresencePulse'
import { GOOGLE_FONTS_HREF } from '@/lib/studio/fonts'

// Throughline internal/studio shell — team-only (admins). The external client
// portal stays at /dashboard; this is the 3-space (Crew/Client/Workspace) home.
export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')
  if (!isAdmin(user)) redirect('/dashboard')

  let orgName = 'McPrime'
  try {
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('name')
      .limit(1)
      .single()
    if (org?.name) orgName = org.name
  } catch {
    // organizations table may not exist in every environment — best-effort.
  }

  const userName =
    (user.user_metadata?.name as string | undefined) ?? user.email?.split('@')[0] ?? 'Owner'

  // First login of an invited crew member — flip their membership to active
  // BEFORE resolving the role, or their permissions would read as a stranger's.
  await supabaseAdmin
    .from('organization_members')
    .update({ status: 'active', accepted_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('status', 'invited')

  const orgRole = (await orgRoleOf(user)) ?? 'member'

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* admin presence heartbeat — without it clients get false "away" alerts */}
      <PresencePulse role="admin" userId={user.id} clientId={null} />
      {/* editor font library (Script Design font picker) */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href={GOOGLE_FONTS_HREF} />
      <StudioSidebar userName={userName} orgName={orgName} orgRole={orgRole} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <StudioTopbar />
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">{children}</main>
      </div>
      {/* Persistent page-in-view session — survives navigation across the studio. */}
      <SessionDock />
      {/* App-wide PrimeOS assistant — sticky across navigation until the user closes it. */}
      <PrimeOSDock />
    </div>
  )
}
