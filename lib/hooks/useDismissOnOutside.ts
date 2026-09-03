'use client'

import { useEffect } from 'react'

/**
 * Close a transient overlay when the user taps anywhere else, presses Escape,
 * or scrolls the surface away.
 *
 * ── WHY A MARKER ATTRIBUTE AND NOT A REF ────────────────────────────────────
 * The message action menu and the reaction picker are keyed BY MESSAGE ID —
 * there is one potential menu per row, and a ref per row is bookkeeping that
 * goes stale the moment the list virtualises or reorders. So the contract is
 * declarative instead: anything that must survive the tap carries
 * `data-tl-keep-open`, and one document listener serves every overlay.
 *
 * THE TRIGGER CARRIES IT TOO, and that is the part that is easy to get wrong.
 * The listener runs in the CAPTURE phase, before the button's own onClick. If
 * the trigger were not marked, tapping it to close would fire the outside
 * handler (close) and then the button's toggle (open) — the menu would appear
 * stuck open no matter how many times you tapped it. Marking both leaves the
 * toggle as the single owner of that decision.
 *
 * `pointerdown`, not `click`: it fires at the start of the gesture, so on
 * touch a tap that dismisses a menu AND lands on something behind it does the
 * expected thing instead of eating the first tap.
 */
export function useDismissOnOutside(open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return

    const onPointerDown = (e: Event) => {
      const el = e.target as HTMLElement | null
      if (el?.closest?.('[data-tl-keep-open]')) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])
}
