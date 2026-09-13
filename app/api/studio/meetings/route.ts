import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdmin, userOrgId } from '@/lib/auth/role'
import { capGate } from '@/lib/capabilities.server'
import { rosterName } from '@/lib/team'
import {
  createMeeting, readMeeting, startMeeting, endMeeting, cancelMeeting,
  joinMeeting, leaveMeeting, setSyncState,
} from '@/lib/meetings'
import { mintJoinToken, livekitConfigured, livekitUrl } from '@/lib/livekit'
import { recordUsage } from '@/lib/usage'
import { captureError } from '@/lib/errors'

/**
 * Meetings — schedule, join, drive the review playhead, end.
 *
 * ── THE TOKEN IS THE WHOLE SECURITY STORY ─────────────────────────────────
 *
 * `S3-b` §2.3: "No token is ever issued to a browser that has not passed the
 * same RLS-backed check that would let it read the meeting row."
 *
 * That is literally how `join` works below — `readMeeting()` runs on the USER
 * client, and a null result ends the request. There is no second permission
 * model for media: if RLS hides the meeting, there is no token, and without a
 * token there is no way into the room. A LiveKit token is a bearer credential,
 * so the check has to happen before it exists rather than around it.
 *
 * ── AN OBSERVER CANNOT PUBLISH, AND THAT IS IN THE TOKEN ─────────────────
 *
 * `canPublish: false` is a grant, not a UI state. A UI state is a suggestion
 * somebody can disable in a console; the grant is enforced by the SFU.
 *
 * ── MINUTES ARE METERED ON LEAVE, NOT ON A TIMER ─────────────────────────
 *
 * §2.1 makes participant-minutes a consumable. They are recorded through the one
 * write path (`recordUsage`) when a span closes, because 0061 is the standing
 * proof that usage not recorded at the moment it happens is usage that cannot be
 * reconstructed afterwards.
 */

const Create = z.object({
  action: z.literal('create'),
  mode: z.enum(['call', 'review_session']),
  scheduledFor: z.iso.datetime({ offset: true }).nullish(),
  projectId: z.uuid().nullish(),
  clientId: z.uuid().nullish(),
})
const Join = z.object({ action: z.literal('join'), meetingId: z.uuid() })
const Leave = z.object({ action: z.literal('leave'), meetingId: z.uuid() })
const End = z.object({ action: z.literal('end'), meetingId: z.uuid() })
const Cancel = z.object({ action: z.literal('cancel'), meetingId: z.uuid() })
const Sync = z.object({
  action: z.literal('sync'),
  meetingId: z.uuid(),
  positionMs: z.number().int().min(0).max(86_400_000),
  playing: z.boolean(),
  fileId: z.uuid().nullish(),
})

const Body = z.discriminatedUnion('action', [Create, Join, Leave, End, Cancel, Sync])

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const denied = await capGate(user, 'work.project.read')
  if (denied) return NextResponse.json(denied, { status: 403 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request.' }, { status: 400 }
    )
  }
  const b = parsed.data

  try {
    if (b.action === 'create') {
      const meeting = await createMeeting(supabase, {
        organizationId: userOrgId(user),
        mode: b.mode,
        scheduledFor: b.scheduledFor ?? null,
        projectId: b.projectId ?? null,
        clientId: b.clientId ?? null,
        createdBy: user.id,
      })
      if (!meeting) {
        return NextResponse.json(
          { error: 'That production is not in your scope.' }, { status: 403 }
        )
      }
      return NextResponse.json({ id: meeting.id })
    }

    // Everything below is about ONE meeting, and reading it on the user client
    // IS the authorization (S3-b §2.3).
    const detail = await readMeeting(supabase, b.meetingId)
    if (!detail) return NextResponse.json({ error: 'No such meeting.' }, { status: 404 })

    if (b.action === 'join') {
      if (!livekitConfigured()) {
        return NextResponse.json({
          error: 'Video is not configured on this deployment. Set LIVEKIT_API_KEY, LIVEKIT_API_SECRET and NEXT_PUBLIC_LIVEKIT_URL.',
        }, { status: 503 })
      }
      if (detail.meeting.status === 'ended' || detail.meeting.status === 'cancelled') {
        return NextResponse.json({ error: 'That meeting is over.' }, { status: 409 })
      }

      await startMeeting(supabase, b.meetingId)
      const seat = await joinMeeting(supabase, b.meetingId, user.id)

      const token = await mintJoinToken({
        roomName: detail.meeting.provider_room_name,
        identity: user.id,
        displayName: (await rosterName(user)) ?? user.email ?? 'Guest',
        // The grant, not a UI flag.
        canPublish: seat?.role !== 'observer',
      })
      if (!token) {
        return NextResponse.json({ error: 'Could not mint a join token.' }, { status: 503 })
      }

      return NextResponse.json({
        token,
        url: livekitUrl(),
        sync: detail.sync,
        mode: detail.meeting.mode,
      })
    }

    if (b.action === 'leave') {
      const seconds = await leaveMeeting(supabase, b.meetingId, user.id)
      if (seconds > 0) {
        // One write path, and the minute is recorded as it happens.
        await recordUsage(
          detail.meeting.organization_id,
          'meeting.minutes',
          Math.max(1, Math.round(seconds / 60)),
          0,                                   // metered, not charged — yet
          { meeting_id: b.meetingId, seconds },
          user.id,
          detail.meeting.project_id,           // chargeback (0062)
        )
      }
      return NextResponse.json({ ok: true, seconds })
    }

    if (b.action === 'end') {
      const ended = await endMeeting(supabase, b.meetingId)
      if (!ended) return NextResponse.json({ error: 'Already over.' }, { status: 409 })
      return NextResponse.json({ ok: true })
    }

    if (b.action === 'cancel') {
      const cancelled = await cancelMeeting(supabase, b.meetingId)
      if (!cancelled) return NextResponse.json({ error: 'Already over.' }, { status: 409 })
      return NextResponse.json({ ok: true })
    }

    // sync — the durable playhead. Live scrubs travel over LiveKit's data
    // channel; this is what a LATE JOINER reads, which is why it is written at
    // all rather than being broadcast-only.
    await setSyncState(supabase, {
      meetingId: b.meetingId,
      positionMs: b.positionMs,
      playing: b.playing,
      fileId: b.fileId ?? null,
      userId: user.id,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    captureError(e, { route: 'studio/meetings', action: b.action })
    return NextResponse.json({ error: 'Could not complete that.' }, { status: 500 })
  }
}
