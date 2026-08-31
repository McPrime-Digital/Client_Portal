import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isAdmin, userOrgId } from '@/lib/auth/role'
import { orgRolesOf } from '@/lib/team'
import { orgCan } from '@/lib/permissions'
import { captureError } from '@/lib/errors'

// The studio's OWN logo — the mark its clients see (S0-B §2, S-C §6).
//
// WHY THIS ROUTE EXISTS AT ALL: `organizations.logo_url` has existed since
// migration 0001 and NOTHING in the application ever wrote it, which is why
// every row is null. Batch 9.2 wired the portal to read a logo that no studio
// could set. This is the missing writer, not a new feature.
//
// Scope note: this is the STUDIO's logo, keyed by the caller's organization.
// It is not a client company's avatar (`/api/portal/avatar`, keyed by client)
// and not a project image. Three different marks, three different owners.
//
// TWO CLIENTS, DELIBERATELY SPLIT (AD-001, and CLAUDE.md's rule that a NEW
// surface follows AD-001 rather than the surrounding pattern):
//
//   · the `organizations` row is written with the COOKIE-BOUND USER CLIENT, so
//     `organizations_admin_write` (0021:393) is the tenant boundary —
//     `id = current_org() and is_org_admin()`. A forgotten `.eq()` here is a
//     failed write, not another studio's logo replaced.
//   · Supabase STORAGE is written with the service role, because
//     `storage.objects` carries no policy for an org-prefixed path and adding
//     one is S2 §7 work, not this route's. That import is the only reason this
//     file is on the I-8 allowlist, and the entry says so.
//
// The RLS write is checked for zero rows rather than assumed. An admin whose
// JWT lacks `organization_id` matches no row and RLS returns success with
// nothing updated — the silent-empty failure AD-001 exists to prevent. Here it
// surfaces as a 500 with a trace.

// ~10 years. Long enough that a logo embedded in an email does not rot in an
// archived inbox, which is the constraint a shorter expiry would break
// (S-C §6). Matches `app/api/portal/avatar/route.ts:7`.
const LONG_EXPIRY = 60 * 60 * 24 * 365 * 10

const MAX_BYTES = 2 * 1024 * 1024

async function requireOrgSettingsAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  // The roster decides, not the claim (S2). `org_settings` is the capability
  // that already governs business identity elsewhere in the matrix.
  const roles = await orgRolesOf(user)
  if (!orgCan(roles, 'org_settings')) {
    return {
      error: NextResponse.json(
        { error: 'Only org owners and admins can change the studio logo.' },
        { status: 403 }
      ),
    }
  }
  return { supabase, user, orgId: userOrgId(user) }
}

/** Write `logo_url` through RLS and prove a row was actually affected. */
async function writeLogoUrl(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  logoUrl: string | null
) {
  const { data, error } = await supabase
    .from('organizations')
    .update({ logo_url: logoUrl, updated_at: new Date().toISOString() })
    .eq('id', orgId)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error(
      `organizations update matched no row for ${orgId}. RLS denied it — most ` +
        `likely the session's organization_id claim is missing or stale (0022).`
    )
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireOrgSettingsAdmin()
  if (gate.error) return gate.error
  const { supabase, orgId } = gate

  try {
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 })
    }
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Logo must be an image.' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Logo must be under 2 MB.' }, { status: 400 })
    }

    // Server-generated key, never the client's filename — same rule as the
    // upload presign path. The org prefix is what keeps one studio's logo out
    // of another's folder.
    const ext =
      (file.name.split('.').pop() ?? 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
    const path = `org/${orgId}/logo-${Date.now()}.${ext}`

    const { error: uploadError } = await supabaseAdmin.storage
      .from('client-files')
      .upload(path, Buffer.from(await file.arrayBuffer()), {
        contentType: file.type,
        upsert: true,
      })
    if (uploadError) throw uploadError

    const { data: signed, error: signError } = await supabaseAdmin.storage
      .from('client-files')
      .createSignedUrl(path, LONG_EXPIRY)
    if (signError) throw signError

    await writeLogoUrl(supabase, orgId, signed.signedUrl)

    return NextResponse.json({ logo_url: signed.signedUrl })
  } catch (err) {
    captureError(err, { where: 'studio/organization/logo:POST', orgId })
    return NextResponse.json({ error: 'Could not upload the logo.' }, { status: 500 })
  }
}

export async function DELETE() {
  const gate = await requireOrgSettingsAdmin()
  if (gate.error) return gate.error
  const { supabase, orgId } = gate

  try {
    // Clear the field first: the row is what the app reads, and a stranded
    // blob is cheaper than a logo that renders after the studio removed it.
    await writeLogoUrl(supabase, orgId, null)

    try {
      const { data: objects } = await supabaseAdmin.storage
        .from('client-files')
        .list(`org/${orgId}`)
      if (objects?.length) {
        await supabaseAdmin.storage
          .from('client-files')
          .remove(objects.map((o) => `org/${orgId}/${o.name}`))
      }
    } catch (err) {
      // Blob cleanup is best-effort, but it reaches the sink rather than
      // vanishing (I-10) — orphans are a storage-cost problem, not a silent one.
      captureError(err, { where: 'studio/organization/logo:DELETE cleanup', orgId })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    captureError(err, { where: 'studio/organization/logo:DELETE', orgId })
    return NextResponse.json({ error: 'Could not remove the logo.' }, { status: 500 })
  }
}
