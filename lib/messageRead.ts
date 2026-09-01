import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Per-user read watermarks — Batch 14 item 3 (S3-core §1.4, A-7).
 *
 * THE one definition of "unread for a person": messages in rooms the person
 * belongs to, newer than THEIR watermark, not sent by them, not deleted.
 * The old model (`read_at IS NULL AND sender_role = <other side>`) was
 * per-thread-per-role: one teammate opening a thread marked it read for
 * their whole company. Twelve sites computed it; they all call this now.
 *
 * Watermarks are PER ROOM. Project threads are tag-filtered views of one
 * room, so opening a thread advances the room watermark to the newest
 * message IN THAT THREAD (monotonic, never backward). Transitional
 * consequence, stated: reading a busy thread can absorb older unread in a
 * quiet sibling thread of the same room. The hub batch makes the room the
 * primary unit, which dissolves this.
 *
 * `last_read_at` stores the watermark MESSAGE's created_at (not wall time),
 * so "unread" is exactly `created_at > last_read_at`.
 *
 * The db client is a parameter (same reason as lib/messageRooms.ts): no new
 * I-8 allowlist entry; callers are already-allowlisted routes and pages.
 */

type Wm = { room_id: string; last_read_at: string }

/**
 * Batch 14 item 5 (A-2's interim exposure): a deleted message's row keeps
 * its place so the tombstone renders, but its content must not leave the
 * server until the purge destroys it. Applied by every server read that
 * ships message rows; RLS takes over for authenticated reads at migration 10.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function scrubDeleted<T extends Record<string, any>>(rows: T[] | null | undefined): T[] {
  return (rows ?? []).map((m) =>
    m.deleted_at || m.is_deleted
      ? { ...m, body: '', attachment_url: null, attachment_name: null }
      : m
  )
}

export type ClientUnread = {
  total: number
  byProject: Record<string, number>
  general: number // untagged (room-level) messages
  roomId: string | null
}

export type OrgUnread = {
  total: number
  byProject: Record<string, number>
  /** untagged unread per client company (keyed by client_id) */
  generalByClient: Record<string, number>
  /** ALL unread per client company's room (tagged + untagged) — the room list badge */
  byClient: Record<string, number>
}

async function watermarksFor(
  db: SupabaseClient,
  userId: string,
  roomIds: string[]
): Promise<Map<string, string>> {
  if (roomIds.length === 0) return new Map()
  const { data, error } = await db
    .from('message_read_state')
    .select('room_id, last_read_at')
    .eq('user_id', userId)
    .in('room_id', roomIds)
  if (error) throw new Error(`message_read_state read failed: ${error.message}`)
  return new Map(((data ?? []) as Wm[]).map((w) => [w.room_id, w.last_read_at]))
}

/**
 * Unread for a client-portal user: their company's room, respecting the
 * member's history cutoff and project scoping. Untagged messages are
 * room-level and always included (S3-core §1.1).
 */
export async function clientUnread(
  db: SupabaseClient,
  opts: {
    userId: string
    clientId: string
    historyFrom?: string | null
    /** null/undefined = unscoped (sees every project) */
    visibleProjectIds?: string[] | null
  }
): Promise<ClientUnread> {
  const { data: room, error: roomErr } = await db
    .from('message_rooms')
    .select('id')
    .eq('client_id', opts.clientId)
    .eq('kind', 'client')
    .is('deleted_at', null)
    .maybeSingle()
  if (roomErr) throw new Error(`message_rooms read failed: ${roomErr.message}`)
  if (!room) return { total: 0, byProject: {}, general: 0, roomId: null }

  const wm = (await watermarksFor(db, opts.userId, [room.id])).get(room.id)

  let q = db
    .from('messages')
    .select('id, project_id, sender_id, created_at')
    .eq('room_id', room.id)
    .is('deleted_at', null)
  if (wm) q = q.gt('created_at', wm)
  if (opts.historyFrom) q = q.gte('created_at', opts.historyFrom)
  const { data: msgs, error } = await q
  if (error) throw new Error(`messages unread read failed: ${error.message}`)

  const byProject: Record<string, number> = {}
  let general = 0
  for (const m of msgs ?? []) {
    if (m.sender_id === opts.userId) continue
    if (m.project_id == null) {
      general++
      continue
    }
    if (opts.visibleProjectIds && !opts.visibleProjectIds.includes(m.project_id)) continue
    byProject[m.project_id] = (byProject[m.project_id] ?? 0) + 1
  }
  const total = general + Object.values(byProject).reduce((a, n) => a + n, 0)
  return { total, byProject, general, roomId: room.id }
}

