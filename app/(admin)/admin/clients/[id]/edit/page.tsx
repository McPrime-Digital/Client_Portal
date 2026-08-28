import { isAdmin, userOrgId } from '@/lib/auth/role'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { redirect, notFound } from 'next/navigation'
import EditClientForm from '@/components/admin/EditClientForm'

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) redirect('/login')

  // Org predicate on a URL-uuid fetch (I-6/I-9): this reads through the
  // service role, so nothing 0021 built applies — unscoped, a typed URL
  // rendered another tenant's record. A foreign uuid 404s like any miss.
  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('id, name, email, company, phone, notes')
    .eq('id', id)
    .eq('organization_id', userOrgId(user))
    .maybeSingle()

  if (!client) notFound()

  return <EditClientForm client={client} />
}
