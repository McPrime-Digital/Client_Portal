import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import InvoicesClient from '@/components/portal/InvoicesClient'

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

  return (
    <InvoicesClient
      invoices={invoices ?? []}
      clientName={client.name}
    />
  )
}
