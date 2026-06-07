'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Aperture, ChevronDown, X, CornerDownLeft, Replace, CornerDownRight, Copy, Loader2, Check, GripHorizontal, Wand2 } from 'lucide-react'
import { modelsByModality } from '@/lib/ai/models'

type Turn = { role: 'user' | 'assistant'; text: string; applicable?: boolean }
const QUICK_SEL = ['Improve writing', 'Make it shorter', 'Make it longer', 'Fix grammar', 'Rephrase', 'More cinematic', 'Continue writing']
const QUICK_NONE = ['Continue writing', 'Write the next scene', 'Brainstorm ideas', 'Outline this sequence', 'Suggest a stronger title']

// Expert lenses — shape the model's system prompt for film + automation work.
const PERSONAS = [
  { id: 'screenwriter', label: 'Screenwriter', sys: 'You are a master screenwriter — vivid action lines, subtext-rich dialogue, correct screenplay format and rhythm.' },
  { id: 'doctor', label: 'Script Doctor', sys: 'You are a veteran script doctor. Diagnose structure, pacing, motivation and dialogue, and fix them incisively.' },
  { id: 'director', label: 'Director', sys: 'You are a film director. Think in shots, blocking, coverage, visual storytelling and tone.' },
  { id: 'producer', label: 'Showrunner', sys: 'You are a showrunner/producer — story arcs, marketability, budget-aware choices and series logic.' },
  { id: 'copy', label: 'Ad Copywriter', sys: 'You are a world-class advertising copywriter — punchy hooks, persuasion, brand-safe lines and strong CTAs.' },
  { id: 'automation', label: 'Automation Architect', sys: 'You are an automation/workflow architect. Design robust automations — triggers, steps, integrations, data shapes, retries and error handling — and write precise specs or JSON when asked.' },
]

// Action library — high-leverage commands for drafting film + automations fast.
const COMMANDS: { group: string; items: string[] }[] = [
  { group: 'Write', items: ['Continue writing', 'Write the next scene', 'Draft dialogue for this beat', 'Write a logline', 'Write a one-paragraph synopsis', 'Write director’s coverage notes'] },
  { group: 'Improve', items: ['Punch up the dialogue', 'Tighten for runtime', 'Stronger verbs & imagery', 'Show, don’t tell', 'Fix grammar & spelling', 'Make it more cinematic'] },
  { group: 'Transform', items: ['Format as a screenplay', 'Turn into a beat sheet', 'Turn into a shot list', 'Turn into a treatment', 'Summarize', 'Translate to…'] },
  { group: 'Film', items: ['Suggest shots & coverage', 'Continuity check', 'Character voice pass', 'Add stage directions', 'Shift the genre/tone', 'Generate 3 alternate takes'] },
  { group: 'Automation', items: ['Draft an automation spec', 'Outline a workflow', 'Write integration steps', 'Generate a JSON config', 'Add error handling & retries'] },
]

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

