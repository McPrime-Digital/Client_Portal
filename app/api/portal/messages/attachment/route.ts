import { portalClientId } from '@/lib/team'
import { isAdmin, userOrgId } from '@/lib/auth/role'
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

    const { ref, file_id } = await req.json()

    // Preferred path since Batch 14: a real files id (message_attachments).
    // Authorization comes from the ROW — its client for portal users, its
    // org for admins — not from parsing a path.
    if (file_id && typeof file_id === 'string') {
      const { data: f } = await supabaseAdmin
        .from('files')
        .select('id, bucket, file_path, client_id, organization_id')
        .eq('id', file_id)
        .maybeSingle()
      if (!f) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      if (isAdmin(user)) {
        if (f.organization_id !== userOrgId(user)) {
          return NextResponse.json({ error: 'Access denied' }, { status: 403 })
        }
      } else if (f.client_id !== await portalClientId(user)) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }
      const url = f.bucket === 'r2'
        ? await getSignedDownloadUrl(f.file_path, 3600, { disposition: 'inline' })
        : (await supabaseAdmin.storage.from(f.bucket).createSignedUrl(f.file_path, 3600)).data?.signedUrl
      if (!url) return NextResponse.json({ error: 'Could not sign' }, { status: 500 })
      return NextResponse.json({ url })
    }

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
    if (!isAdmin(user)) {
      const { data: clientRow } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('id', await portalClientId(user))
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
