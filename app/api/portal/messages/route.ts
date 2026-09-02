import { portalClientId, portalAccess } from '@/lib/team'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { advanceWatermark, roomSides, deriveWire } from '@/lib/messageRead'
import { decodeCursor, encodeCursor, beforePredicate } from '@/lib/keyset'
import { resolveMentionTargets } from '@/lib/messageMentions'

// Thread reads and read-marking for the portal. Two thread shapes since
// Batch 14: a PROJECT thread (?project_id=…) and the company's GENERAL
// thread (?scope=general — untagged messages, the room-level conversation a
// project-less client starts with).

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('id, organization_id')
    .eq('id', await portalClientId(user))
    .single()

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  // Member scoping — project allowlist + owner-set message-history cutoff.
  const access = await portalAccess(user)

  // The General thread travels as project_id="room:<clientId>" or as
  // ?scope=general; ?scope=room is the All view. THE 18/19 PORTAL BUG LIVED
  // HERE: this guard predated scope=room and mention_candidates and ran
  // FIRST, so it 400'd the portal's All view AND its autocomplete/tag-pill
  // roster fetch — "All doesn't show project chats" and "no tag selector on
  // the portal" were this one ordering mistake. Guards run after the
  // requests they must not strangle.
  const rawProjectId = req.nextUrl.searchParams.get('project_id')
  const scope = req.nextUrl.searchParams.get('scope')
  const general = scope === 'general' || (rawProjectId?.startsWith('room:') ?? false)
  const projectId = general ? null : rawProjectId
  if (
    !projectId &&
    !general &&
    scope !== 'room' &&
    req.nextUrl.searchParams.get('mention_candidates') !== '1'
  ) {
    return NextResponse.json({ error: 'Missing project_id' }, { status: 400 })
  }

  // Mention autocomplete sources (item 5): the roster that belongs in this
  // room — the company's people plus the studio's crew — and the company's
  // projects. Roster-resolved, never user_metadata.
  if (req.nextUrl.searchParams.get('mention_candidates') === '1') {
    const [{ data: cms }, { data: oms }, { data: projs }] = await Promise.all([
      supabaseAdmin.from('client_members').select('user_id, name')
        .eq('client_id', client.id).eq('status', 'active').not('user_id', 'is', null),
      supabaseAdmin.from('organization_members').select('user_id, name')
        .eq('organization_id', client.organization_id).eq('status', 'active').not('user_id', 'is', null),
      supabaseAdmin.from('projects').select('id, title').eq('client_id', client.id),
    ])
    const users = [...(cms ?? []), ...(oms ?? [])]
      .map((r) => ({ id: r.user_id as string, name: r.name as string }))
    const projects = (projs ?? []).filter(
      (p) => !access?.projectIds || access.projectIds.includes(p.id)
    )
    return NextResponse.json({ users, projects })
  }

  // Batch 15 item 1: three views, ONE code path over one room —
  //   scope=room     → every message in the company's room ("All")
  //   scope=general  → untagged only (the General thread)
  //   project_id     → that project's tag PLUS untagged (S-F §2.2: the
  //                    project page is the room filtered, not a second store)
  const roomScope = scope === 'room'
  const { data: room } = await supabaseAdmin
    .from('message_rooms')
    .select('id')
    .eq('client_id', client.id)
    .eq('kind', 'client')
    .is('deleted_at', null)
    .maybeSingle()
  if (!room) return NextResponse.json({ messages: [] })

  if (projectId) {
    // Verify this project belongs to this client
    const { data: project } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('client_id', client.id)
      .single()
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }
    if (access?.projectIds && !access.projectIds.includes(projectId)) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }
  } else if (!general && !roomScope) {
    return NextResponse.json({ error: 'Missing project_id' }, { status: 400 })
  }

  // Sides + watermarks once per request (Batch 21 item 3): every branch
  // below stamps sender_role/read_at/attachment_url from the roster, the
  // per-user read state and the attachment FK — never from the columns
  // migration 12 drops.
  const sides = await roomSides(supabaseAdmin, {
    roomId: room.id,
    orgId: client.organization_id,
    clientId: client.id,
  })

  // Bounded: the latest page only (I-1 — the keyset cursor extends this).
  const limitParam = parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10)
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 50
  // Keyset (item 2, I-1): `before` walks older pages on (created_at, id) —
  // the 0030 index — and `around` loads a window for jump-to-message.
  let cursor
  try {
    cursor = decodeCursor(req.nextUrl.searchParams.get('before'))
  } catch {
    return NextResponse.json({ error: 'Malformed cursor' }, { status: 400 })
  }
  const aroundId = req.nextUrl.searchParams.get('around')
  // Search-in-conversation (Batch 16): body_tsv's first consumer — websearch
  // syntax over the GIN index from 0028, scoped exactly like the list.
  const q = req.nextUrl.searchParams.get('q')
  if (q && q.trim()) {
    let searchQ = supabaseAdmin
      .from('messages')
      .select('*, message_attachments(file_id, files(bucket, file_path, file_name))')
      .eq('room_id', room.id)
      .is('deleted_at', null)
      .textSearch('body_tsv', q.trim(), { type: 'websearch' })
      .order('created_at', { ascending: false })
      .limit(30)
    if (projectId) searchQ = searchQ.or(`project_id.eq.${projectId},project_id.is.null`)
    else if (general) searchQ = searchQ.is('project_id', null)
    if (access?.historyFrom) searchQ = searchQ.gte('created_at', access.historyFrom)
    const { data: hits, error: qErr } = await searchQ
    if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 })
    const rows = deriveWire(hits ?? [], sides).map((row) => {
      const { message_attachments, ...m } = row as Record<string, unknown> & { message_attachments?: { file_id: string }[] }
      return { ...m, attachment_file_id: message_attachments?.[0]?.file_id ?? null }
    })
    return NextResponse.json({ messages: rows, roomId: room.id, nextCursor: null, hasMore: false })
  }
  // Thread panel fetch: keyset-cursored like the main list (Batch 21 item 1
  // — the old `.limit(200)` ascending kept the OLDEST 200 and silently
  // dropped the newest, the worst half of a conversation to lose). Newest
  // page first, `before` walks older; the wire stays ascending.
  const threadRoot = req.nextUrl.searchParams.get('thread_root')
  if (threadRoot) {
    let thQ = supabaseAdmin
      .from('messages')
      .select('*, message_attachments(file_id, files(bucket, file_path, file_name)), message_reactions(user_id, emoji), message_mentions(kind, target_id)')
      .eq('room_id', room.id)
      .eq('thread_root_id', threadRoot)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1)
    if (cursor) thQ = thQ.or(beforePredicate(cursor))
    const { data: replies, error: thErr } = await thQ
    if (thErr) return NextResponse.json({ error: thErr.message }, { status: 500 })
    const thPage = replies ?? []
    const thHasMore = thPage.length > limit
    const thTrimmed = thHasMore ? thPage.slice(0, limit) : thPage
    const thOldest = thTrimmed[thTrimmed.length - 1] as { created_at: string; id: string } | undefined
    const thNextCursor =
      thHasMore && thOldest ? encodeCursor({ t: thOldest.created_at, id: thOldest.id }) : null
    const thRows = deriveWire(thTrimmed.slice().reverse(), sides).map((row) => {
      const { message_attachments, message_reactions, ...m } = row as Record<string, unknown> & {
        message_attachments?: { file_id: string }[]
        message_reactions?: { user_id: string; emoji: string }[]
      }
      return {
        ...m,
        attachment_file_id: message_attachments?.[0]?.file_id ?? null,
        reactions: message_reactions ?? [],
      }
    }).map((m: Record<string, unknown>) =>
      m.deleted_at || m.is_deleted
        ? { ...m, body: '', attachment_url: null, attachment_name: null, attachment_file_id: null }
        : m
    )
    return NextResponse.json({ messages: thRows, roomId: room.id, nextCursor: thNextCursor, hasMore: thHasMore })
  }
  let msgQ = supabaseAdmin
    .from('messages')
    .select('*, message_attachments(file_id, files(bucket, file_path, file_name)), message_reactions(user_id, emoji), message_mentions(kind, target_id)')
    .eq('room_id', room.id)
    .is('thread_root_id', null) // replies live in their panel (item 3)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)
  if (cursor) msgQ = msgQ.or(beforePredicate(cursor))
  if (projectId) msgQ = msgQ.or(`project_id.eq.${projectId},project_id.is.null`)
  else if (general) msgQ = msgQ.is('project_id', null)
  if (access?.historyFrom) msgQ = msgQ.gte('created_at', access.historyFrom)
  type PageRow = Record<string, unknown> & {
    id: string
    created_at: string
    message_attachments?: { file_id: string }[]
  }
  let newestFirst: PageRow[] | null = null
  let error: { message: string } | null = null
  if (aroundId) {
    // Jump-to-message: the target plus a window either side, one bounded
    // query each way. Upward pagination continues from the window's oldest.
    const { data: target } = await supabaseAdmin
      .from('messages')
      .select('id, created_at')
      .eq('id', aroundId)
      .eq('room_id', room.id)
      .maybeSingle()
    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const half = Math.floor(limit / 2)
    let olderQ = supabaseAdmin
      .from('messages')
      .select('*, message_attachments(file_id, files(bucket, file_path, file_name)), message_reactions(user_id, emoji), message_mentions(kind, target_id)')
      .eq('room_id', room.id)
      .or(`created_at.lt.${target.created_at},and(created_at.eq.${target.created_at},id.lte.${target.id})`)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(half + 1)
    let newerQ = supabaseAdmin
      .from('messages')
      .select('*, message_attachments(file_id, files(bucket, file_path, file_name)), message_reactions(user_id, emoji), message_mentions(kind, target_id)')
      .eq('room_id', room.id)
      .or(`created_at.gt.${target.created_at},and(created_at.eq.${target.created_at},id.gt.${target.id})`)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(half)
    if (projectId) {
      olderQ = olderQ.or(`project_id.eq.${projectId},project_id.is.null`)
      newerQ = newerQ.or(`project_id.eq.${projectId},project_id.is.null`)
    } else if (general) {
      olderQ = olderQ.is('project_id', null)
      newerQ = newerQ.is('project_id', null)
    }
    if (access?.historyFrom) {
      olderQ = olderQ.gte('created_at', access.historyFrom)
      newerQ = newerQ.gte('created_at', access.historyFrom)
    }
    const [olderRes, newerRes] = await Promise.all([olderQ, newerQ])
    error = olderRes.error ?? newerRes.error ?? null
    newestFirst = [
      ...(newerRes.data ?? []).slice().reverse(),
      ...(olderRes.data ?? []),
    ]
  } else {
    const res = await msgQ
    newestFirst = res.data
    error = res.error
  }
  const page = (newestFirst ?? []).slice(0, aroundId ? undefined : limit + 1)
  const hasMore = !aroundId && page.length > limit
  const trimmed = hasMore ? page.slice(0, limit) : page
  const oldest = trimmed[trimmed.length - 1] as { created_at: string; id: string } | undefined
  const nextCursor =
    (hasMore || (aroundId && oldest)) && oldest
      ? encodeCursor({ t: oldest.created_at, id: oldest.id })
      : null
  const messages = trimmed.slice().reverse()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // A-2/Batch 14 item 5: a deleted message's row survives (the tombstone
  // renders) but its content must not travel — RLS hides it from
  // authenticated reads only at migration 10, and this read runs on the
  // service role regardless.
  const withFk = deriveWire(messages, sides).map((row) => {
    const { message_attachments, message_reactions, message_mentions, ...m } = row as typeof row & {
      message_reactions?: { user_id: string; emoji: string }[]
      message_mentions?: { kind: string; target_id: string }[]
    }
    return {
      ...m,
      attachment_file_id: message_attachments?.[0]?.file_id ?? null,
      reactions: message_reactions ?? [],
      mentions: message_mentions ?? [],
    }
  })
  const scrubbed = withFk.map((m: Record<string, unknown>) =>
    m.deleted_at || m.is_deleted
      ? { ...m, body: '', attachment_url: null, attachment_name: null, attachment_file_id: null }
      : m
  )

  // Pins (item 4): ids ride every page; ?pins=full returns the panel rows.
  if (req.nextUrl.searchParams.get('pins') === 'full') {
    const { data: pinRows } = await supabaseAdmin
      .from('message_pins')
      .select('pinned_at, pinned_by, messages(*, message_attachments(file_id, files(bucket, file_path, file_name)))')
      .eq('room_id', room.id)
      .order('pinned_at', { ascending: false })
      .limit(100)
    const pinned = (pinRows ?? [])
      .map((p) => {
        const raw = (Array.isArray(p.messages) ? p.messages[0] : p.messages) as
          | (Record<string, unknown> & { message_attachments?: { file_id: string }[] })
          | null
        if (!raw) return null
        const { message_attachments, ...m } = deriveWire([raw], sides)[0]
        const withId: Record<string, unknown> = {
          ...m,
          attachment_file_id: message_attachments?.[0]?.file_id ?? null,
        }
        return withId.deleted_at || withId.is_deleted
          ? { ...withId, body: '', attachment_url: null, attachment_name: null, attachment_file_id: null }
          : withId
      })
      .filter((m) => m != null)
    return NextResponse.json({ messages: pinned, roomId: room.id, nextCursor: null, hasMore: false })
  }
  const { data: pinIdRows } = await supabaseAdmin
    .from('message_pins')
    .select('message_id')
    .eq('room_id', room.id)
    .limit(200)
  const pinnedIds = (pinIdRows ?? []).map((p) => p.message_id as string)

  // Reply meta per root on this page — count + last reply time (item 3).
  const rootIds = scrubbed.map((m) => m.id as string)
  const replyMeta: Record<string, { count: number; lastAt: string }> = {}
  if (rootIds.length > 0) {
    const { data: replyRows } = await supabaseAdmin
      .from('messages')
      .select('thread_root_id, created_at')
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

  // Mention targets resolved for THIS viewer (item 5): scoped members see
  // restricted chips, not names, for things outside their scope.
  const pageMentions = scrubbed.flatMap((m) => (m.mentions as { kind: string; target_id: string }[] | undefined) ?? [])
  const mentionTargets = pageMentions.length
    ? await resolveMentionTargets(supabaseAdmin, pageMentions, {
        role: 'client',
        orgId: client.organization_id,
        clientId: client.id,
        visibleProjectIds: access?.projectIds ?? null,
        projectHrefBase: '/projects',
      })
    : null

  return NextResponse.json({ messages: scrubbed, roomId: room.id, nextCursor, hasMore: !!hasMore, replyMeta, pinnedIds, mentionTargets })
}

