'use client'

import { useMemo, useRef, useState } from 'react'
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  RotateCcw,
  RotateCw,
  Music,
} from 'lucide-react'

function fmt(t: number) {
  if (!isFinite(t) || t < 0) return '0:00'
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const RATES = [1, 1.25, 1.5, 1.75, 2]

/**
 * A self-contained, professional audio player used by the file
 * viewer for music, audio and voice notes. Custom controls over a
 * hidden <audio> element: play/pause, scrub, ±10s, volume, speed.
 */
export default function AudioPlayer({
  src,
  name,
  compact = false,
}: {
  src: string
  name?: string
  /** Slim single-row layout for inline use (e.g. chat bubbles). */
  compact?: boolean
}) {
  const ref = useRef<HTMLAudioElement>(null)
  // MediaRecorder webm clips report duration=Infinity until scanned;
  // we seek to the end once to force the browser to compute it.
  const measuringRef = useRef(false)
  const [playing, setPlaying] = useState(false)
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState(0)
  const [vol, setVol] = useState(1)
  const [muted, setMuted] = useState(false)
  const [rate, setRate] = useState(1)

  // Stable pseudo-random bar heights for the compact voice-note waveform.
  const waveBars = useMemo(
    () =>
      Array.from({ length: 40 }, (_, i) => {
        const r = Math.abs(Math.sin((i + 1) * 12.9898) * 43758.5453) % 1
        return 0.3 + r * 0.7
      }),
    []
  )

  function toggle() {
    const el = ref.current
    if (!el) return
    if (el.paused) {
      el.play()
      setPlaying(true)
    } else {
      el.pause()
      setPlaying(false)
    }
  }

  function seek(to: number) {
    const el = ref.current
    if (!el) return
    el.currentTime = Math.max(0, Math.min(to, dur || 0))
    setCur(el.currentTime)
  }

  function cycleRate() {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length]
    setRate(next)
    if (ref.current) ref.current.playbackRate = next
  }

  const pct = dur > 0 ? (cur / dur) * 100 : 0

  const audioEl = (
    <audio
      ref={ref}
      src={src}
      preload="metadata"
      onLoadedMetadata={(e) => {
        const d = e.currentTarget.duration
        if (isFinite(d) && d > 0) {
          setDur(d)
        } else {
          // Force the browser to resolve a real duration.
          measuringRef.current = true
          try {
            e.currentTarget.currentTime = 1e7
          } catch {
            /* ignore */
          }
        }
      }}
      onDurationChange={(e) => {
        const d = e.currentTarget.duration
        if (isFinite(d) && d > 0) {
          setDur(d)
          if (measuringRef.current) {
            measuringRef.current = false
            e.currentTarget.currentTime = 0
            setCur(0)
          }
        }
      }}
      onTimeUpdate={(e) => {
        if (!measuringRef.current) setCur(e.currentTarget.currentTime)
      }}
      onEnded={() => setPlaying(false)}
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
    />
  )

  if (compact) {
    const played = dur > 0 ? cur / dur : 0
    return (
      <div className="flex w-full items-center gap-2.5">
        {audioEl}
        <button
          onClick={toggle}
          className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
        </button>
        <div className="relative flex-1">
          <div className="flex h-7 items-center gap-[2px]">
            {waveBars.map((h, i) => (
              <span
                key={i}
                className="flex-1 rounded-full"
                style={{
                  height: `${Math.round(h * 100)}%`,
                  backgroundColor:
                    i / waveBars.length <= played
                      ? 'hsl(var(--primary))'
                      : 'hsl(var(--muted-foreground) / 0.3)',
                }}
              />
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={dur || 0}
            step="any"
            value={cur}
            onChange={(e) => seek(parseFloat(e.target.value))}
            aria-label="Seek"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </div>
        <span className="flex-shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {fmt(cur > 0 ? cur : dur)}
        </span>
      </div>
    )
  }

  return (
    <div className="w-full max-w-xl mx-auto rounded-2xl border border-border bg-card p-6 sm:p-8">
      {audioEl}

      {/* Artwork / glyph */}
      <div className="flex flex-col items-center text-center gap-4">
        <div className="grid h-24 w-24 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Music size={40} />
        </div>
        {name && (
          <p className="max-w-full truncate text-sm font-semibold text-foreground">
            {name}
          </p>
        )}
      </div>

      {/* Scrubber */}
      <div className="mt-6">
        <div className="relative h-1.5 w-full rounded-full bg-secondary">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-primary"
            style={{ width: `${pct}%` }}
          />
          <input
            type="range"
            min={0}
            max={dur || 0}
            step="any"
            value={cur}
            onChange={(e) => seek(parseFloat(e.target.value))}
            aria-label="Seek"
            className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent
              [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow"
          />
        </div>
        <div className="mt-2 flex justify-between text-xs tabular-nums text-muted-foreground">
          <span>{fmt(cur)}</span>
          <span>{fmt(dur)}</span>
        </div>
      </div>

      {/* Transport */}
      <div className="mt-5 flex items-center justify-center gap-5">
        <button
          onClick={() => seek(cur - 10)}
          className="text-muted-foreground transition-colors hover:text-foreground"
          title="Back 10s"
          aria-label="Back 10 seconds"
        >
          <RotateCcw size={20} />
        </button>

        <button
          onClick={toggle}
          className="grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground shadow transition-transform hover:scale-105"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause size={24} /> : <Play size={24} className="ml-0.5" />}
        </button>

        <button
          onClick={() => seek(cur + 10)}
          className="text-muted-foreground transition-colors hover:text-foreground"
          title="Forward 10s"
          aria-label="Forward 10 seconds"
        >
          <RotateCw size={20} />
        </button>
      </div>

      {/* Volume + speed */}
      <div className="mt-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const m = !muted
              setMuted(m)
              if (ref.current) ref.current.muted = m
            }}
            className="text-muted-foreground transition-colors hover:text-foreground"
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted || vol === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : vol}
            onChange={(e) => {
              const v = parseFloat(e.target.value)
              setVol(v)
              setMuted(v === 0)
              if (ref.current) {
                ref.current.volume = v
                ref.current.muted = v === 0
              }
            }}
            aria-label="Volume"
            className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-secondary
              [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-foreground"
          />
        </div>

        <button
          onClick={cycleRate}
          className="rounded-md px-2.5 py-1 text-xs font-semibold tabular-nums text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          title="Playback speed"
        >
          {rate}×
        </button>
      </div>
    </div>
  )
}
