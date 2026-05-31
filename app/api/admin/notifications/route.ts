import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

async function verifyAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user && user.user_metadata?.role === 'admin' ? user : null
}

// Admin-facing notification stream (for_admin = true).
export async function GET() {
  if (!(await verifyAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { data } = await supabaseAdmin
    .from('notifications')
    .select('id, project_id, client_id, type, title, body, read_at, created_at')
    .eq('for_admin', true)
    .order('created_at', { ascending: false })
    .limit(30)
  return NextResponse.json({ notifications: data ?? [] })
}

export async function PATCH(req: NextRequest) {
  if (!(await verifyAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { ids, all } = await req.json().catch(() => ({}))
  let query = supabaseAdmin
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('for_admin', true)
    .is('read_at', null)
  if (!all) {
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ success: true })
    }
    query = query.in('id', ids)
  }
  const { error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
