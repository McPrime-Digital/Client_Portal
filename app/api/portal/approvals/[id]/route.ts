import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { portalAccess } from '@/lib/team'
import { clientCanApproval } from '@/lib/permissions'
import { readApproval } from '@/lib/approvals'
import { captureError } from '@/lib/errors'

/**
 * One approval, client side — the permanent record as the client sees it.
 *
 * EVERY decision and EVERY comment on the approval is returned, including the
 * studio's internal stages of THIS approval. That is AP-4: who may comment is
 * controlled, what is recorded is not, and a read-side filter here is exactly
 * the thing that would let a review look cleaner than it was.
 *
 * What a client still cannot see is a separate INTERNAL APPROVAL (one with
 * client_id null) — 0038 refuses that row entirely, so it never reaches this
 * handler. The two are different questions and only one of them is a filter.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await portalAccess(user)
  if (!access) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!clientCanApproval(access.role, 'decide', access.extraCaps)) {
    return NextResponse.json({ error: 'Not available for your role.' }, { status: 403 })
  }

  const { id } = await ctx.params // Next 16: params is a Promise
  try {
    const detail = await readApproval(supabase, id)
    // One 404 for absent, another tenant's, internal, and out-of-scope.
    if (!detail) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    return NextResponse.json(detail)
  } catch (e) {
    captureError(e, { where: 'portal/approvals/[id] GET', id })
    return NextResponse.json({ error: 'Could not load the approval.' }, { status: 500 })
  }
}
