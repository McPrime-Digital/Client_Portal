import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendPushToUser, sendPushToAdmins } from '@/lib/push'
import { sendSms } from '@/lib/sms'

// Server-only notification helpers. createNotification/createAdminNotification
// write the in-app bell row AND escalate to external channels (device push, SMS,
// email) when the recipient is away — honoring per-category preferences.
export type NotificationType =
  | 'message'
  | 'file_delivered'
  | 'status_change'
  | 'invoice_created'
  | 'task_updated'

// Maps a bell notification type → preference category (used for the per-channel
// notification preferences).
export type NotifyCategory = 'messages' | 'tasks' | 'files' | 'status' | 'invoices'

const TYPE_CATEGORY: Record<NotificationType, NotifyCategory> = {
  message: 'messages',
  file_delivered: 'files',
  status_change: 'status',
  invoice_created: 'invoices',
  task_updated: 'tasks',
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || ''

export async function createNotification(opts: {
  clientId: string | null | undefined
  projectId?: string | null
  type: NotificationType
  title: string
  body?: string | null
}): Promise<void> {
  if (!opts.clientId) return
  try {
    await supabaseAdmin.from('notifications').insert({
      client_id: opts.clientId,
      project_id: opts.projectId ?? null,
      type: opts.type,
      title: opts.title,
      body: opts.body ?? null,
    })
  } catch {
    // in-app insert is best-effort
  }
  // Escalate to the client's device/phone/email when they're away.
  await notifyAwayRecipient({
    recipient: 'client',
    clientId: opts.clientId,
    projectId: opts.projectId ?? null,
    category: TYPE_CATEGORY[opts.type],
    title: opts.title,
    body: opts.body ?? null,
  })
}

// Admin-facing notification (shows in the admin bell + escalates to admin
// devices/email when away).
export async function createAdminNotification(opts: {
  clientId: string | null | undefined
  projectId?: string | null
  type: NotificationType
  title: string
  body?: string | null
}): Promise<void> {
  try {
    await supabaseAdmin.from('notifications').insert({
      client_id: opts.clientId ?? null,
      project_id: opts.projectId ?? null,
      type: opts.type,
      title: opts.title,
      body: opts.body ?? null,
      for_admin: true,
    })
  } catch {
    // best-effort
  }
  await notifyAwayRecipient({
    recipient: 'admin',
    projectId: opts.projectId ?? null,
    category: TYPE_CATEGORY[opts.type],
    title: opts.title,
    body: opts.body ?? null,
  })
}

// Resolve a project's client_id (used by event sources that only have a
// project_id, e.g. messages/tasks).
export async function clientIdForProject(projectId: string | null | undefined): Promise<string | null> {
  if (!projectId) return null
  const { data } = await supabaseAdmin
    .from('projects')
    .select('client_id')
    .eq('id', projectId)
    .single()
  return data?.client_id ?? null
}

// ── Deferred ("away") alerts ────────────────────────────────────────────────
// Consider a user "in the app" if their heartbeat fired within this window
// (PresencePulse beats every 30s). Anyone past it is away → escalate.
const AWAY_MS = 90_000

type Channels = { inApp?: boolean; push?: boolean; sms?: boolean; email?: boolean }
type PrefMap = Partial<Record<NotifyCategory, Channels>>

function awayFrom(lastSeen: string | null | undefined): boolean {
  if (!lastSeen) return true // never seen / column absent → treat as away
  return Date.now() - new Date(lastSeen).getTime() > AWAY_MS
}

// Where a notification should take the recipient when tapped.
function deepLink(recipient: 'admin' | 'client', category: NotifyCategory, projectId?: string | null): string {
  const base = recipient === 'admin' ? '/admin' : ''
  let path = '/dashboard'
  if (category === 'messages') path = recipient === 'admin' ? '/admin/messages' : '/messages'
  else if (category === 'invoices') path = recipient === 'admin' ? '/admin/invoices' : '/invoices'
  else if (projectId) path = recipient === 'admin' ? `/admin/projects/${projectId}` : `/projects/${projectId}`
  else path = recipient === 'admin' ? '/admin' : '/dashboard'
  return APP_URL ? `${APP_URL}${path}` : path
}

async function sendEmailAlert(to: string, subject: string, text: string): Promise<void> {
  const key = process.env.RESEND_API_KEY
  const from = process.env.NOTIFY_FROM_EMAIL
  if (!key || !from || !to) return
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, text }),
    })
  } catch {
    // best-effort
  }
}

