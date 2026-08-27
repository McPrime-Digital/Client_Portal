import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isAdmin, userOrgId } from '@/lib/auth/role'
import { orgRolesOf, canManageOrg } from '@/lib/team'
import { cutMemberAccess, restoreOrgAccess, statusCutsAccess } from '@/lib/memberAccess'
import { recordUsage } from '@/lib/usage'

// Org crew management. GET roster · POST invite · PATCH role · DELETE revoke.
// Gates read organization_members (table is truth), never the JWT.

async function requireManager() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const role = await orgRolesOf(user)
  if (!canManageOrg(role)) return { error: NextResponse.json({ error: 'Only org owners and admins can manage the team.' }, { status: 403 }) }
  return { user, role }
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data } = await supabaseAdmin
    .from('organization_members')
    .select('id, user_id, name, email, role, roles, extra_caps, title, status, invited_at, accepted_at, invited_by')
    .eq('organization_id', userOrgId(user))
    .neq('status', 'revoked')
    .order('created_at', { ascending: true })
  const me = await orgRolesOf(user)
  return NextResponse.json({ members: data ?? [], myRole: me, canManage: canManageOrg(me) })
}

export async function POST(req: NextRequest) {
  const gate = await requireManager()
  if ('error' in gate) return gate.error
  const { user } = gate

  const { name, email, role, roles: extraRoles } = await req.json().catch(() => ({}))
  const cleanEmail = String(email ?? '').trim().toLowerCase()
  const VALID = ['admin', 'producer', 'finance', 'editor', 'member']
  const memberRole = VALID.includes(role) ? role : 'member'
  const additional = Array.isArray(extraRoles) ? extraRoles.filter((r) => VALID.includes(r) && r !== memberRole) : []
  if (!cleanEmail || !name?.trim()) return NextResponse.json({ error: 'Name and email are required.' }, { status: 400 })

  // Per-tenant, not global. Unscoped this is the T-2 disclosure in a second
  // place: "already on the team" for an address that is actually on ANOTHER
  // studio's crew tells the caller who that studio employs, one probe at a time.
  const { data: existing } = await supabaseAdmin
    .from('organization_members')
    .select('id, status')
    .eq('organization_id', userOrgId(user))
    .eq('email', cleanEmail)
    .neq('status', 'revoked')
    .maybeSingle()
  if (existing) return NextResponse.json({ error: 'That email is already on the team.' }, { status: 409 })

  const { data: invite, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(cleanEmail, {
    data: { name: name.trim() },
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/set-password`,
  })
  if (inviteError) return NextResponse.json({ error: inviteError.message }, { status: 500 })

  // crew members are studio users: role 'admin' opens the studio; the
  // membership row's role governs what they may actually do.
  await supabaseAdmin.auth.admin.updateUserById(invite.user.id, {
    app_metadata: { role: 'admin', organization_id: userOrgId(user), org_role: memberRole },
  })

  const { data: row, error } = await supabaseAdmin
    .from('organization_members')
    .insert({
      organization_id: userOrgId(user),
      user_id: invite.user.id,
      name: name.trim(),
      email: cleanEmail,
      role: memberRole,
      roles: additional,
      status: 'invited',
      invited_by: user.id,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  void recordUsage(userOrgId(user), 'seat.invited', 1, 0, { side: 'org', member_id: row.id }, user.id)
  return NextResponse.json({ success: true, member: row, message: `Invite sent to ${cleanEmail}.` })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireManager()
  if ('error' in gate) return gate.error
  const { memberId, role, roles: extraRoles, status, extraCaps, title } = await req.json().catch(() => ({}))
  const VALID = ['owner', 'admin', 'producer', 'finance', 'editor', 'member']
  if (!memberId || (role !== undefined && !VALID.includes(role))) {
    return NextResponse.json({ error: 'Invalid role.' }, { status: 400 })
  }
  if (status !== undefined && !['paused', 'active'].includes(status)) {
    return NextResponse.json({ error: 'status must be "paused" or "active".' }, { status: 400 })
  }
  const additional =
    extraRoles !== undefined && Array.isArray(extraRoles)
      ? extraRoles.filter((r) => VALID.includes(r) && r !== 'owner')
      : undefined
  // memberId comes from the body — the org predicate is what stops an admin of
  // one tenant patching another tenant's crew row.
  const { data: target } = await supabaseAdmin
    .from('organization_members')
    .select('id, user_id, role')
    .eq('id', memberId)
    .eq('organization_id', userOrgId(gate.user))
    .maybeSingle()
  if (!target) return NextResponse.json({ error: 'Member not found.' }, { status: 404 })
  if (target.role === 'owner' && !gate.role.includes('owner')) {
    return NextResponse.json({ error: 'Only an owner can change an owner.' }, { status: 403 })
  }
  const CAPS = ['org_settings', 'manage_team', 'manage_clients', 'client_money', 'run_projects', 'workspace', 'cost_control']
  const patch: Record<string, unknown> = {}
  if (role !== undefined) patch.role = role
  if (extraCaps !== undefined && Array.isArray(extraCaps)) patch.extra_caps = extraCaps.filter((c) => CAPS.includes(c))
  if (title !== undefined) patch.title = String(title ?? '').trim().slice(0, 40) || null
  if (additional !== undefined) patch.roles = additional.filter((r) => r !== (role ?? target.role))
  if (status !== undefined) patch.status = status
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to change — pass role, roles, status, extraCaps, or title.' }, { status: 400 })
  }
  const { error } = await supabaseAdmin
    .from('organization_members')
    .update(patch)
    .eq('id', memberId)
    .eq('organization_id', userOrgId(gate.user))
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (target.user_id) {
    // A claim strip that fails must surface: reporting success while the member
    // keeps role='admin' is the whole defect this guards against.
    let claimError: string | null = null
    if (statusCutsAccess(status)) {
      // Hold: studio access is cut on the next request (proxy re-reads
      // app_metadata via getUser). RLS follows at the next token refresh — see
      // lib/memberAccess.ts for why that window cannot be closed here.
      claimError = await cutMemberAccess(target.user_id)
    } else if (status === 'active') {
      claimError = await restoreOrgAccess(target.user_id, role ?? target.role)
    } else if (role !== undefined) {
      const { error: e } = await supabaseAdmin.auth.admin.updateUserById(target.user_id, {
        app_metadata: { org_role: role },
      })
      claimError = e ? e.message : null
    }
    if (claimError) {
      return NextResponse.json(
        { error: `Roster updated, but the member's access claims could not be changed: ${claimError}` },
        { status: 500 },
      )
    }
  }
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const gate = await requireManager()
  if ('error' in gate) return gate.error
  const { user } = gate
  const { memberId } = await req.json().catch(() => ({}))
  // Org predicate before anything else: this handler DELETES an auth account.
  // Unscoped, an admin of one tenant could destroy another tenant's crew login.
  const { data: target } = await supabaseAdmin
    .from('organization_members')
    .select('id, user_id, role, email')
    .eq('id', memberId)
    .eq('organization_id', userOrgId(user))
    .maybeSingle()
  if (!target) return NextResponse.json({ error: 'Member not found.' }, { status: 404 })
  if (target.user_id === user.id) return NextResponse.json({ error: 'You cannot revoke yourself.' }, { status: 400 })
  if (target.role === 'owner' && !gate.role.includes('owner')) {
    return NextResponse.json({ error: 'Only an owner can revoke an owner.' }, { status: 403 })
  }
  // Deletion is forever: the auth account itself goes — no Throughline access
  // of any kind remains. (Pause is the reversible option.)
  if (target.user_id) {
    await supabaseAdmin.auth.admin.deleteUser(target.user_id)
  }
  const { error } = await supabaseAdmin
    .from('organization_members')
    .delete()
    .eq('id', memberId)
    .eq('organization_id', userOrgId(user))
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
