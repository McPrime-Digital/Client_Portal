import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Rooms — Batch 23 (S3-d). The server library over message_rooms +
 * room_members now that membership is a ROW (MD-1).
 *
 * lib/messageRooms.ts stays what it was: the get-or-create for the two
 * SERVER-MINTED kinds (client rooms, the crew General room). This module owns
 * everything the membership model added — channels, groups, DMs, broadcast,
 * seating, leaving, the seeding rules (S3-d §5.3), and the room list.
 *
 * The `db` client is a parameter (the lib/messageRooms rule): no new I-8
 * allowlist entries here; callers pass what they are allowlisted for.
 *
 * ── THE SEEDING RULE IS BELT; THE SELF-HEAL IS SUSPENDERS ───────────────────
 * §5.3 hooks (create-client, invites, crew activation) create membership rows
 * at the moment the roster changes. healDerivableMemberships() re-derives
 * them on room-list load with ON CONFLICT DO NOTHING — so a missed hook costs
 * one page-load of staleness, not a support ticket. DO NOTHING is load-
 * bearing: a row whose left_at is set STAYS left (the unique key blocks the
 * re-insert), so an explicit removal is never silently undone by a heal.
 */

export type RoomKind = 'client' | 'crew' | 'channel' | 'group' | 'dm' | 'broadcast'

export type RoomMemberInfo = {
  userId: string
  name: string
  avatarUrl: string | null
  side: 'crew' | 'client' | 'external'
  role: 'owner' | 'admin' | 'member' | 'viewer'
  canPost: boolean
}

export type RoomListEntry = {
  id: string
  kind: RoomKind
  /** resolved display label: DM → the other person, client → the company */
  label: string
  name: string | null
  topic: string | null
  isPrivate: boolean
  archived: boolean
  clientId: string | null
  projectId: string | null
  lastMessageAt: string | null
  unread: number
  membership: { role: string; canPost: boolean; notify: string }
  members: RoomMemberInfo[]
  memberCount: number
  latest: { senderName: string | null; body: string; createdAt: string } | null
}

const UNREAD_SCAN_CAP = 500

/** Room role from an org roster row — the 0044 mapping, kept in one place. */
export function roomRoleForOrg(role: string, roles?: string[] | null): 'owner' | 'admin' | 'member' {
  if (role === 'owner' || roles?.includes('owner')) return 'owner'
  if (role === 'admin' || roles?.includes('admin')) return 'admin'
  return 'member'
}

/** Room role from a client roster row — approver manages, viewer reads. */
export function roomRoleForClient(role: string): 'owner' | 'admin' | 'member' | 'viewer' {
  if (role === 'owner') return 'owner'
  if (role === 'approver') return 'admin'
  if (role === 'viewer') return 'viewer'
  return 'member'
}

// ── Seeding (S3-d §5.3) ─────────────────────────────────────────────────────

/** A client member joins their company's room. Idempotent; never revives a left row. */
export async function seedClientRoomMember(
  db: SupabaseClient,
  opts: { orgId: string; clientId: string; userId: string; clientRole: string }
): Promise<void> {
  const { data: room } = await db
    .from('message_rooms').select('id')
    .eq('organization_id', opts.orgId).eq('kind', 'client')
    .eq('client_id', opts.clientId).is('deleted_at', null).maybeSingle()
  if (!room) return
  const role = roomRoleForClient(opts.clientRole)
  const { error } = await db.from('room_members')
    .upsert(
      { room_id: room.id, user_id: opts.userId, role, can_post: role !== 'viewer' },
      { onConflict: 'room_id,user_id', ignoreDuplicates: true }
    )
  if (error) throw new Error(`seedClientRoomMember: ${error.message}`)
}

/** An activated crew member joins every live room of their org (today's
 *  product shape: the studio side sees every client conversation). */
