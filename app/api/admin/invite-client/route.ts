import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isAdmin, userOrgId } from '@/lib/auth/role'
import { sendTenantInvite } from '@/lib/email/invite'

export async function POST(request: NextRequest) {
  try {
    // Verify the requesting user is admin
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || !isAdmin(user)) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const {
      name,
      email,
      company,
      phone,
      notes,
      projectId,
    } = await request.json()

    if (!name?.trim() || !email?.trim()) {
      return NextResponse.json(
        { error: 'Name and email are required.' },
        { status: 400 }
      )
    }

    const cleanEmail = email.trim().toLowerCase()

    // Duplicate check, scoped to the CALLER'S tenant (T-2), matching
    // create-client:60. Unscoped — which this was — it reports another studio's
    // client as a collision, which both blocks a legitimate invite and lets an
    // admin enumerate another studio's client roster one probe at a time. It
    // also used `.single()`, which errors on zero rows rather than returning
    // null; `.maybeSingle()` is the shape that answers the question asked.
    const { data: existing } = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('organization_id', userOrgId(user))
      .eq('email', cleanEmail)
      .maybeSingle()

    if (existing) {
      return NextResponse.json(
        { error: 'A client with this email already exists.' },
        { status: 409 }
      )
    }

    // 1. Create the account and send the STUDIO-BRANDED invite (S-C CM-5).
    const { user: invitedUser, error: inviteError } =
      await sendTenantInvite({
        email: cleanEmail,
        orgId: userOrgId(user),
        audience: 'client_owner',
        data: { role: 'client', name: name.trim() },
      })

    if (inviteError || !invitedUser) {
      console.error('[invite-client] Invite error:', inviteError)
      return NextResponse.json(
        { error: inviteError?.message ?? 'Could not create the account.' },
        { status: 500 }
      )
    }

    // 2. Create client record in DB. No user_id — the column is retired by 0026;
    // the client_members row below is the only record of who the login is
    // (S1 §5.2). organization_id is STAMPED, not defaulted
    // (T-5, S1 §3): the column DEFAULT is McPrime's org, so an unstamped insert
    // files a second studio's client company inside tenant zero.
    const { data: clientRecord, error: clientError } =
      await supabaseAdmin
        .from('clients')
        .insert({
          name: name.trim(),
          email: cleanEmail,
          company: company?.trim() || null,
          phone: phone?.trim() || null,
          notes: notes?.trim() || null,
          organization_id: userOrgId(user),
          invited_at: new Date().toISOString(),
          invite_count: 1,
        })
        .select()
        .single()

    if (clientError || !clientRecord) {
      console.error('[invite-client] DB insert error:', clientError)
      return NextResponse.json(
        { error: 'Failed to create client record.' },
        { status: 500 }
      )
    }

    // 2a. The membership row — see the long note in create-client/route.ts.
    // client_members is the sole authority since Batch 6.8 (S1 §5.2); without
    // this row the invited company owner lands in an empty portal. Written
    // BEFORE the claim (Batch 7.5's ordering rule), and the org is taken off
    // the clients row we just wrote so the two cannot disagree.
    const { error: memberError } = await supabaseAdmin
      .from('client_members')
      .insert({
        client_id: clientRecord.id,
        organization_id: clientRecord.organization_id,
        user_id: invitedUser.id,
        name: name.trim(),
        email: cleanEmail,
        role: 'owner',
        status: 'active',
        scope_mode: 'all',
        invited_by: user.id,
        accepted_at: new Date().toISOString(),
      })

    if (memberError) {
      // No partial creation: the company row does not outlive the membership
      // insert that failed. The auth user is left alone (AD-003) and carries
      // no client_id claim, because 2b has not run yet.
      console.error('[invite-client] Membership insert failed:', memberError)
      await supabaseAdmin.from('clients').delete().eq('id', clientRecord.id)
      return NextResponse.json(
        { error: 'Failed to create client membership.' },
        { status: 500 }
      )
    }

    // 2b. Bind the invited auth user to its client + role in app_metadata
    // (service-role only, never user-editable) so authorization is secure.
    await supabaseAdmin.auth.admin.updateUserById(invitedUser.id, {
      app_metadata: { role: 'client', client_id: clientRecord.id, organization_id: clientRecord.organization_id },
    })

    // 3. Link to project if provided
    if (projectId && clientRecord) {
      await supabaseAdmin
        .from('projects')
        .update({ client_id: clientRecord.id })
        .eq('id', projectId)
    }

    // 4. Log activity (fire-and-forget)
    Promise.resolve(
      supabaseAdmin.rpc('log_activity', {
        p_project_id: projectId ?? null,
        p_client_id: clientRecord.id,
        p_actor_id: user.id,
        p_actor_name:
          user.user_metadata?.name ?? 'Admin',
        p_actor_role: 'admin',
        p_event_type: 'client_created',
        p_title:
          `${name.trim()} invited as a client`,
        p_body: company
          ? `Company: ${company}`
          : null,
        p_meta: { email: cleanEmail },
      })
    ).catch(() => {})

    return NextResponse.json({
      success: true,
      clientId: clientRecord.id,
      message:
        `Invite sent to ${cleanEmail}. ` +
        `They will receive a magic link to ` +
        `set up their account.`,
    })
  } catch (error: any) {
    console.error('[invite-client] Server error:', error)
    return NextResponse.json(
      {
        error:
          error.message ?? 'Failed to send invite.',
      },
      { status: 500 }
    )
  }
}
