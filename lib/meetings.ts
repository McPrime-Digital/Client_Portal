import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * MEETINGS — the record around the call.
 *
 * LiveKit carries the media. This carries everything that has to survive the
 * call ending: who was in it, for how long (the meter), what production it
 * belonged to, and — for a review session — where the playhead was.
 *
 * ── WHY THIS IS NOT A ZOOM LINK ───────────────────────────────────────────
 *
 * `S3-b` §2.1 makes the Review Session a MODE rather than a separate object, and
 * that mode is the reason the feature exists in a hybrid-film OS. A director, a
 * client and a VFX lead arguing about one shot — half of which came out of a
 * model — need to be on the SAME FRAME, and they need the comment they leave to
 * land on that frame. A screenshare gives you neither: the person watching
 * cannot scrub, and nothing they say is anchored to anything.
 *
 * ── THE PLAYHEAD IS A ROW, AND LIVEKIT CARRIES THE LIVE UPDATES ──────────
 *
 * `meeting_sync_state` (0077) is the durable truth so a late joiner lands on the
 * right frame. The per-scrub updates travel over LIVEKIT'S DATA CHANNEL rather
 * than a Supabase Realtime subscription, and that is deliberate: I-2 caps
 * sessions at two channels and this repo is already at roughly six, so a review
 * session that opened a seventh would be a stop-and-report (S-R §7). The data
 * channel is already open, already authenticated by the same token, and lower
 * latency than a database round trip.
 *
 * ── duration_seconds IS THE METER AND CANNOT BE BACKFILLED ───────────────
 *
 * §2.1: every PARTICIPANT-minute counts, because that is how LiveKit bills.
 * 0061 proved what happens when usage is not recorded at the moment it happens —
 * every row that had cost money was unattributed and could only be recovered by
 * luck. `leaveMeeting` accumulates rather than subtracting timestamps, because a
 * participant who drops and rejoins has two spans and a subtraction would report
 * the gap.
 */

export type MeetingMode = 'call' | 'review_session'
export type MeetingStatus = 'scheduled' | 'live' | 'ended' | 'cancelled'
export type ParticipantRole = 'host' | 'participant' | 'observer'

export type Meeting = {
  id: string
  organization_id: string
  room_id: string | null
  project_id: string | null
  client_id: string | null
  mode: MeetingMode
  provider: string
  provider_room_name: string
  status: MeetingStatus
  scheduled_for: string | null
  started_at: string | null
  ended_at: string | null
  recording_egress_id: string | null
  recording_status: 'requested' | 'active' | 'processing' | 'ready' | 'failed' | null
  recording_file_id: string | null
  recording_started_at: string | null
  created_by: string | null
  created_at: string
}

export type Participant = {
  id: string
  meeting_id: string
  user_id: string | null
  role: ParticipantRole
  joined_at: string | null
  left_at: string | null
  duration_seconds: number
}

export type SyncState = {
  meeting_id: string
  file_id: string | null
  position_ms: number
  playing: boolean
  updated_by: string | null
  updated_at: string
}

const COLUMNS =
  'id, organization_id, room_id, project_id, client_id, mode, provider, provider_room_name, status, scheduled_for, started_at, ended_at, recording_egress_id, recording_status, recording_file_id, recording_started_at, created_by, created_at'

/** A room name that is unique, opaque and NOT the meeting id.
 *
 *  Not the id because a provider room name ends up in logs, URLs and support
 *  tickets on a system that is not ours, and a primary key is the one string
 *  worth not leaking into all three. */
