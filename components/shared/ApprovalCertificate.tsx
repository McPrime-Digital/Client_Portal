import type { ApprovalDetail } from '@/lib/approvals'

/**
 * The certificate — Batch 22 item 10 (S-F §3.3, S3-c §2.3).
 *
 * Subject, version, approver, decision, timestamp, and the chain of stages.
 * A server component with print styles; the browser's Print-to-PDF is the
 * export path, because a real PDF pipeline needs the queue that does not
 * exist yet (I-4).
 *
 * THE SENTENCE THIS FILE EXISTS FOR. An `auto_advanced` outcome renders in
 * plain language and NEVER as approval, verbatim from S3-c §2.3:
 *
 *   No response was received by the agreed review date. Work proceeded under
 *   the review window in the production agreement. This is not a client
 *   approval.
 *
 * That sentence is what protects the studio. "Your system approved it on our
 * behalf" is a bad position in a dispute; "you had five days, we reminded you
 * three times, and we proceeded as agreed" is a strong one. It is not
 * decoration, it is not subject to shortening, and it is not conditional on
 * anything below.
 */

const AUTO_ADVANCED_SENTENCE =
  'No response was received by the agreed review date. Work proceeded under the ' +
  'review window in the production agreement. This is not a client approval.'

const ts = (s: string) =>
  new Date(s).toLocaleString('en-US', {
    weekday: 'short', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  })

const OUTCOME: Record<ApprovalDetail['approval']['status'], string> = {
  open: 'Awaiting review',
  approved: 'Approved',
  rejected: 'Rejected',
  changes_requested: 'Changes requested',
  auto_advanced: 'Proceeded without a response',
  withdrawn: 'Withdrawn',
}

export default function ApprovalCertificate({
  detail,
  studioName,
  logoUrl,
}: {
  detail: ApprovalDetail
  studioName: string
  logoUrl: string | null
}) {
  const { approval, stages, events } = detail
  const lapsed = approval.status === 'auto_advanced' || stages.some((s) => s.status === 'auto_advanced')
  const reminders = events.filter((e) => e.event_type === 'approval_reminded')

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 print:px-0 print:py-0">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { margin: 18mm; }
          body { background: #fff !important; }
        }
      `}</style>

      <div className="no-print mb-6 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Use your browser&rsquo;s Print command to save this as a PDF.
        </p>
      </div>

      <header className="mb-8 flex items-start gap-4 border-b border-border pb-6">
        {logoUrl ? (
          // The STUDIO's mark. Never the product's on a client-facing page
          // (S0-B §2) — and never a hardcoded studio either.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="h-12 w-12 rounded-lg object-contain" />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-secondary text-lg font-semibold text-muted-foreground">
            {studioName.slice(0, 1)}
          </div>
        )}
        <div className="min-w-0">
          <p className="font-display text-lg font-semibold text-foreground">{studioName}</p>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Record of review
          </p>
        </div>
      </header>

      <section className="mb-8">
        <h1 className="font-display text-2xl font-semibold text-foreground">{approval.title}</h1>
        <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Subject</dt>
            <dd className="text-foreground">{approval.subject_kind.replace('_', ' ')}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Outcome</dt>
            <dd className="font-medium text-foreground">{OUTCOME[approval.status]}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Opened</dt>
            <dd className="text-foreground">{ts(approval.created_at)}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Review window</dt>
            <dd className="text-foreground">
              {approval.review_window_hours ? `${approval.review_window_hours} hours` : 'Studio default'}
            </dd>
          </div>
          {approval.subject_version_id && (
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Version</dt>
              <dd className="font-mono text-xs text-foreground">{approval.subject_version_id}</dd>
            </div>
          )}
        </dl>
      </section>

      {/* The sentence. Rendered before the chain, because in a dispute it is
          the first thing that must be read — and never rendered as approval. */}
      {lapsed && (
        <section
          className="mb-8 rounded-xl border px-5 py-4"
          style={{ borderColor: 'hsl(var(--border))', backgroundColor: 'hsl(var(--secondary) / 0.4)' }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Notice
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-foreground">{AUTO_ADVANCED_SENTENCE}</p>
          {reminders.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {reminders.length} reminder{reminders.length === 1 ? ' was' : 's were'} sent before the
              window closed; each is listed below with its channel and recipient.
            </p>
          )}
        </section>
      )}

      <section className="mb-8">
        <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Chain of review
        </h2>
        <ol className="space-y-4">
          {stages.map((s) => (
            <li key={s.id} className="border-l-2 border-border pl-4">
              <p className="text-sm font-medium text-foreground">
                {s.seq}. {s.name}
              </p>
              <p className="text-xs text-muted-foreground">
                {s.status === 'auto_advanced'
                  ? 'Proceeded without a response'
                  : s.status.replace('_', ' ')}
                {s.deadline_at ? ` · review date ${ts(s.deadline_at)}` : ''}
                {s.advanced_at ? ` · advanced ${ts(s.advanced_at)}` : ''}
              </p>
              {s.decisions.length === 0 && s.status === 'auto_advanced' && (
                // Stated explicitly rather than left as an empty list: the
                // ABSENCE of a decision is the substantive fact here.
                <p className="mt-1 text-xs italic text-muted-foreground">
                  No decision was recorded on this stage.
                </p>
              )}
              {s.decisions.map((d) => {
                const late = s.advanced_at != null && d.decided_at > s.advanced_at
                return (
                  <div key={d.id} className="mt-2">
                    <p className="text-xs text-foreground">
                      <strong className="font-medium">{d.actor_name}</strong> —{' '}
                      {d.decision.replace('_', ' ')}
                      {late && (
                        <span className="ml-1 font-medium" style={{ color: 'hsl(var(--destructive))' }}>
                          (recorded after the review window closed)
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{ts(d.decided_at)}</p>
                    {d.comment && (
                      <p className="mt-0.5 text-xs italic text-muted-foreground">&ldquo;{d.comment}&rdquo;</p>
                    )}
                  </div>
                )
              })}
            </li>
          ))}
        </ol>
      </section>

      {reminders.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Reminders sent
          </h2>
          <ol className="space-y-1.5">
            {reminders.map((e) => {
              const m = e.meta ?? {}
              return (
                <li key={e.id} className="text-xs text-foreground">
                  {ts(e.created_at)} · {String(m.channel ?? 'email')} &rarr;{' '}
                  {String(m.recipient ?? 'recipient')}
                  {m.delivered === false && (
                    <span className="text-muted-foreground"> (delivery failed)</span>
                  )}
                </li>
              )
            })}
          </ol>
        </section>
      )}

      <footer className="border-t border-border pt-4 text-[11px] text-muted-foreground">
        <p>
          Generated {ts(new Date().toISOString())} from the review record held by {studioName}.
          Reference {approval.id}.
        </p>
      </footer>
    </div>
  )
}
