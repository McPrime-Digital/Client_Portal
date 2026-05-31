import { createClient } from
  '@/lib/supabase/server'
import { createClient as createAdminClient }
  from '@supabase/supabase-js'
import { NextRequest, NextResponse }
  from 'next/server'

export async function POST(req: NextRequest) {
  try {
    // Verify caller is admin
    const supabase = await createClient()
    const { data: { user } } =
      await supabase.auth.getUser()

    if (
      !user ||
      user.user_metadata?.role !== 'admin'
    ) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { email } = await req.json()

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required.' },
        { status: 400 }
      )
    }

    const adminSupabase = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    )

    // Re-invite using the same email
    const { error: inviteError } =
      await adminSupabase.auth.admin
        .inviteUserByEmail(
          email.trim().toLowerCase(),
          {
            redirectTo:
              `${process.env
                .NEXT_PUBLIC_APP_URL}` +
              `/set-password`,
            data: { role: 'client' },
          }
        )

    if (inviteError) {
      throw new Error(inviteError.message)
    }

    // Bump invited_at + invite_count so the UI can show "Resent".
    const { data: existing } = await adminSupabase
      .from('clients')
      .select('*')
      .eq('email', email.trim().toLowerCase())
      .single()
    await adminSupabase
      .from('clients')
      .update({
        invited_at: new Date().toISOString(),
        invite_count: (existing?.invite_count ?? 1) + 1,
      })
      .eq(
        'email',
        email.trim().toLowerCase()
      )

    return NextResponse.json({
      success: true,
      message: `Invite resent to ${email}`,
    })
  } catch (err: any) {
    console.error('Resend invite error:', err)
    return NextResponse.json(
      {
        error:
          err.message ??
          'Failed to resend invite.',
      },
      { status: 500 }
    )
  }
}
