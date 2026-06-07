'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import * as Y from 'yjs'
import {
  Plus, FileText, Loader2, MoreVertical, LayoutGrid, List as ListIcon,
  Trash2, PencilLine, ChevronDown, LayoutTemplate, X,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { fromB64 } from '@/lib/collab/supabaseYjs'

type Doc = { id: string; title: string; preview: string | null; ydoc: string | null; updated_at: string; last_opened_at: string | null }

// Definitive first-page preview: decode the stored Yjs snapshot and walk its text
// nodes (via deltas, so marks/nesting are handled) — works for any doc, no cached
// column, no fragile tag-stripping.
const BLOCK_NODE = /^(paragraph|heading|bulletListItem|numberedListItem|checkListItem|toggleListItem|quote|codeBlock|blockContainer|tableCell)$/i
function previewFromYdoc(b64: string | null): string {
  if (!b64) return ''
  try {
    const d = new Y.Doc()
    Y.applyUpdate(d, fromB64(b64))
    const out: string[] = []
    const walk = (node: unknown) => {
      const n = node as { toDelta?: () => { insert?: unknown }[]; toArray?: () => unknown[]; nodeName?: string }
      // leaf text node (Y.XmlText) — has toDelta but not toArray
      if (n && typeof n.toDelta === 'function' && typeof n.toArray !== 'function') {
        const text = n.toDelta().map((op) => (typeof op.insert === 'string' ? op.insert : '')).join('')
        if (text) out.push(text)
        return
      }
      const children = n && typeof n.toArray === 'function' ? n.toArray() : []
      for (const c of children) walk(c)
      if (n?.nodeName && BLOCK_NODE.test(n.nodeName)) out.push('\n')
    }
    walk(d.getXmlFragment('blocknote'))
    d.destroy()
    return out.join('').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim().slice(0, 700)
  } catch {
    return ''
  }
}
type CoverStyle = 'centered' | 'banner' | 'sidebar' | 'table' | 'image'
type Scene = 'film' | 'mesh' | 'sunset' | 'spotlight'
type Template = { key: string; label: string; color: string; title: string; style: CoverStyle; scene?: Scene }

const TEMPLATES: Template[] = [
  { key: 'screenplay', label: 'Screenplay', color: '#3b3a78', title: 'Untitled Screenplay', style: 'image', scene: 'film' },
  { key: 'treatment', label: 'Treatment', color: '#0e7490', title: 'Untitled Treatment', style: 'image', scene: 'mesh' },
  { key: 'brief', label: 'Concept Brief', color: '#b45309', title: 'Untitled Brief', style: 'sidebar' },
  { key: 'ad', label: 'Ad Script', color: '#be123c', title: 'Untitled Ad Script', style: 'banner' },
  { key: 'shotlist', label: 'Shot List', color: '#15803d', title: 'Untitled Shot List', style: 'table' },
  { key: 'callsheet', label: 'Call Sheet', color: '#1d4ed8', title: 'Untitled Call Sheet', style: 'table' },
  { key: 'voiceover', label: 'Voiceover', color: '#7c3aed', title: 'Untitled VO Script', style: 'banner' },
  { key: 'pitch', label: 'Pitch', color: '#db2777', title: 'Untitled Pitch', style: 'image', scene: 'sunset' },
  { key: 'directors', label: "Director's Statement", color: '#0f766e', title: "Director's Statement", style: 'image', scene: 'spotlight' },
  { key: 'beatsheet', label: 'Beat Sheet', color: '#c2410c', title: 'Untitled Beat Sheet', style: 'table' },
  { key: 'character', label: 'Character Bible', color: '#4338ca', title: 'Character Bible', style: 'sidebar' },
]
const FEATURED = ['screenplay', 'treatment', 'brief', 'ad']

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

function BlankThumb() {
  return (
    <Paper>
      <div className="flex h-full items-center justify-center">
        <Plus size={26} strokeWidth={2.5} className="text-[#4285F4]" />
      </div>
    </Paper>
  )
}
// Real photographic cover (reliable image CDN) with a premium duotone treatment,
// so image templates read like real designed covers — with a gradient fallback.
function CoverArt({ seed, color }: { seed: string; color: string }) {
  return (
    <div className="absolute inset-0" style={{ background: `linear-gradient(150deg, ${color}, #0b1020)` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://picsum.photos/seed/tl-${seed}/320/420`}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover"
      />
      <div className="absolute inset-0 mix-blend-multiply" style={{ background: color, opacity: 0.5 }} />
      <div className="absolute inset-0" style={{ background: `linear-gradient(160deg, transparent 28%, ${color}cc)` }} />
    </div>
  )
}

// Real template "cover pages" — distinct designed layouts per template type.
const COVER = 'aspect-[85/110] w-full overflow-hidden rounded-[3px] shadow-[0_1px_3px_rgba(0,0,0,0.18)] ring-1 ring-black/5'
function CoverThumb({ label, color, style, seed }: { label: string; color: string; style: CoverStyle; seed?: string }) {
  if (style === 'image') {
    return (
      <div className={`${COVER} relative`}>
        <CoverArt seed={seed ?? label} color={color} />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-2 pb-1.5 pt-5">
          <span className="text-[8px] font-bold leading-tight text-white drop-shadow">{label}</span>
        </div>
      </div>
    )
  }
  if (style === 'centered') {
    return (
      <div className={`${COVER} flex flex-col items-center justify-center gap-[6px] px-3`} style={{ background: color }}>
        <div className="h-px w-7 bg-white/50" />
        <span className="text-center text-[9px] font-bold uppercase leading-tight tracking-wide text-white">{label}</span>
        <div className="h-px w-7 bg-white/50" />
        <span className="mt-[3px] text-[5px] uppercase tracking-widest text-white/70">written by</span>
      </div>
    )
  }
  if (style === 'sidebar') {
    return (
      <div className={`${COVER} flex bg-white`}>
        <div className="flex w-[32%] items-start p-1.5" style={{ background: color }}>
          <span className="text-[7px] font-bold leading-tight text-white">{label}</span>
        </div>
        <div className="flex-1 space-y-[4px] p-2">
          <Bar w="80%" /><Bar /><Bar w="70%" /><Bar w="85%" />
          <div className="pt-[2px]" />
          <Bar w="60%" /><Bar w="78%" />
        </div>
      </div>
    )
  }
  if (style === 'table') {
    return (
      <div className={`${COVER} bg-white`}>
        <div className="px-2 py-1.5 text-[8px] font-bold text-white" style={{ background: color }}>{label}</div>
        <div className="space-y-[3px] p-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-[3px]">
              <div className="h-[5px] w-[22%] rounded-sm" style={{ background: `${color}33` }} />
              <div className="h-[5px] flex-1 rounded-sm bg-gray-100" />
              <div className="h-[5px] w-[18%] rounded-sm bg-gray-100" />
            </div>
          ))}
        </div>
      </div>
    )
  }
  // banner
  return (
    <div className={`${COVER} bg-white`}>
      <div className="flex h-[38%] items-end p-2" style={{ background: color }}>
        <span className="text-[8px] font-bold leading-tight text-white">{label}</span>
      </div>
      <div className="space-y-[4px] p-2">
        <Bar w="92%" /><Bar /><Bar w="80%" /><Bar w="88%" /><Bar w="55%" />
        <div className="pt-[2px]" />
        <Bar w="72%" />
      </div>
    </div>
  )
}

