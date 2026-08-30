import { PRODUCT_NAME, PRODUCT_TAGLINE } from '@/lib/product'

type Props = {
  /** Rendered pixel height of the glyph tile. */
  size?: number
  /** Show the wordmark beside the glyph. */
  showName?: boolean
  /** Show the tagline under the wordmark. Ignored unless `showName`. */
  showTagline?: boolean
  className?: string
}

/**
 * The PRODUCT's mark — Genreline's own, never a tenant's (S0-B §2/§3).
 *
 * Where it belongs: the studio shell, and the pre-auth pages, which run before
 * any session exists and so have no tenant to resolve. Where it does not: any
 * client-facing surface inside the portal, which wears the studio's brand
 * (`components/TenantLogo.tsx`) with the PI-4 attribution beneath it.
 *
 * The glyph was already inline in three sidebars as identical path data. It is
 * one component now so the next change to the mark is one edit rather than
 * four, which is the same argument `lib/product.ts` makes for the name.
 */
export default function ProductMark({
  size = 40,
  showName = true,
  showTagline = false,
  className = '',
}: Props) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <span
        className="grid flex-shrink-0 place-items-center rounded-xl border border-border bg-background text-primary"
        style={{ height: size, width: size }}
      >
        <svg
          viewBox="0 0 48 48"
          fill="none"
          aria-hidden="true"
          style={{ height: size * 0.65, width: size * 0.65 }}
        >
          <path
            d="M3 31 C 11 31, 13 13, 24 13 S 37 31, 45 31"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <circle cx="3" cy="31" r="2.7" fill="currentColor" />
          <circle cx="24" cy="13" r="3.1" fill="currentColor" />
          <circle cx="45" cy="31" r="2.7" fill="currentColor" />
        </svg>
      </span>
      {showName && (
        <span className="leading-tight">
          <span
            className="block font-display font-bold text-foreground"
            style={{ fontSize: Math.round(size * 0.42) }}
          >
            {PRODUCT_NAME}
          </span>
          {showTagline && (
            <span className="block text-[10px] uppercase tracking-[0.2em] text-faint">
              {PRODUCT_TAGLINE}
            </span>
          )}
        </span>
      )}
    </div>
  )
}
