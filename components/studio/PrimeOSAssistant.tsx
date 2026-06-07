'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown, X, CornerDownLeft, Replace, CornerDownRight, Copy, Check,
  GripHorizontal, Wand2, Bookmark, RotateCcw, Pencil, Square, Plus, Sparkles,
  Mic, History as HistoryIcon, Trash2,
} from 'lucide-react'
import { modelsByModality } from '@/lib/ai/models'
import PrimeOSMark from './PrimeOSMark'
import Markdown from './Markdown'
import { PERSONAS, COMMANDS, QUICK_SEL, QUICK_NONE, type Turn } from '@/lib/studio/primePrompts'

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

export default function PrimeOSAssistant({
  selText,
  docText = '',
  rect,
  isLight,
  onApply,
  onClose,
  initialTurns,
  onTurns,
  canApply = true,
}: {
  selText: string
  docText?: string
  rect: DOMRect | null
  isLight: boolean
  onApply: (text: string, mode: 'replace' | 'after') => void
  onClose: () => void
  initialTurns?: Turn[]
  onTurns?: (turns: Turn[]) => void
  /** whether an editor is available to receive Replace/Insert (false on non-editor pages) */
  canApply?: boolean
}) {
  const textModels = useMemo(() => modelsByModality('text'), [])
  const [model, setModelState] = useState(textModels[1]?.id ?? textModels[0]?.id ?? 'anthropic/claude-sonnet')
  // Remember the last-used model across sessions.
  useEffect(() => {
    try { const m = localStorage.getItem('tl-primeos-model'); if (m && textModels.some((x) => x.id === m)) setModelState(m) } catch { /* ignore */ }
  }, [textModels])
  const setModel = (id: string) => { setModelState(id); try { localStorage.setItem('tl-primeos-model', id) } catch { /* ignore */ } }
  const [modelOpen, setModelOpen] = useState(false)
  const [turns, setTurns] = useState<Turn[]>(initialTurns ?? [])
  // Persist the conversation up to the parent so it survives close → reopen.
  const onTurnsRef = useRef(onTurns)
  onTurnsRef.current = onTurns
  useEffect(() => { onTurnsRef.current?.(turns) }, [turns])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState<number | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const hasSel = selText.trim().length > 0
  const [persona, setPersona] = useState(PERSONAS[0].id)
  const [personaOpen, setPersonaOpen] = useState(false)
  const [scope, setScope] = useState<'selection' | 'document'>(hasSel ? 'selection' : 'document')
  const [cmdOpen, setCmdOpen] = useState(false)
  const personaLabel = PERSONAS.find((p) => p.id === persona)?.label ?? 'Screenwriter'
  const [saved, setSaved] = useState<string[]>([])
  const [balance, setBalance] = useState<number | null>(null)
  // voice dictation + conversation history
  const [recording, setRecording] = useState(false)
  const recogRef = useRef<{ stop: () => void } | null>(null)
  const [histOpen, setHistOpen] = useState(false)
  const [history, setHistory] = useState<{ id: string; title: string; turns: Turn[]; ts: number }[]>([])
  const persistHistory = (next: typeof history) => { try { localStorage.setItem('tl-primeos-history', JSON.stringify(next)) } catch { /* ignore */ } ; setHistory(next) }
  const archive = (t: Turn[]) => {
    if (!t.length) return
    const title = (t.find((x) => x.role === 'user')?.text || 'Conversation').slice(0, 70)
    persistHistory([{ id: Math.random().toString(36).slice(2), title, turns: t, ts: Date.now() }, ...history].slice(0, 40))
  }
  const fetchBalance = () => {
    fetch('/api/studio/credits').then((r) => r.json()).then((j) => { if (typeof j.balanceCents === 'number') setBalance(j.balanceCents) }).catch(() => {})
  }
  const topUp = async () => {
    const dollars = window.prompt('Add credits (USD)', '20')
    if (dollars === null) return
    const amt = Math.round(parseFloat(dollars) * 100)
    if (!amt || amt < 500) return
    try {
      const res = await fetch('/api/studio/credits/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cents: amt }) })
      const j = await res.json()
      if (j.url) window.location.href = j.url
    } catch { /* ignore */ }
  }
  useEffect(() => {
    try { const s = JSON.parse(localStorage.getItem('tl-primeos-prompts') || '[]'); if (Array.isArray(s)) setSaved(s) } catch { /* ignore */ }
    try { const h = JSON.parse(localStorage.getItem('tl-primeos-history') || '[]'); if (Array.isArray(h)) setHistory(h) } catch { /* ignore */ }
    fetchBalance()
  }, [])

  // Voice dictation via the Web Speech API — transcribes straight into the box.
  const toggleRecord = () => {
    const SR = (window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: any }).webkitSpeechRecognition
    if (!SR) { alert('Voice input isn’t supported in this browser. Try Chrome or Edge.'); return }
    if (recording) { recogRef.current?.stop(); return }
    const r = new SR()
    r.lang = 'en-US'; r.interimResults = true; r.continuous = true
    const base = input.trim()
    r.onresult = (e: any) => {
      let txt = ''
      for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript
      setInput((base ? base + ' ' : '') + txt)
    }
    r.onend = () => { setRecording(false); recogRef.current = null }
    r.onerror = () => { setRecording(false); recogRef.current = null }
    recogRef.current = r
    r.start()
    setRecording(true)
    setTimeout(() => taRef.current?.focus(), 0)
  }
  const persistSaved = (next: string[]) => { try { localStorage.setItem('tl-primeos-prompts', JSON.stringify(next)) } catch { /* ignore */ } ; setSaved(next) }
  const savePrompt = () => { const p = input.trim(); if (p) persistSaved([p, ...saved.filter((x) => x !== p)].slice(0, 12)) }
  const removeSaved = (p: string) => persistSaved(saved.filter((x) => x !== p))

  // ── floating position + size (draggable + resizable, remembered) ──────────
  const [size, setSize] = useState({ w: 416, h: 520 })
  const [pos, setPos] = useState({ x: 120, y: 96 })

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem('tl-primeos-size') || '')
      if (s?.w && s?.h) setSize(s)
    } catch { /* ignore */ }

    const W = 416
    const H = 520
    let initialPos = { x: window.innerWidth - W - 36, y: 104 }
    try {
      const p = JSON.parse(localStorage.getItem('tl-primeos-pos') || '')
      if (typeof p?.x === 'number') {
        initialPos = { x: clamp(p.x, 8, window.innerWidth - 80), y: clamp(p.y, 8, window.innerHeight - 60) }
      } else if (rect) {
        initialPos = {
          x: clamp(rect.left, 8, window.innerWidth - W - 8),
          y: clamp(rect.bottom + 10, 8, window.innerHeight - H - 8),
        }
      }
    } catch {
      if (rect) {
        initialPos = {
          x: clamp(rect.left, 8, window.innerWidth - W - 8),
          y: clamp(rect.bottom + 10, 8, window.innerHeight - H - 8),
        }
      }
    }
    setPos(initialPos)
  }, [rect])

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
          w: clamp(resz.current.w + (e.clientX - resz.current.x), 340, Math.min(820, window.innerWidth - 16)),
          h: clamp(resz.current.h + (e.clientY - resz.current.y), 320, window.innerHeight - 24),
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

  // Intentionally sticky: the panel stays open (movable) until the user closes it
  // with the × — it does not dismiss on Escape or outside interaction.
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
    const ac = new AbortController()
    abortRef.current = ac
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
        signal: ac.signal,
      })
      const ct = res.headers.get('content-type') || ''
      if (ct.includes('application/json') || !res.body) {
        const j = await res.json()
        let reply: string
        let applicable = false
        if (j.outOfCredits) reply = j.message
        else if (j.needsKey) reply = `Add a ${j.needsKey} to enable ${modelLabel}. PrimeOS is fully wired — it answers the moment a key is set.`
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
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            acc += dec.decode(value, { stream: true })
            setTurns((t) => { const c = [...t]; c[c.length - 1] = { ...c[c.length - 1], text: acc }; return c })
          }
        } catch (err) {
          if (!ac.signal.aborted) throw err
        }
        if (!acc.trim() && !ac.signal.aborted) setTurns((t) => { const c = [...t]; c[c.length - 1] = { role: 'assistant', text: '(empty response)', applicable: false }; return c })
      }
    } catch (e) {
      if (!ac.signal.aborted) setTurns((t) => [...t, { role: 'assistant', text: `Request failed: ${(e as Error).message}` }])
    } finally {
      setLoading(false)
      abortRef.current = null
      setTimeout(fetchBalance, 1000) // reflect the credit charge once metering settles
    }
  }

  const stop = () => abortRef.current?.abort()
  const newChat = () => { abortRef.current?.abort(); archive(turns); setTurns([]); setInput('') }
  const loadConversation = (item: { id: string; turns: Turn[] }) => {
    abortRef.current?.abort()
    archive(turns) // park the current one first
    setTurns(item.turns)
    setHistOpen(false)
  }
  const deleteConversation = (id: string) => persistHistory(history.filter((h) => h.id !== id))
  const editPrompt = (text: string) => { setInput(text); setTimeout(() => taRef.current?.focus(), 0) }
  const regenerate = (i: number) => {
    for (let k = i - 1; k >= 0; k--) if (turns[k].role === 'user') { void send(turns[k].text); return }
  }
  const copyText = (text: string, i: number) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(i); setTimeout(() => setCopied(null), 1500) }).catch(() => {})
  }

  const surface = isLight ? 'border-black/10 bg-white' : 'border-white/10 bg-[#0f1c3f]'
  const subtle = isLight ? 'text-gray-500' : 'text-gray-400'
  const miniBtn = `inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors ${isLight ? 'text-gray-500 hover:bg-black/5 hover:text-gray-800' : 'text-gray-400 hover:bg-white/10 hover:text-gray-100'}`

  return (
    <div
      className={`fixed z-[60] flex flex-col overflow-hidden rounded-2xl border shadow-2xl ${surface}`}
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* header (drag handle) — enterprise chrome with the PrimeOS mark */}
      <div
        onPointerDown={startDrag}
        className={`relative flex cursor-move touch-none items-center gap-2.5 border-b px-3 py-2.5 ${isLight ? 'border-black/10' : 'border-white/10'}`}
        style={{ background: isLight ? 'linear-gradient(90deg, rgba(227,189,99,0.10), rgba(227,189,99,0) 60%)' : 'linear-gradient(90deg, rgba(227,189,99,0.14), rgba(227,189,99,0) 60%)' }}
      >
        <PrimeOSMark size={26} pondering={loading} />
        <span className={`text-[14px] font-semibold tracking-tight ${isLight ? 'text-gray-900' : 'text-gray-50'}`}>PrimeOS</span>
        <GripHorizontal size={14} className={`${subtle} ml-0.5`} />
        <div className="ml-auto flex items-center gap-1">
          {balance !== null && (
            <button onClick={topUp} title="Credit balance — click to top up" className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${balance <= 0 ? 'bg-destructive/15 text-destructive' : isLight ? 'bg-black/5 text-gray-600 hover:bg-black/10' : 'bg-white/10 text-gray-300 hover:bg-white/15'}`}>
              ${(balance / 100).toFixed(2)}
            </button>
          )}
          <div className="relative">
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
          <button onClick={newChat} title="New chat" className={`grid h-6 w-6 place-items-center rounded-md ${isLight ? 'text-gray-500 hover:bg-black/5' : 'text-gray-300 hover:bg-white/10'}`}>
            <Plus size={15} />
          </button>
          <button onClick={onClose} title="Close" className={`grid h-6 w-6 place-items-center rounded-md ${isLight ? 'text-gray-500 hover:bg-black/5' : 'text-gray-300 hover:bg-white/10'}`}>
            <X size={14} />
          </button>
        </div>
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
        {/* conversation history */}
        <div className="relative ml-auto">
          <button onClick={() => setHistOpen((o) => !o)} title="Conversation history" className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${histOpen ? 'bg-primary/15 text-primary' : isLight ? 'text-gray-600 hover:bg-black/5' : 'text-gray-300 hover:bg-white/10'}`}>
            <HistoryIcon size={13} />
          </button>
          {histOpen && (
            <>
              <button aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setHistOpen(false)} />
              <div className={`absolute right-0 top-full z-20 mt-1 max-h-72 w-72 overflow-y-auto rounded-xl border py-1 shadow-2xl ${surface}`}>
                <p className={`px-3 pb-1 pt-1.5 text-[9px] font-bold uppercase tracking-widest ${subtle}`}>History</p>
                {history.length === 0 ? (
                  <p className={`px-3 py-2 text-[12px] ${subtle}`}>No saved conversations yet.</p>
                ) : history.map((h) => (
                  <div key={h.id} className="group flex items-center">
                    <button onClick={() => loadConversation(h)} className={`min-w-0 flex-1 truncate px-3 py-1.5 text-left text-[12px] ${isLight ? 'text-gray-700 hover:bg-black/5' : 'text-gray-200 hover:bg-white/10'}`} title={h.title}>{h.title}</button>
                    <button onClick={() => deleteConversation(h.id)} className={`px-2 opacity-0 transition-opacity group-hover:opacity-100 ${subtle} hover:text-destructive`} title="Delete"><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="relative">
          <button onClick={() => setCmdOpen((o) => !o)} className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/15">
            <Wand2 size={12} /> Actions
          </button>
          {cmdOpen && (
            <>
              <button aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setCmdOpen(false)} />
              <div className={`absolute right-0 top-full z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-xl border py-1 shadow-2xl ${surface}`}>
                {saved.length > 0 && (
                  <div>
                    <p className={`px-3 pb-0.5 pt-1.5 text-[9px] font-bold uppercase tracking-widest ${subtle}`}>Saved prompts</p>
                    {saved.map((p) => (
                      <div key={p} className="group flex items-center">
                        <button onClick={() => { setCmdOpen(false); void send(p) }} className={`min-w-0 flex-1 truncate px-3 py-1 text-left text-[12px] ${isLight ? 'text-gray-700 hover:bg-black/5' : 'text-gray-200 hover:bg-white/10'}`}>{p}</button>
                        <button onClick={() => removeSaved(p)} className={`px-2 opacity-0 transition-opacity group-hover:opacity-100 ${subtle} hover:text-destructive`}><X size={11} /></button>
                      </div>
                    ))}
                  </div>
                )}
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
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
        {turns.length === 0 && !loading && (
          <div className="space-y-2 py-1">
            <p className={`flex items-center gap-1.5 text-[12px] font-medium ${subtle}`}><Sparkles size={13} /> Start with a quick action</p>
            <div className="flex flex-wrap gap-1.5">
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
          </div>
        )}
        <div className="space-y-3">
          {turns.map((t, i) => (
            <div key={i} className={`group ${t.role === 'user' ? 'text-right' : ''}`}>
              <div
                className={`inline-block max-w-[92%] break-words rounded-xl px-2.5 py-1.5 text-[13px] leading-relaxed ${
                  t.role === 'user'
                    ? 'whitespace-pre-wrap bg-primary text-primary-foreground'
                    : isLight ? 'bg-black/[0.04] text-gray-800' : 'bg-white/[0.06] text-gray-100'
                }`}
              >
                {t.role === 'assistant'
                  ? (t.text ? <Markdown text={t.text} /> : (loading ? '…' : ''))
                  : t.text}
              </div>
              {/* user-turn actions: rerun · edit · copy (on hover) */}
              {t.role === 'user' && (
                <div className="mt-0.5 flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button onClick={() => void send(t.text)} disabled={loading} className={miniBtn} title="Run again"><RotateCcw size={12} /> Rerun</button>
                  <button onClick={() => editPrompt(t.text)} className={miniBtn} title="Edit & resend"><Pencil size={12} /> Edit</button>
                  <button onClick={() => copyText(t.text, i)} className={miniBtn} title="Copy">{copied === i ? <Check size={12} /> : <Copy size={12} />}</button>
                </div>
              )}
              {/* assistant-turn actions */}
              {t.role === 'assistant' && t.applicable && (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {canApply && (
                    <>
                      <button onClick={() => onApply(t.text, 'replace')} className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline">
                        <Replace size={12} /> {hasSel ? 'Replace selection' : 'Insert at cursor'}
                      </button>
                      <button onClick={() => onApply(t.text, 'after')} className={`inline-flex items-center gap-1 text-[11px] font-medium ${subtle} hover:text-foreground`}>
                        <CornerDownRight size={12} /> Insert below
                      </button>
                    </>
                  )}
                  <button onClick={() => copyText(t.text, i)} className={`inline-flex items-center gap-1 text-[11px] font-medium ${subtle} hover:text-foreground`}>
                    {copied === i ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
                  </button>
                  <button onClick={() => regenerate(i)} disabled={loading} className={`inline-flex items-center gap-1 text-[11px] font-medium ${subtle} hover:text-foreground disabled:opacity-40`}>
                    <RotateCcw size={12} /> Regenerate
                  </button>
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className={`inline-flex items-center gap-2 text-[12px] ${subtle}`}>
              <PrimeOSMark size={16} pondering spinning />
              <span>PrimeOS is thinking…</span>
              <button onClick={stop} className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${isLight ? 'border-black/10 hover:bg-black/5' : 'border-white/10 hover:bg-white/10'}`} title="Stop generating">
                <Square size={10} /> Stop
              </button>
            </div>
          )}
        </div>
      </div>

      {/* input — one unified, mature composer bar */}
      <div className={`border-t p-2.5 ${isLight ? 'border-black/10' : 'border-white/10'}`}>
        <div className={`flex items-end gap-1.5 rounded-2xl border px-2.5 py-1.5 transition-colors focus-within:border-primary/50 ${isLight ? 'border-black/10 bg-white' : 'border-white/10 bg-white/[0.04]'}`}>
          <textarea
            ref={taRef}
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input) }
              else if (e.key === 'ArrowUp' && !input.trim()) {
                const last = [...turns].reverse().find((t) => t.role === 'user')
                if (last) { e.preventDefault(); setInput(last.text) }
              }
            }}
            rows={1}
            placeholder={hasSel ? 'Refine, rewrite, translate…' : 'Message PrimeOS…'}
            className={`max-h-32 min-h-[28px] flex-1 resize-none bg-transparent py-1 text-[13.5px] leading-snug outline-none ${isLight ? 'text-gray-800 placeholder:text-gray-400' : 'text-gray-100 placeholder:text-gray-500'}`}
          />
          <button
            onClick={toggleRecord}
            title={recording ? 'Stop dictation' : 'Dictate (voice to text)'}
            className={`grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg transition-colors ${recording ? 'bg-destructive/15 text-destructive animate-pulse' : isLight ? 'text-gray-400 hover:bg-black/5 hover:text-gray-700' : 'text-gray-400 hover:bg-white/10 hover:text-gray-100'}`}
          >
            <Mic size={15} />
          </button>
          <button
            onClick={savePrompt}
            disabled={!input.trim()}
            title="Save this prompt"
            className={`grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg transition-colors disabled:opacity-30 ${isLight ? 'text-gray-400 hover:bg-black/5 hover:text-gray-700' : 'text-gray-400 hover:bg-white/10 hover:text-gray-100'}`}
          >
            <Bookmark size={15} />
          </button>
          {loading ? (
            <button
              onClick={stop}
              className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg bg-destructive/90 text-white transition-opacity hover:opacity-90"
              title="Stop generating"
            >
              <Square size={13} />
            </button>
          ) : (
            <button
              onClick={() => void send(input)}
              disabled={!input.trim()}
              className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
              title="Send (Enter)"
            >
              <CornerDownLeft size={14} />
            </button>
          )}
        </div>
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
