import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { readMeeting, joinMeeting, leaveMeeting, setSyncState } from '@/lib/meetings'
import { createAnnotation, normaliseStrokes } from '@/lib/annotations'
import { mintJoinToken, livekitConfigured, livekitUrl } from '@/lib/livekit'
import { recordUsage } from '@/lib/usage'
import { captureError } from '@/lib/errors'

/**
 * THE PARTICIPANT ENDPOINT — join, drive the playhead, annotate, leave.
 *
 * ── ONE ROUTE FOR EVERY KIND OF PARTICIPANT, AND THE ROW IS THE PERMISSION ─
 *
 * `S3-b` §2.3: no token is ever issued to a browser that has not passed the
 * RLS-backed check that would let it read the meeting row. That sentence is the
 * ENTIRE authorization here — there is no capability gate above it, and that is
 * deliberate rather than an omission.
 *
 * Three different kinds of person legitimately join a meeting, and they are
 * admitted by three different policies:
 *
 *   · a client member        → `meetings_client_read` (their company, their scope)
 *   · an external collaborator → `meetings_room_member_read` (0082 — their SEAT
 *                                in the room the meeting was started from)
 *   · a crew member joining as a participant → `meetings_crew_all`
 *
 * A capability check above that would have to enumerate all three and would go
 * stale the first time a fourth appears — which is exactly what happened before
 * 0082: the collaborator could read the conversation about a shot and not join
 * the review session about it, because every gate asked "which roster are you
 * on" and they are on none.
 *
 * So the question this route asks is the only one that generalises: **can you
 * read this meeting?** If RLS says no, `readMeeting` returns null, and there is
 * no token. A meeting somebody cannot see does not exist to them.
 *
 * ── WHAT A CLIENT CANNOT DO, AND WHY IT IS ABSENT RATHER THAN DISABLED ───
 *
 * No create, no end, no cancel, no recording. Those are the studio's calls — a
 * client ending a session everybody else is in, or starting a recording of it,
 * is not a permission question so much as a category error. The actions simply
 * do not exist on this route (R-6: a denied thing is ABSENT, not greyed out).
 *
 * ── WHAT THEY CAN DO, AND WHY IT MATTERS ─────────────────────────────────
 *
 * Drive the shared playhead, and DRAW ON THE FRAME. The reason to run a review
 * session rather than a screenshare is that the person giving the note can point
 * at the thing; a client who can only watch is a client describing what they
 * mean in words. 0081 is the policy that makes their mark writable — their own
 * company's material, their own row.
 */

/** The name the room shows. Read from the client roster on the USER client —
 *  the self-read policies already permit it — and falling back to the address
 *  rather than to a placeholder, because "Guest" next to a face in a review
 *  session helps nobody. */
async function displayNameFor(
  db: Awaited<ReturnType<typeof createClient>>, userId: string, fallback: string
): Promise<string> {
  // A collaborator has NO roster row anywhere, so their name lives on their room
  // seat (0049's display_name). Three lookups in falling order of specificity,
  // ending at the address — "Guest" beside a face in a review session helps
  // nobody, and a collaborator is usually the person who made the shot.
  const { data: crew } = await db
    .from('organization_members').select('name').eq('user_id', userId)
    .eq('status', 'active').limit(1).maybeSingle()
  if ((crew as { name: string } | null)?.name) return (crew as { name: string }).name

  const { data: client } = await db
    .from('client_members').select('name').eq('user_id', userId)
    .eq('status', 'active').limit(1).maybeSingle()
  if ((client as { name: string } | null)?.name) return (client as { name: string }).name

  const { data: seat } = await db
    .from('room_members').select('display_name').eq('user_id', userId)
    .not('display_name', 'is', null).limit(1).maybeSingle()
  return ((seat as { display_name: string } | null)?.display_name) || fallback
}

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('join'), meetingId: z.uuid() }),
  z.object({ action: z.literal('leave'), meetingId: z.uuid() }),
  z.object({
    action: z.literal('sync'),
    meetingId: z.uuid(),
    positionMs: z.number().int().min(0).max(86_400_000),
    playing: z.boolean(),
    fileId: z.uuid().nullish(),
  }),
  z.object({
    action: z.literal('annotate'),
    meetingId: z.uuid(),
    fileId: z.uuid(),
    anchorMs: z.number().int().min(0).max(86_400_000),
    strokes: z.array(z.array(z.object({ x: z.number(), y: z.number() }))).max(200),
    note: z.string().trim().max(2000).nullish(),
    colour: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  }),
])

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request.' }, { status: 400 }
    )
  }
  const b = parsed.data

  try {
    // THE authorization. A meeting this person cannot read does not exist to
    // them, and neither does a token for it.
    const detail = await readMeeting(supabase, b.meetingId)
    if (!detail) return NextResponse.json({ error: 'No such meeting.' }, { status: 404 })

    if (b.action === 'join') {
      if (!livekitConfigured()) {
        return NextResponse.json({ error: 'Video is not configured.' }, { status: 503 })
      }
      if (detail.meeting.status === 'ended' || detail.meeting.status === 'cancelled') {
        return NextResponse.json({ error: 'That meeting is over.' }, { status: 409 })
      }

      // A client never STARTS the meeting — they arrive at one. The studio's
      // join is what flips it live.
      const seat = await joinMeeting(supabase, b.meetingId, user.id, 'participant')

      const token = await mintJoinToken({
        roomName: detail.meeting.provider_room_name,
        identity: user.id,
        displayName: await displayNameFor(supabase, user.id, user.email ?? 'Guest'),
        canPublish: seat?.role !== 'observer',
      })
      if (!token) {
        return NextResponse.json({ error: 'Could not mint a join token.' }, { status: 503 })
      }

      return NextResponse.json({
        token, url: livekitUrl(), sync: detail.sync, mode: detail.meeting.mode,
      })
    }

    if (b.action === 'leave') {
      const seconds = await leaveMeeting(supabase, b.meetingId, user.id)
      if (seconds > 0) {
        // A client's minutes are the STUDIO's cost — LiveKit bills every
        // participant-minute — so they are recorded against the studio's org
        // and its production, not lost because the person was on the far side.
        await recordUsage(
          detail.meeting.organization_id,
          'meeting.minutes',
          Math.max(1, Math.round(seconds / 60)),
          0,
          { meeting_id: b.meetingId, seconds, side: 'client' },
          user.id,
          detail.meeting.project_id,
        )
      }
      return NextResponse.json({ ok: true, seconds })
    }

    if (b.action === 'annotate') {
      const annotation = await createAnnotation(supabase, {
        organizationId: detail.meeting.organization_id,
        fileId: b.fileId,
        anchorMs: b.anchorMs,
        strokes: normaliseStrokes(b.strokes),
        note: b.note ?? null,
        colour: b.colour,
        meetingId: b.meetingId,
        createdBy: user.id,
      })
      // 0081 admits only their own company's material; absent is a refusal.
      if (!annotation) {
        return NextResponse.json({ error: 'You cannot mark that asset.' }, { status: 403 })
      }
      return NextResponse.json({ annotation })
    }

    await setSyncState(supabase, {
      meetingId: b.meetingId,
      positionMs: b.positionMs,
      playing: b.playing,
      fileId: b.fileId ?? null,
      userId: user.id,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    captureError(e, { route: 'meet', action: b.action })
    return NextResponse.json({ error: 'Could not complete that.' }, { status: 500 })
  }
}
