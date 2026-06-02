import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import StatusBadge from '@/components/portal/StatusBadge'
import ProgressBar from '@/components/shared/ProgressBar'
import RealtimeRefresh from '@/components/shared/RealtimeRefresh'
import { applyCanonicalProgress } from '@/lib/projectProgress'
import {
  FolderOpen,
  ArrowRight,
  Clock,
  CheckSquare,
  Files,
} from 'lucide-react'

export default async function ProjectsPage() {
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
        <FolderOpen size={40} style={{ color: 'hsl(var(--text-faint))' }} />
        <p style={{ color: 'hsl(var(--muted-foreground))' }}>
          Your account is being set up. Please contact McPrime Digital.
        </p>
      </div>
    )
  }

  const { data: projects } = await supabaseAdmin
    .from('projects')
    .select('*')
    .eq('client_id', client.id)
    .order('created_at', { ascending: false })

  const projectIds = (projects ?? []).map((p) => p.id)
  const hasProjects = projectIds.length > 0

  const [{ data: phases }, { data: tasks }, { data: files }] = await Promise.all([
    hasProjects
      ? supabaseAdmin.from('project_phases').select('project_id, progress').in('project_id', projectIds)
      : Promise.resolve({ data: [] as any[] }),
    hasProjects
      ? supabaseAdmin.from('tasks').select('project_id, status, visible_to_client, approved_at').in('project_id', projectIds)
      : Promise.resolve({ data: [] as any[] }),
    hasProjects
      ? supabaseAdmin.from('files').select('project_id, direction').in('project_id', projectIds)
      : Promise.resolve({ data: [] as any[] }),
  ])
  applyCanonicalProgress(projects, phases)

  // A little per-project overview: visible task progress + deliverables count.
  const isDone = (s: string | null) => ['complete', 'completed', 'done'].includes((s ?? '').toLowerCase())
  const statsByProject = new Map<string, { taskDone: number; taskTotal: number; deliverables: number }>()
  for (const id of projectIds) statsByProject.set(id, { taskDone: 0, taskTotal: 0, deliverables: 0 })
  for (const t of (tasks ?? []) as any[]) {
    if (!t.visible_to_client) continue
    const s = statsByProject.get(t.project_id)
    if (!s) continue
    s.taskTotal += 1
    if (isDone(t.status) || t.approved_at) s.taskDone += 1
  }
  for (const f of (files ?? []) as any[]) {
    if (f.direction !== 'delivery') continue
    const s = statsByProject.get(f.project_id)
    if (s) s.deliverables += 1
  }

  const active = projects?.filter(
    (p) => p.status !== 'Completed' && p.status !== 'On Hold'
  ) ?? []

  const completed = projects?.filter(
    (p) => p.status === 'Completed'
  ) ?? []

  const onHold = projects?.filter(
    (p) => p.status === 'On Hold'
  ) ?? []

  function ProjectCard({ project }: { project: any }) {
    return (
      <Link href={`/projects/${project.id}`}>
        <div
          className="card-interactive p-5 rounded-xl cursor-pointer
          group bg-[hsl(var(--card))] border border-[hsl(var(--border))]"
        >
          {/* Top row — project image (always shows a glass placeholder) */}
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="w-12 h-12 rounded-xl overflow-hidden grid place-items-center flex-shrink-0"
              style={{
                backgroundColor: 'hsl(var(--card) / 0.55)',
                backdropFilter: 'blur(8px) saturate(140%)',
                WebkitBackdropFilter: 'blur(8px) saturate(140%)',
                border: '1px solid hsl(var(--border) / 0.8)',
                boxShadow: '0 1px 0 hsl(0 0% 100% / 0.06) inset',
              }}>
              {project.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={project.image_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <FolderOpen size={18} style={{ color: 'hsl(var(--text-faint))' }} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h3
                className="font-display font-semibold text-sm
                truncate mb-1"
                style={{ color: 'hsl(var(--foreground))' }}
              >
                {project.title}
              </h3>
              <span
                className="text-xs px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: 'hsl(var(--border))',
                  color: 'hsl(var(--muted-foreground))',
                }}
              >
                {project.type}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <StatusBadge status={project.status} />
              <ArrowRight
                size={14}
                style={{ color: 'hsl(var(--text-faint))' }}
                className="transition-transform group-hover:translate-x-0.5"
              />
            </div>
          </div>

          {/* Progress bar */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Overall progress
              </span>
              <span
                className="text-xs font-semibold"
                style={{ color: 'hsl(var(--primary))' }}
              >
                {project.progress}%
              </span>
            </div>
            <ProgressBar value={project.progress} size="sm" />
          </div>

          {/* Quick overview — a little more at a glance */}
          {(() => {
            const s = statsByProject.get(project.id)
            if (!s) return null
            return (
              <div className="flex items-center gap-4 mb-3">
                <div className="flex items-center gap-1.5">
                  <CheckSquare size={12} style={{ color: 'hsl(var(--text-faint))' }} />
                  <span className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                    {s.taskDone}/{s.taskTotal} task{s.taskTotal === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Files size={12} style={{ color: 'hsl(var(--text-faint))' }} />
                  <span className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                    {s.deliverables} deliverable{s.deliverables === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
            )
          })()}

          {/* Meta row */}
          <div className="flex items-center gap-4">
            {project.due_date && (
              <div className="flex items-center gap-1.5">
                <Clock size={12} style={{ color: 'hsl(var(--text-faint))' }} />
                <span className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                  Due{' '}
                  {new Date(project.due_date).toLocaleDateString(
                    'en-US',
                    { month: 'short', day: 'numeric', year: 'numeric' }
                  )}
                </span>
              </div>
            )}
            {project.kickoff_date && (
              <div className="flex items-center gap-1.5">
                <CheckSquare size={12} style={{ color: 'hsl(var(--text-faint))' }} />
                <span className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                  Kicked off{' '}
                  {new Date(project.kickoff_date).toLocaleDateString(
                    'en-US',
                    { month: 'short', day: 'numeric' }
                  )}
                </span>
              </div>
            )}
          </div>
        </div>
      </Link>
    )
  }

  return (
    <div className="space-y-8 w-full">
      <RealtimeRefresh tables={['projects', 'project_phases']} />
      {/* Header */}
      <div>
        <h1
          className="font-display text-2xl font-bold"
          style={{ color: 'hsl(var(--foreground))' }}
        >
          Your Projects
        </h1>
        <p className="text-sm mt-1" style={{ color: 'hsl(var(--muted-foreground))' }}>
          {projects?.length ?? 0} total project
          {(projects?.length ?? 0) !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Empty state */}
      {(!projects || projects.length === 0) && (
        <div
          className="flex flex-col items-center justify-center 
          py-20 rounded-xl"
          style={{
            backgroundColor: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
          }}
        >
          <FolderOpen size={40} style={{ color: 'hsl(var(--text-faint))' }} />
          <p
            className="text-base font-semibold mt-4"
            style={{ color: 'hsl(var(--muted-foreground))' }}
          >
            No projects yet
          </p>
          <p className="text-sm mt-1" style={{ color: 'hsl(var(--text-faint))' }}>
            McPrime Digital will set up your projects here
          </p>
        </div>
      )}

      {/* Active */}
      {active.length > 0 && (
        <div>
          <h2
            className="text-xs font-semibold uppercase tracking-widest 
            mb-4"
            style={{ color: 'hsl(var(--text-faint))' }}
          >
            Active — {active.length}
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {active.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        </div>
      )}

      {/* On Hold */}
      {onHold.length > 0 && (
        <div>
          <h2
            className="text-xs font-semibold uppercase tracking-widest 
            mb-4"
            style={{ color: 'hsl(var(--text-faint))' }}
          >
            On Hold — {onHold.length}
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {onHold.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        </div>
      )}

      {/* Completed */}
      {completed.length > 0 && (
        <div>
          <h2
            className="text-xs font-semibold uppercase tracking-widest 
            mb-4"
            style={{ color: 'hsl(var(--text-faint))' }}
          >
            Completed — {completed.length}
          </h2>
          <div className="grid gap-3 md:grid-cols-2 opacity-60">
            {completed.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
