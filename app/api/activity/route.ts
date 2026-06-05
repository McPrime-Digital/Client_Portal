import { userRole } from '@/lib/auth/role'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logActivityServer } from '@/lib/logActivity'

// Logs an activity entry server-side (service role), so the browser never
// touches activity_log directly (which RLS blocks). The actor is taken from
// the authenticated session — never trusted from the request body.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const { projectId, clientId, eventType, title, body: detail, meta } = body

  if (!eventType || !title) {
    return NextResponse.json(
      { error: 'eventType and title are required.' },
      { status: 400 }
    )
  }

  await logActivityServer({
    projectId: projectId ?? undefined,
    clientId: clientId ?? undefined,
    actorId: user.id,
    actorName: user.user_metadata?.name ?? 'User',
    actorRole: userRole(user),
    eventType,
    title,
    body: detail ?? undefined,
    meta: meta ?? undefined,
  })

  return NextResponse.json({ success: true })
}
