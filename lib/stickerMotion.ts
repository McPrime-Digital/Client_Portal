/**
 * Sticker motion — what the thing DOES, not "wiggle everything".
 *
 * The old behaviour animated every jumbo emoji with one sway. A rocket swayed.
 * A heart swayed. A crying face swayed. It reads as decoration applied to a
 * character rather than a character doing something, which is exactly why it
 * felt cheap.
 *
 * So motion is chosen from MEANING. A rocket launches and leaves. A heart
 * beats on the double-thump rhythm of an actual heartbeat. Clapping hands
 * clap — two hands meeting, not one object rotating. Fire flickers. A party
 * popper bursts once and settles. A waving hand waves, because that IS the
 * gesture; the old sway was only ever right for this one case, which is
 * presumably how it ended up on everything.
 *
 * Anything without a known intent gets `pop` — a single confident entrance and
 * then stillness. A sticker that keeps moving forever with no reason to is
 * worse than one that simply arrives well.
 */

export type StickerMotion =
  | 'launch'   // leaves the ground and goes
  | 'beat'     // double-thump, like a pulse
  | 'clap'     // two halves meeting
  | 'bounce'   // lands, settles
  | 'flicker'  // light that is not steady
  | 'spin'     // turns about its centre
  | 'burst'    // one expansion, then rest
  | 'wave'     // a greeting, from the wrist
  | 'fall'     // gravity
  | 'float'    // buoyancy
  | 'laugh'    // the shoulders-shaking one
  | 'shock'    // a recoil
  | 'pop'      // the honest default: arrive, then stop

/** Codepoint sets, kept as literal characters so this file reads as what it is. */
const SETS: [StickerMotion, string[]][] = [
  ['launch', ['🚀', '🛸', '✈️', '🛫', '🎈', '🪁', '🏹', '🛩️', '🚁']],
  ['beat', ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💖', '💗', '💓', '💞', '💘', '❣️', '💕', '😍', '🥰', '😘']],
  ['clap', ['👏', '🙌', '🤝', '👐']],
  ['bounce', ['👍', '👎', '⚽', '🏀', '🎾', '🏐', '🪀', '🦘', '🐸']],
  ['flicker', ['🔥', '🕯️', '✨', '💡', '⭐', '🌟', '💫', '⚡', '🎆', '🔆']],
  ['spin', ['🌀', '💿', '📀', '🎡', '☸️', '🎯', '⚙️', '🔄', '🌪️', '🎰']],
  ['burst', ['🎉', '🎊', '💥', '🧨', '🎇', '💣', '🤯', '🫨']],
  ['wave', ['👋', '🤚', '🖐️', '✋', '🫱', '🫲', '🏳️', '🚩']],
  ['fall', ['🌧️', '❄️', '🌨️', '💧', '💦', '🍂', '🍁', '⬇️', '😭', '😢']],
  ['float', ['☁️', '🎐', '🪶', '🫧', '🕊️', '👻', '🎏']],
  ['laugh', ['😂', '🤣', '😹', '😆', '😄', '😁', '🙃']],
  ['shock', ['😱', '😨', '😰', '🤬', '😡', '💀', '☠️', '⚠️']],
]

const MOTION_BY_CHAR = new Map<string, StickerMotion>()
for (const [motion, chars] of SETS) {
  for (const c of chars) {
    MOTION_BY_CHAR.set(c, motion)
    // Match with and without the VS16 presentation selector — a picker and a
    // keyboard do not always agree on whether to include it, and a sticker
    // that animates from one source and not the other is the sort of
    // inconsistency nobody can reproduce on demand.
    MOTION_BY_CHAR.set(c.replace('️', ''), motion)
  }
}

/** The motion for a sticker, from its meaning. */
export function stickerMotion(text: string): StickerMotion {
  const t = text.trim()
  return MOTION_BY_CHAR.get(t) ?? MOTION_BY_CHAR.get(t.replace('️', '')) ?? 'pop'
}

/** The class the renderer applies. One class, so the CSS owns the timing. */
export function stickerClass(text: string): string {
  return `tl-sticker tl-motion-${stickerMotion(text)}`
}
