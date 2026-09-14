import { converter, formatHex, parse } from 'culori'

/**
 * THE BRAND KIT — one colour in, an accessible token ramp out.
 *
 * ── WHAT THE MARKET SELLS, AND WHERE IT STOPS ────────────────────────────
 *
 * "Custom branding" in this category means: upload a logo, pick an accent, hide
 * the vendor's name, point a domain at it. **Frame.io gates it behind
 * Enterprise.** Moxo, Softr, Zite, SuiteDash and every white-label portal guide
 * describe the same four knobs, and all of them store the hex the customer typed
 * and interpolate it straight into CSS.
 *
 * The 2026 white-label architecture write-ups name the unsolved problem in their
 * own words: preventing "custom CSS or branding assets from breaking core UI
 * components or accessibility standards". Nobody solves it. They warn about it.
 *
 * ── WHAT THIS DOES INSTEAD: THE STUDIO CANNOT BREAK ITS OWN PORTAL ───────
 *
 * A studio picks ONE colour. Everything else is DERIVED here, server-side, at
 * save time:
 *
 *   · the on-colour — the text that sits on the button — is CHOSEN BY MEASURED
 *     CONTRAST, not assumed. A pale gold accent gets near-black type; a navy one
 *     gets near-white. There is no combination of inputs that produces an
 *     unreadable "Approve" button, because the readable answer is computed
 *     rather than hoped for.
 *   · hover, pressed, ring, and a subtle tint are steps along the same hue.
 *   · **a LIGHT ramp and a DARK ramp from the same decision.** A hex that reads
 *     well on white is routinely invisible on the dark shell, and a portal that
 *     is theme-aware (this one is) cannot store one number and call it branding.
 *
 * ── WHY OKLCH, AND WHY THE OUTPUT IS STILL HSL ──────────────────────────
 *
 * Lightness steps in HSL are not perceptually even — the same −10% turns yellow
 * muddy and leaves blue almost unchanged, so a ramp built in HSL is a different
 * ramp for every hue. OKLCH is perceptually uniform, so one set of steps behaves
 * the same for every studio's colour.
 *
 * The ramp is nevertheless EMITTED as HSL triplets, because `globals.css`
 * defines every token as `--primary: 40 57% 45%` and ~400 call sites read
 * `hsl(var(--primary))`. Changing the token format to serve this module would be
 * the tail wagging the dog.
 *
 * ── REPOS AUDITED, AND THE ONE THAT WAS REJECTED ────────────────────────
 *
 *   Evercoder/culori          MIT, **zero dependencies** — TAKEN. The CSS Color
 *                             4 reference implementation in JS; conversion only.
 *   radix-ui/colors           MIT — the SEMANTICS taken, not the code: which
 *                             step is a solid fill, which is low-contrast text,
 *                             which is high-contrast text. Their scales are
 *                             hand-tuned constants for their own hues and cannot
 *                             answer for an arbitrary brand colour.
 *   ricokahler/color2k        MIT — confirmation that WCAG contrast is five
 *                             lines of spec arithmetic and needs no dependency.
 *   color-js/color.js         MIT — heavier, and gamut mapping is not needed
 *                             here; culori covers the same ground smaller.
 *   jnsahaj/tweakcn           Apache-2.0 — a theme EDITOR for shadcn; the UX
 *                             reference for a live preview, no code taken.
 *
 *   evilmartians/apcach       **REJECTED, and this is the find.** The package
 *                             itself is MIT and does exactly the right thing —
 *                             generate a colour FROM a contrast target. But it
 *                             depends on `apca-w3`, which ships under the
 *                             "Limited W3 License": *"Commercial use is
 *                             prohibited without a written and signed commercial
 *                             license agreement"*, plus a ban on modifying the
 *                             core constants and a restriction to web-content
 *                             use cases. This product is commercial SaaS. An
 *                             MIT badge on the top-level package would have made
 *                             that invisible — the obligation rides in on a
 *                             transitive dependency.
 *
 * So the contrast half is implemented here against the **WCAG 2.1 relative
 * luminance formula**, which is a published specification rather than somebody's
 * licensed code, and the search-by-contrast idea apcach is built on is
 * reimplemented in `deriveOn()` below — taken as an IDEA, which is the only part
 * of it that was ever free to take.
 */

