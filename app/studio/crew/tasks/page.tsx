import Link from 'next/link'
import { requireOrgFeature } from '@/lib/studio/guard'
import { createClient } from '@/lib/supabase/server'

/**
 * CREW · TASKS — every production this person can reach, grouped by WHO IS
 * BLOCKING rather than by status.
 *
 * ── THE REFRAME, AND WHY IT IS NOT A BOARD ─────────────────────────────────
 *
 * Every task tool on the market groups by status: To do / Doing / Done. That is
 * the shape of the DATA, not of the question. What a producer actually asks each
 * morning is "what is waiting on me, and what am I waiting on somebody else
 * for" — and status cannot answer it, because "pending" covers both a task
 * nobody has started and a task sitting with a client for five days.
 *
 * So the axis here is the blocker: THEM, YOU, or nobody yet. That is only
 * possible because this codebase has an approvals engine — a task carries
 * `requires_approval` and `approval_status`, so "sent to the client and waiting"
 * is a state the database knows. Frame.io and Flow Production Tracking model
 * approval as a status on an ASSET, not on the work, so neither can group a task
 * list this way.
 *
 * ── THE AUTO-ADVANCE DEADLINE, WHICH NOTHING ELSE HAS ──────────────────────
 *
 * S3-c's engine auto-advances a gate on silence after the studio's review
 * window. So a task waiting on a client is not waiting indefinitely — it has a
 * date on which it resolves itself, and that is the single most useful thing
 * this page can say.
 *
 * IT IS SHOWN ONLY WHERE THE CLOCK ACTUALLY STARTED. Verified live: all 24
 * pending gates carry `review_requested_at = null` — they predate the engine, so
 * no window is running on them. Those show how long they have been waiting
 * instead. A countdown computed from a null start would be a confident fiction
 * on the one number a producer would act on.
 *
 * ── IT READS ON THE USER CLIENT, AND THAT IS THE WHOLE SCOPING PROOF ───────
 *
 * `tasks_crew_all` carries the project-scope predicate in both clauses since
 * 0059, so a cross-production list read on the cookie-bound client is scoped by
 * the DATABASE. A contractor sees their assignments' tasks and nothing else, and
 * there is no code here that says so. Reading with the service role would have
 * meant re-implementing org_project_visible in TypeScript — the second copy this
 * project spent a batch removing.
 */
export const dynamic = 'force-dynamic'

type Row = {
  id: string; title: string; status: string; due_date: string | null
  project_id: string | null; requires_approval: boolean | null
  approval_status: string | null; review_requested_at: string | null; created_at: string
  projects: { title?: string } | { title?: string }[] | null
}

/** The auto-advance deadline, and ONLY where the clock actually started.
 *  Verified live: all 24 pending gates carry review_requested_at = null — they
 *  predate the engine, so no window is running. A countdown computed from a null
 *  start would be a confident fiction on the one number a producer would act on. */
function production(r: Row) {
  const p = Array.isArray(r.projects) ? r.projects[0] : r.projects
  return p?.title ?? 'No production'
}

function deadline(t: Row, now: number, windowHours: number) {
  if (!t.review_requested_at) return null
  const left = Date.parse(t.review_requested_at) + windowHours * HOUR - now
  if (left <= 0) return 'auto-approving now'
  const h = Math.round(left / HOUR)
  return h < 48 ? `auto-approves in ${h}h` : `auto-approves in ${Math.round(h / 24)}d`
}

/** Hoisted to module scope deliberately: a component defined inside another
 *  component is a NEW component type on every render, so React remounts its
 *  whole subtree instead of updating it. Harmless on a static server render and
 *  a real defect the moment anything here becomes interactive — which is why the
 *  rule does not care that this page is currently static. */
