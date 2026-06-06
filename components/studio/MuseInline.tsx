'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Aperture, ChevronDown, X, CornerDownLeft, Replace, CornerDownRight, Copy, Loader2, Check } from 'lucide-react'
import { modelsByModality } from '@/lib/ai/models'

type Turn = { role: 'user' | 'assistant'; text: string; applicable?: boolean }
const QUICK = ['Improve writing', 'Make it shorter', 'Make it longer', 'Fix spelling & grammar', 'More formal', 'More casual', 'Rephrase']

export default function MuseInline({
  selText,
  rect,
  isLight,
  onApply,
  onClose,
}: {
  selText: string
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
        body: JSON.stringify({ modelId: model, instruction: text, selection: selText, history }),
      })
      const j = await res.json()
      let reply: string
      let applicable = false
      if (j.needsKey) reply = `Add a ${j.needsKey} to enable ${modelLabel}. Muse is fully wired — it answers the moment a key is set.`
      else if (j.unsupported) reply = j.message
      else if (j.error) reply = `Couldn’t reach the model: ${j.error}`
      else { reply = j.reply || '(empty response)'; applicable = true }
      setTurns((t) => [...t, { role: 'assistant', text: reply, applicable }])
    } catch (e) {
      setTurns((t) => [...t, { role: 'assistant', text: `Request failed: ${(e as Error).message}` }])
    } finally {
      setLoading(false)
    }
  }

  // position below the selection, clamped to the viewport
  const W = 380
  const left = rect ? Math.min(Math.max(8, rect.left), (typeof window !== 'undefined' ? window.innerWidth : 1200) - W - 8) : 80
  const top = rect ? Math.min(rect.bottom + 8, (typeof window !== 'undefined' ? window.innerHeight : 800) - 80) : 80

  const surface = isLight ? 'border-black/10 bg-white' : 'border-white/10 bg-[#0f1c3f]'
  const subtle = isLight ? 'text-gray-500' : 'text-gray-400'

  return (
    <div
      className={`fixed z-[60] flex max-h-[60vh] w-[380px] max-w-[calc(100vw-16px)] flex-col rounded-2xl border shadow-2xl ${surface}`}
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* header */}
      <div className={`flex items-center gap-2 border-b px-3 py-2 ${isLight ? 'border-black/10' : 'border-white/10'}`}>
        <Aperture size={16} className="text-primary" />
        <span className={`text-sm font-semibold ${isLight ? 'text-gray-800' : 'text-gray-100'}`}>Muse</span>
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

      {/* selected context */}
      <div className={`border-b px-3 py-1.5 ${isLight ? 'border-black/10' : 'border-white/10'}`}>
        <p className={`line-clamp-2 text-[11px] italic ${subtle}`}>“{selText}”</p>
      </div>

      {/* transcript */}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {turns.length === 0 && !loading && (
          <div className="flex flex-wrap gap-1.5 py-1">
            {QUICK.map((q) => (
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
                <div className="mt-1 flex items-center gap-2">
                  <button onClick={() => onApply(t.text, 'replace')} className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline">
                    <Replace size={12} /> Replace
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
              <Loader2 size={13} className="animate-spin" /> Muse is thinking…
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
          placeholder="Tell Muse what to do…"
          className={`max-h-24 min-h-[34px] flex-1 resize-none rounded-lg border px-2.5 py-1.5 text-sm outline-none ${isLight ? 'border-black/10 bg-white text-gray-800 placeholder:text-gray-400' : 'border-white/10 bg-white/5 text-gray-100 placeholder:text-gray-500'}`}
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
    </div>
  )
}
