import 'server-only'

import type { User } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { appUrl } from '@/lib/appOrigin'
import { tenantBrand } from '@/lib/tenantBrand'
import { senderForTenant } from '@/lib/mailSender'
import { inviteEmail, passwordResetEmail, type InviteAudience } from '@/lib/email/messages'
import { sendMail } from '@/lib/email/send'
import { captureError } from '@/lib/errors'

// INVITES AND PASSWORD RESETS, OFF SUPABASE'S MAILER (S-C CM-5).
//
// The reason is structural, not cosmetic: Supabase Auth's templates are GLOBAL
// PER PROJECT. One template serves every tenant, so an invite sent through that
// mailer can never carry the sending studio's name or logo — not with better
// copy, not with more configuration. `generateLink()` returns the same action
// link without sending, and the application delivers it against the same
// layout as every other message.
//
// WHAT IS UNCHANGED, and matters: `generateLink({ type: 'invite' })` creates
// the auth user exactly as `inviteUserByEmail` did, and returns the same `user`
// and the same error shapes — so `isEmailTakenError` still works and every
// caller's ordering (roster row before claim, Batch 8.1/7.5) is untouched.
//
// WHAT IS GENUINELY DIFFERENT, and every caller has to know: the user now
// exists BEFORE the email is attempted. Under `inviteUserByEmail` the two were
// one operation — no mail meant no user. Now a delivery failure leaves a
// correct account and a correct roster row with an undelivered message. That is
// recoverable (`resend-invite` exists for exactly this) and it is NOT a reason
// to tear down the account, so `delivered` is returned rather than thrown.

/**
 * Supabase reports an existing account differently across its auth endpoints,
 * so both the code and the text are checked — the same predicate shape
 * `create-client` already uses for its own duplicate handling.
 */
function isAlreadyRegistered(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  if (error.code === 'email_exists' || error.code === 'user_already_exists') return true
  const m = (error.message ?? '').toLowerCase()
  return (
    m.includes('already registered') ||
    m.includes('already been registered') ||
    m.includes('already exists')
  )
}

export type InviteResult = {
  user: User | null
  /** Null on success. Carries Supabase's shape so `isEmailTakenError` works. */
  error: { code?: string; message?: string } | null
  /** False when the account exists but the message did not go out. */
  delivered: boolean
}

/**
 * Create (or reuse) the auth user, then send the studio-branded invite.
 *
 * `orgId` is the SENDING studio — the invite wears its brand (CM-2). It is
 * required rather than defaulted: there is no correct tenant to fall back to,
 * and defaulting is how one studio's name reached every tenant (HANDOFF §12.3).
 */
export async function sendTenantInvite(opts: {
  email: string
  orgId: string
  audience: InviteAudience
  /** Written to `user_metadata` on creation, as the old call did. */
  data?: Record<string, unknown>
  /** Defaults to the set-password screen. */
  redirectTo?: string
}): Promise<InviteResult> {
  const email = opts.email.trim().toLowerCase()

  const redirectTo = opts.redirectTo ?? appUrl('/set-password')

  // The brand read runs alongside the auth call rather than after it. Both are
  // network round trips and neither needs the other's result; serialising them
  // was a visible chunk of the invite request's latency.
  const [linkRes, brand] = await Promise.all([
    supabaseAdmin.auth.admin.generateLink({
      type: 'invite',
      email,
      options: { data: opts.data, redirectTo },
    }),
    tenantBrand(opts.orgId),
  ])

  let { data, error } = linkRes

  // AN EXISTING AUTH USER IS NOT A DUPLICATE, and treating it as one was a
  // hard blocker: `type: 'invite'` fails with "already been registered" for any
  // address that has EVER had an account. Two ordinary situations hit it —
  //
  //   · a client company was deleted and is being re-created. AD-003 keeps the
  //     auth user (deleting a person never deletes their work), so the address
  //     is permanently un-invitable without this.
  //   · the person genuinely has an account elsewhere. S1 §2 states this is
  //     ALLOWED — "someone may be crew at McPrime and a client contact at
  //     another company. Different tables, no conflict."
  //
  // In-tenant duplicates are already refused by the callers, against the
  // `clients` / roster tables, before this runs. So reaching here with an
  // existing user means the invite is legitimate, and the correct move is to
  // mint a link the existing account can use. `recovery` does that: it returns
  // the same `user` and an action link to the same redirect, and the recipient
  // sets a password exactly as a new invitee would.
  let expiresIn = '24 hours'
  if (error && isAlreadyRegistered(error)) {
    const retry = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo },
    })
    data = retry.data
    error = retry.error
    // Supabase's recovery links expire in 60 minutes by default, not 24 hours.
    // The copy has to follow the link it is actually describing.
    expiresIn = '60 minutes'
  }

  if (error || !data?.properties?.action_link) {
    return {
      user: null,
      error: error ?? { message: 'Could not generate an invite link.' },
      delivered: false,
    }
  }

  const delivered = await sendMail(
    email,
    inviteEmail(brand, opts.audience, data.properties.action_link, expiresIn),
    senderForTenant(brand)
  )

  if (!delivered) {
    captureError(new Error('Invite link was generated but the email was not delivered.'), {
      where: 'email/invite',
      email,
      orgId: opts.orgId,
    })
  }

  return { user: data.user ?? null, error: null, delivered }
}

/**
 * Studio-branded password reset.
 *
 * The tenant is resolved from the ACCOUNT, not from the request: the reset form
 * is pre-auth and takes only an email address, so trusting anything the browser
 * says about which studio to brand as would let a stranger pick (I-6).
 *
 * Always resolves — deliberately. An unknown address returns the same shape as
 * a known one, so the endpoint cannot be used to test whether an account
 * exists. That is why it reports nothing about `delivered` to its caller's
 * response body.
 */
export async function sendPasswordReset(email: string): Promise<void> {
  const clean = email.trim().toLowerCase()
  if (!clean) return

  try {
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: clean,
      options: { redirectTo: appUrl('/reset-password') },
    })

    // No account, or Supabase declined. Nothing is sent and nothing is
    // reported upward — see the enumeration note above.
    if (error || !data?.properties?.action_link) return

    const orgId =
      (data.user?.app_metadata as { organization_id?: string } | undefined)?.organization_id ?? null

    const brand = await tenantBrand(orgId)
    await sendMail(
      clean,
      passwordResetEmail(brand, data.properties.action_link),
      senderForTenant(brand)
    )
  } catch (err) {
    // The caller's response is fixed regardless, so this is the only place the
    // failure can surface at all (I-10).
    captureError(err, { where: 'email/passwordReset' })
  }
}
