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

  // Unread client messages across this tenant's projects. Scope resolved once
  // from the verified session — unscoped, the sidebar badge counted every
  // studio's unread mail.
  const { count: unreadClientMessages } = await supabaseAdmin
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', userOrgId(user))
    .eq('sender_role', 'client')
    .is('read_at', null)

  return NextResponse.json({
    unreadClientMessages: unreadClientMessages ?? 0,
  })
}
