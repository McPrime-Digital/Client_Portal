import 'server-only'
import { getSignedDownloadUrl } from '@/lib/r2'

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
 * Bound on any single unread scan (Batch 21 item 1). Unread queries fetch
 * only rows past the watermark now, so this cap is reached only by a true
 * backlog (a room never opened); past it the count saturates — a stated
 * "at least this many" — instead of undercounting through PostgREST's
 * silent default row limit, which is what the unbounded fetch did.
 */
const UNREAD_SCAN_CAP = 1000

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

/**
 * Which side of the conversation each participant is on, plus each side's
 * newest read watermark — the roster facts that replace the dropped
 * `sender_role`/`read_at` columns on the wire (Batch 21 item 3; S3-core
 * migration 12, S3-core-A A-6).
 *
 * Deliberately NO status filter on either roster read: a paused or revoked
 * member's history keeps its side. What this cannot recover is a FULLY
 * REMOVED member (their roster row is deleted, 6.2) or a null `sender_id`
 * (system messages; senders erased under AD-003) — those default to the
 * studio's side, the voice system messages already speak in. A user in
 * BOTH trees (S1 §2 allows it) classifies as studio-side; the live probe
 * (2026-09-02, 250 rows) found zero rows where this rule disagreed with
 * the stored column.
 */
export type RoomSides = {
  orgUserIds: Set<string>
  clientUserIds: Set<string>
  /** newest last_read_at on each side, from message_read_state */
  maxAdminRead: string | null
  maxClientRead: string | null
  /**
   * GROUP receipts (Batch 23 / S3-d §6): present for member-based rooms
   * (group/dm/channel/broadcast/crew), absent for client rooms. When present,
   * a message reads as "read" only when EVERY other live member's watermark
   * covers it — WhatsApp group semantics — instead of the two-side rule.
   */
  groupReads?: {
    memberIds: string[]
    readsBy: Map<string, string>
  }
}

export async function roomSides(
  db: SupabaseClient,
  opts: { roomId: string; orgId: string; clientId: string | null; kind?: string }
): Promise<RoomSides> {
  const memberBased = !!opts.kind && opts.kind !== 'client'
  const [{ data: oms, error: omErr }, { data: cms, error: cmErr }, { data: reads, error: rdErr }, seatsRes] =
    await Promise.all([
      db.from('organization_members').select('user_id')
        .eq('organization_id', opts.orgId).not('user_id', 'is', null),
      opts.clientId
        ? db.from('client_members').select('user_id')
            .eq('client_id', opts.clientId).not('user_id', 'is', null)
        : Promise.resolve({ data: [] as { user_id: string }[], error: null }),
      db.from('message_read_state').select('user_id, last_read_at')
        .eq('room_id', opts.roomId),
      memberBased
        ? db.from('room_members').select('user_id')
            .eq('room_id', opts.roomId).is('left_at', null)
        : Promise.resolve({ data: null, error: null }),
    ])
  if (omErr) throw new Error(`organization_members read failed: ${omErr.message}`)
  if (cmErr) throw new Error(`client_members read failed: ${cmErr.message}`)
  if (rdErr) throw new Error(`message_read_state read failed: ${rdErr.message}`)
  if (seatsRes.error) throw new Error(`room_members read failed: ${seatsRes.error.message}`)
  const orgUserIds = new Set((oms ?? []).map((r) => r.user_id as string))
  let clientUserIds = new Set((cms ?? []).map((r) => r.user_id as string))
  let maxAdminRead: string | null = null
  let maxClientRead: string | null = null
  const readsBy = new Map<string, string>()
  for (const r of reads ?? []) {
    const uid = r.user_id as string
    const at = r.last_read_at as string
    readsBy.set(uid, at)
    if (orgUserIds.has(uid)) {
      if (!maxAdminRead || at > maxAdminRead) maxAdminRead = at
    } else if (clientUserIds.has(uid)) {
      if (!maxClientRead || at > maxClientRead) maxClientRead = at
    }
  }
  if (!memberBased) return { orgUserIds, clientUserIds, maxAdminRead, maxClientRead }

  // Member-based room: the seats are the population. Non-crew members
  // classify client-side for rendering (name + left alignment), and the
  // receipt rule becomes every-other-member (S3-d §6).
  const memberIds = (seatsRes.data ?? []).map((r) => r.user_id as string)
  clientUserIds = new Set(memberIds.filter((id) => !orgUserIds.has(id)))
  return {
    orgUserIds, clientUserIds, maxAdminRead, maxClientRead,
    groupReads: { memberIds, readsBy },
  }
}

