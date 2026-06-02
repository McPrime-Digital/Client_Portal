import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import NewInvoiceForm from
  '@/components/admin/NewInvoiceForm'

export default async function NewInvoicePage() {
  const supabase = await createClient()

  const { data: { user } } =
    await supabase.auth.getUser()
  if (!user || user.user_metadata?.role !== 'admin') {
    redirect('/login')
  }

  // Service role (admin-gated above) — the clients/projects tables are not
  // readable by the admin under RLS, so the RLS-scoped client returns nothing
  // and the dropdowns come up empty. Every other admin page reads this way.
  const { data: clients } = await supabaseAdmin
    .from('clients')
    .select('id, name, company')
    .order('name')

  const { data: projects } = await supabaseAdmin
    .from('projects')
    .select('id, title, client_id')
    .not('status', 'eq', 'Completed')
    .order('title')

  return (
    <NewInvoiceForm
      clients={clients ?? []}
      projects={projects ?? []}
    />
  )
}
