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
  //
  // SCOPED BY SPACE (the owner's correction, 2026-09-03). The crew space is
  // the studio's INTERNAL floor: crew and external collaborators, and no
  // client companies at all — offering a client contact for an internal
  // channel was the bug. The client space is the studio's window onto one
  // company, so its directory is that company's people (plus crew, who staff
  // the room). A client owner/approver still sees only the studio's
  // owners/admins, which is the whole set they may DM.
  //
  //   ?people=1&scope=internal            → crew + seated collaborators
  //   ?people=1&scope=client&client_id=X  → company X's members + crew
  //   ?people=1                           → back-compat: internal
  if (req.nextUrl.searchParams.get('people') === '1') {
    const orgId = userOrgId(user)
    const scope = req.nextUrl.searchParams.get('scope') ?? 'internal'
    const forClient = req.nextUrl.searchParams.get('client_id')
    try {
      if (isAdmin(user)) {
        const { data: oms } = await supabaseAdmin
          .from('organization_members')
          .select('user_id, name, role, avatar_url')
          .eq('organization_id', orgId).eq('status', 'active').not('user_id', 'is', null)
        const crew = (oms ?? []).map((m) => ({
          id: m.user_id as string, name: m.name as string,
          avatarUrl: (m.avatar_url as string) ?? null,
          side: 'crew' as const, sub: `Studio · ${m.role}`,
        }))

        if (scope === 'client') {
          if (!forClient) return NextResponse.json({ people: crew.filter((p) => p.id !== user.id) })
          const { data: company } = await supabaseAdmin
            .from('clients').select('id, name, company, organization_id')
            .eq('id', forClient).maybeSingle()
          if (!company || company.organization_id !== orgId) {
            return NextResponse.json({ people: [] })
          }
          const { data: cms } = await supabaseAdmin
            .from('client_members')
            .select('user_id, name, role, avatar_url')
            .eq('client_id', forClient).eq('status', 'active').not('user_id', 'is', null)
          const label = (company.company ?? company.name) as string
          const people = [
            ...(cms ?? []).map((m) => ({
              id: m.user_id as string, name: m.name as string,
              avatarUrl: (m.avatar_url as string) ?? null,
              side: 'client' as const, sub: `${label} · ${m.role}`,
            })),
            ...crew,
          ].filter((p) => p.id !== user.id)
          return NextResponse.json({ people })
        }

        // INTERNAL. Crew, plus anyone seated in a room the caller shares who
        // holds no roster row on either side — the MD-4 collaborator. They
        // belong here precisely because they are not a client's contact.
        const { data: mySeats } = await supabaseAdmin
          .from('room_members').select('room_id').eq('user_id', user.id).is('left_at', null)
        const myRoomIds = (mySeats ?? []).map((s) => s.room_id as string)
        const collaborators: typeof crew = []
        if (myRoomIds.length) {
          const { data: peers } = await supabaseAdmin
            .from('room_members')
            .select('user_id, display_name, avatar_url')
            .in('room_id', myRoomIds).is('left_at', null).limit(1000)
          const peerIds = [...new Set((peers ?? []).map((p) => p.user_id as string))]
            .filter((id) => id !== user.id && !crew.some((c) => c.id === id))
          if (peerIds.length) {
            const { data: clientPeers } = await supabaseAdmin
              .from('client_members').select('user_id')
              .eq('organization_id', orgId).in('user_id', peerIds)
            const rostered = new Set((clientPeers ?? []).map((r) => r.user_id as string))
            for (const id of peerIds) {
              if (rostered.has(id)) continue
              const seat = (peers ?? []).find((p) => p.user_id === id)
              collaborators.push({
                id,
                name: (seat?.display_name as string) ?? 'Collaborator',
                avatarUrl: (seat?.avatar_url as string) ?? null,
                side: 'crew' as const,
                sub: 'Collaborator',
              })
            }
          }
        }
        return NextResponse.json({
          people: [...crew, ...collaborators].filter((p) => p.id !== user.id),
        })
      }
      // Client side: only an owner/approver gets a list, and it is the
      // studio's owner/admin seats (the DM counterparty rule).
      // Owner-only, matching the creation gate below: showing an approver a
      // list of people they cannot actually message is worse than showing
      // them nothing.
      const { data: me } = await supabaseAdmin.from('client_members')
        .select('role').eq('organization_id', orgId).eq('user_id', user.id)
        .eq('status', 'active').maybeSingle()
      if (!me || (me.role as string) !== 'owner') {
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
        supabaseAdmin.from('client_members').select('id, role, client_id')
          .eq('organization_id', orgId).eq('user_id', user.id).eq('status', 'active').maybeSingle(),
      ])
      const [{ data: otherOm }, { data: otherCm }] = await Promise.all([
        supabaseAdmin.from('organization_members').select('id, role')
          .eq('organization_id', orgId).eq('user_id', input.with_user_id).eq('status', 'active').maybeSingle(),
        supabaseAdmin.from('client_members').select('id, role, client_id')
          .eq('organization_id', orgId).eq('user_id', input.with_user_id).eq('status', 'active').maybeSingle(),
      ])

      if (myOm) {
        if (!otherOm && !otherCm) {
          return NextResponse.json({ error: 'That person is not in this organization.' }, { status: 403 })
        }
      } else if (myCm) {
        // OWNER ONLY on the client side (the owner's rule, 2026-09-03 — it
        // was owner-or-approver in Batch 23). Everyone else takes part in the
        // DMs and groups they are seated in; opening a new line to the studio
        // is the account owner's decision. RLS still admits an approver, so
        // this route is the narrower of the two gates and says so out loud.
        if ((myCm.role as string) !== 'owner') {
          return NextResponse.json(
            { error: 'Only the company owner can start a direct message with the studio.' },
            { status: 403 }
          )
        }
        if (!otherOm || !['owner', 'admin'].includes(otherOm.role as string)) {
          return NextResponse.json(
            { error: 'Direct messages reach the studio\'s owners and admins.' }, { status: 403 })
        }
      } else {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
      }

      // The company on one side of the conversation routes it to a space.
      // Crew↔crew stays internal (null); anything touching a client company
      // is client-facing work and surfaces in Client › Messages.
      const dmClientId =
        (otherCm?.client_id as string | undefined) ??
        (myCm ? ((myCm as { client_id?: string }).client_id ?? null) : null) ??
        null

      const room = await ensureDm(supabase, {
        orgId, createdBy: user.id, otherUserId: input.with_user_id,
        clientId: dmClientId,
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
