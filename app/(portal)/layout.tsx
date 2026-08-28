import { clientMembershipOf } from '@/lib/team'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getBusinessSettings } from '@/lib/businessSettings'
import { DEFAULT_ORG_ID } from '@/lib/auth/role'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import PresencePulse from '@/components/shared/PresencePulse'

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  // 1. Establish the session — getUser(), never getSession() (S2 §2).
  // getSession() decodes the cookie locally and hands back whatever it says;
  // it does not ask the auth server whether that token is still good. This is
  // the gate for the whole client portal, so it revalidates.
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  // 2. Redirect to login if unauthenticated
  if (authError || !user) {
    redirect('/login')
  }

  // First login of an invited teammate — flip their membership to active
  // BEFORE resolving it, so their very first page load carries their role.
  await supabaseAdmin
    .from('client_members')
    .update({ status: 'active', accepted_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('status', 'invited')

  // 3. Resolve membership ONCE: who they are, which company, which role.
  const membership = await clientMembershipOf(user)

  // A paused member (either side of the house) sees a hold screen, nothing else.
  if (!membership) {
    const [{ data: heldClient }, { data: heldCrew }] = await Promise.all([
      supabaseAdmin.from('client_members').select('id').eq('user_id', user.id).eq('status', 'paused').maybeSingle(),
      supabaseAdmin.from('organization_members').select('id').eq('user_id', user.id).eq('status', 'paused').maybeSingle(),
    ])
    if (heldClient || heldCrew) {
      return (
        <div className="flex h-screen items-center justify-center bg-background px-6">
          <div className="max-w-sm rounded-2xl border border-border bg-card p-8 text-center">
            <p className="font-display text-lg font-semibold text-foreground">Access on hold</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Your access has been paused by the account owner. You&apos;ll be able to sign back in once it&apos;s reinstated.
            </p>
          </div>
        </div>
      )
    }
  }

  const { data: clientData, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('*')
    .eq('id', membership?.clientId ?? '00000000-0000-0000-0000-000000000000')
    .single()

  if (clientError && clientError.code !== 'PGRST116') {
    // If it's a real error (not just "row not found"), we log it
    console.error('Error fetching client data:', clientError.message)
  }

  // Enforce self-serve onboarding for brand-new clients — the PRIMARY login
  // only. An invited teammate must never walk the company's onboarding (they
  // would overwrite the company profile as themselves).
  if (
    clientData &&
    membership?.role === 'owner' &&
    !(clientData as any).onboarding_completed_at &&
    !(clientData as any).onboarded_at
  ) {
    redirect('/onboarding')
  }

  // Note: if clientData is null, it might be an admin testing the portal 
  // or a newly created user that doesn't have a clients record yet.
  const fallbackClient = {
    name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
    company: null,
    avatar_url: null,
  }

  const activeClient = clientData || fallbackClient

  // The signed-in person's OWN identity — never the company owner's.
  const memberRole = membership?.role ?? 'viewer'
  const memberName = membership?.name ?? fallbackClient.name
  const memberExtra = membership?.extraCaps ?? []
  const memberTitle = membership?.title ?? null

  // The tenant this portal session belongs to. Read from the client company's
  // row rather than the user's claim: the company is the authority on which
  // studio it belongs to. Used for the business-settings lookup (T-3) and to
  // scope the presence room (C-3).
  const orgId =
    (clientData as { organization_id?: string } | null)?.organization_id ?? DEFAULT_ORG_ID

  // The studio/agency serving this client — shown in the sidebar co-brand.
  // Scoped to the org that owns this client company (T-3), not a global row.
  let orgName = 'McPrime Digital'
  try {
    const biz = await getBusinessSettings(orgId)
    if (biz?.business_name) orgName = biz.business_name
  } catch {
    // best-effort
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <PresencePulse
        role="client"
        userId={user.id}
        clientId={(activeClient as any).id ?? null}
        orgId={orgId}
      />
      <Sidebar
        clientName={activeClient.name}
        clientCompany={(activeClient as any).company ?? null}
        clientId={(activeClient as any).id}
        clientAvatar={(activeClient as any).avatar_url ?? null}
        orgName={orgName}
        memberRole={memberRole}
        memberExtra={memberExtra}
      />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Topbar clientName={memberName} clientId={(activeClient as any).id} memberRole={memberRole} roleTitle={memberTitle} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  )
}
