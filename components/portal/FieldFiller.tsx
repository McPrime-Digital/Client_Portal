'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import PdfCanvas from '@/components/studio/PdfCanvas'

/**
 * Fill the boxes that were placed for you.
 *
 * ── ONLY YOUR FIELDS ARE INTERACTIVE ─────────────────────────────────────
 *
 * Somebody else's boxes are drawn, greyed and inert, because a signer needs to
 * see that other people have to sign too — a page showing only your own fields
 * makes a three-party agreement look like a one-party one. The row-level rule
 * (`contract_fields_signer_update`) is what actually stops you writing them;
 * this is the courtesy.
 *
 * ── A SIGNATURE FIELD IS A TYPED NAME ────────────────────────────────────
 *
 * There is no drawing canvas, deliberately. What carries enforceability is
 * intent, consent and association with the record — all three are captured
 * elsewhere and none of them is a picture. A squiggle would imply the drawing is
 * the legally operative part, which is exactly the misconception to avoid.
 */

type Field = {
  id: string
  signer_id: string | null
  kind: 'signature' | 'initials' | 'date' | 'text' | 'checkbox'
  page: number
  x: number; y: number; w: number; h: number
  required: boolean
  value: string | null
}

export default function FieldFiller({
  pdfUrl, fields, mySignerId, endpoint, identity,
}: {
  pdfUrl: string
  fields: Field[]
  mySignerId: string | null
  /** '/api/portal/contracts' for a session, '/api/sign' for a link. */
  endpoint: string
  /** `{ contractId }` or `{ token }` — whatever that endpoint identifies by. */
  identity: Record<string, string>
}) {
  const router = useRouter()
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.id, f.value ?? '']))
  )
  const [error, setError] = useState<string | null>(null)

  async function persist(fieldId: string, value: string) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'fill-field', ...identity, fieldId, value: value || null }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j?.error ?? 'Could not save that.')
        return
      }
      setError(null)
      router.refresh()
    } catch {
      setError('Could not reach the server.')
    }
  }

  const onPage = fields.filter((f) => f.page === page)
  const outstanding = fields.filter(
    (f) => f.signer_id === mySignerId && f.required && !values[f.id]
  ).length

  return (
    <div>
      {pages > 1 && (
        <div className="mb-2 flex items-center gap-2 text-[12px] text-muted-foreground">
          <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="squircle-sm border border-border px-2 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring">‹</button>
          Page {page} of {pages}
          <button type="button" onClick={() => setPage((p) => Math.min(pages, p + 1))}
            className="squircle-sm border border-border px-2 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring">›</button>
        </div>
      )}

      <div className="squircle relative overflow-hidden border border-border bg-card">
        <PdfCanvas url={pdfUrl} pageNumber={page} onPages={setPages} />

        {onPage.map((f) => {
          const mine = f.signer_id === mySignerId
          const style = {
            left: `${f.x * 100}%`, top: `${f.y * 100}%`,
            width: `${f.w * 100}%`, height: `${f.h * 100}%`,
          }
          if (!mine) {
            return (
              <div key={f.id} className="absolute border border-dashed border-border bg-secondary/40" style={style}>
                <span className="absolute -top-4 left-0 whitespace-nowrap text-[10px] text-faint">
                  Someone else
                </span>
              </div>
            )
          }
          if (f.kind === 'checkbox') {
            return (
              <label key={f.id} className="absolute grid place-items-center border-2 border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.1)]" style={style}>
                <input
                  type="checkbox"
                  checked={values[f.id] === 'true'}
                  onChange={(e) => {
                    const v = e.target.checked ? 'true' : ''
                    setValues((s) => ({ ...s, [f.id]: v }))
                    void persist(f.id, v)
                  }}
                  className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
                />
              </label>
            )
          }
          return (
            <input
              key={f.id}
              type={f.kind === 'date' ? 'date' : 'text'}
              value={values[f.id] ?? ''}
              onChange={(e) => setValues((s) => ({ ...s, [f.id]: e.target.value }))}
              onBlur={(e) => void persist(f.id, e.target.value)}
              placeholder={f.kind === 'signature' ? 'Type your full name' : f.kind}
              aria-label={`${f.kind} field`}
              className="absolute border-2 border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.08)] px-1 text-[12px] text-foreground outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-ring"
              style={style}
            />
          )
        })}
      </div>

      <p className="mt-2 text-[12px] text-muted-foreground">
        {outstanding > 0
          ? `${outstanding} required ${outstanding === 1 ? 'box' : 'boxes'} still to fill before you can sign.`
          : 'Every required box is filled.'}
      </p>
      {error && <p role="status" className="mt-1 text-[12px] text-destructive">{error}</p>}
    </div>
  )
}
