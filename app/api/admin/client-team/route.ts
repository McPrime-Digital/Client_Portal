import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isAdmin, userOrgId } from '@/lib/auth/role'
import { orgRolesOf, canManageOrg } from '@/lib/team'
import { createNotification } from '@/lib/notify'
import { cutMemberAccess, restoreClientAccess, statusCutsAccess } from '@/lib/memberAccess'

// Org oversight of a client company's team: full roster, approve pending
// invites, invite directly, change roles, revoke, set the invite policy.

async function requireManager() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const role = await orgRolesOf(user)
  if (!canManageOrg(role)) return { error: NextResponse.json({ error: 'Only org owners and admins can manage client teams.' }, { status: 403 }) }
  // Every lookup and every write below carries this predicate. Before it,
  // each action keyed off a bare body id — an org admin of ANY tenant could
  // approve, pause, re-role or delete another tenant's client teammate, and
  // flip another tenant's invite policy, by id (the Batch 3A hole, fixed on
  // admin/team, missed here).
  return { user, orgId: userOrgId(user) }
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const clientId = req.nextUrl.searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  const orgId = userOrgId(user)
  const [{ data: members }, { data: company }] = await Promise.all([
    supabaseAdmin
      .from('client_members')
      .select('id, user_id, name, email, role, status, invited_at, accepted_at, invited_by, extra_caps, title')
      .eq('client_id', clientId)
      .eq('organization_id', orgId)
      .order('created_at', { ascending: true }),
    supabaseAdmin.from('clients').select('invite_policy').eq('id', clientId).eq('organization_id', orgId).single(),
  ])
  const me = await orgRolesOf(user)
  return NextResponse.json({
    members: members ?? [],
    invitePolicy: company?.invite_policy ?? 'open',
    canManage: canManageOrg(me),
  })
}

