type Props = {
  /** Rendered pixel height of the logo tile. Width scales with the lockup's aspect ratio. */
  height?: number
  /** Tailwind rounding for the tile (the source art is a black-background lockup). */
  rounded?: string
  className?: string
}

/**
 * McPrime Digital brand logo. The source art ("McP DIGITAL" lockup) sits on a
 * black background, so it's wrapped in a rounded tile with a subtle border to
 * read intentionally on both the light and dark themes.
 *
 * Use this ONLY for McPrime's own branding (auth screens, admin chrome) — never
 * for a client's company logo.
 */
export default function McPrimeLogo({
  height = 36,
  rounded = 'rounded-xl',
  className = '',
}: Props) {
  return (
    <span
      className={`inline-flex items-center justify-center overflow-hidden border border-border bg-black ${rounded} ${className}`}
      style={{ height }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/mcprime-logo.jpg"
        alt="McPrime Digital"
        className="h-full w-auto object-contain"
      />
    </span>
  )
}
