'use client'

import { useEffect, useRef, useState } from 'react'
import { Trash2, Check, Mic } from 'lucide-react'
import { toWavFile } from '@/lib/audioWav'

function fmt(s: number) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

// Reads the live `--primary` token so the waveform matches the
// active theme without hardcoding a colour.
function primaryColor(): string {
  if (typeof window === 'undefined') return 'hsl(40, 57%, 45%)'
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue('--primary')
    .trim()
  return v ? `hsl(${v.replace(/\s+/g, ', ')})` : 'hsl(40, 57%, 45%)'
}

/**
 * Professional voice-note recorder: live frequency waveform, timer,
 * cancel / send. Starts capturing on mount; the parent renders it
 * while recording and removes it afterwards (cleanup runs on unmount).
 */
export default function VoiceRecorder({
  onComplete,
  onCancel,
}: {
  onComplete: (file: File) => void
  onCancel: () => void
}) {
  const [seconds, setSeconds] = useState(0)
  const [ready, setReady] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number>(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const cancelledRef = useRef(false)

  // Keep latest callbacks without re-running the setup effect.
  const onCompleteRef = useRef(onComplete)
  const onCancelRef = useRef(onCancel)
  useEffect(() => {
    onCompleteRef.current = onComplete
    onCancelRef.current = onCancel
  })

  useEffect(() => {
    let active = true

    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (!active) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream

        // Prefer audio/mp4 (AAC) — it plays in every browser including
        // Safari. Fall back to webm/opus on browsers that can't record
        // mp4 (e.g. Chrome). There's no server-side transcode anymore,
        // so picking the most portable container we can record matters.
        const mime = MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : ''
        const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
        chunksRef.current = []
        mr.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data)
        }
        mr.onstop = () => {
          if (cancelledRef.current) return
          const type = mr.mimeType || 'audio/webm'
          const blob = new Blob(chunksRef.current, { type })
          // Universal container (Batch 19): the sender transcodes to WAV so
          // Chrome-recorded notes play on Safari and vice versa — the codec
          // dialect never leaves this device. Falls back to the raw container
          // only if WebAudio decode fails.
          void toWavFile(blob)
            .catch(() => {
              const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'
              return new File([blob], `voice-${Date.now()}.${ext}`, { type })
            })
            .then((file) => onCompleteRef.current(file))
        }
        mr.start()
        recorderRef.current = mr

        // Live waveform
        const AC =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext
        const ctx = new AC()
        audioCtxRef.current = ctx
        const sourceNode = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 1024
        sourceNode.connect(analyser)
        const data = new Uint8Array(analyser.fftSize)
        const color = primaryColor()

        // WhatsApp-style scrolling waveform: each ~50ms the mic's RMS level
        // becomes a new bar entering from the right, history sliding left —
        // the wave visibly MOVES with the voice instead of flickering in place.
        const levels: number[] = []
        let frame = 0
        let smoothed = 0
        const draw = () => {
          rafRef.current = requestAnimationFrame(draw)
          const canvas = canvasRef.current
          if (!canvas) return
          analyser.getByteTimeDomainData(data)
          let sum = 0
          for (let i = 0; i < data.length; i++) {
            const d = (data[i] - 128) / 128
            sum += d * d
          }
          const rms = Math.sqrt(sum / data.length)
          // Perceptual lift + smoothing so quiet speech still reads.
          smoothed = smoothed * 0.6 + Math.min(1, rms * 3.2) * 0.4

          const dpr = window.devicePixelRatio || 1
          const w = canvas.clientWidth
          const h = canvas.clientHeight
          if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
            canvas.width = w * dpr
            canvas.height = h * dpr
          }
          const slot = 5
          const maxBars = Math.floor(w / slot)
          if (frame++ % 3 === 0) {
            levels.push(smoothed)
            if (levels.length > maxBars) levels.shift()
          }

          const g = canvas.getContext('2d')!
          g.setTransform(dpr, 0, 0, dpr, 0, 0)
          g.clearRect(0, 0, w, h)
          const bw = 3
          for (let i = 0; i < levels.length; i++) {
            const v = levels[i]
            const barH = Math.max(3, v * (h - 4))
            // Newest at the right edge; history slides left. Older bars fade.
            const x = w - (levels.length - i) * slot
            const y = (h - barH) / 2
            g.globalAlpha = 0.35 + 0.65 * (i / levels.length)
            g.fillStyle = color
            if (g.roundRect) {
              g.beginPath()
              g.roundRect(x, y, bw, barH, bw / 2)
              g.fill()
            } else {
              g.fillRect(x, y, bw, barH)
            }
          }
          g.globalAlpha = 1
        }
        draw()

        timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
        setReady(true)
      } catch {
        onCancelRef.current()
      }
    })()

    return () => {
      active = false
      if (timerRef.current) clearInterval(timerRef.current)
      cancelAnimationFrame(rafRef.current)
      audioCtxRef.current?.close().catch(() => {})
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  function finish(send: boolean) {
    cancelledRef.current = !send
    const mr = recorderRef.current
    if (mr && mr.state !== 'inactive') mr.stop()
    if (!send) onCancelRef.current()
  }

  return (
    <div
      className="flex flex-1 items-center gap-3 rounded-xl px-3 py-2"
      style={{
        backgroundColor: 'hsl(var(--card) / 0.9)',
        border: '1px solid hsl(var(--primary) / 0.35)',
        boxShadow: '0 0 16px hsl(var(--primary) / 0.12)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <button
        type="button"
        onClick={() => finish(false)}
        className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
        title="Cancel"
        aria-label="Cancel recording"
      >
        <Trash2 size={16} />
      </button>

      <span className="flex items-center gap-2 flex-shrink-0">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-destructive" />
        <span className="text-xs tabular-nums font-medium text-foreground">
          {fmt(seconds)}
        </span>
      </span>

      <div className="relative flex-1 min-w-0">
        <canvas ref={canvasRef} className="h-9 w-full" />
        {!ready && (
          <span className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Mic size={13} /> Starting microphone…
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={() => finish(true)}
        disabled={!ready}
        className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105 disabled:opacity-50"
        title="Send recording"
        aria-label="Send recording"
      >
        <Check size={16} />
      </button>
    </div>
  )
}
