'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Trash2, Check } from 'lucide-react'
import PdfCanvas from './PdfCanvas'

/**
 * DRAG A BOX ONTO THE PAGE AND SAY WHO FILLS IT.
 *
 * This is the DocuSign gesture, and the thing that was missing. What is stored
 * is not a pixel rectangle: every box is a FRACTION of its page with a top-left
 * origin, so it lands in the same place on a phone, on a 4K monitor and in the
 * stamped PDF. Pixels would be correct exactly once, on the machine that placed
 * them.
 *
 * ── FIELDS ARE FIXED ONCE THE CONTRACT IS SENT, AND SO IS THIS EDITOR ───
 *
 * A field moved after sending changes the document without changing its hash,
 * which is the one edit a signed record cannot survive. The route refuses it and
 * this is only rendered on a draft.
 *
 * ── SAVE REPLACES THE WHOLE SET ──────────────────────────────────────────
 *
 * The editor shows every field at once, so a box the person deleted is absent
 * from what it sends. A merge would make deletion impossible.
 */

type Kind = 'signature' | 'initials' | 'date' | 'text' | 'checkbox'
type Field = {
  signerId: string | null
  kind: Kind
  page: number
  x: number; y: number; w: number; h: number
  required: boolean
}

const KIND_LABEL: Record<Kind, string> = {
  signature: 'Signature', initials: 'Initials', date: 'Date',
  text: 'Text', checkbox: 'Checkbox',
}

export default function FieldPlacer({
  contractId, pdfUrl, signers, initial,
}: {
  contractId: string
  pdfUrl: string
  signers: { id: string; name: string }[]
  initial: Field[]
}) {
  const router = useRouter()
  const [fields, setFields] = useState<Field[]>(initial)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [kind, setKind] = useState<Kind>('signature')
  const [signerId, setSignerId] = useState<string | null>(signers[0]?.id ?? null)
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onPages = useCallback((n: number) => setPages(n), [])

  function rel(e: React.PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    }
  }

  async function save() {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/studio/contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save-fields', contractId, fields }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j?.error ?? 'Could not save the fields.')
        return
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      router.refresh()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  const onPage = fields.filter((f) => f.page === page)

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={kind} onChange={(e) => setKind(e.target.value as Kind)}
          aria-label="Field type"
          className="squircle-sm border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
            <option key={k} value={k}>{KIND_LABEL[k]}</option>
          ))}
        </select>
        <select
          value={signerId ?? ''} onChange={(e) => setSignerId(e.target.value || null)}
          aria-label="Who fills it"
          className="squircle-sm border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {signers.length === 0 && <option value="">Add a signer first</option>}
          {signers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        {pages > 1 && (
          <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
            <button
              type="button" onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="squircle-sm border border-border px-2 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >‹</button>
            Page {page} of {pages}
            <button
              type="button" onClick={() => setPage((p) => Math.min(pages, p + 1))}
              className="squircle-sm border border-border px-2 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >›</button>
          </span>
        )}

        <button
          type="button" onClick={() => void save()} disabled={busy}
          className="squircle-sm inline-flex items-center gap-1.5 bg-primary px-3 py-1 text-[12px] font-medium text-primary-foreground outline-none transition-opacity duration-[--dur-pop] hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save fields
        </button>
        {saved && <span className="text-[12px] text-muted-foreground">Saved</span>}
        {error && <span role="status" className="text-[12px] text-destructive">{error}</span>}
      </div>

      <div
        className="squircle relative select-none overflow-hidden border border-border bg-card"
        onPointerDown={(e) => { if (signerId) setDrag(rel(e)) }}
        onPointerUp={(e) => {
          if (!drag || !signerId) { setDrag(null); return }
          const end = rel(e)
          const x = Math.min(drag.x, end.x), y = Math.min(drag.y, end.y)
          const w = Math.abs(end.x - drag.x), h = Math.abs(end.y - drag.y)
          setDrag(null)
          // A click rather than a drag gets a sensible default box, because
          // demanding a precise drag for every field is how a placer becomes
          // tedious.
          const box = w < 0.02 || h < 0.01
            ? { x, y, w: 0.26, h: 0.045 }
            : { x, y, w, h }
          setFields((f) => [...f, { signerId, kind, page, required: true, ...box }])
        }}
      >
        <PdfCanvas url={pdfUrl} pageNumber={page} onPages={onPages} />

        {onPage.map((f) => {
          const i = fields.indexOf(f)
          const who = signers.find((s) => s.id === f.signerId)?.name ?? 'Unassigned'
          return (
            <div
              key={i}
              className="absolute border-2 border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.12)]"
              style={{
                left: `${f.x * 100}%`, top: `${f.y * 100}%`,
                width: `${f.w * 100}%`, height: `${f.h * 100}%`,
              }}
            >
              <span className="absolute -top-4 left-0 whitespace-nowrap text-[10px] text-primary">
                {KIND_LABEL[f.kind]} · {who}
              </span>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setFields((all) => all.filter((_, j) => j !== i))}
                aria-label="Remove field"
                className="absolute -right-1 -top-1 rounded bg-card p-0.5 text-faint outline-none hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Trash2 size={10} />
              </button>
            </div>
          )
        })}
      </div>

      <p className="mt-2 text-[11px] text-faint">
        Drag a box where it should be signed, or click for a default one. Positions
        are stored as a fraction of the page, so they land identically on any screen
        and in the final PDF.
      </p>
    </div>
  )
}
