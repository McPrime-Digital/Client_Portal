/**
 * Message chime — Batch 14 item 9. A deliberately subtle two-note blip,
 * synthesized with WebAudio so there is no asset to load, no request, and
 * the volume is ours to keep low. Played on INCOMING messages only (never
 * your own), throttled so a burst of messages is one sound, and muteable
 * per browser via localStorage (the per-room server-side preference is
 * message_room_prefs — this is the device-level master switch).
 */

import { pushPref } from '@/lib/prefsSync'

const KEY = 'genreline-message-sound'
const THROTTLE_MS = 1500

let lastPlayed = 0
let ctx: AudioContext | null = null
let primed = false

/**
 * Browsers refuse to start audio without a user gesture, and a chime whose
 * AudioContext is born inside a realtime callback stays suspended forever —
 * which is why "the sound is non-existent" until this exists. Call once per
 * page (idempotent): the first pointer/key gesture creates and resumes the
 * context, and every later chime plays.
 */
export function primeAudio(): void {
  if (typeof window === 'undefined' || primed) return
  primed = true
  const unlock = () => {
    try {
      type AudioCtor = typeof AudioContext
      const Ctor: AudioCtor | undefined =
        window.AudioContext ??
        (window as Window & { webkitAudioContext?: AudioCtor }).webkitAudioContext
      if (!Ctor) return
      ctx = ctx ?? new Ctor()
      void ctx.resume().catch(() => {})
    } catch { /* audio is a nicety */ }
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
  }
  window.addEventListener('pointerdown', unlock, { once: true })
  window.addEventListener('keydown', unlock, { once: true })
}

const FOCUS_KEY = 'genreline-focus'

/** Focus mode (item 6a): this device chimes for nothing; per-room server
 *  prefs decide push. Mentions still push server-side unless a room is muted. */
export function focusModeEnabled(): boolean {
  try {
    return localStorage.getItem(FOCUS_KEY) === 'on'
  } catch {
    return false
  }
}

export function setFocusModeEnabled(on: boolean): void {
  try {
    localStorage.setItem(FOCUS_KEY, on ? 'on' : 'off')
  } catch { /* non-persistent */ }
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
  pushPref({ sound: on ? 'on' : 'off' })
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    // storage unavailable — the toggle simply doesn't persist
  }
}

export function playMessageChime(): void {
  if (typeof window === 'undefined') return
  if (!messageSoundEnabled() || focusModeEnabled()) return
  const now = Date.now()
  if (now - lastPlayed < THROTTLE_MS) return
  lastPlayed = now
  playChime()
}

/** The toggle plays this on enable so "is the sound working" answers itself. */
export function playTestChime(): void {
  if (typeof window === 'undefined') return
  playChime()
}

function playChime(): void {

  try {
    type AudioCtor = typeof AudioContext
    const Ctor: AudioCtor | undefined =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: AudioCtor }).webkitAudioContext
    if (!Ctor) return
    ctx = ctx ?? new Ctor()
    // Browsers suspend fresh contexts until a user gesture; resume is a
    // no-op when already running and silently fails when not allowed.
    void ctx.resume().catch(() => {})

    const t0 = ctx.currentTime
    const master = ctx.createGain()
    master.gain.value = 0.12 // subtle but AUDIBLE — a presence, not an interruption
    master.connect(ctx.destination)

    // Two soft sine notes a fourth apart, 90ms each, gentle decay.
    const note = (freq: number, at: number) => {
      const osc = ctx!.createOscillator()
      const gain = ctx!.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t0 + at)
      gain.gain.exponentialRampToValueAtTime(1, t0 + at + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.22)
      osc.connect(gain)
      gain.connect(master)
      osc.start(t0 + at)
      osc.stop(t0 + at + 0.25)
    }
    note(660, 0)
    note(880, 0.09)
  } catch {
    // audio is a nicety; never let it throw into a message handler
  }
}
