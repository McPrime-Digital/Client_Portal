import { isAdmin, userOrgId } from '@/lib/auth/role'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const projectId = req.nextUrl.searchParams.get('project_id')
  if (!projectId) {
    return NextResponse.json({ error: 'Missing project_id' }, { status: 400 })
  }

  // project_id arrives from the query string and is NOT trusted for tenancy.
  // The org comes from the verified session, and pairing the two means a
  // foreign project_id returns an empty thread instead of another studio's chat.
  const { data: messages, error } = await supabaseAdmin
    .from('messages')
    .select('*')
    .eq('project_id', projectId)
    .eq('organization_id', userOrgId(user))
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ messages })
}

// Mark messages as read (admin marks client messages read)
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { project_id, mode } = await req.json()
  if (!project_id) {
    return NextResponse.json({ error: 'Missing project_id' }, { status: 400 })
  }

  const now = new Date().toISOString()
  // project_id comes from the request body; the org comes from the session.
  // Without the org predicate these are cross-tenant WRITES — an admin could
  // mark another studio's client mail read.
  const orgId = userOrgId(user)

  if (mode === 'delivered') {
    // Mark client messages as delivered (recipient received them).
    await supabaseAdmin
      .from('messages')
      .update({ delivered_at: now })
      .eq('project_id', project_id)
      .eq('organization_id', orgId)
      .eq('sender_role', 'client')
      .is('delivered_at', null)
  } else {
    // Read implies delivered: backfill delivered_at, then set read_at.
    await supabaseAdmin
      .from('messages')
      .update({ delivered_at: now })
      .eq('project_id', project_id)
      .eq('organization_id', orgId)
      .eq('sender_role', 'client')
      .is('delivered_at', null)

    await supabaseAdmin
      .from('messages')
      .update({ read_at: now })
      .eq('project_id', project_id)
      .eq('organization_id', orgId)
      .eq('sender_role', 'client')
      .is('read_at', null)
  }

  return NextResponse.json({ ok: true })
}
