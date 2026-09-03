'use client'

/**
 * Emoji support detection — the half the generator cannot do.
 *
 * lib/emojiData is generated from Unicode with every codepoint verified
 * ASSIGNED, and its header says "so there is no tofu". That guarantee is
 * about the STANDARD, not the viewer: an assigned Unicode 16 emoji is still
 * invisible on a device whose OS font predates it. Assignment says someone
 * may draw it; only this device knows whether its font actually does.
 *
 * So support is measured HERE, once per device, by rendering: each emoji is
 * drawn to a small canvas and rejected when nothing was drawn (invisible),
 * when it matches the font's .notdef tofu box, or when a ZWJ sequence fell
 * apart into its parts (which renders as two or three glyphs, not one).
 * The verdict is cached in localStorage keyed by a version, so the sweep
 * runs once per device generation, not once per picker open.
 */

const CACHE_KEY = 'genreline-emoji-support-v1'

let sessionCache: Set<string> | null = null

/** Checksum of the rendered pixels — equality is all we compare. */
function drawSum(
  ctx: CanvasRenderingContext2D,
  size: number,
  ch: string
): number {
  ctx.clearRect(0, 0, size, size)
  ctx.fillText(ch, 0, 2)
  const data = ctx.getImageData(0, 0, size, size).data
  let sum = 0
  for (let i = 0; i < data.length; i += 7) sum = (sum * 31 + data[i]) | 0
  return sum
}

function detect(all: string[]): Set<string> {
  const bad = new Set<string>()
  const size = 24
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return bad
  ctx.textBaseline = 'top'
  ctx.font = `${size - 6}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`

  // Baselines: a guaranteed-unassigned codepoint (tofu or nothing), and the
  // width of one emoji everyone has, to catch ZWJ sequences that split.
  const tofuSum = drawSum(ctx, size, '\u{10FFFE}')
  const blankSum = drawSum(ctx, size, '')
  const oneWidth = ctx.measureText('\u{1F600}').width || size

  for (const e of all) {
    const w = ctx.measureText(e).width
    // A single emoji is ~1em; a ZWJ sequence that fell apart is ~2-3em.
    if (w > oneWidth * 1.6) {
      bad.add(e)
      continue
    }
    const sum = drawSum(ctx, size, e)
    if (sum === tofuSum || sum === blankSum) bad.add(e)
  }
  return bad
}

/**
 * The set of emoji THIS device cannot draw, out of the given list.
 * Synchronous — ~1,600 draws complete well under a frame budget on first run,
 * and every later call reads the cache.
 */
export function unsupportedEmoji(all: string[]): Set<string> {
  if (typeof window === 'undefined') return new Set()
  if (sessionCache) return sessionCache
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw) {
      sessionCache = new Set(JSON.parse(raw) as string[])
      return sessionCache
    }
  } catch { /* non-persistent */ }
  const bad = detect(all)
  sessionCache = bad
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify([...bad]))
  } catch { /* non-persistent */ }
  return bad
}