// Mark a thread read (advances THIS user's room watermark) or delivered.
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { project_id: rawProjectId, mode, scope } = await req.json()
  const roomScope = scope === 'room'
  const general = scope === 'general' || (typeof rawProjectId === 'string' && rawProjectId.startsWith('room:'))
  const project_id = general || roomScope ? null : rawProjectId
  if (!project_id && !general && !roomScope) {
    return NextResponse.json({ error: 'Missing project_id' }, { status: 400 })
  }

  const { data: client } = await supabaseAdmin
    .from('clients').select('id').eq('id', await portalClientId(user)).single()
  if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (project_id) {
    const { data: project } = await supabaseAdmin
      .from('projects').select('id')
      .eq('id', project_id).eq('client_id', client.id).single()
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data: room } = await supabaseAdmin
    .from('message_rooms')
    .select('id')
    .eq('client_id', client.id)
    .eq('kind', 'client')
    .is('deleted_at', null)
    .maybeSingle()

  const now = new Date().toISOString()
  // The legacy read_at write is GONE (Batch 21 item 3): read state lives in
  // message_read_state only, and the read tick derives from the other
  // side's watermark on every server read. delivered_at survives (it is not
  // in migration 12's drop list) and marks messages someone ELSE sent —
  // sender_id, not the retired sender_role, decides "not mine".
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deliveredScope = (q: any) => {
    let s = q.neq('sender_id', user.id)
    if (project_id) s = s.eq('room_id', room?.id ?? '00000000-0000-0000-0000-000000000000').or(`project_id.eq.${project_id},project_id.is.null`)
    else if (roomScope) s = s.eq('room_id', room?.id ?? '00000000-0000-0000-0000-000000000000')
    else s = s.eq('room_id', room?.id ?? '00000000-0000-0000-0000-000000000000').is('project_id', null)
    return s
  }

  await deliveredScope(
    supabaseAdmin.from('messages').update({ delivered_at: now }).is('delivered_at', null)
  )
  if (mode !== 'delivered') {
    // The per-user model (A-7): advance MY watermark to the newest message
    // in the opened thread. Monotonic; a colleague's read no longer counts
    // as mine.
    if (room) {
      await advanceWatermark(supabaseAdmin, {
        userId: user.id,
        roomId: room.id,
        // room scope = whole-room read; a project view clears its untagged too
        ...(roomScope ? {} : { projectId: project_id ?? null, orUntagged: !!project_id }),
      })
    }
  }

  return NextResponse.json({ ok: true })
}
