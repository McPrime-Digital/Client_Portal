import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/admin'
import { getBusinessSettings } from '@/lib/businessSettings'
import { DEFAULT_ORG_ID } from '@/lib/auth/role'
import { appOriginOrNull } from '@/lib/appOrigin'
import { tenantBrand } from '@/lib/tenantBrand'
import { sendPushToUser, sendPushToAdmins } from '@/lib/push'
import { sendSms } from '@/lib/sms'
import { captureError } from '@/lib/errors'

// Server-only notification helpers. createNotification/createAdminNotification
// write the in-app bell row AND escalate to external channels (device push, SMS,
// email) when the recipient is away — honoring per-category preferences.
export type NotificationType =
  | 'message'
  | 'file_delivered'
  | 'status_change'
  | 'invoice_created'
  | 'task_updated'
  | 'member_invited'
  | 'member_invite_pending'

// Maps a bell notification type → preference category (used for the per-channel
// notification preferences).
export type NotifyCategory = 'messages' | 'tasks' | 'files' | 'status' | 'invoices'

const TYPE_CATEGORY: Record<NotificationType, NotifyCategory> = {
  message: 'messages',
  file_delivered: 'files',
  status_change: 'status',
  invoice_created: 'invoices',
  task_updated: 'tasks',
  member_invited: 'status',
  member_invite_pending: 'status',
}


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
      // Stamped, not defaulted (T-5). The column DEFAULT is McPrime's org, so
      // an unstamped insert files a second tenant's alert into tenant zero —
      // where it then renders in McPrime's now-org-filtered bell.
      organization_id: await orgForRecipient(opts.projectId, opts.clientId),
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
      // Stamped, not defaulted (T-5) — see createNotification above.
      organization_id: await orgForRecipient(opts.projectId, opts.clientId),
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
  // Resolved per call, not captured at import (I-11). Origin-relative is a
  // correct answer here and not a degraded one: this string only ever becomes
  // a push payload's `url`, which public/sw.js hands to openWindow() inside a
  // service worker that already has the origin. Nothing in this module puts a
  // link in an email body — if that changes, this needs appUrl(), which throws.
  const origin = appOriginOrNull()
  return origin ? `${origin}${path}` : path
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
  // Which tenant this alert belongs to. Carried on the state so the org is
  // resolved once per escalation and sendPushToAdmins can be bounded by it.
  orgId: string | null
}

// Which tenant's studio inbox an admin-side alert belongs to. business_settings
// is per-tenant since 0018 (T-3), so the row can no longer be picked with
// .limit(1) — it is resolved from the client company that owns the work.
async function orgForRecipient(
  projectId?: string | null,
  clientId?: string | null
): Promise<string> {
  const cid = clientId ?? (await clientIdForProject(projectId))
  if (cid) {
    const { data } = await supabaseAdmin
      .from('clients')
      .select('organization_id')
      .eq('id', cid)
      .single()
    if (data?.organization_id) return data.organization_id as string
  }
  return DEFAULT_ORG_ID
}

// Every active member of a client company who may see this notification.
//
// THIS IS A FAN-OUT, NOT A COLUMN SWAP. The previous shape read one row —
// `clients.select('user_id, email, phone, last_seen_at, …')` — so the recipient
// was always the company's primary login. Since Batch 6.8 a client company is a
// roster (S1 §5.2), and an invited teammate got no push and no email at all
// while the escalation ladder fired at the billing contact instead. Both are
// defects being fixed here, not behaviour being preserved.
//
// PROJECT SCOPE IS RESPECTED. A member with scope_mode 'selected' is included
// only when client_member_projects links them to this project — scope is
// STATED, not inferred (0018 A5), so 'selected' with no rows means no projects,
// not all of them. A company-level alert (projectId null, e.g. an invoice) goes
// to everyone active.
//
// WHAT STAYS COMPANY-LEVEL, and why that is not a shortcut: `phone` and
// `notification_prefs` live on `clients` and have no per-member equivalent on
// the roster. The phone is the COMPANY's one number, so SMS is deduped by
// number below rather than sent once per member. Per-member phone and
// preferences are roster-schema work and belong to S3.
async function resolveClientRecipients(
  cid: string,
  projectId?: string | null
): Promise<RecipientState[]> {
  const { data: company } = await supabaseAdmin
    .from('clients')
    .select('phone, notification_prefs, organization_id')
    .eq('id', cid)
    .maybeSingle()
  const co = company as {
    phone?: string | null
    notification_prefs?: PrefMap | null
    organization_id?: string | null
  } | null

  const { data: members, error } = await supabaseAdmin
    .from('client_members')
    .select('id, user_id, email, last_seen_at, scope_mode, organization_id')
    .eq('client_id', cid)
    .eq('status', 'active')
  if (error) {
    // Resolving to an empty set silently cancels every client notification, so
    // this must reach the sink (I-10). The expected cause is 42703 —
    // last_seen_at missing because 0025 has not been applied yet. See the
    // deploy-order note in that file.
    captureError(new Error(`client recipients read failed: ${error.message}`), {
      where: 'resolveClientRecipients', clientId: cid, projectId: projectId ?? null,
    })
    return []
  }

  type Row = {
    id: string
    user_id: string | null
    email: string | null
    last_seen_at: string | null
    scope_mode: string | null
    organization_id: string | null
  }
  let rows = (members ?? []) as Row[]

  if (projectId) {
    const scoped = rows.filter((m) => m.scope_mode === 'selected')
    if (scoped.length > 0) {
      const { data: links } = await supabaseAdmin
        .from('client_member_projects')
        .select('member_id')
        .eq('project_id', projectId)
        .in('member_id', scoped.map((m) => m.id))
      const allowed = new Set((links ?? []).map((l) => l.member_id as string))
      rows = rows.filter((m) => m.scope_mode !== 'selected' || allowed.has(m.id))
    }
  }

  return rows.map((m) => ({
    email: m.email ?? null,
    phone: co?.phone ?? null,
    userId: m.user_id ?? null,
    lastSeen: m.last_seen_at,
    prefs: co?.notification_prefs ?? {},
    orgId: co?.organization_id ?? m.organization_id ?? null,
  }))
}

