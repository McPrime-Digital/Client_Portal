import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isAdmin, userOrgId } from '@/lib/auth/role'
import { orgAccessOf, portalAccess } from '@/lib/team'
import { recordActivity } from '@/lib/logActivity.server'
import { EVENT_TYPES } from '@/lib/logActivity'

// Logs an activity entry server-side (service role), so the browser never
// touches activity_log directly (which RLS blocks).
//
// The ledger is contractual (S0 P-1: "who signed off on v3, and when" settles
// disputes), so NOTHING here is trusted from the body:
//   · actor_id / actor_role — from the authenticated session.
//   · actor_name — from the ROSTER row, never user_metadata (which the user
//     can rewrite via updateUser({ data }) and so can impersonate with).
//   · the TARGET — projectId/clientId are validated against the caller's own
//     access (I-6). Before this, any authenticated user could write arbitrary
//     entries into any tenant's ledger.
//   · organization_id — stamped from the verified target row (the table is
//     truth), never the column default (T-5).

const ActivitySchema = z.object({
  projectId: z.uuid().nullish(),
  clientId: z.uuid().nullish(),
  eventType: z.enum(EVENT_TYPES),
  title: z.string().trim().min(1).max(500),
  body: z.string().max(4000).nullish(),
  meta: z.record(z.string(), z.unknown()).optional(),
}).refine((v) => v.projectId || v.clientId, {
  message: 'An entry must target a project or a client.',
}).refine((v) => !v.meta || JSON.stringify(v.meta).length <= 8192, {
  message: 'meta too large.',
})

// One 404 for every authorization miss: a probe must not learn whether the
// uuid exists, exists in another tenant, or is merely out of the caller's
// project scope.
const NOT_FOUND = NextResponse.json({ error: 'Not found.' }, { status: 404 })

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = ActivitySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request.' },
      { status: 400 },
    )
  }
  const { projectId, eventType, title, body: detail, meta } = parsed.data
  let clientId = parsed.data.clientId ?? null

  // The target row, fetched once; both branches authorize against it and the
  // stamped organization_id comes from it rather than any claim or default.
  const project = projectId
    ? (await supabaseAdmin
        .from('projects')
        .select('id, client_id, organization_id')
        .eq('id', projectId)
        .maybeSingle()).data
    : null
  if (projectId && !project) return NOT_FOUND

  let actorName: string
  let actorRole: 'admin' | 'client'
  let organizationId: string

  if (isAdmin(user)) {
    // ── crew ────────────────────────────────────────────────────────────────
    const access = await orgAccessOf(user)
    if (access.roles.length === 0) return NOT_FOUND // not an active member
    const org = userOrgId(user)

    if (project) {
      if (project.organization_id !== org) return NOT_FOUND
      if (access.projectIds !== null && !access.projectIds.includes(project.id)) return NOT_FOUND
      if (clientId && project.client_id && clientId !== project.client_id) return NOT_FOUND
      // Complete the row: a project entry belongs to that project's company.
      clientId = clientId ?? project.client_id ?? null
      organizationId = project.organization_id
    } else {
      const { data: company } = await supabaseAdmin
        .from('clients')
        .select('id, organization_id')
        .eq('id', clientId!)
        .maybeSingle()
      if (!company || company.organization_id !== org) return NOT_FOUND
      organizationId = company.organization_id
    }

    const { data: roster } = await supabaseAdmin
      .from('organization_members')
      .select('name')
      .eq('user_id', user.id)
      .maybeSingle()
    actorName = roster?.name || user.email?.split('@')[0] || 'Member'
    actorRole = 'admin'
  } else {
    // ── client portal ───────────────────────────────────────────────────────
    const access = await portalAccess(user)
    if (!access) return NOT_FOUND
    if (clientId && clientId !== access.clientId) return NOT_FOUND
    clientId = access.clientId

    if (project) {
      if (project.client_id !== access.clientId) return NOT_FOUND
      if (access.projectIds !== null && !access.projectIds.includes(project.id)) return NOT_FOUND
      organizationId = project.organization_id
    } else {
      const { data: company } = await supabaseAdmin
        .from('clients')
        .select('id, organization_id')
        .eq('id', access.clientId)
        .maybeSingle()
      if (!company) return NOT_FOUND
      organizationId = company.organization_id
    }

    const { data: roster } = await supabaseAdmin
      .from('client_members')
      .select('name')
      .eq('client_id', access.clientId)
      .eq('user_id', user.id)
      .maybeSingle()
    actorName = roster?.name || user.email?.split('@')[0] || 'Member'
    actorRole = 'client'
  }

  await recordActivity({
    projectId: projectId ?? undefined,
    clientId: clientId ?? undefined,
    organizationId,
    actorId: user.id,
    actorName,
    actorRole,
    eventType,
    title,
    body: detail ?? undefined,
    meta: (meta as Record<string, unknown> | undefined) ?? undefined,
  })

  return NextResponse.json({ success: true })
}
