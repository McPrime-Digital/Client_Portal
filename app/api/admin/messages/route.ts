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

  const projectId = req.nextUrl.searchParams.get('project_id')
  const clientId = req.nextUrl.searchParams.get('client_id')
  const scope = req.nextUrl.searchParams.get('scope')
  const orgId = userOrgId(user)

  let msgQ
  if (projectId) {
    // project_id arrives from the query string and is NOT trusted for
    // tenancy. The org comes from the verified session, and pairing the two
    // means a foreign project_id returns an empty thread instead of another
    // studio's chat.
    msgQ = supabaseAdmin
      .from('messages')
      .select('*, message_attachments(file_id)')
      .eq('project_id', projectId)
      .eq('organization_id', orgId)
      .order('created_at', { ascending: true })
  } else if (clientId && scope === 'general') {
    const room = await roomForClient(orgId, clientId)
    if (!room) return NextResponse.json({ messages: [] })
    msgQ = supabaseAdmin
      .from('messages')
      .select('*, message_attachments(file_id)')
      .eq('room_id', room.id)
      .is('project_id', null)
      .order('created_at', { ascending: true })
  } else {
    return NextResponse.json({ error: 'Missing project_id' }, { status: 400 })
  }

  const { data: messages, error } = await msgQ
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

  return NextResponse.json({ messages: scrubbed })
}

// Mark a thread read (advances THIS admin's room watermark) or delivered.
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { project_id, client_id, mode, scope } = await req.json()
  const general = scope === 'general'
  if (!project_id && !(general && client_id)) {
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
    if (project_id) s = s.eq('project_id', project_id)
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
        projectId: project_id ?? null,
      })
    }
  }

  return NextResponse.json({ ok: true })
}
