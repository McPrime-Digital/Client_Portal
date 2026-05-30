import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import MessagesHub from '@/components/portal/MessagesHub'

export default async function MessagesPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Service role + explicit ownership scoping — no RLS dependency.
  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (!client) redirect('/dashboard')

  // Fetch all projects with their latest message
  const { data: projects } = await supabaseAdmin
    .from('projects')
    .select(`
      id,
      title,
      status,
      type
    `)
    .eq('client_id', client.id)
    .order('created_at', { ascending: false })

  // For each project, get latest message + unread count
  const projectIds = (projects ?? []).map((p) => p.id)

  let threads: any[] = []

  if (projectIds.length > 0) {
    // Get latest message per project
    const { data: latestMessages } = await supabaseAdmin
      .from('messages')
      .select('*')
      .in('project_id', projectIds)
      .order('created_at', { ascending: false })

    // Get unread counts (admin messages not yet read)
    const { data: unreadMessages } = await supabaseAdmin
      .from('messages')
      .select('project_id')
      .in('project_id', projectIds)
      .eq('sender_role', 'admin')
      .is('read_at', null)

    // Build thread map
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

    threads = (projects ?? []).map((p) => ({
      ...p,
      latestMessage: latestByProject[p.id] ?? null,
      unreadCount: unreadByProject[p.id] ?? 0,
    }))

    // Sort: threads with messages first, then by latest
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
    <MessagesHub
      threads={threads}
      clientId={client.id}
      clientName={client.name}
    />
  )
}