/* Renders the document's real first page (stored HTML) inside the thumbnail card,
   at true page geometry (816px wide, 1in margins) then uniformly scaled down so it
   reads exactly like the live page — enterprise-grade WYSIWYG, not tiny placeholder
   text. The card clips to the top of the page (aspect 85/110 ≈ US-Letter top). */
function ScaledPage({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setScale(el.clientWidth / 816)
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [])
  return (
    <div
      ref={ref}
      className="aspect-[85/110] w-full overflow-hidden rounded-[3px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.18)] ring-1 ring-black/5"
    >
      {scale > 0 && (
        <div style={{ width: 816, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          <div className="tl-thumb" style={{ padding: '72px 88px', minHeight: 1056 }} dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      )}
    </div>
  )
}

function DocThumb({ html, text: raw }: { html: string; text: string }) {
  if (html && html.includes('<')) return <ScaledPage html={html} />
  const text = (raw ?? '').trim()
  if (!text) {
    // genuinely empty document — a truly blank page
    return <Paper><span className="sr-only">Blank document</span></Paper>
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
  const [galleryOpen, setGalleryOpen] = useState(false)
  const previews = useMemo(() => {
    const m: Record<string, { html: string; text: string }> = {}
    ;(docs ?? []).forEach((d) => {
      // Prefer the stored first-page HTML snapshot (real WYSIWYG). Fall back to the
      // Yjs-decoded plain text for docs saved before the snapshot existed.
      const html = d.preview && d.preview.includes('<') ? d.preview : ''
      const text = html ? '' : (d.preview || previewFromYdoc(d.ydoc))
      m[d.id] = { html, text }
    })
    return m
  }, [docs])

  // Featured-template order (drag to rearrange), remembered.
  const [order, setOrder] = useState<string[]>(FEATURED)
  useEffect(() => {
    try {
      const v = localStorage.getItem('tl-tplorder')
      if (v) { const a = JSON.parse(v); if (Array.isArray(a)) setOrder(a) }
    } catch { /* ignore */ }
  }, [])
  const dragKey = useRef<string | null>(null)
  const featuredList = useMemo(() => {
    const keys = [...order.filter((k) => FEATURED.includes(k)), ...FEATURED.filter((k) => !order.includes(k))]
    return keys.map((k) => TEMPLATES.find((t) => t.key === k)).filter(Boolean) as Template[]
  }, [order])
  function reorder(to: string) {
    const from = dragKey.current
    dragKey.current = null
    if (!from || from === to) return
    setOrder(() => {
      const merged = [...featuredList.map((t) => t.key)]
      const next = merged.filter((k) => k !== from)
      const idx = next.indexOf(to)
      next.splice(idx < 0 ? next.length : idx, 0, from)
      try { localStorage.setItem('tl-tplorder', JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  const load = useMemo(
    () => async () => {
      const res = await supabase
        .from('documents')
        .select('id, title, preview, ydoc, updated_at, last_opened_at')
        .eq('kind', 'script')
        .order('last_opened_at', { ascending: false, nullsFirst: false })
        .order('updated_at', { ascending: false })
        .limit(60)
      if (!res.error) {
        setDocs((res.data as Doc[] | null) ?? [])
        return
      }
      // migration 0009 (last_opened_at) not applied yet — degrade gracefully (by edit time)
      const fb = await supabase
        .from('documents')
        .select('id, title, preview, ydoc, updated_at')
        .eq('kind', 'script')
        .order('updated_at', { ascending: false })
        .limit(60)
      if (fb.error) {
        setError(fb.error.message)
        setDocs([])
        return
      }
      setDocs((fb.data ?? []).map((d) => ({ ...d, last_opened_at: null })) as Doc[])
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
    <div>
      {/* Start a new document — full-width deeper band, like Google Docs */}
      <div className="-mx-6 -mt-6 mb-8 bg-secondary/40 px-6 py-6 lg:-mx-8 lg:-mt-8 lg:px-8">
        <div className="mx-auto max-w-6xl">
      <div className="mb-3 flex items-end justify-between">
        <h2 className="text-sm font-semibold text-foreground">Start a new document</h2>
        <button
          onClick={() => setGalleryOpen(true)}
          className="flex items-center gap-1 text-xs font-medium text-primary transition-opacity hover:opacity-80"
        >
          Template gallery <LayoutTemplate size={13} />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-x-5 gap-y-3 sm:grid-cols-4 lg:grid-cols-6">
        {/* Blank */}
        <button onClick={() => create('blank', 'Untitled')} disabled={creating} className="group text-left">
          <div className="rounded-[3px] ring-1 ring-transparent transition-all group-hover:-translate-y-0.5 group-hover:ring-2 group-hover:ring-primary">
            <BlankThumb />
          </div>
          <p className="mt-2 px-0.5 text-[13px] font-medium text-foreground">Blank</p>
        </button>
        {/* Featured templates — drag to rearrange */}
        {featuredList.map((t) => (
          <button
            key={t.key}
            draggable
            onDragStart={() => { dragKey.current = t.key }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); reorder(t.key) }}
            onClick={() => create(t.key, t.title)}
            disabled={creating}
            className="group cursor-grab text-left active:cursor-grabbing"
          >
            <div className="rounded-[3px] ring-1 ring-transparent transition-all group-hover:-translate-y-0.5 group-hover:ring-2 group-hover:ring-primary">
              <CoverThumb label={t.label} color={t.color} style={t.style} seed={t.key} />
            </div>
            <p className="mt-2 truncate px-0.5 text-[13px] font-medium text-foreground">{t.label}</p>
          </button>
        ))}
        {/* More → gallery */}
        <button onClick={() => setGalleryOpen(true)} className="group text-left">
          <div className="flex aspect-[85/110] w-full items-center justify-center rounded-[3px] border-2 border-dashed border-border transition-all group-hover:-translate-y-0.5 group-hover:border-primary">
            <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
              <LayoutTemplate size={22} />
              <span className="text-[10px] font-semibold">More</span>
            </div>
          </div>
          <p className="mt-2 px-0.5 text-[13px] font-medium text-foreground">Template gallery</p>
        </button>
      </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl">
      {/* Recent documents */}
      <div className="mb-3 flex items-center justify-between">
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
                  <DocThumb html={previews[d.id]?.html ?? ''} text={previews[d.id]?.text ?? ''} />
                </div>
              </button>
              <div className="mt-2 flex items-start gap-1.5">
                <FileText size={15} className="mt-0.5 flex-shrink-0 text-[#4285F4]" />
                <div className="min-w-0 flex-1">
                  <button onClick={() => open(d.id)} className="block w-full truncate text-left text-[13px] font-medium text-foreground hover:underline">
                    {d.title || 'Untitled'}
                  </button>
                  <p className="text-[11px] text-muted-foreground">Opened {rel(d.last_opened_at ?? d.updated_at)}</p>
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
              <span className="w-28 text-xs text-muted-foreground">{rel(d.last_opened_at ?? d.updated_at)}</span>
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

      {galleryOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <button aria-hidden tabIndex={-1} className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setGalleryOpen(false)} />
          <div className="relative flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h3 className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
                <LayoutTemplate size={18} className="text-primary" /> Template gallery
              </h3>
              <button onClick={() => setGalleryOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-x-5 gap-y-5 overflow-y-auto p-6 sm:grid-cols-3 lg:grid-cols-4">
              <button onClick={() => { setGalleryOpen(false); create('blank', 'Untitled') }} className="group text-left">
                <div className="rounded-[3px] ring-1 ring-transparent transition-all group-hover:-translate-y-0.5 group-hover:ring-2 group-hover:ring-primary">
                  <BlankThumb />
                </div>
                <p className="mt-2 text-[13px] font-medium text-foreground">Blank</p>
              </button>
              {TEMPLATES.map((t) => (
                <button key={t.key} onClick={() => { setGalleryOpen(false); create(t.key, t.title) }} className="group text-left">
                  <div className="rounded-[3px] ring-1 ring-transparent transition-all group-hover:-translate-y-0.5 group-hover:ring-2 group-hover:ring-primary">
                    <CoverThumb label={t.label} color={t.color} style={t.style} seed={t.key} />
                  </div>
                  <p className="mt-2 truncate text-[13px] font-medium text-foreground">{t.label}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
