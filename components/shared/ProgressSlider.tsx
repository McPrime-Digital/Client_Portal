'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { clampPct } from '@/lib/projectProgress'

// Premium pointer-driven progress control (admin). A real draggable thumb
// tracks the cursor in real time with a floating value bubble; the value is
// committed to the parent on release (one write per drag) and the fill eases
// to the persisted value. Keyboard-accessible (arrows / home / end).

type Props = {
  value: number
  onChange: (value: number) => void
  step?: number
  disabled?: boolean
  showLabel?: boolean
  // Per-phase identifier colour (turns green at 100%).
  accentColor?: string
  className?: string
}

export default function ProgressSlider({
  value,
  onChange,
  step = 1,
  disabled = false,
  showLabel = true,
  accentColor,
  className = '',
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [drag, setDrag] = useState<number | null>(null)

  // Once the parent's value catches up to a committed drag, drop the local
  // override so the persisted value drives the display.
  useEffect(() => {
    setDrag(null)
  }, [value])

  const v = clampPct(Math.round(drag ?? value ?? 0))
  const complete = v >= 100
  const accent = complete ? 'hsl(var(--status-green))' : (accentColor ?? 'hsl(var(--primary))')

  const pctFromClientX = useCallback((clientX: number) => {
    const el = trackRef.current
    if (!el) return v
    const r = el.getBoundingClientRect()
    return clampPct(Math.round(((clientX - r.left) / r.width) * 100))
  }, [v])

  function down(e: React.PointerEvent) {
    if (disabled) return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    setDragging(true)
    setDrag(pctFromClientX(e.clientX))
  }
  function move(e: React.PointerEvent) {
    if (!dragging) return
    setDrag(pctFromClientX(e.clientX))
  }
  function up(e: React.PointerEvent) {
    if (!dragging) return
    setDragging(false)
    const final = pctFromClientX(e.clientX)
    setDrag(final) // hold until the parent value catches up
    onChange(final)
  }
  function key(e: React.KeyboardEvent) {
    if (disabled) return
    let next = v
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = clampPct(v + step)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = clampPct(v - step)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = 100
    else return
    e.preventDefault()
    setDrag(next)
    onChange(next)
  }

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={v}
        aria-disabled={disabled}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onKeyDown={key}
        className="relative flex-1 select-none outline-none group"
        style={{ cursor: disabled ? 'default' : dragging ? 'grabbing' : 'pointer', touchAction: 'none', paddingBlock: 9 }}
      >
        {/* Track */}
        <div
          className="h-2.5 w-full rounded-full"
          style={{ backgroundColor: 'hsl(var(--secondary))', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.20)' }}
        >
          {/* Fill */}
          <div
            className="h-full rounded-full"
            style={{
              width: `${v}%`,
              background: `linear-gradient(90deg, color-mix(in srgb, ${accent} 72%, #000), ${accent})`,
              boxShadow: `0 0 8px color-mix(in srgb, ${accent} 35%, transparent)`,
              transition: dragging ? 'none' : 'width 0.35s cubic-bezier(0.4,0,0.2,1)',
            }}
          />
        </div>

        {/* Thumb */}
        <div
          className="absolute top-1/2 pointer-events-none"
          style={{
            left: `${v}%`,
            transform: `translate(-50%, -50%) scale(${dragging ? 1.18 : 1})`,
            transition: dragging ? 'transform 0.1s ease' : 'left 0.35s cubic-bezier(0.4,0,0.2,1), transform 0.15s ease',
          }}
        >
          {/* Live value bubble */}
          {dragging && (
            <div
              className="absolute left-1/2 -translate-x-1/2 -top-8 px-2 py-0.5 rounded-md text-[11px] font-bold tabular-nums whitespace-nowrap"
              style={{ backgroundColor: accent, color: 'hsl(var(--primary-foreground))', boxShadow: '0 6px 16px rgba(0,0,0,0.30)' }}
            >
              {v}%
            </div>
          )}
          <div
            className="rounded-full"
            style={{
              width: 20,
              height: 20,
              backgroundColor: '#fff',
              border: `3px solid ${accent}`,
              boxShadow: dragging
                ? `0 0 0 7px color-mix(in srgb, ${accent} 16%, transparent), 0 3px 10px rgba(0,0,0,0.35)`
                : `0 1px 4px rgba(0,0,0,0.28)`,
            }}
          />
        </div>
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
