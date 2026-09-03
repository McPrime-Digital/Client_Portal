import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isAdmin } from '@/lib/auth/role'
import { roomWithMembership, resolvePeople } from '@/lib/rooms'
import { roomSides, deriveWire, signAttachments, advanceWatermark } from '@/lib/messageRead'
import { decodeCursor, encodeCursor, beforePredicate } from '@/lib/keyset'
import { verifyAttachment, writeAttachmentRow } from '@/lib/messageAttachments'
import { writeMentions, notifyMentions, resolveMentionTargets } from '@/lib/messageMentions'
import { messagePreview } from '@/lib/messagePreview'
import { pushRoomMessageAlert } from '@/lib/notify'

/**
 * /api/rooms/[roomId]/messages — the conversation surface for EVERY room
 * kind (Batch 23, S3-d). Channels, groups, DMs, broadcast and the crew room
 * ride this; client rooms may too (the legacy client/project routes stay for
 * the surfaces already on them — one engine, two doors, recorded in HANDOFF).
 *
 * The layering rule of this file:
 *   · MESSAGE READS use the caller's own client. The 0046 policies ARE the
 *     scope — membership, per-seat history, tag visibility, the closed door
 *     of a deleted room — so the query carries no restatement of any of them
 *     (a restatement is a second definition that drifts; A-5).
 *   · The SEND is a user-client INSERT: RLS enforces membership, can_post
 *     (MD-5), the sender pin and the org pin. A forged send dies in the
 *     database, not in route code being careful.
 *   · The service role appears for exactly three jobs a session rightly
 *     cannot do: cross-roster name/receipt resolution, R2 presigning, and
 *     the delivered stamp on OTHER people's rows.
 */

const SendSchema = z.object({
  body: z.string().max(20_000).optional().default(''),
  reply_to_id: z.string().uuid().nullish(),
  thread_root_id: z.string().uuid().nullish(),
  attachment_file_id: z.string().uuid().nullish(),
  attachment_url: z.string().max(2048).nullish(),
  attachment_name: z.string().max(512).nullish(),
})

