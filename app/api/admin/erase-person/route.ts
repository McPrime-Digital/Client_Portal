import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { isAdmin, userOrgId } from '@/lib/auth/role'
import { orgRolesOf } from '@/lib/team'
import { tenantBrand } from '@/lib/tenantBrand'
import { planAllows } from '@/lib/billing/plans'
import { erasePerson } from '@/lib/erasure'
import { captureError } from '@/lib/errors'

// Person-level data erasure (AD-003 tombstone + account delete) — see
// lib/erasure.ts for what it does and why it is a service-role operation.
//
// PLATFORM OPERATOR ONLY. Erasure rewrites rows by user id ACROSS tenants
// (an identity may span them, S1 §2), so no single tenant's admin may run it:
// the gate is the plan feature 'platform.erasure', which only the house plan
// carries — the exemption is the plan, never an org id (lib/billing/plans.ts).
// Per-tenant self-serve erasure is S3's schema work.
//
// Owner role on top of the plan: this destroys an auth account. Validated
// against a schema (I-7) — the second route handler to do so.
const Body = z.object({
  email: z.string().trim().toLowerCase().email(),
  // The UI makes the caller retype the address; the API refuses without the
  // match so a stray request can never erase on a typo.
  confirmEmail: z.string().trim().toLowerCase(),
})

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const roles = await orgRolesOf(user)
  if (!roles.includes('owner')) {
    return NextResponse.json({ error: 'Only an org owner can erase a person.' }, { status: 403 })
  }
  const { plan } = await tenantBrand(userOrgId(user))
  if (!planAllows(plan, 'platform.erasure')) {
    return NextResponse.json({ error: 'Erasure runs from the platform operator only.' }, { status: 403 })
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'A valid email and confirmEmail are required.' }, { status: 400 })
  }
  const { email, confirmEmail } = parsed.data
  if (email !== confirmEmail) {
    return NextResponse.json({ error: 'The confirmation address does not match.' }, { status: 400 })
  }
  if (email === (user.email ?? '').toLowerCase()) {
    return NextResponse.json({ error: 'You cannot erase your own account from here.' }, { status: 400 })
  }

  try {
    const outcome = await erasePerson(email)
    if (!outcome.erased) {
      return NextResponse.json({ error: outcome.reason }, { status: 409 })
    }
    return NextResponse.json({
      success: true,
      pseudonym: outcome.pseudonym,
      touched: outcome.touched,
      warnings: outcome.warnings,
    })
  } catch (e) {
    captureError(e, { where: 'erase-person', actor: user.id })
    const message = e instanceof Error ? e.message : 'Erasure failed partway.'
    // Partial progress is safe to retry: lib/erasure.ts deletes the auth
    // account LAST, so a re-run resumes where this one stopped.
    return NextResponse.json({ error: `${message} — safe to retry.` }, { status: 500 })
  }
}
