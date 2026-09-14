import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, Clock } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth/role'
import { readMeeting, MODE_LABEL, STATUS_LABEL, participantMinutes } from '@/lib/meetings'
import { livekitConfigured, recordingConfigured } from '@/lib/livekit'
import { getSignedDownloadUrl } from '@/lib/r2'
import { listAnnotations } from '@/lib/annotations'
import MeetingRoom from '@/components/studio/MeetingRoom'
import PickReviewFile from '@/components/studio/PickReviewFile'
import ActionButton from '@/components/studio/ActionButton'
import ColourCheck from '@/components/studio/ColourCheck'
import AnnotationTimeline from '@/components/studio/AnnotationTimeline'

/**
 * ONE MEETING — the room, and what it costs.
 *
 * RENDERED BY BOTH SPACES. Crew · Meetings is the internal floor; Client ·
 * Meetings is the same room addressed to a company. One component rather than
 * two pages, because a second copy is the thing that drifts — Batch 15 deleted
 * ~800 lines of duplicated message machinery for exactly this reason, and the
 * room is more intricate than a message list.
 *
 * READING THIS PAGE IS THE AUTHORIZATION FOR THE MEDIA (S3-b §2.3). The join
 * token is minted only after `readMeeting()` comes back non-null on the USER
 * client, so RLS decides who is in the call. There is no separate permission
 * model for video, which is the trap a "meeting link" design falls into: a URL
 * that works for whoever holds it.
 *
 * THE SIGNED URL IS MINTED HERE, not handed to the browser as a path. R2 objects
 * are private; the player gets a short-lived URL for the file the room has
 * chosen, and only when it can already see the meeting.
 */

