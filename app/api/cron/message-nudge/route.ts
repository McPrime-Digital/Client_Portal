import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { userOrgId } from '@/lib/auth/role'
import { notifyAwayRecipient } from '@/lib/notify'
import { tenantBrand } from '@/lib/tenantBrand'

// "5 hours of no reply" message nudge. Active conversations never push; only
// when a message has gone unread for 5h AND the recipient is away do we send a
// SINGLE deferred alert (device/SMS/email per their prefs). Each unanswered
// batch is nudged at most once (messages.nudged_at).
//
// Triggered two ways (idempotent — dedup via nudged_at):
//   • GET  — Vercel Cron (daily; Hobby-plan safe), authorized by CRON_SECRET.
//   • POST — any signed-in user's app load — the active party's visit nudges the
//            away party, giving near-real-time coverage between cron runs.
const NO_REPLY_MS = 5 * 60 * 60 * 1000

/**
 * How often the APP-LOAD trigger may actually run the scan, per organization.
 *
 * PresencePulse fires POST once per mount, so before this the full scan — up
 * to 500 messages plus room and watermark joins, through the SERVICE ROLE —
 * ran on every page load by every authenticated user. The 5-hour window means
 * the overwhelming majority of those found nothing and were pure cost.
 *
 * Fifteen minutes preserves what the trigger exists for. The alternative
 * considered and rejected was deleting the POST half outright: it is the only
 * thing giving near-real-time coverage between once-daily Vercel crons, so
 * removing it turns a 5-hour nudge into as much as 29. A cost problem does not
 * justify a product regression.
 *
 * BEST-EFFORT BY CONSTRUCTION, and stated rather than implied: this map is
 * per-lambda-instance and resets on a cold start, so a scaled-out deployment
 * runs the scan once per instance per window rather than once globally. That
 * is a large reduction, not a guarantee — and a guarantee would need a table,
 * which is not worth a migration for a throttle. The scan is idempotent
 * (`nudged_at`), so an extra run costs work, never a duplicate alert.
 *
 * WHAT THIS DOES NOT FIX: the POST half is still a user-session path running
 * a service-role scan — HANDOFF §8.3 item 4, and the allowlist comment on this
 * file. That is structural and belongs to the S2 §7 write-path pass, where the
 * question is which client it should use, not how often it should run.
 */
const APP_TRIGGER_THROTTLE_MS = 15 * 60 * 1000
const lastAppTriggerByOrg = new Map<string, number>()

