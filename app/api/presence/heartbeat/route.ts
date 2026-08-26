import { isAdmin, userOrgId } from '@/lib/auth/role'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { touchAdminLastSeen } from '@/lib/businessSettings'

// Records that the caller is currently in the app, so deferred (email) alerts
// can distinguish "away" from "in-app". Best-effort: if the last_seen columns
// haven't been migrated yet (phase10), the update simply no-ops. Never errors
// out the client — presence is a nicety, not load-bearing.
export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false })

    const now = new Date().toISOString()
    if (isAdmin(user)) {
      // Admins have no clients row — their last-seen lives on business_settings.
      // Scoped to the caller's org: the previous .not('id','is',null) rewrote
      // EVERY tenant's row every 30 seconds, per admin.
      await touchAdminLastSeen(userOrgId(user))
    } else {
      await supabaseAdmin
        .from('clients')
        .update({ last_seen_at: now })
        .eq('user_id', user.id)
    }
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: true })
  }
}
