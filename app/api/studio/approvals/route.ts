import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdmin, userOrgId } from '@/lib/auth/role'
import { orgAccessOf, rosterName } from '@/lib/team'
import { orgCanApproval } from '@/lib/permissions'
import { createApproval, listApprovals, type SubjectKind } from '@/lib/approvals'
import { captureError } from '@/lib/errors'

/**
 * Studio-side approvals: list (GET) and open (POST).
 *
 * NO SERVICE-ROLE CLIENT, and that is the point (AD-001, I-8). Every query
 * below runs on the COOKIE-BOUND USER CLIENT, so 0038's policies are the
 * tenant boundary — a forgotten filter is an empty result, not another
 * studio's approvals. The engine takes `db` as a parameter precisely so this
 * route can hand it the user client.
 *
 * The explicit `.eq('organization_id', …)` in listApprovals is NOT redundant
 * with RLS (I-9): RLS is the boundary, the filter is the intent, and the two
 * failing independently is what makes a mistake visible instead of silent.
 */

const SUBJECT_KINDS = ['file_version', 'task', 'milestone', 'document', 'message'] as const
const STATUSES = ['open', 'approved', 'rejected', 'changes_requested', 'auto_advanced', 'withdrawn'] as const

const AssigneeSchema = z
  .object({
    userId: z.uuid().nullish(),
    clientId: z.uuid().nullish(),
    role: z.string().trim().min(1).max(60).nullish(),
    required: z.boolean().optional(),
  })
  .refine((a) => !!(a.userId || a.clientId || a.role), {
    message: 'An assignee must name a person, a company or a role.',
  })

const CreateSchema = z.object({
  subjectKind: z.enum(SUBJECT_KINDS),
  subjectId: z.uuid(),
  title: z.string().trim().min(1).max(300),
  clientId: z.uuid().nullish(),
  projectId: z.uuid().nullish(),
  reviewWindowHours: z.number().int().positive().max(8760).nullish(),
  contractId: z.uuid().nullish(),
  subjectVersionId: z.uuid().nullish(),
  stages: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        mode: z.enum(['sequential', 'parallel']).optional(),
        assignees: z.array(AssigneeSchema).min(1).max(50),
      })
    )
    .min(1)
    .max(10),
})

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const params = req.nextUrl.searchParams
  const status = params.get('status')
  if (status && !(STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: 'Unknown status.' }, { status: 400 })
  }
  const projectId = params.get('project_id')
  const clientId = params.get('client_id')

  try {
    const page = await listApprovals(supabase, {
      // Tenant from the verified SESSION, never the query string (I-6).
      orgId: userOrgId(user),
      clientId: clientId ?? undefined,
      projectId: projectId ?? undefined,
      status: (status as (typeof STATUSES)[number] | null) ?? null,
      cursor: params.get('cursor'),
    })
    return NextResponse.json(page)
  } catch (e) {
    if (e instanceof Error && e.message === 'Malformed cursor') {
      return NextResponse.json({ error: 'Malformed cursor.' }, { status: 400 })
    }
    captureError(e, { where: 'studio/approvals GET' })
    return NextResponse.json({ error: 'Could not load approvals.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // The ROSTER decides, not the claim (S2). 'create' rides run_projects, so a
  // member who runs projects can open one without being able to move the
  // deadline the studio promised (item 3's tiering).
  const access = await orgAccessOf(user)
  if (!orgCanApproval(access.roles, 'create', access.extraCaps)) {
    return NextResponse.json({ error: 'You cannot open approvals.' }, { status: 403 })
  }

  const parsed = CreateSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request.' },
      { status: 400 }
    )
  }
  const body = parsed.data

  // Setting a per-approval window is a SEPARATE capability from opening one —
  // otherwise 'create' would be a way to buy 'set_window' (item 3).
  if (body.reviewWindowHours != null && !orgCanApproval(access.roles, 'set_window', access.extraCaps)) {
    return NextResponse.json(
      { error: 'You cannot set a review window. Leave it unset to use the studio default.' },
      { status: 403 }
    )
  }

  try {
    const { approval, stages } = await createApproval(supabase, {
      orgId: userOrgId(user),
      actorId: user.id,
      // From the ROSTER, never user_metadata (7.8 / 11.5).
      actorName: (await rosterName(user)) ?? user.email?.split('@')[0] ?? 'Member',
      actorRole: 'admin',
      subjectKind: body.subjectKind as SubjectKind,
      subjectId: body.subjectId,
      title: body.title,
      clientId: body.clientId ?? null,
      projectId: body.projectId ?? null,
      reviewWindowHours: body.reviewWindowHours ?? null,
      contractId: body.contractId ?? null,
      subjectVersionId: body.subjectVersionId ?? null,
      stages: body.stages.map((s) => ({
        name: s.name,
        mode: s.mode,
        assignees: s.assignees.map((a) => ({
          userId: a.userId ?? null,
          clientId: a.clientId ?? null,
          role: a.role ?? null,
          required: a.required,
        })),
      })),
    })
    return NextResponse.json({ approval, stages }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not open the approval.'
    // The engine's tenant/existence refusals are the caller's fault, not the
    // server's — 400 with the reason, one message for absent and foreign.
    if (/no .* in this organization/.test(msg)) {
      return NextResponse.json({ error: 'That subject does not exist here.' }, { status: 400 })
    }
    captureError(e, { where: 'studio/approvals POST' })
    return NextResponse.json({ error: 'Could not open the approval.' }, { status: 500 })
  }
}
