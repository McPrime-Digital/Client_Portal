import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.user_metadata?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Count all unread client messages across all projects
  const { count: unreadClientMessages } = await supabaseAdmin
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('sender_role', 'client')
    .is('read_at', null)

  return NextResponse.json({
    unreadClientMessages: unreadClientMessages ?? 0,
  })
}
