'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, Film, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Board = { id: string; title: string; updated_at: string; shots: { count: number }[] }

function rel(ts: string): string {
  const d = (Date.now() - new Date(ts).getTime()) / 1000
  if (d < 60) return 'just now'
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`
  if (d < 604800) return `${Math.floor(d / 86400)}d ago`
  return new Date(ts).toLocaleDateString()
}

export default function StoryboardHome() {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [boards, setBoards] = useState<Board[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error: e } = await supabase
        .from('storyboards')
        .select('id, title, updated_at, shots:storyboard_shots(count)')
        .order('updated_at', { ascending: false })
      if (cancelled) return
      if (e) setError(e.message)
      setBoards((data as Board[] | null) ?? [])
    })()
    return () => {
      cancelled = true
    }
  }, [supabase])

  async function create() {
    setCreating(true)
    const { data, error: e } = await supabase
      .from('storyboards')
      .insert({ title: 'Untitled board' })
      .select('id')
      .single()
    if (e || !data) {
      setError(e?.message ?? 'Could not create board')
      setCreating(false)
      return
    }
    router.push(`/studio/suite/storyboard?board=${data.id}`)
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-7 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">Storyboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Block the film shot by shot — type, action, and the prompt each frame is built from.
          </p>
        </div>
        <button
          onClick={create}
          disabled={creating}
          className="inline-flex flex-shrink-0 items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={16} />} New board
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-destructive/40 bg-card p-4 text-sm text-destructive">{error}</div>
      )}

      {boards === null ? (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : boards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No storyboards yet — start one above.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {boards.map((b) => (
            <Link
              key={b.id}
              href={`/studio/suite/storyboard?board=${b.id}`}
              className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"
            >
              <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-secondary text-primary">
                <Film size={18} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-foreground">{b.title || 'Untitled board'}</span>
                <span className="block text-xs text-muted-foreground">
                  {(b.shots?.[0]?.count ?? 0)} shot{(b.shots?.[0]?.count ?? 0) === 1 ? '' : 's'} · {rel(b.updated_at)}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
