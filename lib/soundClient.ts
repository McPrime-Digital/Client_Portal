/**
 * Message chime — Batch 14 item 9, rebuilt.
 *
 * Synthesized with WebAudio: no asset to load, no request, and the volume is
 * ours to shape. Played on INCOMING messages only (never your own), throttled
 * so a burst is one sound, and controllable per device.
 *
 * ── WHY IT KEPT GOING SILENT ────────────────────────────────────────────────
 * The old primer registered its unlock listener with `{ once: true }`, which
 * gives audio EXACTLY ONE chance to start. That is not enough, for three
 * reasons that all occur in normal use:
 *
 *   · the one gesture may land before anything has created a context;
 *   · a browser SUSPENDS an AudioContext when the tab is backgrounded — iOS
 *     Safari always does — and after that single listener has fired there is
 *     nothing left to resume it, so the chime works and then stops;
 *   · a client-side navigation can consume it on a page that never plays.
 *
 * So the unlock listener is now PERSISTENT and idempotent: every pointer or
 * key gesture, and every return to visibility, resumes a suspended context.
 * Resuming a running context is a no-op, so the cost is nothing and the
 * failure mode is gone.
 *
 * ── TWO SOUNDS, ONE IDENTITY ────────────────────────────────────────────────
 * The arrival chime is the same everywhere in the product — one sound, so it
 * means one thing. The only variant is `playInThreadChime`: when the message
 * lands in the conversation you are ALREADY LOOKING AT, you do not need to be
 * told to come and look. That one is a single soft note at a fraction of the
 * gain — a nudge that something arrived below, not an announcement.
 */

import { pushPref } from '@/lib/prefsSync'

const KEY = 'genreline-message-sound'
const VOLUME_KEY = 'genreline-message-volume'
const FOCUS_KEY = 'genreline-focus'
const THROTTLE_MS = 1200

export type SoundVolume = 'off' | 'low' | 'medium' | 'high'

/** Master gain per setting. Tuned so `high` is present in a noisy room and
 *  `low` is still audible on laptop speakers — a chime nobody can hear is the
 *  same as no chime. */
const VOLUME_GAIN: Record<SoundVolume, number> = {
  off: 0,
  low: 0.07,
  medium: 0.14,
  high: 0.26,
}

export const VOLUMES: { value: SoundVolume; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

let lastPlayed = 0
let ctx: AudioContext | null = null
let primed = false

type AudioCtor = typeof AudioContext

function audioCtor(): AudioCtor | undefined {
  if (typeof window === 'undefined') return undefined
  return (
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: AudioCtor }).webkitAudioContext
  )
}

/** Get (or lazily build) the context and nudge it out of suspension. */
function liveContext(): AudioContext | null {
  try {
    const Ctor = audioCtor()
    if (!Ctor) return null
    ctx = ctx ?? new Ctor()
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    return ctx
  } catch {
    return null
  }
}

/**
 * Call once per page (idempotent). Attaches PERSISTENT listeners that resume
 * audio on any gesture and on every return to visibility — see the header for
 * why `{ once: true }` was the bug rather than an optimisation.
 */
export function primeAudio(): void {
  if (typeof window === 'undefined' || primed) return
  primed = true
  const resume = () => { liveContext() }
  // Passive: these never preventDefault, and the browser can scroll without
  // waiting on them.
  window.addEventListener('pointerdown', resume, { passive: true })
  window.addEventListener('keydown', resume, { passive: true })
  window.addEventListener('touchstart', resume, { passive: true })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resume()
  })
}

/** True when a chime would actually be audible right now. For diagnostics and
 *  for a settings panel that should not claim sound is on when it is not. */
export function audioReady(): boolean {
  return ctx !== null && ctx.state === 'running'
}

/** Focus mode: this device chimes for nothing; per-room server prefs still
 *  decide push. Mentions push server-side unless a room is muted. */
export function focusModeEnabled(): boolean {
  try {
    return localStorage.getItem(FOCUS_KEY) === 'on'
  } catch {
    return false
  }
}

export function setFocusModeEnabled(on: boolean): void {
  try { localStorage.setItem(FOCUS_KEY, on ? 'on' : 'off') } catch { /* non-persistent */ }
  pushPref({ focus: on ? 'on' : 'off' })
}

export function messageSoundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

export function setMessageSoundEnabled(on: boolean): void {
  try { localStorage.setItem(KEY, on ? 'on' : 'off') } catch { /* non-persistent */ }
  pushPref({ sound: on ? 'on' : 'off' })
}

export function soundVolume(): SoundVolume {
  try {
    const v = localStorage.getItem(VOLUME_KEY)
    return v === 'off' || v === 'low' || v === 'high' ? v : 'medium'
  } catch {
    return 'medium'
  }
}

export function setSoundVolume(v: SoundVolume): void {
  try { localStorage.setItem(VOLUME_KEY, v) } catch { /* non-persistent */ }
  pushPref({ soundVolume: v })
}

function gainNow(): number {
  if (!messageSoundEnabled() || focusModeEnabled()) return 0
  return VOLUME_GAIN[soundVolume()]
}

/**
 * A message landed somewhere you are NOT looking. The product's one sound.
 * Two soft sine notes a fourth apart — present without being an interruption.
 */
export function playMessageChime(): void {
  if (typeof window === 'undefined') return
  const g = gainNow()
  if (g === 0) return
  const now = Date.now()
  if (now - lastPlayed < THROTTLE_MS) return
  lastPlayed = now
  playChime(g)
}

/**
 * A message landed in the conversation you are ALREADY READING. You do not
 * need summoning — this is a single soft note at a third of the gain, saying
 * "something arrived below" and nothing more.
 */
export function playInThreadChime(): void {
  if (typeof window === 'undefined') return
  const g = gainNow()
  if (g === 0) return
  const now = Date.now()
  if (now - lastPlayed < THROTTLE_MS) return
  lastPlayed = now
  playChime(g * 0.34, true)
}

/** The settings panel plays this so "is the sound working" answers itself —
 *  at the CHOSEN volume, and ignoring the throttle. */
export function playTestChime(): void {
  if (typeof window === 'undefined') return
  const g = VOLUME_GAIN[soundVolume()]
  if (g === 0) return
  playChime(g)
}

function playChime(masterGain: number, subtle = false): void {
  try {
    const c = liveContext()
    if (!c) return

    const t0 = c.currentTime
    const master = c.createGain()
    master.gain.value = masterGain
    master.connect(c.destination)

    const note = (freq: number, at: number, len: number) => {
      const osc = c.createOscillator()
      const gain = c.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t0 + at)
      gain.gain.exponentialRampToValueAtTime(1, t0 + at + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len)
      osc.connect(gain)
      gain.connect(master)
      osc.start(t0 + at)
      osc.stop(t0 + at + len + 0.03)
    }

    if (subtle) {
      // One note, shorter, lower — a tick, not a phrase.
      note(740, 0, 0.13)
    } else {
      note(660, 0, 0.22)
      note(880, 0.09, 0.22)
    }
  } catch {
    // audio is a nicety; never let it throw into a message handler
  }
}
