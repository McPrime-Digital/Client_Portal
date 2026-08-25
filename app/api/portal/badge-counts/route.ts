import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Find client record
  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!client) {
    return NextResponse.json({ unreadMessages: 0, unpaidInvoices: 0, pendingApprovals: 0 })
  }

  // Get projects for this client
  const { data: projects } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('client_id', client.id)

  const projectIds = (projects ?? []).map((p) => p.id)

  if (projectIds.length === 0) {
    return NextResponse.json({ unreadMessages: 0, unpaidInvoices: 0, pendingApprovals: 0 })
  }

  // Count unread admin messages across all projects
  const { count: unreadMessages } = await supabaseAdmin
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .in('project_id', projectIds)
    .eq('sender_role', 'admin')
    .is('read_at', null)

  // Count unpaid/overdue invoices
  const { count: unpaidInvoices } = await supabaseAdmin
    .from('invoices')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', client.id)
    .in('status', ['unpaid', 'overdue'])

  // Tasks awaiting the client's approval — mirrors TaskBoard's approval gate
  const { count: pendingApprovals } = await supabaseAdmin
    .from('tasks')
    .select('*', { count: 'exact', head: true })
    .in('project_id', projectIds)
    .or('requires_approval.eq.true,category.eq.approval')
    .eq('visible_to_client', true)
    .eq('status', 'review')
    .is('approved_at', null)

  return NextResponse.json({
    unreadMessages: unreadMessages ?? 0,
    unpaidInvoices: unpaidInvoices ?? 0,
    pendingApprovals: pendingApprovals ?? 0,
  })
}
