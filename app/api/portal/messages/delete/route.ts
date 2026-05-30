import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { message_id } = await req.json()
  if (!message_id) {
    return NextResponse.json({ error: 'Missing message_id' }, { status: 400 })
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

  // Verify ownership: the sender_id must match the current user
  if (msg.sender_id !== user.id) {
    return NextResponse.json({ error: 'You can only delete your own messages' }, { status: 403 })
  }

  // Enforce 5-minute window
  const fiveMinutesMs = 5 * 60 * 1000
  const messageAge = Date.now() - new Date(msg.created_at).getTime()
  if (messageAge > fiveMinutesMs) {
    return NextResponse.json({ error: 'Messages can only be deleted within 5 minutes' }, { status: 403 })
  }

  // Soft-delete: mark as deleted
  const { error: updateErr } = await supabaseAdmin
    .from('messages')
    .update({ is_deleted: true, body: '', attachment_url: null, attachment_name: null })
    .eq('id', message_id)

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
