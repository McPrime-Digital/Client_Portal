import { isAdmin, userOrgId } from '@/lib/auth/role'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { advanceWatermark } from '@/lib/messageRead'

// Thread reads and read-marking for the studio. Two thread shapes since
// Batch 14: a PROJECT thread (?project_id=…) and a company's GENERAL thread
// (?client_id=…&scope=general — untagged room messages).

async function roomForClient(orgId: string, clientId: string) {
  const { data } = await supabaseAdmin
    .from('message_rooms')
    .select('id, organization_id')
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

  // Batch 15 item 1: three views, ONE code path over one room. project_id
  // arrives from the query string and is NOT trusted for tenancy — the room
  // resolves through the verified org, so a foreign id returns empty.
  let room: { id: string } | null = null
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

  const limitParam = parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10)
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 50
  let msgQ = supabaseAdmin
    .from('messages')
    .select('*, message_attachments(file_id)')
    .eq('room_id', room.id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit)
  if (tagId) msgQ = msgQ.or(`project_id.eq.${tagId},project_id.is.null`)
  else if (scope === 'general') msgQ = msgQ.is('project_id', null)

  const { data: newestFirst, error } = await msgQ
  const messages = (newestFirst ?? []).slice().reverse()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Batch 14 item 5: deleted rows keep their place (tombstone) but their
  // content does not leave the server.
  const withFk = (messages ?? []).map((row) => {
    const { message_attachments, ...m } = row as typeof row & { message_attachments?: { file_id: string }[] }
    return { ...m, attachment_file_id: message_attachments?.[0]?.file_id ?? null }
  })
  const scrubbed = withFk.map((m) =>
    m.deleted_at || m.is_deleted
      ? { ...m, body: '', attachment_url: null, attachment_name: null, attachment_file_id: null }
      : m
  )

  return NextResponse.json({ messages: scrubbed, roomId: room.id })
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const legacyScope = (q: any) => {
    let s = q.eq('organization_id', orgId).eq('sender_role', 'client')
    if (project_id) s = s.eq('room_id', roomId).or(`project_id.eq.${project_id},project_id.is.null`)
    else if (roomScope) s = s.eq('room_id', roomId)
    else s = s.eq('room_id', roomId).is('project_id', null)
    return s
  }

  if (mode === 'delivered') {
    await legacyScope(
      supabaseAdmin.from('messages').update({ delivered_at: now }).is('delivered_at', null)
    )
  } else {
    // Read implies delivered: backfill delivered_at, then set read_at —
    // legacy columns, written until S3-core migration 12.
    await legacyScope(
      supabaseAdmin.from('messages').update({ delivered_at: now }).is('delivered_at', null)
    )
    await legacyScope(
      supabaseAdmin.from('messages').update({ read_at: now }).is('read_at', null)
    )
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
