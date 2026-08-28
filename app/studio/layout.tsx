import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isAdmin, userOrgId } from '@/lib/auth/role'
import { orgAccessOf } from '@/lib/team'
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

  // A paused crew member sees a hold screen — nothing else in the studio.
  const { data: crewRow } = await supabaseAdmin
    .from('organization_members')
    .select('status')
    .eq('user_id', user.id)
    .maybeSingle()
  if (crewRow && crewRow.status === 'paused') {
    return (
      <div className="flex h-screen items-center justify-center bg-background px-6">
        <div className="max-w-sm rounded-2xl border border-border bg-card p-8 text-center">
          <p className="font-display text-lg font-semibold text-foreground">Access on hold</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Your studio access has been paused by an owner. You&apos;ll be able to sign back in once it&apos;s reinstated.
          </p>
        </div>
      </div>
    )
  }

  const orgAccess = await orgAccessOf(user)

  // NO ROSTER ROW, NO STUDIO. This used to read
  // `orgAccess.roles.length ? orgAccess.roles : ['member']` — the same fallback
  // orgRolesOf() carried, re-invented here, so a crew claim with no active row
  // still rendered a member's studio. Someone in that state is not a member of
  // anything; say so rather than showing them an empty shell they cannot
  // explain. A provisioned tenant owner never sees this (their roster row is
  // written before their claim — scripts/provision-tenant.ts).
  const roles = orgAccess.roles
  if (roles.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center bg-background px-6">
        <div className="max-w-sm rounded-2xl border border-border bg-card p-8 text-center">
          <p className="font-display text-lg font-semibold text-foreground">No studio access</p>
          <p className="mt-2 text-sm text-muted-foreground">
            This account isn&apos;t on a crew roster. Ask an owner or admin to add you to the team.
          </p>
        </div>
      </div>
    )
  }
  const roleLabel = orgAccess.title ?? roles[0][0].toUpperCase() + roles[0].slice(1)

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* admin presence heartbeat — without it clients get false "away" alerts.
          orgId scopes the presence room to this tenant (C-3). */}
      <PresencePulse role="admin" userId={user.id} clientId={null} orgId={userOrgId(user)} />
      {/* editor font library (Script Design font picker) */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href={GOOGLE_FONTS_HREF} />
      <StudioSidebar userName={userName} orgName={orgName} orgRoles={[...roles]} orgExtra={orgAccess.extraCaps} roleLabel={roleLabel} />
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
