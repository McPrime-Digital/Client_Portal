'use client'

import { useCallback, useRef, useState } from 'react'
import { PenLine, Clock } from 'lucide-react'
import { timecode } from '@/lib/annotations'

/**
 * THE NOTES, AFTER THE ROOM HAS EMPTIED.
 *
 * A mark made during a review session is worth nothing if it only exists during
 * the review session. Frame.io keeps the note and has no room; Evercast has the
 * room and the note dies with it. This is where the two meet: every annotation
 * on this asset, in timecode order, playable from the frame it was made on.
 *
 * ── IT RE-DRAWS THE MARK, NOT JUST THE TEXT ──────────────────────────────
 *
 * Clicking a note seeks the player AND paints the strokes back over the frame.
 * A list of timecoded sentences would be a comment thread; the reason to draw in
 * the first place is that "the rig is showing on the left" is ambiguous and a
 * circle is not.
 *
 * Strokes are 0–1 of the frame, so they land correctly here at whatever size
 * this player happens to be — which is the entire reason they were stored that
 * way rather than in pixels.
 */

type Annotation = {
  id: string
  anchor_ms: number
  strokes: { x: number; y: number }[][]
  note: string | null
  colour: string
  created_at: string
  author?: string | null
}

export default function AnnotationTimeline({
  fileUrl, annotations, fps = 24,
}: {
  fileUrl: string | null
  annotations: Annotation[]
  /** From the asset when it is known. Frames are how a cutting room reads a
   *  position, and guessing a rate would print a confidently wrong one. */
  fps?: number
}) {
  const video = useRef<HTMLVideoElement | null>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const [active, setActive] = useState<string | null>(null)

  const paint = useCallback((a: Annotation | null) => {
    const c = canvas.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    const r = c.getBoundingClientRect()
    c.width = Math.max(1, Math.round(r.width))
    c.height = Math.max(1, Math.round(r.height))
    ctx.clearRect(0, 0, c.width, c.height)
    if (!a) return
    ctx.strokeStyle = a.colour || '#ff3b30'
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const stroke of a.strokes ?? []) {
      if (!stroke?.length) continue
      ctx.beginPath()
      ctx.moveTo(stroke[0].x * c.width, stroke[0].y * c.height)
      for (const p of stroke.slice(1)) ctx.lineTo(p.x * c.width, p.y * c.height)
      ctx.stroke()
    }
  }, [])

  const go = useCallback((a: Annotation) => {
    setActive(a.id)
    const el = video.current
    if (el) {
      el.pause()
      el.currentTime = a.anchor_ms / 1000
      // Paint after the seek lands, or the strokes sit over the previous frame.
      const once = () => { paint(a); el.removeEventListener('seeked', once) }
      el.addEventListener('seeked', once)
    } else {
      paint(a)
    }
  }, [paint])

  if (annotations.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        No marks yet. Anything drawn on a frame during a review session appears
        here afterwards, at the timecode it was made.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {fileUrl && (
        <div className="squircle relative overflow-hidden bg-black">
          <video ref={video} src={fileUrl} controls playsInline className="block w-full bg-black" />
          <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full" />
        </div>
      )}

      <ol className="space-y-1.5">
        {annotations.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => go(a)}
              className={`squircle-sm flex w-full items-start gap-2.5 border px-3 py-2 text-left outline-none transition-[border-color] duration-[--dur-pop] focus-visible:ring-2 focus-visible:ring-ring ${
                active === a.id
                  ? 'border-[hsl(var(--glow)/0.55)] bg-card'
                  : 'border-border bg-card hover:border-[hsl(var(--glow)/0.35)]'
              }`}
            >
              <PenLine size={12} className="mt-0.5 shrink-0" style={{ color: a.colour }} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono text-[12px] text-foreground">
                    {timecode(a.anchor_ms, fps)}
                  </span>
                  {a.author && (
                    <span className="text-[11px] text-muted-foreground">{a.author}</span>
                  )}
                </span>
                {a.note && (
                  <span className="mt-0.5 block text-[12px] leading-relaxed text-muted-foreground">
                    {a.note}
                  </span>
                )}
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 text-[10px] text-faint">
                <Clock size={9} />
                {new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
