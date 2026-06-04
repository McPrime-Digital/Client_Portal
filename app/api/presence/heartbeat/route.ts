import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

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
    if (user.user_metadata?.role === 'admin') {
      // Admins have no clients row — stamp the singleton business_settings.
      await supabaseAdmin
        .from('business_settings')
        .update({ admin_last_seen_at: now })
        .not('id', 'is', null)
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
