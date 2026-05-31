import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AdminInvoicesList from
  '@/components/admin/AdminInvoicesList'
import RealtimeRefresh from '@/components/shared/RealtimeRefresh'

export default async function AdminInvoicesPage() {
  const supabase = await createClient()

  const { data: { user } } =
    await supabase.auth.getUser()
  if (!user || user.user_metadata?.role !== 'admin') {
    redirect('/login')
  }

  // Mark any overdue invoices first
  await supabase.rpc('mark_overdue_invoices')

  const { data: invoices } = await supabase
    .from('invoices')
    .select(`
      *,
      clients(id, name, company),
      projects(id, title)
    `)
    .order('created_at', { ascending: false })

  // Revenue summary
  const paid = (invoices ?? [])
    .filter((i) => i.status === 'paid')
    .reduce((acc, i) => acc + Number(i.amount), 0)

  const outstanding = (invoices ?? [])
    .filter((i) =>
      ['unpaid', 'overdue'].includes(i.status)
    )
    .reduce((acc, i) => acc + Number(i.amount), 0)

  const overdue = (invoices ?? [])
    .filter((i) => i.status === 'overdue')
    .reduce((acc, i) => acc + Number(i.amount), 0)

  return (
    <>
      <RealtimeRefresh tables={['invoices']} pollMs={45000} />
      <AdminInvoicesList
        invoices={invoices ?? []}
        summary={{ paid, outstanding, overdue }}
      />
    </>
  )
}
