import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { isAdmin, userOrgId } from '@/lib/auth/role'

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
      // Supabase sends branded invite email via Resend
      // Client clicks link → lands on /set-password → sets own password
      const { data, error } =
        await supabaseAdmin.auth.admin.inviteUserByEmail(
          email,
          {
            data: {
              name,
              role: 'client',
            },
            redirectTo: `${
              process.env.NEXT_PUBLIC_APP_URL
            }/set-password`,
          }
        )

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

      userId = data.user.id
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

    // Insert into clients table using service_role (bypasses RLS)
    const { data: client, error: insertError } = await supabaseAdmin
      .from('clients')
      .insert({
        user_id: userId,
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

    // Bind the auth user to its client + role. SECURITY: role and client_id
    // live in app_metadata (service-role only, not user-editable); only the
    // display name stays in user_metadata.
    await supabaseAdmin.auth.admin.updateUserById(userId, {
      user_metadata: { name },
      app_metadata: {
        role: 'client',
        client_id: client.id,
        organization_id: userOrgId(user),
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
