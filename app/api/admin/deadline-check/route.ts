import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createAdminNotification } from '@/lib/notify'

// Scans for projects whose deadline is approaching (within 3 days) and that
// haven't already been flagged, then raises an admin notification and stamps
// `deadline_notified_at` to dedupe. Called client-side on admin load.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.user_metadata?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const horizon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)

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

  return NextResponse.json({ raised })
}
