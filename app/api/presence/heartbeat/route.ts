import { isAdmin, userOrgId } from '@/lib/auth/role'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { touchAdminLastSeen } from '@/lib/businessSettings'
import { captureError } from '@/lib/errors'

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
      // Presence is per PERSON. This was `clients.update(...).eq('user_id', …)`
      // — the deprecated primary-login pointer — so a company's invited
      // teammates never registered as present at all: they read as away while
      // sitting in the app, and the X-6 ladder emailed and texted them for it.
      // client_members is the roster (S1 §5.2) and carries the timestamp since
      // 0025. Every active row for this person is touched: one row in the
      // normal case, and a person on two companies' rosters is present on both.
      const { error } = await supabaseAdmin
        .from('client_members')
        .update({ last_seen_at: now })
        .eq('user_id', user.id)
        .eq('status', 'active')
      // Presence is a nicety, so this still never fails the request — but it
      // does not vanish either (I-10). The one error worth seeing is 42703
      // before 0025 is applied, which would otherwise silently mark every
      // client away.
      if (error) captureError(new Error(`heartbeat: ${error.message}`), { where: 'presence/heartbeat', userId: user.id })
    }
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: true })
  }
}
