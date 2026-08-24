import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/admin'
import type { ActivityParams } from '@/lib/logActivity'

/**
 * Service-role activity writers. Server-only by construction — `server-only`
 * turns any accidental client import into a build error rather than a silent
 * leak of the admin client into the browser chunk graph.
 *
 * The browser-safe `logActivity()` (which POSTs to /api/activity) stays in
 * `@/lib/logActivity`.
 */

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
 * Server-side variant of logActivity — goes through the `log_activity` RPC and
 * falls back to a direct insert if the RPC is missing.
 */
export async function logActivityServer(params: ActivityParams): Promise<void> {
  try {
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
