'use client'

import { useCallback, useState } from 'react'
import { useLocalParticipant } from '@livekit/components-react'
import { Track, LocalAudioTrack, LocalVideoTrack } from 'livekit-client'
import { Sparkles, MicVocal, Loader2 } from 'lucide-react'

/**
 * BACKGROUND BLUR AND AI NOISE SUPPRESSION.
 *
 * Both are table stakes for remote dailies in 2026 and neither is decoration: a
 * colourist's kitchen behind them is a distraction, and a partner's keyboard in
 * the background is the reason somebody asks "sorry, say that again" in the
 * middle of a note about shot 47.
 *
 * ── THEY RUN ON THE TRACK, NOT ON THE SERVER ─────────────────────────────
 *
 * `@livekit/track-processors` and `@livekit/krisp-noise-filter` are processors
 * attached to the LOCAL capture, so the cleaned media is what gets published.
 * Nothing is re-encoded server-side, the recording gets the processed signal for
 * free, and — the part that matters for a studio — **the raw camera frame never
 * leaves the machine**.
 *
 * ── LOADED ON DEMAND, DELIBERATELY ───────────────────────────────────────
 *
 * Both ship WASM and models measured in megabytes. A static import would put
 * them in the bundle of every page that reaches a meeting, including people who
 * never turn either on. The dynamic import is what keeps the room's first paint
 * fast.
 *
 * ── FAILURE IS VISIBLE ───────────────────────────────────────────────────
 *
 * An older machine can fail to initialise the processor. The toggle reverts and
 * says so rather than sitting in a lit state that is doing nothing — a blur
 * button that looks on while the room can see your kitchen is worse than no
 * button.
 */
export default function MediaEnhancements() {
  const { localParticipant } = useLocalParticipant()
  const [blur, setBlur] = useState(false)
  const [denoise, setDenoise] = useState(false)
  const [busy, setBusy] = useState<'blur' | 'noise' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const toggleBlur = useCallback(async () => {
    if (busy) return
    setBusy('blur'); setError(null)
    try {
      const pub = localParticipant.getTrackPublication(Track.Source.Camera)
      const track = pub?.track as LocalVideoTrack | undefined
      if (!track) { setError('No camera to process.'); return }

      if (blur) {
        await track.stopProcessor()
        setBlur(false)
      } else {
        const { BackgroundBlur } = await import('@livekit/track-processors')
        await track.setProcessor(BackgroundBlur(12))
        setBlur(true)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Blur is not available on this device.')
      setBlur(false)
    } finally {
      setBusy(null)
    }
  }, [blur, busy, localParticipant])

  const toggleDenoise = useCallback(async () => {
    if (busy) return
    setBusy('noise'); setError(null)
    try {
      const pub = localParticipant.getTrackPublication(Track.Source.Microphone)
      const track = pub?.track as LocalAudioTrack | undefined
      if (!track) { setError('No microphone to process.'); return }

      if (denoise) {
        await track.stopProcessor()
        setDenoise(false)
      } else {
        const { KrispNoiseFilter, isKrispNoiseFilterSupported } =
          await import('@livekit/krisp-noise-filter')
        if (!isKrispNoiseFilterSupported()) {
          setError('This browser cannot run the noise filter.')
          return
        }
        await track.setProcessor(KrispNoiseFilter())
        setDenoise(true)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The noise filter is not available here.')
      setDenoise(false)
    } finally {
      setBusy(null)
    }
  }, [denoise, busy, localParticipant])

  const chip = (on: boolean) =>
    `squircle-sm inline-flex items-center gap-1.5 border px-2.5 py-1 text-[12px] outline-none transition-[border-color,color,transform] duration-[--dur-pop] ease-[--ease-out] focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] disabled:opacity-40 ${
      on
        ? 'border-[hsl(var(--glow)/0.55)] text-foreground'
        : 'border-border text-muted-foreground hover:text-foreground'
    }`

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => void toggleBlur()} disabled={busy !== null} className={chip(blur)}>
        {busy === 'blur' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
        Blur background
      </button>
      <button type="button" onClick={() => void toggleDenoise()} disabled={busy !== null} className={chip(denoise)}>
        {busy === 'noise' ? <Loader2 size={12} className="animate-spin" /> : <MicVocal size={12} />}
        Suppress noise
      </button>
      {error && <span role="status" className="text-[11px] text-destructive">{error}</span>}
    </div>
  )
}
