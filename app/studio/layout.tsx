import { redirect } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { isAdmin, userOrgId } from '@/lib/auth/role'
import { orgAccessOf } from '@/lib/team'
import StudioSidebar from '@/components/studio/StudioSidebar'
import StudioTopbar from '@/components/studio/StudioTopbar'
import SessionDock from '@/components/studio/SessionDock'
import PrimeOSDock from '@/components/studio/PrimeOSDock'
import PresencePulse from '@/components/shared/PresencePulse'
import { GOOGLE_FONTS_HREF } from '@/lib/studio/fonts'
import { tenantBrand } from '@/lib/tenantBrand'
import { planAllows } from '@/lib/billing/plans'
import { PRODUCT_NAME, PRODUCT_TAGLINE } from '@/lib/product'
import type { Metadata } from 'next'

// Genreline's internal/studio shell — team-only (admins). The external client
// portal stays at /dashboard; this is the 3-space (Crew/Client/Workspace) home.
//
// The studio is where the product speaks as itself (S0-B §3): Genreline in the
// chrome, the studio's own name and logo as tenant context beside it.
export const metadata: Metadata = {
  title: `${PRODUCT_NAME} — ${PRODUCT_TAGLINE}`,
}
export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()

  if (!user) redirect('/login')
  if (!isAdmin(user)) redirect('/dashboard')

  // THIS WAS CROSS-TENANT. The previous shape was
  // `.from('organizations').select('name').limit(1).single()` — no predicate at
  // all, so it returned whichever organization Postgres handed back first and
  // rendered that name in this admin's chrome. Three orgs exist today, so the
  // studio header could already show another studio's name. It is the exact
  // failure lib/businessSettings.ts warns about in prose ("a .limit(1).single()
  // anywhere else silently reads whichever tenant Postgres returns first") —
  // T-3, found while renaming the comment above it.
  const userName =
    (user.user_metadata?.name as string | undefined) ?? user.email?.split('@')[0] ?? 'Owner'

  // First login of an invited crew member — flip their membership to active
  // BEFORE resolving the role, or their permissions would read as a stranger's.
  await supabaseAdmin
    .from('organization_members')
    .update({ status: 'active', accepted_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('status', 'invited')

  // Brand, hold-status and roles are independent of each other (only the flip
  // above must precede them) — one parallel batch instead of three round
  // trips in sequence. This runs on every studio request, so it's the
  // difference the navigation timer feels.
  const [brand, { data: crewRow }, orgAccess] = await Promise.all([
    tenantBrand(userOrgId(user)),
    // A paused crew member sees a hold screen — nothing else in the studio.
    supabaseAdmin
      .from('organization_members')
      .select('status')
      .eq('user_id', user.id)
      .maybeSingle(),
    orgAccessOf(user),
  ])
  const orgName = brand.name
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
    <div className="app-canvas flex h-screen gap-2 overflow-hidden p-2 sm:gap-3 sm:p-3">
      {/* admin presence heartbeat — without it clients get false "away" alerts.
          orgId scopes the presence room to this tenant (C-3). */}
      <PresencePulse role="admin" userId={user.id} clientId={null} orgId={userOrgId(user)} />
      {/* editor font library (Script Design font picker) */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href={GOOGLE_FONTS_HREF} />
      <StudioSidebar
        userName={userName}
        orgName={orgName}
        orgRoles={[...roles]}
        orgExtra={orgAccess.extraCaps}
        roleLabel={roleLabel}
        // Plan-gated rail entries (CRM · Pipeline, Lead-Gen) — resolved from the
        // org's plan, never from an org id (lib/billing/plans.ts). The server
        // gate in lib/studio/guard.ts enforces the same answer for typed URLs.
        houseTools={planAllows(brand.plan, 'internal.pipeline')}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-hidden sm:gap-3">
        <StudioTopbar />
        {/* Every page renders into this squircle panel; the panel clips, the
            inner main scrolls, so the rounded corners survive scrolling. */}
        <div className="main-panel squircle-xl min-h-0 flex-1 overflow-hidden">
          <main className="h-full overflow-y-auto p-4 sm:p-6 lg:p-8 scrollbar-thin">{children}</main>
        </div>
      </div>
      {/* Persistent page-in-view session — survives navigation across the studio. */}
      <SessionDock />
      {/* App-wide PrimeOS assistant — sticky across navigation until the user closes it. */}
      <PrimeOSDock />
    </div>
  )
}
