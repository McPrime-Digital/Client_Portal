import { clientCan } from '@/lib/permissions'
import { tenantBrand } from '@/lib/tenantBrand'
import { portalClientId, portalAccess } from '@/lib/team'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { clientUnread } from '@/lib/messageRead'
import { redirect } from 'next/navigation'
import MessagesHub from '@/components/portal/MessagesHub'

export default async function MessagesPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Service role + explicit ownership scoping — no RLS dependency.
  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('*')
    .eq('id', await portalClientId(user))
    .single()

  if (!client) redirect('/dashboard')

  // Member scoping — project allowlist + message-history cutoff.
  const access = await portalAccess(user)

  // The remaining reads are independent — parallel, not serial (nav speed).
  const [brand, { data: projects }, unread] = await Promise.all([
    tenantBrand(client.organization_id),
    supabaseAdmin
      .from('projects')
      .select('id, title, status')
      .eq('client_id', client.id)
      .order('created_at', { ascending: false }),
    clientUnread(supabaseAdmin, {
      userId: user.id,
      clientId: client.id,
      historyFrom: access?.historyFrom ?? null,
      visibleProjectIds: access?.projectIds ?? null,
    }),
  ])

  const visibleProjects = (projects ?? []).filter(
    (p) => !access?.projectIds || access.projectIds.includes(p.id)
  )

  return (
    <MessagesHub
      clientId={client.id}
      clientName={access?.name ?? client.name}
      studioName={brand.name}
      studioLogoUrl={brand.logoUrl ?? null}
      roomId={unread.roomId}
      orgId={client.organization_id}
      projects={visibleProjects}
      unread={{ general: unread.general, byProject: unread.byProject }}
      canSend={clientCan(access?.role ?? 'owner', 'message', access?.extraCaps)}
      /* Only a company OWNER opens a direct line to the studio (the owner's
         rule, 2026-09-03). Everyone else participates in the DMs and groups
         they are seated in; nobody in the portal creates a group — those come
         from the studio side. */
      canStartDm={(access?.role ?? '') === 'owner'}
    />
  )
}
