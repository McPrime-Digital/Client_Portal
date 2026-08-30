type Props = {
  /** The studio's name — used for the alt text and the initial fallback. */
  name: string
  /** `organizations.logo_url`, or null when the studio has not uploaded one. */
  logoUrl?: string | null
  /** Rendered pixel height of the tile. */
  height?: number
  rounded?: string
  className?: string
}

/**
 * A TENANT's logo, on a client-facing surface. The counterpart to
 * `McPrimeLogo`, which is one specific studio's brand asset and belongs only on
 * that studio's own chrome.
 *
 * S0-B §2: the portal wears the tenant's brand. A client of a studio bought
 * from that studio, so this is the mark they should see — not the product's,
 * and not another tenant's.
 *
 * With no uploaded logo it renders the studio's initial rather than falling
 * back to any brand asset. A fallback image would be a hardcoded identity with
 * an extra step (P-1).
 */
export default function TenantLogo({
  name,
  logoUrl = null,
  height = 48,
  rounded = 'rounded-xl',
  className = '',
}: Props) {
  const initial = name.trim().charAt(0).toUpperCase() || '·'

  if (!logoUrl) {
    return (
      <span
        className={`inline-flex items-center justify-center overflow-hidden border border-border bg-secondary font-display font-bold text-foreground ${rounded} ${className}`}
        style={{ height, width: height, fontSize: Math.round(height * 0.42) }}
        aria-label={name}
      >
        {initial}
      </span>
    )
  }

  return (
    <span
      className={`inline-flex items-center justify-center overflow-hidden border border-border bg-card ${rounded} ${className}`}
      style={{ height }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logoUrl} alt={name} className="h-full w-auto object-contain" />
    </span>
  )
}
