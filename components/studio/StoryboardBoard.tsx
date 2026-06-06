'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2, ChevronLeft, ChevronRight, ImageIcon, Loader2, Sparkles, Aperture } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import PrimeOSAssistant from './PrimeOSAssistant'

type MuseField = { shotId: string; field: 'description' | 'prompt'; text: string; rect: DOMRect | null; isLight: boolean }

type Shot = {
  id: string
  idx: number
  title: string
  shot_type: string | null
  description: string | null
  prompt: string | null
  image_key: string | null
}

const SHOT_TYPES = ['', 'EST', 'WIDE', 'MED', 'CU', 'ECU', 'OTS', 'POV', 'INSERT', 'AERIAL']

export default function StoryboardBoard({ boardId }: { boardId: string }) {
  const supabase = useMemo(() => createClient(), [])
  const [title, setTitle] = useState('')
  const [shots, setShots] = useState<Shot[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const loadShots = useMemo(
    () => async () => {
      const { data } = await supabase
        .from('storyboard_shots')
        .select('id, idx, title, shot_type, description, prompt, image_key')
        .eq('storyboard_id', boardId)
        .order('idx', { ascending: true })
      setShots((data as Shot[] | null) ?? [])
    },
    [supabase, boardId],
  )

  // initial load (board title + shots)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: board, error: e } = await supabase
        .from('storyboards')
        .select('id, title')
        .eq('id', boardId)
        .single()
      if (cancelled) return
      if (e) {
        setError(e.message)
        setShots([])
        return
      }
      setTitle(board?.title ?? 'Untitled board')
      await loadShots()
    })()
    return () => {
      cancelled = true
    }
  }, [supabase, boardId, loadShots])

  // realtime: shots change → refetch
  useEffect(() => {
    const ch = supabase
      .channel(`storyboard:${boardId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'storyboard_shots', filter: `storyboard_id=eq.${boardId}` },
        () => void loadShots(),
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [supabase, boardId, loadShots])

  // persist title (debounced)
  useEffect(() => {
    if (shots === null) return
    const t = setTimeout(() => {
      void supabase
        .from('storyboards')
        .update({ title: title.trim() || 'Untitled board', updated_at: new Date().toISOString() })
        .eq('id', boardId)
    }, 600)
    return () => clearTimeout(t)
  }, [title, shots, supabase, boardId])

  const patchLocal = (id: string, patch: Partial<Shot>) =>
    setShots((prev) => (prev ? prev.map((s) => (s.id === id ? { ...s, ...patch } : s)) : prev))
  const saveShot = (id: string, patch: Partial<Shot>) =>
    supabase.from('storyboard_shots').update(patch).eq('id', id)

  const addShot = async () => {
    setBusy(true)
    const list = shots ?? []
    const idx = list.length ? Math.max(...list.map((s) => s.idx)) + 1 : 0
    await supabase.from('storyboard_shots').insert({ storyboard_id: boardId, idx, title: '' })
    await loadShots()
    setBusy(false)
  }
  const move = async (shot: Shot, dir: 'left' | 'right') => {
    const list = [...(shots ?? [])].sort((a, b) => a.idx - b.idx)
    const i = list.findIndex((s) => s.id === shot.id)
    const j = dir === 'left' ? i - 1 : i + 1
    if (j < 0 || j >= list.length) return
    const a = list[i]
    const b = list[j]
    await Promise.all([saveShot(a.id, { idx: b.idx }), saveShot(b.id, { idx: a.idx })])
    await loadShots()
  }
  const del = async (id: string) => {
    if (!window.confirm('Delete this shot?')) return
    await supabase.from('storyboard_shots').delete().eq('id', id)
    await loadShots()
  }

  // Muse on a shot field (description / prompt)
  const [museField, setMuseField] = useState<MuseField | null>(null)
  const openFieldMuse = (shot: Shot, field: 'description' | 'prompt', e: React.MouseEvent) => {
    setMuseField({
      shotId: shot.id,
      field,
      text: (field === 'description' ? shot.description : shot.prompt) ?? '',
      rect: (e.currentTarget as HTMLElement).getBoundingClientRect(),
      isLight: typeof document !== 'undefined' && !document.documentElement.classList.contains('dark'),
    })
  }
  const applyFieldMuse = (text: string, mode: 'replace' | 'after') => {
    if (!museField) return
    const cur = (museField.field === 'description'
      ? shots?.find((s) => s.id === museField.shotId)?.description
      : shots?.find((s) => s.id === museField.shotId)?.prompt) ?? ''
    const next = mode === 'after' ? `${cur}${cur ? '\n' : ''}${text}` : text
    patchLocal(museField.shotId, { [museField.field]: next } as Partial<Shot>)
    void saveShot(museField.shotId, { [museField.field]: next } as Partial<Shot>)
    setMuseField((m) => (m ? { ...m, text: next } : m))
  }

  const ordered = (shots ?? []).slice().sort((a, b) => a.idx - b.idx)

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href="/studio/workspace/storyboard"
        className="mb-2 inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft size={15} /> All boards
      </Link>

      <div className="mb-5 flex items-center gap-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled board"
          aria-label="Board title"
          className="min-w-0 flex-1 bg-transparent font-display text-2xl font-semibold text-foreground outline-none placeholder:text-faint"
        />
        <button
          onClick={addShot}
          disabled={busy}
          className="inline-flex flex-shrink-0 items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={16} />} Add shot
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-destructive/40 bg-card p-4 text-sm text-destructive">{error}</div>
      )}

      {shots === null ? (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" /> Loading board…
        </div>
      ) : ordered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          No shots yet — add your first shot to start blocking the sequence.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ordered.map((shot, i) => (
            <div key={shot.id} className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card">
              {/* reserved frame slot — AI generation fills this in once keys are added */}
              <div className="relative flex aspect-video items-center justify-center border-b border-border bg-secondary/40">
                <div className="flex flex-col items-center gap-1 text-center text-muted-foreground">
                  <ImageIcon size={22} className="opacity-50" />
                  <span className="text-[10px] font-medium uppercase tracking-wider opacity-70">Frame {i + 1}</span>
                </div>
                <span className="absolute left-2 top-2 rounded-md bg-background/80 px-1.5 py-0.5 text-[10px] font-bold text-foreground">
                  {i + 1}
                </span>
                <button
                  disabled
                  title="Generate frame — available once AI model keys are added"
                  className="absolute bottom-2 right-2 inline-flex cursor-not-allowed items-center gap-1 rounded-md bg-background/80 px-2 py-1 text-[10px] font-semibold text-muted-foreground"
                >
                  <Sparkles size={11} /> Generate
                </button>
              </div>

              {/* shot metadata */}
              <div className="flex flex-1 flex-col gap-2 p-3">
                <div className="flex items-center gap-2">
                  <select
                    value={shot.shot_type ?? ''}
                    onChange={(e) => {
                      patchLocal(shot.id, { shot_type: e.target.value })
                      void saveShot(shot.id, { shot_type: e.target.value || null })
                    }}
                    className="rounded-md border border-border bg-background px-1.5 py-1 text-[11px] font-semibold text-foreground outline-none"
                    aria-label="Shot type"
                  >
                    {SHOT_TYPES.map((t) => (
                      <option key={t} value={t}>{t || 'Type'}</option>
                    ))}
                  </select>
                  <input
                    value={shot.title}
                    onChange={(e) => patchLocal(shot.id, { title: e.target.value })}
                    onBlur={(e) => void saveShot(shot.id, { title: e.target.value })}
                    placeholder="Shot title"
                    className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-foreground outline-none placeholder:text-faint"
                  />
                </div>

                <div className="relative">
                  <textarea
                    value={shot.description ?? ''}
                    onChange={(e) => patchLocal(shot.id, { description: e.target.value })}
                    onBlur={(e) => void saveShot(shot.id, { description: e.target.value })}
                    rows={2}
                    placeholder="Action — what happens in frame"
                    className="w-full resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 pr-7 text-[13px] text-foreground outline-none placeholder:text-faint focus:border-primary/40"
                  />
                  <button
                    onClick={(e) => openFieldMuse(shot, 'description', e)}
                    title="PrimeOS AI — refine this with AI"
                    className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                  >
                    <Aperture size={13} />
                  </button>
                </div>
                <div className="relative">
                  <textarea
                    value={shot.prompt ?? ''}
                    onChange={(e) => patchLocal(shot.id, { prompt: e.target.value })}
                    onBlur={(e) => void saveShot(shot.id, { prompt: e.target.value })}
                    rows={2}
                    placeholder="Generation prompt for this frame"
                    className="w-full resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 pr-7 text-[12px] text-muted-foreground outline-none placeholder:text-faint focus:border-primary/40"
                  />
                  <button
                    onClick={(e) => openFieldMuse(shot, 'prompt', e)}
                    title="PrimeOS AI — refine this prompt with AI"
                    className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                  >
                    <Aperture size={13} />
                  </button>
                </div>

                <div className="mt-auto flex items-center gap-1 pt-1">
                  <button
                    onClick={() => move(shot, 'left')}
                    disabled={i === 0}
                    title="Move earlier"
                    className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-30"
                  >
                    <ChevronLeft size={15} />
                  </button>
                  <button
                    onClick={() => move(shot, 'right')}
                    disabled={i === ordered.length - 1}
                    title="Move later"
                    className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-30"
                  >
                    <ChevronRight size={15} />
                  </button>
                  <button
                    onClick={() => del(shot.id)}
                    title="Delete shot"
                    className="ml-auto grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {museField && (
        <PrimeOSAssistant
          selText={museField.text}
          rect={museField.rect}
          isLight={museField.isLight}
          onApply={applyFieldMuse}
          onClose={() => setMuseField(null)}
        />
      )}
    </div>
  )
}
