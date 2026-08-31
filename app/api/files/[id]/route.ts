import { isAdmin } from '@/lib/auth/role'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { rosterName } from '@/lib/team'
import { deleteFromR2 } from '@/lib/r2'
import { NextRequest, NextResponse } from 'next/server'

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || !isAdmin(user)) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { data: file } = await supabaseAdmin
      .from('files')
      .select('file_path, file_name, bucket, project_id, client_id')
      .eq('id', id)
      .single()

    if (!file) {
      return NextResponse.json(
        { error: 'File not found.' },
        { status: 404 }
      )
    }

    // Remove the blob from the correct backend.
    if (file.bucket === 'r2') {
      await deleteFromR2(file.file_path)
    } else {
      await supabaseAdmin.storage
        .from(file.bucket)
        .remove([file.file_path])
    }

    // Then delete metadata.
    await supabaseAdmin
      .from('files')
      .delete()
      .eq('id', id)

    try {
      await supabaseAdmin.rpc('log_activity', {
        p_project_id: file.project_id,
        p_client_id: file.client_id,
        p_actor_id: user.id,
        // Roster first. A THIRD ledger site reading the forgeable field —
        // the open list named two, because it was compiled from the sweep that
        // fixed those two rather than from a grep. File deletion is exactly the
        // action a ledger exists to attribute.
        p_actor_name: (await rosterName(user)) ?? 'Admin',
        p_actor_role: 'admin',
        p_event_type: 'file_deleted',
        p_title: `${file.file_name} deleted`,
        p_body: null,
        p_meta: { file_id: id },
      })
    } catch {
      // non-critical
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    )
  }
}
