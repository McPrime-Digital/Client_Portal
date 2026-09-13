import Link from 'next/link'
import { requireOrgFeature } from '@/lib/studio/guard'
import { createClient } from '@/lib/supabase/server'
import { FileText } from 'lucide-react'

/**
 * CLIENT · DOCUMENTS — the documents engine given its own door.
 *
 * The engine has been live since migration 0004: `documents` with a Yjs `ydoc`
 * snapshot, `document_versions`, `document_comments` with anchors, and a
 * BlockNote editor that has shipped inside Script Design for batches. What did
 * not exist was a way to find a document without already knowing which
 * production it belonged to — the same gap `crew/tasks` had.
 *
 * ── WHY THIS IS NOT A SECOND SCRIPT DESIGN ─────────────────────────────────
 *
 * Script Design is the WRITING surface: one document, open, with the editor and
 * its collaborators. This is the INDEX — every document across every production
 * this person can reach, by kind, with the one fact a producer wants from a list
 * of documents, which is whether it has moved recently.
 *
 * Editing stays in one place. A second editor over the same Yjs document is the
 * remount hazard this codebase already recorded once: two BlockNote views for
 * one collab document drops the Yjs binding and loses edits. So every row links
 * INTO Script Design rather than opening anything here.
 *
 * ── `kind` IS THE AXIS, AND IT IS A REAL VOCABULARY ────────────────────────
 *
 * 0036 settled it: screenplay · treatment · bible · breakdown · document. That
 * is film's own taxonomy rather than a generic "type" field, which is what makes
 * grouping by it useful to the people who work this way.
 *
 * Scope is the database's: `documents_org_all` carries the project predicate in
 * both clauses since 0060, so this list is already the reader's world.
 */
export const dynamic = 'force-dynamic'

const KIND_LABEL: Record<string, string> = {
  screenplay: 'Screenplays',
  treatment: 'Treatments',
  bible: 'Bibles',
  breakdown: 'Breakdowns',
  document: 'Documents',
}

const since = (iso: string | null) => {
  if (!iso) return null
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 30 ? `${d} days ago` : new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default async function DocumentsPage() {
  await requireOrgFeature('client', 'documents')
  const supabase = await createClient()

  const { data: rows, error } = await supabase
    .from('documents')
    .select('id, title, kind, project_id, updated_at, last_opened_at, projects(title)')
    .order('updated_at', { ascending: false })
    .limit(300)

  if (error) {
    return (
      <div className="mx-auto max-w-2xl pt-[8vh]">
        <h1 className="font-display text-[22px] font-semibold text-foreground">Documents</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">
          Documents couldn&apos;t be loaded. Reload to try again.
        </p>
      </div>
    )
  }

  type D = {
    id: string; title: string; kind: string | null; project_id: string | null
    updated_at: string | null; last_opened_at: string | null
    projects: { title?: string } | { title?: string }[] | null
  }
  const docs = (rows ?? []) as unknown as D[]
  const prod = (d: D) => {
    const p = Array.isArray(d.projects) ? d.projects[0] : d.projects
    return p?.title ?? null
  }

  const groups = new Map<string, D[]>()
  for (const d of docs) {
    const k = d.kind ?? 'document'
    groups.set(k, [...(groups.get(k) ?? []), d])
  }
  const order = ['screenplay', 'treatment', 'bible', 'breakdown', 'document']
  const sorted = [...groups.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-6">
        <h1 className="font-display text-[22px] font-semibold tracking-[-0.01em] text-foreground">
          Documents
        </h1>
        <p className="mt-0.5 text-[13px] text-faint">
          {docs.length} across your productions
        </p>
      </header>

      {docs.length === 0 ? (
        // Empty as onboarding: name the place work begins, not what is absent.
        <div className="squircle-lg border border-border bg-card p-7">
          <FileText size={20} className="text-faint" strokeWidth={1.5} />
          <p className="mt-3 font-display text-base font-semibold text-foreground">No documents yet</p>
          <p className="mt-1.5 max-w-sm text-[14px] text-muted-foreground">
            Screenplays, treatments and bibles are written in Script Design and
            appear here as soon as they exist.
          </p>
          <Link
            href="/studio/suite/script"
            className="squircle-sm mt-4 inline-flex items-center border border-border px-3 py-1.5 text-[13px] text-foreground outline-none transition-[border-color,transform] duration-[--dur-pop] ease-[--ease-out] hover:border-[hsl(var(--glow)/0.45)] focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
          >
            Open Script Design
          </Link>
        </div>
      ) : (
        sorted.map(([kind, items]) => (
          <section key={kind} className="mb-6">
            <h2 className="mb-2 font-display text-[13px] font-semibold text-muted-foreground">
              {KIND_LABEL[kind] ?? 'Documents'}
            </h2>
            <div className="squircle overflow-hidden border border-border bg-card">
              {items.map((d) => (
                <Link
                  key={d.id}
                  href={`/studio/suite/script?doc=${d.id}`}
                  className="flex items-center gap-3 border-b border-border px-4 py-2.5 outline-none transition-colors duration-[--dur-pop] last:border-b-0 hover:bg-secondary/50 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">{d.title}</span>
                    {prod(d) && <span className="text-[10.5px] text-faint">{prod(d)}</span>}
                  </span>
                  {d.updated_at && (
                    <span className="flex-shrink-0 text-[11px] text-faint">{since(d.updated_at)}</span>
                  )}
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
