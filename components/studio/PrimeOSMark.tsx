'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * The PrimeOS identity mark — the brand emblem (luminous star-spire + golden
 * halo) as a circular badge. While `pondering` the star spins fast and the halo
 * glows; the instant it stops, the star eases down to rest (decelerates).
 */
export default function PrimeOSMark({
  size = 20,
  pondering = false,
  spinning = false,
  className = '',
}: {
  size?: number
  /** halo glow (e.g. on the top bar while working) — does NOT spin */
  pondering?: boolean
  /** spin the star fast, then decelerate to rest when it turns off */
  spinning?: boolean
  className?: string
}) {
  const [phase, setPhase] = useState<'idle' | 'spin' | 'slow'>('idle')
  const wasSpinning = useRef(false)
  useEffect(() => {
    if (spinning) {
      wasSpinning.current = true
      setPhase('spin')
    } else if (wasSpinning.current) {
      wasSpinning.current = false
      setPhase('slow') // one decelerating revolution, then rest
      const t = setTimeout(() => setPhase('idle'), 1400)
      return () => clearTimeout(t)
    }
  }, [spinning])

  const spin = phase === 'spin' ? 'tl-mark-spin' : phase === 'slow' ? 'tl-mark-slow' : ''

  return (
    <span
      className={`tl-primeos-badge ${pondering ? 'tl-primeos-ponder' : ''} ${className}`}
      style={{ width: size, height: size }}
      aria-label="PrimeOS"
      role="img"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/primeos-mark.png"
        alt="PrimeOS"
        width={size}
        height={size}
        draggable={false}
        className={`h-full w-full select-none rounded-full object-cover ${spin}`}
      />
    </span>
  )
}
