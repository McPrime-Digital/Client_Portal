import { clampPct } from '@/lib/projectProgress'

// Read-only premium progress bar used everywhere progress is displayed
// (dashboard, project lists, project detail, phases). Gold fill that
// turns green at 100% for a consistent, balanced palette across themes.

type Props = {
  value: number
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
  // Per-phase identifier colour (turns green at 100%).
  accentColor?: string
  className?: string
}

const TRACK_HEIGHT: Record<NonNullable<Props['size']>, string> = {
  sm: 'h-1.5',
  md: 'h-2',
  lg: 'h-2.5',
}

export default function ProgressBar({
  value,
  size = 'md',
  showLabel = false,
  accentColor,
  className = '',
}: Props) {
  const v = clampPct(Math.round(value ?? 0))
  const complete = v >= 100
  const accent = complete
    ? 'hsl(var(--status-green))'
    : (accentColor ?? 'hsl(var(--primary))')

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div
        className={`relative flex-1 ${TRACK_HEIGHT[size]} rounded-full overflow-hidden`}
        style={{ backgroundColor: 'hsl(var(--secondary))' }}
        role="progressbar"
        aria-valuenow={v}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out"
          style={{
            width: `${v}%`,
            background: complete ? 'hsl(var(--status-green))' : accent,
          }}
        />
      </div>
      {showLabel && (
        <span
          className="text-xs font-semibold tabular-nums text-right"
          style={{ color: accent, minWidth: '2.75rem' }}
        >
          {v}%
        </span>
      )}
    </div>
  )
}
