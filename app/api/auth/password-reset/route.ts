import { NextRequest, NextResponse } from 'next/server'
import { sendPasswordReset } from '@/lib/email/invite'

// Password reset, off Supabase's mailer (S-C CM-5).
//
// It used to be `supabase.auth.resetPasswordForEmail()` called straight from
// the browser, which sends through Supabase's own mailer on a template that is
// global to the project — so the message could never carry the studio's name,
// no matter what was written in it.
//
// PRE-AUTH BY NATURE, so the tenant is resolved from the ACCOUNT rather than
// from anything the request says. The body carries an email address and
// nothing else; `sendPasswordReset` looks up whose account it is and brands
// from that. Trusting a tenant id in the body would let a stranger choose
// which studio the email appears to come from (I-6).
//
// ALWAYS RETURNS THE SAME RESPONSE. Unknown address, known address, send
// failure — all `{ ok: true }`. Reporting which addresses have accounts turns
// a public endpoint into an account-existence oracle, and reporting delivery
// separately leaks the same fact one step later. Failures reach Sentry, which
// is where they belong (I-10).

export async function POST(req: NextRequest) {
  const { email } = await req.json().catch(() => ({ email: null }))

  if (typeof email === 'string' && email.includes('@')) {
    await sendPasswordReset(email)
  }

  return NextResponse.json({ ok: true })
}