/**
 * Stamp the wire fields the dropped columns used to carry, so every
 * consumer downstream of a server read keeps working unchanged:
 *
 * - `sender_role` — the sender's side, from the roster (never the column,
 *   even while it still exists: the roster is the truth A-6 names).
 * - `read_at` — the OTHER side's newest watermark when it covers this
 *   message, else null. Per-person state feeding the same per-side tick
 *   the UI has always shown; a colleague's read never blues your tick.
 * - `attachment_url`/`attachment_file_id` — from the message_attachments
 *   FK through the verified files row (`bucket::path`), never the column.
 *
 * Realtime replication payloads bypass this (they are raw rows); their
 * consumers treat the fields as optional and the next fetch corrects them.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function deriveWire<T extends Record<string, any>>(rows: T[], sides: RoomSides): T[] {
  return rows.map((m) => {
    const senderId = m.sender_id as string | null
    const side: 'admin' | 'client' =
      senderId && sides.orgUserIds.has(senderId)
        ? 'admin'
        : senderId && sides.clientUserIds.has(senderId)
          ? 'client'
          : 'admin'
    let readAt: string | null
    if (sides.groupReads) {
      // Group rule (S3-d §6): blue only when EVERY other live member's
      // watermark covers this message; the tick's timestamp is the LAST of
      // them (the moment the room finished reading it).
      const others = sides.groupReads.memberIds.filter((id) => id !== senderId)
      let latest: string | null = null
      let all = others.length > 0
      for (const id of others) {
        const wm = sides.groupReads.readsBy.get(id)
        if (!wm || wm < (m.created_at as string)) { all = false; break }
        if (!latest || wm > latest) latest = wm
      }
      readAt = all ? latest : null
    } else {
      const otherMax = side === 'admin' ? sides.maxClientRead : sides.maxAdminRead
      readAt = otherMax && otherMax >= (m.created_at as string) ? otherMax : null
    }
    const att = Array.isArray(m.message_attachments) ? m.message_attachments[0] : null
    const f = att ? (Array.isArray(att.files) ? att.files[0] : att.files) : null
    return {
      ...m,
      sender_role: side,
      read_at: readAt,
      attachment_url: f ? `${f.bucket}::${f.file_path}` : null,
      attachment_file_id: att?.file_id ?? null,
    }
  })
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
  // Newest-first with a stated cap (Batch 21 item 1): a member who has never
  // opened the room has no watermark, so this scan is their whole visible
  // history — the cap turns that into saturation ("1000+") instead of
  // tripping PostgREST's silent row limit.
  const { data: msgs, error } = await q
    .order('created_at', { ascending: false })
    .limit(UNREAD_SCAN_CAP)
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

/** Unread for a studio user across every room of their org THAT THEY SIT IN.
 *  Member-scoped since the 0046 flip: the org owner is no longer entitled to
 *  a DM's contents (harness assertion 27), so their badge must not count it
 *  either — a count of rows you cannot open is a lie with a number on it. */
