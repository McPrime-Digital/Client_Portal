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

// `orgId` bounds the scan to one tenant. The cron (GET) passes nothing and
// sweeps every tenant, which is correct for a scheduled job — each group's
// recipients are then resolved per-tenant downstream by notifyAwayRecipient →
// orgForRecipient, and admin device push is bounded by sendPushToAdmins(orgId).
// The app-load trigger (POST) passes the CALLER's org: without it, any signed-in
// user of any tenant fired a product-wide scan that could send another studio's
// mail and SMS.
async function runNudge(orgId?: string) {
  const cutoff = new Date(Date.now() - NO_REPLY_MS).toISOString()

  // Oldest-first so the snippet we show is the first unanswered message.
  let q = supabaseAdmin
    .from('messages')
    .select('id, project_id, organization_id, sender_role, sender_name, body, attachment_name')
    .is('read_at', null)
    .is('nudged_at', null)
    .eq('is_deleted', false)
    .lt('created_at', cutoff)
  if (orgId) q = q.eq('organization_id', orgId)
  const { data: pending } = await q
    .order('created_at', { ascending: true })
    .limit(500)

  if (!pending?.length) return { nudged: 0 }

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

  // Group unanswered messages by project + direction (sender role).
  const groups = new Map<string, { project_id: string; organization_id: string | null; sender_role: string; ids: string[]; first: any; count: number }>()
  for (const m of pending) {
    if (!m.project_id) continue
    const key = `${m.project_id}:${m.sender_role}`
    const g = groups.get(key)
    if (g) { g.ids.push(m.id); g.count++ }
    else groups.set(key, { project_id: m.project_id, organization_id: m.organization_id ?? null, sender_role: m.sender_role, ids: [m.id], first: m, count: 1 })
  }

  let nudged = 0
  for (const g of groups.values()) {
    const recipient = g.sender_role === 'client' ? 'admin' : 'client'
    const snippet =
      (g.first.body && String(g.first.body).slice(0, 140)) ||
      (g.first.attachment_name ? `📎 ${g.first.attachment_name}` : 'New message')
    const who = g.sender_role === 'client'
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
    const result = await runNudge(userOrgId(user))
    return NextResponse.json({ ok: true, ...result })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'error' }, { status: 500 })
  }
}
