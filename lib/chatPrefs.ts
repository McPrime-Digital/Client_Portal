/**
 * Chat appearance preferences — Batch 17 (device-level, like the chime).
 * The wallpaper pattern and its intensity are the viewer's own; server-side
 * room prefs stay about notifications.
 */

import { pushPref } from '@/lib/prefsSync'

const PATTERN_KEY = 'genreline-wallpaper'
const INTENSITY_KEY = 'genreline-wallpaper-intensity'

export type WallpaperPattern = 'film' | 'aurora' | 'waves' | 'dots' | 'grid' | 'none'
export type WallpaperIntensity = 'faint' | 'medium' | 'bold'

export const INTENSITY_ALPHA: Record<WallpaperIntensity, number> = {
  faint: 0.45,
  medium: 0.75,
  bold: 1,
}

export function wallpaperPattern(): WallpaperPattern {
  try {
    const v = localStorage.getItem(PATTERN_KEY)
    return v === 'dots' || v === 'grid' || v === 'none' || v === 'aurora' || v === 'waves' ? v : 'film'
  } catch {
    return 'film'
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
