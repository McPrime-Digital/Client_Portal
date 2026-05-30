import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const projectId = req.nextUrl.searchParams.get('project_id')
  if (!projectId) {
    return NextResponse.json({ error: 'Missing project_id' }, { status: 400 })
  }

  // Verify this project belongs to this client
  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('client_id', client.id)
    .single()

  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const { data: messages, error } = await supabaseAdmin
    .from('messages')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ messages })
}

// Mark messages as read (client marks admin messages read)
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { project_id, mode } = await req.json()
  if (!project_id) {
    return NextResponse.json({ error: 'Missing project_id' }, { status: 400 })
  }

  const { data: client } = await supabaseAdmin
    .from('clients').select('id').eq('user_id', user.id).single()
  if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: project } = await supabaseAdmin
    .from('projects').select('id')
    .eq('id', project_id).eq('client_id', client.id).single()
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const now = new Date().toISOString()

  if (mode === 'delivered') {
    // Mark admin messages as delivered (recipient received them).
    await supabaseAdmin
      .from('messages')
      .update({ delivered_at: now })
      .eq('project_id', project_id)
      .eq('sender_role', 'admin')
      .is('delivered_at', null)
  } else {
    // Read implies delivered: backfill delivered_at, then set read_at.
    await supabaseAdmin
      .from('messages')
      .update({ delivered_at: now })
      .eq('project_id', project_id)
      .eq('sender_role', 'admin')
      .is('delivered_at', null)

    await supabaseAdmin
      .from('messages')
      .update({ read_at: now })
      .eq('project_id', project_id)
      .eq('sender_role', 'admin')
      .is('read_at', null)
  }

  return NextResponse.json({ ok: true })
}
