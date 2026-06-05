import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isAdmin } from '@/lib/auth/role'

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

    // Check if client already exists
    const { data: existing } = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('email', cleanEmail)
      .single()

    if (existing) {
      return NextResponse.json(
        { error: 'A client with this email already exists.' },
        { status: 409 }
      )
    }

    // 1. Send the Supabase invite email
    const { data: inviteData, error: inviteError } =
      await supabaseAdmin.auth.admin.inviteUserByEmail(
        cleanEmail,
        {
          data: {
            role: 'client',
            name: name.trim(),
          },
          redirectTo: `${
            process.env.NEXT_PUBLIC_APP_URL
          }/set-password`,
        }
      )

    if (inviteError) {
      console.error('[invite-client] Invite error:', inviteError)
      return NextResponse.json(
        { error: inviteError.message },
        { status: 500 }
      )
    }

    // 2. Create client record in DB
    const { data: clientRecord, error: clientError } =
      await supabaseAdmin
        .from('clients')
        .insert({
          name: name.trim(),
          email: cleanEmail,
          company: company?.trim() || null,
          phone: phone?.trim() || null,
          notes: notes?.trim() || null,
          user_id: inviteData.user.id,
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

    // 2b. Bind the invited auth user to its client + role in app_metadata
    // (service-role only, never user-editable) so authorization is secure.
    await supabaseAdmin.auth.admin.updateUserById(inviteData.user.id, {
      app_metadata: { role: 'client', client_id: clientRecord.id },
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
