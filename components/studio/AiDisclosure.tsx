'use client'

import { useCallback, useEffect, useState } from 'react'
import { Sparkles, ShieldCheck, X } from 'lucide-react'

/**
 * THE AI DISCLOSURE for one document — `S-S` Phase D, over 0064.
 *
 * A studio is increasingly asked a question it has had no way to answer: how
 * much of this script came from a model, and which one. Guild agreements,
 * broadcaster deliverables and the EU AI Act's transparency obligations all
 * turn on it, and "we think some of it" is not an answer anybody accepts.
 *
 * PROPORTION, NOT PRESENCE. The pill shows a percentage rather than a boolean
 * because a model that fixed one line and a model that wrote every scene are not
 * the same disclosure, and a badge saying "contains AI" would be equally true of
 * both. `disclosure()` in lib/provenance.ts computes it; this only renders.
 *
 * IT IS VISIBLE WHEN THERE IS NOTHING TO DECLARE, and that is deliberate. A
 * badge that appears only on AI-assisted documents turns itself into an
 * accusation, and people learn to avoid the feature that marks them. "No
 * AI-generated content has been accepted into this document" is a useful
 * sentence to be able to show, and it is only credible if the same surface says
 * the other thing when the other thing is true.
 */

type Model = { model: string; passages: number; chars: number }
type Disclosure = {
  passages: number
  generatedChars: number
  share: number | null
  models: Model[]
  statement: string
}
type Row = {
  id: string
  model: string | null
  prompt: string | null
  chars: number | null
  created_at: string
  params: Record<string, unknown>
}

const ts = (s: string) =>
  new Date(s).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })

export default function AiDisclosure({
  docId,
  docChars,
}: {
  docId: string
  /** Current document length, so the share is a proportion and not a count. */
  docChars?: number | null
}) {
  const [data, setData] = useState<{ disclosure: Disclosure; provenance: Row[] } | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(() => {
    const qs = new URLSearchParams({ document_id: docId })
    if (docChars && docChars > 0) qs.set('doc_chars', String(docChars))
    fetch(`/api/studio/provenance?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) setData(j) })
      // A disclosure that cannot be READ is not a crisis — the record still
      // exists. The pill simply does not render, rather than claiming zero.
      .catch(() => {})
  }, [docId, docChars])

  useEffect(() => { load() }, [load])

  if (!data) return null
  const d = data.disclosure
  const pct = d.share == null ? null : Math.round(d.share * 100)
  const clean = d.passages === 0

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); load() }}
        title="AI content disclosure"
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground outline-none transition-colors duration-[--dur-pop] hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        {clean ? <ShieldCheck size={13} /> : <Sparkles size={13} />}
        {clean ? 'No AI' : pct == null ? `AI · ${d.passages}` : `AI · ${pct}%`}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="AI content disclosure"
          onClick={() => setOpen(false)}
        >
          <div
            className="squircle max-h-[80vh] w-full max-w-lg overflow-y-auto border border-border bg-card p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <h2 className="font-display text-[15px] font-semibold text-foreground">
                AI content disclosure
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X size={15} />
              </button>
            </div>

            <p className="text-[13px] leading-relaxed text-foreground">{d.statement}</p>

            {d.models.length > 0 && (
              <ul className="mt-4 space-y-1.5">
                {d.models.map((m) => (
                  <li key={m.model} className="flex items-baseline justify-between gap-3 text-[12px]">
                    <span className="min-w-0 truncate text-foreground">{m.model}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {m.passages} passage{m.passages === 1 ? '' : 's'} · {m.chars.toLocaleString()} chars
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {data.provenance.length > 0 && (
              <>
                <h3 className="mb-2 mt-5 text-[11px] font-medium uppercase tracking-wider text-faint">
                  Accepted passages
                </h3>
                <ol className="space-y-2">
                  {data.provenance.map((r) => (
                    <li key={r.id} className="squircle-sm border border-border bg-background/40 px-3 py-2">
                      <div className="flex items-baseline justify-between gap-2 text-[11px]">
                        <span className="min-w-0 truncate text-foreground">{r.model ?? 'unknown model'}</span>
                        <span className="shrink-0 text-faint">{ts(r.created_at)}</span>
                      </div>
                      {r.prompt && (
                        // The prompt is the evidence. Shown, not summarised —
                        // "what was asked for" is the question this record
                        // exists to answer.
                        <p className="mt-1 line-clamp-3 text-[11px] italic text-muted-foreground">
                          “{r.prompt}”
                        </p>
                      )}
                      <p className="mt-1 text-[10px] text-faint">
                        {(r.chars ?? 0).toLocaleString()} characters
                        {typeof r.params?.mode === 'string' && ` · ${String(r.params.mode) === 'replace' ? 'replaced selection' : 'inserted below'}`}
                      </p>
                    </li>
                  ))}
                </ol>
              </>
            )}

            <p className="mt-5 text-[11px] leading-relaxed text-faint">
              Recorded to the C2PA action model when generated text is accepted into
              the document. Text a writer generated and discarded is not recorded.
            </p>
          </div>
        </div>
      )}
    </>
  )
}
