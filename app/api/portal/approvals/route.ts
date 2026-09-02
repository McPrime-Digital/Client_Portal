import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { portalAccess } from '@/lib/team'
import { clientCanApproval } from '@/lib/permissions'
import { listApprovals, type ApprovalStatus } from '@/lib/approvals'
import { captureError } from '@/lib/errors'

/**
 * The client company's approvals.
 *
 * INTERNAL APPROVALS ARE INVISIBLE HERE BY CONSTRUCTION, not by a filter this
 * route remembers to write: 0038's `approvals_client_read` begins
 * `client_id is not null`, so an approval the studio raised against itself
 * cannot appear in a portal read even if this file asked for it. That is the
 * decoupling S3-c §2 puts in one column, and it is enforced a layer below
 * anything a route can get wrong.
 *
 * The `clientId` passed to listApprovals comes from `portalAccess`, resolved
 * from the SESSION (I-6) — never from the query string — and is an explicit
 * filter on top of RLS (I-9).
 */

const STATUSES = ['open', 'approved', 'rejected', 'changes_requested', 'auto_advanced', 'withdrawn'] as const

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await portalAccess(user)
  if (!access) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Reading the approvals queue is the same right as acting on it — the portal
  // nav already gates /approvals on 'approve' (lib/permissions clientNavAllowed).
  if (!clientCanApproval(access.role, 'decide', access.extraCaps)) {
    return NextResponse.json({ error: 'Not available for your role.' }, { status: 403 })
  }

  const params = req.nextUrl.searchParams
  const status = params.get('status')
  if (status && !(STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: 'Unknown status.' }, { status: 400 })
  }
  const projectId = params.get('project_id')
  // A scoped member asking for a project outside their scope gets nothing
  // rather than an error — the same posture the message routes take.
  if (projectId && access.projectIds && !access.projectIds.includes(projectId)) {
    return NextResponse.json({ approvals: [], nextCursor: null, hasMore: false })
  }

  try {
    const page = await listApprovals(supabase, {
      clientId: access.clientId,
      projectId: projectId ?? undefined,
      status: (status as ApprovalStatus | null) ?? null,
      cursor: params.get('cursor'),
    })
    return NextResponse.json(page)
  } catch (e) {
    if (e instanceof Error && e.message === 'Malformed cursor') {
      return NextResponse.json({ error: 'Malformed cursor.' }, { status: 400 })
    }
    captureError(e, { where: 'portal/approvals GET' })
    return NextResponse.json({ error: 'Could not load approvals.' }, { status: 500 })
  }
}
