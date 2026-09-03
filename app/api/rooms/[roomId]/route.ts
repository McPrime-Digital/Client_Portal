import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { roomWithMembership, resolvePeople } from '@/lib/rooms'

/**
 * /api/rooms/[roomId] — room detail and management (Batch 23, S3-d).
 *
 * GET returns the room, the caller's seat, and the resolved people list —
 * the People panel's data. Membership is proven with the USER client (RLS);
 * only the roster name/avatar resolution crosses to the service role.
 *
 * PATCH (rename / topic / privacy / archive) runs entirely on the USER
 * client: 0046's manager_update policy IS the authorization. Zero rows
 * updated means "not yours to manage" — surfaced as 403, not silence
 * (PostgREST returns no error on a policy miss; the count is the truth).
 */

const PatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  topic: z.string().trim().max(240).nullable().optional(),
  is_private: z.boolean().optional(),
  archived: z.boolean().optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'empty patch' })

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { room, membership } = await roomWithMembership(supabase, roomId, user.id)
  if (!room || !membership) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: seats } = await supabase
    .from('room_members')
    .select('user_id, role, can_post, notify, joined_at, display_name, avatar_url')
    .eq('room_id', roomId)
    .is('left_at', null)
    .limit(500)
  const people = await resolvePeople(supabaseAdmin, room.organization_id as string, seats ?? [])
  return NextResponse.json({
    room,
    membership,
    members: (seats ?? []).map((s) => ({
      ...people.get(s.user_id as string),
      notify: s.user_id === user.id ? s.notify : undefined,
      joinedAt: s.joined_at,
    })),
    me: user.id,
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = PatchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid patch' }, { status: 400 })
  const p = parsed.data

  const patch: Record<string, unknown> = {}
  if (p.name !== undefined) patch.name = p.name
  if (p.topic !== undefined) patch.topic = p.topic
  if (p.is_private !== undefined) patch.is_private = p.is_private
  if (p.archived !== undefined) patch.archived_at = p.archived ? new Date().toISOString() : null

  const { data, error } = await supabase
    .from('message_rooms')
    .update(patch)
    .eq('id', roomId)
    // client/crew rooms are server-owned surfaces; their names are the
    // company and 'General', and neither is a rename target.
    .in('kind', ['channel', 'group', 'dm', 'broadcast'])
    .select('id, name, topic, is_private, archived_at')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Only a room manager can change this room.' }, { status: 403 })
  }
  return NextResponse.json({ room: data[0] })
}
