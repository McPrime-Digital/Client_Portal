import Link from 'next/link'
import { requireOrgFeature } from '@/lib/studio/guard'
import { createClient } from '@/lib/supabase/server'
import { meterFor } from '@/lib/billing/meters'

/**
 * SUITE · ASSET LIBRARY — the organisation-wide view of everything held.
 *
 * ── ONE ENGINE, TWO DOORS (owner decision, S-S §5 q4) ──────────────────────
 *
 * `client/files` is the per-COMPANY vault: a studio answering "what do I have
 * for this client". This is the org-wide DAM: "what do we hold, where is it, and
 * what is it costing us". Same `files` table, two questions — the same shape the
 * room model already uses, and the reason neither is a duplicate of the other.
 *
 * ── FACETS ARE IN THE URL, WHICH IS WHAT MAKES THEM COLLECTIONS ────────────
 *
 * Frame.io V4's headline DAM feature is Collections: saved, dynamic,
 * metadata-driven views. The mechanism that makes a view saveable is that its
 * definition is ADDRESSABLE — so every facet here is a query parameter, and a
 * filtered library is a URL somebody can bookmark, send to an assistant, or pin
 * in a room. Server-rendered, so the link opens to the same thing for the person
 * who receives it, filtered by THEIR permissions rather than the sender's.
 *
 * ── AND THE THING FRAME.IO CANNOT SHOW ─────────────────────────────────────
 *
 * Which production is consuming the storage. Frame.io does not model storage as
 * a cost, so it cannot tell you that one job is holding 300 GB. Here the meter
 * model (lib/billing/meters.ts) says storage is a STOCK allocatable to a
 * production via file → project, so the footprint column is the same number that
 * becomes a bill the day storage is charged. It is labelled honestly as not-yet-
 * billed rather than shown as $0.00, which would read as free.
 *
 * ── SCOPE IS THE DATABASE'S (0059) ─────────────────────────────────────────
 *
 * Read on the user client. `files_crew_all` carries the project predicate in
 * both clauses, so a contractor's library is their assignments' files and
 * nothing here says so.
 */
export const dynamic = 'force-dynamic'

const GB = 1024 ** 3
const size = (bytes: number) =>
  bytes >= GB ? `${(bytes / GB).toFixed(1)} GB`
  : bytes >= 1024 ** 2 ? `${Math.round(bytes / 1024 ** 2)} MB`
  : `${Math.max(1, Math.round(bytes / 1024))} KB`

