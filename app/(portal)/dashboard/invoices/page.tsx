import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ClientInvoices from
  '@/components/portal/ClientInvoices'

export default async function ClientInvoicesPage() {
  const supabase = await createClient()

  const { data: { user } } =
    await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!client) redirect('/login')

  // Mark overdue on client view too
  await supabase.rpc('mark_overdue_invoices')

  const { data: invoices } = await supabase
    .from('invoices')
    .select(`
      *,
      projects(id, title)
    `)
    .eq('client_id', client.id)
    .neq('status', 'draft')
    .order('created_at', { ascending: false })

  return <ClientInvoices invoices={invoices ?? []} />
}
