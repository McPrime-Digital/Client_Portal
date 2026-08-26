import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isAdmin } from '@/lib/auth/role'
import { portalAccess } from '@/lib/team'

// Live source of truth for a project's task board — tasks + the Approvals &
// Records ledger. Read via the service role (so it works for admin, whose RLS
// gives no broad read) and authorized per-caller. The task board polls this as
// a realtime safety net so cards/records update without a manual refresh even
// where RLS would otherwise block a realtime subscription.
const RECORD_EVENTS = ['approval_requested', 'task_approved', 'changes_requested', 'task_auto_approved']

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const projectId = req.nextUrl.searchParams.get('project_id')
  if (!projectId) return NextResponse.json({ error: 'project_id required' }, { status: 400 })

  // Authorize: admins see any project; clients only their own.
  //
  // portalAccess resolves BOTH kinds of client login — the company's primary
  // login (clients.user_id) and an invited teammate (client_members). The
  // previous clients.user_id lookup matched no teammate at all, so every
  // invited member got a 403 from an endpoint TaskBoard polls every 7 seconds.
  const admin = isAdmin(user)
  if (!admin) {
    const access = await portalAccess(user)
    if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const { data: proj } = await supabaseAdmin
      .from('projects').select('id').eq('id', projectId).eq('client_id', access.clientId).maybeSingle()
    if (!proj) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    // Project scoping: a member scoped to specific projects may not read a
    // sibling project's board just because it belongs to their company.
    if (access.projectIds && !access.projectIds.includes(projectId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const [{ data: tasks }, { data: involvement }] = await Promise.all([
    supabaseAdmin
      .from('tasks')
      .select('*')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: true }),
    supabaseAdmin
      .from('activity_log')
      .select('id, actor_name, actor_role, event_type, title, body, meta, created_at')
      .eq('project_id', projectId)
      .in('event_type', RECORD_EVENTS)
      .order('created_at', { ascending: false })
      .limit(500),
  ])

  return NextResponse.json({ tasks: tasks ?? [], involvement: involvement ?? [] })
}
