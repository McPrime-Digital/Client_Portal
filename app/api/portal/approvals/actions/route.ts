import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { portalAccess } from '@/lib/team'
import { clientCanApproval } from '@/lib/permissions'
import { recordDecision } from '@/lib/approvals'
import { captureError } from '@/lib/errors'

/**
 * The client's decision. ONE action, deliberately.
 *
 * create, set_window, withdraw and set_comment_permission are 'never' on the
 * client side (lib/permissions), each for a product reason rather than because
 * the studio holds them: the studio MINTS approvals (AP-5), the window is the
 * studio's commitment in the production agreement (§2.6) — a client who could
 * extend their own deadline has deleted auto-advance — and withdrawal belongs
 * to whoever made the request. So there is nothing here for them to route to.
 *
 * THIS ROUTE USES THE USER CLIENT, AND THAT IS LOAD-BEARING. The decision
 * insert is refused by 0038's approval_decisions INSERT policy unless the
 * caller is an assignee of an ACTIVE stage. Running this on the service role
 * would bypass the one check that stops a client approving a stage they were
 * never assigned to — which is why item 4's "no new service-role importers"
 * rule is a security constraint here and not a tidiness one.
 *
 * The stage ADVANCE is 0039's trigger, not this route. A client cannot write
 * approval_stages (0038, correctly), and before the trigger existed that
 * UPDATE matched zero rows and returned no error — the decision was recorded
 * and the stage silently never advanced, which would eventually have had the
 * permanent record claim "no response received" about a client who responded.
 */

const DecideSchema = z.object({
  stageId: z.uuid(),
  decision: z.enum(['approved', 'rejected', 'changes_requested']),
  comment: z.string().trim().max(4000).nullish(),
})

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await portalAccess(user)
  if (!access) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!clientCanApproval(access.role, 'decide', access.extraCaps)) {
    return NextResponse.json({ error: 'You cannot approve on this account.' }, { status: 403 })
  }

  const parsed = DecideSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request.' },
      { status: 400 }
    )
  }
  const { stageId, decision, comment } = parsed.data

  try {
    const result = await recordDecision(supabase, {
      stageId,
      actorId: user.id,
      // The member's OWN name from the roster (portalAccess resolves it),
      // never user_metadata — a person could otherwise choose the name
      // recorded against a contractual sign-off.
      actorName: access.name,
      actorRole: 'client',
      decision,
      comment: comment ?? null,
    })
    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (/not 'active'|refused|no stage|no approval/.test(msg)) {
      // Covers both "already decided/lapsed" and "you are not an assignee",
      // which the policy refuses identically — the client learns their action
      // did not apply, not which stages exist or who is on them.
      return NextResponse.json(
        { error: 'That approval is no longer open to you.' },
        { status: 409 }
      )
    }
    captureError(e, { where: 'portal/approvals actions decide' })
    return NextResponse.json({ error: 'Could not record your decision.' }, { status: 500 })
  }
}
