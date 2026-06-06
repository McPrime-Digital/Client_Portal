'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus, Clapperboard, NotebookPen, ScrollText, Megaphone, FileText, Loader2,
  MoreVertical, LayoutGrid, List as ListIcon, Trash2, PencilLine, ChevronDown,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Doc = { id: string; title: string; preview: string | null; updated_at: string }
type TemplateKey = 'blank' | 'screenplay' | 'treatment' | 'brief' | 'ad'

const TEMPLATES: { key: TemplateKey; label: string; icon: typeof Plus; title: string }[] = [
  { key: 'blank', label: 'Blank', icon: Plus, title: 'Untitled' },
  { key: 'screenplay', label: 'Screenplay', icon: Clapperboard, title: 'Untitled Screenplay' },
  { key: 'treatment', label: 'Treatment', icon: NotebookPen, title: 'Untitled Treatment' },
  { key: 'brief', label: 'Concept Brief', icon: ScrollText, title: 'Untitled Brief' },
  { key: 'ad', label: 'Ad Script', icon: Megaphone, title: 'Untitled Ad Script' },
]

function rel(ts: string): string {
  const d = (Date.now() - new Date(ts).getTime()) / 1000
  if (d < 60) return 'just now'
  if (d < 3600) return `${Math.floor(d / 60)} min ago`
  if (d < 86400) return `${Math.floor(d / 3600)} hr ago`
  if (d < 604800) return `${Math.floor(d / 86400)} d ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/* ---- a sheet of paper: the shared page chrome for every thumbnail ---- */
function Paper({ children }: { children: React.ReactNode }) {
  return (
    <div className="aspect-[85/110] w-full overflow-hidden rounded-[3px] bg-white text-gray-800 shadow-[0_1px_3px_rgba(0,0,0,0.18)] ring-1 ring-black/5">
      <div className="h-full w-full origin-top-left p-[8%]">{children}</div>
    </div>
  )
}
function Bar({ w = '100%', tone = 'bg-gray-200' }: { w?: string; tone?: string }) {
  return <div className={`h-[3px] rounded-full ${tone}`} style={{ width: w }} />
}

function TemplateThumb({ kind }: { kind: TemplateKey }) {
  if (kind === 'blank') {
    return (
      <Paper>
        <div className="flex h-full items-center justify-center">
          <Plus size={26} strokeWidth={2.5} className="text-[#4285F4]" />
        </div>
      </Paper>
    )
  }
  if (kind === 'screenplay') {
    return (
      <Paper>
        <div className="space-y-[5px] text-[5px] leading-tight">
          <p className="text-right font-semibold tracking-wide">FADE IN:</p>
          <p className="font-bold">INT. STUDIO — DAY</p>
          <Bar w="100%" /><Bar w="88%" />
          <div className="mx-auto w-3/5 space-y-[3px] pt-[3px]">
            <p className="text-center font-bold">CHARACTER</p>
            <Bar w="100%" /><Bar w="70%" />
          </div>
          <div className="mx-auto w-3/5 space-y-[3px] pt-[2px]">
            <p className="text-center font-bold">CHARACTER</p>
            <Bar w="90%" />
          </div>
        </div>
      </Paper>
    )
  }
  if (kind === 'treatment') {
    return (
      <Paper>
        <div className="space-y-[4px] text-[6px] leading-tight">
          <p className="font-bold">Logline</p>
          <Bar w="92%" />
          <p className="pt-[3px] font-bold">Synopsis</p>
          <Bar /><Bar /><Bar w="80%" />
          <p className="pt-[3px] font-bold">Characters</p>
          <Bar w="60%" /><Bar w="55%" />
        </div>
      </Paper>
    )
  }
  if (kind === 'brief') {
    return (
      <Paper>
        <div className="space-y-[4px] text-[6px] leading-tight">
          <p className="font-bold">Concept Brief</p>
          <p className="pt-[2px] font-semibold text-gray-500">Objective</p>
          <Bar w="85%" />
          <p className="pt-[2px] font-semibold text-gray-500">Audience</p>
          <Bar w="70%" />
          <p className="pt-[2px] font-semibold text-gray-500">Deliverables</p>
          <Bar w="60%" /><Bar w="50%" />
        </div>
      </Paper>
    )
  }
  // ad
  return (
    <Paper>
      <div className="space-y-[4px] text-[6px] leading-tight">
        <p className="font-bold">Ad Script</p>
        <p className="pt-[2px] font-semibold text-gray-500">Hook (0–3s)</p>
        <Bar w="80%" />
        <p className="pt-[2px] font-semibold text-gray-500">Body</p>
        <Bar /><Bar w="75%" />
        <p className="pt-[2px] font-semibold text-gray-500">Call to action</p>
        <Bar w="55%" />
      </div>
    </Paper>
  )
}

function DocThumb({ preview }: { preview: string | null }) {
  const text = (preview ?? '').trim()
  if (!text) {
    // no cached preview yet (fills in on next open/save) — show a neutral page
    return (
      <Paper>
        <div className="space-y-[5px] pt-[2px]">
          <Bar w="55%" tone="bg-gray-200" />
          <div className="pt-[3px]" />
          <Bar /><Bar w="96%" /><Bar w="90%" /><Bar w="93%" /><Bar w="60%" />
        </div>
      </Paper>
    )
  }
  const [head, ...rest] = text.split('\n')
  return (
    <Paper>
      <div className="space-y-[3px]">
        <p className="line-clamp-2 text-[7px] font-bold leading-tight text-gray-900">{head}</p>
        <p className="line-clamp-[16] whitespace-pre-wrap break-words text-[6px] leading-[1.5] text-gray-600">
          {rest.join('\n')}
        </p>
      </div>
    </Paper>
  )
}

export default function ScriptHome() {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [docs, setDocs] = useState<Doc[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [menuFor, setMenuFor] = useState<string | null>(null)

  const load = useMemo(
    () => async () => {
      const { data, error: e } = await supabase
        .from('documents')
        .select('id, title, preview, updated_at')
        .eq('kind', 'script')
        .order('updated_at', { ascending: false })
      if (e) setError(e.message)
      setDocs((data as Doc[] | null) ?? [])
    },
    [supabase],
  )

  useEffect(() => {
    void load()
    const ch = supabase
      .channel('docs-home')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documents', filter: 'kind=eq.script' }, () => void load())
      .subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [supabase, load])

  async function create(templateKey: string, title: string) {
    setCreating(true)
    const { data, error: e } = await supabase
      .from('documents')
      .insert({ kind: 'script', title })
      .select('id')
      .single()
    if (e || !data) {
      setError(e?.message ?? 'Could not create document')
      setCreating(false)
      return
    }
    const tpl = templateKey && templateKey !== 'blank' ? `&template=${templateKey}` : ''
    router.push(`/studio/workspace/script?doc=${data.id}${tpl}`)
  }

  async function rename(d: Doc) {
    setMenuFor(null)
    const next = window.prompt('Rename document', d.title || 'Untitled')?.trim()
    if (next === undefined || next === '' || next === d.title) return
    await supabase.from('documents').update({ title: next }).eq('id', d.id)
    void load()
  }
  async function remove(d: Doc) {
    setMenuFor(null)
    if (!window.confirm(`Delete “${d.title || 'Untitled'}”? This can’t be undone.`)) return
    await supabase.from('documents').delete().eq('id', d.id)
    void load()
  }
  const open = (id: string) => router.push(`/studio/workspace/script?doc=${id}`)

  return (
    <div className="mx-auto max-w-6xl">
      {/* Start a new document */}
      <div className="mb-3 flex items-end justify-between">
        <h2 className="text-sm font-semibold text-foreground">Start a new document</h2>
      </div>
      <div className="grid grid-cols-3 gap-x-5 gap-y-3 sm:grid-cols-4 lg:grid-cols-6">
        {TEMPLATES.map((t) => (
          <button key={t.key} onClick={() => create(t.key, t.title)} disabled={creating} className="group text-left">
            <div className="rounded-[3px] transition-all group-hover:-translate-y-0.5">
              <div className="rounded-[3px] ring-1 ring-transparent transition-all group-hover:ring-2 group-hover:ring-primary">
                <TemplateThumb kind={t.key} />
              </div>
            </div>
            <p className="mt-2 px-0.5 text-[13px] font-medium text-foreground">{t.label}</p>
          </button>
        ))}
      </div>

      {/* Recent documents */}
      <div className="mt-10 mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">Recent documents</h2>
          {creating && <Loader2 size={13} className="animate-spin text-muted-foreground" />}
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
            Last opened by me <ChevronDown size={13} />
          </button>
          <div className="flex items-center rounded-lg border border-border p-0.5">
            <button
              onClick={() => setView('grid')}
              title="Grid"
              className={`grid h-6 w-6 place-items-center rounded-md transition-colors ${view === 'grid' ? 'bg-secondary text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <LayoutGrid size={14} />
            </button>
            <button
              onClick={() => setView('list')}
              title="List"
              className={`grid h-6 w-6 place-items-center rounded-md transition-colors ${view === 'list' ? 'bg-secondary text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <ListIcon size={14} />
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-destructive/40 bg-card p-4 text-sm text-destructive">{error}</div>
      )}

      {docs === null ? (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : docs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          No documents yet — start one above.
        </div>
      ) : view === 'grid' ? (
        <div className="grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {docs.map((d) => (
            <div key={d.id} className="group">
              <button onClick={() => open(d.id)} className="block w-full text-left">
                <div className="rounded-[3px] ring-1 ring-transparent transition-all group-hover:-translate-y-0.5 group-hover:ring-2 group-hover:ring-primary">
                  <DocThumb preview={d.preview} />
                </div>
              </button>
              <div className="mt-2 flex items-start gap-1.5">
                <FileText size={15} className="mt-0.5 flex-shrink-0 text-[#4285F4]" />
                <div className="min-w-0 flex-1">
                  <button onClick={() => open(d.id)} className="block w-full truncate text-left text-[13px] font-medium text-foreground hover:underline">
                    {d.title || 'Untitled'}
                  </button>
                  <p className="text-[11px] text-muted-foreground">Opened {rel(d.updated_at)}</p>
                </div>
                <div className="relative">
                  <button
                    onClick={() => setMenuFor((m) => (m === d.id ? null : d.id))}
                    className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground opacity-0 transition-all hover:bg-secondary group-hover:opacity-100"
                    title="More"
                  >
                    <MoreVertical size={15} />
                  </button>
                  {menuFor === d.id && (
                    <>
                      <button aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setMenuFor(null)} />
                      <div className="absolute right-0 top-full z-20 mt-1 w-36 overflow-hidden rounded-xl border border-border bg-card py-1 shadow-2xl">
                        <button onClick={() => rename(d)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-foreground hover:bg-secondary">
                          <PencilLine size={14} /> Rename
                        </button>
                        <button onClick={() => remove(d)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-destructive hover:bg-destructive/10">
                          <Trash2 size={14} /> Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border">
          <div className="flex items-center gap-3 border-b border-border bg-secondary/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span className="flex-1">Name</span>
            <span className="w-28">Opened</span>
            <span className="w-8" />
          </div>
          {docs.map((d) => (
            <div key={d.id} className="group flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-0 hover:bg-secondary/40">
              <FileText size={16} className="flex-shrink-0 text-[#4285F4]" />
              <button onClick={() => open(d.id)} className="flex-1 truncate text-left text-sm font-medium text-foreground hover:underline">
                {d.title || 'Untitled'}
              </button>
              <span className="w-28 text-xs text-muted-foreground">{rel(d.updated_at)}</span>
              <div className="relative w-8">
                <button
                  onClick={() => setMenuFor((m) => (m === d.id ? null : d.id))}
                  className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary"
                  title="More"
                >
                  <MoreVertical size={15} />
                </button>
                {menuFor === d.id && (
                  <>
                    <button aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setMenuFor(null)} />
                    <div className="absolute right-0 top-full z-20 mt-1 w-36 overflow-hidden rounded-xl border border-border bg-card py-1 shadow-2xl">
                      <button onClick={() => rename(d)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-foreground hover:bg-secondary">
                        <PencilLine size={14} /> Rename
                      </button>
                      <button onClick={() => remove(d)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-destructive hover:bg-destructive/10">
                        <Trash2 size={14} /> Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
