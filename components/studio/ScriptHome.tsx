'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Plus, Clapperboard, NotebookPen, ScrollText, Megaphone, FileText, Loader2,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Doc = { id: string; title: string; updated_at: string }

const TEMPLATES = [
  { key: 'blank', label: 'Blank', icon: Plus, title: 'Untitled' },
  { key: 'screenplay', label: 'Screenplay', icon: Clapperboard, title: 'Untitled Screenplay' },
  { key: 'treatment', label: 'Treatment', icon: NotebookPen, title: 'Untitled Treatment' },
  { key: 'brief', label: 'Concept Brief', icon: ScrollText, title: 'Untitled Brief' },
  { key: 'ad', label: 'Ad Script', icon: Megaphone, title: 'Untitled Ad Script' },
]

function rel(ts: string): string {
  const d = (Date.now() - new Date(ts).getTime()) / 1000
  if (d < 60) return 'just now'
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`
  if (d < 604800) return `${Math.floor(d / 86400)}d ago`
  return new Date(ts).toLocaleDateString()
}

export default function ScriptHome() {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [docs, setDocs] = useState<Doc[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error: e } = await supabase
        .from('documents')
        .select('id, title, updated_at')
        .eq('kind', 'script')
        .order('updated_at', { ascending: false })
      if (cancelled) return
      if (e) setError(e.message)
      setDocs(data ?? [])
    })()
    return () => {
      cancelled = true
    }
  }, [supabase])

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

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-7">
        <h1 className="font-display text-2xl font-semibold text-foreground">Script Design</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Concept · narrative · script — drafted live with your crew (Co-Direction).
        </p>
      </div>

      {/* Start a new document */}
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-faint">Start a new document</p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {TEMPLATES.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.key}
              onClick={() => create(t.key, t.title)}
              disabled={creating}
              className="group flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg disabled:opacity-60"
            >
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-secondary text-primary transition-colors group-hover:bg-primary/15">
                <Icon size={22} />
              </span>
              <span className="text-xs font-semibold text-foreground">{t.label}</span>
            </button>
          )
        })}
      </div>

      {/* Recent documents */}
      <div className="mt-9 mb-3 flex items-center gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-faint">Recent documents</p>
        {creating && <Loader2 size={13} className="animate-spin text-muted-foreground" />}
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/40 bg-card p-4 text-sm text-destructive">{error}</div>
      )}

      {docs === null ? (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : docs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No documents yet — start one above.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {docs.map((d) => (
            <Link
              key={d.id}
              href={`/studio/workspace/script?doc=${d.id}`}
              className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"
            >
              <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-secondary text-primary">
                <FileText size={18} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-foreground">{d.title || 'Untitled'}</span>
                <span className="block text-xs text-muted-foreground">Edited {rel(d.updated_at)}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