export async function orgUnread(
  db: SupabaseClient,
  opts: { userId: string; orgId: string }
): Promise<OrgUnread> {
  const [{ data: allRooms, error: roomErr }, { data: seats, error: seatErr }] = await Promise.all([
    db.from('message_rooms')
      .select('id, client_id')
      .eq('organization_id', opts.orgId)
      .is('deleted_at', null),
    db.from('room_members')
      .select('room_id')
      .eq('user_id', opts.userId)
      .is('left_at', null),
  ])
  if (roomErr) throw new Error(`message_rooms read failed: ${roomErr.message}`)
  if (seatErr) throw new Error(`room_members read failed: ${seatErr.message}`)
  const mine = new Set((seats ?? []).map((s) => s.room_id as string))
  const rooms = (allRooms ?? []).filter((r) => mine.has(r.id as string))
  if (!rooms?.length) return { total: 0, byProject: {}, generalByClient: {}, byClient: {} }

  const roomIds = rooms.map((r) => r.id)
  const wms = await watermarksFor(db, opts.userId, roomIds)
  const clientByRoom = new Map(rooms.map((r) => [r.id, r.client_id as string | null]))

  // The per-room watermark predicate runs IN the query now (Batch 21 item
  // 1): one `.or()` of per-room conjuncts — `created_at > watermark` where
  // one exists, the whole room where none does — so rows fetched ≈ rows
  // actually unread. The old shape fetched EVERY org message and filtered
  // in JS; its real ceiling was PostgREST's silent default row limit, so
  // past ~1000 org messages the badges quietly undercounted. The explicit
  // newest-first cap makes the remaining pathological case (huge unread
  // backlogs) a stated saturation instead.
  const roomPreds = roomIds.map((id) => {
    const wm = wms.get(id)
    return wm ? `and(room_id.eq.${id},created_at.gt.${wm})` : `room_id.eq.${id}`
  })
  const { data: msgs, error } = await db
    .from('messages')
    .select('id, room_id, project_id, sender_id, created_at')
    .eq('organization_id', opts.orgId)
    .is('deleted_at', null)
    .or(roomPreds.join(','))
    .order('created_at', { ascending: false })
    .limit(UNREAD_SCAN_CAP)
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

/**
 * Pre-sign every attachment on a page of wire rows.
 *
 * WHY THIS EXISTS. `deriveWire` puts `attachment_url` on the wire as a
 * `bucket::path` REFERENCE, which the browser then had to exchange for a
 * signed URL through `/api/{portal,admin}/messages/attachment` — one extra
 * round trip PER ATTACHMENT, fired after the list had already painted. So a
 * thread opened, the bubbles appeared, and then the images and video filled in
 * afterwards. That second wave is what makes a chat feel like it is still
 * loading when it has in fact finished.
 *
 * Signing here costs nothing worth measuring: R2 presigning is a local HMAC,
 * not a network call, and a page is 50 messages of which few carry files. The
 * per-attachment route stays for the lazy paths (thread panels, search
 * results, the pins list) — this removes the second wave from the ONE surface
 * where it was visible.
 *
 * Deduplicated by file id, so ten messages quoting one file sign it once.
 */
export async function signAttachments<T extends Record<string, any>>(
  db: SupabaseClient,
  rows: T[]
): Promise<T[]> {
  const fileIds = [...new Set(
    rows.map((m) => m.attachment_file_id as string | null).filter((v): v is string => !!v)
  )]
  if (fileIds.length === 0) return rows

  const { data: files } = await db
    .from('files').select('id, bucket, file_path').in('id', fileIds)
  if (!files?.length) return rows

  const signed = new Map<string, string>()
  await Promise.all(
    (files as { id: string; bucket: string; file_path: string }[]).map(async (f) => {
      try {
        const url = f.bucket === 'r2'
          ? await getSignedDownloadUrl(f.file_path, 3600, { disposition: 'inline' })
          : (await db.storage.from(f.bucket).createSignedUrl(f.file_path, 3600)).data?.signedUrl
        if (url) signed.set(f.id, url)
      } catch {
        // One unsignable file must not cost the whole page its media; the
        // client falls back to the per-attachment route for this one.
      }
    })
  )

  return rows.map((m) => {
    const id = m.attachment_file_id as string | null
    const url = id ? signed.get(id) : undefined
    return url ? { ...m, attachment_signed_url: url } : m
  })
}
