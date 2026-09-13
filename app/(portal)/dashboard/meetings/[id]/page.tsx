import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { can } from '@/lib/capabilities.server'
import { readMeeting, MODE_LABEL, STATUS_LABEL } from '@/lib/meetings'
import { livekitConfigured } from '@/lib/livekit'
import { getSignedDownloadUrl } from '@/lib/r2'
import MeetingRoom from '@/components/studio/MeetingRoom'

/**
 * The client's side of the room.
 *
 * SAME ROOM, SAME RULE. The join token is minted only after `readMeeting()`
 * comes back non-null on the USER client (S3-b §2.3), and
 * `meetings_client_read` is what admits this person. There is no invite list, no
 * meeting password and no separate link — the row IS the permission.
 *
 * WHAT IS ABSENT RATHER THAN DISABLED: recording, ending, the file picker. Those
 * are the studio's calls, and R-6 says a thing somebody may not do is not shown
 * greyed out.
 *
 * In a review session this person can drive the playhead and DRAW ON THE FRAME
 * (0081). That is the reason to run one instead of a screenshare: the person
 * giving the note can point at the thing.
 */
export default async function PortalMeetingPage(
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await can(user, 'portal.view'))) redirect('/dashboard')

  const detail = await readMeeting(supabase, id)
  // Absent rather than forbidden — an internal meeting is simply invisible here
  // and the redirect cannot tell the two apart either.
  if (!detail) redirect('/dashboard/meetings')

  const { meeting, sync } = detail
  const over = meeting.status === 'ended' || meeting.status === 'cancelled'

  let fileUrl: string | null = null
  if (meeting.mode === 'review_session' && sync?.file_id) {
    const { data: f } = await supabase
      .from('files').select('file_path, bucket, file_name, mime_type')
      .eq('id', sync.file_id).maybeSingle()
    const row = f as { file_path: string; bucket: string; file_name: string; mime_type: string | null } | null
    if (row?.bucket === 'r2') {
      // Long enough to outlast a review: a two-minute URL expiring mid-session
      // is a broken player nobody can explain.
      fileUrl = await getSignedDownloadUrl(row.file_path, 3600, {
        disposition: 'inline',
        fileName: row.file_name,
        contentType: row.mime_type ?? undefined,
      })
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/dashboard/meetings"
        className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-faint outline-none transition-colors duration-[--dur-pop] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft size={14} /> Meetings
      </Link>

      <h1 className="font-display text-2xl font-semibold tracking-[-0.01em] text-foreground">
        {MODE_LABEL[meeting.mode]}
      </h1>
      <p className="mt-1 text-[13px] text-muted-foreground">{STATUS_LABEL[meeting.status]}</p>

      <div className="mt-4">
        {over ? (
          <p className="squircle border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">
            This meeting is over.
          </p>
        ) : !livekitConfigured() ? (
          <p className="squircle border border-border bg-card px-4 py-3 text-[13px] text-muted-foreground">
            Video is not available on this deployment yet.
          </p>
        ) : (
          <MeetingRoom
            meetingId={meeting.id}
            mode={meeting.mode}
            fileUrl={fileUrl}
            fileId={sync?.file_id ?? null}
            endpoint="/api/portal/meetings"
          />
        )}
      </div>
    </div>
  )
}
