import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import ClientInvoices from
  '@/components/portal/ClientInvoices'

export default async function ClientInvoicesPage() {
  const supabase = await createClient()

  const { data: { user } } =
    await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Service role + explicit client-ownership scoping (matches the canonical
  // /invoices page) — RLS doesn't grant a broad read on invoices, so the
  // RLS-scoped client returns nothing.
  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!client) redirect('/login')

  // Mark overdue on client view too
  await supabaseAdmin.rpc('mark_overdue_invoices')

  const { data: invoices } = await supabaseAdmin
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
