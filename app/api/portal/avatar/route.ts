import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

// ~10 year signed URL — effectively permanent for a logo/avatar.
const LONG_EXPIRY = 60 * 60 * 24 * 365 * 10

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

    // Resolve the caller's client record (service role — no RLS dependency).
    const { data: client } = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (!client) {
      return NextResponse.json(
        { error: 'Client not found.' },
        { status: 404 }
      )
    }

    const formData = await req.formData()
    const file = formData.get('file') as File
    if (!file) {
      return NextResponse.json(
        { error: 'No file provided.' },
        { status: 400 }
      )
    }

    if (!file.type.startsWith('image/')) {
      return NextResponse.json(
        { error: 'Logo must be an image.' },
        { status: 400 }
      )
    }

    const ext = file.name.includes('.')
      ? file.name.split('.').pop()
      : 'png'
    const path = `${client.id}/avatar-${Date.now()}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const { error: uploadError } = await supabaseAdmin.storage
      .from('client-files')
      .upload(path, buffer, {
        contentType: file.type,
        upsert: true,
      })

    if (uploadError) throw uploadError

    const { data: signed, error: signError } =
      await supabaseAdmin.storage
        .from('client-files')
        .createSignedUrl(path, LONG_EXPIRY)

    if (signError) throw signError

    const avatarUrl = signed.signedUrl

    const { error: updateError } = await supabaseAdmin
      .from('clients')
      .update({ avatar_url: avatarUrl })
      .eq('id', client.id)

    if (updateError) throw updateError

    return NextResponse.json({ avatar_url: avatarUrl })
  } catch (err: any) {
    console.error('[avatar] error:', err)
    return NextResponse.json(
      { error: err.message ?? 'Upload failed.' },
      { status: 500 }
    )
  }
}