// `orgId` bounds the scan to one tenant. The cron (GET) passes nothing and
// sweeps every tenant, which is correct for a scheduled job — each group's
// recipients are then resolved per-tenant downstream by notifyAwayRecipient →
// orgForRecipient, and admin device push is bounded by sendPushToAdmins(orgId).
// The app-load trigger (POST) passes the CALLER's org: without it, any signed-in
// user of any tenant fired a product-wide scan that could send another studio's
// mail and SMS.
async function runNudge(orgId?: string) {
  const cutoff = new Date(Date.now() - NO_REPLY_MS).toISOString()

  // NEWEST-first (Batch 21 item 3): the scan used to prefilter on the
  // legacy `read_at` column, which is what kept already-read rows out of
  // the window — with that column retired, an oldest-first window would
  // fill permanently with old fully-read messages and new unread ones
  // would never be scanned. Newest-first guarantees fresh unread always
  // enters; nudged_at drains the rest. The per-user watermark refine below
  // is, as it was, the real filter.
  let q = supabaseAdmin
    .from('messages')
    .select('id, room_id, project_id, organization_id, sender_id, sender_name, body, attachment_name, created_at')
    .is('nudged_at', null)
    .is('deleted_at', null)
    .lt('created_at', cutoff)
  if (orgId) q = q.eq('organization_id', orgId)
  const { data: scanned } = await q
    .order('created_at', { ascending: false })
    .limit(500)

  if (!scanned?.length) return { nudged: 0 }

  // Per-USER unread (Batch 14, A-7; sole authority since Batch 21 item 3):
  // a message only nudges while SOMEONE on the recipient side still has it
  // past their watermark (no watermark row = everything unread).
  const roomIds = [...new Set(scanned.map((m) => m.room_id).filter(Boolean))]
  const [{ data: rooms }, { data: readStates }] = await Promise.all([
    supabaseAdmin.from('message_rooms')
      .select('id, client_id, organization_id')
      .in('id', roomIds),
    supabaseAdmin.from('message_read_state')
      .select('room_id, user_id, last_read_at')
      .in('room_id', roomIds),
  ])
  const roomById = new Map((rooms ?? []).map((r) => [r.id, r]))
  const clientIds = [...new Set((rooms ?? []).map((r) => r.client_id).filter(Boolean))] as string[]
  const roomOrgIds = [...new Set((rooms ?? []).map((r) => r.organization_id).filter(Boolean))] as string[]
  const [{ data: clientMembers }, { data: orgMembers }] = await Promise.all([
    clientIds.length
      ? supabaseAdmin.from('client_members')
          .select('client_id, user_id')
          .in('client_id', clientIds).eq('status', 'active').not('user_id', 'is', null)
      : Promise.resolve({ data: [] as { client_id: string; user_id: string }[] }),
    roomOrgIds.length
      ? supabaseAdmin.from('organization_members')
          .select('organization_id, user_id')
          .in('organization_id', roomOrgIds).eq('status', 'active').not('user_id', 'is', null)
      : Promise.resolve({ data: [] as { organization_id: string; user_id: string }[] }),
  ])
  const wmByRoomUser = new Map((readStates ?? []).map((s) => [`${s.room_id}:${s.user_id}`, s.last_read_at]))
  const clientUsersByClient = new Map<string, string[]>()
  for (const cm of clientMembers ?? []) {
    const arr = clientUsersByClient.get(cm.client_id) ?? []
    arr.push(cm.user_id); clientUsersByClient.set(cm.client_id, arr)
  }
  const orgUsersByOrg = new Map<string, string[]>()
  for (const om of orgMembers ?? []) {
    const arr = orgUsersByOrg.get(om.organization_id) ?? []
    arr.push(om.user_id); orgUsersByOrg.set(om.organization_id, arr)
  }

  // The sender's SIDE derives from the roster now (Batch 21 item 3 —
  // sender_role is retired): an org member is studio-side, a client member
  // client-side, and a null/rosterless sender speaks with the studio's
  // voice (that is what every null-sender row is: system messages, plus
  // AD-003-erased senders).
  const sideOf = (m: { sender_id: string | null; room_id: string | null }): 'admin' | 'client' => {
    const room = m.room_id ? roomById.get(m.room_id) : null
    if (!m.sender_id || !room) return 'admin'
    if ((orgUsersByOrg.get(room.organization_id) ?? []).includes(m.sender_id)) return 'admin'
    if (room.client_id && (clientUsersByClient.get(room.client_id) ?? []).includes(m.sender_id)) return 'client'
    return 'admin'
  }

  const pending = scanned.filter((m) => {
    const room = m.room_id ? roomById.get(m.room_id) : null
    if (!room) return false
    const recipients = sideOf(m) === 'client'
      ? orgUsersByOrg.get(room.organization_id) ?? []
      : (room.client_id ? clientUsersByClient.get(room.client_id) ?? [] : [])
    return recipients.some((uid) => {
      const wm = wmByRoomUser.get(`${m.room_id}:${uid}`)
      return !wm || wm < m.created_at
    })
  })

  if (!pending.length) return { nudged: 0 }

  // The studio's name per tenant, resolved once each. The GET sweep crosses
  // every tenant, so a single hardcoded name here signed one company's nudges
  // with another's — S-V §X-6's exact failure, on the one path that fans out
  // across the whole product.
  const studioNames = new Map<string, string>()
  async function studioNameFor(orgId: string | null | undefined): Promise<string> {
    if (!orgId) return 'Your studio'
    const hit = studioNames.get(orgId)
    if (hit) return hit
    const name = (await tenantBrand(orgId)).name
    studioNames.set(orgId, name)
    return name
  }

  // Group unanswered messages by ROOM + direction (Batch 14 item 3.4 — the
  // old project_id grouping skipped untagged messages entirely, and the room
  // is the conversation now). The first tagged message's project supplies the
  // deep link; an all-untagged group links via the company instead.
  const groups = new Map<string, { room_id: string; client_id: string | null; project_id: string | null; organization_id: string | null; sender_side: 'admin' | 'client'; ids: string[]; first: { sender_name: string | null; body: string | null; attachment_name: string | null }; count: number }>()
  for (const m of pending) {
    if (!m.room_id) continue
    const side = sideOf(m)
    const key = `${m.room_id}:${side}`
    const g = groups.get(key)
    if (g) {
      g.ids.push(m.id); g.count++
      if (!g.project_id && m.project_id) g.project_id = m.project_id
      // The scan is newest-first; the snippet should be the FIRST unanswered
      // message, so the last row seen in a group is the one to keep.
      g.first = m
    } else {
      groups.set(key, {
        room_id: m.room_id,
        client_id: roomById.get(m.room_id)?.client_id ?? null,
        project_id: m.project_id ?? null,
        organization_id: m.organization_id ?? null,
        sender_side: side, ids: [m.id], first: m, count: 1,
      })
    }
  }

  let nudged = 0
  for (const g of groups.values()) {
    const recipient = g.sender_side === 'client' ? 'admin' : 'client'
    const snippet =
      (g.first.body && String(g.first.body).slice(0, 140)) ||
      (g.first.attachment_name ? `📎 ${g.first.attachment_name}` : 'New message')
    const who = g.sender_side === 'client'
      ? (g.first.sender_name || 'A client')
      : await studioNameFor(g.organization_id)
    const title =
      g.count > 1
        ? `${g.count} unread messages from ${who}`
        : `Unread message from ${who}`

    // notifyAwayRecipient returns true only when the recipient is away (so an
    // active recipient is left alone and re-evaluated on the next run).
    const wasAway = await notifyAwayRecipient({
      recipient,
      projectId: g.project_id,
      clientId: g.client_id, // resolves the recipients when the group is all-untagged
      category: 'messages',
      title,
      body: snippet,
    })

    if (wasAway) {
      // g.ids came from the scan above, so they are already tenant-bounded when
      // orgId was supplied; the predicate is repeated so the write cannot widen.
      let upd = supabaseAdmin.from('messages').update({ nudged_at: new Date().toISOString() }).in('id', g.ids)
      if (orgId) upd = upd.eq('organization_id', orgId)
      await upd
      nudged++
    }
  }
  return { nudged }
}

