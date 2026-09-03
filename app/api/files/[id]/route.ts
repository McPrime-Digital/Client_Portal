import { isAdmin, userOrgId } from '@/lib/auth/role'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { rosterName, portalClientId } from '@/lib/team'
import { deleteFilePermanently } from '@/lib/fileDelete'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Permanent file deletion.
 *
 * WHO MAY DELETE (widened in Batch 24 — it was admin-only, which is why "files
 * cannot be deleted permanently" was true for every client):
 *   · any admin of the file's own organization — was `isAdmin` with NO tenant
 *     predicate, so an admin of studio B could delete studio A's file by id;
 *   · the person who uploaded it, provided it still belongs to their company.
 * A client cannot delete the studio's deliverables, and never another
 * company's anything.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { data: file } = await supabaseAdmin
      .from('files')
      .select('id, file_path, file_name, bucket, project_id, client_id, organization_id, uploaded_by')
      .eq('id', id)
      .single()

    if (!file) {
      return NextResponse.json(
        { error: 'File not found.' },
        { status: 404 }
      )
    }

    if (isAdmin(user)) {
      if (file.organization_id !== userOrgId(user)) {
        return NextResponse.json({ error: 'File not found.' }, { status: 404 })
      }
    } else {
      const mine = await portalClientId(user)
      if (file.uploaded_by !== user.id || !mine || file.client_id !== mine) {
        return NextResponse.json(
          { error: 'You can only delete files you uploaded.' },
          { status: 403 }
        )
      }
    }

    // Row, then blob, with every reference detached first (lib/fileDelete).
    const result = await deleteFilePermanently(supabaseAdmin, file)
    if (!result.blobDeleted) {
      console.error('[files/delete] blob not destroyed', id, result.blobError)
    }

    try {
      await supabaseAdmin.rpc('log_activity', {
        p_project_id: file.project_id,
        p_client_id: file.client_id,
        p_actor_id: user.id,
        // Roster first. A THIRD ledger site reading the forgeable field —
        // the open list named two, because it was compiled from the sweep that
        // fixed those two rather than from a grep. File deletion is exactly the
        // action a ledger exists to attribute.
        p_actor_name: (await rosterName(user)) ?? (isAdmin(user) ? 'Admin' : 'Client'),
        p_actor_role: isAdmin(user) ? 'admin' : 'client',
        p_event_type: 'file_deleted',
        p_title: `${file.file_name} deleted`,
        p_body: null,
        p_meta: { file_id: id, blob_deleted: result.blobDeleted },
      })
    } catch {
      // non-critical
    }

    return NextResponse.json({ success: true, blobDeleted: result.blobDeleted })
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    )
  }
}
