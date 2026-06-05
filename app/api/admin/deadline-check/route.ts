import { isAdmin } from '@/lib/auth/role'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createAdminNotification, createNotification } from '@/lib/notify'

// Auto-proceed window: if a client doesn't respond to an approval gate within
// this many days of it entering review, we record "response not received" and
// proceed so the project isn't blocked indefinitely.
const APPROVAL_THRESHOLD_DAYS = 7

// Scans for projects whose deadline is approaching (within 3 days) and that
// haven't already been flagged, then raises an admin notification and stamps
// `deadline_notified_at` to dedupe. Also auto-proceeds stale approval gates.
// Called client-side on admin load.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const horizon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)

  // ── Auto-proceed stale client approvals ───────────────────────────────
  let autoProceeded = 0
  try {
    const cutoff = new Date(now.getTime() - APPROVAL_THRESHOLD_DAYS * 24 * 60 * 60 * 1000)
    const { data: stale } = await supabaseAdmin
      .from('tasks')
      .select('id, title, project_id, client_id:projects(client_id)')
      .eq('status', 'review')
      .eq('visible_to_client', true)
      .or('requires_approval.eq.true,category.eq.approval')
      .not('review_requested_at', 'is', null)
      .lt('review_requested_at', cutoff.toISOString())
      .neq('auto_proceeded', true)

    for (const t of stale ?? []) {
      const rel = (t as any).client_id
      const clientId = Array.isArray(rel) ? rel[0]?.client_id : rel?.client_id
      const ts = now.toISOString()
      await supabaseAdmin
        .from('tasks')
        .update({
          status: 'completed', completed_at: ts, approved_at: ts,
          approval_status: 'auto_approved', auto_proceeded: true,
          approval_note: `No response received within ${APPROVAL_THRESHOLD_DAYS} days — auto-proceeded.`,
        })
        .eq('id', t.id)

      // Record it in the project chat as proof, and notify both sides.
      await supabaseAdmin.from('messages').insert({
        project_id: t.project_id,
        sender_id: user.id,
        sender_role: 'admin',
        sender_name: 'McPrime Digital',
        body: `⏳ No response received within ${APPROVAL_THRESHOLD_DAYS} days on "${t.title}". Per our process this step has auto-proceeded. Reply here if you still need changes.`,
      })
      await createNotification({
        clientId, projectId: t.project_id, type: 'task_updated',
        title: 'A pending approval auto-proceeded',
        body: `No response within ${APPROVAL_THRESHOLD_DAYS} days: ${t.title}`,
      })
      await createAdminNotification({
        clientId, projectId: t.project_id, type: 'task_updated',
        title: 'Approval auto-proceeded (no client response)',
        body: t.title ?? null,
      })
      try {
        await supabaseAdmin.rpc('log_activity', {
          p_project_id: t.project_id, p_client_id: clientId, p_actor_id: user.id,
          p_actor_name: 'System', p_actor_role: 'admin',
          p_event_type: 'task_auto_approved',
          p_title: `Auto-proceeded "${t.title}" — no client response in ${APPROVAL_THRESHOLD_DAYS} days`,
          p_body: null, p_meta: { task_id: t.id },
        })
      } catch { /* non-critical */ }
      autoProceeded++
    }
  } catch {
    // review_requested_at / auto_proceeded columns may be missing — skip.
  }

  const { data: projects } = await supabaseAdmin
    .from('projects')
    .select('id, title, client_id, due_date, status, deadline_notified_at')
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

  return NextResponse.json({ raised, autoProceeded })
}
