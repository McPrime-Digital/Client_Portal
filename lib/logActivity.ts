/**
 * logActivity — fire-and-forget activity log helper.
 *
 * Calls the `log_activity` RPC on Supabase.
 * If the activity_log table / function doesn't exist yet,
 * the error is silently swallowed so it never crashes the caller.
 *
 * Usage:
 *   import { logActivity } from '@/lib/logActivity'
 *   await logActivity({ eventType: 'file_uploaded', title: '...', actorId, actorName, actorRole })
 */

type EventType =
  | 'project_created'
  | 'project_status_changed'
  | 'file_uploaded'
  | 'file_deleted'
  | 'message_sent'
  | 'task_completed'
  | 'task_created'
  | 'invoice_created'
  | 'invoice_paid'
  | 'client_created'
  | 'note_added'
  // Approvals & Records ledger events.
  | 'approval_requested'
  | 'task_approved'
  | 'changes_requested'
  | 'task_auto_approved'

type ActivityParams = {
  projectId?: string | null
  clientId?: string | null
  actorId: string
  actorName: string
  actorRole: 'admin' | 'client'
  eventType: EventType
  title: string
  body?: string | null
  meta?: Record<string, any>
}

export async function logActivity(params: ActivityParams): Promise<void> {
  try {
    // Route through the server so the service role does the insert — the
    // browser cannot write activity_log directly (RLS blocks it). The actor
    // is derived from the session server-side, so actor* here is advisory.
    await fetch('/api/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: params.projectId ?? null,
        clientId: params.clientId ?? null,
        eventType: params.eventType,
        title: params.title,
        body: params.body ?? null,
        meta: params.meta ?? {},
      }),
    })
  } catch {
    // Silently swallow — activity logging must never crash the app
  }
}

/**
 * recordActivity — the reliable, transparent writer for the Approvals & Records
 * ledger. Inserts straight into `activity_log` with the service role (which
 * bypasses RLS), so it does NOT depend on the `log_activity` RPC existing. A
 * failed write is logged (not silently swallowed) so records can never vanish
 * without a trace. Never throws into the caller.
 *
 * Use this for anything that must appear in Approvals & Records (approval-gate
 * sends, client approvals, change requests, auto-proceeds).
 */
export async function recordActivity(params: ActivityParams): Promise<void> {
  try {
    const { supabaseAdmin } = await import('@/lib/supabase/admin')
    const { error } = await supabaseAdmin.from('activity_log').insert({
      project_id: params.projectId ?? null,
      client_id: params.clientId ?? null,
      actor_id: params.actorId,
      actor_name: params.actorName,
      actor_role: params.actorRole,
      event_type: params.eventType,
      title: params.title,
      body: params.body ?? null,
      meta: params.meta ?? {},
    })
    if (error) {
      console.error('[recordActivity] insert failed:', params.eventType, error.message)
    }
  } catch (e) {
    console.error('[recordActivity] threw:', e)
  }
}

/**
 * Server-side variant — uses the service-role client.
 * Import from API routes / server actions only.
 */
export async function logActivityServer(params: ActivityParams): Promise<void> {
  try {
    // Dynamic import to avoid bundling server code client-side
    const { supabaseAdmin } = await import('@/lib/supabase/admin')

    const { error } = await supabaseAdmin.rpc('log_activity', {
      p_project_id: params.projectId ?? null,
      p_client_id: params.clientId ?? null,
      p_actor_id: params.actorId,
      p_actor_name: params.actorName,
      p_actor_role: params.actorRole,
      p_event_type: params.eventType,
      p_title: params.title,
      p_body: params.body ?? null,
      p_meta: params.meta ?? {},
    })

    if (error) {
      await supabaseAdmin.from('activity_log').insert({
        project_id: params.projectId ?? null,
        client_id: params.clientId ?? null,
        actor_id: params.actorId,
        actor_name: params.actorName,
        actor_role: params.actorRole,
        event_type: params.eventType,
        title: params.title,
        body: params.body ?? null,
        meta: params.meta ?? {},
      })
    }
  } catch {
    // Silently swallow
  }
}
