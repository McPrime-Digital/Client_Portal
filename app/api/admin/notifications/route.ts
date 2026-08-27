import { isAdmin, userOrgId } from '@/lib/auth/role'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

async function verifyAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user && isAdmin(user) ? user : null
}

// Admin-facing notification stream (for_admin = true).
export async function GET() {
  const user = await verifyAdmin()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Tenant scope, resolved once from the verified session (never a param).
  const orgId = userOrgId(user)
  // Exclude dismissed rows (the bell X). Falls back gracefully if the
  // dismissed_at column hasn't been migrated yet, so the bell never breaks.
  // (The select omits dismissed_at — the filter alone is enough, and identical
  // selects keep both branches type-compatible.)
  const cols = 'id, project_id, client_id, type, title, body, read_at, created_at'
  let { data, error } = await supabaseAdmin
    .from('notifications')
    .select(cols)
    .eq('organization_id', orgId)
    .eq('for_admin', true)
    .is('dismissed_at', null)
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) {
    ;({ data } = await supabaseAdmin
      .from('notifications')
      .select(cols)
      .eq('organization_id', orgId)
      .eq('for_admin', true)
      .order('created_at', { ascending: false })
      .limit(30))
  }
  return NextResponse.json({ notifications: data ?? [] })
}

export async function PATCH(req: NextRequest) {
  const user = await verifyAdmin()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { ids, all, project_id, type, dismiss } = await req.json().catch(() => ({}))
  const now = new Date().toISOString()
  // Every branch below is a WRITE keyed by ids/project_id from the body. The
  // org predicate is what stops "mark all read" from clearing another tenant's
  // admin bell.
  const orgId = userOrgId(user)
  // "dismiss" closes a row from the admin bell (sets dismissed_at); otherwise
  // mark read (sets read_at).
  let query = dismiss
    ? supabaseAdmin
        .from('notifications')
        .update({ dismissed_at: now })
        .eq('organization_id', orgId)
        .eq('for_admin', true)
    : supabaseAdmin
        .from('notifications')
        .update({ read_at: now })
        .eq('organization_id', orgId)
        .eq('for_admin', true)
        .is('read_at', null)
  if (project_id || type) {
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
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
