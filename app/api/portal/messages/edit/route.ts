import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { message_id, body } = await req.json()
  if (!message_id || typeof body !== 'string') {
    return NextResponse.json({ error: 'Missing message_id or body' }, { status: 400 })
  }

  // Fetch the message
  const { data: msg, error: fetchErr } = await supabaseAdmin
    .from('messages')
    .select('*')
    .eq('id', message_id)
    .single()

  if (fetchErr || !msg) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  }

  // Verify ownership
  if (msg.sender_id !== user.id) {
    return NextResponse.json({ error: 'You can only edit your own messages' }, { status: 403 })
  }

  // Enforce 1-hour window
  const oneHourMs = 1 * 60 * 60 * 1000
  const messageAge = Date.now() - new Date(msg.created_at).getTime()
  if (messageAge > oneHourMs) {
    return NextResponse.json({ error: 'Messages can only be edited within 1 hour' }, { status: 403 })
  }

  // Update the message
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('messages')
    .update({ body, edited_at: new Date().toISOString() })
    .eq('id', message_id)
    .select()
    .single()

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  return NextResponse.json({ message: updated })
}
