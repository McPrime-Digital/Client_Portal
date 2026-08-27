import { isAdmin, userOrgId } from '@/lib/auth/role'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import NewInvoiceForm from
  '@/components/admin/NewInvoiceForm'

export default async function NewInvoicePage() {
  const supabase = await createClient()

  const { data: { user } } =
    await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    redirect('/login')
  }

  // Service role (admin-gated above) — the clients/projects tables are not
  // readable by the admin under RLS, so the RLS-scoped client returns nothing
  // and the dropdowns come up empty. Every other admin page reads this way.
  // Tenant scope, resolved once from the verified session (never a param).
  // These feed the invoice form's dropdowns — unscoped, an admin could raise
  // an invoice against another tenant's client company.
  const orgId = userOrgId(user)

  const { data: clients } = await supabaseAdmin
    .from('clients')
    .select('id, name, company')
    .eq('organization_id', orgId)
    .order('name')

  const { data: projects } = await supabaseAdmin
    .from('projects')
    .select('id, title, client_id')
    .eq('organization_id', orgId)
    .not('status', 'eq', 'Completed')
    .order('title')

  return (
    <NewInvoiceForm
      clients={clients ?? []}
      projects={projects ?? []}
    />
  )
}
