'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { PenLine, Trash2, Check, Loader2 } from 'lucide-react'

/**
 * DRAW ON THE FRAME, AND THE MARK SURVIVES THE CALL.
 *
 * Frame.io has frame-accurate drawn annotations and no live conferencing.
 * Evercast has the conferencing and its annotations live and die with the
 * session. This is the join: the mark is made live, over the shared playhead,
 * and persisted against the asset at a timecode — so the editor opens it
 * tomorrow at the exact frame, and it lands on the approval record the shot is
 * already under.
 *
 * ── DRAWING PAUSES PLAYBACK, AND THAT IS NOT A LIMITATION ────────────────
 *
 * You cannot draw accurately on a moving picture, and an annotation whose
 * anchor is "somewhere in this second" is worse than none. Entering draw mode
 * pauses — which, because the playhead is shared (0077), pauses it for everybody
 * and puts the whole room on the frame being discussed. That is the behaviour a
 * dailies session actually wants.
 *
 * ── NORMALISED COORDINATES ───────────────────────────────────────────────
 *
 * Every point is stored as 0–1 of the frame, so a mark drawn on a laptop lands
 * in the same place on a reference monitor. Pixels would be right exactly once.
 */

type Point = { x: number; y: number }

export default function AnnotationLayer({
  meetingId, fileId, video, endpoint = '/api/studio/meetings',
}: {
  meetingId: string
  fileId: string | null
  video: React.RefObject<HTMLVideoElement | null>
  endpoint?: string
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [active, setActive] = useState(false)
  const [strokes, setStrokes] = useState<Point[][]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const redraw = useCallback(() => {
    const c = canvas.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.strokeStyle = '#ff3b30'
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const stroke of strokes) {
      if (stroke.length === 0) continue
      ctx.beginPath()
      ctx.moveTo(stroke[0].x * c.width, stroke[0].y * c.height)
      for (const p of stroke.slice(1)) ctx.lineTo(p.x * c.width, p.y * c.height)
      ctx.stroke()
    }
  }, [strokes])

  useEffect(() => { redraw() }, [redraw])

  // Keep the backing store matched to the displayed size, or strokes land
  // offset from the cursor on any non-default zoom.
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const fit = () => {
      const r = c.getBoundingClientRect()
      c.width = Math.max(1, Math.round(r.width))
      c.height = Math.max(1, Math.round(r.height))
      redraw()
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(c)
    return () => ro.disconnect()
  }, [redraw])

  function at(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const r = e.currentTarget.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    }
  }

  async function save() {
    if (busy || strokes.length === 0 || !fileId) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'annotate',
          meetingId,
          fileId,
          // The anchor is the frame on screen — the same millisecond the whole
          // room is parked on.
          anchorMs: Math.round((video.current?.currentTime ?? 0) * 1000),
          strokes,
          note: note.trim() || null,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j?.error ?? 'Could not save that note.')
        return
      }
      setStrokes([]); setNote(''); setActive(false); setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  if (!fileId) return null

  return (
    <>
      <canvas
        ref={canvas}
        onPointerDown={(e) => {
          if (!active) return
          e.currentTarget.setPointerCapture(e.pointerId)
          setDrawing(true)
          setStrokes((s) => [...s, [at(e)]])
        }}
        onPointerMove={(e) => {
          if (!active || !drawing) return
          const p = at(e)
          setStrokes((s) => {
            const copy = s.slice()
            copy[copy.length - 1] = [...copy[copy.length - 1], p]
            return copy
          })
        }}
        onPointerUp={() => setDrawing(false)}
        className={`absolute inset-0 h-full w-full ${active ? 'cursor-crosshair' : 'pointer-events-none'}`}
      />

      <div className="pointer-events-auto absolute bottom-2 left-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            const next = !active
            setActive(next)
            // Drawing on a moving picture produces an anchor nobody can trust.
            if (next) video.current?.pause()
          }}
          className={`squircle-sm inline-flex items-center gap-1.5 border px-2.5 py-1 text-[12px] backdrop-blur outline-none transition-[border-color,color] duration-[--dur-pop] focus-visible:ring-2 focus-visible:ring-ring ${
            active
              ? 'border-[hsl(var(--glow)/0.6)] bg-black/60 text-white'
              : 'border-white/25 bg-black/45 text-white/85 hover:text-white'
          }`}
        >
          <PenLine size={12} /> {active ? 'Drawing' : 'Draw on frame'}
        </button>

        {active && strokes.length > 0 && (
          <>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note…"
              aria-label="Annotation note"
              maxLength={2000}
              className="squircle-sm w-52 border border-white/25 bg-black/45 px-2 py-1 text-[12px] text-white outline-none backdrop-blur placeholder:text-white/50 focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button
              type="button" onClick={() => void save()} disabled={busy}
              className="squircle-sm inline-flex items-center gap-1.5 bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground outline-none transition-opacity duration-[--dur-pop] hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Keep
            </button>
            <button
              type="button" onClick={() => setStrokes([])}
              aria-label="Clear"
              className="squircle-sm border border-white/25 bg-black/45 p-1 text-white/85 outline-none transition-colors duration-[--dur-pop] hover:text-white focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Trash2 size={12} />
            </button>
          </>
        )}

        {saved && <span className="text-[11px] text-white/90">Kept at this frame</span>}
        {error && <span role="status" className="text-[11px] text-destructive">{error}</span>}
      </div>
    </>
  )
}
