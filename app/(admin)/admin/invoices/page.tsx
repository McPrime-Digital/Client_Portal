import { isAdmin, userOrgId } from '@/lib/auth/role'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import AdminInvoicesList from
  '@/components/admin/AdminInvoicesList'
import RealtimeRefresh from '@/components/shared/RealtimeRefresh'

export default async function AdminInvoicesPage() {
  const supabase = await createClient()

  const { data: { user } } =
    await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    redirect('/login')
  }

  // Reads/writes go through the service role (admin-gated above): RLS does not
  // grant the admin a broad read on `invoices`, so the RLS-scoped client returns
  // an empty list — which is why the hub showed no invoices. All other admin
  // pages already read this way; this one was the lone holdout.
  const orgId = userOrgId(user)

  // Org-scoped overdue sweep. 0023 gave mark_overdue_invoices() the tenant
  // parameter (the 0000:337 zero-arg version swept every tenant; Batch 3A
  // inlined this update as a stopgap until the migration existed). One
  // definition of "overdue" again — the function's.
  await supabaseAdmin.rpc('mark_overdue_invoices', { p_org: orgId })

  const { data: invoices } = await supabaseAdmin
    .from('invoices')
    .select(`
      *,
      clients(id, name, company),
      projects(id, title)
    `)
    .eq('organization_id', orgId)
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
