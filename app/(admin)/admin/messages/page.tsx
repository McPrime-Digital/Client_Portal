import { isAdmin, userOrgId } from '@/lib/auth/role'
import { tenantBrand } from '@/lib/tenantBrand'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import AdminMessagesHub from
  '@/components/admin/AdminMessagesHub'
import { orgUnread, scrubDeleted } from '@/lib/messageRead'

export default async function AdminMessagesPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    redirect('/login')
  }

  // Tenant scope, resolved once from the verified session (never a param).
  // The message queries below are bounded by projectIds, which this filter
  // makes tenant-local — so the threads list cannot reach another studio's chat.
  const orgId = userOrgId(user)

  // How this studio signs its own messages to clients (S-V §X-6).
  const brand = await tenantBrand(orgId)

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
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })

  const projectIds = (projects ?? []).map((p) => p.id)
  let threads: any[] = []

  // Per-person unread across the org (message_read_state, A-7).
  const unread = await orgUnread(supabaseAdmin, { userId: user.id, orgId })

  if (projectIds.length > 0) {
    const { data: latestRaw } = await supabaseAdmin
      .from('messages')
      .select('*')
      .eq('organization_id', orgId)
      .in('project_id', projectIds)
      .order('created_at', { ascending: false })
    const latestMessages = scrubDeleted(latestRaw)

    const unreadByProject = unread.byProject

    const latestByProject: Record<string, any> = {}
    for (const msg of latestMessages ?? []) {
      if (!latestByProject[msg.project_id]) {
        latestByProject[msg.project_id] = msg
      }
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

  // General threads (Batch 14 item 8): every company room gets one — the
  // untagged conversation, and the ONLY thread a project-less client has.
  const { data: rooms } = await supabaseAdmin
    .from('message_rooms')
    .select('id, client_id, clients(id, name, company)')
    .eq('organization_id', orgId)
    .eq('kind', 'client')
    .is('deleted_at', null)
  const { data: untaggedRaw } = await supabaseAdmin
    .from('messages')
    .select('*')
    .eq('organization_id', orgId)
    .is('project_id', null)
    .order('created_at', { ascending: false })
  const untagged = scrubDeleted(untaggedRaw)
  const latestByRoom: Record<string, Record<string, unknown>> = {}
  for (const m of untagged) {
    if (m.room_id && !latestByRoom[m.room_id]) latestByRoom[m.room_id] = m
  }
  const generalThreads = (rooms ?? []).map((r) => ({
    id: `room:${r.client_id}`,
    isGeneral: true,
    title: 'General',
    status: null,
    type: null,
    client: r.clients,
    clients: r.clients,
    latestMessage: latestByRoom[r.id] ?? null,
    unreadCount: unread.generalByClient[r.client_id] ?? 0,
  }))
  // Generals join the same activity sort — a quiet General sinks, a busy one
  // surfaces, exactly like a project thread.
  threads = [...generalThreads, ...threads]
  threads.sort((a, b) => {
    if (!a.latestMessage && !b.latestMessage) return 0
    if (!a.latestMessage) return 1
    if (!b.latestMessage) return -1
    return (
      new Date(b.latestMessage.created_at).getTime() -
      new Date(a.latestMessage.created_at).getTime()
    )
  })

  return (
    <AdminMessagesHub
      threads={threads}
      adminName={brand.name}
    />
  )
}