/** Unread for a studio user across every room of their org. */
export async function orgUnread(
  db: SupabaseClient,
  opts: { userId: string; orgId: string }
): Promise<OrgUnread> {
  const { data: rooms, error: roomErr } = await db
    .from('message_rooms')
    .select('id, client_id')
    .eq('organization_id', opts.orgId)
    .is('deleted_at', null)
  if (roomErr) throw new Error(`message_rooms read failed: ${roomErr.message}`)
  if (!rooms?.length) return { total: 0, byProject: {}, generalByClient: {}, byClient: {} }

  const roomIds = rooms.map((r) => r.id)
  const wms = await watermarksFor(db, opts.userId, roomIds)
  const clientByRoom = new Map(rooms.map((r) => [r.id, r.client_id as string | null]))

  // One org-bounded fetch, filtered per-room in JS (a per-room watermark
  // cannot be one SQL predicate through PostgREST). Bounded by the org's
  // message count — the same bound every hub page already carries (I-1).
  const { data: msgs, error } = await db
    .from('messages')
    .select('id, room_id, project_id, sender_id, created_at')
    .eq('organization_id', opts.orgId)
    .is('deleted_at', null)
  if (error) throw new Error(`messages unread read failed: ${error.message}`)

  const byProject: Record<string, number> = {}
  const generalByClient: Record<string, number> = {}
  const byClient: Record<string, number> = {}
  let total = 0
  for (const m of msgs ?? []) {
    if (m.sender_id === opts.userId) continue
    const wm = wms.get(m.room_id)
    if (wm && m.created_at <= wm) continue
    total++
    const cid = clientByRoom.get(m.room_id)
    if (cid) byClient[cid] = (byClient[cid] ?? 0) + 1
    if (m.project_id != null) {
      byProject[m.project_id] = (byProject[m.project_id] ?? 0) + 1
    } else if (cid) {
      generalByClient[cid] = (generalByClient[cid] ?? 0) + 1
    }
  }
  return { total, byProject, generalByClient, byClient }
}

/**
 * Advance a user's room watermark to the newest message in the opened scope.
 * Monotonic — never moves backward. `projectId` string = that project's
 * thread; null = the untagged (general) thread; undefined = the whole room.
 */
export async function advanceWatermark(
  db: SupabaseClient,
  opts: { userId: string; roomId: string; projectId?: string | null; orUntagged?: boolean }
): Promise<void> {
  let q = db
    .from('messages')
    .select('id, created_at')
    .eq('room_id', opts.roomId)
    .order('created_at', { ascending: false })
    .limit(1)
  if (opts.projectId === null) q = q.is('project_id', null)
  else if (typeof opts.projectId === 'string') {
    // A project view shows the tag PLUS untagged room messages (S-F §2.2 /
    // Batch 15 item 1), so reading it clears both.
    q = opts.orUntagged
      ? q.or(`project_id.eq.${opts.projectId},project_id.is.null`)
      : q.eq('project_id', opts.projectId)
  }
  const { data: newest, error } = await q.maybeSingle()
  if (error) throw new Error(`watermark scope read failed: ${error.message}`)
  if (!newest) return

  const { data: current, error: curErr } = await db
    .from('message_read_state')
    .select('last_read_at')
    .eq('room_id', opts.roomId)
    .eq('user_id', opts.userId)
    .maybeSingle()
  if (curErr) throw new Error(`watermark read failed: ${curErr.message}`)
  if (current && current.last_read_at >= newest.created_at) return

  const { error: upErr } = await db.from('message_read_state').upsert(
    {
      room_id: opts.roomId,
      user_id: opts.userId,
      last_read_message_id: newest.id,
      last_read_at: newest.created_at,
    },
    { onConflict: 'room_id,user_id' }
  )
  if (upErr) throw new Error(`watermark write failed: ${upErr.message}`)
}