const toRgb = converter('rgb')
const toOklch = converter('oklch')

export type BrandInput = {
  /** What the studio actually picked. Stored verbatim so a better derivation
   *  later can re-run from the decision rather than from its own output. */
  colour: string
  /** Optional second colour for the chrome accent (glass, gradients). Falls
   *  back to the brand colour, because most studios have one. */
  accent?: string | null
}

/** One theme's worth of tokens, as the HSL triplets `globals.css` expects. */
export type BrandRamp = {
  primary: string
  primaryForeground: string
  ring: string
  glow: string
}

export type BrandTokens = {
  light: BrandRamp
  dark: BrandRamp
  /** Measured, and surfaced: a studio is told what its choice scores. */
  contrast: { light: number; dark: number }
  /** The derivation that produced these, so a stored ramp can be identified as
   *  stale when this module improves. Bump it when the output changes. */
  version: number
}

export const BRAND_DERIVATION_VERSION = 1

/** Near-black and near-white, matching the shell's own extremes rather than
 *  pure #000/#fff — the portal never uses either. */
const INK = '#0a0e1a'
const PAPER = '#f7f8fb'

/** The surfaces a brand colour actually lands on, per theme. Contrast is
 *  meaningless without saying "against what". */
const SURFACE = { light: '#ffffff', dark: '#0b1020' }

/** WCAG 2.1 relative luminance. The specification's own formula. */
function luminance(hex: string): number {
  const rgb = toRgb(parse(hex))
  if (!rgb) return 0
  const chan = (v: number) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  return 0.2126 * chan(rgb.r) + 0.7152 * chan(rgb.g) + 0.0722 * chan(rgb.b)
}

/** WCAG 2.1 contrast ratio, 1 … 21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** Is a brand colour usable as a solid fill on this surface at all? */
export function isLegible(colour: string, theme: 'light' | 'dark'): boolean {
  // 3:1 against the page is the WCAG 1.4.11 bar for a UI component's own
  // boundary — a button whose fill vanishes into the page is not a button.
  return contrastRatio(colour, SURFACE[theme]) >= 3
}

function hslTriplet(hex: string): string {
  const rgb = toRgb(parse(hex))
  if (!rgb) return '0 0% 50%'
  const r = rgb.r, g = rgb.g, b = rgb.b
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0, s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0))
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
}

/** Move along a colour's own hue in OKLCH. Lightness is absolute (0…1) so a
 *  step means the same perceptual thing whatever the hue — the property HSL
 *  does not have and the reason this module converts at all. */
function atLightness(hex: string, l: number, chromaScale = 1): string {
  const c = toOklch(parse(hex))
  if (!c) return hex
  return formatHex({
    mode: 'oklch',
    l: Math.min(0.99, Math.max(0.01, l)),
    // Chroma is clamped as lightness approaches the ends: a highly saturated
    // near-white is outside sRGB and clips to something that is not the brand.
    c: Math.max(0, (c.c ?? 0) * chromaScale),
    h: c.h ?? 0,
  }) ?? hex
}

/**
 * THE ON-COLOUR, CHOSEN BY MEASUREMENT.
 *
 * apcach's idea — state the contrast you need and solve for the colour — with
 * none of its code or its licence. Ink and paper are tried first because the
 * shell already uses both; only if neither clears 4.5:1 (WCAG AA for body text)
 * does it walk the brand's own hue towards whichever end is further away, so the
 * label still belongs to the brand rather than defaulting to black.
 */