export default async function MeetingScreen(
  { id, backHref }: { id: string; backHref: string }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) redirect('/login')

  const detail = await readMeeting(supabase, id)
  // Absent rather than forbidden — RLS makes a foreign meeting invisible and
  // the redirect cannot tell the two apart either (R-6).
  if (!detail) redirect(backHref)

  const { meeting, participants, sync } = detail
  const isReview = meeting.mode === 'review_session'
  const over = meeting.status === 'ended' || meeting.status === 'cancelled'

  // What the room is watching, if anything.
  let fileUrl: string | null = null
  let colour: { colour_space: string | null; transfer: string | null; bit_depth: number | null } | null = null
  if (isReview && sync?.file_id) {
    const { data: f } = await supabase
      .from('files')
      .select('file_path, bucket, file_name, mime_type, colour_space, transfer, bit_depth')
      .eq('id', sync.file_id).maybeSingle()
    const row = f as {
      file_path: string; bucket: string; file_name: string; mime_type: string | null
      colour_space: string | null; transfer: string | null; bit_depth: number | null
    } | null
    if (row) {
      colour = {
        colour_space: row.colour_space, transfer: row.transfer, bit_depth: row.bit_depth,
      }
    }
    if (row?.bucket === 'r2') {
      // Inline, and long enough to outlast a review — a two-minute URL that
      // expires mid-session is a broken player nobody can explain.
      fileUrl = await getSignedDownloadUrl(row.file_path, 3600, {
        disposition: 'inline',
        fileName: row.file_name,
        contentType: row.mime_type ?? undefined,
      })
    }
  }

  // Candidates for the picker: video in the vault this person can already see.
  const { data: videoFiles } = isReview
    ? await supabase
        .from('files').select('id, file_name, mime_type')
        .is('deleted_at', null)
        .like('mime_type', 'video/%')
        .order('created_at', { ascending: false })
        .limit(50)
    : { data: [] }

  const minutes = participantMinutes(participants)

  // What has been marked on this asset — including in earlier sessions, which is
  // the point of persisting them at all.
  const annotations = isReview && sync?.file_id
    ? await listAnnotations(supabase, sync.file_id)
    : []

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href={backHref}
        className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-faint outline-none transition-colors duration-[--dur-pop] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft size={14} /> Meetings
      </Link>

      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-[-0.01em] text-foreground">
            {MODE_LABEL[meeting.mode]}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[13px] text-muted-foreground">
            <span>{STATUS_LABEL[meeting.status]}</span>
            {isReview && sync?.file_id && (
        <section className="mt-8">
          <h2 className="mb-1 font-display text-sm font-semibold text-foreground">Marks on this asset</h2>
          <p className="mb-3 text-[12px] text-muted-foreground">
            Everything drawn on a frame, at the timecode it was drawn — including
            from earlier sessions. Click one to go back to that frame.
          </p>
          <AnnotationTimeline
            fileUrl={fileUrl}
            annotations={annotations.map((a) => ({
              id: a.id, anchor_ms: a.anchor_ms,
              strokes: a.strokes as { x: number; y: number }[][],
              note: a.note, colour: a.colour, created_at: a.created_at,
            }))}
          />
        </section>
      )}

      {participants.length > 0 && (
              <span>{participants.length} {participants.length === 1 ? 'person' : 'people'}</span>
            )}
            {meeting.recording_status && (
              <span className={meeting.recording_status === 'active' ? 'text-destructive' : undefined}>
                {meeting.recording_status === 'active' ? 'Recording' :
                 meeting.recording_status === 'processing' ? 'Recording processing' :
                 meeting.recording_status === 'ready' ? 'Recording ready' : meeting.recording_status}
              </span>
            )}
            {minutes > 0 && (
              <span className="inline-flex items-center gap-1">
                <Clock size={11} /> {minutes} participant-minute{minutes === 1 ? '' : 's'}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {!over && recordingConfigured() && (
            meeting.recording_egress_id ? (
              <ActionButton
                endpoint="/api/studio/meetings"
                body={{ action: 'record-stop', meetingId: meeting.id }}
                label="Stop recording"
                tone="danger"
              />
            ) : (
              <ActionButton
                endpoint="/api/studio/meetings"
                body={{ action: 'record-start', meetingId: meeting.id }}
                label="Record session"
                confirm="Record this session? Everyone in the room should know."
              />
            )
          )}
          {!over && (
            <ActionButton
              endpoint="/api/studio/meetings"
              body={{ action: 'end', meetingId: meeting.id }}
              label="End meeting"
              tone="danger"
              confirm="End this for everybody?"
            />
          )}
        </div>
      </div>

      {isReview && colour && (
        <div className="mb-3">
          {/* Said BEFORE a note is given, not after. */}
          <ColourCheck
            colourSpace={colour.colour_space}
            transfer={colour.transfer}
            bitDepth={colour.bit_depth}
          />
        </div>
      )}

      {isReview && !over && (
        <div className="squircle mb-4 border border-border bg-card px-4 py-3">
          <PickReviewFile
            meetingId={meeting.id}
            current={sync?.file_id ?? null}
            files={(videoFiles ?? []).map((f) => ({
              id: f.id as string, name: f.file_name as string,
            }))}
          />
        </div>
      )}

      {over ? (
        <p className="squircle border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">
          This meeting is over. The record of who attended and for how long stays here.
        </p>
      ) : !livekitConfigured() ? (
        <p className="squircle border border-border bg-card px-4 py-3 text-[13px] text-muted-foreground">
          Video is not configured on this deployment, so there is no room to join yet.
        </p>
      ) : (
        <MeetingRoom meetingId={meeting.id} mode={meeting.mode} fileUrl={fileUrl} fileId={sync?.file_id ?? null} />
      )}

      {participants.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 font-display text-sm font-semibold text-foreground">Who was here</h2>
          <ul className="space-y-1.5">
            {participants.map((p) => (
              <li key={p.id} className="flex items-baseline justify-between gap-3 text-[12px]">
                <span className="text-foreground">{p.role}</span>
                <span className="text-muted-foreground">
                  {Math.round(p.duration_seconds / 60)} min
                  {p.left_at === null && p.joined_at ? ' · in the room' : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
