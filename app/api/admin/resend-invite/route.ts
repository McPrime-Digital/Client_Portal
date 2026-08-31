import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isAdmin, userOrgId } from '@/lib/auth/role'
import { sendTenantInvite } from '@/lib/email/invite'
import { captureError } from '@/lib/errors'

// Re-send a client company owner's invite.
//
// Two things changed here in Batch 10.3, and the second was not in the brief:
//
//  1. The invite is minted with generateLink() and delivered by the application
//     with the STUDIO's branding (S-C CM-5), instead of going out through
//     Supabase's mailer on a template that is global to the whole project.
//
//  2. THE CLIENTS READ AND WRITE WERE CROSS-TENANT. Both were keyed on email
//     alone — `.select('*').eq('email', …).single()` and
//     `.update(…).eq('email', …)` — with no organization filter. `clients.email`
//     is org-scoped as of 0018, so two studios may legitimately hold the same
//     client address: the read would then fail PGRST116 on multiple rows, and
//     the update would bump another studio's invite counter. Both are scoped to
//     the caller's org now (T-5, I-9).
//
// The inline service-role client this route used to construct is gone with it;
// it was one of the two sites the SUPABASE_SERVICE_ROLE_KEY lint rule exists to
// catch, and it no longer needs the exemption.

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { email } = await req.json().catch(() => ({ email: null }))
  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Email is required.' }, { status: 400 })
  }

  const cleanEmail = email.trim().toLowerCase()
  const orgId = userOrgId(user)

  try {
    // Scoped to this studio's own client companies. A resend for an address
    // this org does not serve is a 404, not a silent send to someone else's
    // client.
    const { data: existing, error: readError } = await supabaseAdmin
      .from('clients')
      .select('id, invite_count')
      .eq('organization_id', orgId)
      .eq('email', cleanEmail)
      .maybeSingle()
    if (readError) throw readError
    if (!existing) {
      return NextResponse.json({ error: 'No client with that email.' }, { status: 404 })
    }

    const { error: inviteError, delivered } = await sendTenantInvite({
      email: cleanEmail,
      orgId,
      audience: 'client_owner',
      data: { role: 'client' },
    })
    if (inviteError) {
      return NextResponse.json({ error: inviteError.message ?? 'Could not resend.' }, { status: 500 })
    }

    // Bump invited_at + invite_count so the UI can show "Resent". Keyed by id
    // now, so it cannot reach another tenant's row even if the org filter above
    // were ever removed.
    const { error: updateError } = await supabaseAdmin
      .from('clients')
      .update({
        invited_at: new Date().toISOString(),
        invite_count: (existing.invite_count ?? 1) + 1,
      })
      .eq('id', existing.id)
    if (updateError) throw updateError

    // `delivered` is reported rather than swallowed: under generateLink() the
    // link is minted before the send, so "resent" and "actually arrived" are
    // now two different facts (S-C §6).
    return NextResponse.json({
      success: true,
      delivered,
      message: delivered
        ? `Invite resent to ${cleanEmail}`
        : `Invite regenerated, but the email could not be sent. Check the sending domain.`,
    })
  } catch (err) {
    captureError(err, { where: 'admin/resend-invite', orgId })
    return NextResponse.json({ error: 'Failed to resend invite.' }, { status: 500 })
  }
}