// Resolve the recipients' contact details, last-seen heartbeat and per-category
// channel preferences. Shared by every "away" escalation path. The admin side
// is one studio inbox and stays a single entry; the client side fans out.
async function resolveRecipients(
  recipient: 'admin' | 'client',
  projectId?: string | null,
  clientId?: string | null
): Promise<RecipientState[]> {
  if (recipient === 'client') {
    const cid = clientId ?? (await clientIdForProject(projectId))
    if (!cid) return []
    return resolveClientRecipients(cid, projectId)
  }
  const orgId = await orgForRecipient(projectId, clientId)
  const data = await getBusinessSettings(orgId)
  return [{
    email: data?.business_email ?? null,
    phone: null,
    userId: null,
    lastSeen: data?.admin_last_seen_at,
    prefs: (data?.notification_prefs ?? {}) as PrefMap,
    orgId,
  }]
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
    const states = await resolveRecipients(opts.recipient, opts.projectId)
    if (states.length === 0) return

    const url = deepLink(opts.recipient, 'messages', opts.projectId)
    // The sending studio's logo rides along, so the lock screen shows the
    // tenant the recipient actually works with (S-V §X-6). One resolve for the
    // whole fan-out — every recipient of this alert shares its tenant.
    const icon = (await tenantBrand(states[0]?.orgId)).logoUrl ?? undefined
    const payload = {
      title: `New message from ${opts.senderName}`,
      body: opts.preview || undefined,
      url,
      icon,
      tag: 'messages',
    }
    // Per recipient, because presence is per recipient: a teammate reading the
    // thread is not pushed, and one sitting in the app no longer decides for
    // the rest of the company.
    await Promise.all(states.map(async (state) => {
      if (!awayFrom(state.lastSeen)) return
      if ((state.prefs['messages'] ?? {}).push === false) return
      if (opts.recipient === 'admin') await sendPushToAdmins(state.orgId, payload)
      else await sendPushToUser(state.userId, payload)
    }))
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
    const states = await resolveRecipients(opts.recipient, opts.projectId, opts.clientId)
    if (states.length === 0) return false

    // Only escalate to recipients who are actually away. An empty set here is
    // the good case: everyone entitled to this alert is looking at it.
    const away = states.filter((s) => awayFrom(s.lastSeen))
    if (away.length === 0) return false

    const subject = opts.title
    const text = opts.body ? `${opts.title}\n\n${opts.body}` : opts.title
    const url = deepLink(opts.recipient, opts.category, opts.projectId)
    const icon = (await tenantBrand(away[0]?.orgId)).logoUrl ?? undefined
    const push = { title: opts.title, body: opts.body ?? undefined, url, icon, tag: opts.category }

    // The X-6 ladder is unchanged — in-app → push → email → SMS, same payload,
    // same per-category preferences. What changed is that it now runs once per
    // away recipient instead of once per company.
    //
    // Email and SMS are deduped by destination. SMS especially: `phone` is the
    // COMPANY's number on every member's state, so fanning it out unguarded
    // would text one handset once per teammate.
    const sentEmail = new Set<string>()
    const sentSms = new Set<string>()
    const sends: Promise<unknown>[] = []

    for (const { email, phone, userId, prefs, orgId } of away) {
      const ch = prefs[opts.category] ?? {}
      // Default ON for push + email when unset; SMS off by default (needs a number).
      if (ch.push !== false) {
        sends.push(
          opts.recipient === 'admin'
            ? sendPushToAdmins(orgId, push)
            : sendPushToUser(userId, push)
        )
      }
      if (ch.email !== false && email && !sentEmail.has(email)) {
        sentEmail.add(email)
        sends.push(sendEmailAlert(email, subject, text))
      }
      if (ch.sms === true && phone && !sentSms.has(phone)) {
        sentSms.add(phone)
        sends.push(sendSms(phone, text, orgId))
      }
    }

    await Promise.all(sends)
    // True means "at least one entitled recipient was away", which is exactly
    // what the message-nudge cron uses it for: mark the thread nudged, and
    // leave it alone when everyone is present.
    return true
  } catch {
    // Deferred alerts must never block the triggering action.
    return false
  }
}