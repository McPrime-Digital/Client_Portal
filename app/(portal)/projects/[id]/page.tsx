import { clientCan } from '@/lib/permissions'
import { portalClientId, portalAccess } from '@/lib/team'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { tenantBrand } from '@/lib/tenantBrand'
import { redirect, notFound } from 'next/navigation'
import ProjectDetail from '@/components/portal/ProjectDetail'
import RealtimeRefresh from '@/components/shared/RealtimeRefresh'

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('*')
    .eq('id', await portalClientId(user))
    .single()

  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
          {/* No client row means no organization, so there is genuinely no
              tenant to name here. The name is dropped rather than defaulted:
              printing one studio's name to another studio's client is the
              P-1 defect, and a stand-in reads worse than the sentence without
              it (S0-B §2). */}
        <p style={{ color: 'hsl(var(--muted-foreground))' }}>
          Your account is being set up. Please contact your studio.
        </p>
      </div>
    )
  }

  // The studio serving this client — name resolved from the database (S0-B §3).
  const brand = await tenantBrand(client.organization_id)

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('*')
    .eq('id', id)
    .eq('client_id', client.id)
    .single()

  if (!project) notFound()

  // Member scoping — a restricted member may only open their listed projects.
  const access = await portalAccess(user)
  if (access?.projectIds && !access.projectIds.includes(project.id)) notFound()

  // Approvals & Records ledger — ONLY task-approval activity (approvals,
  // change-requests, auto-proceeded gates) with any file shared during the
  // decision. Chat messages and other activity are deliberately excluded.
  let involvement: any[] = []
  try {
    const { data } = await supabaseAdmin
      .from('activity_log')
      .select('id, actor_name, actor_role, event_type, title, body, meta, created_at')
      .eq('project_id', project.id)
      .in('event_type', ['approval_requested', 'task_approved', 'changes_requested', 'task_auto_approved'])
      .order('created_at', { ascending: false })
      .limit(500)
    involvement = data ?? []
  } catch { involvement = [] }

  // Messages are RoomThread's now — fetched client-side, bounded, one code
  // path with the hub (Batch 15 item 1). The page stops shipping the thread.
  const [
    { data: phases },
    { data: tasks },
    { data: files },
  ] = await Promise.all([
    supabaseAdmin
      .from('project_phases')
      .select('*')
      .eq('project_id', project.id)
      .order('sort_order'),
    supabaseAdmin
      .from('tasks')
      .select('*')
      .eq('project_id', project.id)
      .order('sort_order'),
    supabaseAdmin
      .from('files')
      .select('*')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false }),
  ])

  return (
    <>
      {/* Live: re-run this server query (fresh phases/status/tasks) on any
          change, with a poll fallback so phase progress always advances in
          real time even if Realtime replication is unavailable. */}
      <RealtimeRefresh
        tables={['project_phases', 'projects', 'tasks', 'files']}
        pollMs={12000}
      />
      <ProjectDetail
        project={project}
        phases={phases ?? []}
      tasks={tasks ?? []}
      files={files ?? []}
        client={client}
        studioName={brand.name}
        memberName={access?.name}
        memberRole={access?.role}
        canApprove={clientCan(access?.role ?? 'owner', 'approve', access?.extraCaps)}
        canMessage={clientCan(access?.role ?? 'owner', 'message', access?.extraCaps)}
        involvement={involvement}
      />
    </>
  )
}
