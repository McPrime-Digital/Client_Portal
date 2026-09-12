import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isAdmin, userOrgId } from '@/lib/auth/role'
import { orgRolesOf, canManageOrg, rosterName } from '@/lib/team'
import { CLIENT_GRANTABLE } from '@/lib/permissions'
import { setMemberGrants, listMemberGrants, recordRoleChange, type DesiredGrant } from '@/lib/grants'
import { can } from '@/lib/capabilities.server'
import { createNotification } from '@/lib/notify'
import { cutMemberAccess, restoreClientAccess, statusCutsAccess } from '@/lib/memberAccess'
import { sendTenantInvite } from '@/lib/email/invite'

// Org oversight of a client company's team: full roster, approve pending
// invites, invite directly, change roles, revoke, set the invite policy.

async function requireManager() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  // THE CAPABILITY, NOT THE ROLE LIST (Batch 24 item 8's probe found this).
  // canManageOrg(role) tests role ∈ {owner, admin}. Migration 0053 widened the
  // ROW to has_cap('people.manage') — so a person GRANTED people.manage was
  // admitted by the database and refused here, which makes the grant surface
  // able to hand out an authority the route then ignores. The whole point of the
  // capability layer is that a grant works; a route that only understands roles
  // is the "hiding a tile" problem inverted.
  if (!(await can(user, 'people.invite'))) {
    return { error: NextResponse.json({ error: 'You need people.manage to manage client teams.' }, { status: 403 }) }
  }
  // The gate above covers every MUTATION that uses this helper. GET does not use
  // it — it has its own two-payload treatment, because the in-room roster needs
  // names without needing the administrative record.
  // Every lookup and every write below carries this predicate. Before it,
  // each action keyed off a bare body id — an org admin of ANY tenant could
  // approve, pause, re-role or delete another tenant's client teammate, and
  // flip another tenant's invite policy, by id (the Batch 3A hole, fixed on
  // admin/team, missed here).
  // The USER client too: grant writes go through it so 0054's triggers see
  // auth.uid(). See lib/grants.ts.
  return { user, orgId: userOrgId(user), supabase }
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const me = await orgRolesOf(user)
  if (me.length === 0) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const clientId = req.nextUrl.searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  const orgId = userOrgId(user)

  // Two payloads, same reasoning as admin/team's GET: RoomThread.tsx:930 fetches
  // this for the in-room roster and needs only { name, role }, so a 403 would
  // blank a live messaging surface for coordinator and crew. The capability
  // narrows what is returned — email, status, extra_caps and invite metadata are
  // the administrative record; names and roles are who is in the room.
  const full = await can(user, 'people.roster.read')

  const [{ data: members }, { data: company }] = await Promise.all([
    supabaseAdmin
      .from('client_members')
      .select(
        full
          ? 'id, user_id, name, email, role, status, invited_at, accepted_at, invited_by, extra_caps, title'
          : 'id, name, role',
      )
      .eq('client_id', clientId)
      .eq('organization_id', orgId)
      .order('created_at', { ascending: true }),
    supabaseAdmin.from('clients').select('invite_policy').eq('id', clientId).eq('organization_id', orgId).single(),
  ])
  const rows = (members ?? []) as unknown as { id: string; name?: string }[]
  const grants = full ? await listMemberGrants(supabase, 'client', rows.map((m) => m.id)) : new Map()
  // A STUDIO actor administering a client company is bounded by the studio's own
  // ceiling, not by portal capabilities they do not hold at all (S-R §6's two
  // ceilings). Holding people.manage is what lets them set any portal capability
  // here, so the picker offers all of them; 0054's trigger is still the control.
  return NextResponse.json({
    members: rows,
    grants: Object.fromEntries(grants),
    myCaps: full ? CLIENT_GRANTABLE.map((g) => g.cap) : [],
    // The invite policy is an administrative setting, not room-roster data.
    invitePolicy: full ? (company?.invite_policy ?? 'open') : null,
    canManage: canManageOrg(me),
    scope: full ? 'full' : 'names',
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
    const invite = await sendTenantInvite({
      email: member.email,
      orgId: company?.organization_id ?? orgId,
      audience: 'client_teammate',
      data: { name: member.name },
    })
    if (invite.error || !invite.user) {
      return NextResponse.json({ error: invite.error?.message ?? 'Could not invite.' }, { status: 500 })
    }
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
    // Read the row back first: R-8 needs the FROM value, and a ledger entry
    // written from what the caller sent rather than from what the row held is a
    // record of an intention, not of a change.
    const { data: before } = await supabaseAdmin
      .from('client_members').select('id, role, name, client_id')
      .eq('id', body.memberId).eq('organization_id', orgId).neq('role', 'owner').maybeSingle()
    if (!before) return NextResponse.json({ error: 'Member not found.' }, { status: 404 })
    const { error } = await supabaseAdmin
      .from('client_members')
      .update({ role: body.role })
      .eq('id', body.memberId)
      .eq('organization_id', orgId)
      .neq('role', 'owner')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await recordRoleChange({
      organizationId: orgId,
      clientId: before.client_id as string,
      memberId: body.memberId,
      from: before.role as string,
      to: body.role,
      actorId: gate.user.id,
      actorName: (await rosterName(gate.user)) ?? 'A manager',
      actorRole: 'admin',
      targetName: (before as { name?: string }).name ?? null,
    })
    return NextResponse.json({ success: true })
  }

  if (action === 'set_access') {
    // custom grants + custom role name, curated by the org
    // Derived from the shared vocabulary — see the note in admin/team.
    const CAPS: string[] = CLIENT_GRANTABLE.map((g) => g.cap)
    // INDIVIDUAL GRANTS (item 8), written on the USER client so 0054's triggers
    // are the control. Sent instead of extraCaps by the new surface; extraCaps
    // stays accepted for the length of the rollout.
    if (Array.isArray(body.grants)) {
      const { data: tgt } = await supabaseAdmin
        .from('client_members').select('id, name, client_id, organization_id')
        .eq('id', body.memberId).eq('organization_id', orgId).maybeSingle()
      if (!tgt) return NextResponse.json({ error: 'Member not found.' }, { status: 404 })
      try {
        const desired: DesiredGrant[] = (body.grants as DesiredGrant[])
          .filter((g) => !!g && typeof g.capability === 'string' && (g.mode === 'grant' || g.mode === 'deny'))
          .map((g) => ({
            capability: g.capability, mode: g.mode,
            expiresAt: g.expiresAt ? new Date(g.expiresAt).toISOString() : null,
          }))
        await setMemberGrants(gate.supabase, {
          side: 'client',
          memberId: body.memberId,
          organizationId: orgId,
          clientId: tgt.client_id as string,
          desired,
          actorId: gate.user.id,
          actorName: (await rosterName(gate.user)) ?? 'A manager',
          actorRole: 'admin',
          targetName: (tgt as { name?: string }).name ?? null,
        })
        return NextResponse.json({ success: true })
      } catch (e) {
        const code = (e as { code?: string }).code
        const say: Record<string, string> = {
          GR001: 'You cannot grant a capability you do not hold yourself.',
          GR002: 'That is not a grantable capability.',
          GR003: 'You cannot change your own capabilities.',
          GR004: 'Only an owner can change an owner.',
          GR005: 'A client company must keep at least one active owner.',
        }
        return NextResponse.json(
          { error: (code && say[code]) ?? (e as Error).message, code: code ?? null },
          { status: code ? 403 : 500 },
        )
      }
    }
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
