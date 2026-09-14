import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth/role'
import { readApproval } from '@/lib/approvals'
import { clearanceFor } from '@/lib/rights'
import { captureError } from '@/lib/errors'

/**
 * One approval with its whole chain — the studio's Review & Approval read.
 *
 * There is no tenant filter written here on purpose, and it is not an
 * oversight: `readApproval` runs on the user client, so 0038's
 * `approvals_crew_read` is the filter (org match + is_org_member + project
 * scope + deleted_at). A row in another tenant is not "forbidden", it is
 * ABSENT — which is why one 404 covers "no such approval", "another studio's"
 * and "outside your project scope". A probe learns nothing from the status.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params // Next 16: params is a Promise
  try {
    const detail = await readApproval(supabase, id)
    if (!detail) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    // The same clearance the portal's accordion shows, so the two sides of one
    // approval cannot report different answers about what an asset is cleared
    // for. On the user client, so project scope applies (0087/0059).
    const fileId =
      detail.approval.subject_kind === 'file_version' ? detail.approval.subject_id : null
    const clearance = fileId
      ? (await clearanceFor(supabase, [fileId])).get(fileId) ?? null
      : null

    return NextResponse.json({ ...detail, clearance })
  } catch (e) {
    captureError(e, { where: 'studio/approvals/[id] GET', id })
    return NextResponse.json({ error: 'Could not load the approval.' }, { status: 500 })
  }
}