export default function PrimeOSAssistant({
  selText,
  docText = '',
  rect,
  isLight,
  onApply,
  onClose,
}: {
  selText: string
  docText?: string
  rect: DOMRect | null
  isLight: boolean
  onApply: (text: string, mode: 'replace' | 'after') => void
  onClose: () => void
}) {
  const textModels = useMemo(() => modelsByModality('text'), [])
  const [model, setModel] = useState(textModels[1]?.id ?? textModels[0]?.id ?? 'anthropic/claude-sonnet')
  const [modelOpen, setModelOpen] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState<number | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const hasSel = selText.trim().length > 0
  const [persona, setPersona] = useState(PERSONAS[0].id)
  const [personaOpen, setPersonaOpen] = useState(false)
  const [scope, setScope] = useState<'selection' | 'document'>(hasSel ? 'selection' : 'document')
  const [cmdOpen, setCmdOpen] = useState(false)
  const personaLabel = PERSONAS.find((p) => p.id === persona)?.label ?? 'Screenwriter'

  // ── floating position + size (draggable + resizable, remembered) ──────────
  const [size, setSize] = useState(() => {
    if (typeof window === 'undefined') return { w: 400, h: 480 }
    try {
      const s = JSON.parse(localStorage.getItem('tl-primeos-size') || '')
      if (s?.w && s?.h) return s
    } catch { /* ignore */ }
    return { w: 400, h: 480 }
  })
  const [pos, setPos] = useState(() => {
    if (typeof window === 'undefined') return { x: 120, y: 96 }
    const W = 400
    const H = 480
    try {
      const p = JSON.parse(localStorage.getItem('tl-primeos-pos') || '')
      if (typeof p?.x === 'number') return { x: clamp(p.x, 8, window.innerWidth - 80), y: clamp(p.y, 8, window.innerHeight - 60) }
    } catch { /* ignore */ }
    if (rect) {
      return {
        x: clamp(rect.left, 8, window.innerWidth - W - 8),
        y: clamp(rect.bottom + 10, 8, window.innerHeight - H - 8),
      }
    }
    return { x: window.innerWidth - W - 36, y: 104 }
  })
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const resz = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (drag.current) {
        setPos({
          x: clamp(e.clientX - drag.current.dx, 8, window.innerWidth - 80),
          y: clamp(e.clientY - drag.current.dy, 8, window.innerHeight - 48),
        })
      } else if (resz.current) {
        setSize({
          w: clamp(resz.current.w + (e.clientX - resz.current.x), 320, Math.min(760, window.innerWidth - 16)),
          h: clamp(resz.current.h + (e.clientY - resz.current.y), 300, window.innerHeight - 24),
        })
      }
    }
    const up = () => {
      if (drag.current) { try { localStorage.setItem('tl-primeos-pos', JSON.stringify(pos)) } catch { /* ignore */ } }
      if (resz.current) { try { localStorage.setItem('tl-primeos-size', JSON.stringify(size)) } catch { /* ignore */ } }
      drag.current = null
      resz.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [pos, size])
  const startDrag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return // don't drag from buttons
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }
  }
  const startResize = (e: React.PointerEvent) => {
    e.stopPropagation()
    resz.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [turns, loading])

  const modelLabel = textModels.find((m) => m.id === model)?.label ?? model

  async function send(instruction: string) {
    const text = instruction.trim()
    if (!text || loading) return
    setInput('')
    const history = turns.map((t) => ({ role: t.role, text: t.text }))
    setTurns((t) => [...t, { role: 'user', text }])
    setLoading(true)
    try {
      const res = await fetch('/api/studio/muse', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          modelId: model,
          persona: PERSONAS.find((p) => p.id === persona)?.sys,
          instruction: text,
          selection: scope === 'document' ? (docText || selText) : selText,
          history,
        }),
      })
      const ct = res.headers.get('content-type') || ''
      if (ct.includes('application/json') || !res.body) {
        // key / unsupported / error — non-streamed
        const j = await res.json()
        let reply: string
        let applicable = false
        if (j.needsKey) reply = `Add a ${j.needsKey} to enable ${modelLabel}. PrimeOS AI is fully wired — it answers the moment a key is set.`
        else if (j.unsupported) reply = j.message
        else if (j.error) reply = `Couldn’t reach the model: ${j.error}`
        else { reply = j.reply || '(empty response)'; applicable = true }
        setTurns((t) => [...t, { role: 'assistant', text: reply, applicable }])
      } else {
        // streamed tokens — render live
        setTurns((t) => [...t, { role: 'assistant', text: '', applicable: true }])
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let acc = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          acc += dec.decode(value, { stream: true })
          setTurns((t) => { const c = [...t]; c[c.length - 1] = { ...c[c.length - 1], text: acc }; return c })
        }
        if (!acc.trim()) setTurns((t) => { const c = [...t]; c[c.length - 1] = { role: 'assistant', text: '(empty response)', applicable: false }; return c })
      }
    } catch (e) {
      setTurns((t) => [...t, { role: 'assistant', text: `Request failed: ${(e as Error).message}` }])
    } finally {
      setLoading(false)
    }
  }

  const surface = isLight ? 'border-black/10 bg-white' : 'border-white/10 bg-[#0f1c3f]'
  const subtle = isLight ? 'text-gray-500' : 'text-gray-400'

  return (
    <div
      className={`fixed z-[60] flex flex-col overflow-hidden rounded-2xl border shadow-2xl ${surface}`}
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* header (drag handle) */}
      <div
        onPointerDown={startDrag}
        className={`flex cursor-move touch-none items-center gap-2 border-b px-3 py-2 ${isLight ? 'border-black/10' : 'border-white/10'}`}
      >
        <Aperture size={16} className="text-primary" />
        <span className={`text-sm font-semibold ${isLight ? 'text-gray-800' : 'text-gray-100'}`}>PrimeOS AI</span>
        <GripHorizontal size={14} className={subtle} />
        <div className="relative ml-auto">
          <button
            onClick={() => setModelOpen((o) => !o)}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${isLight ? 'text-gray-600 hover:bg-black/5' : 'text-gray-300 hover:bg-white/10'}`}
          >
            {modelLabel} <ChevronDown size={12} />
          </button>
          {modelOpen && (
            <>
              <button aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setModelOpen(false)} />
              <div className={`absolute right-0 top-full z-20 mt-1 max-h-64 w-52 overflow-y-auto rounded-xl border py-1 shadow-2xl ${surface}`}>
                {textModels.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => { setModel(m.id); setModelOpen(false) }}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs ${m.id === model ? 'text-primary' : isLight ? 'text-gray-700 hover:bg-black/5' : 'text-gray-200 hover:bg-white/10'}`}
                  >
                    <span className="truncate">{m.label}</span>
                    <span className={`flex-shrink-0 text-[10px] ${subtle}`}>{m.provider}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <button onClick={onClose} className={`grid h-6 w-6 place-items-center rounded-md ${isLight ? 'text-gray-500 hover:bg-black/5' : 'text-gray-300 hover:bg-white/10'}`}>
          <X size={14} />
        </button>
      </div>

      {/* controls — expert lens · scope · action library */}
      <div className={`flex items-center gap-1.5 border-b px-2.5 py-1.5 ${isLight ? 'border-black/10' : 'border-white/10'}`}>
        <div className="relative">
          <button onClick={() => setPersonaOpen((o) => !o)} title="Expert lens" className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${isLight ? 'text-gray-700 hover:bg-black/5' : 'text-gray-200 hover:bg-white/10'}`}>
            {personaLabel} <ChevronDown size={11} />
          </button>
          {personaOpen && (
            <>
              <button aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setPersonaOpen(false)} />
              <div className={`absolute left-0 top-full z-20 mt-1 w-52 overflow-hidden rounded-xl border py-1 shadow-2xl ${surface}`}>
                {PERSONAS.map((p) => (
                  <button key={p.id} onClick={() => { setPersona(p.id); setPersonaOpen(false) }} className={`block w-full px-3 py-1.5 text-left text-[12px] ${p.id === persona ? 'text-primary' : isLight ? 'text-gray-700 hover:bg-black/5' : 'text-gray-200 hover:bg-white/10'}`}>{p.label}</button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className={`flex overflow-hidden rounded-md border text-[10px] font-semibold ${isLight ? 'border-black/10' : 'border-white/10'}`} title="Use the selection or the whole document as context">
          <button onClick={() => setScope('selection')} disabled={!hasSel} className={`px-1.5 py-1 ${scope === 'selection' ? 'bg-primary/15 text-primary' : subtle} disabled:opacity-40`}>SEL</button>
          <button onClick={() => setScope('document')} className={`px-1.5 py-1 ${scope === 'document' ? 'bg-primary/15 text-primary' : subtle}`}>DOC</button>
        </div>
        <div className="relative ml-auto">
          <button onClick={() => setCmdOpen((o) => !o)} className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/15">
            <Wand2 size={12} /> Actions
          </button>
          {cmdOpen && (
            <>
              <button aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setCmdOpen(false)} />
              <div className={`absolute right-0 top-full z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-xl border py-1 shadow-2xl ${surface}`}>
                {COMMANDS.map((g) => (
                  <div key={g.group}>
                    <p className={`px-3 pb-0.5 pt-1.5 text-[9px] font-bold uppercase tracking-widest ${subtle}`}>{g.group}</p>
                    {g.items.map((it) => (
                      <button key={it} onClick={() => { setCmdOpen(false); void send(it) }} className={`block w-full px-3 py-1 text-left text-[12px] ${isLight ? 'text-gray-700 hover:bg-black/5' : 'text-gray-200 hover:bg-white/10'}`}>{it}</button>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* selected context */}
      {hasSel && scope === 'selection' && (
        <div className={`border-b px-3 py-1.5 ${isLight ? 'border-black/10' : 'border-white/10'}`}>
          <p className={`line-clamp-2 text-[11px] italic ${subtle}`}>“{selText}”</p>
        </div>
      )}

      {/* transcript */}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {turns.length === 0 && !loading && (
          <div className="flex flex-wrap gap-1.5 py-1">
            {(hasSel ? QUICK_SEL : QUICK_NONE).map((q) => (
              <button
                key={q}
                onClick={() => send(q)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${isLight ? 'border-black/10 text-gray-700 hover:bg-black/5' : 'border-white/10 text-gray-200 hover:bg-white/10'}`}
              >
                {q}
              </button>
            ))}
          </div>
        )}
        <div className="space-y-2.5">
          {turns.map((t, i) => (
            <div key={i} className={t.role === 'user' ? 'text-right' : ''}>
              <div
                className={`inline-block max-w-[92%] whitespace-pre-wrap break-words rounded-xl px-2.5 py-1.5 text-[13px] leading-snug ${
                  t.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : isLight ? 'bg-black/[0.04] text-gray-800' : 'bg-white/[0.06] text-gray-100'
                }`}
              >
                {t.text}
              </div>
              {t.role === 'assistant' && t.applicable && (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <button onClick={() => onApply(t.text, 'replace')} className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline">
                    <Replace size={12} /> {hasSel ? 'Replace selection' : 'Insert at cursor'}
                  </button>
                  <button onClick={() => onApply(t.text, 'after')} className={`inline-flex items-center gap-1 text-[11px] font-medium ${subtle} hover:text-foreground`}>
                    <CornerDownRight size={12} /> Insert below
                  </button>
                  <button
                    onClick={async () => { try { await navigator.clipboard.writeText(t.text); setCopied(i); setTimeout(() => setCopied(null), 1500) } catch { /* ignore */ } }}
                    className={`inline-flex items-center gap-1 text-[11px] font-medium ${subtle} hover:text-foreground`}
                  >
                    {copied === i ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
                  </button>
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className={`inline-flex items-center gap-1.5 text-[12px] ${subtle}`}>
              <Loader2 size={13} className="animate-spin" /> PrimeOS AI is thinking…
            </div>
          )}
        </div>
      </div>

      {/* input */}
      <div className={`flex items-end gap-2 border-t p-2 ${isLight ? 'border-black/10' : 'border-white/10'}`}>
        <textarea
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input) } }}
          rows={1}
          placeholder={hasSel ? 'Refine, rewrite, translate…' : 'Ask PrimeOS AI to write…'}
          className={`max-h-28 min-h-[34px] flex-1 resize-none rounded-lg border px-2.5 py-1.5 text-sm outline-none ${isLight ? 'border-black/10 bg-white text-gray-800 placeholder:text-gray-400' : 'border-white/10 bg-white/5 text-gray-100 placeholder:text-gray-500'}`}
        />
        <button
          onClick={() => void send(input)}
          disabled={!input.trim() || loading}
          className="grid h-[34px] w-9 flex-shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          title="Send (Enter)"
        >
          <CornerDownLeft size={15} />
        </button>
      </div>

      {/* resize grip */}
      <div
        onPointerDown={startResize}
        className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize touch-none"
        title="Drag to resize"
      >
        <div className={`absolute bottom-1 right-1 h-2 w-2 border-b-2 border-r-2 ${isLight ? 'border-gray-400' : 'border-gray-500'}`} />
      </div>
    </div>
  )
}
