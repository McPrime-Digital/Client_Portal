import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
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
    .eq('user_id', user.id)
    .single()

  if (!client) redirect('/dashboard')

  // Fetch invoices using supabaseAdmin to bypass RLS
  const { data: invoices } = await supabaseAdmin
    .from('invoices')
    .select(`
      *,
      projects(id, title, type)
    `)
    .eq('client_id', client.id)
    .order('created_at', { ascending: false })

  // Global payment details (admin-only table; read via service role and
  // passed down — clients never query it directly).
  const { data: paymentSettings } = await supabaseAdmin
    .from('business_settings')
    .select('*')
    .eq('id', 'singleton')
    .single()

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
