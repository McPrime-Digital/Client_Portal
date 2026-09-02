import { isAdmin, userOrgId } from '@/lib/auth/role'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import AdminProjectsList from
  '@/components/admin/AdminProjectsList'
import { computeProjectProgress } from '@/lib/projectProgress'
import { orgUnread } from '@/lib/messageRead'
import RealtimeRefresh from '@/components/shared/RealtimeRefresh'

export default async function AdminProjectsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    redirect('/login')
  }

  // Tenant scope, resolved once from the verified session (never a param).
  const orgId = userOrgId(user)

  // Unread comes from the per-user watermark model like every other badge
  // (Batch 21 item 1). The old shape embedded EVERY message row of every
  // project just to count them — the last unbounded message read (I-1),
  // reported in Batches 15, 16 and §4 — and counted per-role `read_at`,
  // which the rest of the app left behind in Batch 14.
  const [{ data: projects }, unread] = await Promise.all([
    supabaseAdmin
      .from('projects')
      .select(`
        *,
        clients(id, name, company),
        tasks(id, status, approved_at),
        files(id, direction),
        messages(count),
        project_phases(progress)
      `)
      .eq('organization_id', orgId)
      .order('updated_at', { ascending: false }),
    orgUnread(supabaseAdmin, { userId: user.id, orgId }),
  ])

  // Sync the progress ring with the canonical phase-average.
  const projectsSynced = (projects ?? []).map((p: any) => ({
    ...p,
    progress: computeProjectProgress(p.project_phases, p.progress),
    unreadMessages: unread.byProject[p.id] ?? 0,
  }))

  return (
    <>
      <RealtimeRefresh tables={['projects', 'project_phases', 'tasks', 'messages', 'files']} pollMs={300_000} />
      <AdminProjectsList projects={projectsSynced} />
    </>
  )
}
