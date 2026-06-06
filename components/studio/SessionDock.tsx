'use client'

import { useEffect } from 'react'
import { Maximize2, Minimize2, Minus, X, ArrowLeftRight, Film, Workflow, PlayCircle } from 'lucide-react'
import { useSessionStore } from '@/lib/stores/session-store'

// Global page-in-view dock. Mounted in the studio layout so it persists across
// all /studio navigation; persisted to localStorage so it survives refresh.
export default function SessionDock() {
  const { title, view, mode, setMode, toggleView, close } = useSessionStore()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (mode === 'closed' || !title) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        toggleView()
      } else if (e.key === 'Escape' && mode === 'maximized') {
        setMode('docked')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, title, toggleView, setMode])

  if (mode === 'closed' || !title) return null

  const ViewIcon = view === 'storyboard' ? Film : Workflow
  const viewLabel = view === 'storyboard' ? 'Storyboard' : 'Workflow'

  // minimized → a small pill
  if (mode === 'minimized') {
    return (
      <button
        onClick={() => setMode('docked')}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-primary/40 bg-card px-4 py-2 text-xs font-semibold text-foreground shadow-lg transition-transform hover:-translate-y-0.5"
      >
        <ViewIcon size={14} className="text-primary" />
        {title}
      </button>
    )
  }

  const header = (
    <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-[11px] font-bold">
      <ViewIcon size={13} className="text-primary" />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">{viewLabel}</span>
      <div className="flex items-center gap-0.5 text-muted-foreground">
        <button title="Switch Storyboard ⇄ Workflow (F)" onClick={toggleView} className="rounded p-1 hover:bg-secondary hover:text-foreground">
          <ArrowLeftRight size={13} />
        </button>
        {mode === 'maximized' ? (
          <button title="Restore to panel" onClick={() => setMode('docked')} className="rounded p-1 hover:bg-secondary hover:text-foreground">
            <Minimize2 size={13} />
          </button>
        ) : (
          <button title="Maximize session" onClick={() => setMode('maximized')} className="rounded p-1 hover:bg-secondary hover:text-foreground">
            <Maximize2 size={13} />
          </button>
        )}
        <button title="Minimize" onClick={() => setMode('minimized')} className="rounded p-1 hover:bg-secondary hover:text-foreground">
          <Minus size={13} />
        </button>
        <button title="Close session" onClick={close} className="rounded p-1 hover:bg-secondary hover:text-foreground">
          <X size={13} />
        </button>
      </div>
    </div>
  )

  const body = (full: boolean) => (
    <div className={`relative grid place-items-center bg-gradient-to-br from-secondary to-card ${full ? 'flex-1' : 'aspect-video'}`}>
      <PlayCircle size={full ? 64 : 26} className="text-faint opacity-50" />
      <span className="absolute bottom-2 left-3 right-3 truncate text-[9px] font-semibold text-primary">
        {viewLabel} session · follows you across the studio · press F to switch
      </span>
    </div>
  )

  if (mode === 'maximized') {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur">
        {header}
        {body(true)}
      </div>
    )
  }

  // docked → floating panel, bottom-right
  return (
    <div className="fixed bottom-5 right-5 z-40 w-[270px] overflow-hidden rounded-xl border border-primary/40 bg-card shadow-2xl">
      {header}
      {body(false)}
    </div>
  )
}
