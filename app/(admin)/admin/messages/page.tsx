import { isAdmin } from '@/lib/auth/role'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import AdminMessagesHub from 
  '@/components/admin/AdminMessagesHub'

export default async function AdminMessagesPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    redirect('/login')
  }

  // All projects with latest message + unread from clients
  const { data: projects } = await supabaseAdmin
    .from('projects')
    .select(`
      id,
      title,
      status,
      type,
      clients(id, name, company)
    `)
    .order('created_at', { ascending: false })

  const projectIds = (projects ?? []).map((p) => p.id)
  let threads: any[] = []

  if (projectIds.length > 0) {
    const { data: latestMessages } = await supabaseAdmin
      .from('messages')
      .select('*')
      .in('project_id', projectIds)
      .order('created_at', { ascending: false })

    const { data: unreadMessages } = await supabaseAdmin
      .from('messages')
      .select('project_id')
      .in('project_id', projectIds)
      .eq('sender_role', 'client')
      .is('read_at', null)

    const latestByProject: Record<string, any> = {}
    for (const msg of latestMessages ?? []) {
      if (!latestByProject[msg.project_id]) {
        latestByProject[msg.project_id] = msg
      }
    }

    const unreadByProject: Record<string, number> = {}
    for (const msg of unreadMessages ?? []) {
      unreadByProject[msg.project_id] =
        (unreadByProject[msg.project_id] ?? 0) + 1
    }

    threads = (projects ?? []).map((p: any) => ({
      ...p,
      client: p.clients,
      latestMessage: latestByProject[p.id] ?? null,
      unreadCount: unreadByProject[p.id] ?? 0,
    }))

    threads.sort((a, b) => {
      if (!a.latestMessage && !b.latestMessage) return 0
      if (!a.latestMessage) return 1
      if (!b.latestMessage) return -1
      return (
        new Date(b.latestMessage.created_at).getTime() -
        new Date(a.latestMessage.created_at).getTime()
      )
    })
  }

  return (
    <AdminMessagesHub
      threads={threads}
      adminName="McPrime Digital"
    />
  )
}
