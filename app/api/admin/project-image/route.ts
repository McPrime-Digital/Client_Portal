import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

// ~10 year signed URL — effectively permanent for a small project thumbnail.
const LONG_EXPIRY = 60 * 60 * 24 * 365 * 10

// Admin-only: upload a small project image to Supabase Storage and return a
// long-lived signed URL. Mirrors the avatar route so the URL never expires in
// practice (unlike R2 presigned URLs, which cap at 7 days). The caller saves the
// returned image_url on the project (create-project or update_project).
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || user.user_metadata?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await req.formData()
    const file = formData.get('file') as File
    if (!file) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 })
    }
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Project image must be an image.' }, { status: 400 })
    }
    if (file.size > 6 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image must be under 6 MB.' }, { status: 400 })
    }

    const ext = file.name.includes('.') ? file.name.split('.').pop() : 'png'
    const path = `project-images/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const { error: uploadError } = await supabaseAdmin.storage
      .from('client-files')
      .upload(path, buffer, { contentType: file.type, upsert: true })
    if (uploadError) throw uploadError

    const { data: signed, error: signError } = await supabaseAdmin.storage
      .from('client-files')
      .createSignedUrl(path, LONG_EXPIRY)
    if (signError) throw signError

    return NextResponse.json({ image_url: signed.signedUrl })
  } catch (err: any) {
    console.error('[project-image] error:', err)
    return NextResponse.json({ error: err.message ?? 'Upload failed.' }, { status: 500 })
  }
}
