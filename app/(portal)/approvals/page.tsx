import ApprovalRecord from '@/components/shared/ApprovalRecord'
import { clientCan } from '@/lib/permissions'
import { portalClientId, portalAccess } from '@/lib/team'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CheckCircle2, Clock3, MessageSquareWarning, ScanEye, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import RealtimeRefresh from '@/components/shared/RealtimeRefresh'

// Review & Approvals — the client's decision queue. Mirrors every deliverable
// sent for their sign-off across all of their projects; approving and
// requesting changes happen inside the project (the TaskBoard flow).

type ReviewTask = {
  id: string
  title: string
  description: string | null
  approval_status: string | null
  approval_note: string | null
  approved_at: string | null
  review_requested_at: string | null
  status: string
  updated_at: string
  project_id: string
}

function fmtDate(d: string | null) {
  if (!d) return null
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function TaskRow({
  task,
  projectTitle,
  meta,
  cta,
}: {
  task: ReviewTask
  projectTitle: string
  meta: string | null
  cta?: string
}) {
  return (
    <Link
      href={`/projects/${task.project_id}`}
      className="group flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-3.5 transition-colors hover:border-primary/40 hover:bg-primary/5"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{task.title}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{projectTitle}</p>
        {task.approval_note && (
          <p className="mt-1 truncate text-xs italic text-muted-foreground">“{task.approval_note}”</p>
        )}
      </div>
      {meta && <span className="hidden flex-shrink-0 text-xs text-faint sm:block">{meta}</span>}
      {cta && (
        <span className="flex-shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
          {cta}
        </span>
      )}
      <ChevronRight
        size={16}
        className="flex-shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
      />
    </Link>
  )
}

export default async function ClientApprovalsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('id', await portalClientId(user))
    .single()
  if (!client) redirect('/dashboard')

  const { data: projects } = await supabaseAdmin
    .from('projects')
    .select('id, title')
    .eq('client_id', client.id)
  // Approvals belong to roles that can act on them — others never see this page.
  const access = await portalAccess(user)
  if (access && !clientCan(access.role, 'approve', access.extraCaps)) redirect('/dashboard')

  const scoped = (projects ?? []).filter(
    (p) => !access?.projectIds || access.projectIds.includes(p.id)
  )
  const projectTitle = new Map(scoped.map((p) => [p.id, p.title as string]))
  const projectIds = scoped.map((p) => p.id)

  let tasks: ReviewTask[] = []
  if (projectIds.length > 0) {
    const { data } = await supabaseAdmin
      .from('tasks')
      .select(
        'id, title, description, approval_status, approval_note, approved_at, review_requested_at, status, updated_at, project_id'
      )
      .in('project_id', projectIds)
      .or('requires_approval.eq.true,category.eq.approval')
      .eq('visible_to_client', true)
      .order('updated_at', { ascending: false })
      .limit(200)
    tasks = (data ?? []) as ReviewTask[]
  }

  // Same gates the project TaskBoard uses — the queues can never disagree.
  const needsYou = tasks.filter(
    (t) => t.status === 'review' && t.approval_status !== 'approved' && !t.approved_at
  )
  const changes = tasks.filter(
    (t) =>
      t.approval_status === 'changes_requested' &&
      !t.approved_at &&
      t.status !== 'completed' &&
      t.status !== 'review'
  )
  const approved = tasks.filter((t) => !!t.approved_at).slice(0, 30)

  return (
    <div className="mx-auto max-w-4xl">
      <RealtimeRefresh tables={['tasks']} pollMs={300_000} />

      <div className="mb-6">
        <h1 className="flex items-center gap-3 font-display text-2xl font-semibold text-foreground">
          <ScanEye size={24} className="text-primary" />
          Review &amp; Approvals
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Deliverables waiting on your sign-off, across all your projects. Open one to approve it or request changes.
        </p>
      </div>

      {/* THE RECORD (Batch 22 item 9, S3-c §3.2) — every review, decision,
          reminder and lapse, timestamped and attributed. It renders ABOVE the
          legacy task queue rather than replacing it: with the approvals engine
          newly live, swapping this page's query wholesale would have emptied a
          surface that currently shows real pending gates. Rule Zero. The task
          queue below drops when its columns do. */}
      <ApprovalRecord side="portal" />

      <div className="mb-8 grid grid-cols-3 gap-3">
        {[
          { label: 'Awaiting your approval', n: needsYou.length, tone: 'text-primary' },
          { label: 'Changes in progress', n: changes.length, tone: 'text-destructive' },
          { label: 'Approved', n: approved.length, tone: 'text-muted-foreground' },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-border bg-card px-4 py-3.5">
            <p className={`font-display text-2xl font-semibold ${s.tone}`}>{s.n}</p>
            <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wider text-faint">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="space-y-8">
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Clock3 size={16} className="text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Awaiting your approval</h2>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
              {needsYou.length}
            </span>
          </div>
          {needsYou.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-faint">
              You&apos;re all caught up — nothing needs your sign-off.
            </p>
          ) : (
            <div className="space-y-2">
              {needsYou.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  projectTitle={projectTitle.get(t.project_id) ?? 'Project'}
                  meta={t.review_requested_at ? `sent ${fmtDate(t.review_requested_at)}` : null}
                  cta="Review now"
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <MessageSquareWarning size={16} className="text-destructive" />
            <h2 className="text-sm font-semibold text-foreground">Changes you requested</h2>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
              {changes.length}
            </span>
          </div>
          {changes.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-faint">
              No open change requests.
            </p>
          ) : (
            <div className="space-y-2">
              {changes.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  projectTitle={projectTitle.get(t.project_id) ?? 'Project'}
                  meta={`updated ${fmtDate(t.updated_at)}`}
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <CheckCircle2 size={16} className="text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Recently approved</h2>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
              {approved.length}
            </span>
          </div>
          {approved.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-faint">
              Your approvals will appear here.
            </p>
          ) : (
            <div className="space-y-2">
              {approved.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  projectTitle={projectTitle.get(t.project_id) ?? 'Project'}
                  meta={t.approved_at ? `approved ${fmtDate(t.approved_at)}` : null}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
