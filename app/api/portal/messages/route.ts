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

  const projectId = req.nextUrl.searchParams.get('project_id')
  const scope = req.nextUrl.searchParams.get('scope')
  if (!projectId && scope !== 'general') {
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

  let msgQ
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
    msgQ = supabaseAdmin
      .from('messages')
      .select('*, message_attachments(file_id)')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
  } else {
    // General thread: the untagged messages of the company's room.
    const { data: room } = await supabaseAdmin
      .from('message_rooms')
      .select('id')
      .eq('client_id', client.id)
      .eq('kind', 'client')
      .is('deleted_at', null)
      .maybeSingle()
    if (!room) return NextResponse.json({ messages: [] })
    msgQ = supabaseAdmin
      .from('messages')
      .select('*, message_attachments(file_id)')
      .eq('room_id', room.id)
      .is('project_id', null)
      .order('created_at', { ascending: true })
  }
  if (access?.historyFrom) msgQ = msgQ.gte('created_at', access.historyFrom)
  const { data: messages, error } = await msgQ

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

  return NextResponse.json({ messages: scrubbed })
}

// Mark a thread read (advances THIS user's room watermark) or delivered.
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { project_id, mode, scope } = await req.json()
  const general = scope === 'general'
  if (!project_id && !general) {
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
    if (project_id) s = s.eq('project_id', project_id)
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
        projectId: project_id ?? null,
      })
    }
  }

  return NextResponse.json({ ok: true })
}
