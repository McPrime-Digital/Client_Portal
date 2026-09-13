import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/admin'

/**
 * The closed set of ledger event types, and the writer's parameter shape.
 *
 * These moved here from the deleted browser module in Batch 22 item 11. They
 * are SERVER-ONLY now, which is the point: the ledger is written as a side
 * effect of the action it records, so nothing in the browser needs to name an
 * event type. A surface that wants a new one adds it here, next to the writer
 * that will emit it.
 */
export const EVENT_TYPES = [
  'project_created',
  'project_status_changed',
  'file_uploaded',
  'file_deleted',
  'message_sent',
  'task_completed',
  'task_created',
  'invoice_created',
  'invoice_paid',
  'client_created',
  'note_added',
  // Approvals & Records ledger events.
  'approval_requested',
  'task_approved',
  'changes_requested',
  'task_auto_approved',
  // The approvals ENGINE's events (Batch 22, S3-c). Distinct from the four
  // task-shaped ones above, which the legacy tasks path writes and which stay
  // until those columns drop. `approval_auto_advanced` is deliberately not
  // named "approved" anything (AP-2): a lapse and a decision must never share
  // a value, in this vocabulary or in the schema.
  'approval_created',
  'approval_decided',
  'approval_auto_advanced',
  'approval_withdrawn',
  'approval_reminded',
  // R-11 (Batch 24 item 9). Deliberately NOT named anything like 'lapsed' or
  // 'advanced': a stage blocked because nobody can decide is the OPPOSITE of
  // silence, and the two must never share a value — the same rule
  // approval_auto_advanced follows for the same reason (AP-2).
  'approval_blocked_on_permission',
  // The PERMISSION ledger (Batch 24 item 8, S-R R-8). "A permission change is
  // precisely the fact you need a record of when something has gone wrong, and
  // it is the second table after approvals where 'the record is the product'
  // applies." Written server-side as a side effect of the change itself — never
  // by the browser, which is why /api/activity was deleted in Batch 22.
  'member_cap_granted',
  'member_cap_denied',
  'member_cap_revoked',
  'member_role_changed',
  // THE STAFFING LEDGER (Batch 26 item 7, S-R R-8). Who was put on which
  // production, as what, by whom, and when they came off it. R-8's argument
  // applies unchanged: "a permission change is precisely the fact you need a
  // record of when something has gone wrong."
  //
  // It applies harder here than to a capability grant, because a project
  // assignment is what a scoped person's ENTIRE access is made of — remove the
  // last one and they see nothing. Without a ledger row, "I could see this
  // yesterday" has no answer.
  //
  // `member_unassigned_project` is deliberately its own event rather than an
  // assignment with a null role: coming OFF a production and being on it with no
  // stated role are different facts, and 0057's project_role comment insists on
  // exactly that distinction one layer down.
  'member_assigned_project',
  'member_project_role_changed',
  'member_unassigned_project',
  // Seat class and scope are separate events for the same reason they are
  // separate columns: one is a label, the other is access, and item 4's rule is
  // that scope is STATED rather than derived from the label.
  'member_seat_class_changed',
  'member_scope_changed',
  // 0063. A spending limit is exactly the fact somebody needs a record of when a
  // call was refused and nobody remembers setting the cap.
  'member_budget_changed',
] as const

export type EventType = (typeof EVENT_TYPES)[number]

export type ActivityParams = {
  projectId?: string | null
  clientId?: string | null
  /** Tenant stamp (T-5). Server-resolved from the verified target row. */
  organizationId?: string | null
  /** NULL only where there genuinely is no actor — an auto-advance on silence
   *  (S3-c AP-2). `activity_log.actor_id` and `actor_role` are both nullable;
   *  `actor_name` is NOT NULL, so a lapse still names itself ('System'). */
  actorId: string | null
  actorName: string
  actorRole: 'admin' | 'client' | null
  eventType: EventType
  title: string
  body?: string | null
  meta?: Record<string, any>
}

/**
 * Service-role activity writers. Server-only by construction — `server-only`
 * turns any accidental client import into a build error rather than a silent
 * leak of the admin client into the browser chunk graph.
 *
 * THERE IS NO BROWSER PATH ANY MORE (Batch 22 item 11, S3-core §5). The
 * browser module and the /api/activity endpoint are deleted: a ledger row is
 * written as a side effect of the action it records, inside the same server
 * handler. An endpoint that can be called directly is a surface defended
 * forever; a side effect cannot be called at all.
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
      // Stamped only when the caller resolved it (T-5). Omitted, the column
      // DEFAULT applies — the tenant-zero backstop, not the mechanism.
      ...(params.organizationId ? { organization_id: params.organizationId } : {}),
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
