import { clientCan } from '@/lib/permissions'
import { portalClientId, portalAccess } from '@/lib/team'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getBusinessSettings } from '@/lib/businessSettings'
import { redirect } from 'next/navigation'
import InvoicesClient from '@/components/portal/InvoicesClient'
import RealtimeRefresh from '@/components/shared/RealtimeRefresh'

export default async function InvoicesPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch client record using supabaseAdmin to bypass RLS
  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('*')
    .eq('id', await portalClientId(user))
    .single()

  if (!client) redirect('/dashboard')

  // Invoices are for owners and approvers only.
  const access = await portalAccess(user)
  if (access && !clientCan(access.role, 'invoices', access.extraCaps)) redirect('/dashboard')

  // Fetch invoices using supabaseAdmin to bypass RLS.
  // Drafts are excluded at the QUERY, not just in the render: a draft is an
  // invoice the studio has prepared but not issued, and selecting it here
  // serialized its amount, title, line items and notes into the client's page
  // payload. InvoicesClient buckets only unpaid/overdue/paid/partial so it was
  // never displayed — but it was counted in the "N invoices total" header and
  // present in the HTML. Matches dashboard/invoices/page.tsx:41.
  const { data: invoices } = await supabaseAdmin
    .from('invoices')
    .select(`
      *,
      projects(id, title, type)
    `)
    .eq('client_id', client.id)
    .neq('status', 'draft')
    .order('created_at', { ascending: false })

  // Payment details of the STUDIO that owns this client company — not a global
  // row (T-3). Admin-only table; read via service role and passed down, since
  // clients never query it directly.
  const paymentSettings = await getBusinessSettings(client.organization_id)

  return (
    <>
      <RealtimeRefresh tables={['invoices', 'files']} />
      <InvoicesClient
        invoices={invoices ?? []}
        clientName={client.name}
        clientId={client.id}
        paymentSettings={paymentSettings ?? null}
      />
    </>
  )
}
