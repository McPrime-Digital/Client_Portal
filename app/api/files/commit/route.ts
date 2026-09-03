import { userRole } from '@/lib/auth/role'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { resolveUploadScope } from '@/lib/uploadScope'
import { createNotification, createAdminNotification } from '@/lib/notify'
import { tenantBrandForClient } from '@/lib/tenantBrand'
import { rosterName } from '@/lib/team'
import { recordUsage } from '@/lib/usage'
import { userOrgId } from '@/lib/auth/role'
import { resolveFolder } from '@/lib/fileCategories'
import { NextRequest, NextResponse } from 'next/server'
import { captureError } from '@/lib/errors'

// Step 2 of the direct-to-R2 upload: the browser has PUT the file to R2
// using the presigned URL; now persist the files-table row. We re-authorize
// (commit is a separate request) and verify the key lives under the prefix
// the caller is allowed to write, so a client can't register an object
// outside their scope. Supports project-scoped and client-scoped uploads.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const {
      projectId,
      clientId: bodyClientId,
      roomId,
      key,
      fileName,
      fileSize,
      contentType,
      direction: requestedDirection,
      category,
      invoiceId,
      folder: requestedFolder,
      taskId,
      isFinal,
    } = await req.json()

    if (!key || !fileName) {
      return NextResponse.json(
        { error: 'key and fileName are required.' },
        { status: 400 }
      )
    }

    const role = userRole(user)
    const scope = await resolveUploadScope(role, user.id, projectId, bodyClientId, roomId)
    if ('error' in scope) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    if (!key.startsWith(`${scope.prefix}/`)) {
      return NextResponse.json({ error: 'Invalid file key.' }, { status: 400 })
    }

    // Clients can only post client-uploads; admins deliver by default.
    const direction =
      role === 'admin' ? requestedDirection || 'delivery' : 'client-upload'
    const mime = contentType || 'application/octet-stream'

    // Resolve the vault folder: honour an explicit pick, else derive from
    // task link / category / direction so every file lands in a folder.
    const folder = resolveFolder({
      folder: requestedFolder,
      category,
      direction,
      taskId,
    })

    const { data: fileRecord, error: insertError } = await supabaseAdmin
      .from('files')
      .insert({
        project_id: projectId ?? null,
        client_id: scope.clientId,
        // STAMPED, not defaulted (T-5). The column DEFAULT is McPrime's org,
        // so a second studio's internal room file landed in tenant zero —
        // which the room scope is the first path to make reachable at all.
        ...(scope.orgId ? { organization_id: scope.orgId } : {}),
        file_name: fileName,
        file_path: key,
        file_size: typeof fileSize === 'number' ? fileSize : 0,
        file_type: mime,
        mime_type: mime,
        direction,
        bucket: 'r2',
        category: category ?? null,
        folder,
        task_id: taskId ?? null,
        is_final: role === 'admin' ? !!isFinal : false,
        uploaded_by: user.id,
        uploaded_by_role: role,
      })
      .select()
      .single()

    if (insertError) {
      throw new Error(insertError.message)
    }

    // Meter storage at the commit boundary. AWAITED, not void: on Vercel a
    // fire-and-forget insert races the lambda freeze after the response, and
    // recordUsage never throws (it captures internally), so awaiting costs one
    // insert's latency and buys a guarantee. Batch 6 item 5a: the "zero
    // storage.bytes rows" mystery was NOT a failure here — no file had been
    // committed since metering landed (2026-08-25); the write path works.
    await recordUsage(userOrgId(user), 'storage.bytes', fileRecord.file_size ?? 0, 0, { file_id: fileRecord.id }, user.id)

    // Link this upload to an invoice as its payment receipt, if asked.
    // Authorize: admins any invoice; clients only their own.
    if (invoiceId) {
      const { data: invoice } = await supabaseAdmin
        .from('invoices')
        .select('id, client_id')
        .eq('id', invoiceId)
        .single()
      if (invoice && (role === 'admin' || invoice.client_id === scope.clientId)) {
        // Client receipt → 'submitted' (awaits admin verify). Admin proof →
        // 'verified' (admin-confirmed). Columns are optional; degrade safely.
        const receiptPatch: Record<string, unknown> = { receipt_file_id: fileRecord.id }
        if (category === 'receipt') {
          receiptPatch.receipt_uploaded_by = role === 'admin' ? 'admin' : 'client'
          receiptPatch.receipt_status = role === 'admin' ? 'verified' : 'submitted'
          receiptPatch.receipt_submitted_at = new Date().toISOString()
        }
        const { error: rErr } = await supabaseAdmin
          .from('invoices').update(receiptPatch).eq('id', invoiceId)
        if (rErr) {
          // New columns may not exist yet — at least keep the file link.
          await supabaseAdmin.from('invoices')
            .update({ receipt_file_id: fileRecord.id }).eq('id', invoiceId)
        }
      }
    }

    // Notify the client when the studio delivers a file (not chat attachments).
    if (role === 'admin' && direction === 'delivery' && category !== 'message') {
      await createNotification({
        clientId: scope.clientId,
        projectId: projectId ?? null,
        type: 'file_delivered',
        title: 'New file delivered',
        body: fileName,
      })
    }

    // Notify the admin when a client uploads (esp. a payment receipt).
    if (role !== 'admin' && category !== 'message') {
      await createAdminNotification({
        clientId: scope.clientId,
        projectId: projectId ?? null,
        type: category === 'receipt' ? 'invoice_created' : 'file_delivered',
        title: category === 'receipt' ? 'Payment receipt uploaded' : 'Client uploaded a file',
        body: fileName,
      })
    }

    // Activity log — best effort, never fail the upload.
    try {
      await supabaseAdmin.rpc('log_activity', {
        p_project_id: projectId ?? null,
        p_client_id: scope.clientId,
        p_actor_id: user.id,
        // ROSTER FIRST — see the matching note in invoice-actions. The
        // primary was `user.user_metadata?.name`, which the uploader can
        // rewrite themselves, so a file could be logged as delivered by
        // whoever they cared to name. Both fallbacks are unchanged.
        p_actor_name:
          (await rosterName(user)) ??
          (role === 'admin' ? (await tenantBrandForClient(scope.clientId)).name : 'Client'),
        p_actor_role: role,
        p_event_type: category === 'receipt' ? 'receipt_uploaded' : 'file_uploaded',
        p_title:
          category === 'receipt'
            ? `Payment receipt uploaded`
            : `${fileName} uploaded`,
        p_body: null,
        p_meta: { file_id: fileRecord.id, size: fileRecord.file_size, mime },
      })
    } catch (err) {
      // Non-critical — the upload succeeded — but the ledger gap must be
      // visible (I-10): a commit with no activity entry is how provenance
      // quietly rots.
      captureError(err, { where: 'files/commit log_activity', fileId: fileRecord.id })
    }

    return NextResponse.json({ file: fileRecord })
  } catch (err: any) {
    captureError(err, { where: 'files/commit' })
    return NextResponse.json(
      { error: err.message ?? 'Failed to save file.' },
      { status: 500 }
    )
  }
}
