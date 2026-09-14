'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { MonitorCheck, TriangleAlert } from 'lucide-react'

/**
 * CAN THIS SCREEN ACTUALLY SHOW WHAT YOU ARE APPROVING?
 *
 * ── THE HONEST SCOPE OF THIS COMPONENT ───────────────────────────────────
 *
 * Evercast sells on colour-accurate streaming, and closing that gap properly
 * needs a transcode pipeline this repo does not have: 10-bit HEVC/AV1,
 * calibrated transforms, a job queue. That half is recorded as outstanding
 * rather than faked, because a viewer told "this is colour accurate" when it is
 * not is worse off than one told nothing.
 *
 * What IS built is the half that is real today and that the pipeline will need
 * anyway: the asset declares its colour space (0082) and the browser reports
 * what the display can do. Where they disagree, the reviewer is told BEFORE they
 * give a note.
 *
 * **A note given on a wrongly-displayed image is worse than no note**, because
 * it is confidently wrong and travels downstream as if it were right. "Warmer in
 * the midtones" on an SDR laptop, about a Rec.2020 PQ master, is an instruction
 * somebody will follow.
 *
 * ── useSyncExternalStore, NOT AN EFFECT ──────────────────────────────────
 *
 * A media query is an external, mutable source — which is precisely what this
 * hook exists for. An effect + setState trips `react-hooks/set-state-in-effect`
 * (cascading renders) and, worse, reads the value ONCE: drag the window from a
 * laptop panel to a calibrated reference monitor and an effect-based version
 * still describes the laptop. Subscribing means the warning follows the window.
 *
 * ── WHAT THE BROWSER CAN AND CANNOT TELL US ──────────────────────────────
 *
 * `color-gamut` and `dynamic-range` are the two media queries that exist, and
 * they are coarse: they describe the DISPLAY, not whether it is calibrated,
 * not the room it is in, and not whether the viewer has night-shift on. So the
 * wording is deliberately about capability rather than accuracy — claiming more
 * than the query supports would be the same overreach in the other direction.
 */

type Caps = { p3: boolean; rec2020: boolean; hdr: boolean }

const QUERIES = {
  p3: '(color-gamut: p3)',
  rec2020: '(color-gamut: rec2020)',
  hdr: '(dynamic-range: high)',
} as const

/** One subscription across all three queries; any change re-reads all of them. */
function subscribe(onChange: () => void): () => void {
  const lists = Object.values(QUERIES).map((q) => window.matchMedia(q))
  for (const l of lists) l.addEventListener('change', onChange)
  return () => { for (const l of lists) l.removeEventListener('change', onChange) }
}

function readCaps(): string {
  try {
    return [
      window.matchMedia(QUERIES.p3).matches,
      window.matchMedia(QUERIES.rec2020).matches,
      window.matchMedia(QUERIES.hdr).matches,
    ].map((b) => (b ? '1' : '0')).join('')
  } catch {
    return '000'
  }
}

/** A STRING snapshot, deliberately: useSyncExternalStore compares by identity,
 *  and a fresh object every read would loop forever. */
const SERVER_SNAPSHOT = ''

export default function ColourCheck({
  colourSpace, transfer, bitDepth,
}: {
  colourSpace: string | null
  transfer: string | null
  bitDepth: number | null
}) {
  const snapshot = useSyncExternalStore(
    subscribe,
    readCaps,
    // On the server there is no display to describe, so the component renders
    // nothing rather than guessing and then correcting itself on hydration.
    useCallback(() => SERVER_SNAPSHOT, []),
  )
  const caps: Caps | null = snapshot.length === 3
    ? { p3: snapshot[0] === '1', rec2020: snapshot[1] === '1', hdr: snapshot[2] === '1' }
    : null

  // Nothing declared: say so plainly rather than implying the asset is fine.
  if (!colourSpace && !transfer) {
    return (
      <p className="text-[11px] text-faint">
        This asset does not declare a colour space, so nothing can be checked
        against your display.
      </p>
    )
  }

  if (!caps) return null

  const wantsWide = colourSpace === 'rec2020' || colourSpace === 'p3'
  const wantsHdr = transfer === 'pq' || transfer === 'hlg'
  const gamutShort = wantsWide && !(colourSpace === 'rec2020' ? caps.rec2020 : caps.p3)
  const hdrShort = wantsHdr && !caps.hdr
  const ok = !gamutShort && !hdrShort

  const label = [
    colourSpace ? colourSpace.replace('rec', 'Rec.').toUpperCase() : null,
    transfer ? transfer.toUpperCase() : null,
    bitDepth ? `${bitDepth}-bit` : null,
  ].filter(Boolean).join(' · ')

  return (
    <p className={`inline-flex items-start gap-1.5 text-[11px] leading-relaxed ${
      ok ? 'text-muted-foreground' : 'text-[hsl(var(--status-amber,var(--destructive)))]'
    }`}>
      {ok
        ? <MonitorCheck size={12} className="mt-px shrink-0" />
        : <TriangleAlert size={12} className="mt-px shrink-0" />}
      <span>
        {label}
        {ok
          ? ' — your display can represent this.'
          : gamutShort && hdrShort
            ? ' — your display is neither wide-gamut nor HDR. Colour and contrast notes from this screen will not be reliable.'
            : gamutShort
              ? ' — your display is not wide-gamut. Colour notes from this screen will not be reliable.'
              : ' — your display is not HDR. Contrast and highlight notes from this screen will not be reliable.'}
      </span>
    </p>
  )
}
