import { isAdmin, userOrgId } from '@/lib/auth/role'
import { tenantBrand } from '@/lib/tenantBrand'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import AdminMessagesHub, { type HubRoom } from '@/components/admin/AdminMessagesHub'
import { orgUnread, scrubDeleted } from '@/lib/messageRead'
import type { Message } from '@/lib/types/database'

export default async function AdminMessagesPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    redirect('/login')
  }

  // Tenant scope, resolved once from the verified session (never a param).
  const orgId = userOrgId(user)

  // Independent reads run in parallel (nav speed). Rooms are the unit now:
  // one row per client company, not per project (Batch 15 item 1).
  const [brand, unread, { data: rooms }, { data: projects }] =
    await Promise.all([
      tenantBrand(orgId),
      orgUnread(supabaseAdmin, { userId: user.id, orgId }),
      supabaseAdmin
        .from('message_rooms')
        .select('id, client_id, clients(id, name, company, avatar_url)')
        .eq('organization_id', orgId)
        .eq('kind', 'client')
        .is('deleted_at', null),
      supabaseAdmin
        .from('projects')
        .select('id, title, client_id')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false }),
    ])

  // Latest preview per room: ONE limit-1 query per room on the keyset index
  // (Batch 21 item 1). The old shape — newest 200 org messages, first-per-
  // room in JS — was a real truncation: a room quiet for 200+ org messages
  // lost its preview entirely and sank to the bottom of the sort.
  const previewRes = await Promise.all(
    (rooms ?? []).map((r) =>
      supabaseAdmin
        .from('messages')
        .select('*')
        .eq('room_id', r.id)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle()
    )
  )
  const latestByRoom: Record<string, Message> = {}
  ;(rooms ?? []).forEach((r, i) => {
    const m = previewRes[i]?.data
    if (m) latestByRoom[r.id] = scrubDeleted([m])[0] as unknown as Message
  })

  const projectsByClient: Record<string, { id: string; title: string }[]> = {}
  for (const p of projects ?? []) {
    if (!p.client_id) continue
    ;(projectsByClient[p.client_id] ??= []).push({ id: p.id, title: p.title })
  }

  const hubRooms: HubRoom[] = (rooms ?? [])
    .map((r): HubRoom | null => {
      const c = (Array.isArray(r.clients) ? r.clients[0] : r.clients) as
        | { id: string; name: string; company: string | null; avatar_url: string | null }
        | null
      if (!c) return null
      return {
        clientId: c.id,
        roomId: r.id,
        name: c.name,
        company: c.company,
        avatarUrl: c.avatar_url,
        latest: latestByRoom[r.id] ?? null,
        unread: unread.byClient[c.id] ?? 0,
        generalUnread: unread.generalByClient[c.id] ?? 0,
        projects: (projectsByClient[c.id] ?? []).map((p) => ({
          ...p,
          unread: unread.byProject[p.id] ?? 0,
        })),
      }
    })
    .filter((r): r is HubRoom => r != null)
    .sort((a: HubRoom, b: HubRoom) => {
      if (!a.latest && !b.latest) return 0
      if (!a.latest) return 1
      if (!b.latest) return -1
      return new Date(b.latest.created_at).getTime() - new Date(a.latest.created_at).getTime()
    })

  return <AdminMessagesHub orgId={orgId} adminName={brand.name} rooms={hubRooms} />
}
