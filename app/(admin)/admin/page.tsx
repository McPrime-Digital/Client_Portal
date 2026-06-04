import { supabaseAdmin } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AdminDashboard from '@/components/admin/AdminDashboard'
import RealtimeRefresh from '@/components/shared/RealtimeRefresh'

export default async function AdminPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.user_metadata?.role !== 'admin') {
    redirect('/login')
  }

  // Projects with full relation data
  const { data: projects } = await supabaseAdmin
    .from('projects')
    .select(`
      id, title, status, progress, created_at, updated_at, image_url,
      clients(id, name, company, avatar_url),
      project_phases(id, name, progress, sort_order, is_complete),
      tasks(id, status, visible_to_client, requires_approval, approval_status, approved_at),
      files(id),
      messages(id),
      invoices(id, amount, status)
    `)
    .order('updated_at', { ascending: false })
    .limit(50)

  // All clients — projects carry updated_at so the overview can surface the
  // most recently worked-on clients first.
  const { data: clients } = await supabaseAdmin
    .from('clients')
    .select('id, name, company, email, avatar_url, created_at, projects(id, status, updated_at)')
    .order('created_at', { ascending: false })

  // Recent Activity — sourced from the admin notification stream so it reflects
  // EVERY alert type (messages, deliveries, status changes, invoices, task
  // approvals/changes), not just messages. Graceful fallback if unavailable.
  let activity: any[] = []
  try {
    const { data } = await supabaseAdmin
      .from('notifications')
      .select('id, type, title, body, created_at, project_id, client_id')
      .eq('for_admin', true)
      .order('created_at', { ascending: false })
      .limit(40)
    activity = data ?? []
  } catch { activity = [] }

  // Revenue
  const { data: invoiceTotals } = await supabaseAdmin
    .from('invoices')
    .select('amount, status')

  const revenue = {
    collected: (invoiceTotals ?? []).filter((i) => i.status === 'paid').reduce((a, i) => a + Number(i.amount), 0),
    outstanding: (invoiceTotals ?? []).filter((i) => ['unpaid', 'overdue'].includes(i.status)).reduce((a, i) => a + Number(i.amount), 0),
    overdue: (invoiceTotals ?? []).filter((i) => i.status === 'overdue').reduce((a, i) => a + Number(i.amount), 0),
  }

  // Unread messages
  const { count: unreadMessages } = await supabaseAdmin
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .is('read_at', null)
    .eq('sender_role', 'client')

  return (
    <>
      {/* Live: refresh KPIs/pipeline/revenue when data changes */}
      <RealtimeRefresh
        tables={['projects', 'project_phases', 'invoices', 'tasks', 'activity_log', 'messages', 'clients', 'notifications']}
        pollMs={30000}
      />
      <AdminDashboard
        projects={(projects ?? []) as any}
        clients={(clients ?? []) as any}
        activity={activity}
        revenue={revenue}
        unreadMessages={unreadMessages ?? 0}
        adminName={user.user_metadata?.name ?? 'Admin'}
      />
    </>
  )
}
