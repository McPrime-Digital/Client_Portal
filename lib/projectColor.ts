/**
 * Deterministic project colour — Batch 15 item 1 / Batch 16 (S-F §2.2).
 * A project's colour is a pure function of its id: no column, no config
 * (the same reasoning that kept organizations.brand_color out in Batch 10).
 * Ten curated hues that hold up on card and gold in both themes.
 */

const HUES = [340, 210, 150, 270, 25, 190, 55, 310, 90, 0]

export function projectColor(projectId: string): string {
  let h = 0
  for (let i = 0; i < projectId.length; i++) {
    h = (h * 31 + projectId.charCodeAt(i)) >>> 0
  }
  const hue = HUES[h % HUES.length]
  return `hsl(${hue} 62% 55%)`
}