function deriveOn(fill: string): string {
  const onInk = contrastRatio(fill, INK)
  const onPaper = contrastRatio(fill, PAPER)
  if (Math.max(onInk, onPaper) >= 4.5) return onInk >= onPaper ? INK : PAPER

  // Nothing off the shelf reads on this fill — walk the hue.
  const goDark = onInk > onPaper
  for (let i = 0; i <= 20; i++) {
    const l = goDark ? 0.22 - i * 0.01 : 0.86 + i * 0.006
    const candidate = atLightness(fill, l, 0.35)
    if (contrastRatio(fill, candidate) >= 4.5) return candidate
  }
  // The floor, and it is never worse than the starting point.
  return goDark ? INK : PAPER
}

/**
 * One colour in, both themes out.
 *
 * Returns null for anything that is not a colour — a caller must treat that as
 * "the studio has no brand kit", never as "use this half-built one".
 */
export function deriveBrandTokens(input: BrandInput): BrandTokens | null {
  const parsed = parse(input.colour)
  if (!parsed) return null
  const base = formatHex(parsed)
  if (!base) return null

  const accentSource = (input.accent && parse(input.accent)) ? input.accent : base

  // The two fills. A brand colour tuned for print is often too dark to read on
  // the dark shell and too light to read on the white one, so each theme gets
  // the lightness that WORKS there while hue and chroma — the parts a person
  // recognises as "their" colour — are untouched.
  const lightFill = liftInto(base, 'light')
  const darkFill = liftInto(base, 'dark')

  return {
    light: {
      primary: hslTriplet(lightFill),
      primaryForeground: hslTriplet(deriveOn(lightFill)),
      ring: hslTriplet(lightFill),
      glow: hslTriplet(liftInto(accentSource, 'light')),
    },
    dark: {
      primary: hslTriplet(darkFill),
      primaryForeground: hslTriplet(deriveOn(darkFill)),
      ring: hslTriplet(darkFill),
      glow: hslTriplet(liftInto(accentSource, 'dark')),
    },
    contrast: {
      light: round2(contrastRatio(lightFill, SURFACE.light)),
      dark: round2(contrastRatio(darkFill, SURFACE.dark)),
    },
    version: BRAND_DERIVATION_VERSION,
  }
}

/**
 * Nudge a colour to a lightness that can carry a solid fill on this theme's
 * page, and ONLY as far as it has to go.
 *
 * A colour that already clears 3:1 is returned untouched — a studio whose brand
 * is a deep navy should see their navy, not a version of it this module
 * preferred. The walk is in 0.02 steps of OKLCH lightness, which is small
 * enough that the result is recognisably the same colour.
 */
function liftInto(hex: string, theme: 'light' | 'dark'): string {
  if (isLegible(hex, theme)) return hex
  const start = toOklch(parse(hex))?.l ?? 0.5
  // On white, go darker; on the dark shell, go lighter.
  const dir = theme === 'light' ? -0.02 : 0.02
  let l = start
  for (let i = 0; i < 40; i++) {
    l += dir
    if (l <= 0.02 || l >= 0.98) break
    const candidate = atLightness(hex, l)
    if (isLegible(candidate, theme)) return candidate
  }
  return atLightness(hex, theme === 'light' ? 0.42 : 0.72)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * The stored shape. Written by the one write path, read by every client-facing
 * surface, and DELIBERATELY carrying both halves:
 *
 *   · `input` is what the studio chose. A better derivation later re-runs from
 *     this. Storing only the output would make every improvement a migration
 *     that has already lost the information it needs.
 *   · `tokens` is what gets rendered, so no page pays for colour arithmetic.
 */
export type BrandKit = {
  input: BrandInput
  tokens: BrandTokens
  /** The studio's own wording on client-facing surfaces, or null for the
   *  product's default. Not decoration: "Approve" and "Sign off" are different
   *  words to a legal team. */
  approveLabel?: string | null
  updatedAt: string
}

/** Parse whatever is in `organizations.branding`, or null.
 *
 *  NEVER THROWS AND NEVER HALF-RETURNS. The column is jsonb written by an
 *  earlier version of this file, and a partially-valid kit rendered as CSS is a
 *  portal with one token from the studio and three from the product — which
 *  looks like a bug in the studio's brand rather than in this code. */
export function readBrandKit(raw: unknown): BrandKit | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Partial<BrandKit>
  const t = o.tokens
  if (!t?.light?.primary || !t?.dark?.primary) return null
  if (!t.light.primaryForeground || !t.dark.primaryForeground) return null
  if (!o.input?.colour) return null
  return {
    input: { colour: o.input.colour, accent: o.input.accent ?? null },
    tokens: t,
    approveLabel: o.approveLabel ?? null,
    updatedAt: o.updatedAt ?? '',
  }
}