export async function GET(req: NextRequest) {
  // FAIL CLOSED. This was `if (secret) { ...check... }`, so an unset
  // CRON_SECRET meant no check at all and the endpoint was open to anyone who
  // knew the path — it reads every client's message history and can send mail
  // and SMS on the studio's behalf. A missing secret is a misconfiguration to
  // report, never a reason to skip authorization (I-8).
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[cron/message-nudge] CRON_SECRET is not set; refusing to run.')
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured on this deployment. Set it before the cron can run.' },
      { status: 500 }
    )
  }
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await runNudge()
    return NextResponse.json({ ok: true, ...result })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'error' }, { status: 500 })
  }
}

// App-load trigger — any authenticated user can run the (idempotent) scan.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    // Scoped to the caller's own tenant, resolved from the verified session.
    const orgId = userOrgId(user)

    // Throttled per organization. Without this the full service-role scan ran
    // on EVERY page load by EVERY user; the 5-hour window means almost all of
    // those found nothing. Returning early is honest about having skipped —
    // `throttled: true` rather than a fake zero, so a caller reading the
    // response cannot mistake "not scanned" for "nothing to nudge".
    const last = lastAppTriggerByOrg.get(orgId) ?? 0
    if (Date.now() - last < APP_TRIGGER_THROTTLE_MS) {
      return NextResponse.json({ ok: true, throttled: true, nudged: 0 })
    }
    lastAppTriggerByOrg.set(orgId, Date.now())

    const result = await runNudge(orgId)
    return NextResponse.json({ ok: true, throttled: false, ...result })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'error' }, { status: 500 })
  }
}
