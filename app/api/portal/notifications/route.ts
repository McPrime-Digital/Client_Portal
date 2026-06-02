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

  // Exclude dismissed rows (the bell X). Falls back gracefully if the
  // dismissed_at column hasn't been migrated yet, so the bell never breaks.
  // (The select omits dismissed_at — the filter alone is enough, and identical
  // selects keep both branches type-compatible.)
  const base = () =>
    supabaseAdmin
      .from('notifications')
      .select('id, project_id, type, title, body, read_at, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(30)

  let { data: notifications, error } = await base().is('dismissed_at', null)
  if (error) {
    // Most likely the dismissed_at column doesn't exist yet — retry unfiltered.
    ;({ data: notifications } = await base())
  }

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

  const { ids, all, project_id, type, dismiss } = await req.json().catch(() => ({}))
  const now = new Date().toISOString()

  // "dismiss" closes a row from the bell (sets dismissed_at); otherwise we mark
  // it read (sets read_at). Always scoped to the caller's client so one client
  // can't touch another's notifications.
  let query = dismiss
    ? supabaseAdmin
        .from('notifications')
        .update({ dismissed_at: now })
        .eq('client_id', clientId)
    : supabaseAdmin
        .from('notifications')
        .update({ read_at: now })
        .eq('client_id', clientId)
        .is('read_at', null)

  if (project_id || type) {
    // Clear by context — e.g. opening a project chat clears its message
    // notifications, without touching the rest.
    if (project_id) query = query.eq('project_id', project_id)
    if (type) query = query.eq('type', type)
  } else if (all) {
    // mark everything (explicit "All read")
  } else if (Array.isArray(ids) && ids.length > 0) {
    query = query.in('id', ids)
  } else {
    return NextResponse.json({ success: true })
  }

  const { error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