export async function seedCrewMember(
  db: SupabaseClient,
  opts: { orgId: string; userId: string; orgRole: string; orgRoles?: string[] | null }
): Promise<void> {
  const { data: rooms, error: roomErr } = await db
    .from('message_rooms').select('id, kind')
    .eq('organization_id', opts.orgId).is('deleted_at', null)
    .in('kind', ['client', 'crew'])
  if (roomErr) throw new Error(`seedCrewMember rooms: ${roomErr.message}`)
  if (!rooms?.length) return
  const role = roomRoleForOrg(opts.orgRole, opts.orgRoles)
  const { error } = await db.from('room_members').upsert(
    rooms.map((r) => ({ room_id: r.id, user_id: opts.userId, role, can_post: true })),
    { onConflict: 'room_id,user_id', ignoreDuplicates: true }
  )
  if (error) throw new Error(`seedCrewMember: ${error.message}`)
}

/** Seed EVERY derivable seat for one client room: the company's active
 *  members plus the org's active crew. The create/invite paths call this the
 *  moment the room exists, so day-one realtime works without waiting for the
 *  first hub load's self-heal. Idempotent; never revives a left seat. */
export async function seedClientRoomAll(
  db: SupabaseClient,
  orgId: string,
  clientId: string
): Promise<void> {
  const { data: room } = await db
    .from('message_rooms').select('id')
    .eq('organization_id', orgId).eq('kind', 'client')
    .eq('client_id', clientId).is('deleted_at', null).maybeSingle()
  if (!room) return
  const [{ data: oms }, { data: cms }] = await Promise.all([
    db.from('organization_members').select('user_id, role, roles')
      .eq('organization_id', orgId).eq('status', 'active').not('user_id', 'is', null),
    db.from('client_members').select('user_id, role')
      .eq('client_id', clientId).eq('status', 'active').not('user_id', 'is', null),
  ])
  const rows = [
    ...(oms ?? []).map((m) => ({
      room_id: room.id, user_id: m.user_id as string,
      role: roomRoleForOrg(m.role as string, m.roles as string[] | null), can_post: true,
    })),
    ...(cms ?? []).map((m) => {
      const role = roomRoleForClient(m.role as string)
      return { room_id: room.id, user_id: m.user_id as string, role, can_post: role !== 'viewer' }
    }),
  ]
  if (!rows.length) return
  const { error } = await db.from('room_members')
    .upsert(rows, { onConflict: 'room_id,user_id', ignoreDuplicates: true })
  if (error) throw new Error(`seedClientRoomAll: ${error.message}`)
}

/**
 * Access cut (pause / revoke): EVERY live seat is stamped left, whatever the
 * room kind. Under MD-1 the seat, not the claim, is what reads a room — a
 * revoked member whose group seats survived would keep reading those groups
 * with a valid session, which is the pre-flip assertion-6 hole reopened one
 * table over. Restore brings back the DERIVABLE seats; curated seats
 * (groups, channels, DMs) need a manager's deliberate re-add — stated, not
 * silently resurrected.
 */
