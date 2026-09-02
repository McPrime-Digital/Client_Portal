import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth/role'
import { orgAccessOf, rosterName } from '@/lib/team'
import { orgCanApproval, type ApprovalAction } from '@/lib/permissions'
import {
  recordDecision, setCommentPermission, setReviewWindow, withdrawApproval,
} from '@/lib/approvals'
import { captureError } from '@/lib/errors'

/**
 * Studio-side approval mutations, one discriminated POST — the shape
 * `portal/actions` and `admin/project-actions` already use.
 *
 * Every branch runs on the COOKIE-BOUND USER CLIENT. No service-role import;
 * 0038's policies decide what lands, and for `decide` specifically the
 * approval_decisions INSERT policy is what refuses a non-assignee — the
 * capability check below is authority, the policy is enforcement, and they are
 * not the same question.
 */

const ActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('decide'),
    stageId: z.uuid(),
    decision: z.enum(['approved', 'rejected', 'changes_requested']),
    comment: z.string().trim().max(4000).nullish(),
  }),
  z.object({
    action: z.literal('set_window'),
    approvalId: z.uuid(),
    hours: z.number().int().positive().max(8760).nullable(),
  }),
  z.object({
    action: z.literal('withdraw'),
    approvalId: z.uuid(),
    reason: z.string().trim().max(1000).nullish(),
  }),
  z.object({
    action: z.literal('set_comment_permission'),
    approvalId: z.uuid(),
    userId: z.uuid(),
    canComment: z.boolean(),
  }),
])

const CAP_FOR: Record<z.infer<typeof ActionSchema>['action'], ApprovalAction> = {
  decide: 'decide',
  set_window: 'set_window',
  withdraw: 'withdraw',
  set_comment_permission: 'set_comment_permission',
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = ActionSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request.' },
      { status: 400 }
    )
  }
  const body = parsed.data

  const access = await orgAccessOf(user)
  if (!orgCanApproval(access.roles, CAP_FOR[body.action], access.extraCaps)) {
    return NextResponse.json({ error: 'You cannot take that action.' }, { status: 403 })
  }

  const actorName = (await rosterName(user)) ?? user.email?.split('@')[0] ?? 'Member'

  try {
    switch (body.action) {
      case 'decide': {
        const result = await recordDecision(supabase, {
          stageId: body.stageId,
          actorId: user.id,
          actorName,
          actorRole: 'admin',
          decision: body.decision,
          comment: body.comment ?? null,
        })
        return NextResponse.json(result)
      }
      case 'set_window': {
        await setReviewWindow(supabase, {
          approvalId: body.approvalId, hours: body.hours,
          actorId: user.id, actorName, actorRole: 'admin',
        })
        return NextResponse.json({ success: true })
      }
      case 'withdraw': {
        await withdrawApproval(supabase, {
          approvalId: body.approvalId, actorId: user.id, actorName,
          actorRole: 'admin', reason: body.reason ?? null,
        })
        return NextResponse.json({ success: true })
      }
      case 'set_comment_permission': {
        await setCommentPermission(supabase, {
          approvalId: body.approvalId, userId: body.userId,
          canComment: body.canComment, setBy: user.id,
        })
        return NextResponse.json({ success: true })
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    // A stage that is not active, or a decision the policy refused. Both are
    // the caller's state being wrong, not the server failing.
    if (/not 'active'|refused|no stage|no approval/.test(msg)) {
      return NextResponse.json({ error: 'That approval is not open to this action.' }, { status: 409 })
    }
    captureError(e, { where: `studio/approvals actions ${body.action}` })
    return NextResponse.json({ error: 'Could not complete that action.' }, { status: 500 })
  }
}
