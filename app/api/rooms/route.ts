import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { userOrgId, isAdmin } from '@/lib/auth/role'
import { myRooms, createRoom, ensureDm } from '@/lib/rooms'

/**
 * /api/rooms — Batch 23 (S3-d §8 step 8). The room LIST and room CREATION.
 *
 * The split of clients is deliberate and layered:
 *   · CREATION runs on the USER client. 0046's policies are the authorization
 *     — crew create channels/groups/broadcasts/DMs in their org; a client
 *     owner/approver creates only a DM (the owner's product decision,
 *     2026-09-03); the creator-first-seat bootstrap makes the seats land
 *     under RLS too. AD-001 as written, on a brand-new surface.
 *   · The LIST reads with the service role AFTER auth, because labelling a
 *     room means reading rosters across both trees (names, avatars) that RLS
 *     correctly refuses to hand a client session. TRANSITIONAL allowlist
 *     entry; the membership half of the query is RLS-shaped already.
 *
 * WHO A DM MAY REACH (owner decision, recorded):
 *   · crew → anyone in the org's two trees (crew or client member);
 *   · client owner/approver → the org's owner/admin seats only;
 *   · client → client (their own company included): refused. The portal is
 *     the company's window into the STUDIO, not a personal messenger.
 */

const CreateSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.enum(['channel', 'group', 'broadcast']),
    name: z.string().trim().min(1).max(80),
    topic: z.string().trim().max(240).optional(),
    is_private: z.boolean().optional(),
    project_id: z.string().uuid().nullish(),
    client_id: z.string().uuid().nullish(),
    member_ids: z.array(z.string().uuid()).max(200).optional(),
  }),
  z.object({
    kind: z.literal('dm'),
    with_user_id: z.string().uuid(),
  }),
])

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ── The people directory: who can I put in a room / DM? ──────────────────
  // Crew see both trees of their org (the crew space has no limits — the
  // owner's brief). A client owner/approver sees the studio's owners and
  // admins — exactly the set they may DM, nothing broader.
  if (req.nextUrl.searchParams.get('people') === '1') {
    const orgId = userOrgId(user)
    try {
      if (isAdmin(user)) {
        const [{ data: oms }, { data: cms }, { data: companies }] = await Promise.all([
          supabaseAdmin.from('organization_members')
            .select('user_id, name, role, avatar_url')
            .eq('organization_id', orgId).eq('status', 'active').not('user_id', 'is', null),
          supabaseAdmin.from('client_members')
            .select('user_id, name, role, avatar_url, client_id')
            .eq('organization_id', orgId).eq('status', 'active').not('user_id', 'is', null),
          supabaseAdmin.from('clients')
            .select('id, name, company').eq('organization_id', orgId),
        ])
        const companyBy = new Map((companies ?? []).map((c) => [c.id as string, (c.company ?? c.name) as string]))
        const people = [
          ...(oms ?? []).map((m) => ({
            id: m.user_id as string, name: m.name as string, avatarUrl: (m.avatar_url as string) ?? null,
            side: 'crew' as const, sub: `Studio · ${m.role}`,
          })),
          ...(cms ?? []).map((m) => ({
            id: m.user_id as string, name: m.name as string, avatarUrl: (m.avatar_url as string) ?? null,
            side: 'client' as const, sub: companyBy.get(m.client_id as string) ?? 'Client',
          })),
        ].filter((p) => p.id !== user.id)
        return NextResponse.json({ people })
      }
      // Client side: only an owner/approver gets a list, and it is the
      // studio's owner/admin seats (the DM counterparty rule).
      const { data: me } = await supabaseAdmin.from('client_members')
        .select('role').eq('organization_id', orgId).eq('user_id', user.id)
        .eq('status', 'active').maybeSingle()
      if (!me || !['owner', 'approver'].includes(me.role as string)) {
        return NextResponse.json({ people: [] })
      }
      const { data: oms } = await supabaseAdmin.from('organization_members')
        .select('user_id, name, role, avatar_url')
        .eq('organization_id', orgId).eq('status', 'active')
        .in('role', ['owner', 'admin']).not('user_id', 'is', null)
      return NextResponse.json({
        people: (oms ?? []).map((m) => ({
          id: m.user_id as string, name: m.name as string, avatarUrl: (m.avatar_url as string) ?? null,
          side: 'crew' as const, sub: `Studio · ${m.role}`,
        })),
      })
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Directory failed' }, { status: 500 })
    }
  }

  try {
    const rooms = await myRooms(supabaseAdmin, user.id)
    return NextResponse.json({ rooms, me: user.id })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Room list failed' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = CreateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid room payload' }, { status: 400 })
  }
  const input = parsed.data
  const orgId = userOrgId(user)

  try {
    if (input.kind === 'dm') {
      // Route-level counterparty rule; the ROW-level rules (kind, tenancy,
      // creator) are 0046's policies, enforced by the user-client write.
      const [{ data: myOm }, { data: myCm }] = await Promise.all([
        supabaseAdmin.from('organization_members').select('id, role')
          .eq('organization_id', orgId).eq('user_id', user.id).eq('status', 'active').maybeSingle(),
        supabaseAdmin.from('client_members').select('id, role')
          .eq('organization_id', orgId).eq('user_id', user.id).eq('status', 'active').maybeSingle(),
      ])
      const [{ data: otherOm }, { data: otherCm }] = await Promise.all([
        supabaseAdmin.from('organization_members').select('id, role')
          .eq('organization_id', orgId).eq('user_id', input.with_user_id).eq('status', 'active').maybeSingle(),
        supabaseAdmin.from('client_members').select('id, role')
          .eq('organization_id', orgId).eq('user_id', input.with_user_id).eq('status', 'active').maybeSingle(),
      ])

      if (myOm) {
        if (!otherOm && !otherCm) {
          return NextResponse.json({ error: 'That person is not in this organization.' }, { status: 403 })
        }
      } else if (myCm) {
        if (!['owner', 'approver'].includes(myCm.role as string)) {
          return NextResponse.json(
            { error: 'Only a company owner or approver can start a direct message.' }, { status: 403 })
        }
        if (!otherOm || !['owner', 'admin'].includes(otherOm.role as string)) {
          return NextResponse.json(
            { error: 'Direct messages reach the studio\'s owners and admins.' }, { status: 403 })
        }
      } else {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
      }

      const room = await ensureDm(supabase, {
        orgId, createdBy: user.id, otherUserId: input.with_user_id,
      })
      return NextResponse.json({ room })
    }

    // channel / group / broadcast — crew only (the RLS insert policy already
    // refuses a client session; the isAdmin gate keeps the error friendly).
    if (!isAdmin(user)) {
      return NextResponse.json({ error: 'Only the studio side can create rooms.' }, { status: 403 })
    }

    // Seats must belong to this tenant's two trees — server-resolved (I-6).
    const memberIds = [...new Set(input.member_ids ?? [])].filter((id) => id !== user.id)
    let validMembers: { userId: string }[] = []
    if (memberIds.length) {
      const [{ data: oms }, { data: cms }] = await Promise.all([
        supabaseAdmin.from('organization_members').select('user_id')
          .eq('organization_id', orgId).eq('status', 'active').in('user_id', memberIds),
        supabaseAdmin.from('client_members').select('user_id')
          .eq('organization_id', orgId).eq('status', 'active').in('user_id', memberIds),
      ])
      const ok = new Set([
        ...(oms ?? []).map((r) => r.user_id as string),
        ...(cms ?? []).map((r) => r.user_id as string),
      ])
      validMembers = memberIds.filter((id) => ok.has(id)).map((userId) => ({ userId }))
    }

    if (input.project_id) {
      const { data: proj } = await supabaseAdmin.from('projects')
        .select('id, organization_id').eq('id', input.project_id).maybeSingle()
      if (!proj || proj.organization_id !== orgId) {
        return NextResponse.json({ error: 'Unknown project.' }, { status: 400 })
      }
    }
    if (input.client_id) {
      const { data: cli } = await supabaseAdmin.from('clients')
        .select('id, organization_id').eq('id', input.client_id).maybeSingle()
      if (!cli || cli.organization_id !== orgId) {
        return NextResponse.json({ error: 'Unknown client.' }, { status: 400 })
      }
    }

    const room = await createRoom(supabase, {
      orgId,
      createdBy: user.id,
      kind: input.kind,
      name: input.name,
      topic: input.topic ?? null,
      isPrivate: input.is_private ?? true,
      projectId: input.project_id ?? null,
      clientId: input.client_id ?? null,
      members: validMembers,
    })
    return NextResponse.json({ room })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Room creation failed' },
      { status: 500 }
    )
  }
}
