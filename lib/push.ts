import 'server-only'

import webpush from 'web-push'
import { supabaseAdmin } from '@/lib/supabase/admin'

// Server-side Web Push sender. Configured lazily from env so the app boots
// fine without VAPID keys (push simply no-ops until they're set):
//   VAPID_PUBLIC_KEY (or NEXT_PUBLIC_VAPID_PUBLIC_KEY), VAPID_PRIVATE_KEY,
//   VAPID_SUBJECT (a mailto: or https: contact).
let configured: boolean | null = null

function ensureConfigured(): boolean {
  if (configured !== null) return configured
  const pub = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || 'mailto:notifications@mcprime.digital'
  if (!pub || !priv) {
    configured = false
    return false
  }
  try {
    webpush.setVapidDetails(subject, pub, priv)
    configured = true
  } catch {
    configured = false
  }
  return configured
}

export type PushPayload = { title: string; body?: string; url?: string; tag?: string }

// Send a push to every registered device for the given matcher. Expired
// subscriptions (404/410) are pruned automatically. Never throws.
async function sendToSubscriptions(
  match: (q: any) => any,
  payload: PushPayload
): Promise<void> {
  if (!ensureConfigured()) return
  try {
    const { data: subs } = await match(
      supabaseAdmin.from('push_subscriptions').select('id, subscription')
    )
    if (!subs?.length) return
    const body = JSON.stringify(payload)
    await Promise.all(
      subs.map(async (row: { id: string; subscription: any }) => {
        try {
          await webpush.sendNotification(row.subscription, body)
        } catch (e: any) {
          if (e?.statusCode === 404 || e?.statusCode === 410) {
            await supabaseAdmin.from('push_subscriptions').delete().eq('id', row.id)
          }
        }
      })
    )
  } catch {
    // best-effort
  }
}

// Push to a specific authenticated user (clients).
export async function sendPushToUser(userId: string | null | undefined, payload: PushPayload): Promise<void> {
  if (!userId) return
  await sendToSubscriptions((q) => q.eq('user_id', userId), payload)
}

// Push to one tenant's admin devices.
//
// Was `q.eq('role','admin')` alone, which reached EVERY admin device in the
// product: a message on one studio's project buzzed every other studio's
// phones, with the project title in the notification body.
//
// push_subscriptions carries no organization_id and no FK to clients (S2 §4
// lists it as permanently service-role-only for exactly that reason), so the
// tenant boundary is resolved through organization_members and the send is
// bounded by that crew's user ids.
export async function sendPushToAdmins(
  orgId: string | null | undefined,
  payload: PushPayload
): Promise<void> {
  // No org → send nothing. A push that cannot be attributed to a tenant is the
  // bug this function exists to fix, so it fails closed.
  if (!orgId) return
  const { data: crew } = await supabaseAdmin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', orgId)
    .eq('status', 'active')
  const ids = (crew ?? []).map((r) => r.user_id).filter((v): v is string => !!v)
  if (!ids.length) return
  await sendToSubscriptions((q) => q.eq('role', 'admin').in('user_id', ids), payload)
}