import { createClient } from '@/lib/supabase/server'
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

  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, company')
    .order('name')

  const { data: projects } = await supabase
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
