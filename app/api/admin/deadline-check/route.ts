import { isAdmin, userOrgId } from '@/lib/auth/role'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createAdminNotification } from '@/lib/notify'

// Scans for projects whose deadline is approaching (within 3 days) and that
// haven't already been flagged, then raises an admin notification and stamps
// `deadline_notified_at` to dedupe. Called client-side on admin load.
//
// It no longer touches approvals at all — see the note below. What remains is
// notification-only: it raises alerts and stamps a dedupe column. It does not
// complete tasks, does not post into client chats, and does not decide
// anything on a client's behalf.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const horizon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)

  // This handler still WRITES (`deadline_notified_at`) and is fired on every
  // admin page load, so the scope stays resolved once from the verified
  // session. The original reason was sharper — unscoped, one studio's admin
  // auto-approved every OTHER studio's pending client approvals — and that
  // half is gone; the tenant predicate stays because a notification fan-out
  // must not cross tenants either.
  const orgId = userOrgId(user)


  // ── Auto-proceed REMOVED — Batch 22 item 5 ────────────────────────────
  //
  // This route used to auto-complete stale approval gates here, writing
  // `approval_status: 'auto_approved'` and `approved_at`. Two things were
  // wrong with it, and the approvals engine fixes both:
  //
  // 1. IT WROTE SILENCE AS APPROVAL. S3-c AP-2 is explicit that a timeout and
  //    a human decision must never share a value: the moment the database
  //    records them the same way, every certificate, query and dispute
  //    conflates them. `app/studio/client/review/page.tsx` counted
  //    'auto_approved' among the APPROVED, so the studio's own review page
  //    was already reporting timeouts as client sign-offs. The engine records
  //    `auto_advanced` with NO actor and NO decision row instead.
  //
  // 2. IT RAN ON A USER-SESSION PAGE LOAD. This handler is POSTed by the
  //    admin shell on every load, so a service-role scan that COMPLETES tasks,
  //    posts into client chats and sends notifications fired whenever anyone
  //    opened the studio. That is HANDOFF §8.3 item 4's defect — recorded
  //    there only against the message-nudge cron; the Batch 22 item-0 audit
  //    found this second, unlisted instance.
  //
  // The replacement is `app/api/cron/approval-sweep/route.ts`: GET only,
  // CRON_SECRET-authenticated, per-organization, explicitly capped, and it
  // sends the reminder ladder that makes proceeding-without-a-response
  // defensible (S3-c §2.4).
  //
  // Nothing has ever run the old path in production — `auto_proceeded` is
  // false on all 122 live task rows — so there is no historical
  // 'auto_approved' data to reconcile. The remaining deadline-notification
  // half below is untouched and still useful.

  const { data: projects } = await supabaseAdmin
    .from('projects')
    .select('id, title, client_id, due_date, status, deadline_notified_at')
    .eq('organization_id', orgId)
    .not('due_date', 'is', null)
    .is('deadline_notified_at', null)

  let raised = 0
  for (const p of projects ?? []) {
    if (!p.due_date) continue
    if (p.status === 'Completed' || p.status === 'completed') continue
    const due = new Date(p.due_date)
    if (due > horizon) continue // not yet within the window

    const overdue = due < now
    await createAdminNotification({
      clientId: p.client_id,
      projectId: p.id,
      type: 'status_change',
      title: overdue ? `Deadline passed: ${p.title}` : `Deadline approaching: ${p.title}`,
      body: overdue
        ? `Due ${due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
        : `Due ${due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
    })
    await supabaseAdmin
      .from('projects')
      .update({ deadline_notified_at: now.toISOString() })
      .eq('id', p.id)
    raised++
  }

  return NextResponse.json({ raised })
}