export function providerRoomName(): string {
  return `gl-${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
}

/**
 * INTERNAL or CLIENT-FACING, and the column is the boundary.
 *
 * `client_id` null means the meeting belongs to the studio floor; set means a
 * client company is party to it. Batch 24 settled this exact split for rooms —
 * the crew hub had filtered on `kind`, so a conversation with a client's person
 * landed on the internal floor — and the lesson is the same one table over: the
 * COMPANY COLUMN is the boundary, everywhere.
 *
 * A client never sees the internal list at all, because `meetings_client_read`
 * requires `client_id is not null`. This scope is the studio's own filter, so
 * the two spaces show different work rather than the same list twice.
 */
export type MeetingScope = 'internal' | 'client' | 'all'

export async function listMeetings(
  db: SupabaseClient, orgId: string, scope: MeetingScope = 'all'
): Promise<Meeting[]> {
  let q = db
    .from('meetings')
    .select(COLUMNS)
    .eq('organization_id', orgId)
    // 0073's standing obligation on every crew read.
    .is('deleted_at', null)
    .order('scheduled_for', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(200)

  if (scope === 'internal') q = q.is('client_id', null)
  if (scope === 'client') q = q.not('client_id', 'is', null)

  const { data, error } = await q
  if (error) throw new Error(`listMeetings: ${error.message}`)
  return (data ?? []) as unknown as Meeting[]
}

/** What a client member can see: the meetings their company is party to. RLS
 *  already enforces it; this states the intent alongside (I-9). */
export async function listClientMeetings(db: SupabaseClient): Promise<Meeting[]> {
  const { data, error } = await db
    .from('meetings')
    .select(COLUMNS)
    .not('client_id', 'is', null)
    .is('deleted_at', null)
    .order('scheduled_for', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw new Error(`listClientMeetings: ${error.message}`)
  return (data ?? []) as unknown as Meeting[]
}

export async function readMeeting(
  db: SupabaseClient, id: string
): Promise<{ meeting: Meeting; participants: Participant[]; sync: SyncState | null } | null> {
  const { data: m, error } = await db
    .from('meetings').select(COLUMNS).eq('id', id).is('deleted_at', null).maybeSingle()
  if (error) throw new Error(`readMeeting: ${error.message}`)
  if (!m) return null

  const [{ data: p }, { data: s }] = await Promise.all([
    db.from('meeting_participants')
      .select('id, meeting_id, user_id, role, joined_at, left_at, duration_seconds')
      .eq('meeting_id', id).limit(200),
    db.from('meeting_sync_state')
      .select('meeting_id, file_id, position_ms, playing, updated_by, updated_at')
      .eq('meeting_id', id).maybeSingle(),
  ])

  return {
    meeting: m as unknown as Meeting,
    participants: (p ?? []) as unknown as Participant[],
    sync: (s as unknown as SyncState) ?? null,
  }
}

export async function createMeeting(
  db: SupabaseClient,
  p: {
    organizationId: string
    mode: MeetingMode
    scheduledFor?: string | null
    projectId?: string | null
    clientId?: string | null
    roomId?: string | null
    createdBy: string
  }
): Promise<Meeting | null> {
  const { data, error } = await db.from('meetings').insert({
    organization_id: p.organizationId,
    mode: p.mode,
    provider: 'livekit',
    provider_room_name: providerRoomName(),
    status: 'scheduled',
    scheduled_for: p.scheduledFor ?? null,
    project_id: p.projectId ?? null,
    client_id: p.clientId ?? null,
    room_id: p.roomId ?? null,
    created_by: p.createdBy,
  }).select(COLUMNS).maybeSingle()

  if (error) throw new Error(`createMeeting: ${error.message}`)
  return (data as unknown as Meeting) ?? null
}

/** Idempotent: the first person through the door starts it, everybody else is a
 *  no-op. Two people clicking Join at once must not produce two start times. */
export async function startMeeting(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from('meetings')
    .update({ status: 'live', started_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'scheduled')
  if (error) throw new Error(`startMeeting: ${error.message}`)
}

export async function endMeeting(db: SupabaseClient, id: string): Promise<boolean> {
  const now = new Date().toISOString()
  const { data } = await db.from('meetings')
    .update({ status: 'ended', ended_at: now })
    .eq('id', id).in('status', ['scheduled', 'live']).select('id')
  if ((data ?? []).length === 0) return false

  // Anybody still shown as present is closed out, or their span never ends and
  // the meter keeps climbing on a call that finished.
  await db.from('meeting_participants')
    .update({ left_at: now }).eq('meeting_id', id).is('left_at', null)
  return true
}

export async function cancelMeeting(db: SupabaseClient, id: string): Promise<boolean> {
  const { data } = await db.from('meetings')
    .update({ status: 'cancelled' }).eq('id', id).in('status', ['scheduled', 'live']).select('id')
  return (data ?? []).length > 0
}

/** Get-or-create this person's seat, and stamp the arrival. */
export async function joinMeeting(
  db: SupabaseClient, meetingId: string, userId: string, role: ParticipantRole = 'participant'
): Promise<Participant | null> {
  const { data: existing } = await db.from('meeting_participants')
    .select('id, meeting_id, user_id, role, joined_at, left_at, duration_seconds')
    .eq('meeting_id', meetingId).eq('user_id', userId).maybeSingle()

  if (existing) {
    const { data } = await db.from('meeting_participants')
      .update({ joined_at: new Date().toISOString(), left_at: null })
      .eq('id', (existing as { id: string }).id)
      .select('id, meeting_id, user_id, role, joined_at, left_at, duration_seconds')
      .maybeSingle()
    return (data as unknown as Participant) ?? null
  }

  const { data, error } = await db.from('meeting_participants').insert({
    meeting_id: meetingId,
    user_id: userId,
    role,
    joined_at: new Date().toISOString(),
  }).select('id, meeting_id, user_id, role, joined_at, left_at, duration_seconds').maybeSingle()
  if (error) throw new Error(`joinMeeting: ${error.message}`)
  return (data as unknown as Participant) ?? null
}

/**
 * Close a span and ADD it to the total.
 *
 * Accumulated, never derived from joined_at/left_at at read time: somebody who
 * drops and rejoins has two spans, and subtracting the outer timestamps would
 * bill the gap between them as attendance.
 */
export async function leaveMeeting(
  db: SupabaseClient, meetingId: string, userId: string
): Promise<number> {
  const { data: row } = await db.from('meeting_participants')
    .select('id, joined_at, duration_seconds')
    .eq('meeting_id', meetingId).eq('user_id', userId).maybeSingle()
  if (!row) return 0

  const r = row as { id: string; joined_at: string | null; duration_seconds: number }
  const span = r.joined_at
    ? Math.max(0, Math.round((Date.now() - Date.parse(r.joined_at)) / 1000))
    : 0

  await db.from('meeting_participants')
    .update({ left_at: new Date().toISOString(), duration_seconds: r.duration_seconds + span })
    .eq('id', r.id)

  return span
}

export async function setSyncState(
  db: SupabaseClient,
  p: { meetingId: string; positionMs: number; playing: boolean; fileId?: string | null; userId: string }
): Promise<void> {
  const { error } = await db.from('meeting_sync_state').upsert({
    meeting_id: p.meetingId,
    file_id: p.fileId ?? null,
    position_ms: Math.max(0, Math.round(p.positionMs)),
    playing: p.playing,
    updated_by: p.userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'meeting_id' })
  if (error) throw new Error(`setSyncState: ${error.message}`)
}

export const MODE_LABEL: Record<MeetingMode, string> = {
  call: 'Call',
  review_session: 'Review session',
}

export const STATUS_LABEL: Record<MeetingStatus, string> = {
  scheduled: 'Scheduled',
  live: 'Live now',
  ended: 'Ended',
  cancelled: 'Cancelled',
}

/** Total participant-minutes, which is what LiveKit bills and therefore what
 *  the studio must measure (S3-b §2.1). */
export function participantMinutes(participants: Participant[]): number {
  return Math.round(participants.reduce((n, p) => n + p.duration_seconds, 0) / 60)
}
