import { isAdmin, userOrgId } from '@/lib/auth/role'
import { cutMemberAccess } from '@/lib/memberAccess'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { deleteFromR2 } from '@/lib/r2'
import { captureError } from '@/lib/errors'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    // Verify caller is admin
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || !isAdmin(user)) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { clientId } = await req.json()

    if (!clientId) {
      return NextResponse.json(
        { error: 'clientId is required.' },
        { status: 400 }
      )
    }

    // Fetch the client record — org-scoped: unscoped, an admin of one tenant
    // could delete another tenant's company (and its invoices and files rows)
    // by id. Foreign uuids 404 like any other miss.
    const { data: client, error: fetchError } = await supabaseAdmin
      .from('clients')
      .select('id, name, email')
      .eq('id', clientId)
      .eq('organization_id', userOrgId(user))
      .single()

    if (fetchError || !client) {
      return NextResponse.json(
        { error: 'Client not found.' },
        { status: 404 }
      )
    }

    // Everyone whose access this company grants, read BEFORE the delete —
    // client_members rows cascade away with the company row, so after the
    // delete there is nothing left to resolve them from.
    //
    // This replaces a clients.user_id read, and it is a fan-out, not a lookup:
    // the column named ONE person, so every invited teammate kept a client_id
    // claim pointing at a company that no longer exists. client_members is the
    // authority (S1 §5.2), so the company's people are its members — the same
    // answer Batch 8 item 2 gives for notifications.
    const { data: memberRows } = await supabaseAdmin
      .from('client_members')
      .select('user_id')
      .eq('client_id', clientId)
      .eq('organization_id', userOrgId(user))
    const memberUserIds = [...new Set(
      (memberRows ?? []).map((m) => m.user_id).filter((v): v is string => !!v)
    )]

    // Unlink projects (set client_id to null, preserve projects)
    await supabaseAdmin
      .from('projects')
      .update({ client_id: null })
      .eq('client_id', clientId)

    // THE BLOBS GO WITH THE ROWS. Deleting only the `files` rows left every
    // object in storage — unindexed, unbilled-for by anyone, and the worst
    // kind of retained data: a deleted client's actual deliverables with no
    // record pointing at them (S0 §5). Objects first, rows second: a re-run
    // after a partial failure finds the rows still present and retries the
    // remaining objects (deleting an already-deleted key is a no-op).
    const { data: fileRows } = await supabaseAdmin
      .from('files')
      .select('file_path, bucket')
      .eq('client_id', clientId)
    let blobFailures = 0
    for (const f of fileRows ?? []) {
      if (!f.file_path) continue
      try {
        if (f.bucket === 'r2') {
          await deleteFromR2(f.file_path)
        } else if (f.bucket) {
          const { error } = await supabaseAdmin.storage.from(f.bucket).remove([f.file_path])
          if (error) throw error
        }
      } catch (e) {
        blobFailures++
        captureError(e, { where: 'delete-client blob cleanup', clientId, path: f.file_path })
      }
    }
    if (blobFailures > 0) {
      // Surface rather than proceed (I-10): the rows still exist, so the
      // admin can retry; silently deleting them here would recreate the
      // orphaned-blob state this block exists to end.
      return NextResponse.json(
        { error: `${blobFailures} stored file(s) could not be removed. Nothing was deleted — try again.` },
        { status: 502 }
      )
    }

    // Remove rows that reference this client so the delete can't fail on
    // a foreign-key constraint. (Projects are preserved/unlinked above.)
    await supabaseAdmin.from('invoices').delete().eq('client_id', clientId)
    await supabaseAdmin.from('files').delete().eq('client_id', clientId)

    // Delete the client record
    const { error: deleteError } = await supabaseAdmin
      .from('clients')
      .delete()
      .eq('id', clientId)

    if (deleteError) {
      throw new Error(deleteError.message)
    }

    // Cut every member's claims — but keep the accounts (AD-003). An identity
    // may belong elsewhere (S1 §2); dropping client_id only demotes them to the
    // roster-resolved path in clientMembershipOf(), which is the correct
    // answer for whatever other membership they hold. With the company row and
    // its cascade-deleted client_members rows gone, they read nothing here
    // regardless.
    for (const memberUserId of memberUserIds) {
      try {
        const claimError = await cutMemberAccess(memberUserId)
        if (claimError) console.error('Failed to cut auth claims:', claimError)
      } catch (authErr: any) {
        // Non-fatal — client record is already deleted
        console.error('Failed to cut auth claims:', authErr.message)
      }
    }

    return NextResponse.json({
      success: true,
      message: `Client "${client.name}" deleted.`,
    })
  } catch (err: any) {
    console.error('Delete client error:', err)
    return NextResponse.json(
      { error: err.message ?? 'Failed to delete client.' },
      { status: 500 }
    )
  }
}
