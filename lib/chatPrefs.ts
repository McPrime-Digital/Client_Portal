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
  | 'grain'       // 35mm emulsion grain — the most neutral, and the default
  | 'filmstrip'   // sprocket perforations running the margins
  | 'storyboard'  // faint 16:9 frame ruling, like a storyboard sheet
  | 'slate'       // clapperboard diagonals, heavily subdued
  | 'bokeh'       // defocused lens highlights in the shell's gold
  | 'vignette'    // cinematic edge falloff, no pattern at all
  | 'dots'        // refined: two-tone, finer pitch
  | 'film'        // the original icon scatter, kept
  | 'none'

export type WallpaperIntensity = 'faint' | 'medium' | 'bold'

export const WALLPAPERS: { value: WallpaperPattern; label: string }[] = [
  { value: 'grain', label: 'Grain' },
  { value: 'filmstrip', label: 'Filmstrip' },
  { value: 'storyboard', label: 'Storyboard' },
  { value: 'slate', label: 'Slate' },
  { value: 'bokeh', label: 'Bokeh' },
  { value: 'vignette', label: 'Vignette' },
  { value: 'dots', label: 'Dots' },
  { value: 'film', label: 'Film' },
  { value: 'none', label: 'None' },
]

const VALID = new Set<string>(WALLPAPERS.map((w) => w.value))

/**
 * Retired values map to their nearest survivor rather than snapping everyone
 * back to the default. Someone who chose the soft gradient wash gets the
 * other soft wash, not a hard reset — a stored preference is a decision, and
 * the closest honouring of it beats discarding it.
 */
const RETIRED: Record<string, WallpaperPattern> = {
  aurora: 'bokeh',
  waves: 'vignette',
  grid: 'storyboard',
}

export const DEFAULT_WALLPAPER: WallpaperPattern = 'grain'

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
