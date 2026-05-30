import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getSignedUploadUrl } from '@/lib/r2'
import { NextRequest, NextResponse } from 'next/server'

// Step 1 of the direct-to-R2 upload: authorize the caller for the
// target project and hand back a presigned PUT URL. No file bytes
// pass through this function, so uploads aren't bound by the host's
// request-body size limit. The object key is generated here (never
// supplied by the client) and namespaced by project so a client
// cannot point the upload at someone else's path.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { projectId, fileName, contentType } = await req.json()
    if (!projectId || !fileName) {
      return NextResponse.json(
        { error: 'projectId and fileName are required.' },
        { status: 400 }
      )
    }

    // Verify the project exists and authorize the caller.
    const { data: project } = await supabaseAdmin
      .from('projects')
      .select('id, client_id')
      .eq('id', projectId)
      .single()

    if (!project) {
      return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
    }

    const role = user.user_metadata?.role ?? 'client'
    let clientId: string | null = project.client_id ?? null
    if (role !== 'admin') {
      const { data: clientRow } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('user_id', user.id)
        .single()

      if (!clientRow || clientRow.id !== project.client_id) {
        return NextResponse.json({ error: 'Access denied.' }, { status: 403 })
      }
      clientId = clientRow.id
    }

    // Collision-safe key namespaced by client+project, matching the
    // convention the rest of the app assumes (e.g. the message-
    // attachment route derives the owning client from the first path
    // segment). Authorization on commit re-checks this prefix.
    const ext = fileName.includes('.') ? fileName.split('.').pop() : ''
    const safeName =
      `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` +
      (ext ? `.${ext}` : '')
    const prefix = clientId ? `${clientId}/${projectId}` : projectId
    const key = `${prefix}/${safeName}`

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
