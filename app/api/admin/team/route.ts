import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isAdmin, userOrgId } from '@/lib/auth/role'
import { orgRolesOf, canManageOrg } from '@/lib/team'
import { ORG_GRANTABLE } from '@/lib/permissions'
import { can, resolveCaps } from '@/lib/capabilities.server'
import { setMemberGrants, recordRoleChange, listMemberGrants, type DesiredGrant } from '@/lib/grants'
import { rosterName } from '@/lib/team'
import { cutMemberAccess, restoreOrgAccess, statusCutsAccess } from '@/lib/memberAccess'
import { recordUsage } from '@/lib/usage'
import { sendTenantInvite } from '@/lib/email/invite'

// Org crew management. GET roster · POST invite · PATCH role · DELETE revoke.
// Gates read organization_members (table is truth), never the JWT.

async function requireManager() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const role = await orgRolesOf(user)
  // THE CAPABILITY, NOT THE ROLE LIST (Batch 24 item 8's probe found this).
  // canManageOrg(role) tests role ∈ {owner, admin}. Migration 0053 widened the
  // ROW to has_cap('people.manage') — so a person GRANTED people.manage was
  // admitted by the database and refused here, which makes the grant surface
  // able to hand out an authority the route then ignores. The whole point of the
  // capability layer is that a grant works; a route that only understands roles
  // is the "hiding a tile" problem inverted.
  if (!(await can(user, 'people.invite'))) {
    return { error: NextResponse.json({ error: 'You need people.manage to manage the team.' }, { status: 403 }) }
  }
  // The USER client is returned, not just the user: grant writes must go through
  // it so 0054's G-1…G-4 triggers see auth.uid(). See lib/grants.ts.
  return { user, role, supabase }
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // TWO PAYLOADS, NOT A 403 (Batch 24 item 5).
  //
  // This GET used to gate on isAdmin(user) alone while POST/PATCH/DELETE gated on
  // canManageOrg — the claim-shaped hole item 1b's probe found. It returned the
  // ENTIRE crew roster (every email, role, status, extra_caps, title, invite
  // metadata) to any crew member.
  //
  // But refusing outright would have broken a live surface: RoomThread.tsx:931
  // fetches this for the IN-ROOM ROSTER, and it needs only { name, role }. A crew
  // member seeing who is in the room they are standing in is not roster
  // management, and a 403 there would have blanked the roster panel for
  // coordinator and crew — the very roles this batch exists to make usable.
  //
  // So the capability narrows the PAYLOAD. Without people.roster.read you get
  // names and roles; with it you get the administrative record. The disclosure
  // that matters is email / status / extra_caps / invite metadata, not "who is
  // on this team".
  const me = await orgRolesOf(user)
  if (me.length === 0) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const full = await can(user, 'people.roster.read')

  const { data } = await supabaseAdmin
    .from('organization_members')
    .select(
      full
        ? 'id, user_id, name, email, role, roles, extra_caps, title, status, invited_at, accepted_at, invited_by'
        : 'id, name, role',
    )
    .eq('organization_id', userOrgId(user))
    .neq('status', 'revoked')
    .order('created_at', { ascending: true })
  // The individual grants, so the surface can show what was given or withheld
  // per person, by whom, and when (S-R §8 / item 8). Read on the USER client:
  // 0053's policy and 0051's self-read are the authorization, and a manager
  // holding people.manage sees the org's rows either way.
  // The dynamic select() defeats supabase-js's row typing, so the shape is
  // asserted once here rather than at each use.
  const rows = (data ?? []) as unknown as { id: string; name?: string }[]
  const grants = full
    ? await listMemberGrants(supabase, 'crew', rows.map((m) => m.id))
    : new Map()
  // G-1 IS ENFORCED IN A TRIGGER AND OFFERED IN THE UI. The picker must show
  // only what the granter holds, or it invites a click that the database will
  // refuse — and a refusal the user could not have predicted reads as a bug.
  // The trigger stays the control; this is the courtesy.
  const mine = await resolveCaps(user)
  return NextResponse.json({
    members: rows,
    grants: Object.fromEntries(grants),
    myCaps: [...mine.caps],
    myRole: me,
    canManage: canManageOrg(me),
    // So a client can tell a reduced payload from an empty roster (S-R S-3: an
    // empty state must not be indistinguishable from a denial).
    scope: full ? 'full' : 'names',
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireManager()
  if ('error' in gate) return gate.error
  const { user } = gate

  const { name, email, role, roles: extraRoles } = await req.json().catch(() => ({}))
  const cleanEmail = String(email ?? '').trim().toLowerCase()
  // S-R §3.1's assignable roles plus the two deprecated aliases, which stay
  // ACCEPTED so the existing team UI (which still sends 'member') keeps working
  // until item 8 replaces the picker with ORG_ROLES_ASSIGNABLE. 'owner' is
  // deliberately not invitable — an owner is made by provision-tenant or by an
  // existing owner via PATCH, never by an invite form.
  //
  // These two new values are safe to accept ONLY because migration 0050 widened
  // organization_members_role_check in the same commit. sendTenantInvite runs
  // BEFORE the roster insert, so accepting a value the CHECK refuses would
  // deliver the invite email and then 23514 the insert — the person gets a
  // working link to an account with no roster row. That is HANDOFF's Batch 12.2
  // defect (a 23505 firing after the email) and the reason the ordering is
  // stated here rather than assumed.
  const VALID = ['admin', 'producer', 'coordinator', 'finance', 'crew', 'editor', 'member']
  // Default is 'crew', not 'member': 'member' is the deprecated alias S-R §3.1
  // retires, and a default is the surest way to keep a retired name alive.
  const memberRole = VALID.includes(role) ? role : 'crew'
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

  // A crew seat is globally exclusive today: organization_members.user_id is
  // unique across ALL orgs (0012:17), so an address already on any roster —
  // another studio's, or a stale revoked row — would pass the per-tenant check
  // above, SEND the invite email, and then die on the insert with a raw 23505.
  // Check before the email goes out. The message is deliberately identical to
  // the same-org 409: a distinguishable answer would disclose who another
  // studio employs (the T-2 probe the comment above describes). Whether one
  // identity may hold two crew seats is an open S1 §2 question — this handles
  // the constraint as it stands, it does not decide the question.
  const { data: anywhere } = await supabaseAdmin
    .from('organization_members')
    .select('id')
    .eq('email', cleanEmail)
    .limit(1)
  if ((anywhere ?? []).length > 0) {
    return NextResponse.json({ error: 'That email is already on the team.' }, { status: 409 })
  }

  const invite = await sendTenantInvite({
    email: cleanEmail,
    orgId: userOrgId(user),
    audience: 'crew',
    data: { name: name.trim() },
  })
  if (invite.error || !invite.user) {
    return NextResponse.json({ error: invite.error?.message ?? 'Could not invite.' }, { status: 500 })
  }

  // ROSTER ROW FIRST, CLAIMS SECOND. This order is load-bearing, and it used to
  // be the other way round: app_metadata was stamped before the insert, so any
  // failure in between left an account holding a full crew claim with no roster
  // row. That state used to resolve to member-level studio access via the
  // orgRolesOf() bootstrap fallback; it now resolves to no roles at all, but
  // the ordering matters for a second reason that does not depend on the
  // fallback — a claim is a grant, and a grant must never be written before the
  // record that justifies it. Same order as scripts/provision-tenant.ts.
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
  if (error) {
    // Backstop for the pre-check above: the same person invited under a
    // different address still trips the global user_id uniqueness. Same
    // non-disclosing 409 instead of a raw Postgres 23505.
    if (error.code === '23505') {
      return NextResponse.json({ error: 'That email is already on the team.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // THE CLAIM IS ROUTING, AND ONLY ROUTING (S-R R-2, Batch 24 item 1b step 2).
  // `role: 'admin'` is the two-valued crew/client axis of lib/auth/role.ts:26 —
  // it is what opens /studio in proxy.ts and what 61 call sites read as "this is
  // a crew session, not a client one". It stays, and it stays 'admin' for every
  // crew member whatever their roster role, because that is what it means.
  //
  // What is GONE is `org_role`. It was a copy of the roster role written into
  // app_metadata by six call sites and read by NONE — the audit's q4 grep found
  // zero readers. A capability copied into a token is a capability as it was at
  // token issue, and the token survives until logout; the roster row it was
  // copied from is what every gate now reads (step 1). So the copy could only
  // ever be stale, misleading, or both, and its absence is what makes
  // "nothing authorizes on the claim" true rather than intended.
  //
  // A failed claim stamp must surface (I-10) — reporting success while the
  // invitee cannot enter the studio sends an admin looking for a bug in the
  // email. The roster row stays: it is the record of the invitation, the invite
  // email has already gone out, and re-inviting or resending re-stamps the
  // claim. Reporting it is what makes that recoverable.
  const { error: claimError } = await supabaseAdmin.auth.admin.updateUserById(invite.user.id, {
    app_metadata: { role: 'admin', organization_id: userOrgId(user) },
  })
  if (claimError) {
    return NextResponse.json(
      { error: `${cleanEmail} was added to the roster, but their studio access claim could not be set: ${claimError.message}. Resend the invite to retry.` },
      { status: 500 },
    )
  }

  // Awaited (Batch 6.5's fix, applied here too): `void` races the lambda
  // freeze and the seat row is lost. Usage cannot be backfilled — S-V §11.
  await recordUsage(userOrgId(user), 'seat.invited', 1, 0, { side: 'org', member_id: row.id }, user.id)
  return NextResponse.json({ success: true, member: row, message: `Invite sent to ${cleanEmail}.` })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireManager()
  if ('error' in gate) return gate.error
  const { memberId, role, roles: extraRoles, status, extraCaps, title, grants } = await req.json().catch(() => ({}))
  // PATCH's list, which differs from POST's by ONE value and must: an existing
  // owner may promote someone to 'owner', an invite form may not create one.
  // Widened with 'coordinator' and 'crew' alongside the 0050 CHECK — a second
  // list two hundred lines from the first is exactly how one of them gets
  // missed, so both are changed in this commit and this comment says why there
  // are two. (Found by grepping the identifier after changing POST's.)
  const VALID = ['owner', 'admin', 'producer', 'coordinator', 'finance', 'crew', 'editor', 'member']
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
    .select('id, user_id, role, name')
    .eq('id', memberId)
    .eq('organization_id', userOrgId(gate.user))
    .maybeSingle()
  if (!target) return NextResponse.json({ error: 'Member not found.' }, { status: 404 })
  if (target.role === 'owner' && !gate.role.includes('owner')) {
    return NextResponse.json({ error: 'Only an owner can change an owner.' }, { status: 403 })
  }
  // DERIVED, not repeated. This was a FOURTH hand-maintained copy of the
  // capability vocabulary, in snake_case, and it is `string[]` so tsc could not
  // see it go stale — after the 0051 rename it would have silently filtered out
  // every value the grant UI sent, writing an empty extra_caps and reading as
  // "no custom access" rather than as an error. It also omitted
  // 'approval_policy', which ORG_GRANTABLE has offered since Batch 22, so that
  // capability was ungrantable here by accident.
  const CAPS: string[] = ORG_GRANTABLE.map((g) => g.cap)
  const patch: Record<string, unknown> = {}
  if (role !== undefined) patch.role = role
  if (extraCaps !== undefined && Array.isArray(extraCaps)) patch.extra_caps = extraCaps.filter((c) => CAPS.includes(c))
  if (title !== undefined) patch.title = String(title ?? '').trim().slice(0, 40) || null
  if (additional !== undefined) patch.roles = additional.filter((r) => r !== (role ?? target.role))
  if (status !== undefined) patch.status = status
  // ── INDIVIDUAL GRANTS (item 8) ──────────────────────────────────────────
  // Written through lib/grants.ts on the USER client, because 0054's G-1…G-4
  // triggers read auth.uid() and pass a service-role write straight through.
  // Handing this the admin client would disable every delegation rule while
  // looking identical at the call site.
  if (Array.isArray(grants)) {
    try {
      const desired: DesiredGrant[] = grants
        .filter((g: unknown): g is DesiredGrant =>
          !!g && typeof g === 'object'
          && typeof (g as DesiredGrant).capability === 'string'
          && ((g as DesiredGrant).mode === 'grant' || (g as DesiredGrant).mode === 'deny'))
        .map((g: DesiredGrant) => ({
          capability: g.capability, mode: g.mode,
          expiresAt: g.expiresAt ? new Date(g.expiresAt).toISOString() : null,
        }))
      const result = await setMemberGrants(gate.supabase, {
        side: 'crew',
        memberId,
        organizationId: userOrgId(gate.user),
        desired,
        actorId: gate.user.id,
        actorName: (await rosterName(gate.user)) ?? 'A manager',
        actorRole: 'admin',
        targetName: (target as { name?: string }).name ?? null,
      })
      if (Object.keys(patch).length === 0) {
        return NextResponse.json({ success: true, grants: result })
      }
    } catch (e) {
      // 0054 raises a named SQLSTATE so this can be a sentence rather than a 500.
      const code = (e as { code?: string }).code
      const say: Record<string, string> = {
        GR001: 'You cannot grant a capability you do not hold yourself.',
        GR002: 'That is not a grantable capability.',
        GR003: 'You cannot change your own capabilities.',
        GR004: 'Only an owner can change an owner.',
        GR005: 'An organization must keep at least one active owner.',
      }
      return NextResponse.json(
        { error: (code && say[code]) ?? (e as Error).message, code: code ?? null },
        { status: code ? 403 : 500 },
      )
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to change — pass role, roles, status, extraCaps, title, or grants.' }, { status: 400 })
  }
  const { error } = await supabaseAdmin
    .from('organization_members')
    .update(patch)
    .eq('id', memberId)
    .eq('organization_id', userOrgId(gate.user))
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // R-8: a role change is a ledger event. Written after the row, so the record
  // never claims a change that did not land.
  if (role !== undefined && role !== target.role) {
    await recordRoleChange({
      organizationId: userOrgId(gate.user),
      memberId,
      from: target.role as string,
      to: role,
      actorId: gate.user.id,
      actorName: (await rosterName(gate.user)) ?? 'A manager',
      actorRole: 'admin',
      targetName: (target as { name?: string }).name ?? null,
    })
  }

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
      claimError = await restoreOrgAccess(target.user_id)
    }
    // A role change no longer touches the claim at all. It used to re-stamp
    // `org_role` here, which is the maintenance a stale copy demands — and the
    // copy had no readers. The roster UPDATE above IS the role change, and
    // every gate reads the roster on the next request (step 1).
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
  // Removal takes the MEMBERSHIP, not the account. The login survives — the
  // identity may span tenants (S1 §2), and after 0021 an account with no
  // roster row reads nothing anyway.
  //
  // The claims cut used to be the ONLY thing standing between a removed member
  // and continued member-level studio access, because orgRolesOf() resolved a
  // claim-admin with no roster row to ['member'] (the T-4 bootstrap fallback).
  // Batch 7 item 5 deleted that fallback and its three downstream copies, so
  // deleting the row is now sufficient on its own. The cut stays: defence in
  // depth is the point, an account carrying role='admin' that grants nothing is
  // a lie about itself, and the claim is what proxy.ts routes on — without the
  // cut the person still lands on /studio, just to be told they have no access.
  // (Pause is the reversible option.)
  if (target.user_id) {
    const claimError = await cutMemberAccess(target.user_id)
    if (claimError) {
      return NextResponse.json(
        { error: `The member's access claims could not be cut, so they were not removed: ${claimError}` },
        { status: 500 },
      )
    }
  }
  const { error } = await supabaseAdmin
    .from('organization_members')
    .delete()
    .eq('id', memberId)
    .eq('organization_id', userOrgId(user))
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
