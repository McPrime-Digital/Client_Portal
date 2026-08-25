import { clientMembershipOf } from '@/lib/team'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import PresencePulse from '@/components/shared/PresencePulse'

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  // 1. Get current session
  const { data: { session }, error: sessionError } = await supabase.auth.getSession()

  // 2. Redirect to login if unauthenticated
  if (sessionError || !session?.user) {
    redirect('/login')
  }

  // First login of an invited teammate — flip their membership to active
  // BEFORE resolving it, so their very first page load carries their role.
  await supabaseAdmin
    .from('client_members')
    .update({ status: 'active', accepted_at: new Date().toISOString() })
    .eq('user_id', session.user.id)
    .eq('status', 'invited')

  // 3. Resolve membership ONCE: who they are, which company, which role.
  const membership = await clientMembershipOf(session.user)

  // A paused member (either side of the house) sees a hold screen, nothing else.
  if (!membership) {
    const [{ data: heldClient }, { data: heldCrew }] = await Promise.all([
      supabaseAdmin.from('client_members').select('id').eq('user_id', session.user.id).eq('status', 'paused').maybeSingle(),
      supabaseAdmin.from('organization_members').select('id').eq('user_id', session.user.id).eq('status', 'paused').maybeSingle(),
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
    name: session?.user?.user_metadata?.full_name || session?.user?.email?.split('@')[0] || 'User',
    company: null,
    avatar_url: null,
  }

  const activeClient = clientData || fallbackClient

  // The signed-in person's OWN identity — never the company owner's.
  const memberRole = membership?.role ?? 'viewer'
  const memberName = membership?.name ?? fallbackClient.name
  const memberExtra = membership?.extraCaps ?? []
  const memberTitle = membership?.title ?? null

  // The studio/agency serving this client — shown in the sidebar co-brand.
  let orgName = 'McPrime Digital'
  try {
    const { data: biz } = await supabaseAdmin
      .from('business_settings')
      .select('business_name')
      .limit(1)
      .single()
    if (biz?.business_name) orgName = biz.business_name
  } catch {
    // best-effort
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <PresencePulse
        role="client"
        userId={session.user.id}
        clientId={(activeClient as any).id ?? null}
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
