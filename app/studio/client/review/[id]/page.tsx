import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, Clock, FileText, ShieldCheck, ShieldAlert, ShieldX, UserRound, Building2, Users, Eye } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth/role'
import { requireOrgFeature } from '@/lib/studio/guard'
import { capGate } from '@/lib/capabilities.server'
import { readApproval } from '@/lib/approvals'
import { approvalIntel, DEFENSIBILITY_LABEL, type Defensibility, type IntelView } from '@/lib/approvalIntel'
import { listViewsForSubject } from '@/lib/shareLinks'
import { clearanceFor } from '@/lib/rights'
import ClearancePanel from '@/components/shared/ClearancePanel'
import { approvalTimeline, TIMELINE_TONE } from '@/lib/approvalTimeline'
import { listAnnotations } from '@/lib/annotations'
import { getSignedDownloadUrl } from '@/lib/r2'
import AnnotationTimeline from '@/components/studio/AnnotationTimeline'
import ColourCheck from '@/components/studio/ColourCheck'

/**
 * THE RECORD, AT A URL — `S-S` Phase C.
 *
 * Until this page the chain lived in an accordion (`ApprovalRecord`), opened
 * with `useState`. That made the single strongest thing in the product
 * unlinkable: you could not send it to a colleague, cite it in an email, or
 * deep-link it from the notification that told you it needed attention. The
 * only addressable artifact was `/certificate`, which is the FORMAL export —
 * there was nothing between "a row you can expand" and "a document you print".
 *
 * This is that middle. It is also where `approvalIntel` earns its place: the
 * page leads with how this record would READ IF IT WERE DISPUTED TODAY, while
 * there is still time to do something about it.
 *
 * GATED TWICE, deliberately and differently. `requireOrgFeature` answers "is
 * this surface held at all"; `record.ledger.read` answers "may this person read
 * the dispute surface" — the same capability the list route gates on, so
 * finance (money across every production, the craft floor absent) does not
 * reach it. RLS is the third and the real one: `readApproval` runs on the USER
 * client, so a foreign or out-of-scope approval is ABSENT rather than refused
 * (R-6), and the redirect below cannot distinguish the two either.
 */

const SHIELD: Record<Defensibility, typeof ShieldCheck> = {
  strong: ShieldCheck,
  thin: ShieldAlert,
  broken: ShieldX,
}

const SHIELD_TONE: Record<Defensibility, string> = {
  strong: 'text-primary',
  thin: 'text-[hsl(var(--status-amber,var(--destructive)))]',
  broken: 'text-destructive',
}

const STATUS_LABEL: Record<string, string> = {
  open: 'Awaiting review',
  approved: 'Approved',
  rejected: 'Rejected',
  changes_requested: 'Changes requested',
  auto_advanced: 'Proceeded — no response',
  withdrawn: 'Withdrawn',
}

const STAGE_LABEL: Record<string, string> = {
  pending: 'Not started',
  active: 'In review',
  complete: 'Decided',
  auto_advanced: 'Proceeded — no response',
  blocked_on_changes: 'Changes requested',
  blocked_on_permission: 'Blocked — nobody can act',
}

