import { isAdmin } from '@/lib/auth/role'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getSignedDownloadUrl } from '@/lib/r2'
import { NextRequest, NextResponse } from 'next/server'

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

    const { fileId, inline } = await req.json()
    if (!fileId) {
      return NextResponse.json(
        { error: 'fileId required' },
        { status: 400 }
      )
    }

    const { data: file } = await supabaseAdmin
      .from('files')
      .select('id, file_path, file_name, file_size, mime_type, file_type, bucket, client_id')
      .eq('id', fileId)
      .single()

    if (!file) {
      return NextResponse.json(
        { error: 'File not found' },
        { status: 404 }
      )
    }

    // Authorize: admins can read any file; clients only their own.
    if (!isAdmin(user)) {
      const { data: clientRow } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('user_id', user.id)
        .single()

      if (!clientRow || clientRow.id !== file.client_id) {
        return NextResponse.json(
          { error: 'Access denied' },
          { status: 403 }
        )
      }
    }

    // `inline` URLs power the in-app viewer (render in place,
    // longer-lived so media seeking keeps working); the default
    // attachment URLs power downloads.
    const mimeType = file.mime_type || file.file_type || undefined

    // Branch by storage backend: R2 for File Vault uploads,
    // Supabase Storage for message attachments / legacy files.
    let signedUrl: string
    if (file.bucket === 'r2') {
      signedUrl = await getSignedDownloadUrl(
        file.file_path,
        inline ? 3600 : 120,
        {
          disposition: inline ? 'inline' : 'attachment',
          fileName: file.file_name,
          contentType: inline ? mimeType : undefined,
        }
      )
    } else {
      const { data, error } = await supabaseAdmin.storage
        .from(file.bucket)
        .createSignedUrl(file.file_path, 3600, {
          // Supabase renders inline by default; only force a
          // download when this isn't for the viewer.
          download: inline ? false : file.file_name,
        })
      if (error) throw error
      signedUrl = data.signedUrl
    }

    // Best-effort download counter — viewing isn't a download.
    if (!inline) {
      try {
        await supabaseAdmin.rpc('increment_download_count', {
          file_id: fileId,
        })
      } catch {
        // non-critical
      }
    }

    return NextResponse.json({
      signedUrl,
      fileName: file.file_name,
      mimeType: mimeType ?? null,
      fileSize: file.file_size ?? null,
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? 'Server error' },
      { status: 500 }
    )
  }
}
