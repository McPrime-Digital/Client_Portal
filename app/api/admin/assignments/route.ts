import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { isAdmin, userOrgId } from '@/lib/auth/role'
import { can } from '@/lib/capabilities.server'
import { rosterName } from '@/lib/team'
import {
  assign, unassign, listForMember, listForProject, isProjectRole,
} from '@/lib/assignments'

/**
 * PROJECT STAFFING — S-R §3.2's axis, made usable (Batch 26 item 7).
 *
 * GET  ?memberId=…   what a person is on
 * GET  ?projectId=…  who is on a production, and as what
 * POST               put somebody on a production / change their role or expiry
 * DELETE             take somebody off
 *
 * ── ONE GATE, AND IT IS A CAPABILITY RATHER THAN A ROLE ────────────────────
 * `people.manage`, resolved through can() — which since Batch 26 item 8 is the
 * only thing in the application that answers a capability question, and which
 * subtracts DENIALS. Gating on `canManageOrg` (role ∈ owner/admin) instead is the
 * defect Batch 25 found in the roster routes: migration 0053 widened the ROW to
 * has_cap('people.manage'), so a GRANTED people.manage would be admitted by the
 * database and refused here.
 *
 * ── EVERYTHING RUNS ON THE USER CLIENT (AD-001) — NO SERVICE ROLE AT ALL ───
 * 0053 put has_cap('people.manage') on organization_member_projects' admin
 * policy, so the POLICY is the control and the route is the message (R-5).
 *
 * The first draft imported supabaseAdmin for two reads that are not the caller's
 * own rows — the target member's name and the project's title, for the ledger —
 * and the I-8 ratchet refused it. The refusal was right and the batch's standing
 * rules say no new service-role importers, so both reads moved to the user
 * client, where the policies already permit them: a caller holding people.manage
 * can read the roster (organization_members_admin_all), and any crew member can
 * read the projects they can see.
 *
 * TWO THINGS FALL OUT OF THAT, and both are improvements rather than costs:
 *   · the ORG PREDICATE comes free. A service-role read would have needed an
 *     explicit `.eq('organization_id', …)` or it would confirm the existence of
 *     another studio's member by id, one probe at a time (the T-2 disclosure).
 *     RLS supplies it.
 *   · ASSIGNMENT IS BOUNDED BY THE ASSIGNER'S OWN SCOPE. A scoped person holding
 *     people.manage cannot staff a production they cannot see, because
 *     projects_crew_all hides it from this very lookup. That is the correct
 *     answer and it required no code to say so.
 *
 * The names come from the ROSTER rather than from the request body either way —
 * the 7.8 / 11.5 rule that `granted_by_name` and `approval_decisions.actor_name`
 * already follow: a caller who supplies the name recorded against their own
 * action can forge the record.
 *
 * ── EVERY WRITE IS A LEDGER ROW (R-8) ──────────────────────────────────────
 * Written server-side inside lib/assignments.ts as a side effect of the action,
 * never by the browser — which is why /api/activity was deleted in Batch 22.
 */

const AssignSchema = z.object({
  memberId: z.string().uuid(),
  projectId: z.string().uuid(),
  // null is MEANINGFUL and is not the same as omitting the field: 0057 defines a
  // null project_role as "on the production, no stated role", which resolves to
  // no baseline. `.nullable()` rather than `.optional()` so a caller has to say so.
  projectRole: z.string().nullable(),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
})

const UnassignSchema = z.object({
  memberId: z.string().uuid(),
  projectId: z.string().uuid(),
})

/** The caller, their org, and the capability. Returns the USER client because
 *  every write below must go through it. */
async function gate() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  if (!(await can(user, 'people.invite'))) {
    return {
      error: NextResponse.json(
        { error: 'You do not have permission for this. Required: people.manage.' },
        { status: 403 },
      ),
    }
  }
  return { user, supabase, orgId: userOrgId(user) }
}

/** Target name and project title, on the USER client — so RLS supplies the org
 *  predicate and the assigner's own project scope. A row the caller may not see
 *  comes back null and the route answers 404, which is the right answer for both
 *  "does not exist" and "not yours": a distinguishable response would disclose
 *  another studio's roster by id (T-2). */
async function resolveNames(
  db: SupabaseClient, memberId: string, projectId: string | null,
) {
  const [{ data: m }, { data: p }] = await Promise.all([
    db.from('organization_members').select('id, name').eq('id', memberId).maybeSingle(),
    projectId
      ? db.from('projects').select('id, title').eq('id', projectId).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  return {
    member: m as { id: string; name: string | null } | null,
    project: p as { id: string; title: string | null } | null,
  }
}

export async function GET(req: NextRequest) {
  const g = await gate()
  if ('error' in g) return g.error
  const memberId = req.nextUrl.searchParams.get('memberId')
  const projectId = req.nextUrl.searchParams.get('projectId')
  try {
    if (memberId) {
      return NextResponse.json({ assignments: await listForMember(g.supabase, memberId) })
    }
    if (projectId) {
      return NextResponse.json({ staffing: await listForProject(g.supabase, projectId) })
    }
    return NextResponse.json({ error: 'memberId or projectId is required.' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Read failed.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const g = await gate()
  if ('error' in g) return g.error
  const parsed = AssignSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request.' }, { status: 400 },
    )
  }
  const body = parsed.data
  // The CHECK would refuse an unknown role with a 23514 mid-write; refuse it here
  // with a sentence instead. zod cannot express the vocabulary without a second
  // copy of it, so the guard reads PROJECT_ROLES directly (lib/assignments.ts).
  if (body.projectRole !== null && !isProjectRole(body.projectRole)) {
    return NextResponse.json({ error: `Unknown project role: ${body.projectRole}.` }, { status: 400 })
  }
  const { member, project } = await resolveNames(g.supabase, body.memberId, body.projectId)
  if (!member) return NextResponse.json({ error: 'Member not found.' }, { status: 404 })
  if (!project) return NextResponse.json({ error: 'Production not found.' }, { status: 404 })

  try {
    const { created } = await assign(g.supabase, {
      id: g.user.id,
      name: (await rosterName(g.user)) ?? g.user.email?.split('@')[0] ?? 'Member',
      organizationId: g.orgId,
    }, {
      memberId: body.memberId,
      projectId: body.projectId,
      projectRole: body.projectRole,
      expiresAt: body.expiresAt,
      targetName: member.name ?? null,
      projectTitle: project.title ?? null,
    })
    return NextResponse.json({ success: true, created })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Assign failed.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const g = await gate()
  if ('error' in g) return g.error
  const parsed = UnassignSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request.' }, { status: 400 },
    )
  }
  const { member, project } = await resolveNames(g.supabase, parsed.data.memberId, parsed.data.projectId)
  if (!member) return NextResponse.json({ error: 'Member not found.' }, { status: 404 })

  try {
    await unassign(g.supabase, {
      id: g.user.id,
      name: (await rosterName(g.user)) ?? g.user.email?.split('@')[0] ?? 'Member',
      organizationId: g.orgId,
    }, {
      memberId: parsed.data.memberId,
      projectId: parsed.data.projectId,
      targetName: member.name ?? null,
      projectTitle: project?.title ?? null,
    })
    return NextResponse.json({ success: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unassign failed.' }, { status: 500 })
  }
}
