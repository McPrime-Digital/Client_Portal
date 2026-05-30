import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { uploadToR2 } from '@/lib/r2'
import { maybeTranscodeAudio } from '@/lib/transcode'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const formData = await req.formData()
    const file = formData.get('file') as File
    const projectId = formData.get('projectId') as string
    const category =
      (formData.get('category') as string) || 'general'
    const description =
      (formData.get('description') as string) || ''
    const isFinalFlag =
      (formData.get('isFinal') as string) === 'true'

    if (!file || !projectId) {
      return NextResponse.json(
        { error: 'File and projectId are required.' },
        { status: 400 }
      )
    }

    // No file size cap — R2 supports up to 5TB via multipart.

    const role = user.user_metadata?.role ?? 'client'

    // Verify the project exists, and authorize the caller.
    // Admin: any project. Client: only their own project.
    const { data: project } = await supabaseAdmin
      .from('projects')
      .select('id, client_id, title')
      .eq('id', projectId)
      .single()

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found.' },
        { status: 404 }
      )
    }

    let clientId: string | null = project.client_id ?? null

    if (role !== 'admin') {
      const { data: clientRow } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('user_id', user.id)
        .single()

      if (!clientRow || clientRow.id !== project.client_id) {
        return NextResponse.json(
          { error: 'Access denied.' },
          { status: 403 }
        )
      }
      clientId = clientRow.id
    }

    // Transcode Safari-incompatible audio (webm/opus voice notes) to .m4a
    // before it lands in the vault, so it plays on every browser.
    const tx = await maybeTranscodeAudio({
      bytes: new Uint8Array(await file.arrayBuffer()),
      name: file.name,
      mime: file.type || 'application/octet-stream',
    })
    const fileName = tx.name
    const buffer = tx.bytes
    const contentType = tx.mime

    // Collision-safe R2 key: projectId/timestamp-random.ext
    const ext = fileName.includes('.') ? fileName.split('.').pop() : ''
    const safeName =
      `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` +
      (ext ? `.${ext}` : '')
    const storageKey = `${projectId}/${safeName}`

    // Upload to Cloudflare R2 (auto multipart for files > 5GB)
    await uploadToR2(storageKey, buffer, contentType)

    const isFinal = isFinalFlag || category === 'deliverable'

    // Persist metadata using the REAL files-table columns.
    // bucket = 'r2' marks this as a Cloudflare R2 object so the
    // download/delete routes know to use R2 (vs Supabase Storage).
    const { data: fileRecord, error: dbError } =
      await supabaseAdmin
        .from('files')
        .insert({
          project_id: projectId,
          client_id: clientId,
          file_name: fileName,
          file_path: storageKey,
          file_size: buffer.byteLength,
          file_type: contentType,
          mime_type: contentType,
          direction: role === 'admin' ? 'delivery' : 'client-upload',
          bucket: 'r2',
          is_final: isFinal,
          uploaded_by: user.id,
          uploaded_by_role: role,
          uploaded_by_name:
            user.user_metadata?.name ??
            (role === 'admin' ? 'McPrime Digital' : 'Client'),
          description: description || null,
        })
        .select()
        .single()

    if (dbError) {
      throw new Error(dbError.message)
    }

    // Activity log — best effort, never fail the upload.
    try {
      await supabaseAdmin.rpc('log_activity', {
        p_project_id: projectId,
        p_client_id: clientId,
        p_actor_id: user.id,
        p_actor_name: user.user_metadata?.name ?? role,
        p_actor_role: role,
        p_event_type: 'file_uploaded',
        p_title: `${fileName} uploaded`,
        p_body:
          category !== 'general' ? `Category: ${category}` : null,
        p_meta: {
          file_id: fileRecord.id,
          size: buffer.byteLength,
          mime: contentType,
          storage: 'cloudflare_r2',
        },
      })
    } catch {
      // RPC not present / non-critical — ignore.
    }

    return NextResponse.json({ success: true, file: fileRecord })
  } catch (err: any) {
    console.error('Upload error:', err)
    return NextResponse.json(
      { error: err.message ?? 'Upload failed.' },
      { status: 500 }
    )
  }
}
