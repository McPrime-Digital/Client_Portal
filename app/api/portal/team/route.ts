import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { userOrgId } from '@/lib/auth/role'
import { cutMemberAccess, restoreClientAccess, statusCutsAccess } from '@/lib/memberAccess'
import { clientMembershipOf } from '@/lib/team'
import { clientCan } from '@/lib/permissions'
import { recordUsage } from '@/lib/usage'
import { createAdminNotification } from '@/lib/notify'
import { appUrl } from '@/lib/appOrigin'

// The client company's own team management. Owner invites teammates
// (marketing team, stakeholders), assigns roles, revokes. Honors the
// per-company invite policy the org sets: open | approval | locked.

const INVITABLE_ROLES = ['approver', 'member', 'viewer']

async function requireMembership() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const membership = await clientMembershipOf(user)
  if (!membership) return { error: NextResponse.json({ error: 'No client account found.' }, { status: 403 }) }
  return { user, membership }
}

export async function GET() {
  const gate = await requireMembership()
  if ('error' in gate) return gate.error
  const { membership } = gate
  const [{ data: members }, { data: company }, { data: projects }] = await Promise.all([
    supabaseAdmin
      .from('client_members')
      .select('id, user_id, name, email, role, status, invited_at, accepted_at, history_from, extra_caps, title, client_member_projects(project_id)')
      .eq('client_id', membership.clientId)
      .neq('status', 'revoked')
      .order('created_at', { ascending: true }),
    supabaseAdmin.from('clients').select('invite_policy, name, company').eq('id', membership.clientId).single(),
    supabaseAdmin.from('projects').select('id, title').eq('client_id', membership.clientId).order('created_at', { ascending: false }),
  ])
  return NextResponse.json({
    members: members ?? [],
    myRole: membership.role,
    canManage: clientCan(membership.role, 'manage_team', membership.extraCaps),
    invitePolicy: company?.invite_policy ?? 'open',
    projects: projects ?? [],
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireMembership()
  if ('error' in gate) return gate.error
  const { user, membership } = gate
  if (!clientCan(membership.role, 'manage_team', membership.extraCaps)) {
    return NextResponse.json({ error: 'You need team-management access to invite teammates.' }, { status: 403 })
  }

  const { data: company } = await supabaseAdmin
    .from('clients')
    .select('id, name, company, invite_policy, organization_id')
    .eq('id', membership.clientId)
    .single()
  if (!company) return NextResponse.json({ error: 'Account not found.' }, { status: 404 })
  if (company.invite_policy === 'locked') {
    return NextResponse.json({ error: 'Team invites are managed by your studio. Ask them to add seats.' }, { status: 403 })
  }

  const { name, email, role, history, projectIds } = await req.json().catch(() => ({}))
  const cleanEmail = String(email ?? '').trim().toLowerCase()
  const memberRole = INVITABLE_ROLES.includes(role) ? role : 'member'
  if (!cleanEmail || !name?.trim()) return NextResponse.json({ error: 'Name and email are required.' }, { status: 400 })
  // Owner's call: full message history, or only what's written after they join.
  const historyFrom = history === 'new' ? new Date().toISOString() : null
  // Optional project scoping — no rows means the member sees every project.
  const scopeIds: string[] = Array.isArray(projectIds) ? projectIds.filter((v) => typeof v === 'string') : []

  const { data: existing } = await supabaseAdmin
    .from('client_members')
    .select('id, status')
    .eq('client_id', company.id)
    .eq('email', cleanEmail)
    .maybeSingle()
  if (existing && existing.status !== 'revoked') {
    return NextResponse.json({ error: 'That email is already on your team.' }, { status: 409 })
  }

  const needsApproval = company.invite_policy === 'approval'
  let invitedUserId: string | null = null

  if (!needsApproval) {
    const { data: invite, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(cleanEmail, {
      data: { name: name.trim() },
      redirectTo: appUrl('/set-password'),
    })
    if (inviteError) return NextResponse.json({ error: inviteError.message }, { status: 500 })
    invitedUserId = invite.user.id
    await supabaseAdmin.auth.admin.updateUserById(invite.user.id, {
      app_metadata: { role: 'client', client_id: company.id, organization_id: company.organization_id },
    })
  }

  const row = {
    client_id: company.id,
    organization_id: company.organization_id,
    user_id: invitedUserId,
    name: name.trim(),
    email: cleanEmail,
    role: memberRole,
    status: needsApproval ? 'pending' : 'invited',
    invited_by: user.id,
    history_from: historyFrom,
  }
  const { data: member, error } = existing
    ? await supabaseAdmin.from('client_members').update(row).eq('id', existing.id).select().single()
    : await supabaseAdmin.from('client_members').insert(row).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (scopeIds.length > 0) {
    // Only this company's projects can be scoped; ignore anything else.
    const { data: owned } = await supabaseAdmin.from('projects').select('id').eq('client_id', company.id).in('id', scopeIds)
    const rows = (owned ?? []).map((p) => ({ member_id: member.id, project_id: p.id }))
    if (rows.length > 0) await supabaseAdmin.from('client_member_projects').insert(rows)
  }

  // Awaited (Batch 6.5's fix, applied here too): `void` races the lambda
  // freeze and the seat row is lost. Usage cannot be backfilled — S-V §11.
  await recordUsage(userOrgId(user), 'seat.invited', 1, 0, { side: 'client', client_id: company.id, member_id: member.id }, user.id)
  void createAdminNotification({
    type: needsApproval ? 'member_invite_pending' : 'member_invited',
    title: needsApproval
      ? `${company.company || company.name} wants to add ${name.trim()} — approval needed`
      : `${company.company || company.name} invited ${name.trim()} (${memberRole})`,
    body: cleanEmail,
    clientId: company.id,
  })

  return NextResponse.json({
    success: true,
    member,
    message: needsApproval
      ? `Request sent — your studio will approve ${cleanEmail} shortly.`
      : `Invite sent to ${cleanEmail}.`,
  })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireMembership()
  if ('error' in gate) return gate.error
  const { membership } = gate
  if (!clientCan(membership.role, 'manage_team', membership.extraCaps)) return NextResponse.json({ error: 'You need team-management access to manage teammates.' }, { status: 403 })
  const { memberId, role, status, extraCaps, title } = await req.json().catch(() => ({}))
  if (!memberId) return NextResponse.json({ error: 'memberId required.' }, { status: 400 })
  if (role !== undefined && !INVITABLE_ROLES.includes(role)) return NextResponse.json({ error: 'Invalid role.' }, { status: 400 })
  if (status !== undefined && !['paused', 'active'].includes(status)) {
    return NextResponse.json({ error: 'status must be "paused" or "active".' }, { status: 400 })
  }
  const CAPS = ['view', 'message', 'upload', 'approve', 'invoices', 'manage_team']
  const patch: Record<string, unknown> = {}
  if (role !== undefined) patch.role = role
  if (status !== undefined) patch.status = status
  if (extraCaps !== undefined && Array.isArray(extraCaps)) patch.extra_caps = extraCaps.filter((c) => CAPS.includes(c))
  if (title !== undefined) patch.title = String(title ?? '').trim().slice(0, 40) || null
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 })
  // Read the target back so the claim change below applies to a row that is
  // provably inside this company (and not the owner).
  const { data: target } = await supabaseAdmin
    .from('client_members')
    .select('id, user_id, organization_id')
    .eq('id', memberId)
    .eq('client_id', membership.clientId)
    .neq('role', 'owner')
    .maybeSingle()
  if (!target) return NextResponse.json({ error: 'Member not found.' }, { status: 404 })

  const { error } = await supabaseAdmin
    .from('client_members')
    .update(patch)
    .eq('id', memberId)
    .eq('client_id', membership.clientId)
    .neq('role', 'owner')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Previously this updated the roster row ONLY. A paused teammate kept
  // role='client' and client_id in app_metadata, so the portal let them
  // straight back in and RLS never stopped reading their rows.
  if (status !== undefined && target.user_id) {
    const claimError = statusCutsAccess(status)
      ? await cutMemberAccess(target.user_id)
      : await restoreClientAccess(target.user_id, membership.clientId, target.organization_id)
    if (claimError) {
      return NextResponse.json(
        { error: `Roster updated, but the teammate's access claims could not be changed: ${claimError}` },
        { status: 500 },
      )
    }
  }
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const gate = await requireMembership()
  if ('error' in gate) return gate.error
  const { user, membership } = gate
  if (!clientCan(membership.role, 'manage_team', membership.extraCaps)) return NextResponse.json({ error: 'You need team-management access to remove teammates.' }, { status: 403 })
  const { memberId } = await req.json().catch(() => ({}))
  const { data: target } = await supabaseAdmin
    .from('client_members')
    .select('id, user_id, role')
    .eq('id', memberId)
    .eq('client_id', membership.clientId)
    .single()
  if (!target) return NextResponse.json({ error: 'Member not found.' }, { status: 404 })
  if (target.role === 'owner' || target.user_id === user.id) {
    return NextResponse.json({ error: 'The account owner cannot be removed here.' }, { status: 400 })
  }
  // Removal takes the MEMBERSHIP, not the account. The login survives — it
  // may belong to another tenant (S1 §2: one identity can be crew at one org
  // and a client contact elsewhere), and after 0021 an account with no roster
  // row reads nothing anyway. Claims are cut like a revocation so the stale
  // role/client_id cannot route them anywhere while their token lives.
  // (Pause is the reversible option.)
  if (target.user_id) {
    const claimError = await cutMemberAccess(target.user_id)
    if (claimError) {
      return NextResponse.json(
        { error: `The teammate's access claims could not be cut, so they were not removed: ${claimError}` },
        { status: 500 },
      )
    }
  }
  const { error } = await supabaseAdmin.from('client_members').delete().eq('id', target.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
