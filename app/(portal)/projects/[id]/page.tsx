import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { redirect, notFound } from 'next/navigation'
import ProjectDetail from '@/components/portal/ProjectDetail'

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
    .eq('user_id', user.id)
    .single()

  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p style={{ color: 'hsl(var(--muted-foreground))' }}>
          Your account is being set up. Please contact McPrime Digital.
        </p>
      </div>
    )
  }

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('*')
    .eq('id', id)
    .eq('client_id', client.id)
    .single()

  if (!project) notFound()

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

  const [
    { data: phases },
    { data: tasks },
    { data: files },
    { data: messages },
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
    supabaseAdmin
      .from('messages')
      .select('*')
      .eq('project_id', project.id)
      .order('created_at', { ascending: true }),
  ])

  return (
    <ProjectDetail
      project={project}
      phases={phases ?? []}
      tasks={tasks ?? []}
      files={files ?? []}
      initialMessages={messages ?? []}
      client={client}
      involvement={involvement}
    />
  )
}
