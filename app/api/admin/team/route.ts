import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isAdmin, userOrgId } from '@/lib/auth/role'
import { orgRolesOf, canManageOrg } from '@/lib/team'
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
    .select('id, user_id, name, email, role, roles, status, invited_at, accepted_at, invited_by')
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

  const { data: existing } = await supabaseAdmin
    .from('organization_members')
    .select('id, status')
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
  const { memberId, role, roles: extraRoles } = await req.json().catch(() => ({}))
  const VALID = ['owner', 'admin', 'producer', 'finance', 'editor', 'member']
  if (!memberId || (role !== undefined && !VALID.includes(role))) {
    return NextResponse.json({ error: 'Invalid role.' }, { status: 400 })
  }
  const additional =
    extraRoles !== undefined && Array.isArray(extraRoles)
      ? extraRoles.filter((r) => VALID.includes(r) && r !== 'owner')
      : undefined
  const { data: target } = await supabaseAdmin
    .from('organization_members')
    .select('id, user_id, role')
    .eq('id', memberId)
    .single()
  if (!target) return NextResponse.json({ error: 'Member not found.' }, { status: 404 })
  if (target.role === 'owner' && !gate.role.includes('owner')) {
    return NextResponse.json({ error: 'Only an owner can change an owner.' }, { status: 403 })
  }
  const patch: Record<string, unknown> = {}
  if (role !== undefined) patch.role = role
  if (additional !== undefined) patch.roles = additional.filter((r) => r !== (role ?? target.role))
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to change — pass role and/or roles.' }, { status: 400 })
  }
  const { error } = await supabaseAdmin.from('organization_members').update(patch).eq('id', memberId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (target.user_id && role !== undefined) {
    await supabaseAdmin.auth.admin.updateUserById(target.user_id, { app_metadata: { org_role: role } })
  }
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const gate = await requireManager()
  if ('error' in gate) return gate.error
  const { user } = gate
  const { memberId } = await req.json().catch(() => ({}))
  const { data: target } = await supabaseAdmin
    .from('organization_members')
    .select('id, user_id, role, email')
    .eq('id', memberId)
    .single()
  if (!target) return NextResponse.json({ error: 'Member not found.' }, { status: 404 })
  if (target.user_id === user.id) return NextResponse.json({ error: 'You cannot revoke yourself.' }, { status: 400 })
  if (target.role === 'owner' && !gate.role.includes('owner')) {
    return NextResponse.json({ error: 'Only an owner can revoke an owner.' }, { status: 403 })
  }
  const { error } = await supabaseAdmin
    .from('organization_members')
    .update({ status: 'revoked' })
    .eq('id', memberId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // cut studio access immediately
  if (target.user_id) {
    await supabaseAdmin.auth.admin.updateUserById(target.user_id, {
      app_metadata: { role: null, org_role: null },
    })
  }
  return NextResponse.json({ success: true })
}
