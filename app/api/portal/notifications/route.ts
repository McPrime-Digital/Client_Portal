import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

// Resolve the authenticated user's client_id, or null if none.
async function getClientId() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, clientId: null }
  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('user_id', user.id)
    .single()
  return { user, clientId: client?.id ?? null }
}

export async function GET() {
  const { user, clientId } = await getClientId()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!clientId) {
    return NextResponse.json({ notifications: [] })
  }

  const { data: notifications } = await supabaseAdmin
    .from('notifications')
    .select('id, project_id, type, title, body, read_at, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(30)

  return NextResponse.json({ notifications: notifications ?? [] })
}

export async function PATCH(req: NextRequest) {
  const { user, clientId } = await getClientId()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!clientId) {
    return NextResponse.json({ success: true })
  }

  const { ids, all } = await req.json().catch(() => ({}))
  const now = new Date().toISOString()

  // Always scope updates to the caller's client so one client can't
  // mark another's notifications read.
  let query = supabaseAdmin
    .from('notifications')
    .update({ read_at: now })
    .eq('client_id', clientId)
    .is('read_at', null)

  if (!all) {
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ success: true })
    }
    query = query.in('id', ids)
  }

  const { error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
