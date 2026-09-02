/**
 * Preference sync — Batch 20.3.
 *
 * localStorage is the zero-latency CACHE; the user_prefs row (0034) is the
 * DURABLE copy. At mount (PresencePulse, so both portals get it) hydrate
 * the cache from the server and announce it; on every change the setter
 * writes the cache synchronously and pushes the patch through. A signed-in
 * user therefore keeps their wallpaper, sound, focus, mention trigger and
 * sticky project tags across logout, refresh and a brand-new device.
 *
 * Failure posture: the push is best-effort (the cache already holds the
 * value, the next successful push carries the full key), but failures are
 * LOGGED — not swallowed silently (I-10).
 */

const KEYS: Record<string, string> = {
  wallpaperPattern: 'genreline-wallpaper',
  wallpaperIntensity: 'genreline-wallpaper-intensity',
  sound: 'genreline-message-sound',
  focus: 'genreline-focus',
  mentionTrigger: 'genreline-mention-trigger',
}

export const PREFS_EVENT = 'genreline:prefs'

/** Pull the durable copy into localStorage and tell mounted UIs to re-read. */
export async function hydratePrefs(): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    const res = await fetch('/api/prefs')
    if (!res.ok) return
    const { chat } = (await res.json()) as { chat?: Record<string, unknown> }
    if (!chat) return
    let changed = false
    for (const [prefKey, lsKey] of Object.entries(KEYS)) {
      const v = chat[prefKey]
      if (typeof v === 'string' && localStorage.getItem(lsKey) !== v) {
        localStorage.setItem(lsKey, v)
        changed = true
      }
    }
    const tags = chat.roomTag
    if (tags && typeof tags === 'object' && !Array.isArray(tags)) {
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
  void fetch('/api/prefs', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat }),
  }).then((res) => {
    if (!res.ok) console.error('prefs push failed', res.status)
  }).catch((e) => {
    console.error('prefs push failed', e)
  })
}
