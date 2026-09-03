import { userRole } from '@/lib/auth/role'
import { createClient } from '@/lib/supabase/server'
import { resolveUploadScope } from '@/lib/uploadScope'
import { clientMembershipOf } from '@/lib/team'
import { clientCan } from '@/lib/permissions'
import {
  createMultipartUpload,
  signUploadParts,
  listUploadedParts,
  completeMultipartUpload,
  abortMultipartUpload,
  MULTIPART_PART_SIZE,
} from '@/lib/r2'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

/**
 * Resumable direct-to-R2 upload — the pause/resume/cancel half of the
 * uploader (Batch 24).
 *
 * `/api/files/presign` still serves small files with one PUT. Above
 * MULTIPART_MIN_FILE the browser drives a multipart upload through here, and
 * the difference the user sees is that a 3 GB upload can be paused, survives
 * a dropped connection, and can be cancelled without leaving billed bytes in
 * the bucket.
 *
 * THE KEY IS ALWAYS SERVER-GENERATED AND RE-VERIFIED. `create` mints it under
 * the caller's resolved scope prefix; every later action re-resolves that
 * scope and refuses a key outside it, exactly as `/api/files/commit` does. A
 * client cannot sign a part into another company's prefix, and cannot abort
 * or complete someone else's upload.
 *
 * Completion does NOT trust a browser-supplied part list — see the ETag note
 * in lib/r2.ts. The server asks R2 which parts it holds and completes with
 * those, so the object is whatever actually arrived.
 */

const Body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    projectId: z.string().uuid().optional(),
    clientId: z.string().uuid().optional(),
    roomId: z.string().uuid().optional(),
    fileName: z.string().min(1).max(512),
    contentType: z.string().max(255).optional(),
    fileSize: z.number().int().nonnegative().optional(),
  }),
  z.object({
    action: z.literal('sign'),
    projectId: z.string().uuid().optional(),
    clientId: z.string().uuid().optional(),
    roomId: z.string().uuid().optional(),
    key: z.string().min(1).max(1024),
    uploadId: z.string().min(1).max(1024),
    partNumbers: z.array(z.number().int().min(1).max(10_000)).min(1).max(50),
  }),
  z.object({
    action: z.literal('complete'),
    projectId: z.string().uuid().optional(),
    clientId: z.string().uuid().optional(),
    roomId: z.string().uuid().optional(),
    key: z.string().min(1).max(1024),
    uploadId: z.string().min(1).max(1024),
    expectedParts: z.number().int().min(1).max(10_000).optional(),
  }),
  z.object({
    action: z.literal('abort'),
    projectId: z.string().uuid().optional(),
    clientId: z.string().uuid().optional(),
    roomId: z.string().uuid().optional(),
    key: z.string().min(1).max(1024),
    uploadId: z.string().min(1).max(1024),
  }),
])

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid multipart request.' }, { status: 400 })
    }
    const input = parsed.data

    const role = userRole(user)
    // See the note in /api/files/presign: a room upload is gated by the seat,
    // not by the company capability an external collaborator does not have.
    if (role === 'client' && !input.roomId) {
      const membership = await clientMembershipOf(user)
      if (!membership || !clientCan(membership.role, 'upload', membership.extraCaps)) {
        return NextResponse.json(
          { error: 'Your role is view-only — uploads are not available.' },
          { status: 403 }
        )
      }
    }

    const scope = await resolveUploadScope(role, user.id, input.projectId, input.clientId, input.roomId)
    if ('error' in scope) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    if (input.action === 'create') {
      const ext = input.fileName.includes('.') ? input.fileName.split('.').pop() : ''
      const safeName =
        `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` + (ext ? `.${ext}` : '')
      const key = `${scope.prefix}/${safeName}`
      const contentType = input.contentType || 'application/octet-stream'
      const uploadId = await createMultipartUpload(key, contentType)
      return NextResponse.json({ key, uploadId, contentType, partSize: MULTIPART_PART_SIZE })
    }

    // Every other action names a key the caller must already own.
    if (!input.key.startsWith(`${scope.prefix}/`)) {
      return NextResponse.json({ error: 'Invalid file key.' }, { status: 400 })
    }

    if (input.action === 'sign') {
      const urls = await signUploadParts(input.key, input.uploadId, input.partNumbers)
      return NextResponse.json({ urls })
    }

    if (input.action === 'abort') {
      await abortMultipartUpload(input.key, input.uploadId)
      return NextResponse.json({ ok: true })
    }

    // complete
    const parts = await listUploadedParts(input.key, input.uploadId)
    if (parts.length === 0) {
      return NextResponse.json({ error: 'No parts were uploaded.' }, { status: 400 })
    }
    // A short part list means the browser stopped early. Completing anyway
    // writes a TRUNCATED object that looks like a successful upload — the
    // worst available outcome, because nothing downstream can tell.
    if (input.expectedParts != null && parts.length !== input.expectedParts) {
      await abortMultipartUpload(input.key, input.uploadId).catch(() => {})
      return NextResponse.json(
        {
          error:
            `Upload incomplete — R2 holds ${parts.length} of ${input.expectedParts} parts. ` +
            `Nothing was saved; please try again.`,
        },
        { status: 409 }
      )
    }
    await completeMultipartUpload(input.key, input.uploadId, parts)
    return NextResponse.json({ ok: true, key: input.key, parts: parts.length })
  } catch (err) {
    console.error('[files/multipart] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Multipart upload failed.' },
      { status: 500 }
    )
  }
}
