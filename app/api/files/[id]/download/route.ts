import { isAdmin } from '@/lib/auth/role'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getSignedDownloadUrl } from '@/lib/r2'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(
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
      .select('id, file_path, file_name, bucket, client_id')
      .eq('id', id)
      .single()

    if (!file) {
      return NextResponse.json(
        { error: 'File not found.' },
        { status: 404 }
      )
    }

    // Authorize non-admins to their own files only.
    if (!isAdmin(user)) {
      const { data: clientRow } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('user_id', user.id)
        .single()

      if (!clientRow || clientRow.id !== file.client_id) {
        return NextResponse.json(
          { error: 'Access denied.' },
          { status: 403 }
        )
      }
    }

    let url: string
    if (file.bucket === 'r2') {
      url = await getSignedDownloadUrl(file.file_path, 120)
    } else {
      const { data, error } = await supabaseAdmin.storage
        .from(file.bucket)
        .createSignedUrl(file.file_path, 3600)
      if (error) throw error
      url = data.signedUrl
    }

    return NextResponse.json({ url, name: file.file_name })
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    )
  }
}
