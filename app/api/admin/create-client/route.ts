import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { isAdmin, userOrgId } from '@/lib/auth/role'
import { sendTenantInvite } from '@/lib/email/invite'

// ONE message for every "this address is taken" outcome, whether the address
// belongs to this tenant's client, to another tenant's, or to an auth user we
// cannot see. Auth users are global while clients are per-tenant, so the auth
// layer's own error text is a disclosure channel of its own — it is collapsed
// into this same message and status below.
const EMAIL_TAKEN = 'A client with this email already exists.'

// Supabase reports an existing auth user differently across its invite and
// create paths, so match on code first and fall back to the message text.
function isEmailTakenError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  if (error.code === 'email_exists' || error.code === 'user_already_exists') return true
  const m = (error.message ?? '').toLowerCase()
  return m.includes('already registered') || m.includes('already been registered') || m.includes('already exists')
}

export async function POST(req: NextRequest) {
  try {
    // Gate: only authenticated admins may create clients / auth users.
    const authClient = await createServerClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user || !isAdmin(user)) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const reqBody = await req.json()
    const { email, password, name, useInviteLink } = reqBody

    if (!email || !name) {
      return NextResponse.json(
        { error: 'Missing required fields.' },
        { status: 400 }
      )
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    )

    // Duplicate check, scoped to the CALLER'S tenant (T-2). Since 0018 the
    // constraint is unique (organization_id, email), so another studio's
    // client at the same address is not a collision for us — and must not be
    // reported as one, or an admin could enumerate another tenant's client
    // roster one probe at a time.
    const { data: existingClient } = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('organization_id', userOrgId(user))
      .eq('email', email.trim().toLowerCase())
      .maybeSingle()

    if (existingClient) {
      return NextResponse.json({ error: EMAIL_TAKEN }, { status: 409 })
    }

    let userId: string

    if (useInviteLink) {
      // ── FLOW A: Invite link (DEFAULT) ──
      // The account is created and the STUDIO-BRANDED invite goes out through
      // Resend (S-C CM-5). Supabase's mailer is no longer involved: its
      // templates are global per project and could never carry this studio's
      // name. Client clicks the link → /set-password → sets their own password.
      const { user: invitedUser, error } =
        await sendTenantInvite({
          email,
          orgId: userOrgId(user),
          audience: 'client_owner',
          data: { name, role: 'client' },
        })

      if (error) {
        console.error('[create-client] Invite error:', error)
        // The address may already have an auth user in ANOTHER tenant. Return
        // exactly what an in-tenant duplicate returns, so the two are
        // indistinguishable from outside.
        if (isEmailTakenError(error)) {
          return NextResponse.json({ error: EMAIL_TAKEN }, { status: 409 })
        }
        return NextResponse.json(
          { error: error.message },
          { status: 400 }
        )
      }
      if (!invitedUser) {
        return NextResponse.json({ error: 'Could not create the account.' }, { status: 500 })
      }

      userId = invitedUser.id
    } else {
      // ── FLOW B: Manual password (fallback) ──
      // Admin sets password and shares it directly
      if (!password || password.length < 8) {
        return NextResponse.json(
          { error: 'Password must be at least 8 characters.' },
          { status: 400 }
        )
      }

      const { data, error } =
        await supabaseAdmin.auth.admin.createUser({
          email,
          password,
          email_confirm: true, // skip email — admin is handling
          user_metadata: {
            name,
            role: 'client',
          },
        })

      if (error) {
        console.error('[create-client] Create user error:', error)
        if (isEmailTakenError(error)) {
          return NextResponse.json({ error: EMAIL_TAKEN }, { status: 409 })
        }
        return NextResponse.json(
          { error: error.message },
          { status: 400 }
        )
      }

      userId = data.user.id
    }

    // Insert into clients table using service_role (bypasses RLS).
    // No user_id: the column is retired by 0026. Who the company's login is, is
    // answered by the client_members row below and by nothing else (S1 §5.2).
    // organization_id is STAMPED, not defaulted (T-5, S1 §3). The column
    // DEFAULT is McPrime's org, so an unstamped insert files a second studio's
    // client company inside tenant zero — and the client_members row below
    // would then disagree with it about which tenant the company belongs to.
    const { data: client, error: insertError } = await supabaseAdmin
      .from('clients')
      .insert({
        organization_id: userOrgId(user),
        name: name.trim(),
        email: email.trim().toLowerCase(),
        company: reqBody.company?.trim() || null,
        phone: reqBody.phone?.trim() || null,
        notes: reqBody.notes?.trim() || null,
        invited_at: useInviteLink ? new Date().toISOString() : null,
        invite_count: useInviteLink ? 1 : 0,
      })
      .select()
      .single()

    if (insertError) {
      console.error('[create-client] Insert error:', insertError)
      return NextResponse.json(
        { error: 'Failed to create client record: ' + insertError.message },
        { status: 500 }
      )
    }

    // ── the membership row, and it is not optional ──────────────────────────
    // Batch 6.8 made client_members the SOLE authority (S1 §5.2):
    // clientMembershipOf() and portalAccess() read nothing else. This route
    // never wrote one, so every company created after 6.8 shipped produced a
    // login with no membership and an empty portal shell. Live only because
    // the last real company predates the 0012 backfill — S1 §5.2 specified
    // that backfill and never specified this path, so a one-time fix read as
    // a permanent one.
    //
    // ORDER: clients → client_members → claim. Never claim first. Batch 7.5
    // established this on the crew side for the reason it applies here: a
    // failure between the claim and the row leaves an account holding a
    // client_id it has no membership behind, which is the exact state 7.5
    // eliminated. The org comes off the row we just wrote, so the two can
    // never disagree.
    const { error: memberError } = await supabaseAdmin
      .from('client_members')
      .insert({
        client_id: client.id,
        organization_id: client.organization_id,
        user_id: userId,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        role: 'owner',
        status: 'active',
        scope_mode: 'all',
        invited_by: user.id,
        accepted_at: new Date().toISOString(),
      })

    if (memberError) {
      // No partial creation. A clients row with no membership IS the defect
      // this block exists to prevent, so it does not survive the failure that
      // produced it. Bounded: the row was written milliseconds ago by this
      // request and nothing references it yet.
      //
      // The auth user is deliberately NOT deleted (AD-003 / Batch 6.2 removed
      // deleteUser everywhere). It carries no client_id claim — that is
      // stamped below, after this — so it is inert rather than dangling.
      console.error('[create-client] Membership insert failed:', memberError)
      await supabaseAdmin.from('clients').delete().eq('id', client.id)
      return NextResponse.json(
        { error: 'Failed to create client membership: ' + memberError.message },
        { status: 500 }
      )
    }

    // Bind the auth user to its client + role. SECURITY: role and client_id
    // live in app_metadata (service-role only, not user-editable); only the
    // display name stays in user_metadata.
    await supabaseAdmin.auth.admin.updateUserById(userId, {
      user_metadata: { name },
      app_metadata: {
        role: 'client',
        client_id: client.id,
        organization_id: client.organization_id,
      },
    })

    return NextResponse.json({
      success: true,
      userId,
      clientId: client.id,
    })
  } catch (err: any) {
    console.error('[create-client] Server error:', err)
    return NextResponse.json(
      { error: err.message ?? 'Server error.' },
      { status: 500 }
    )
  }
}
