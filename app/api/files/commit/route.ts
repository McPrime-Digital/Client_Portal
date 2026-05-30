import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

// Step 2 of the direct-to-R2 upload: the browser has PUT the file to
// R2 using the presigned URL; now persist the files-table row. We
// re-authorize (the presigned URL is short-lived but commit is a
// separate request) and verify the key belongs to the claimed
// project, so a client can't register an object outside their scope.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const {
      projectId,
      key,
      fileName,
      fileSize,
      contentType,
      direction: requestedDirection,
    } = await req.json()

    if (!projectId || !key || !fileName) {
      return NextResponse.json(
        { error: 'projectId, key and fileName are required.' },
        { status: 400 }
      )
    }

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

    // The key must live under the client+project prefix minted by
    // /presign — recomputed from the caller's own scope so a client
    // can't register an object outside it.
    const expectedPrefix = clientId ? `${clientId}/${projectId}` : projectId
    if (!key.startsWith(`${expectedPrefix}/`)) {
      return NextResponse.json({ error: 'Invalid file key.' }, { status: 400 })
    }

    // Clients can only post client-uploads; admins deliver by default.
    const direction =
      role === 'admin'
        ? requestedDirection || 'delivery'
        : 'client-upload'

    const mime = contentType || 'application/octet-stream'

    const { data: fileRecord, error: insertError } = await supabaseAdmin
      .from('files')
      .insert({
        project_id: projectId,
        client_id: clientId,
        file_name: fileName,
        file_path: key,
        file_size: typeof fileSize === 'number' ? fileSize : 0,
        file_type: mime,
        mime_type: mime,
        direction,
        bucket: 'r2',
        uploaded_by: user.id,
      })
      .select()
      .single()

    if (insertError) {
      throw new Error(insertError.message)
    }

    // Activity log — best effort, never fail the upload.
    try {
      await supabaseAdmin.rpc('log_activity', {
        p_project_id: projectId,
        p_client_id: clientId,
        p_actor_id: user.id,
        p_actor_name:
          user.user_metadata?.name ??
          (role === 'admin' ? 'McPrime Digital' : 'Client'),
        p_actor_role: role,
        p_event_type: 'file_uploaded',
        p_title: `${fileName} uploaded`,
        p_body: null,
        p_meta: {
          file_id: fileRecord.id,
          size: fileRecord.file_size,
          mime,
          storage: 'cloudflare_r2',
        },
      })
    } catch {
      // RPC not present / non-critical — ignore.
    }

    return NextResponse.json({ file: fileRecord })
  } catch (err: any) {
    console.error('[commit] error:', err)
    return NextResponse.json(
      { error: err.message ?? 'Failed to save file.' },
      { status: 500 }
    )
  }
}