type Search = { production?: string; kind?: string; final?: string }

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  await requireOrgFeature('suite', 'library')
  const sp = await searchParams
  const supabase = await createClient()

  const { data: rows, error } = await supabase
    .from('files')
    .select('id, file_name, file_size, mime_type, category, project_id, is_final, version, download_count, created_at, projects(title)')
    .order('created_at', { ascending: false })
    .limit(1000)

  if (error) {
    return (
      <div className="mx-auto max-w-3xl pt-[8vh]">
        <h1 className="font-display text-[22px] font-semibold text-foreground">Asset Library</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">
          The library couldn&apos;t be loaded. Reload to try again.
        </p>
      </div>
    )
  }

  type F = {
    id: string; file_name: string; file_size: number | null; mime_type: string | null
    category: string | null; project_id: string | null; is_final: boolean | null
    version: number | null; download_count: number | null; created_at: string
    projects: { title?: string } | { title?: string }[] | null
  }
  const all = (rows ?? []) as unknown as F[]
  const prodTitle = (f: F) => {
    const p = Array.isArray(f.projects) ? f.projects[0] : f.projects
    return p?.title ?? 'Unassigned'
  }
  const kindOf = (f: F) => {
    const m = f.mime_type ?? ''
    if (m.startsWith('video')) return 'video'
    if (m.startsWith('image')) return 'image'
    if (m.startsWith('audio')) return 'audio'
    if (m.includes('pdf')) return 'document'
    return f.category ?? 'other'
  }

  // ── footprint per production, which is the cost view ────────────────────
  const byProduction = new Map<string, { title: string; bytes: number; files: number; id: string | null }>()
  for (const f of all) {
    const key = f.project_id ?? 'none'
    const e = byProduction.get(key) ?? { title: prodTitle(f), bytes: 0, files: 0, id: f.project_id }
    e.bytes += f.file_size ?? 0
    e.files += 1
    byProduction.set(key, e)
  }
  const productions = [...byProduction.entries()].sort((a, b) => b[1].bytes - a[1].bytes)
  const kinds = [...new Set(all.map(kindOf))].sort()
  const totalBytes = all.reduce((s, f) => s + (f.file_size ?? 0), 0)

  const shown = all.filter((f) =>
    (!sp.production || (f.project_id ?? 'none') === sp.production) &&
    (!sp.kind || kindOf(f) === sp.kind) &&
    (sp.final !== '1' || f.is_final === true))

  const qs = (patch: Search) => {
    const next = { ...sp, ...patch }
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v)
    const s = p.toString()
    return s ? `/studio/suite/library?${s}` : '/studio/suite/library'
  }
  const chip = (on: boolean) =>
    `squircle-sm border px-2.5 py-1 text-[12px] outline-none transition-[border-color,color] duration-[--dur-pop] focus-visible:ring-2 focus-visible:ring-ring ${
      on ? 'border-[hsl(var(--glow)/0.55)] text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`

  const storageMeter = meterFor('storage.bytes')

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <h1 className="font-display text-[22px] font-semibold tracking-[-0.01em] text-foreground">
          Asset Library
        </h1>
        <p className="mt-0.5 text-[13px] text-faint">
          {all.length} file{all.length === 1 ? '' : 's'} · {size(totalBytes)} held
          {/* Honest about billing state: "not billed" rather than a $0.00 that
              reads as free. The day storage is charged this line changes and the
              footprint column below becomes the invoice. */}
          {storageMeter.rateCents === 0 && ' · storage not billed yet'}
        </p>
      </header>

      {/* ── the facets, every one addressable ───────────────────────────── */}
      <div className="mb-5 flex flex-wrap gap-1.5">
        <Link href={qs({ production: undefined, kind: undefined, final: undefined })} className={chip(!sp.production && !sp.kind && !sp.final)}>
          Everything
        </Link>
        <Link href={qs({ final: sp.final === '1' ? undefined : '1' })} className={chip(sp.final === '1')}>
          Final only
        </Link>
        {kinds.map((k) => (
          <Link key={k} href={qs({ kind: sp.kind === k ? undefined : k })} className={chip(sp.kind === k)}>
            {k}
          </Link>
        ))}
      </div>

      {/* ── footprint by production: the storage bill, before there is one ── */}
      {productions.length > 1 && (
        <section className="mb-6">
          <h2 className="mb-2 font-display text-[13px] font-semibold text-muted-foreground">
            Where the storage is
          </h2>
          <div className="squircle overflow-hidden border border-border bg-card">
            {productions.map(([key, p]) => {
              const pct = totalBytes > 0 ? Math.round((p.bytes / totalBytes) * 100) : 0
              return (
                <Link
                  key={key}
                  href={qs({ production: sp.production === key ? undefined : key })}
                  className={`flex items-center gap-3 border-b border-border px-4 py-2.5 outline-none transition-colors duration-[--dur-pop] last:border-b-0 focus-visible:ring-2 focus-visible:ring-ring ${
                    sp.production === key ? 'bg-secondary' : 'hover:bg-secondary/50'}`}
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{p.title}</span>
                  <span className="text-[11px] text-faint">{p.files} file{p.files === 1 ? '' : 's'}</span>
                  <span className="hidden w-24 sm:block">
                    <span className="block h-1 rounded-full bg-secondary">
                      <span className="block h-1 rounded-full bg-[hsl(var(--glow)/0.7)]" style={{ width: `${pct}%` }} />
                    </span>
                  </span>
                  <span className="w-16 text-right text-sm tabular-nums text-muted-foreground">{size(p.bytes)}</span>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 font-display text-[13px] font-semibold text-muted-foreground">
          {shown.length === all.length ? 'Everything' : `${shown.length} of ${all.length}`}
        </h2>
        {shown.length === 0 ? (
          // Says what the FILTER did, not what the reader lacks.
          <p className="text-[15px] text-muted-foreground">
            Nothing matches this view.{' '}
            <Link href="/studio/suite/library" className="underline underline-offset-4">Clear it</Link>.
          </p>
        ) : (
          <div className="squircle overflow-hidden border border-border bg-card">
            {shown.slice(0, 200).map((f) => (
              <div key={f.id} className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">{f.file_name}</span>
                  <span className="text-[10.5px] text-faint">
                    {prodTitle(f)} · {kindOf(f)}
                    {f.is_final && ' · final'}
                    {(f.version ?? 1) > 1 && ` · v${f.version}`}
                    {/* What clients actually pulled. Frame.io buries this; for a
                        studio it is the difference between delivered and seen. */}
                    {(f.download_count ?? 0) > 0 && ` · ${f.download_count} download${f.download_count === 1 ? '' : 's'}`}
                  </span>
                </span>
                <span className="flex-shrink-0 text-[11px] tabular-nums text-faint">{size(f.file_size ?? 0)}</span>
              </div>
            ))}
          </div>
        )}
        {shown.length > 200 && (
          <p className="mt-2 text-[11.5px] text-faint">Showing the 200 most recent of {shown.length}.</p>
        )}
      </section>
    </div>
  )
}
