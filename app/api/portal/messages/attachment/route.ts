import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getSignedDownloadUrl } from '@/lib/r2'
import { NextRequest, NextResponse } from 'next/server'

// Resolves a chat attachment reference ("bucket::path") to a short-lived
// signed URL, server-side. The browser client can't reliably sign
// `client-uploads` objects (storage RLS), so we authorize here (the
// owning client, or any admin) and sign with the service role — the
// same pattern as /api/files/signed-url.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { ref } = await req.json()
    if (!ref || typeof ref !== 'string') {
      return NextResponse.json({ error: 'ref required' }, { status: 400 })
    }

    // Legacy/plain URLs (no bucket marker) are already usable as-is.
    if (!ref.includes('::')) {
      return NextResponse.json({ url: ref })
    }

    const sep = ref.indexOf('::')
    const bucket = ref.slice(0, sep)
    const path = ref.slice(sep + 2)

    // Object keys are `<clientId>/<projectId>/...`. Authorize the owning
    // client; admins may resolve any attachment.
    const clientId = path.split('/')[0]
    if (user.user_metadata?.role !== 'admin') {
      const { data: clientRow } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('user_id', user.id)
        .single()
      if (!clientRow || clientRow.id !== clientId) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }
    }

    let url: string
    if (bucket === 'r2') {
      url = await getSignedDownloadUrl(path, 3600, { disposition: 'inline' })
    } else {
      const { data, error } = await supabaseAdmin.storage
        .from(bucket)
        .createSignedUrl(path, 3600)
      if (error) throw error
      url = data.signedUrl
    }

    return NextResponse.json({ url })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
