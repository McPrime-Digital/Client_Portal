/**
 * Chat appearance preferences — Batch 17, wallpapers rebuilt.
 *
 * The wallpaper pattern, its intensity and the message volume are the
 * viewer's own; server-side room prefs stay about notifications.
 *
 * ── THE WALLPAPER SET ───────────────────────────────────────────────────────
 * RETIRED: `aurora`, `waves`, `grid`. They read as generic web decoration
 * rather than as a tool a production studio works in all day.
 *
 * Everything here is drawn in CSS or inline SVG — no image files, no HTTP
 * request, no asset weight, sharp on any display, and each one derives its
 * colour from the theme tokens so light and dark are one rule rather than two
 * exports that drift. A chat background has to sit UNDER text for hours; that
 * rules out photography regardless of where it came from.
 */

import { pushPref } from '@/lib/prefsSync'

const PATTERN_KEY = 'genreline-wallpaper'
const INTENSITY_KEY = 'genreline-wallpaper-intensity'

export type WallpaperPattern =
  // Photographic, self-hosted (public/wallpapers, Unsplash License).
  | 'slate'    // dark slate with a natural vignette
  | 'plaster'  // soft dark plaster wall
  | 'onyx'     // near-black painted surface
  | 'silk'     // glossy black silk
  | 'velvet'   // dark velvet folds
  | 'ribbon'   // black sculptural ribbons
  // Drawn, for anyone who wants texture without a photograph.
  | 'dots'
  | 'film'
  | 'none'

export type WallpaperIntensity = 'faint' | 'medium' | 'bold'

export const WALLPAPERS: { value: WallpaperPattern; label: string }[] = [
  { value: 'slate', label: 'Slate' },
  { value: 'plaster', label: 'Plaster' },
  { value: 'onyx', label: 'Onyx' },
  { value: 'silk', label: 'Silk' },
  { value: 'velvet', label: 'Velvet' },
  { value: 'ribbon', label: 'Ribbon' },
  { value: 'dots', label: 'Dots' },
  { value: 'film', label: 'Film' },
  { value: 'none', label: 'None' },
]

/** The photographic ones, which need the theme-aware treatment in globals.css
 *  (they are all shot dark; light mode inverts them). */
export const PHOTO_WALLPAPERS = new Set<WallpaperPattern>([
  'slate', 'plaster', 'onyx', 'silk', 'velvet', 'ribbon',
])

const VALID = new Set<string>(WALLPAPERS.map((w) => w.value))

/**
 * Retired values map to their nearest survivor rather than snapping everyone
 * back to the default. Someone who chose the soft gradient wash gets the
 * other soft wash, not a hard reset — a stored preference is a decision, and
 * the closest honouring of it beats discarding it.
 */
const RETIRED: Record<string, WallpaperPattern> = {
  // First generation.
  aurora: 'silk',
  waves: 'velvet',
  grid: 'dots',
  // Second generation — the drawn set that replaced them. Kept mappable so a
  // browser holding one of these lands somewhere deliberate rather than being
  // reset, and so its push is never refused (which would strand that device).
  grain: 'plaster',
  filmstrip: 'slate',
  storyboard: 'dots',
  bokeh: 'silk',
  vignette: 'onyx',
}

export const DEFAULT_WALLPAPER: WallpaperPattern = 'plaster'

export const INTENSITY_ALPHA: Record<WallpaperIntensity, number> = {
  faint: 0.45,
  medium: 0.75,
  bold: 1,
}

export function wallpaperPattern(): WallpaperPattern {
  try {
    const v = localStorage.getItem(PATTERN_KEY)
    if (!v) return DEFAULT_WALLPAPER
    if (VALID.has(v)) return v as WallpaperPattern
    return RETIRED[v] ?? DEFAULT_WALLPAPER
  } catch {
    return DEFAULT_WALLPAPER
  }
}

export function setWallpaperPattern(p: WallpaperPattern): void {
  try { localStorage.setItem(PATTERN_KEY, p) } catch { /* non-persistent */ }
  pushPref({ wallpaperPattern: p })
}

export function wallpaperIntensity(): WallpaperIntensity {
  try {
    const v = localStorage.getItem(INTENSITY_KEY)
    return v === 'faint' || v === 'bold' ? v : 'medium'
  } catch {
    return 'medium'
  }
}

export function setWallpaperIntensity(i: WallpaperIntensity): void {
  try { localStorage.setItem(INTENSITY_KEY, i) } catch { /* non-persistent */ }
  pushPref({ wallpaperIntensity: i })
}
