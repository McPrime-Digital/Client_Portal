import { brandStyle, type BrandKit } from '@/lib/brandKit'

/**
 * THE STUDIO'S COLOURS, ON THE SURFACES THAT BELONG TO THE STUDIO.
 *
 * ── WHERE THIS GOES, AND WHERE IT MUST NOT ──────────────────────────────
 *
 * S0-B §2: the client portal wears the TENANT's brand; the studio shell wears
 * the PRODUCT's. So this renders in `app/(portal)/*` and on the two public
 * artifact pages a studio's counterparty opens — `/s/<token>` and
 * `/sign/<token>` — and **never inside `/studio`**. "White-label everything" is
 * the market's framing and it is wrong here: a producer working in Genreline
 * should see Genreline, or the product they bought becomes unrecognisable to
 * the person who bought it.
 *
 * ── WHY A STYLE TAG AND NOT A CLASS ─────────────────────────────────────
 *
 * The tokens are per-TENANT, resolved per-request. A stylesheet cannot carry a
 * value that is only known once the session is. What it carries is four HSL
 * triplets that `deriveBrandTokens` produced as numbers — nothing a studio
 * typed reaches the page as a declaration, which is the difference between
 * theming a tenant and letting a tenant write CSS into everyone's browser.
 *
 * ── NULL IS A REAL ANSWER ───────────────────────────────────────────────
 *
 * No kit renders NOTHING, and the product's own palette applies. It does not
 * render a half-kit or a default brand colour: a fallback fires exactly when
 * identity could not be resolved, which is the moment asserting an identity is
 * most wrong (HANDOFF §12 lesson 3).
 */
export default function TenantTheme({ brand }: { brand: BrandKit | null }) {
  if (!brand) return null
  return (
    <style
      // The content is four `--token:H S% L%` pairs per theme, generated from
      // numbers. There is no path from user input to this string.
      dangerouslySetInnerHTML={{ __html: brandStyle(brand) }}
    />
  )
}
