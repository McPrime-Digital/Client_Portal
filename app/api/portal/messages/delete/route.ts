import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { deleteFilePermanently, filesForMessage } from '@/lib/fileDelete'

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

  // Soft-delete (S3-core-A A-2): set the timestamp the 90-day grace period
  // and the §4.2 purge key on. The BODY is kept — blanking it here destroyed
  // the message at delete time, which made the grace period a fiction.
  // Invisibility is RLS's job (§4.1, migration 10); the purge is what
  // destroys the text. deleted_at is the ONLY delete marker now (Batch 21
  // item 3; migration 12 drops is_deleted).
  const { error: updateErr } = await supabaseAdmin
    .from('messages')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', message_id)

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  // ── THE ATTACHMENT IS DESTROYED NOW, and that is a deliberate departure
  //    from the 90-day grace the body keeps (Batch 24).
  //
  // HANDOFF §8.3 item 2 carried "message delete orphans the file + R2 object"
  // as open, waiting on the migration-11 purge. Waiting was the wrong call
  // for MEDIA: a person who deletes a photo they just sent means the picture
  // is gone, and until the purge existed the object stayed in the bucket
  // indefinitely, still reachable by anyone holding a signed URL and still
  // billed. Text can wait for the purge — nobody can read a scrubbed body.
  // Bytes cannot: a signed URL already handed out keeps working.
  //
  // The 5-minute delete window above is what makes this safe to do eagerly.
  const removed: string[] = []
  try {
    for (const f of await filesForMessage(supabaseAdmin, message_id)) {
      const res = await deleteFilePermanently(supabaseAdmin, f)
      removed.push(res.fileId)
      if (!res.blobDeleted) {
        console.error('[messages/delete] blob not destroyed', res.fileId, res.blobError)
      }
    }
    // The legacy string reference goes with it; nothing should resolve it.
    await supabaseAdmin
      .from('messages')
      .update({ attachment_name: null })
      .eq('id', message_id)
  } catch (e) {
    // The message IS deleted; report the storage failure rather than
    // pretending the whole delete failed (I-10 — it reaches a caller).
    console.error('[messages/delete] attachment cleanup failed:', e)
    return NextResponse.json({
      ok: true,
      attachmentsRemoved: removed.length,
      warning: 'The message was deleted, but its attachment could not be removed from storage.',
    })
  }

  return NextResponse.json({ ok: true, attachmentsRemoved: removed.length })
}
