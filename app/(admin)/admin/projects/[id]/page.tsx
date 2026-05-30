import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { redirect, notFound } from 'next/navigation'
import AdminProjectDetail from '@/components/admin/AdminProjectDetail'

export default async function AdminProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.user_metadata?.role !== 'admin') {
    redirect('/login')
  }

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select(`
      *,
      clients(id, name, email, company)
    `)
    .eq('id', id)
    .single()

  if (!project) notFound()

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

  // Mark client messages as read
  const unreadIds = messages
    ?.filter((m) => !m.read_at && m.sender_role === 'client')
    .map((m) => m.id) ?? []

  if (unreadIds.length > 0) {
    await supabaseAdmin
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .in('id', unreadIds)
  }

  const client = (project as any).clients

  // A project whose client was deleted is preserved but unlinked (client_id null).
  // AdminProjectDetail requires a client, so show a clear notice instead of crashing.
  if (!client) {
    return (
      <div className="max-w-[600px] mx-auto py-16 text-center space-y-4">
        <h1
          className="font-display text-xl font-bold"
          style={{ color: 'hsl(var(--foreground))' }}
        >
          {project.title}
        </h1>
        <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
          This project is not linked to a client — its client was removed.
          Re-assign it to a client to manage files, messages, and tasks.
        </p>
        <div className="flex items-center justify-center gap-3">
          <a
            href={`/admin/projects/${project.id}/edit`}
            className="px-4 py-2.5 rounded-lg text-sm font-semibold"
            style={{ backgroundColor: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
          >
            Edit Project
          </a>
          <a
            href="/admin/projects"
            className="px-4 py-2.5 rounded-lg text-sm font-medium"
            style={{
              backgroundColor: 'hsl(var(--secondary))',
              color: 'hsl(var(--foreground))',
              border: '1px solid hsl(var(--border))',
            }}
          >
            Back to Projects
          </a>
        </div>
      </div>
    )
  }

  return (
    <AdminProjectDetail
      project={project}
      client={client}
      phases={phases ?? []}
      tasks={tasks ?? []}
      files={files ?? []}
      initialMessages={messages ?? []}
    />
  )
}
