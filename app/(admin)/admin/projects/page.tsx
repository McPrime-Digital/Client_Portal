import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import AdminProjectsList from
  '@/components/admin/AdminProjectsList'

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
      messages(id, sender_role, read_at)
    `)
    .order('updated_at', { ascending: false })

  return <AdminProjectsList projects={projects ?? []} />
}
