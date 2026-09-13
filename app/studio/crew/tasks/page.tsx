import Link from 'next/link'
import { requireOrgFeature } from '@/lib/studio/guard'
import { createClient } from '@/lib/supabase/server'
import { ListChecks, CircleAlert } from 'lucide-react'

/**
 * CREW · TASKS — every task across every production this person can reach.
 *
 * The engine has been live since the portal era (`tasks`, 122 rows) and
 * `TaskBoard` has shipped inside a project page for as long. What did not exist
 * is the STUDIO-WIDE view: until now the only way to see a task was to already
 * know which production it was on.
 *
 * ── IT READS ON THE USER CLIENT, AND THAT IS THE POINT ─────────────────────
 *
 * Not `supabaseAdmin`. `tasks_crew_all` carries
 * `(project_id is null or org_project_visible(project_id))` in both clauses since
 * 0059, so a cross-production list read on the user client is scoped by the
 * DATABASE — a contractor sees their assignments' tasks and nothing else, and
 * this file contains no code that says so.
 *
 * That is what makes this surface worth building beyond its own utility: it is
 * the first page whose correctness is entirely the scoping layer's, and it would
 * be the first to show it broken. Reading it with the service role would have
 * required re-implementing `org_project_visible` in TypeScript, which is the
 * second copy this batch spent ten commits removing.
 *
 * ── S-3: THE EMPTY STATE DESCRIBES THE WORK, NOT THE READER ────────────────
 *
 * "No open tasks" is what a scoped contractor with a quiet production sees and
 * what an owner of an empty studio sees. It never says "no tasks you can see",
 * which would tell the reader that tasks exist and are being withheld.
 */
export const dynamic = 'force-dynamic'

const OPEN = ['pending', 'in_progress', 'review', 'blocked'] as const

const STATUS_LABEL: Record<string, string> = {
  pending: 'To do',
  in_progress: 'In progress',
  review: 'In review',
  blocked: 'Blocked',
  completed: 'Done',
}

export default async function CrewTasksPage() {
  await requireOrgFeature('crew', 'tasks')
  const supabase = await createClient()

  // No organization predicate and no project filter: RLS supplies both. An
  // explicit .eq('organization_id', …) here would read as defence and would in
  // fact be a second, weaker copy of the tenancy rule (AD-001).
  const { data: rows, error } = await supabase
    .from('tasks')
    .select('id, title, status, priority, due_date, project_id, approval_status, projects(title)')
    .in('status', OPEN as unknown as string[])
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(200)

  if (error) {
    // I-10: a read that failed is not an empty list, and rendering one would be a
    // claim the query never supported.
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-card p-8 text-center">
        <CircleAlert size={22} className="mx-auto text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">Tasks could not be loaded. Try again.</p>
      </div>
    )
  }

  type Row = {
    id: string; title: string; status: string; priority: string | null
    due_date: string | null; project_id: string | null; approval_status: string | null
    projects: { title?: string } | { title?: string }[] | null
  }
  const tasks = (rows ?? []) as unknown as Row[]
  const titleOf = (r: Row) => {
    const p = Array.isArray(r.projects) ? r.projects[0] : r.projects
    return p?.title ?? 'No production'
  }

  // Grouped by production, which is the axis a crew member actually thinks in —
  // and, since 0059, the axis that decides what is in this list at all.
  const groups = new Map<string, { title: string; items: Row[] }>()
  for (const t of tasks) {
    const key = t.project_id ?? 'none'
    if (!groups.has(key)) groups.set(key, { title: titleOf(t), items: [] })
    groups.get(key)!.items.push(t)
  }
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6 flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-secondary text-primary">
          <ListChecks size={18} />
        </span>
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">Tasks &amp; Assignments</h1>
          <p className="text-xs text-muted-foreground">
            {tasks.length} open across {groups.size} production{groups.size === 1 ? '' : 's'}
          </p>
        </div>
      </header>

      {groups.size === 0 && (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <p className="font-display text-base font-semibold text-foreground">No open tasks</p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Everything on your productions is done or not started.
          </p>
        </div>
      )}

      {[...groups.entries()].map(([key, g]) => (
        <section key={key} className="mb-5">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="font-display text-sm font-semibold text-foreground">{g.title}</h2>
            {key !== 'none' && (
              <Link
                href={`/studio/client/projects/${key}`}
                className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                open production
              </Link>
            )}
          </div>
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            {g.items.map((t) => {
              const overdue = !!t.due_date && t.due_date < today
              return (
                <div key={t.id} className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">{t.title}</span>
                    <span className="text-[10.5px] text-faint">
                      {STATUS_LABEL[t.status] ?? t.status}
                      {t.approval_status === 'changes_requested' && ' · changes requested'}
                    </span>
                  </span>
                  {t.due_date && (
                    <span className={`flex-shrink-0 text-[11px] ${overdue ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>
                      {new Date(t.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
