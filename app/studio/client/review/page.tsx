import ApprovalRecord from '@/components/shared/ApprovalRecord'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CheckCircle2, Clock3, MessageSquareWarning, ScanEye, ChevronRight, ShieldAlert } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { isAdmin, userOrgId } from '@/lib/auth/role'
import { can } from '@/lib/capabilities.server'
import { listApprovalChains } from '@/lib/approvals'
import { approvalIntel } from '@/lib/approvalIntel'
import { listViewsForSubjects, type ViewRow } from '@/lib/shareLinks'
import RealtimeRefresh from '@/components/shared/RealtimeRefresh'
import { requireOrgFeature } from '@/lib/studio/guard'

// Review & Approvals — the cross-project approvals queue.
//
// TWO THINGS LIVE HERE AND THEY ARE NOT THE SAME AGE. The approvals ENGINE
// (S3-c, migrations 0038–0041) is the authority: stages, assignees, decisions,
// reminders, lapses. The `tasks.approval_status` columns are a PROJECTION of it
// (0041) that ALSO carries gates predating the engine — 32 task gates against 5
// approvals, live today — so the legacy queue is still the working surface and
// Rule Zero keeps it. It moves BELOW the record rather than above it, and it is
// labelled for what it is.
//
// THE SCOPING FIX (S-S Phase C). This page read `tasks` through `supabaseAdmin`,
// which bypasses RLS and therefore bypasses the project scoping 0057–0059 built:
// a contractor scoped to one production would have been handed every
// production's review queue. Nothing leaked — both live crew are
// `scope_mode='all'` — but the gap was armed and would have fired on the first
// scoped seat, which is the entire thing Batch 26 exists to enable. It reads on
// the USER client now, which is what `crew/tasks` already does in production, so
// this is a proven path rather than a hopeful one.

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
  await requireOrgFeature('client', 'review')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) redirect('/login')

  const { data } = await supabase
    .from('tasks')
    .select(`
      id, title, approval_status, approval_note, approved_at, review_requested_at, updated_at,
      projects(id, title, clients(id, name, company, avatar_url))
    `)
    // Tenant scope, resolved once from the verified session (never a param).
    // Kept alongside RLS rather than replaced by it (I-9): RLS is the boundary,
    // the filter is the intent, and the two failing independently is what makes
    // a mistake visible instead of silent.
    .eq('organization_id', userOrgId(user))
    .eq('requires_approval', true)
    .order('updated_at', { ascending: false })
    .limit(200)

  const tasks = (data ?? []) as unknown as ReviewTask[]
  const pending = tasks.filter((t) => (t.approval_status ?? 'pending') === 'pending')
  const changes = tasks.filter((t) => t.approval_status === 'changes_requested')
  const approved = tasks
    .filter((t) => t.approval_status === 'approved' || t.approval_status === 'auto_approved')
    .slice(0, 30)

  // THE ENGINE'S OWN READ, for the attention band. Gated on the same capability
  // the list route gates on, so finance — money across every production, the
  // craft floor absent (S-R §8) — gets the page without the dispute surface.
  const mayReadRecord = await can(user, 'record.ledger.read')
  const chains = mayReadRecord
    ? (await listApprovalChains(supabase, { orgId: userOrgId(user), limit: 50 })).chains
    : []

  // The viewing evidence for the whole page in two queries, not two per chain —
  // `listApprovalChains` exists for exactly this reason and the same argument
  // applies one table over. The list's grade MUST agree with the record page's,
  // and `approvalIntel` downgrades on a token viewing.
  const subjectIds = chains
    .filter((c) => c.approval.subject_kind === 'file_version')
    .map((c) => c.approval.subject_id)
  const viewsBySubject = subjectIds.length
    ? await listViewsForSubjects(supabase, 'file', subjectIds)
    : new Map<string, ViewRow[]>()

  const graded = chains
    .map((c) => ({
      c,
      intel: approvalIntel({
        ...c,
        // undefined, not [], where the subject is not a file — nobody asked.
        views: c.approval.subject_kind === 'file_version'
          ? (viewsBySubject.get(c.approval.subject_id) ?? []).map((v) => ({
              at: v.started_at,
              who: v.viewer_name || v.viewer_email,
              furthestMs: v.furthest_ms,
              durationMs: v.duration_ms,
            }))
          : undefined,
      }),
    }))
    .filter(({ c }) => c.approval.status === 'open' || c.approval.status === 'changes_requested')

  const onUs = graded.filter(({ intel }) => intel.waitingOn === 'studio')
  // Sorted worst-first: a record that would not hold up is the thing to fix
  // today, and "thin" ages into "broken" while nobody is looking.
  const weak = graded
    .filter(({ intel }) => intel.defensibility !== 'strong')
    .sort((a, b) => (a.intel.defensibility === 'broken' ? -1 : 0) - (b.intel.defensibility === 'broken' ? -1 : 0))

  return (
    <div className="mx-auto max-w-4xl">
      <RealtimeRefresh tables={['tasks']} pollMs={300_000} />

      <div className="mb-6">
        <h1 className="flex items-center gap-3 font-display text-2xl font-semibold text-foreground">
          <ScanEye size={24} className="text-primary" />
          Review &amp; Approvals
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every deliverable awaiting a decision, across all productions.
        </p>
      </div>

      {/* THE ATTENTION BAND (SS-5 — one primary statement). It renders only
          when it has something to say: a band that always shows "0 things need
          attention" trains people to stop reading it. */}
      {mayReadRecord && (onUs.length > 0 || weak.length > 0) && (
        <section className="squircle mb-8 border border-border bg-card p-5">
          <p className="font-display text-[15px] font-semibold text-foreground">
            {onUs.length > 0
              ? `${onUs.length} approval${onUs.length === 1 ? '' : 's'} ${onUs.length === 1 ? 'is' : 'are'} waiting on you.`
              : 'Nothing is waiting on you.'}
          </p>

          {weak.length > 0 && (
            <>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {weak.length} record{weak.length === 1 ? '' : 's'} would not hold up as {weak.length === 1 ? 'it' : 'they'} stand{weak.length === 1 ? 's' : ''}.
                There is still time to fix {weak.length === 1 ? 'it' : 'them'}.
              </p>
              <ul className="mt-3 space-y-2">
                {weak.slice(0, 5).map(({ c, intel }) => (
                  <li key={c.approval.id}>
                    <Link
                      href={`/studio/client/review/${c.approval.id}`}
                      className="squircle-sm flex items-start gap-2.5 border border-border bg-background/40 px-3 py-2.5 outline-none transition-[border-color] duration-[--dur-pop] hover:border-[hsl(var(--glow)/0.45)] focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ShieldAlert
                        size={14}
                        className={`mt-0.5 shrink-0 ${intel.defensibility === 'broken' ? 'text-destructive' : 'text-[hsl(var(--status-amber,var(--destructive)))]'}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-foreground">
                          {c.approval.title}
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                          {intel.because}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {/* THE RECORD (Batch 22 item 9, S3-c §3.2) — every review, decision,
          reminder and lapse, timestamped and attributed. */}
      <ApprovalRecord side="studio" />

      {/* THE LEGACY GATE QUEUE (Rule Zero). Named for what it is, and placed
          after the record rather than before it. These are `tasks` rows with
          `requires_approval`, which the engine projects onto (0041) but which
          also predate it — so this stays the larger, working list until those
          columns drop. */}
      <div className="mb-4 mt-10">
        <h2 className="font-display text-sm font-semibold text-foreground">Task gates</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Deliverables marked as needing a client decision. Manage each one inside its production.
        </p>
      </div>

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
