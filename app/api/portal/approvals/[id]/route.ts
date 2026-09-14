import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { portalAccess } from '@/lib/team'
import { canApproval } from '@/lib/capabilities.server'
import { readApproval } from '@/lib/approvals'
import { clearanceFor } from '@/lib/rights'
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
  // Resolved, not derived (Batch 26 item 8).
  if (!(await canApproval(user, 'client', 'decide'))) {
    return NextResponse.json({ error: 'Not available for your role.' }, { status: 403 })
  }

  const { id } = await ctx.params // Next 16: params is a Promise
  try {
    const detail = await readApproval(supabase, id)
    // One 404 for absent, another tenant's, internal, and out-of-scope.
    if (!detail) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

    // RIGHTS AND DISCLOSURE, FOR THE PARTY THE LAW ACTS ON. The client runs the
    // advertisement and takes the New York / EU AI Act penalty, so what an asset
    // is cleared for belongs beside the thing they are being asked to approve —
    // not in an email. Read on the USER client: 0088's policies reach both
    // tables THROUGH the file, so a client who cannot see the asset gets
    // nothing and no predicate had to be restated.
    const fileId =
      detail.approval.subject_kind === 'file_version' ? detail.approval.subject_id : null
    const clearance = fileId
      ? (await clearanceFor(supabase, [fileId])).get(fileId) ?? null
      : null

    return NextResponse.json({ ...detail, clearance })
  } catch (e) {
    captureError(e, { where: 'portal/approvals/[id] GET', id })
    return NextResponse.json({ error: 'Could not load the approval.' }, { status: 500 })
  }
}
