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
  if (!user || user.user_metadata?.role !== 'admin') redirect('/login')

  const [{ data: project }, { data: clients }] = await Promise.all([
    supabaseAdmin
      .from('projects')
      .select('id, title, status, due_date, kickoff_date, brief, client_id')
      .eq('id', id)
      .single(),
    supabaseAdmin
      .from('clients')
      .select('id, name, company')
      .order('name'),
  ])

  if (!project) notFound()

  return <EditProjectForm project={project} clients={clients ?? []} />
}
