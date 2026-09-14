import { redirect } from 'next/navigation'
import { Video } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { readMeeting, MODE_LABEL, STATUS_LABEL } from '@/lib/meetings'
import { livekitConfigured } from '@/lib/livekit'
import { getSignedDownloadUrl } from '@/lib/r2'
import { tenantBrand } from '@/lib/tenantBrand'
import MeetingRoom from '@/components/studio/MeetingRoom'

/**
 * THE UNIVERSAL ROOM — for whoever can read the meeting.
 *
 * ── WHY THIS PAGE EXISTS OUTSIDE BOTH SHELLS ─────────────────────────────
 *
 * An external collaborator (`S3-d` MD-4) has no roster row anywhere: not crew,
 * not client. So they belong to neither route group — the studio shell rejects
 * them on `isAdmin`, the portal shell resolves no membership — and until now
 * there was nowhere they could stand to join a call they were legitimately part
 * of. They could read the conversation about a shot and not the review session
 * about it.
 *
 * This page asks the only question that generalises across all three kinds of
 * person: **can you read this meeting row?** 0082's
 * `meetings_room_member_read` is what admits a collaborator, via the seat they
 * already hold in the room the meeting was started from. THE SEAT IS THE INVITE
 * — remove them from the room and they lose the meeting in the same instant, one
 * revocation rather than two.
 *
 * ── IT WEARS THE STUDIO'S BRAND ──────────────────────────────────────────
 *
 * S0-B §2. A collaborator has a relationship with the STUDIO and has never heard
 * of Genreline; the same rule that governs the signing page governs this one.
 *
 * ── NOT A PUBLIC LINK ────────────────────────────────────────────────────
 *
 * A session is still required. This is not a "meeting link that works for
 * whoever holds it" — the URL carries no authority at all, and an unauthenticated
 * visitor is sent to sign in like anywhere else.
 */
export default async function UniversalMeetingPage(
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const detail = await readMeeting(supabase, id)
  // One answer for absent and forbidden (R-6): a meeting you cannot read does
  // not exist to you, and this page cannot tell you which it was either.
  if (!detail) {
    return (
      <div className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="font-display text-xl font-semibold text-foreground">
          This room is not available
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
          It may have finished, or you may no longer be in the room it belongs to.
        </p>
      </div>
    )
  }

  const { meeting, sync } = detail
  const brand = await tenantBrand(meeting.organization_id)
  const over = meeting.status === 'ended' || meeting.status === 'cancelled'

  let fileUrl: string | null = null
  if (meeting.mode === 'review_session' && sync?.file_id) {
    const { data: f } = await supabase
      .from('files').select('file_path, bucket, file_name, mime_type')
      .eq('id', sync.file_id).maybeSingle()
    const row = f as { file_path: string; bucket: string; file_name: string; mime_type: string | null } | null
    if (row?.bucket === 'r2') {
      fileUrl = await getSignedDownloadUrl(row.file_path, 3600, {
        disposition: 'inline',
        fileName: row.file_name,
        contentType: row.mime_type ?? undefined,
      })
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <p className="text-[12px] font-medium uppercase tracking-wider text-faint">
        {brand.name}
      </p>
      <h1 className="mt-1 flex items-center gap-3 font-display text-2xl font-semibold text-foreground">
        <Video size={22} className="text-primary" />
        {MODE_LABEL[meeting.mode]}
      </h1>
      <p className="mt-1 text-[13px] text-muted-foreground">{STATUS_LABEL[meeting.status]}</p>

      <div className="mt-5">
        {over ? (
          <p className="squircle border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">
            This session is over.
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
            endpoint="/api/meet"
          />
        )}
      </div>
    </div>
  )
}