export async function stampLeftAllSeats(db: SupabaseClient, userId: string): Promise<void> {
  const { error } = await db.from('room_members')
    .update({ left_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('left_at', null)
  if (error) throw new Error(`stampLeftAllSeats: ${error.message}`)
}

/** The resume half: clear left_at on rooms the rosters still imply, then
 *  heal anything missing. Runs off the roster rows, so it restores exactly
 *  what a fresh member would have been seeded with — nothing curated. */
export async function restoreDerivableSeats(db: SupabaseClient, userId: string): Promise<void> {
  const [{ data: oms }, { data: cms }] = await Promise.all([
    db.from('organization_members').select('organization_id')
      .eq('user_id', userId).eq('status', 'active'),
    db.from('client_members').select('client_id, organization_id')
      .eq('user_id', userId).eq('status', 'active'),
  ])
  const roomIds: string[] = []
  for (const om of oms ?? []) {
    const { data: rooms } = await db.from('message_rooms').select('id')
      .eq('organization_id', om.organization_id).is('deleted_at', null)
      .in('kind', ['client', 'crew'])
    for (const r of rooms ?? []) roomIds.push(r.id as string)
  }
  for (const cm of cms ?? []) {
    const { data: room } = await db.from('message_rooms').select('id')
      .eq('organization_id', cm.organization_id).eq('kind', 'client')
      .eq('client_id', cm.client_id).is('deleted_at', null).maybeSingle()
    if (room) roomIds.push(room.id as string)
  }
  if (roomIds.length) {
    const { error } = await db.from('room_members')
      .update({ left_at: null, joined_at: new Date().toISOString() })
      .eq('user_id', userId)
      .not('left_at', 'is', null)
      .in('room_id', roomIds)
    if (error) throw new Error(`restoreDerivableSeats: ${error.message}`)
  }
  await healDerivableMemberships(db, userId)
}

/** Roster removal → left_at on the matching seats (never a delete — the
 *  history keeps its author, S3-d assertion 25 / AD-003). */
export async function stampLeft(
  db: SupabaseClient,
  opts: { userId: string; orgId?: string; clientId?: string }
): Promise<void> {
  if (!opts.orgId && !opts.clientId) throw new Error('stampLeft: orgId or clientId required')
  let roomQ = db.from('message_rooms').select('id').is('deleted_at', null)
  if (opts.clientId) roomQ = roomQ.eq('kind', 'client').eq('client_id', opts.clientId)
  else roomQ = roomQ.eq('organization_id', opts.orgId!)
  const { data: rooms, error: roomErr } = await roomQ
  if (roomErr) throw new Error(`stampLeft rooms: ${roomErr.message}`)
  if (!rooms?.length) return
  const { error } = await db.from('room_members')
    .update({ left_at: new Date().toISOString() })
    .eq('user_id', opts.userId)
    .is('left_at', null)
    .in('room_id', rooms.map((r) => r.id))
  if (error) throw new Error(`stampLeft: ${error.message}`)
}

/** Re-derive every membership the rosters imply for this user. The suspenders
 *  half of the seeding rule — see the module header. Returns true if anything
 *  was inserted (the caller re-reads its list). */
export async function healDerivableMemberships(
  db: SupabaseClient,
  userId: string
): Promise<boolean> {
  const [{ data: oms }, { data: cms }] = await Promise.all([
    db.from('organization_members')
      .select('organization_id, role, roles')
      .eq('user_id', userId).eq('status', 'active'),
    db.from('client_members')
      .select('client_id, organization_id, role')
      .eq('user_id', userId).eq('status', 'active'),
  ])

  const rows: { room_id: string; user_id: string; role: string; can_post: boolean }[] = []
  for (const om of oms ?? []) {
    const { data: rooms } = await db
      .from('message_rooms').select('id')
      .eq('organization_id', om.organization_id).is('deleted_at', null)
      .in('kind', ['client', 'crew'])
    const role = roomRoleForOrg(om.role as string, om.roles as string[] | null)
    for (const r of rooms ?? []) rows.push({ room_id: r.id, user_id: userId, role, can_post: true })
  }
  for (const cm of cms ?? []) {
    const { data: room } = await db
      .from('message_rooms').select('id')
      .eq('organization_id', cm.organization_id).eq('kind', 'client')
      .eq('client_id', cm.client_id).is('deleted_at', null).maybeSingle()
    if (!room) continue
    const role = roomRoleForClient(cm.role as string)
    rows.push({ room_id: room.id, user_id: userId, role, can_post: role !== 'viewer' })
  }
  if (rows.length === 0) return false

  const before = await db.from('room_members')
    .select('room_id', { count: 'exact', head: true }).eq('user_id', userId)
  const { error } = await db.from('room_members')
    .upsert(rows, { onConflict: 'room_id,user_id', ignoreDuplicates: true })
  if (error) throw new Error(`healDerivableMemberships: ${error.message}`)
  const after = await db.from('room_members')
    .select('room_id', { count: 'exact', head: true }).eq('user_id', userId)
  return (after.count ?? 0) > (before.count ?? 0)
}

// ── Creation ────────────────────────────────────────────────────────────────

export type CreateRoomInput = {
  orgId: string
  createdBy: string
  kind: 'channel' | 'group' | 'broadcast'
  name: string
  topic?: string | null
  isPrivate?: boolean
  projectId?: string | null
  clientId?: string | null
  /** seats beyond the creator; validated by the caller against the tenant */
  members?: { userId: string; role?: 'admin' | 'member' | 'viewer'; canPost?: boolean }[]
}

/**
 * Create a channel/group/broadcast and seat its people. The creator is
 * seated OWNER first (matching the 0046 bootstrap policy shape even when the
 * caller is the service role). Broadcast seats default to can_post=false —
 * MD-5 as a default, not a special case.
 */
export async function createRoom(db: SupabaseClient, input: CreateRoomInput) {
  const { data: room, error } = await db
    .from('message_rooms')
    .insert({
      organization_id: input.orgId, // stamped, never defaulted (T-5)
      kind: input.kind,
      name: input.name,
      topic: input.topic ?? null,
      is_private: input.isPrivate ?? true,
      project_id: input.projectId ?? null,
      client_id: input.clientId ?? null,
      created_by: input.createdBy,
    })
    .select('*')
    .single()
  if (error) throw new Error(`createRoom: ${error.message}`)

  // Creator seat FIRST and ALONE — the 0046 bootstrap clause admits exactly
  // {self, owner, room I created}; the rest then pass the manager clause.
  // Ordered this way the whole function runs on the USER client under RLS.
  const defaultPost = input.kind !== 'broadcast'
  const { error: mineErr } = await db.from('room_members')
    .upsert(
      [{ room_id: room.id, user_id: input.createdBy, role: 'owner', can_post: true, added_by: input.createdBy }],
      { onConflict: 'room_id,user_id', ignoreDuplicates: true }
    )
  if (mineErr) throw new Error(`createRoom creator seat: ${mineErr.message}`)
  const others = (input.members ?? [])
    .filter((m) => m.userId !== input.createdBy)
    .map((m) => ({
      room_id: room.id,
      user_id: m.userId,
      role: m.role ?? 'member',
      can_post: m.canPost ?? defaultPost,
      added_by: input.createdBy,
    }))
  if (others.length) {
    const { error: seatErr } = await db.from('room_members')
      .upsert(others, { onConflict: 'room_id,user_id', ignoreDuplicates: true })
    if (seatErr) throw new Error(`createRoom seats: ${seatErr.message}`)
  }
  return room
}

/**
 * Find-or-create the DM between two people, race-free on the dm_key index —
 * the 0027 shape one level down (S3-d §4.3). Both seats land with it.
 */
export async function ensureDm(
  db: SupabaseClient,
  opts: {
    orgId: string
    createdBy: string
    otherUserId: string
    /**
     * WHICH SPACE THIS DM BELONGS TO (the owner's correction, 2026-09-03).
     * A DM with a client company's person is client-facing work and belongs
     * in Client › Messages; a crew-to-crew DM is internal and belongs in
     * Crew › Chat. `client_id` is what routes it, exactly as it routes the
     * company room — so the hubs filter on one column instead of guessing
     * from who is in the room.
     */
    clientId?: string | null
  }
) {
  if (opts.createdBy === opts.otherUserId) throw new Error('ensureDm: a DM needs two different people')
  const dmKey = [opts.createdBy, opts.otherUserId].sort().join(':')

  const find = async () => {
    const { data, error } = await db
      .from('message_rooms').select('*')
      .eq('organization_id', opts.orgId).eq('kind', 'dm')
      .eq('dm_key', dmKey).is('deleted_at', null).maybeSingle()
    if (error) throw new Error(`ensureDm lookup: ${error.message}`)
    return data
  }

  let room = await find()
  if (!room) {
    const { data: made, error } = await db
      .from('message_rooms')
      .insert({
        organization_id: opts.orgId, kind: 'dm', dm_key: dmKey,
        client_id: opts.clientId ?? null,
        is_private: true, created_by: opts.createdBy,
      })
      .select('*').single()
    if (error) {
      if (error.code === '23505') {
        room = await find()
        if (!room) throw new Error(`ensureDm: conflict but no live DM (${error.message})`)
      } else {
        throw new Error(`ensureDm insert: ${error.message}`)
      }
    } else {
      room = made
    }
  }

  // Creator seat FIRST, as owner — the exact shape 0046's bootstrap clause
  // admits, so this whole function runs on the USER client under RLS
  // (AD-001). The counterpart seat then rides the manager clause.
  const { error: mineErr } = await db.from('room_members').upsert(
    [{ room_id: room.id, user_id: opts.createdBy, role: 'owner', can_post: true, added_by: opts.createdBy }],
    { onConflict: 'room_id,user_id', ignoreDuplicates: true }
  )
  if (mineErr) throw new Error(`ensureDm creator seat: ${mineErr.message}`)
  const { error: seatErr } = await db.from('room_members').upsert(
    [{ room_id: room.id, user_id: opts.otherUserId, role: 'member', can_post: true, added_by: opts.createdBy }],
    { onConflict: 'room_id,user_id', ignoreDuplicates: true }
  )
  if (seatErr) throw new Error(`ensureDm seats: ${seatErr.message}`)
  return room
}

// ── Membership management ───────────────────────────────────────────────────

export async function addRoomMembers(
  db: SupabaseClient,
  opts: {
    roomId: string
    addedBy: string
    members: { userId: string; role?: 'admin' | 'member' | 'viewer'; canPost?: boolean }[]
  }
): Promise<void> {
  if (opts.members.length === 0) return
  const ids = opts.members.map((m) => m.userId)
  const { data: existing, error: exErr } = await db
    .from('room_members').select('user_id, left_at')
    .eq('room_id', opts.roomId).in('user_id', ids)
  if (exErr) throw new Error(`addRoomMembers read: ${exErr.message}`)
  const left = new Set((existing ?? []).filter((r) => r.left_at != null).map((r) => r.user_id))
  const present = new Set((existing ?? []).filter((r) => r.left_at == null).map((r) => r.user_id))

  const fresh = opts.members.filter((m) => !left.has(m.userId) && !present.has(m.userId))
  if (fresh.length) {
    const { error } = await db.from('room_members').insert(
      fresh.map((m) => ({
        room_id: opts.roomId, user_id: m.userId,
        role: m.role ?? 'member', can_post: m.canPost ?? true, added_by: opts.addedBy,
      }))
    )
    if (error) throw new Error(`addRoomMembers insert: ${error.message}`)
  }
  // An explicit re-add by a manager is a REJOIN: clear left_at, reset the
  // seat. (The self-heal can never do this — only a person can, on purpose.)
  for (const m of opts.members.filter((m) => left.has(m.userId))) {
    const { error } = await db.from('room_members')
      .update({
        left_at: null, joined_at: new Date().toISOString(),
        role: m.role ?? 'member', can_post: m.canPost ?? true, added_by: opts.addedBy,
      })
      .eq('room_id', opts.roomId).eq('user_id', m.userId)
    if (error) throw new Error(`addRoomMembers rejoin: ${error.message}`)
  }
}

export async function removeRoomMember(
  db: SupabaseClient,
  opts: { roomId: string; userId: string }
): Promise<void> {
  const { error } = await db.from('room_members')
    .update({ left_at: new Date().toISOString() })
    .eq('room_id', opts.roomId).eq('user_id', opts.userId).is('left_at', null)
  if (error) throw new Error(`removeRoomMember: ${error.message}`)
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** The room plus the CALLER's live seat — null membership means no access.
 *  This is the authorization read every room route starts with. */
export async function roomWithMembership(
  db: SupabaseClient,
  roomId: string,
  userId: string
) {
  const [{ data: room, error: roomErr }, { data: seat, error: seatErr }] = await Promise.all([
    db.from('message_rooms').select('*').eq('id', roomId).is('deleted_at', null).maybeSingle(),
    db.from('room_members').select('*')
      .eq('room_id', roomId).eq('user_id', userId).is('left_at', null).maybeSingle(),
  ])
  if (roomErr) throw new Error(`roomWithMembership room: ${roomErr.message}`)
  if (seatErr) throw new Error(`roomWithMembership seat: ${seatErr.message}`)
  return { room, membership: seat }
}

/** Names, avatars and sides for a set of user ids, roster-resolved with the
 *  room seat (display_name/avatar_url) as the collaborator fallback. */
export async function resolvePeople(
  db: SupabaseClient,
  orgId: string,
  seats: { user_id: string; role: string; can_post: boolean; display_name?: string | null; avatar_url?: string | null }[]
): Promise<Map<string, RoomMemberInfo>> {
  const ids = [...new Set(seats.map((s) => s.user_id))]
  if (ids.length === 0) return new Map()
  const [{ data: oms }, { data: cms }] = await Promise.all([
    db.from('organization_members')
      .select('user_id, name, avatar_url')
      .eq('organization_id', orgId).in('user_id', ids),
    db.from('client_members')
      .select('user_id, name, avatar_url')
      .eq('organization_id', orgId).in('user_id', ids),
  ])
  const crewBy = new Map((oms ?? []).map((r) => [r.user_id as string, r]))
  const clientBy = new Map((cms ?? []).map((r) => [r.user_id as string, r]))
  const out = new Map<string, RoomMemberInfo>()
  for (const s of seats) {
    const crew = crewBy.get(s.user_id)
    const client = clientBy.get(s.user_id)
    out.set(s.user_id, {
      userId: s.user_id,
      name: (crew?.name as string) ?? (client?.name as string) ?? s.display_name ?? 'Collaborator',
      avatarUrl: (crew?.avatar_url as string) ?? (client?.avatar_url as string) ?? s.avatar_url ?? null,
      side: crew ? 'crew' : client ? 'client' : 'external',
      role: s.role as RoomMemberInfo['role'],
      canPost: s.can_post,
    })
  }
  return out
}

/**
 * Every room the caller sits in, labelled, previewed and counted — the data
 * behind both hubs' room lists. Bounded: 100 rooms, one limit-1 preview per
 * room, one capped unread scan.
 */
export async function myRooms(db: SupabaseClient, userId: string): Promise<RoomListEntry[]> {
  const healed = await healDerivableMemberships(db, userId).catch(() => false)
  void healed

  const { data: seats, error: seatErr } = await db
    .from('room_members').select('*')
    .eq('user_id', userId).is('left_at', null)
    .limit(100)
  if (seatErr) throw new Error(`myRooms seats: ${seatErr.message}`)
  if (!seats?.length) return []

  const roomIds = seats.map((s) => s.room_id as string)
  const seatByRoom = new Map(seats.map((s) => [s.room_id as string, s]))

  const { data: rooms, error: roomErr } = await db
    .from('message_rooms').select('*')
    .in('id', roomIds).is('deleted_at', null)
    .order('last_message_at', { ascending: false, nullsFirst: false })
  if (roomErr) throw new Error(`myRooms rooms: ${roomErr.message}`)
  if (!rooms?.length) return []

  // Everyone's seats across these rooms, for labels/avatars/counts.
  const { data: allSeats, error: allErr } = await db
    .from('room_members')
    .select('room_id, user_id, role, can_post, display_name, avatar_url')
    .in('room_id', rooms.map((r) => r.id))
    .is('left_at', null)
    .limit(2000)
  if (allErr) throw new Error(`myRooms all seats: ${allErr.message}`)

  // Company labels for client rooms; people for everything else.
  const clientIds = [...new Set(rooms.map((r) => r.client_id).filter(Boolean))] as string[]
  const { data: companies } = clientIds.length
    ? await db.from('clients').select('id, name, company, avatar_url').in('id', clientIds)
    : { data: [] as { id: string; name: string; company: string | null; avatar_url: string | null }[] }
  const companyBy = new Map((companies ?? []).map((c) => [c.id as string, c]))

  const peopleByOrg = new Map<string, Map<string, RoomMemberInfo>>()
  for (const orgId of new Set(rooms.map((r) => r.organization_id as string))) {
    const orgRoomIds = new Set(rooms.filter((r) => r.organization_id === orgId).map((r) => r.id))
    const orgSeats = (allSeats ?? []).filter((s) => orgRoomIds.has(s.room_id))
    peopleByOrg.set(orgId, await resolvePeople(db, orgId, orgSeats))
  }

  // Unread: the per-room watermark predicate, in-query, capped (the Batch 21
  // shape — rows fetched ≈ rows actually unread).
  const { data: wms } = await db
    .from('message_read_state').select('room_id, last_read_at')
    .eq('user_id', userId).in('room_id', rooms.map((r) => r.id))
  const wmBy = new Map((wms ?? []).map((w) => [w.room_id as string, w.last_read_at as string]))
  const preds = rooms.map((r) =>
    wmBy.get(r.id) ? `and(room_id.eq.${r.id},created_at.gt.${wmBy.get(r.id)})` : `room_id.eq.${r.id}`
  )
  const { data: unreadRows } = await db
    .from('messages').select('room_id, sender_id, created_at')
    .or(preds.join(','))
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(UNREAD_SCAN_CAP)
  const unreadBy = new Map<string, number>()
  for (const m of unreadRows ?? []) {
    if (m.sender_id === userId) continue
    const wm = wmBy.get(m.room_id as string)
    if (wm && (m.created_at as string) <= wm) continue
    unreadBy.set(m.room_id as string, (unreadBy.get(m.room_id as string) ?? 0) + 1)
  }

  // Latest preview: one limit-1 query per room (bounded by the 100-room cap).
  const latestBy = new Map<string, { senderName: string | null; body: string; createdAt: string }>()
  await Promise.all(rooms.map(async (r) => {
    const { data: m } = await db
      .from('messages').select('sender_name, body, attachment_name, created_at, deleted_at')
      .eq('room_id', r.id).is('thread_root_id', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (m) {
      latestBy.set(r.id, {
        senderName: m.sender_name as string | null,
        body: m.deleted_at ? 'Message deleted' : ((m.body as string) || (m.attachment_name ? `📎 ${m.attachment_name}` : '')),
        createdAt: m.created_at as string,
      })
    }
  }))

  return rooms.map((r) => {
    const seat = seatByRoom.get(r.id)!
    const people = peopleByOrg.get(r.organization_id as string) ?? new Map<string, RoomMemberInfo>()
    const roomSeats = (allSeats ?? []).filter((s) => s.room_id === r.id)
    const members = roomSeats
      .map((s) => people.get(s.user_id))
      .filter((p): p is RoomMemberInfo => !!p)
    const company = r.client_id ? companyBy.get(r.client_id as string) : null
    const others = members.filter((m) => m.userId !== userId)
    const label =
      r.kind === 'client'
        ? ((company?.company ?? company?.name) as string) ?? 'Client'
        : r.kind === 'dm'
          ? others[0]?.name ?? 'Direct message'
          : (r.name as string) ?? 'Room'
    return {
      id: r.id as string,
      kind: r.kind as RoomKind,
      label,
      name: (r.name as string) ?? null,
      topic: (r.topic as string) ?? null,
      isPrivate: !!r.is_private,
      archived: r.archived_at != null,
      clientId: (r.client_id as string) ?? null,
      projectId: (r.project_id as string) ?? null,
      lastMessageAt: (r.last_message_at as string) ?? null,
      unread: unreadBy.get(r.id as string) ?? 0,
      membership: {
        role: seat.role as string,
        canPost: !!seat.can_post && seat.role !== 'viewer',
        notify: seat.notify as string,
      },
      members: members.slice(0, 12),
      memberCount: members.length,
      latest: latestBy.get(r.id as string) ?? null,
    }
  })
}
