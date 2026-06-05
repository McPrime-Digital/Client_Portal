import { userRole } from '@/lib/auth/role'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  // Handle auth errors from email link
  if (error) {
    console.error('Auth callback error:', error, errorDescription)
    return NextResponse.redirect(
      `${origin}/login?error=${
        encodeURIComponent(
          errorDescription ?? error
        )
      }`
    )
  }

  const supabase = await createClient()

  if (code) {
    // PKCE flow — exchange code for session
    const { data, error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(code)

    if (!exchangeError && data.user) {
      return handleSuccessfulAuth(supabase, data.user, origin, next)
    }
  }

  if (token_hash && type) {
    // Magic link / invite link flow
    const { data, error: otpError } = await supabase.auth.verifyOtp({
      token_hash,
      type: type as any,
    })

    if (!otpError && data.user) {
      // For invite links, redirect to set-password page first
      if (type === 'invite' || type === 'magiclink') {
        // Mark as onboarded before redirecting to set-password
        await markOnboarded(supabase, data.user.id)
        return NextResponse.redirect(`${origin}/set-password`)
      }
      return handleSuccessfulAuth(supabase, data.user, origin, next)
    }
  }

  // If we get here, something went wrong
  return NextResponse.redirect(
    `${origin}/login?error=` +
    encodeURIComponent(
      'Invalid or expired link. ' +
      'Please contact your project manager.'
    )
  )
}

/**
 * Handle successful auth: mark client as onboarded,
 * then route admin → admin dashboard, client → client portal.
 */
async function handleSuccessfulAuth(
  supabase: any,
  user: any,
  origin: string,
  next: string,
) {
  const role = userRole(user)

  // Mark client as onboarded if first login
  if (role === 'client') {
    await markOnboarded(supabase, user.id)
  }

  // Admin → admin dashboard, Client → requested destination
  const destination =
    role === 'admin'
      ? '/admin/dashboard'
      : next

  return NextResponse.redirect(`${origin}${destination}`)
}

/**
 * Mark client's onboarded_at timestamp if not already set.
 * Silently fails — should never block the auth flow.
 */
async function markOnboarded(
  supabase: any,
  userId: string,
) {
  try {
    const { data: client } = await supabase
      .from('clients')
      .select('id, onboarded_at')
      .eq('user_id', userId)
      .single()

    if (client && !client.onboarded_at) {
      await supabase
        .from('clients')
        .update({
          onboarded_at: new Date().toISOString(),
        })
        .eq('id', client.id)
    }
  } catch {
    // Never block auth flow for onboarding timestamp
  }
}
