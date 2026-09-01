import { portalClientId, portalAccess } from '@/lib/team'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { advanceWatermark } from '@/lib/messageRead'

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

  // The General thread travels as project_id="room:<clientId>" (the hubs
  // treat it as just another thread id) or as ?scope=general — both mean
  // the untagged room-level conversation.
  const rawProjectId = req.nextUrl.searchParams.get('project_id')
  const scope = req.nextUrl.searchParams.get('scope')
  const general = scope === 'general' || (rawProjectId?.startsWith('room:') ?? false)
  const projectId = general ? null : rawProjectId
  if (!projectId && !general) {
    return NextResponse.json({ error: 'Missing project_id' }, { status: 400 })
  }

  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('id', await portalClientId(user))
    .single()

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  // Member scoping — project allowlist + owner-set message-history cutoff.
  const access = await portalAccess(user)

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

  // Bounded: the latest page only (I-1 — the keyset cursor extends this).
  const limitParam = parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10)
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 50
  let msgQ = supabaseAdmin
    .from('messages')
    .select('*, message_attachments(file_id)')
    .eq('room_id', room.id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit)
  if (projectId) msgQ = msgQ.or(`project_id.eq.${projectId},project_id.is.null`)
  else if (general) msgQ = msgQ.is('project_id', null)
  if (access?.historyFrom) msgQ = msgQ.gte('created_at', access.historyFrom)
  const { data: newestFirst, error } = await msgQ
  const messages = (newestFirst ?? []).slice().reverse()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // A-2/Batch 14 item 5: a deleted message's row survives (the tombstone
  // renders) but its content must not travel — RLS hides it from
  // authenticated reads only at migration 10, and this read runs on the
  // service role regardless.
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
  // Legacy predicate: tagged threads by project, the general thread by
  // room + untagged. read_at/delivered_at keep being written until
  // S3-core migration 12 so Batch 13 and 14 stay independently revertable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const legacyScope = (q: any) => {
    let s = q.eq('sender_role', 'admin')
    if (project_id) s = s.eq('room_id', room?.id ?? '00000000-0000-0000-0000-000000000000').or(`project_id.eq.${project_id},project_id.is.null`)
    else if (roomScope) s = s.eq('room_id', room?.id ?? '00000000-0000-0000-0000-000000000000')
    else s = s.eq('room_id', room?.id ?? '00000000-0000-0000-0000-000000000000').is('project_id', null)
    return s
  }

  if (mode === 'delivered') {
    await legacyScope(
      supabaseAdmin.from('messages').update({ delivered_at: now }).is('delivered_at', null)
    )
  } else {
    // Read implies delivered: backfill delivered_at, then set read_at.
    await legacyScope(
      supabaseAdmin.from('messages').update({ delivered_at: now }).is('delivered_at', null)
    )
    await legacyScope(
      supabaseAdmin.from('messages').update({ read_at: now }).is('read_at', null)
    )
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
