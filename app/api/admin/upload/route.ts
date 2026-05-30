import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { maybeTranscodeAudio } from '@/lib/transcode'

export async function POST(req: NextRequest) {
  // Verify admin
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.user_metadata?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    const projectId = formData.get('project_id') as string
    const clientId = formData.get('client_id') as string

    if (!file || !projectId || !clientId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Transcode Safari-incompatible audio (webm/opus voice notes) to .m4a.
    const tx = await maybeTranscodeAudio({
      bytes: new Uint8Array(await file.arrayBuffer()),
      name: file.name,
      mime: file.type || 'application/octet-stream',
    })
    const buffer = Buffer.from(tx.bytes)
    const path = `${clientId}/${projectId}/${Date.now()}-${tx.name}`

    // Upload using service role — bypasses storage RLS
    const { error: uploadError } = await supabaseAdmin.storage
      .from('deliverables')
      .upload(path, buffer, {
        contentType: tx.mime,
        upsert: false,
      })

    if (uploadError) throw uploadError

    // Insert file record
    const { data: fileRecord, error: insertError } = await supabaseAdmin
      .from('files')
      .insert({
        project_id: projectId,
        client_id: clientId,
        file_name: tx.name,
        file_path: path,
        file_size: tx.bytes.byteLength,
        file_type: tx.mime,
        mime_type: tx.mime,
        direction: 'delivery',
        bucket: 'deliverables',
        uploaded_by: user.id,
      })
      .select()
      .single()

    if (insertError) throw insertError

    return NextResponse.json({ file: fileRecord })
  } catch (err: any) {
    console.error('[upload] error:', err)
    return NextResponse.json({ error: err.message ?? 'Upload failed' }, { status: 500 })
  }
}
