/**
 * logActivity — fire-and-forget activity log helper. Browser-safe.
 *
 * This module must stay free of any service-role import: it is pulled into the
 * client bundle by `"use client"` callers. The service-role writers live in
 * `@/lib/logActivity.server`, which is guarded by `server-only`. A dynamic
 * `await import()` is NOT enough to keep them out of the client chunk graph —
 * the bundler still creates the edge.
 *
 * Usage (client or server):
 *   import { logActivity } from '@/lib/logActivity'
 *   await logActivity({ eventType: 'file_uploaded', title: '...', actorId, actorName, actorRole })
 */

// The closed set of ledger event types. A const array rather than a bare
// union so /api/activity's zod schema validates against the SAME list —
// one source, no drift between the type and the boundary check (I-7).
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
] as const

export type EventType = (typeof EVENT_TYPES)[number]

export type ActivityParams = {
  projectId?: string | null
  clientId?: string | null
  /** Tenant stamp (T-5). Server-resolved from the verified target row —
   *  never from a request body. Only the server writers consume it; the
   *  browser POST path resolves it in /api/activity. */
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
