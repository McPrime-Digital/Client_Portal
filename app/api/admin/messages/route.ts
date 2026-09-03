import { isAdmin, userOrgId } from '@/lib/auth/role'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { advanceWatermark, roomSides, deriveWire, signAttachments } from '@/lib/messageRead'
import { decodeCursor, encodeCursor, beforePredicate } from '@/lib/keyset'
import { resolveMentionTargets } from '@/lib/messageMentions'

// Thread reads and read-marking for the studio. Two thread shapes since
// Batch 14: a PROJECT thread (?project_id=…) and a company's GENERAL thread
// (?client_id=…&scope=general — untagged room messages).

async function roomForClient(orgId: string, clientId: string) {
  const { data } = await supabaseAdmin
    .from('message_rooms')
    .select('id, organization_id, client_id')
    .eq('client_id', clientId)
    .eq('kind', 'client')
    .is('deleted_at', null)
    .maybeSingle()
  // The org predicate is the tenant boundary: a foreign client id resolves
  // to nothing, not to another studio's room.
  return data && data.organization_id === orgId ? data : null
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // General threads travel as project_id="room:<clientId>" or as
  // ?client_id=…&scope=general — both mean the untagged room conversation.
  const rawProjectId = req.nextUrl.searchParams.get('project_id')
  const fromPrefix = rawProjectId?.startsWith('room:') ? rawProjectId.slice(5) : null
  const projectId = fromPrefix ? null : rawProjectId
  const clientId = fromPrefix ?? req.nextUrl.searchParams.get('client_id')
  const scope = fromPrefix ? 'general' : req.nextUrl.searchParams.get('scope')
  const orgId = userOrgId(user)

  // Mention autocomplete sources (item 5) — roster-resolved (I-6 shape).
  if (req.nextUrl.searchParams.get('mention_candidates') === '1' && clientId) {
    const [{ data: cms }, { data: oms }, { data: projs }] = await Promise.all([
      supabaseAdmin.from('client_members').select('user_id, name')
        .eq('client_id', clientId).eq('status', 'active').not('user_id', 'is', null),
      supabaseAdmin.from('organization_members').select('user_id, name')
        .eq('organization_id', orgId).eq('status', 'active').not('user_id', 'is', null),
      supabaseAdmin.from('projects').select('id, title')
        .eq('client_id', clientId).eq('organization_id', orgId),
    ])
    const users = [...(cms ?? []), ...(oms ?? [])]
      .map((r) => ({ id: r.user_id as string, name: r.name as string }))
    return NextResponse.json({ users, projects: projs ?? [] })
  }

  // Batch 15 item 1: three views, ONE code path over one room. project_id
  // arrives from the query string and is NOT trusted for tenancy — the room
  // resolves through the verified org, so a foreign id returns empty.
  let room: { id: string; client_id?: string | null } | null = null
  let tagId: string | null = null
  if (projectId) {
    const { data: proj } = await supabaseAdmin
      .from('projects')
      .select('id, client_id, organization_id')
      .eq('id', projectId)
      .maybeSingle()
    if (!proj || proj.organization_id !== orgId || !proj.client_id) {
      return NextResponse.json({ messages: [] })
    }
    room = await roomForClient(orgId, proj.client_id)
    tagId = projectId
  } else if (clientId && (scope === 'general' || scope === 'room')) {
    room = await roomForClient(orgId, clientId)
  } else {
    return NextResponse.json({ error: 'Missing project_id' }, { status: 400 })
  }
  if (!room) return NextResponse.json({ messages: [] })

  // Sides + watermarks once per request (Batch 21 item 3): every branch
  // below stamps sender_role/read_at/attachment_url from the roster, the
  // per-user read state and the attachment FK — never from the columns
  // migration 12 drops.
  const sides = await roomSides(supabaseAdmin, {
    roomId: room.id,
    orgId,
    clientId: room.client_id ?? null,
  })

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
    if (tagId) searchQ = searchQ.eq('project_id', tagId)
    else if (scope === 'general') searchQ = searchQ.is('project_id', null)
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
  if (tagId) msgQ = msgQ.eq('project_id', tagId)
  else if (scope === 'general') msgQ = msgQ.is('project_id', null)

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
    if (tagId) {
      olderQ = olderQ.eq('project_id', tagId)
      newerQ = newerQ.eq('project_id', tagId)
    } else if (scope === 'general') {
      olderQ = olderQ.is('project_id', null)
      newerQ = newerQ.is('project_id', null)
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

  // Batch 14 item 5: deleted rows keep their place (tombstone) but their
  // content does not leave the server.
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
  // PRE-SIGN the page's attachments (item 7). Without this the browser had to
  // exchange each `bucket::path` reference for a signed URL AFTER the list had
  // painted — one round trip per attachment, arriving as a visible second wave
  // of images and video filling in. Signing is a local HMAC for R2, so a page
  // costs effectively nothing, and the thread opens complete.
  const signedRows = await signAttachments(supabaseAdmin, scrubbed)

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
  const rootIds = signedRows.map((m) => m.id as string)
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

  // Mention targets resolved for THIS viewer (item 5).
  const pageMentions = signedRows.flatMap((m) => (m.mentions as { kind: string; target_id: string }[] | undefined) ?? [])
  const mentionTargets = pageMentions.length
    ? await resolveMentionTargets(supabaseAdmin, pageMentions, {
        role: 'admin',
        orgId,
        clientId,
        projectHrefBase: '/studio/client/projects',
      })
    : null

  return NextResponse.json({ messages: signedRows, roomId: room.id, nextCursor, hasMore: !!hasMore, replyMeta, pinnedIds, mentionTargets })
}

// Mark a thread read (advances THIS admin's room watermark) or delivered.
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { project_id: rawProjectId, client_id: rawClientId, mode, scope: rawScope } = await req.json()
  const fromPrefix = typeof rawProjectId === 'string' && rawProjectId.startsWith('room:') ? rawProjectId.slice(5) : null
  const project_id = fromPrefix ? null : rawProjectId
  const client_id = fromPrefix ?? rawClientId
  const roomScope = rawScope === 'room'
  const general = fromPrefix != null || rawScope === 'general'
  if (!project_id && !((general || roomScope) && client_id)) {
    return NextResponse.json({ error: 'Missing project_id' }, { status: 400 })
  }

  const now = new Date().toISOString()
  // project_id/client_id come from the request body; the org comes from the
  // session. Without the org predicate these are cross-tenant WRITES.
  const orgId = userOrgId(user)

  let roomId: string | null = null
  if (project_id) {
    const { data: proj } = await supabaseAdmin
      .from('projects')
      .select('id, client_id, organization_id')
      .eq('id', project_id)
      .single()
    if (!proj || proj.organization_id !== orgId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (proj.client_id) {
      const room = await roomForClient(orgId, proj.client_id)
      roomId = room?.id ?? null
    }
  } else {
    const room = await roomForClient(orgId, client_id)
    if (!room) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    roomId = room.id
  }

  // The legacy read_at write is GONE (Batch 21 item 3): read state lives in
  // message_read_state only, and the read tick derives from the other
  // side's watermark on every server read. delivered_at survives (it is not
  // in migration 12's drop list) and marks messages someone ELSE sent —
  // sender_id, not the retired sender_role, decides "not mine".
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deliveredScope = (q: any) => {
    let s = q.eq('organization_id', orgId).neq('sender_id', user.id)
    if (project_id) s = s.eq('room_id', roomId).eq('project_id', project_id)
    else if (roomScope) s = s.eq('room_id', roomId)
    else s = s.eq('room_id', roomId).is('project_id', null)
    return s
  }

  await deliveredScope(
    supabaseAdmin.from('messages').update({ delivered_at: now }).is('delivered_at', null)
  )
  if (mode !== 'delivered') {
    // Per-user model (A-7): this admin's watermark, nobody else's.
    if (roomId) {
      await advanceWatermark(supabaseAdmin, {
        userId: user.id,
        roomId,
        ...(roomScope ? {} : { projectId: project_id ?? null, orUntagged: !!project_id }),
      })
    }
  }

  return NextResponse.json({ ok: true })
}
