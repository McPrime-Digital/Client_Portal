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
  if (!user || user.user_metadata?.role !== 'admin') redirect('/login')

  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('id, name, email, company, phone, notes')
    .eq('id', id)
    .single()

  if (!client) notFound()

  return <EditClientForm client={client} />
}
