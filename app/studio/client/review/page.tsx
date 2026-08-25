import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CheckCircle2, Clock3, MessageSquareWarning, ScanEye, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isAdmin } from '@/lib/auth/role'
import RealtimeRefresh from '@/components/shared/RealtimeRefresh'

// Review & Approvals — the cross-project approvals queue. Mirrors every task
// that requires client approval (the same records managed inside each project)
// grouped by state, so nothing awaiting a decision hides inside a project page.

type ReviewTask = {
  id: string
  title: string
  approval_status: string | null
  approval_note: string | null
  approved_at: string | null
  review_requested_at: string | null
  updated_at: string
  projects: {
    id: string
    title: string
    clients: { id: string; name: string; company: string | null; avatar_url: string | null } | null
  } | null
}

function fmtDate(d: string | null) {
  if (!d) return null
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function TaskRow({ task, meta }: { task: ReviewTask; meta: string | null }) {
  const project = task.projects
  const client = project?.clients
  return (
    <Link
      href={project ? `/studio/client/projects/${project.id}` : '/studio/client/projects'}
      className="group flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-3.5 transition-colors hover:border-primary/40 hover:bg-primary/5"
    >
      <div className="grid h-9 w-9 flex-shrink-0 place-items-center overflow-hidden rounded-full bg-secondary text-xs font-bold text-primary">
        {client?.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={client.avatar_url} alt="" className="h-full w-full object-cover" />
        ) : (
          (client?.name ?? '?').slice(0, 1).toUpperCase()
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{task.title}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {project?.title ?? 'Untitled project'}
          {client && <> · {client.company || client.name}</>}
        </p>
        {task.approval_note && (
          <p className="mt-1 truncate text-xs italic text-muted-foreground">“{task.approval_note}”</p>
        )}
      </div>
      {meta && <span className="hidden flex-shrink-0 text-xs text-faint sm:block">{meta}</span>}
      <ChevronRight
        size={16}
        className="flex-shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
      />
    </Link>
  )
}

function Section({
  icon: Icon,
  title,
  tone,
  tasks,
  metaOf,
  empty,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>
  title: string
  tone: string
  tasks: ReviewTask[]
  metaOf: (t: ReviewTask) => string | null
  empty: string
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <Icon size={16} className={tone} />
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
          {tasks.length}
        </span>
      </div>
      {tasks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-faint">
          {empty}
        </p>
      ) : (
        <div className="space-y-2">
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} meta={metaOf(t)} />
          ))}
        </div>
      )}
    </section>
  )
}

export default async function ReviewApprovalsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) redirect('/login')

  const { data } = await supabaseAdmin
    .from('tasks')
    .select(`
      id, title, approval_status, approval_note, approved_at, review_requested_at, updated_at,
      projects(id, title, clients(id, name, company, avatar_url))
    `)
    .eq('requires_approval', true)
    .order('updated_at', { ascending: false })
    .limit(200)

  const tasks = (data ?? []) as unknown as ReviewTask[]
  const pending = tasks.filter((t) => (t.approval_status ?? 'pending') === 'pending')
  const changes = tasks.filter((t) => t.approval_status === 'changes_requested')
  const approved = tasks
    .filter((t) => t.approval_status === 'approved' || t.approval_status === 'auto_approved')
    .slice(0, 30)

  return (
    <div className="mx-auto max-w-4xl">
      <RealtimeRefresh tables={['tasks']} pollMs={30_000} />

      <div className="mb-6">
        <h1 className="flex items-center gap-3 font-display text-2xl font-semibold text-foreground">
          <ScanEye size={24} className="text-primary" />
          Review &amp; Approvals
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every deliverable awaiting a client decision, across all projects. Manage each one inside its project.
        </p>
      </div>

      {/* status tiles */}
      <div className="mb-8 grid grid-cols-3 gap-3">
        {[
          { label: 'Awaiting approval', n: pending.length, tone: 'text-primary' },
          { label: 'Changes requested', n: changes.length, tone: 'text-destructive' },
          { label: 'Approved', n: approved.length, tone: 'text-muted-foreground' },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-border bg-card px-4 py-3.5">
            <p className={`font-display text-2xl font-semibold ${s.tone}`}>{s.n}</p>
            <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wider text-faint">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="space-y-8">
        <Section
          icon={Clock3}
          title="Awaiting client approval"
          tone="text-primary"
          tasks={pending}
          metaOf={(t) => (t.review_requested_at ? `requested ${fmtDate(t.review_requested_at)}` : null)}
          empty="Nothing is waiting on a client right now."
        />
        <Section
          icon={MessageSquareWarning}
          title="Changes requested"
          tone="text-destructive"
          tasks={changes}
          metaOf={(t) => `updated ${fmtDate(t.updated_at)}`}
          empty="No change requests — all clear."
        />
        <Section
          icon={CheckCircle2}
          title="Recently approved"
          tone="text-muted-foreground"
          tasks={approved}
          metaOf={(t) => (t.approved_at ? `approved ${fmtDate(t.approved_at)}` : null)}
          empty="Approvals will appear here as clients sign off."
        />
      </div>
    </div>
  )
}