function ts(s: string) {
  return new Date(s).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

/** "in 3 days" / "2 days ago" — a deadline is only useful as a distance. */
function distance(hours: number) {
  const abs = Math.abs(hours)
  const n = abs < 48 ? Math.round(abs) : Math.round(abs / 24)
  const unit = abs < 48 ? 'hour' : 'day'
  const plural = n === 1 ? '' : 's'
  return hours >= 0 ? `in ${n} ${unit}${plural}` : `${n} ${unit}${plural} ago`
}

export default async function ApprovalRecordPage(
  { params }: { params: Promise<{ id: string }> }
) {
  await requireOrgFeature('client', 'review')
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) redirect('/login')

  const denied = await capGate(user, 'record.ledger.read')
  if (denied) redirect('/studio')

  const detail = await readApproval(supabase, id)
  if (!detail) redirect('/studio/client/review')

  // THE NOTES NEXT TO THE RECORD. An approval whose subject is a cut should show
  // what people actually drew on it — the argument and the decision in one place,
  // rather than a decision whose reasons live in a call nobody recorded.
  const subjectFileId =
    detail.approval.subject_kind === 'file_version' ? detail.approval.subject_id : null
  const annotations = subjectFileId ? await listAnnotations(supabase, subjectFileId) : []
  let subjectUrl: string | null = null
  let subjectColour:
    { colour_space: string | null; transfer: string | null; bit_depth: number | null } | null = null
  if (subjectFileId) {
    const { data: f } = await supabase
      .from('files')
      .select('file_path, bucket, file_name, mime_type, colour_space, transfer, bit_depth')
      .eq('id', subjectFileId).maybeSingle()
    const row = f as {
      file_path: string; bucket: string; file_name: string; mime_type: string | null
      colour_space: string | null; transfer: string | null; bit_depth: number | null
    } | null
    if (row) {
      subjectColour = {
        colour_space: row.colour_space, transfer: row.transfer, bit_depth: row.bit_depth,
      }
      if (row.bucket === 'r2' && (row.mime_type ?? '').startsWith('video/')) {
        subjectUrl = await getSignedDownloadUrl(row.file_path, 3600, {
          disposition: 'inline', fileName: row.file_name,
          contentType: row.mime_type ?? undefined,
        })
      }
    }
  }

  // ── WHAT THE APPROVER ACTUALLY SAW ─────────────────────────────────────
  //
  // 0085's screening links record how far a guest got. This is the join that
  // made them worth building: DocuSign's certificate says a document was viewed
  // and never how much; Frame.io records viewing and never attaches it to a
  // decision. Read on the USER client, so a scoped member sees only the links
  // 0087 admits them to.
  //
  // `undefined` where there is no file subject, and that is NOT `[]`: one means
  // nobody asked, the other means nothing was recorded, and they must not grade
  // the same.
  let views: IntelView[] | undefined
  if (subjectFileId) {
    const rows = await listViewsForSubject(supabase, 'file', subjectFileId)
    views = rows.map((v) => ({
      at: v.started_at,
      who: v.viewer_name || v.viewer_email,
      furthestMs: v.furthest_ms,
      durationMs: v.duration_ms,
    }))
  }

  // CLEARANCE, BEFORE DELIVERY. 0079 makes a completed release write the rights
  // row; until 0088 nothing read it back, so a studio held the evidence it needs
  // for the New York and EU disclosure rules and could not see it.
  const clearance = subjectFileId
    ? (await clearanceFor(supabase, [subjectFileId])).get(subjectFileId) ?? null
    : null

  const intel = approvalIntel({ ...detail, views })
  const entries = approvalTimeline(detail)
  const Shield = SHIELD[intel.defensibility]

  const waiting =
    intel.waitingOn === 'client' ? 'Waiting on the client'
    : intel.waitingOn === 'studio' ? 'Waiting on you'
    : 'Nothing outstanding'

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/studio/client/review"
        className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-faint outline-none transition-colors duration-[--dur-pop] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft size={14} />
        Review &amp; Approvals
      </Link>

      <div className="mb-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-faint">
        <FileText size={12} />
        {detail.approval.subject_kind.replace('_', ' ')}
      </div>
      <h1 className="font-display text-2xl font-semibold tracking-[-0.01em] text-foreground">
        {detail.approval.title}
      </h1>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {STATUS_LABEL[detail.approval.status] ?? detail.approval.status} · opened {ts(detail.approval.created_at)}
      </p>

      {/* THE VERDICT (SS-5 — one primary statement per surface). Not the
          status: the status says what happened, this says how it would read. */}
      <section className="squircle mt-6 border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <Shield size={20} className={`mt-0.5 shrink-0 ${SHIELD_TONE[intel.defensibility]}`} strokeWidth={1.75} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-display text-[15px] font-semibold text-foreground">{waiting}</span>
              <span className={`text-[12px] font-medium ${SHIELD_TONE[intel.defensibility]}`}>
                · {DEFENSIBILITY_LABEL[intel.defensibility]}
              </span>
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{intel.because}</p>
            {/* Positive evidence only. Nothing renders where nothing was
                recorded — the portal's own player tracks none, so silence here
                says nothing about the approver and must not look like it does. */}
            {intel.viewing && (
              <p className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-relaxed text-muted-foreground">
                <Eye size={12} className={`mt-1 shrink-0 ${intel.viewing.token ? SHIELD_TONE.thin : 'text-faint'}`} />
                {intel.viewing.sentence}
              </p>
            )}

            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] text-muted-foreground">
              {intel.deadlineAt && intel.hoursLeft != null && (
                <span className={intel.overdue ? 'text-destructive' : undefined}>
                  <Clock size={11} className="mr-1 inline align-[-1px]" />
                  Review date {distance(intel.hoursLeft)}
                </span>
              )}
              <span>
                {intel.remindersDelivered} reminder{intel.remindersDelivered === 1 ? '' : 's'} delivered
                {intel.remindersFailed > 0 && (
                  <span className="text-destructive"> · {intel.remindersFailed} failed</span>
                )}
              </span>
              {intel.peopleReached > 0 && (
                <span>reached {intel.peopleReached} {intel.peopleReached === 1 ? 'person' : 'people'}</span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* THE CHAIN — who was asked, and what each of them did. */}
      <section className="mt-8">
        <h2 className="mb-3 font-display text-sm font-semibold text-foreground">The chain</h2>
        <ol className="space-y-2">
          {detail.stages.map((s) => (
            <li key={s.id} className="squircle-sm border border-border bg-card px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-[13px] font-medium text-foreground">
                  {s.seq}. {s.name}
                </span>
                <span
                  className={`text-[11px] ${
                    s.status === 'blocked_on_permission' ? 'text-destructive' : 'text-muted-foreground'
                  }`}
                >
                  {STAGE_LABEL[s.status] ?? s.status}
                </span>
              </div>

              {/* Addressed to. An EMPTY list is stated in words rather than
                  rendered as nothing, because "nobody was asked" is the single
                  most consequential fact this page can carry. */}
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                {s.assignees.length === 0 ? (
                  <span className="text-destructive">
                    Addressed to nobody — no assignee remains on this stage.
                  </span>
                ) : (
                  s.assignees.map((a) => (
                    <span key={a.id} className="inline-flex items-center gap-1">
                      {a.client_id ? <Building2 size={11} /> : a.user_id ? <UserRound size={11} /> : <Users size={11} />}
                      {a.client_id ? 'Client company' : a.user_id ? 'Crew member' : (a.role ?? 'Role')}
                      {!a.required && <span className="text-faint">(optional)</span>}
                    </span>
                  ))
                )}
              </p>

              {s.decisions.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {s.decisions.map((d) => (
                    <li key={d.id} className="text-[12px]">
                      <span className="text-foreground">
                        <strong className="font-medium">{d.actor_name}</strong>{' '}
                        {d.decision.replace('_', ' ')}
                      </span>
                      <span className="text-faint"> · {ts(d.decided_at)}</span>
                      {d.comment && (
                        <span className="mt-0.5 block italic text-muted-foreground">“{d.comment}”</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </section>

      {/* CLEARANCE SITS ABOVE THE NOTES, and above the decision. What the asset
          is allowed to be used for is a precondition of delivering it, not a
          footnote after the argument about the cut. */}
      {clearance && (
        <section className="mt-8">
          <ClearancePanel clearance={clearance} audience="studio" />
        </section>
      )}

      {subjectFileId && (
        <section className="mt-8">
          <h2 className="mb-1 font-display text-sm font-semibold text-foreground">
            What was marked on it
          </h2>
          <p className="mb-2 text-[12px] text-muted-foreground">
            Notes drawn on the picture during review, at the frame they were made.
          </p>
          {subjectColour && (
            <div className="mb-3">
              <ColourCheck
                colourSpace={subjectColour.colour_space}
                transfer={subjectColour.transfer}
                bitDepth={subjectColour.bit_depth}
              />
            </div>
          )}
          <AnnotationTimeline
            fileUrl={subjectUrl}
            annotations={annotations.map((a) => ({
              id: a.id, anchor_ms: a.anchor_ms,
              strokes: a.strokes as { x: number; y: number }[][],
              note: a.note, colour: a.colour, created_at: a.created_at,
            }))}
          />
        </section>
      )}

      {/* THE TIMELINE — the same entries the accordion renders, from the same
          function, so the two can never tell different stories. */}
      <section className="mt-8">
        <h2 className="mb-3 font-display text-sm font-semibold text-foreground">Everything that happened</h2>
        {entries.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            Nothing has been recorded on this approval yet.
          </p>
        ) : (
          <ol className="space-y-2.5">
            {entries.map((e, i) => (
              <li key={`${e.at}-${i}`} className="flex gap-2.5 text-xs">
                <span
                  className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: `hsl(${TIMELINE_TONE[e.kind] ?? 'var(--border)'})` }}
                />
                <span className="min-w-0 flex-1">
                  <span className="text-foreground">
                    <strong className="font-medium">{e.who}</strong> · {e.what}
                  </span>
                  {e.detail && (
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">{e.detail}</span>
                  )}
                  <span className="mt-0.5 flex items-center gap-1 text-[10px] text-faint">
                    <Clock size={9} /> {ts(e.at)}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <Link
        href={`/studio/client/review/${id}/certificate`}
        className="squircle-sm mt-8 inline-flex items-center border border-border bg-card px-3 py-1.5 text-[13px] text-foreground outline-none transition-[border-color,transform] duration-[--dur-pop] ease-[--ease-out] hover:border-[hsl(var(--glow)/0.45)] focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
      >
        Open printable certificate
      </Link>
    </div>
  )
}
