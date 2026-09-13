'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'

/**
 * Render one page of a PDF to a canvas.
 *
 * ── WHY pdf.js AND NOT AN <iframe> ───────────────────────────────────────
 *
 * A browser's built-in viewer is a black box: you cannot measure where a page
 * actually sits inside it, so you cannot place a field box over it and be sure
 * the coordinates mean anything. Rendering to a canvas gives an element whose
 * size you own — which is the whole basis of storing field positions as
 * fractions and having them survive into the stamped PDF.
 *
 * ── THE WORKER IS SET ONCE, FROM THE INSTALLED VERSION ───────────────────
 *
 * pdf.js refuses to run if the worker build and the library build disagree, and
 * the failure is a blank page rather than an error. Pointing the worker at the
 * package's own file rather than a CDN version string is what stops that
 * happening silently on the next upgrade.
 */
export default function PdfCanvas({
  url, pageNumber, onPages, className,
}: {
  url: string
  pageNumber: number
  onPages?: (n: number) => void
  className?: string
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let task: { destroy?: () => void } | null = null

    ;(async () => {
      setLoading(true); setError(null)
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString()

        const loading = pdfjs.getDocument({ url })
        const doc = await loading.promise
        if (cancelled) return
        task = loading as unknown as { destroy?: () => void }
        onPages?.(doc.numPages)

        const page = await doc.getPage(Math.min(pageNumber, doc.numPages))
        if (cancelled) return

        const el = canvas.current
        if (!el) return
        // Render at the element's own width so the canvas and the overlay share
        // one coordinate space.
        const parentWidth = el.parentElement?.clientWidth ?? 800
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: parentWidth / base.width })

        el.width = Math.round(viewport.width)
        el.height = Math.round(viewport.height)
        const ctx = el.getContext('2d')
        if (!ctx) return
        await page.render({ canvasContext: ctx, viewport }).promise
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not open that PDF.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true; task?.destroy?.() }
  }, [url, pageNumber, onPages])

  return (
    <div className="relative w-full">
      <canvas ref={canvas} className={className ?? 'block w-full'} />
      {loading && (
        <div className="absolute inset-0 grid place-items-center">
          <Loader2 size={18} className="animate-spin text-faint" />
        </div>
      )}
      {error && (
        <p role="status" className="p-4 text-[12px] text-destructive">{error}</p>
      )}
    </div>
  )
}
