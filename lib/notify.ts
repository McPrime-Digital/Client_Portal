import { supabaseAdmin } from '@/lib/supabase/admin'

// Server-only helper to create a client-facing notification. The bell
// (components/portal/NotificationBell.tsx + useNotifications) reads these.
// Types must match the bell's icon/colour maps.
export type NotificationType =
  | 'message'
  | 'file_delivered'
  | 'status_change'
  | 'invoice_created'
  | 'task_updated'

// Maps a notification type to the client's onboarding preference key.
const PREF_KEY: Record<NotificationType, string> = {
  message: 'messages',
  file_delivered: 'files',
  status_change: 'status',
  invoice_created: 'invoices',
  task_updated: 'status',
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
    // Respect the client's notification preferences (set in onboarding).
    // Only an explicit `false` suppresses; absent/unset prefs notify.
    const { data: c } = await supabaseAdmin
      .from('clients')
      .select('notification_prefs')
      .eq('id', opts.clientId)
      .single()
    const prefs = (c?.notification_prefs ?? {}) as Record<string, boolean>
    if (prefs[PREF_KEY[opts.type]] === false) return

    await supabaseAdmin.from('notifications').insert({
      client_id: opts.clientId,
      project_id: opts.projectId ?? null,
      type: opts.type,
      title: opts.title,
      body: opts.body ?? null,
    })
  } catch {
    // Notifications are best-effort — never block the triggering action.
  }
}

// Admin-facing notification (shows in the admin bell). Always carries the
// related client_id (the notifications table is client-keyed) plus
// for_admin=true so the admin stream can be queried separately.
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
