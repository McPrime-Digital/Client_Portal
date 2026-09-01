import { clientCan } from '@/lib/permissions'
import { tenantBrand } from '@/lib/tenantBrand'
import { portalClientId, portalAccess } from '@/lib/team'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { clientUnread, scrubDeleted } from '@/lib/messageRead'
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
    .eq('id', await portalClientId(user))
    .single()

  if (!client) redirect('/dashboard')

  // Member scoping — project allowlist + message-history cutoff.
  const access = await portalAccess(user)

  // The studio on the other side of these threads (S0-B §3).
  const brand = await tenantBrand(client.organization_id)

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
  const visibleProjects = (projects ?? []).filter(
    (p) => !access?.projectIds || access.projectIds.includes(p.id)
  )
  const projectIds = visibleProjects.map((p) => p.id)

  let threads: any[] = []

  // Unread is per PERSON now (message_read_state, A-7): this member's own
  // watermark, not whether ANYONE at the company opened the thread. Computed
  // unconditionally — a project-less client still has a room and a badge.
  const unread = await clientUnread(supabaseAdmin, {
    userId: user.id,
    clientId: client.id,
    historyFrom: access?.historyFrom ?? null,
    visibleProjectIds: access?.projectIds ?? null,
  })

  if (projectIds.length > 0) {
    // Get latest message per project (respecting the member's history cutoff)
    let latestQ = supabaseAdmin
      .from('messages')
      .select('*')
      .in('project_id', projectIds)
      .order('created_at', { ascending: false })
    if (access?.historyFrom) latestQ = latestQ.gte('created_at', access.historyFrom)
    const { data: latestRaw } = await latestQ
    const latestMessages = scrubDeleted(latestRaw)

    // Build thread map
    const latestByProject: Record<string, any> = {}
    for (const msg of latestMessages ?? []) {
      if (!latestByProject[msg.project_id]) {
        latestByProject[msg.project_id] = msg
      }
    }

    threads = visibleProjects.map((p) => ({
      ...p,
      latestMessage: latestByProject[p.id] ?? null,
      unreadCount: unread.byProject[p.id] ?? 0,
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

  // The General thread (Batch 14 item 8): the company's room-level
  // conversation — how a freshly onboarded client messages the studio before
  // any project exists, and where untagged traffic lives after. Always
  // pinned first; its id ("room:<clientId>") is understood by every route.
  let generalLatest: Record<string, unknown> | null = null
  if (unread.roomId) {
    let gq = supabaseAdmin
      .from('messages')
      .select('*')
      .eq('room_id', unread.roomId)
      .is('project_id', null)
      .order('created_at', { ascending: false })
      .limit(1)
    if (access?.historyFrom) gq = gq.gte('created_at', access.historyFrom)
    generalLatest = scrubDeleted((await gq).data)[0] ?? null
  }
  threads = [
    {
      id: `room:${client.id}`,
      isGeneral: true,
      title: 'General',
      status: null,
      type: null,
      latestMessage: generalLatest,
      unreadCount: unread.general,
    },
    ...threads,
  ]

  return (
    <MessagesHub
      threads={threads}
      clientId={client.id}
      roomId={unread.roomId}
      clientName={access?.name ?? client.name}
      studioName={brand.name}
      canSend={clientCan(access?.role ?? 'owner', 'message', access?.extraCaps)}
    />
  )
}
