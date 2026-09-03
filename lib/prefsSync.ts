/**
 * Preference sync — Batch 20.3, corrected.
 *
 * localStorage is the zero-latency CACHE; the user_prefs row (0034) is the
 * DURABLE copy. At mount (PresencePulse, so both portals get it) hydrate the
 * cache from the server and announce it; on every change the setter writes the
 * cache synchronously and pushes the patch through.
 *
 * ── THE BUG THIS FILE HAD, AND WHY THE WALLPAPER KEPT REVERTING ─────────────
 * `hydratePrefs()` OVERWROTE localStorage with the server value, every time it
 * ran, with no notion of which copy was newer — a write-through cache being
 * clobbered by a stale read. Two things then went wrong together:
 *
 *   1. It ran on EVERY PresencePulse mount, so any client-side navigation
 *      could fire a fresh GET.
 *   2. `pushPref` is fire-and-forget. Between the click and the PUT landing
 *      there is a window in which the server still holds the OLD value.
 *
 * So: pick a wallpaper → cache updates → UI changes → a hydrate resolves with
 * the previous value → cache overwritten → PREFS_EVENT → the UI reverts. The
 * live `user_prefs` row proved it: after weeks of use it held exactly
 * `{"wallpaperPattern": "film"}` and had never once recorded an intensity.
 *
 * ── THE FIX ─────────────────────────────────────────────────────────────────
 *   · Hydrate ONCE per page load (module-level flag), not once per mount. The
 *     durable copy is a seed for a fresh device, not a poll.
 *   · A key with a push IN FLIGHT is never overwritten. The local value is by
 *     definition newer — the user just chose it.
 *   · A key whose push FAILED stays dirty, so a later hydrate cannot silently
 *     replace the user's choice with the value that failed to be replaced.
 *
 * Failure posture unchanged: pushes are best-effort but LOGGED (I-10).
 */

const KEYS: Record<string, string> = {
  wallpaperPattern: 'genreline-wallpaper',
  wallpaperIntensity: 'genreline-wallpaper-intensity',
  sound: 'genreline-message-sound',
  soundVolume: 'genreline-message-volume',
  focus: 'genreline-focus',
  mentionTrigger: 'genreline-mention-trigger',
}

export const PREFS_EVENT = 'genreline:prefs'

/** Keys the user changed locally whose push has not been confirmed. A hydrate
 *  must never overwrite one — the local value is the newer of the two. */
const dirty = new Set<string>()

/** Hydration is a SEED, not a poll: once per page load. Without this every
 *  client-side navigation re-ran the GET and got another chance to clobber. */
let hydrateStarted = false

/** Pull the durable copy into localStorage and tell mounted UIs to re-read. */
export async function hydratePrefs(): Promise<void> {
  if (typeof window === 'undefined') return
  if (hydrateStarted) return
  hydrateStarted = true
  try {
    const res = await fetch('/api/prefs')
    if (!res.ok) return
    const { chat } = (await res.json()) as { chat?: Record<string, unknown> }
    if (!chat) return
    let changed = false
    for (const [prefKey, lsKey] of Object.entries(KEYS)) {
      // The user changed this one and we have not confirmed it landed. Their
      // choice wins over whatever the server still believes.
      if (dirty.has(prefKey)) continue
      const v = chat[prefKey]
      if (typeof v === 'string' && localStorage.getItem(lsKey) !== v) {
        localStorage.setItem(lsKey, v)
        changed = true
      }
    }
    const tags = chat.roomTag
    if (!dirty.has('roomTag') && tags && typeof tags === 'object' && !Array.isArray(tags)) {
      for (const [clientId, projectId] of Object.entries(tags as Record<string, string>)) {
        const lsKey = `genreline-room-tag:${clientId}`
        const want = projectId || null
        if ((localStorage.getItem(lsKey) ?? null) !== want) {
          if (want) localStorage.setItem(lsKey, want)
          else localStorage.removeItem(lsKey)
          changed = true
        }
      }
    }
    if (changed) window.dispatchEvent(new Event(PREFS_EVENT))
  } catch (e) {
    console.error('prefs hydrate failed', e)
  }
}

/** Write-through: push one validated patch to the durable copy. */
export function pushPref(chat: Record<string, unknown>): void {
  if (typeof window === 'undefined') return
  const keys = Object.keys(chat)
  for (const k of keys) dirty.add(k)
  void fetch('/api/prefs', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat }),
  }).then((res) => {
    if (res.ok) {
      // Confirmed durable — a later hydrate may read it back safely.
      for (const k of keys) dirty.delete(k)
    } else {
      // Stays dirty ON PURPOSE. The server holds a value the user has already
      // rejected; letting a hydrate restore it is the revert bug.
      console.error('prefs push failed', res.status)
    }
  }).catch((e) => {
    console.error('prefs push failed', e)
  })
}