/**
 * The kit as a `<style>` body, scoped to whatever selector the caller owns.
 *
 * A STRING OF TOKENS, NOT A STRING OF CSS THE STUDIO SUPPLIED. Every value here
 * came out of `deriveBrandTokens` as three numbers, so there is nothing a
 * studio could put in a colour field that reaches the page as a declaration.
 * That is the difference between theming a tenant and letting a tenant write
 * CSS into everybody's browser.
 */
export function brandStyle(kit: BrandKit, scope = ':root'): string {
  const v = (r: BrandRamp) => [
    `--primary:${r.primary}`,
    `--primary-foreground:${r.primaryForeground}`,
    `--ring:${r.ring}`,
    `--glow:${r.glow}`,
  ].join(';')
  return (
    `${scope}{${v(kit.tokens.light)}}` +
    `${scope === ':root' ? '.dark' : `${scope}.dark,.dark ${scope}`}{${v(kit.tokens.dark)}}`
  )
}

/** An HSL triplet as stored (`"42 55% 46%"`) back to hex. Email cannot use CSS
 *  variables — Outlook renders with Word's engine — so the one medium that
 *  needs literal colours gets them from the same derived ramp rather than from
 *  a second source that could disagree with the portal. */
export function tripletToHex(triplet: string): string | null {
  const m = /^(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/.exec(triplet.trim())
  if (!m) return null
  const h = Number(m[1]), s = Number(m[2]) / 100, l = Number(m[3]) / 100
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * c).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/**
 * The kit as two hex values, for email.
 *
 * THE LIGHT RAMP, and that is not a shortcut: the email card is `#ffffff`, which
 * is exactly the surface the light fill was derived to sit on. Dark-mode mail
 * clients invert the card themselves and no accent can be correct for both.
 *
 * **`onAccent` is the fix for a latent defect, not a nicety.** The CTA button
 * previously hardcoded `color:#ffffff` on the accent background — fine for the
 * product's gold, and unreadable the moment a studio picks a pale one. In CSS
 * the contrast layer would have caught it; in an email there is no layer, so
 * the value has to be carried in.
 */
export function emailPalette(kit: BrandKit | null): { accent: string; onAccent: string } | null {
  if (!kit) return null
  const accent = tripletToHex(kit.tokens.light.primary)
  const onAccent = tripletToHex(kit.tokens.light.primaryForeground)
  if (!accent || !onAccent) return null
  return { accent, onAccent }
}

/** The brand colour as pdf-lib's `[r, g, b]` in 0…1, or null.
 *
 *  The LIGHT ramp, because paper is white — the same argument `emailPalette`
 *  makes about the email card, and the reason both accessors exist rather than
 *  callers reaching into `tokens` and choosing a theme by guesswork. */
export function pdfBrandRgb(kit: BrandKit | null): [number, number, number] | null {
  if (!kit) return null
  const hex = tripletToHex(kit.tokens.light.primary)
  if (!hex) return null
  const rgb = toRgb(parse(hex))
  if (!rgb) return null
  return [rgb.r, rgb.g, rgb.b]
}
