import { isAdmin, userOrgId } from '@/lib/auth/role'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import NewProjectForm from
  '@/components/admin/NewProjectForm'

export default async function NewProjectPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    redirect('/login')
  }

  // Use admin client to fetch clients (bypasses RLS), scoped to the caller's
  // tenant — resolved once from the verified session, never a param.
  const { data: clients } = await supabaseAdmin
    .from('clients')
    .select('id, name, company, email')
    .eq('organization_id', userOrgId(user))
    .order('name')

  return <NewProjectForm clients={clients ?? []} />
}
