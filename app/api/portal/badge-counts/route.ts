import { portalClientId, portalAccess } from '@/lib/team'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { clientUnread } from '@/lib/messageRead'

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
    .eq('id', await portalClientId(user))
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

  // Unread is per PERSON now (message_read_state, A-7) and per ROOM — so it
  // counts untagged messages too, and a project-less client still gets a
  // badge. This caller's scope + history cutoff apply exactly as the hub's.
  const access = await portalAccess(user)
  const { total: unreadMessages } = await clientUnread(supabaseAdmin, {
    userId: user.id,
    clientId: client.id,
    historyFrom: access?.historyFrom ?? null,
    visibleProjectIds: access?.projectIds ?? null,
  })

  if (projectIds.length === 0) {
    return NextResponse.json({ unreadMessages, unpaidInvoices: 0, pendingApprovals: 0 })
  }

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