function Bucket({ title, note, items, tone, now, windowHours }: {
  title: string; note: string; items: Row[]; tone: 'you' | 'them' | 'idle'
  now: number; windowHours: number
}) {
  if (items.length === 0) return null
  return (
    <section className="mb-7">
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="font-display text-[13px] font-semibold text-foreground">{title}</h2>
        <span className="text-[11.5px] text-faint">{note}</span>
      </div>
      <div className="squircle overflow-hidden border border-border bg-card">
        {items.map((t) => {
          const overdue = !!t.due_date && t.due_date < new Date(now).toISOString().slice(0, 10)
          const dl = tone === 'them' ? deadline(t, now, windowHours) : null
          const waited = tone === 'them' ? ageing(t.review_requested_at ?? t.created_at, now) : null
          return (
            <div key={t.id} className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground">{t.title}</span>
                <span className="text-[10.5px] text-faint">
                  {production(t)}
                  {t.approval_status === 'changes_requested' && ' · changes requested'}
                  {/* Only where the clock really started. */}
                  {dl && ` · ${dl}`}
                  {!dl && waited && ` · waiting ${waited}`}
                </span>
              </span>
              {t.due_date && (
                <span className={`flex-shrink-0 text-[11px] tabular-nums ${overdue ? 'font-semibold text-[hsl(var(--status-amber))]' : 'text-faint'}`}>
                  {new Date(t.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              )}
              {t.project_id && (
                <Link
                  href={`/studio/client/projects/${t.project_id}`}
                  className="flex-shrink-0 rounded-sm text-[11px] text-faint outline-none transition-colors duration-[--dur-pop] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  open
                </Link>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}


const HOUR = 3_600_000
const DAY = 86_400_000

const ageing = (iso: string | null, now: number) => {
  if (!iso) return null
  const d = Math.floor((now - Date.parse(iso)) / DAY)
  return d <= 0 ? 'today' : d === 1 ? '1 day' : `${d} days`
}

export default async function CrewTasksPage() {
  await requireOrgFeature('crew', 'tasks')
  const supabase = await createClient()

  // No org predicate and no project filter: RLS supplies both. An explicit
  // .eq('organization_id', …) here would read as defence and be a second,
  // weaker copy of the tenancy rule (AD-001).
  const [{ data: rows, error }, { data: org }] = await Promise.all([
    supabase
      .from('tasks')
      .select('id, title, status, due_date, project_id, requires_approval, approval_status, review_requested_at, created_at, projects(title)')
      .neq('status', 'completed')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(300),
    supabase.from('organizations').select('approval_window_hours').maybeSingle(),
  ])

  if (error) {
    // A failed read is not an empty task list, and rendering one would tell
    // somebody their work is done (I-10).
    return (
      <div className="mx-auto max-w-2xl pt-[8vh]">
        <h1 className="font-display text-[22px] font-semibold text-foreground">Tasks</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">
          Tasks couldn&apos;t be loaded, so this page would be wrong. Reload to try again.
        </p>
      </div>
    )
  }

  const tasks = (rows ?? []) as unknown as Row[]
  // Impure during render; taken once, from the render's own clock.
  const now = Date.parse(new Date().toISOString())
  const windowHours = org?.approval_window_hours ?? 120

  // ── the three buckets, and the order is the priority order ──────────────
  // What YOU are blocking comes first: it is the only bucket the reader can
  // clear themselves.
  const onYou = tasks.filter((t) => t.approval_status === 'changes_requested' || t.status === 'in_progress' || t.status === 'review')
  const onThem = tasks.filter((t) => t.requires_approval && t.approval_status === 'pending' && !onYou.includes(t))
  const unstarted = tasks.filter((t) => !onYou.includes(t) && !onThem.includes(t))

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-7">
        <h1 className="font-display text-[22px] font-semibold tracking-[-0.01em] text-foreground">
          Tasks
        </h1>
        <p className="mt-0.5 text-[13px] text-faint">
          {tasks.length} open across your productions
        </p>
      </header>

      {tasks.length === 0 ? (
        // Describes the WORK, never the reader. A scoped contractor with a quiet
        // production and an owner of an empty studio see the same true sentence.
        <p className="text-[15px] text-muted-foreground">Nothing open right now.</p>
      ) : (
        <>
          <Bucket title="Waiting on you" note="yours to move" items={onYou} tone="you" now={now} windowHours={windowHours} />
          <Bucket title="Waiting on the client" note="sent, not answered" items={onThem} tone="them" now={now} windowHours={windowHours} />
          <Bucket title="Not started" note="no one is blocked" items={unstarted} tone="idle" now={now} windowHours={windowHours} />
        </>
      )}
    </div>
  )
}
