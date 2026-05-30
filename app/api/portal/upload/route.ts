import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { maybeTranscodeAudio } from '@/lib/transcode'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Use service role to bypass RLS on clients table
  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    const projectId = formData.get('project_id') as string
    const direction = (formData.get('direction') as string) || 'client-upload'

    if (!file || !projectId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Verify this project belongs to this client
    const { data: project } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('client_id', client.id)
      .single()

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const bucket = direction === 'delivery' ? 'deliverables' : 'client-uploads'

    // Transcode Safari-incompatible audio (webm/opus voice notes) to .m4a.
    const tx = await maybeTranscodeAudio({
      bytes: new Uint8Array(await file.arrayBuffer()),
      name: file.name,
      mime: file.type || 'application/octet-stream',
    })
    const buffer = Buffer.from(tx.bytes)
    const path = `${client.id}/${projectId}/${Date.now()}-${tx.name}`

    // Upload using service role — bypasses storage RLS
    const { error: uploadError } = await supabaseAdmin.storage
      .from(bucket)
      .upload(path, buffer, {
        contentType: tx.mime,
        upsert: false,
      })

    if (uploadError) throw uploadError

    // Insert file record using service role
    const { data: fileRecord, error: insertError } = await supabaseAdmin
      .from('files')
      .insert({
        project_id: projectId,
        client_id: client.id,
        file_name: tx.name,
        file_path: path,
        file_size: tx.bytes.byteLength,
        file_type: tx.mime,
        mime_type: tx.mime,
        direction,
        bucket,
        uploaded_by: user.id,
      })
      .select()
      .single()

    if (insertError) throw insertError

    return NextResponse.json({ file: fileRecord })
  } catch (err: any) {
    console.error('[portal-upload] error:', err)
    return NextResponse.json({ error: err.message ?? 'Upload failed' }, { status: 500 })
  }
}
