import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isAdmin } from '@/lib/auth/role'
import { orgRoleOf, canManageOrg } from '@/lib/team'
import { createNotification } from '@/lib/notify'

// Org oversight of a client company's team: full roster, approve pending
// invites, invite directly, change roles, revoke, set the invite policy.

async function requireManager() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const role = await orgRoleOf(user)
  if (!canManageOrg(role)) return { error: NextResponse.json({ error: 'Only org owners and admins can manage client teams.' }, { status: 403 }) }
  return { user }
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const clientId = req.nextUrl.searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  const [{ data: members }, { data: company }] = await Promise.all([
    supabaseAdmin
      .from('client_members')
      .select('id, user_id, name, email, role, status, invited_at, accepted_at, invited_by')
      .eq('client_id', clientId)
      .order('created_at', { ascending: true }),
    supabaseAdmin.from('clients').select('invite_policy').eq('id', clientId).single(),
  ])
  const me = await orgRoleOf(user)
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
  const body = await req.json().catch(() => ({}))
  const { action } = body

  if (action === 'approve') {
    const { data: member } = await supabaseAdmin
      .from('client_members')
      .select('id, client_id, name, email, role, status')
      .eq('id', body.memberId)
      .single()
    if (!member || member.status !== 'pending') {
      return NextResponse.json({ error: 'No pending invite found.' }, { status: 404 })
    }
    const { data: company } = await supabaseAdmin
      .from('clients')
      .select('id, organization_id')
      .eq('id', member.client_id)
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
    const { error } = await supabaseAdmin
      .from('client_members')
      .update({ status: 'revoked' })
      .eq('id', body.memberId)
      .eq('status', 'pending')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
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
      .neq('role', 'owner')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  if (action === 'revoke') {
    const { data: target } = await supabaseAdmin
      .from('client_members')
      .select('id, user_id, role')
      .eq('id', body.memberId)
      .single()
    if (!target) return NextResponse.json({ error: 'Member not found.' }, { status: 404 })
    if (target.role === 'owner') return NextResponse.json({ error: 'The account owner cannot be revoked.' }, { status: 400 })
    const { error } = await supabaseAdmin.from('client_members').update({ status: 'revoked' }).eq('id', target.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (target.user_id) {
      await supabaseAdmin.auth.admin.updateUserById(target.user_id, {
        app_metadata: { role: null, client_id: null },
      })
    }
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: `Unknown action: ${action ?? '(none)'} — expected approve, reject, set_policy, set_role, or revoke.` }, { status: 400 })
}
