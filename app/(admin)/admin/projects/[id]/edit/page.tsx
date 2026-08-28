import { isAdmin, userOrgId } from '@/lib/auth/role'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { redirect, notFound } from 'next/navigation'
import EditProjectForm from '@/components/admin/EditProjectForm'

export default async function EditProjectPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) redirect('/login')

  // Org predicate on a URL-uuid fetch (I-6/I-9): service-role read, so 0021
  // does not apply — unscoped, a typed URL rendered another tenant's project,
  // and the reassignment dropdown listed EVERY tenant's client companies.
  const org = userOrgId(user)
  const [{ data: project }, { data: clients }] = await Promise.all([
    supabaseAdmin
      .from('projects')
      .select('id, title, status, due_date, kickoff_date, brief, client_id, image_url')
      .eq('id', id)
      .eq('organization_id', org)
      .maybeSingle(),
    supabaseAdmin
      .from('clients')
      .select('id, name, company')
      .eq('organization_id', org)
      .order('name'),
  ])

  if (!project) notFound()

  return <EditProjectForm project={project} clients={clients ?? []} />
}
