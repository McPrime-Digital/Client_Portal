import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import AdminProjectsList from
  '@/components/admin/AdminProjectsList'
import { computeProjectProgress } from '@/lib/projectProgress'
import RealtimeRefresh from '@/components/shared/RealtimeRefresh'

export default async function AdminProjectsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.user_metadata?.role !== 'admin') {
    redirect('/login')
  }

  const { data: projects } = await supabaseAdmin
    .from('projects')
    .select(`
      *,
      clients(id, name, company),
      tasks(id, status),
      files(id),
      messages(id, sender_role, read_at),
      project_phases(progress)
    `)
    .order('updated_at', { ascending: false })

  // Sync the progress ring with the canonical phase-average.
  const projectsSynced = (projects ?? []).map((p: any) => ({
    ...p,
    progress: computeProjectProgress(p.project_phases, p.progress),
  }))

  return (
    <>
      <RealtimeRefresh tables={['projects', 'project_phases', 'tasks', 'messages', 'files']} pollMs={45000} />
      <AdminProjectsList projects={projectsSynced} />
    </>
  )
}
