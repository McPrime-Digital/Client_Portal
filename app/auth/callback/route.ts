import type { User } from '@supabase/supabase-js'
import { userRole, userClientId } from '@/lib/auth/role'
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
        await markOnboarded(supabase, data.user)
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
    await markOnboarded(supabase, user)
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
 *
 * Resolves the company from `app_metadata.client_id`, not `clients.user_id`.
 * The old lookup (`clients.eq('user_id', userId)`) was the deprecated
 * primary-login pointer: it matched only the billing contact, so an invited
 * teammate stamped nothing, and it is one of the references that must clear
 * before the column can be dropped (S1 §10 q2 / S2 §11 q4).
 *
 * The claim rather than a `client_members` read, deliberately: it is on the
 * user object already (no round trip), it is service-role-written and
 * tamper-proof (lib/auth/role.ts), and — the deciding reason — it does not
 * depend on roster status. There is no self-read policy on `client_members`
 * (0012:72 gives `organization_members` one; the client side only has
 * `client_members_team_read`, which routes through `is_client_member()` and so
 * requires `status='active'`), and a user arriving on an invite link is still
 * `'invited'`.
 *
 * FOUND WHILE MOVING THIS, and not caused by it: the invite-flow call at :49
 * has been inert since 0021 for that same reason. Both the SELECT and the
 * UPDATE on `clients` key on `is_client_member(id)`, which an `'invited'`
 * member does not satisfy, and the failure is swallowed by the catch that is
 * explicitly written never to block auth. Nothing is lost — the portal layout
 * flips `'invited'` → `'active'` on first load and then applies the onboarding
 * redirect itself — so this is a dead call, not a broken feature. Left in
 * place: deleting it is an onboarding-flow decision, not a column retirement.
 */
async function markOnboarded(
  supabase: any,
  user: User,
) {
  try {
    const clientId = userClientId(user)
    if (!clientId) return

    const { data: client } = await supabase
      .from('clients')
      .select('id, onboarded_at')
      .eq('id', clientId)
      .maybeSingle()

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