const SELECT_WIRE =
  '*, message_attachments(file_id, files(bucket, file_path, file_name)), message_reactions(user_id, emoji), message_mentions(kind, target_id)'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stripJoins(rows: any[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((row: any) => {
    const { message_attachments, message_reactions, message_mentions, ...m } = row
    void message_attachments
    return {
      ...m,
      reactions: message_reactions ?? [],
      mentions: message_mentions ?? [],
    }
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scrub(rows: any[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((m: any) =>
    m.deleted_at || m.is_deleted
      ? { ...m, body: '', attachment_url: null, attachment_name: null, attachment_file_id: null }
      : m
  )
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { room, membership } = await roomWithMembership(supabase, roomId, user.id)
  if (!room || !membership) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const orgId = room.organization_id as string

  // ── People / mention candidates ───────────────────────────────────────────
  if (req.nextUrl.searchParams.get('members') === '1') {
    const { data: seats } = await supabase
      .from('room_members')
      .select('user_id, role, can_post, display_name, avatar_url')
      .eq('room_id', roomId).is('left_at', null).limit(500)
    const people = await resolvePeople(supabaseAdmin, orgId, seats ?? [])
    const users = [...people.values()].map((p) => ({
      id: p.userId, name: p.name, avatarUrl: p.avatarUrl, side: p.side, role: p.role,
    }))
    return NextResponse.json({ users, projects: [] })
  }

  const sides = await roomSides(supabaseAdmin, {
    roomId, orgId, clientId: (room.client_id as string) ?? null, kind: room.kind as string,
  })

  const limitParam = parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10)
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 50
  let cursor
  try {
    cursor = decodeCursor(req.nextUrl.searchParams.get('before'))
  } catch {
    return NextResponse.json({ error: 'Malformed cursor' }, { status: 400 })
  }

  // ── Search in conversation ────────────────────────────────────────────────
  const q = req.nextUrl.searchParams.get('q')
  if (q && q.trim()) {
    const { data: hits, error } = await supabase
      .from('messages')
      .select(SELECT_WIRE)
      .eq('room_id', roomId)
      .is('deleted_at', null)
      .textSearch('body_tsv', q.trim(), { type: 'websearch' })
      .order('created_at', { ascending: false })
      .limit(30)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const rows = await signAttachments(supabaseAdmin, scrub(deriveWire(stripJoins(hits ?? []), sides)))
    return NextResponse.json({ messages: rows, roomId, nextCursor: null, hasMore: false })
  }

  // ── Pins panel ────────────────────────────────────────────────────────────
  if (req.nextUrl.searchParams.get('pins') === 'full') {
    const { data: pinRows } = await supabase
      .from('message_pins')
      .select(`pinned_at, messages(${SELECT_WIRE})`)
      .eq('room_id', roomId)
      .order('pinned_at', { ascending: false })
      .limit(100)
    const pinned = (pinRows ?? [])
      .map((p) => (Array.isArray(p.messages) ? p.messages[0] : p.messages))
      .filter((m) => m != null)
    const rows = await signAttachments(supabaseAdmin, scrub(deriveWire(stripJoins(pinned), sides)))
    return NextResponse.json({ messages: rows, roomId, nextCursor: null, hasMore: false })
  }

  // ── Thread panel ──────────────────────────────────────────────────────────
  const threadRoot = req.nextUrl.searchParams.get('thread_root')
  if (threadRoot) {
    let thQ = supabase
      .from('messages')
      .select(SELECT_WIRE)
      .eq('room_id', roomId)
      .eq('thread_root_id', threadRoot)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1)
    if (cursor) thQ = thQ.or(beforePredicate(cursor))
    const { data: replies, error } = await thQ
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const page = replies ?? []
    const hasMore = page.length > limit
    const trimmed = hasMore ? page.slice(0, limit) : page
    const oldest = trimmed[trimmed.length - 1] as { created_at: string; id: string } | undefined
    const nextCursor = hasMore && oldest ? encodeCursor({ t: oldest.created_at, id: oldest.id }) : null
    const rows = await signAttachments(supabaseAdmin, scrub(deriveWire(stripJoins(trimmed.slice().reverse()), sides)))
    return NextResponse.json({ messages: rows, roomId, nextCursor, hasMore })
  }

  // ── Main list (keyset; `around` for jump-to-message) ─────────────────────
  const aroundId = req.nextUrl.searchParams.get('around')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let newestFirst: any[] = []
  if (aroundId) {
    const { data: target } = await supabase
      .from('messages').select('id, created_at')
      .eq('id', aroundId).eq('room_id', roomId).maybeSingle()
    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const half = Math.floor(limit / 2)
    const [olderRes, newerRes] = await Promise.all([
      supabase.from('messages').select(SELECT_WIRE)
        .eq('room_id', roomId)
        .or(`created_at.lt.${target.created_at},and(created_at.eq.${target.created_at},id.lte.${target.id})`)
        .order('created_at', { ascending: false }).order('id', { ascending: false })
        .limit(half + 1),
      supabase.from('messages').select(SELECT_WIRE)
        .eq('room_id', roomId)
        .or(`created_at.gt.${target.created_at},and(created_at.eq.${target.created_at},id.gt.${target.id})`)
        .order('created_at', { ascending: true }).order('id', { ascending: true })
        .limit(half),
    ])
    const err = olderRes.error ?? newerRes.error
    if (err) return NextResponse.json({ error: err.message }, { status: 500 })
    newestFirst = [...(newerRes.data ?? []).slice().reverse(), ...(olderRes.data ?? [])]
  } else {
    let msgQ = supabase
      .from('messages')
      .select(SELECT_WIRE)
      .eq('room_id', roomId)
      .is('thread_root_id', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1)
    if (cursor) msgQ = msgQ.or(beforePredicate(cursor))
    const { data, error } = await msgQ
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    newestFirst = data ?? []
  }

  const page = newestFirst.slice(0, aroundId ? undefined : limit + 1)
  const hasMore = !aroundId && page.length > limit
  const trimmed = hasMore ? page.slice(0, limit) : page
  const oldest = trimmed[trimmed.length - 1] as { created_at: string; id: string } | undefined
  const nextCursor =
    (hasMore || (aroundId && oldest)) && oldest
      ? encodeCursor({ t: oldest.created_at, id: oldest.id })
      : null

  const wire = scrub(deriveWire(stripJoins(trimmed.slice().reverse()), sides))
  const signedRows = await signAttachments(supabaseAdmin, wire)

  // Pins ids + reply meta for this page
  const { data: pinIdRows } = await supabase
    .from('message_pins').select('message_id').eq('room_id', roomId).limit(200)
  const rootIds = signedRows.map((m) => m.id as string)
  const replyMeta: Record<string, { count: number; lastAt: string }> = {}
  if (rootIds.length) {
    const { data: replyRows } = await supabase
      .from('messages').select('thread_root_id, created_at')
      .eq('room_id', roomId)
      .in('thread_root_id', rootIds)
      .is('deleted_at', null)
    for (const r of replyRows ?? []) {
      const k = r.thread_root_id as string
      const cur = replyMeta[k]
      replyMeta[k] = {
        count: (cur?.count ?? 0) + 1,
        lastAt: !cur || r.created_at > cur.lastAt ? r.created_at : cur.lastAt,
      }
    }
  }

  // Mention targets per viewer
  const pageMentions = signedRows.flatMap((m) => (m.mentions as { kind: string; target_id: string }[] | undefined) ?? [])
  const crewViewer = isAdmin(user)
  const mentionTargets = pageMentions.length
    ? await resolveMentionTargets(supabaseAdmin, pageMentions, {
        role: crewViewer ? 'admin' : 'client',
        orgId,
        clientId: (room.client_id as string) ?? null,
        projectHrefBase: crewViewer ? '/studio/client/projects' : '/projects',
      })
    : null

  // Sender avatars for the bubble heads — the owner's ask, resolved from the
  // roster with the seat as the collaborator fallback.
  const { data: seats } = await supabase
    .from('room_members')
    .select('user_id, role, can_post, display_name, avatar_url')
    .eq('room_id', roomId).limit(500)
  const people = await resolvePeople(supabaseAdmin, orgId, seats ?? [])
  const senders: Record<string, { name: string; avatarUrl: string | null }> = {}
  for (const [id, p] of people) senders[id] = { name: p.name, avatarUrl: p.avatarUrl }

  return NextResponse.json({
    messages: signedRows,
    roomId,
    nextCursor,
    hasMore: !!hasMore,
    replyMeta,
    pinnedIds: (pinIdRows ?? []).map((p) => p.message_id as string),
    mentionTargets,
    senders,
    room: {
      id: room.id, kind: room.kind, name: room.name, topic: room.topic,
      clientId: room.client_id, archived: room.archived_at != null,
      memberCount: (seats ?? []).length,
    },
    membership: { role: membership.role, canPost: !!membership.can_post && membership.role !== 'viewer', notify: membership.notify },
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = SendSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid message payload' }, { status: 400 })
  const input = parsed.data
  if (!input.body.trim() && !input.attachment_file_id && !input.attachment_url) {
    return NextResponse.json({ error: 'Empty message' }, { status: 400 })
  }

  const { room, membership } = await roomWithMembership(supabase, roomId, user.id)
  if (!room || !membership) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (room.archived_at) {
    return NextResponse.json({ error: 'This room is archived — read-only.' }, { status: 403 })
  }
  const orgId = room.organization_id as string

  // Attachment reference verified against the files table + this org (I-6).
  let att
  try {
    att = await verifyAttachment(supabaseAdmin, {
      fileId: input.attachment_file_id ?? null,
      url: input.attachment_url ?? null,
      orgId,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Invalid attachment' }, { status: 400 })
  }

  // The sender's display name: roster first, seat fallback (collaborators).
  const people = await resolvePeople(supabaseAdmin, orgId, [
    { user_id: user.id, role: membership.role as string, can_post: !!membership.can_post,
      display_name: membership.display_name as string | null, avatar_url: membership.avatar_url as string | null },
  ])
  const senderName = people.get(user.id)?.name ?? 'Member'

  // THE INSERT IS THE AUTHORIZATION: user client, so 0046 decides — member,
  // can_post, sender pin, org pin, approval gate, archived door.
  const { data: inserted, error } = await supabase
    .from('messages')
    .insert({
      room_id: roomId,
      organization_id: orgId, // must match the room's — the policy checks it
      project_id: null,       // tags belong to the client-room model
      sender_id: user.id,
      sender_name: senderName,
      body: input.body,
      attachment_name: att?.name ?? null,
      reply_to_id: input.reply_to_id ?? null,
      thread_root_id: input.thread_root_id ?? null,
    })
    .select()
    .single()
  if (error) {
    const status = /policy|row-level|violates/i.test(error.message) ? 403 : 500
    return NextResponse.json({ error: status === 403 ? 'You cannot post in this room.' : error.message }, { status })
  }

  if (att) await writeAttachmentRow(supabaseAdmin, inserted.id, att.fileId)

  let mentionedIds: string[] = []
  try {
    const mentioned = await writeMentions(supabaseAdmin, {
      messageId: inserted.id,
      body: input.body,
      orgId,
      clientId: (room.client_id as string) ?? null,
    })
    mentionedIds = mentioned.map((m) => m.id)
    await notifyMentions(supabaseAdmin, {
      roomId,
      mentionedUsers: mentioned,
      senderUserId: user.id,
      senderName,
      preview: messagePreview({ body: input.body, attachment_name: att?.name ?? null }),
    })
  } catch (e) {
    console.error('[rooms send] mention write failed:', e)
  }

  await pushRoomMessageAlert({
    roomId,
    orgId,
    senderId: user.id,
    senderName,
    mentionedUserIds: mentionedIds,
    preview: messagePreview({ body: input.body, attachment_name: att?.name ?? null }),
    crewSender: isAdmin(user),
  })

  return NextResponse.json({
    message: {
      ...inserted,
      sender_role: isAdmin(user) ? 'admin' : 'client',
      attachment_url: att?.url ?? null,
      attachment_file_id: att?.fileId ?? null,
      read_at: null,
    },
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

  const { room, membership } = await roomWithMembership(supabase, roomId, user.id)
  if (!room || !membership) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))

  // Delivered marks OTHER people's rows — the one service-role write here.
  await supabaseAdmin
    .from('messages')
    .update({ delivered_at: new Date().toISOString() })
    .eq('room_id', roomId)
    .neq('sender_id', user.id)
    .is('delivered_at', null)

  if (body?.mode !== 'delivered') {
    // The watermark is the caller's own row; the user client writes it under
    // Class C RLS, and the scope read inside respects the message policies.
    await advanceWatermark(supabase, { userId: user.id, roomId })
  }
  return NextResponse.json({ ok: true })
}
