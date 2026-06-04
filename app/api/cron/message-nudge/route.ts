import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { notifyAwayRecipient } from '@/lib/notify'

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

async function runNudge() {
  const cutoff = new Date(Date.now() - NO_REPLY_MS).toISOString()

  // Oldest-first so the snippet we show is the first unanswered message.
  const { data: pending } = await supabaseAdmin
    .from('messages')
    .select('id, project_id, sender_role, sender_name, body, attachment_name')
    .is('read_at', null)
    .is('nudged_at', null)
    .eq('is_deleted', false)
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(500)

  if (!pending?.length) return { nudged: 0 }

  // Group unanswered messages by project + direction (sender role).
  const groups = new Map<string, { project_id: string; sender_role: string; ids: string[]; first: any; count: number }>()
  for (const m of pending) {
    if (!m.project_id) continue
    const key = `${m.project_id}:${m.sender_role}`
    const g = groups.get(key)
    if (g) { g.ids.push(m.id); g.count++ }
    else groups.set(key, { project_id: m.project_id, sender_role: m.sender_role, ids: [m.id], first: m, count: 1 })
  }

  let nudged = 0
  for (const g of groups.values()) {
    const recipient = g.sender_role === 'client' ? 'admin' : 'client'
    const snippet =
      (g.first.body && String(g.first.body).slice(0, 140)) ||
      (g.first.attachment_name ? `📎 ${g.first.attachment_name}` : 'New message')
    const who = g.sender_role === 'client' ? (g.first.sender_name || 'A client') : 'McPrime Digital'
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
      await supabaseAdmin.from('messages').update({ nudged_at: new Date().toISOString() }).in('id', g.ids)
      nudged++
    }
  }
  return { nudged }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
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
    const result = await runNudge()
    return NextResponse.json({ ok: true, ...result })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'error' }, { status: 500 })
  }
}
