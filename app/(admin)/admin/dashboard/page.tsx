import { isAdmin } from '@/lib/auth/role'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AdminDashboard from
  '@/components/admin/AdminDashboard'

export default async function AdminDashboardPage() {
  const supabase = await createClient()

  const { data: { user } } =
    await supabase.auth.getUser()
  if (
    !user ||
    !isAdmin(user)
  ) {
    redirect('/login')
  }

  // Projects with client info + task counts
  const { data: projects } = await supabaseAdmin
    .from('projects')
    .select(`
      id,
      title,
      status,
      created_at,
      updated_at,
      clients(id, name, company, avatar_url),
      tasks(
        id,
        status,
        visible_to_client
      ),
      files(id),
      messages(id),
      invoices(
        id,
        amount,
        status
      )
    `)
    .order('updated_at', { ascending: false })
    .limit(50)

  // All clients
  const { data: clients } = await supabaseAdmin
    .from('clients')
    .select(`
      id,
      name,
      company,
      email,
      avatar_url,
      created_at,
      projects(id, status)
    `)
    .order('created_at', { ascending: false })

  // Recent activity — last 40 events
  // Falls back gracefully if table doesn't exist yet
  let activity: any[] = []
  try {
    const { data } = await supabaseAdmin
      .from('activity_log')
      .select(`
        *,
        projects(id, title),
        clients(id, name)
      `)
      .order('created_at', { ascending: false })
      .limit(40)
    activity = data ?? []
  } catch {
    activity = []
  }

  // Revenue totals
  const { data: invoiceTotals } = await supabaseAdmin
    .from('invoices')
    .select('amount, status')

  const revenue = {
    collected: (invoiceTotals ?? [])
      .filter((i) => i.status === 'paid')
      .reduce((a, i) => a + Number(i.amount), 0),
    outstanding: (invoiceTotals ?? [])
      .filter((i) =>
        ['unpaid', 'overdue'].includes(i.status)
      )
      .reduce((a, i) => a + Number(i.amount), 0),
    overdue: (invoiceTotals ?? [])
      .filter((i) => i.status === 'overdue')
      .reduce((a, i) => a + Number(i.amount), 0),
  }

  // Unread messages count
  const { count: unreadMessages } = await supabaseAdmin
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .is('read_at', null)
    .eq('sender_role', 'client')

  return (
    <AdminDashboard
      projects={(projects ?? []) as any}
      clients={(clients ?? []) as any}
      activity={activity}
      revenue={revenue}
      unreadMessages={unreadMessages ?? 0}
      adminName={
        user.user_metadata?.name ?? 'Admin'
      }
    />
  )
}
