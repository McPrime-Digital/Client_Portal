import { isAdmin, userOrgId } from '@/lib/auth/role'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // All three counts scoped once from the verified session — unscoped, the
  // sidebar badge counted every studio's unread mail (T-3).
  const orgId = userOrgId(user)
  const today = new Date().toISOString().slice(0, 10)

  const [msgRes, reviewRes, invoiceRes] = await Promise.all([
    // Unread client messages across this tenant's projects.
    supabaseAdmin
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('sender_role', 'client')
      .is('read_at', null),
    // Review gates a client sent back — the studio's actionable state
    // ('pending' means waiting on the CLIENT, so it does not badge here).
    supabaseAdmin
      .from('tasks')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('approval_status', 'changes_requested'),
    // Overdue invoices, computed on read: the status flip to 'overdue' only
    // happens when a page calls mark_overdue_invoices(), so unpaid-and-past-due
    // must count too or the badge lags the invoices page.
    supabaseAdmin
      .from('invoices')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .or(`status.eq.overdue,and(status.eq.unpaid,due_date.lt.${today})`),
  ])

  return NextResponse.json({
    unreadClientMessages: msgRes.count ?? 0,
    changesRequested: reviewRes.count ?? 0,
    overdueInvoices: invoiceRes.count ?? 0,
  })
}
