'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Play, Lock } from 'lucide-react'
import ColourCheck from '@/components/studio/ColourCheck'

/**
 * THE SCREENING ROOM — a cut, shown to somebody with no account, traceably.
 *
 * ── THE WATERMARK IS AIMED AT THE ACTUAL LEAK VECTOR ────────────────────
 *
 * Screeners leak by somebody pointing a screen recorder at them. So the mark is
 * rendered IN THE PLAYER, over the picture, bearing the viewer's own identity,
 * their IP and the time — a screen capture carries it. And it MOVES, slowly,
 * because a mark parked in a corner is cropped out in thirty seconds.
 *
 * Frame.io charges Enterprise for this. Dropbox Replay includes it on every paid
 * plan, which is the right side of that argument to be on.
 *
 * It is NOT invisible forensic watermarking — that needs a per-recipient encode,
 * and `facebookresearch/videoseal` (MIT) is the tool for it once there is a GPU
 * worker on the queue. Claiming protection we do not have would be worse than
 * claiming none, so the page says what it does.
 *
 * ── PROGRESS IS EVIDENCE, NOT ANALYTICS ─────────────────────────────────
 *
 * Every review tool records views for an engagement dashboard. This one records
 * them so an APPROVAL can say what the approver actually saw: somebody who
 * opened a cut for four seconds and approved it is a different record from
 * somebody who watched ninety-two percent of it. `furthest_ms` is a high-water
 * mark — scrubbing back must not erase having reached the end.
 *
 * The heartbeat is throttled and also fires on `pagehide`, because the most
 * interesting view is the one where somebody closes the tab.
 */

type Opened = {
  viewId: string | null
  url: string
  fileName: string
  allowDownload: boolean
  watermark: { label: string; ip: string; at: string } | null
  colour: { colourSpace: string | null; transfer: string | null; bitDepth: number | null }
}

const HEARTBEAT_MS = 10_000

export default function ScreeningRoom({
  token, requireEmail, hasPasscode, title,
}: {
  token: string
  requireEmail: boolean
  hasPasscode: boolean
  title: string
}) {
  const [opened, setOpened] = useState<Opened | null>(null)
  const [email, setEmail] = useState('')
  const [passcode, setPasscode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const video = useRef<HTMLVideoElement | null>(null)
  const watched = useRef(0)
  const furthest = useRef(0)
  const lastBeat = useRef(0)

  async function open(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'open', token,
          email: email.trim() || null,
          passcode: passcode || null,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(j?.error ?? 'Could not open this.'); return }
      setOpened(j as Opened)
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  const beat = useCallback((force = false) => {
    const v = opened
    if (!v?.viewId) return
    const now = Date.now()
    if (!force && now - lastBeat.current < HEARTBEAT_MS) return
    lastBeat.current = now

    const body = JSON.stringify({
      action: 'heartbeat', token, viewId: v.viewId,
      secondsWatched: Math.round(watched.current),
      furthestMs: Math.round(furthest.current),
      durationMs: video.current?.duration ? Math.round(video.current.duration * 1000) : null,
    })
    if (force) {
      // The most interesting view is the one that ends by closing the tab, and
      // sendBeacon is the only thing that reliably survives it.
      try { navigator.sendBeacon?.('/api/share', new Blob([body], { type: 'application/json' })) }
      catch { /* the last throttled beat already recorded most of it */ }
      return
    }
    void fetch('/api/share', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    }).catch(() => {})
  }, [opened, token])

  useEffect(() => {
    if (!opened?.viewId) return
    const onHide = () => beat(true)
    window.addEventListener('pagehide', onHide)
    const t = setInterval(() => beat(), HEARTBEAT_MS)
    return () => { window.removeEventListener('pagehide', onHide); clearInterval(t) }
  }, [opened, beat])

  if (!opened) {
    return (
      <form onSubmit={open} className="squircle mx-auto max-w-sm space-y-3 border border-border bg-card p-5">
        <p className="text-[13px] text-muted-foreground">
          {hasPasscode || requireEmail
            ? 'A moment before you watch.'
            : 'Ready when you are.'}
        </p>

        {requireEmail && (
          <input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com" aria-label="Your email" required maxLength={320}
            className="squircle-sm w-full border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-ring"
          />
        )}
        {hasPasscode && (
          <input
            type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)}
            placeholder="Passcode" aria-label="Passcode" maxLength={200}
            className="squircle-sm w-full border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-ring"
          />
        )}

        <button
          type="submit" disabled={busy}
          className="squircle-sm inline-flex w-full items-center justify-center gap-2 bg-primary px-4 py-2.5 text-[14px] font-semibold text-primary-foreground outline-none transition-[opacity,transform] duration-[--dur-pop] ease-[--ease-out] hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] disabled:opacity-40"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
          Watch {title}
        </button>

        {requireEmail && (
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-faint">
            <Lock size={11} className="mt-px shrink-0" />
            Your address and the time are shown across the picture while it plays,
            and this viewing is recorded.
          </p>
        )}
        {error && <p role="status" className="text-[12px] text-destructive">{error}</p>}
      </form>
    )
  }

  return (
    <div>
      <div className="squircle relative overflow-hidden bg-black">
        <video
          ref={video}
          src={opened.url}
          controls
          playsInline
          controlsList={opened.allowDownload ? undefined : 'nodownload'}
          onContextMenu={(e) => { if (!opened.allowDownload) e.preventDefault() }}
          className="block w-full bg-black"
          onTimeUpdate={(e) => {
            const t = e.currentTarget.currentTime * 1000
            // HIGH-WATER MARK. Scrubbing back does not undo having got here.
            if (t > furthest.current) furthest.current = t
            watched.current = Math.max(watched.current, e.currentTarget.currentTime)
            beat()
          }}
          onEnded={() => beat(true)}
        />

        {opened.watermark && (
          // Moving, so it cannot be cropped; low contrast, so it is legible on a
          // capture without ruining the review.
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="gl-watermark absolute whitespace-nowrap text-[11px] font-medium tracking-wide text-white/35 mix-blend-difference">
              {opened.watermark.label}
              {opened.watermark.ip ? ` · ${opened.watermark.ip}` : ''}
              {' · '}
              {new Date(opened.watermark.at).toLocaleString('en-US')}
            </div>
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <ColourCheck
          colourSpace={opened.colour.colourSpace}
          transfer={opened.colour.transfer}
          bitDepth={opened.colour.bitDepth}
        />
        {!opened.allowDownload && (
          <p className="text-[11px] text-faint">Viewing only — no download.</p>
        )}
      </div>

      <style>{`
        @keyframes gl-wm {
          0%   { top: 12%; left: 6%;  opacity: .30 }
          25%  { top: 68%; left: 58%; opacity: .22 }
          50%  { top: 34%; left: 30%; opacity: .32 }
          75%  { top: 80%; left: 12%; opacity: .24 }
          100% { top: 12%; left: 6%;  opacity: .30 }
        }
        .gl-watermark { animation: gl-wm 47s linear infinite; }
        @media (prefers-reduced-motion: reduce) {
          /* Still present, still identifying — only the drift stops. A
             watermark is not decoration and must not be removable by a
             preference. */
          .gl-watermark { animation: none; top: 8%; left: 6%; }
        }
      `}</style>
    </div>
  )
}
