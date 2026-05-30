import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import NewProjectForm from
  '@/components/admin/NewProjectForm'

export default async function NewProjectPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.user_metadata?.role !== 'admin') {
    redirect('/login')
  }

  // Use admin client to fetch clients (bypasses RLS)
  const { data: clients } = await supabaseAdmin
    .from('clients')
    .select('id, name, company, email')
    .order('name')

  return <NewProjectForm clients={clients ?? []} />
}
