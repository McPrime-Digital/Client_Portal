'use client'

import { clampPct } from '@/lib/projectProgress'

// Premium draggable progress control — admin only. The filled portion
// of the track is painted up to the current value; styling for the
// thumb lives in globals.css under `.progress-slider`.

type Props = {
  value: number
  onChange: (value: number) => void
  step?: number
  disabled?: boolean
  showLabel?: boolean
  // Per-phase identifier colour for the fill/thumb (turns green at 100%).
  accentColor?: string
  className?: string
}

export default function ProgressSlider({
  value,
  onChange,
  step = 5,
  disabled = false,
  showLabel = true,
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
      <input
        type="range"
        min={0}
        max={100}
        step={step}
        value={v}
        disabled={disabled}
        onChange={(e) => onChange(clampPct(parseInt(e.target.value, 10)))}
        className="progress-slider flex-1"
        style={{
          background: `linear-gradient(90deg, ${accent} 0%, ${accent} ${v}%, hsl(var(--secondary)) ${v}%, hsl(var(--secondary)) 100%)`,
          // Consumed by the thumb pseudo-elements in globals.css.
          ['--thumb' as string]: accent,
        }}
      />
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
