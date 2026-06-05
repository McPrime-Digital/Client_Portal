import { isAdmin } from '@/lib/auth/role'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getR2ObjectStream } from '@/lib/r2'
import { NextRequest, NextResponse } from 'next/server'

// Streams a file's raw bytes back from the SAME origin so the
// in-app viewer can fetch() and parse them (docx, xlsx, zip,
// text) without R2/Supabase CORS getting in the way. Media,
// images and PDFs use the signed URL directly instead and never
// hit this route. Always served inline — never as a download.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: file } = await supabaseAdmin
      .from('files')
      .select('file_path, file_name, mime_type, file_type, bucket, client_id')
      .eq('id', id)
      .single()

    if (!file) {
      return NextResponse.json({ error: 'File not found.' }, { status: 404 })
    }

    // Authorize non-admins to their own files only — mirrors the
    // signed-url / download routes.
    if (!isAdmin(user)) {
      const { data: clientRow } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('user_id', user.id)
        .single()

      if (!clientRow || clientRow.id !== file.client_id) {
        return NextResponse.json({ error: 'Access denied.' }, { status: 403 })
      }
    }

    const mime = file.mime_type || file.file_type || 'application/octet-stream'

    let body: ReadableStream | Blob
    let contentLength: number | undefined

    if (file.bucket === 'r2') {
      const obj = await getR2ObjectStream(file.file_path)
      body = obj.stream
      contentLength = obj.contentLength
    } else {
      const { data, error } = await supabaseAdmin.storage
        .from(file.bucket)
        .download(file.file_path)
      if (error || !data) throw error ?? new Error('Download failed')
      body = data
      contentLength = data.size
    }

    const headers: Record<string, string> = {
      'Content-Type': mime,
      'Content-Disposition': 'inline',
      // Private, per-user content — never cache in shared proxies.
      'Cache-Control': 'private, max-age=300',
    }
    if (contentLength != null) headers['Content-Length'] = String(contentLength)

    return new Response(body, { headers })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
