/**
 * A 30-day spend sparkline. Server-rendered inline SVG — no chart library, no
 * client JS, nothing to hydrate for a read-only shape.
 *
 * Zero-filled days are drawn as zero rather than skipped: a line that hops over
 * quiet days shows a steeper, more alarming burn than actually happened, which
 * on a cost surface is a lie in the expensive direction.
 *
 * No animation. This renders on every load of a page somebody checks daily, and
 * a drawing-in line would be decoration on a figure people read for a number.
 */
export default function Sparkline({ points, peak }: { points: number[]; peak: number }) {
  if (points.length < 2) return null
  const W = 100
  const H = 22
  const step = W / (points.length - 1)
  const y = (v: number) => H - (v / peak) * (H - 2) - 1
  const line = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(2)},${y(v).toFixed(2)}`).join(' ')
  const area = `${line} L${W},${H} L0,${H} Z`

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-[34px] w-full"
      role="img"
      aria-label={`Daily spend over the last ${points.length} days`}
    >
      <path d={area} fill="hsl(var(--glow) / 0.10)" />
      <path
        d={line}
        fill="none"
        stroke="hsl(var(--glow))"
        strokeWidth="1"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
