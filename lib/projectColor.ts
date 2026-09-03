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

/**
 * Deterministic PERSON colour — team chat.
 *
 * Same reasoning as projectColor: a pure function of the id, no column and no
 * config. Once a company or a crew has more than one member, a thread is only
 * scannable if each person is visually distinct at a glance — a name in 9px
 * uppercase is not enough when you are catching up on forty messages.
 *
 * Deliberately offset from the project hue space and pulled to a lower
 * saturation: a person's mark must never be mistaken for a project's colour
 * binding, which carries different meaning on the same screen.
 */
export function senderColor(senderId: string | null | undefined): string {
  if (!senderId) return 'hsl(0 0% 55%)'
  let h = 0
  for (let i = 0; i < senderId.length; i++) {
    h = (h * 37 + senderId.charCodeAt(i)) >>> 0
  }
  return `hsl(${(h % 360)} 44% 58%)`
}