type RecipientState = {
  email: string | null
  phone: string | null
  userId: string | null
  lastSeen: string | null | undefined
  prefs: PrefMap
}

// Resolve a recipient's contact details, last-seen heartbeat and per-category
// channel preferences. Shared by every "away" escalation path.
async function resolveRecipientState(
  recipient: 'admin' | 'client',
  projectId?: string | null,
  clientId?: string | null
): Promise<RecipientState | null> {
  if (recipient === 'client') {
    const cid = clientId ?? (await clientIdForProject(projectId))
    if (!cid) return null
    const { data } = await supabaseAdmin
      .from('clients')
      .select('user_id, email, phone, last_seen_at, notification_prefs')
      .eq('id', cid)
      .single()
    return {
      email: data?.email ?? null,
      phone: (data as any)?.phone ?? null,
      userId: (data as any)?.user_id ?? null,
      lastSeen: (data as any)?.last_seen_at,
      prefs: ((data as any)?.notification_prefs ?? {}) as PrefMap,
    }
  }
  const { data } = await supabaseAdmin
    .from('business_settings')
    .select('business_email, admin_last_seen_at, notification_prefs')
    .limit(1)
    .single()
  return {
    email: (data as any)?.business_email ?? null,
    phone: null,
    userId: null,
    lastSeen: (data as any)?.admin_last_seen_at,
    prefs: ((data as any)?.notification_prefs ?? {}) as PrefMap,
  }
}

// Immediate, per-message device push for a new chat message — fired on send.
// Pushes ONLY when the recipient is away (no recent heartbeat → app not open or
// backgrounded); an active, in-app recipient is never pushed because they see
// the message live. Email/SMS are intentionally left to the 5h nudge cron so a
// live conversation never spams those channels per message. Best-effort.
export async function pushMessageAlert(opts: {
  recipient: 'admin' | 'client'
  projectId: string
  senderName: string
  preview: string
}): Promise<void> {
  try {
    const state = await resolveRecipientState(opts.recipient, opts.projectId)
    if (!state) return
    // In the app right now → they'll see it live; don't push.
    if (!awayFrom(state.lastSeen)) return
    const ch = state.prefs['messages'] ?? {}
    if (ch.push === false) return // push opted out for messages

    const url = deepLink(opts.recipient, 'messages', opts.projectId)
    const payload = {
      title: `New message from ${opts.senderName}`,
      body: opts.preview || undefined,
      url,
      tag: 'messages',
    }
    if (opts.recipient === 'admin') await sendPushToAdmins(payload)
    else await sendPushToUser(state.userId, payload)
  } catch {
    // never block the triggering send
  }
}

// Escalate an alert to a recipient's preferred channels when they're away.
// Channels: device push → mobile SMS → email. Entirely best-effort.
// Returns true if the recipient was away (escalation attempted) — the message
// nudge cron uses this to know when to mark a thread as nudged.
export async function notifyAwayRecipient(opts: {
  recipient: 'admin' | 'client'
  projectId?: string | null
  clientId?: string | null
  category: NotifyCategory
  title: string
  body?: string | null
}): Promise<boolean> {
  try {
    const state = await resolveRecipientState(opts.recipient, opts.projectId, opts.clientId)
    if (!state) return false
    const { email, phone, userId, lastSeen, prefs } = state

    // Only escalate when the recipient is actually away.
    if (!awayFrom(lastSeen)) return false

    const ch = prefs[opts.category] ?? {}
    const subject = opts.title
    const text = opts.body ? `${opts.title}\n\n${opts.body}` : opts.title
    const url = deepLink(opts.recipient, opts.category, opts.projectId)

    // Default ON for push + email when unset; SMS off by default (needs a number).
    const wantPush = ch.push !== false
    const wantSms = ch.sms === true
    const wantEmail = ch.email !== false

    await Promise.all([
      wantPush
        ? opts.recipient === 'admin'
          ? sendPushToAdmins({ title: opts.title, body: opts.body ?? undefined, url, tag: opts.category })
          : sendPushToUser(userId, { title: opts.title, body: opts.body ?? undefined, url, tag: opts.category })
        : Promise.resolve(),
      wantSms && phone ? sendSms(phone, text) : Promise.resolve(),
      wantEmail && email ? sendEmailAlert(email, subject, text) : Promise.resolve(),
    ])
    return true
  } catch {
    // Deferred alerts must never block the triggering action.
    return false
  }
}
