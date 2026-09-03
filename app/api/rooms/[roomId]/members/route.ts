import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { userOrgId } from '@/lib/auth/role'
import { roomWithMembership, addRoomMembers, removeRoomMember } from '@/lib/rooms'

/**
 * /api/rooms/[roomId]/members — seating (Batch 23, S3-d §5.3).
 *
 * Writes run on the USER client wherever 0046's policies express the rule:
 * a manager seats and unseats; a member sets their own notify level and
 * leaves (the 0043 trigger confines self-service to exactly those two). The
 * service role appears ONLY to validate that a proposed seat belongs to this
 * tenant's two trees — a read the client session is rightly refused.
 *
 * Add-by-email (the external collaborator invite, MD-4) is NOT here yet:
 * that path mints an auth account and sends tenant-voiced mail, and it goes
 * through the invite system when it lands — recorded in HANDOFF, not
 * smuggled in as a side effect of seating.
 */

const AddSchema = z.object({
  member_ids: z.array(z.string().uuid()).min(1).max(200),
  role: z.enum(['admin', 'member', 'viewer']).optional(),
  can_post: z.boolean().optional(),
})

const PatchSchema = z.object({
  user_id: z.string().uuid().optional(),      // absent → self
  role: z.enum(['admin', 'member', 'viewer']).optional(),
  can_post: z.boolean().optional(),
  notify: z.enum(['all', 'mentions', 'muted']).optional(),
}).refine((v) => v.role !== undefined || v.can_post !== undefined || v.notify !== undefined,
  { message: 'empty patch' })

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = AddSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid members payload' }, { status: 400 })

  const { room, membership } = await roomWithMembership(supabase, roomId, user.id)
  if (!room || !membership) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!['owner', 'admin'].includes(membership.role as string)) {
    return NextResponse.json({ error: 'Only a room manager can add people.' }, { status: 403 })
  }

  // Tenant validation (I-6): every proposed seat must be an active member of
  // one of this org's two trees. Unknown ids are dropped, not guessed at.
  const orgId = (room.organization_id as string) || userOrgId(user)
  const ids = [...new Set(parsed.data.member_ids)]
  const [{ data: oms }, { data: cms }] = await Promise.all([
    supabaseAdmin.from('organization_members').select('user_id')
      .eq('organization_id', orgId).eq('status', 'active').in('user_id', ids),
    supabaseAdmin.from('client_members').select('user_id')
      .eq('organization_id', orgId).eq('status', 'active').in('user_id', ids),
  ])
  const ok = new Set([
    ...(oms ?? []).map((r) => r.user_id as string),
    ...(cms ?? []).map((r) => r.user_id as string),
  ])
  const seats = ids.filter((id) => ok.has(id)).map((userId) => ({
    userId,
    role: parsed.data.role,
    canPost: parsed.data.can_post ?? (room.kind !== 'broadcast'),
  }))
  if (seats.length === 0) {
    return NextResponse.json({ error: 'None of those people are in this organization.' }, { status: 400 })
  }

  try {
    await addRoomMembers(supabase, { roomId, addedBy: user.id, members: seats })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Seating failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, added: seats.length })
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
  const target = p.user_id ?? user.id

  const patch: Record<string, unknown> = {}
  if (p.notify !== undefined) patch.notify = p.notify
  if (p.role !== undefined) patch.role = p.role
  if (p.can_post !== undefined) patch.can_post = p.can_post

  // The USER client carries the whole rule: self-updates pass the self
  // policy and the 0043 trigger (notify only); manager updates pass the
  // manager policy. Zero rows back means the policy said no.
  const { data, error } = await supabase
    .from('room_members')
    .update(patch)
    .eq('room_id', roomId)
    .eq('user_id', target)
    .is('left_at', null)
    .select('user_id')
  if (error) {
    const denied = /members may change only/.test(error.message)
    return NextResponse.json(
      { error: denied ? 'Only your notification level is yours to change here.' : error.message },
      { status: denied ? 403 : 500 }
    )
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Not permitted.' }, { status: 403 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const target = typeof body?.user_id === 'string' ? body.user_id : user.id

  if (target === user.id) {
    // Leaving is self-service (the trigger permits exactly this write).
    const { data, error } = await supabase
      .from('room_members')
      .update({ left_at: new Date().toISOString() })
      .eq('room_id', roomId).eq('user_id', user.id).is('left_at', null)
      .select('user_id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data?.length) return NextResponse.json({ error: 'Not a member.' }, { status: 404 })
    return NextResponse.json({ ok: true })
  }

  const { membership } = await roomWithMembership(supabase, roomId, user.id)
  if (!membership || !['owner', 'admin'].includes(membership.role as string)) {
    return NextResponse.json({ error: 'Only a room manager can remove people.' }, { status: 403 })
  }
  try {
    await removeRoomMember(supabase, { roomId, userId: target })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Removal failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
