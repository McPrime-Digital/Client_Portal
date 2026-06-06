'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import * as Y from 'yjs'
import {
  Plus, FileText, Loader2, MoreVertical, LayoutGrid, List as ListIcon,
  Trash2, PencilLine, ChevronDown, LayoutTemplate, X,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { fromB64 } from '@/lib/collab/supabaseYjs'

type Doc = { id: string; title: string; ydoc: string | null; updated_at: string; last_opened_at: string | null }

// Definitive first-page preview: decode the stored Yjs snapshot and extract the
// document's leading text — works for any doc, no cached column required.
function previewFromYdoc(b64: string | null): string {
  if (!b64) return ''
  try {
    const d = new Y.Doc()
    Y.applyUpdate(d, fromB64(b64))
    let xml = d.getXmlFragment('blocknote').toString()
    d.destroy()
    xml = xml.replace(/<\/blockContainer>/g, '\n') // one line per block
    return xml
      .replace(/<[^>]+>/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{2,}/g, '\n')
      .trim()
      .slice(0, 700)
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
// Bespoke SVG "cover photos" so image templates read like real designed covers.
function CoverArt({ scene }: { scene: Scene }) {
  if (scene === 'film') {
    return (
      <svg viewBox="0 0 100 130" preserveAspectRatio="xMidYMid slice" className="h-full w-full">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f59e0b" /><stop offset="0.5" stopColor="#db2777" /><stop offset="1" stopColor="#4c1d95" />
          </linearGradient>
        </defs>
        <rect width="100" height="130" fill="url(#sky)" />
        <circle cx="50" cy="44" r="15" fill="#fff" opacity="0.85" />
        <path d="M0 95 L22 70 L40 90 L60 62 L80 88 L100 72 L100 130 L0 130 Z" fill="#1f2937" />
        <path d="M0 110 L30 92 L55 108 L78 95 L100 110 L100 130 L0 130 Z" fill="#0f172a" />
        <g fill="#0f172a">
          <rect x="0" y="0" width="6" height="130" /><rect x="94" y="0" width="6" height="130" />
        </g>
        <g fill="#fff" opacity="0.9">
          {[8, 24, 40, 56, 72, 88, 104, 120].map((y) => (<g key={y}><rect x="1.5" y={y} width="3" height="6" rx="0.6" /><rect x="95.5" y={y} width="3" height="6" rx="0.6" /></g>))}
        </g>
      </svg>
    )
  }
  if (scene === 'sunset') {
    return (
      <svg viewBox="0 0 100 130" preserveAspectRatio="xMidYMid slice" className="h-full w-full">
        <defs>
          <linearGradient id="ss" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#db2777" /><stop offset="0.5" stopColor="#f97316" /><stop offset="1" stopColor="#facc15" />
          </linearGradient>
        </defs>
        <rect width="100" height="130" fill="url(#ss)" />
        <circle cx="68" cy="36" r="40" fill="#fff" opacity="0.18" />
        <circle cx="68" cy="36" r="24" fill="#fff" opacity="0.25" />
        <path d="M0 96 C30 80 70 112 100 90 L100 130 L0 130 Z" fill="#7c2d12" opacity="0.55" />
      </svg>
    )
  }
  if (scene === 'spotlight') {
    return (
      <svg viewBox="0 0 100 130" preserveAspectRatio="xMidYMid slice" className="h-full w-full">
        <defs>
          <radialGradient id="sp" cx="0.5" cy="0.35" r="0.7">
            <stop offset="0" stopColor="#0f766e" /><stop offset="1" stopColor="#042f2e" />
          </radialGradient>
        </defs>
        <rect width="100" height="130" fill="url(#sp)" />
        <circle cx="50" cy="40" r="26" fill="#fff" opacity="0.10" />
        <g transform="translate(34 60)" fill="#0b1f1d" stroke="#5eead4" strokeWidth="0.8">
          <rect x="0" y="6" width="32" height="20" rx="1.5" />
          <path d="M0 6 L32 1 L32 7 L0 12 Z" fill="#5eead4" stroke="none" opacity="0.85" />
          <g fill="#0b1f1d"><rect x="3" y="1.5" width="6" height="5" transform="rotate(-9 6 4)" /><rect x="13" y="0.4" width="6" height="5" transform="rotate(-9 16 3)" /></g>
        </g>
      </svg>
    )
  }
  // mesh
  return (
    <svg viewBox="0 0 100 130" preserveAspectRatio="xMidYMid slice" className="h-full w-full">
      <defs>
        <filter id="b"><feGaussianBlur stdDeviation="9" /></filter>
      </defs>
      <rect width="100" height="130" fill="#0e7490" />
      <g filter="url(#b)">
        <circle cx="20" cy="30" r="30" fill="#22d3ee" />
        <circle cx="80" cy="50" r="34" fill="#6366f1" />
        <circle cx="45" cy="105" r="32" fill="#0ea5e9" />
        <circle cx="90" cy="115" r="22" fill="#a78bfa" />
      </g>
    </svg>
  )
}

// Real template "cover pages" — distinct designed layouts per template type.
const COVER = 'aspect-[85/110] w-full overflow-hidden rounded-[3px] shadow-[0_1px_3px_rgba(0,0,0,0.18)] ring-1 ring-black/5'
function CoverThumb({ label, color, style, scene }: { label: string; color: string; style: CoverStyle; scene?: Scene }) {
  if (style === 'image') {
    return (
      <div className={`${COVER} relative`}>
        <CoverArt scene={scene ?? 'mesh'} />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-2 pb-1.5 pt-4">
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

function DocThumb({ text: raw }: { text: string }) {
  const text = (raw ?? '').trim()
  if (!text) {
    // genuinely empty document — show a neutral page
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
  const [galleryOpen, setGalleryOpen] = useState(false)
  const previews = useMemo(() => {
    const m: Record<string, string> = {}
    ;(docs ?? []).forEach((d) => { m[d.id] = previewFromYdoc(d.ydoc) })
    return m
  }, [docs])

  const load = useMemo(
    () => async () => {
      const res = await supabase
        .from('documents')
        .select('id, title, ydoc, updated_at, last_opened_at')
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
        .select('id, title, ydoc, updated_at')
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
        {/* Featured templates */}
        {TEMPLATES.filter((t) => FEATURED.includes(t.key)).map((t) => (
          <button key={t.key} onClick={() => create(t.key, t.title)} disabled={creating} className="group text-left">
            <div className="rounded-[3px] ring-1 ring-transparent transition-all group-hover:-translate-y-0.5 group-hover:ring-2 group-hover:ring-primary">
              <CoverThumb label={t.label} color={t.color} style={t.style} scene={t.scene} />
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
                  <DocThumb text={previews[d.id] ?? ''} />
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
                    <CoverThumb label={t.label} color={t.color} style={t.style} scene={t.scene} />
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
