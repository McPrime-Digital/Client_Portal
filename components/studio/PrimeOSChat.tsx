'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown, CornerDownLeft, Copy, Check, RotateCcw, Pencil, Square, Plus,
  Wand2, Mic, History as HistoryIcon, Trash2, Sparkles,
} from 'lucide-react'
import { modelsByModality } from '@/lib/ai/models'
import { PERSONAS, COMMANDS, QUICK_NONE, type Turn } from '@/lib/studio/primePrompts'
import PrimeOSMark from './PrimeOSMark'
import Markdown from './Markdown'

// Full-page PrimeOS suite — the dedicated chat at /studio/suite/ai-chat.
// Shares the engine (/api/studio/muse), prompt library, voice, history and model
// memory with the floating assistant, in an enterprise full-height layout.
export default function PrimeOSChat() {
  const textModels = useMemo(() => modelsByModality('text'), [])
  const [model, setModelState] = useState(textModels[1]?.id ?? textModels[0]?.id ?? 'anthropic/claude-sonnet')
  useEffect(() => {
    try { const m = localStorage.getItem('tl-primeos-model'); if (m && textModels.some((x) => x.id === m)) setModelState(m) } catch { /* ignore */ }
  }, [textModels])
  const setModel = (id: string) => { setModelState(id); try { localStorage.setItem('tl-primeos-model', id) } catch { /* ignore */ } }
  const [modelOpen, setModelOpen] = useState(false)
  const [persona, setPersona] = useState(PERSONAS[0].id)
  const [personaOpen, setPersonaOpen] = useState(false)
  const [cmdOpen, setCmdOpen] = useState(false)
  const [histOpen, setHistOpen] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState<number | null>(null)
  const [recording, setRecording] = useState(false)
  const [balance, setBalance] = useState<number | null>(null)
  const [history, setHistory] = useState<{ id: string; title: string; turns: Turn[]; ts: number }[]>([])
  const scroller = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const recogRef = useRef<{ stop: () => void } | null>(null)
  const personaLabel = PERSONAS.find((p) => p.id === persona)?.label ?? 'Screenwriter'
  const modelLabel = textModels.find((m) => m.id === model)?.label ?? model

  const fetchBalance = () => fetch('/api/studio/credits').then((r) => r.json()).then((j) => { if (typeof j.balanceCents === 'number') setBalance(j.balanceCents) }).catch(() => {})
  const topUp = async () => {
    const dollars = window.prompt('Add credits (USD)', '20'); if (dollars === null) return
    const amt = Math.round(parseFloat(dollars) * 100); if (!amt || amt < 500) return
    try { const res = await fetch('/api/studio/credits/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cents: amt }) }); const j = await res.json(); if (j.url) window.location.href = j.url } catch { /* ignore */ }
  }
  useEffect(() => {
    try { const h = JSON.parse(localStorage.getItem('tl-primeos-history') || '[]'); if (Array.isArray(h)) setHistory(h) } catch { /* ignore */ }
    fetchBalance()
  }, [])
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }) }, [turns, loading])

  const persistHistory = (next: typeof history) => { try { localStorage.setItem('tl-primeos-history', JSON.stringify(next)) } catch { /* ignore */ } ; setHistory(next) }
  const archive = (t: Turn[]) => {
    if (!t.length) return
    const title = (t.find((x) => x.role === 'user')?.text || 'Conversation').slice(0, 70)
    persistHistory([{ id: Math.random().toString(36).slice(2), title, turns: t, ts: Date.now() }, ...history].slice(0, 40))
  }

  async function send(instruction: string) {
    const text = instruction.trim()
    if (!text || loading) return
    setInput('')
    const history2 = turns.map((t) => ({ role: t.role, text: t.text }))
    setTurns((t) => [...t, { role: 'user', text }])
    setLoading(true)
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const res = await fetch('/api/studio/muse', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modelId: model, persona: PERSONAS.find((p) => p.id === persona)?.sys, instruction: text, selection: '', history: history2 }),
        signal: ac.signal,
      })
      const ct = res.headers.get('content-type') || ''
      if (ct.includes('application/json') || !res.body) {
        const j = await res.json()
        let reply: string
        if (j.outOfCredits) reply = j.message
        else if (j.needsKey) reply = `Add a ${j.needsKey} to enable ${modelLabel}. PrimeOS is fully wired — it answers the moment a key is set.`
        else if (j.unsupported) reply = j.message
        else if (j.error) reply = `Couldn’t reach the model: ${j.error}`
        else reply = j.reply || '(empty response)'
        setTurns((t) => [...t, { role: 'assistant', text: reply }])
      } else {
        setTurns((t) => [...t, { role: 'assistant', text: '' }])
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let acc = ''
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            acc += dec.decode(value, { stream: true })
            setTurns((t) => { const c = [...t]; c[c.length - 1] = { role: 'assistant', text: acc }; return c })
          }
        } catch (err) { if (!ac.signal.aborted) throw err }
        if (!acc.trim() && !ac.signal.aborted) setTurns((t) => { const c = [...t]; c[c.length - 1] = { role: 'assistant', text: '(empty response)' }; return c })
      }
    } catch (e) {
      if (!ac.signal.aborted) setTurns((t) => [...t, { role: 'assistant', text: `Request failed: ${(e as Error).message}` }])
    } finally {
      setLoading(false); abortRef.current = null; setTimeout(fetchBalance, 1000)
    }
  }

  const stop = () => abortRef.current?.abort()
  const newChat = () => { abortRef.current?.abort(); archive(turns); setTurns([]); setInput('') }
  const regenerate = (i: number) => { for (let k = i - 1; k >= 0; k--) if (turns[k].role === 'user') { void send(turns[k].text); return } }
  const copyText = (text: string, i: number) => navigator.clipboard?.writeText(text).then(() => { setCopied(i); setTimeout(() => setCopied(null), 1500) }).catch(() => {})
  const loadConversation = (item: { turns: Turn[] }) => { abortRef.current?.abort(); archive(turns); setTurns(item.turns); setHistOpen(false) }
  const deleteConversation = (id: string) => persistHistory(history.filter((h) => h.id !== id))

  const toggleRecord = () => {
    const SR = (window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: any }).webkitSpeechRecognition
    if (!SR) { alert('Voice input isn’t supported in this browser. Try Chrome or Edge.'); return }
    if (recording) { recogRef.current?.stop(); return }
    const r = new SR(); r.lang = 'en-US'; r.interimResults = true; r.continuous = true
    const base = input.trim()
    r.onresult = (e: any) => { let txt = ''; for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript; setInput((base ? base + ' ' : '') + txt) }
    r.onend = () => { setRecording(false); recogRef.current = null }
    r.onerror = () => { setRecording(false); recogRef.current = null }
    recogRef.current = r; r.start(); setRecording(true); setTimeout(() => taRef.current?.focus(), 0)
  }

  const empty = turns.length === 0 && !loading

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      {/* header */}
      <div className="flex items-center gap-3 pb-3">
        <PrimeOSMark size={30} pondering={loading} />
        <div className="leading-tight">
          <div className="font-display text-lg font-semibold text-foreground">PrimeOS</div>
          <div className="text-[11px] text-muted-foreground">{personaLabel} · {modelLabel}</div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {balance !== null && (
            <button onClick={topUp} title="Credit balance — click to top up" className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${balance <= 0 ? 'bg-destructive/15 text-destructive' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}>${(balance / 100).toFixed(2)}</button>
          )}
          {/* model */}
          <div className="relative">
            <button onClick={() => setModelOpen((o) => !o)} className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground">{modelLabel} <ChevronDown size={13} /></button>
            {modelOpen && (
              <>
                <button aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setModelOpen(false)} />
                <div className="absolute right-0 top-full z-20 mt-1 max-h-72 w-56 overflow-y-auto rounded-xl border border-border bg-popover py-1 shadow-2xl">
                  {textModels.map((m) => (
                    <button key={m.id} onClick={() => { setModel(m.id); setModelOpen(false) }} className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs ${m.id === model ? 'text-primary' : 'text-foreground hover:bg-secondary'}`}>
                      <span className="truncate">{m.label}</span><span className="flex-shrink-0 text-[10px] text-muted-foreground">{m.provider}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {/* history */}
          <div className="relative">
            <button onClick={() => setHistOpen((o) => !o)} title="Conversation history" className={`grid h-8 w-8 place-items-center rounded-md ${histOpen ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}><HistoryIcon size={15} /></button>
            {histOpen && (
              <>
                <button aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setHistOpen(false)} />
                <div className="absolute right-0 top-full z-20 mt-1 max-h-80 w-80 overflow-y-auto rounded-xl border border-border bg-popover py-1 shadow-2xl">
                  <p className="px-3 pb-1 pt-1.5 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">History</p>
                  {history.length === 0 ? <p className="px-3 py-2 text-[12px] text-muted-foreground">No saved conversations yet.</p> : history.map((h) => (
                    <div key={h.id} className="group flex items-center">
                      <button onClick={() => loadConversation(h)} title={h.title} className="min-w-0 flex-1 truncate px-3 py-1.5 text-left text-[12px] text-foreground hover:bg-secondary">{h.title}</button>
                      <button onClick={() => deleteConversation(h.id)} className="px-2 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"><Trash2 size={12} /></button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          <button onClick={newChat} title="New chat" className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"><Plus size={16} /></button>
        </div>
      </div>

      {/* persona + actions row */}
      <div className="flex items-center gap-2 border-y border-border py-2">
        <div className="relative">
          <button onClick={() => setPersonaOpen((o) => !o)} className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-foreground hover:bg-secondary">{personaLabel} <ChevronDown size={12} /></button>
          {personaOpen && (
            <>
              <button aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setPersonaOpen(false)} />
              <div className="absolute left-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-2xl">
                {PERSONAS.map((p) => <button key={p.id} onClick={() => { setPersona(p.id); setPersonaOpen(false) }} className={`block w-full px-3 py-1.5 text-left text-[12px] ${p.id === persona ? 'text-primary' : 'text-foreground hover:bg-secondary'}`}>{p.label}</button>)}
              </div>
            </>
          )}
        </div>
        <div className="relative ml-auto">
          <button onClick={() => setCmdOpen((o) => !o)} className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1 text-[12px] font-semibold text-primary hover:bg-primary/15"><Wand2 size={13} /> Actions</button>
          {cmdOpen && (
            <>
              <button aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setCmdOpen(false)} />
              <div className="absolute right-0 top-full z-20 mt-1 max-h-80 w-72 overflow-y-auto rounded-xl border border-border bg-popover py-1 shadow-2xl">
                {COMMANDS.map((g) => (
                  <div key={g.group}>
                    <p className="px-3 pb-0.5 pt-1.5 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{g.group}</p>
                    {g.items.map((it) => <button key={it} onClick={() => { setCmdOpen(false); void send(it) }} className="block w-full px-3 py-1 text-left text-[12px] text-foreground hover:bg-secondary">{it}</button>)}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* transcript */}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto py-5">
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <PrimeOSMark size={72} />
            <h2 className="mt-5 font-display text-2xl font-semibold text-foreground">How can PrimeOS help?</h2>
            <p className="mt-1.5 max-w-md text-sm text-muted-foreground">Brainstorm, draft, and shape scripts, ad copy, and automations — switch the expert lens and model anytime.</p>
            <div className="mt-6 flex max-w-lg flex-wrap justify-center gap-2">
              {QUICK_NONE.map((q) => <button key={q} onClick={() => send(q)} className="rounded-full border border-border px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-secondary">{q}</button>)}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {turns.map((t, i) => (
              <div key={i} className={`group flex gap-3 ${t.role === 'user' ? 'justify-end' : ''}`}>
                {t.role === 'assistant' && <PrimeOSMark size={26} className="mt-0.5" />}
                <div className={t.role === 'user' ? 'max-w-[80%]' : 'min-w-0 flex-1'}>
                  <div className={`break-words rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed ${t.role === 'user' ? 'whitespace-pre-wrap bg-primary text-primary-foreground' : 'bg-card text-foreground'}`}>
                    {t.role === 'assistant' ? (t.text ? <Markdown text={t.text} /> : (loading ? <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Sparkles size={13} /> thinking…</span> : '')) : t.text}
                  </div>
                  {t.role === 'assistant' && t.text && (
                    <div className="mt-1.5 flex items-center gap-3 opacity-0 transition-opacity group-hover:opacity-100">
                      <button onClick={() => copyText(t.text, i)} className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground">{copied === i ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}</button>
                      <button onClick={() => regenerate(i)} disabled={loading} className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-40"><RotateCcw size={12} /> Regenerate</button>
                    </div>
                  )}
                  {t.role === 'user' && (
                    <div className="mt-1 flex items-center justify-end gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                      <button onClick={() => void send(t.text)} disabled={loading} className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"><RotateCcw size={12} /> Rerun</button>
                      <button onClick={() => { setInput(t.text); setTimeout(() => taRef.current?.focus(), 0) }} className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"><Pencil size={12} /> Edit</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && turns[turns.length - 1]?.role === 'user' && (
              <div className="flex items-center gap-2 text-[13px] text-muted-foreground"><PrimeOSMark size={22} pondering spinning /> PrimeOS is thinking…</div>
            )}
          </div>
        )}
      </div>

      {/* composer */}
      <div className="pb-1 pt-2">
        <div className="flex items-end gap-1.5 rounded-2xl border border-border bg-card px-3 py-2 shadow-sm transition-colors focus-within:border-primary/50">
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input) }
              else if (e.key === 'ArrowUp' && !input.trim()) { const last = [...turns].reverse().find((t) => t.role === 'user'); if (last) { e.preventDefault(); setInput(last.text) } }
            }}
            rows={1}
            placeholder="Message PrimeOS…"
            className="max-h-40 min-h-[30px] flex-1 resize-none bg-transparent py-1 text-[14px] leading-snug text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button onClick={toggleRecord} title={recording ? 'Stop dictation' : 'Dictate (voice to text)'} className={`grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg transition-colors ${recording ? 'animate-pulse bg-destructive/15 text-destructive' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}><Mic size={16} /></button>
          {loading ? (
            <button onClick={stop} title="Stop" className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg bg-destructive/90 text-white hover:opacity-90"><Square size={14} /></button>
          ) : (
            <button onClick={() => void send(input)} disabled={!input.trim()} title="Send (Enter)" className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"><CornerDownLeft size={15} /></button>
          )}
        </div>
        <p className="px-1 pt-1.5 text-center text-[10px] text-muted-foreground">PrimeOS can make mistakes. Verify important details. Enter to send · Shift+Enter for a new line.</p>
      </div>
    </div>
  )
}
