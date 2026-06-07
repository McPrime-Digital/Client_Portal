'use client'

import { useEffect } from 'react'
import { useTheme } from 'next-themes'
import { usePrimeStore } from '@/lib/studio/primeStore'
import PrimeOSAssistant from './PrimeOSAssistant'

// App-shell PrimeOS: rendered once in the studio layout so the assistant persists
// across navigation (sticky until closed), keeps its conversation, and can read
// the latest text selection from anywhere in the app.
export default function PrimeOSDock() {
  const { resolvedTheme } = useTheme()
  const open = usePrimeStore((s) => s.open)
  const turns = usePrimeStore((s) => s.turns)
  const selText = usePrimeStore((s) => s.selText)
  const applyFn = usePrimeStore((s) => s.applyFn)
  const getDocText = usePrimeStore((s) => s.getDocText)
  const setTurns = usePrimeStore((s) => s.setTurns)
  const setSel = usePrimeStore((s) => s.setSel)
  const closePanel = usePrimeStore((s) => s.closePanel)

  // Capture the latest non-empty selection anywhere in the app (rAF-coalesced).
  useEffect(() => {
    let raf = 0
    const onSel = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const s = window.getSelection()?.toString() ?? ''
        if (s.trim()) setSel(s)
      })
    }
    document.addEventListener('selectionchange', onSel)
    return () => { document.removeEventListener('selectionchange', onSel); if (raf) cancelAnimationFrame(raf) }
  }, [setSel])

  if (!open) return null
  const isLight = resolvedTheme !== 'dark'
  return (
    <PrimeOSAssistant
      selText={selText}
      docText={getDocText ? getDocText() : ''}
      rect={null}
      isLight={isLight}
      canApply={!!applyFn}
      onApply={(text, mode) => applyFn?.(text, mode)}
      onClose={closePanel}
      initialTurns={turns}
      onTurns={setTurns}
    />
  )
}
