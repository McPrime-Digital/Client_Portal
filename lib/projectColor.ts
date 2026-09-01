/**
 * Deterministic project colour — Batch 15 item 1 / Batch 16 (S-F §2.2).
 * A project's colour is a pure function of its id: no column, no config
 * (the same reasoning that kept organizations.brand_color out in Batch 10).
 * Ten curated hues that hold up on card and gold in both themes.
 */

export function projectColor(projectId: string): string {
  let h = 0
  for (let i = 0; i < projectId.length; i++) {
    h = (h * 31 + projectId.charCodeAt(i)) >>> 0
  }
  // Full 360° hue space (was a 10-hue palette — two projects in one company
  // could collide, which defeats the entire point of colour-bonding).
  return `hsl(${h % 360} 62% 55%)`
}
