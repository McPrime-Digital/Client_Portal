import { userRole } from '@/lib/auth/role'
import { createClient } from '@/lib/supabase/server'
import { getSignedUploadUrl } from '@/lib/r2'
import { resolveUploadScope } from '@/lib/uploadScope'
import { clientMembershipOf } from '@/lib/team'
import { clientCan } from '@/lib/permissions'
import { NextRequest, NextResponse } from 'next/server'

// Step 1 of the direct-to-R2 upload: authorize the caller and hand back
// a presigned PUT URL. No file bytes pass through this function, so
// uploads aren't bound by the host's request-body size limit. The object
// key is generated here (never supplied by the client) and namespaced by
// client/project so a client cannot point the upload at someone else's
// path. Supports project-scoped uploads (most files) and client-scoped
// uploads (e.g. an invoice receipt with no project).
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { projectId, clientId: bodyClientId, fileName, contentType } = await req.json()
    if (!fileName) {
      return NextResponse.json({ error: 'fileName is required.' }, { status: 400 })
    }

    const role = userRole(user)
    if (role === 'client') {
      const membership = await clientMembershipOf(user)
      if (!membership || !clientCan(membership.role, 'upload', membership.extraCaps)) {
        return NextResponse.json({ error: 'Your role is view-only — uploads are not available.' }, { status: 403 })
      }
    }
    const scope = await resolveUploadScope(role, user.id, projectId, bodyClientId)
    if ('error' in scope) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    const ext = fileName.includes('.') ? fileName.split('.').pop() : ''
    const safeName =
      `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` +
      (ext ? `.${ext}` : '')
    const key = `${scope.prefix}/${safeName}`

    const type = contentType || 'application/octet-stream'
    const uploadUrl = await getSignedUploadUrl(key, type)

    return NextResponse.json({ uploadUrl, key, contentType: type })
  } catch (err: any) {
    console.error('[presign] error:', err)
    return NextResponse.json(
      { error: err.message ?? 'Failed to create upload URL.' },
      { status: 500 }
    )
  }
}