export async function POST(req: NextRequest) {
  // approve a pending invite, or invite a member directly on the client's behalf
  const gate = await requireManager()
  if ('error' in gate) return gate.error
  const { orgId } = gate
  const body = await req.json().catch(() => ({}))
  const { action } = body

  if (action === 'approve') {
    const { data: member } = await supabaseAdmin
      .from('client_members')
      .select('id, client_id, name, email, role, status')
      .eq('id', body.memberId)
      .eq('organization_id', orgId)
      .single()
    if (!member || member.status !== 'pending') {
      return NextResponse.json({ error: 'No pending invite found.' }, { status: 404 })
    }
    const { data: company } = await supabaseAdmin
      .from('clients')
      .select('id, organization_id')
      .eq('id', member.client_id)
      .eq('organization_id', orgId)
      .single()
    const { data: invite, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(member.email, {
      data: { name: member.name },
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/set-password`,
    })
    if (inviteError) return NextResponse.json({ error: inviteError.message }, { status: 500 })
    await supabaseAdmin.auth.admin.updateUserById(invite.user.id, {
      app_metadata: { role: 'client', client_id: member.client_id, organization_id: company?.organization_id },
    })
    await supabaseAdmin
      .from('client_members')
      .update({ user_id: invite.user.id, status: 'invited' })
      .eq('id', member.id)
    void createNotification({
      clientId: member.client_id,
      type: 'member_invited',
      title: `${member.name} was approved and invited to your team`,
      body: member.email,
    })
    return NextResponse.json({ success: true, message: `Approved — invite sent to ${member.email}.` })
  }

  if (action === 'reject') {
    const { data: target } = await supabaseAdmin
      .from('client_members')
      .select('id, user_id')
      .eq('id', body.memberId)
      .eq('organization_id', orgId)
      .eq('status', 'pending')
      .maybeSingle()
    if (!target) return NextResponse.json({ error: 'No pending invite found.' }, { status: 404 })

    const { error } = await supabaseAdmin
      .from('client_members')
      .update({ status: 'revoked' })
      .eq('id', body.memberId)
      .eq('organization_id', orgId)
      .eq('status', 'pending')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // A rejected invite usually has no auth account yet (pending means the
    // invite was never sent), but strip the claims when one exists so a
    // rejection is never weaker than a pause.
    if (target?.user_id) {
      const claimError = await cutMemberAccess(target.user_id)
      if (claimError) {
        return NextResponse.json(
          { error: `Invite rejected, but the account's access claims could not be changed: ${claimError}` },
          { status: 500 },
        )
      }
    }
    return NextResponse.json({ success: true })
  }

  if (action === 'set_policy') {
    if (!['open', 'approval', 'locked'].includes(body.policy)) {
      return NextResponse.json({ error: 'Invalid policy.' }, { status: 400 })
    }
    const { error } = await supabaseAdmin
      .from('clients')
      .update({ invite_policy: body.policy })
      .eq('id', body.clientId)
      .eq('organization_id', orgId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  if (action === 'set_role') {
    if (!['approver', 'member', 'viewer'].includes(body.role)) {
      return NextResponse.json({ error: 'Invalid role.' }, { status: 400 })
    }
    const { error } = await supabaseAdmin
      .from('client_members')
      .update({ role: body.role })
      .eq('id', body.memberId)
      .eq('organization_id', orgId)
      .neq('role', 'owner')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  if (action === 'set_access') {
    // custom grants + custom role name, curated by the org
    const CAPS = ['view', 'message', 'upload', 'approve', 'invoices', 'manage_team']
    const patch: Record<string, unknown> = {}
    if (Array.isArray(body.extraCaps)) patch.extra_caps = body.extraCaps.filter((c: string) => CAPS.includes(c))
    if (body.title !== undefined) patch.title = String(body.title ?? '').trim().slice(0, 40) || null
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Pass extraCaps and/or title.' }, { status: 400 })
    const { error } = await supabaseAdmin
      .from('client_members')
      .update(patch)
      .eq('id', body.memberId)
      .eq('organization_id', orgId)
      .neq('role', 'owner')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  if (action === 'pause' || action === 'resume') {
    const { data: target } = await supabaseAdmin
      .from('client_members')
      .select('id, user_id, client_id, organization_id')
      .eq('id', body.memberId)
      .eq('organization_id', orgId)
      .neq('role', 'owner')
      .maybeSingle()
    if (!target) return NextResponse.json({ error: 'Member not found.' }, { status: 404 })

    const nextStatus = action === 'pause' ? 'paused' : 'active'
    const { error } = await supabaseAdmin
      .from('client_members')
      .update({ status: nextStatus })
      .eq('id', body.memberId)
      .eq('organization_id', orgId)
      .neq('role', 'owner')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Roster status alone did not cut access: app_metadata kept role='client'
    // and client_id, so a paused teammate walked straight back into the portal.
    if (target.user_id) {
      const claimError = statusCutsAccess(nextStatus)
        ? await cutMemberAccess(target.user_id)
        : await restoreClientAccess(target.user_id, target.client_id, target.organization_id)
      if (claimError) {
        return NextResponse.json(
          { error: `Roster updated, but the teammate's access claims could not be changed: ${claimError}` },
          { status: 500 },
        )
      }
    }
    return NextResponse.json({ success: true })
  }

  if (action === 'delete') {
    const { data: target } = await supabaseAdmin
      .from('client_members')
      .select('id, user_id, role')
      .eq('id', body.memberId)
      .eq('organization_id', orgId)
      .single()
    if (!target) return NextResponse.json({ error: 'Member not found.' }, { status: 404 })
    if (target.role === 'owner') return NextResponse.json({ error: 'The account owner cannot be deleted here.' }, { status: 400 })
    // Removal takes the MEMBERSHIP, not the account. The auth user survives:
    // S1 §2 allows one identity to span the crew and another company, and
    // after 0021 an account with no roster row reads nothing anyway. The
    // claims are cut like a revocation so the stale role/client_id cannot
    // route them anywhere while their token lives.
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

  return NextResponse.json({ error: `Unknown action: ${action ?? '(none)'} — expected approve, reject, set_policy, set_role, pause, resume, or delete.` }, { status: 400 })
}
