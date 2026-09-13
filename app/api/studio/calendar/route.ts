import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdmin, userOrgId } from '@/lib/auth/role'
import { capGate } from '@/lib/capabilities.server'
import {
  createManualEntry, updateManualEntry, deleteManualEntry,
} from '@/lib/calendar'
import { captureError } from '@/lib/errors'

/**
 * Manual calendar entries — create (POST), edit (PATCH), remove (DELETE).
 *
 * NO SERVICE-ROLE CLIENT. Every call runs on the cookie-bound user client, so
 * 0065's policy is the authorization: org match, membership, and the project
 * scope of the production the entry is tagged to. A contractor scoped to one
 * production cannot put an entry on another's calendar, and that is the policy
 * saying so rather than this file.
 *
 * DERIVED ENTRIES ARE NOT EDITABLE HERE, and this route is the SECOND line.
 * An approval deadline and an invoice due date are projections written by 0074's
 * triggers; editing one on the calendar would be overwritten the next time its
 * source is saved, so the edit would silently vanish. The database refuses it
 * (`calendar_entry_projection_guard`); this returns a sentence explaining WHERE
 * to change it, because a 500 from a trigger is not an answer a person can act
 * on.
 *
 * THE ORG COMES FROM THE SESSION, NEVER THE BODY (I-6).
 */

const CreateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }).nullish(),
  allDay: z.boolean().optional(),
  kind: z.enum(['manual', 'shoot_day', 'meeting']).optional(),
  projectId: z.uuid().nullish(),
  clientId: z.uuid().nullish(),
}).refine((b) => !b.endsAt || b.endsAt >= b.startsAt, {
  message: 'An entry cannot end before it starts.',
})

const PatchSchema = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1).max(300).optional(),
  startsAt: z.iso.datetime({ offset: true }).optional(),
  endsAt: z.iso.datetime({ offset: true }).nullish(),
  allDay: z.boolean().optional(),
  projectId: z.uuid().nullish(),
})

const DeleteSchema = z.object({ id: z.uuid() })

const DERIVED_MESSAGE =
  'That entry comes from an approval or an invoice. Change the date where it lives and the calendar follows.'

async function gate() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const denied = await capGate(user, 'work.project.update')
  if (denied) return { error: NextResponse.json(denied, { status: 403 }) }
  return { supabase, user }
}

export async function POST(req: NextRequest) {
  const g = await gate()
  if ('error' in g) return g.error
  const { supabase, user } = g

  const parsed = CreateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request.' }, { status: 400 }
    )
  }
  const b = parsed.data

  try {
    const entry = await createManualEntry(supabase, {
      organizationId: userOrgId(user),
      title: b.title,
      startsAt: b.startsAt,
      endsAt: b.endsAt ?? null,
      allDay: b.allDay ?? false,
      kind: b.kind ?? 'manual',
      projectId: b.projectId ?? null,
      clientId: b.clientId ?? null,
      createdBy: user.id,
    })
    // Absent rather than errored is how RLS refuses.
    if (!entry) {
      return NextResponse.json(
        { error: 'That production is not in your scope.' }, { status: 403 }
      )
    }
    return NextResponse.json({ entry })
  } catch (e) {
    captureError(e, { route: 'studio/calendar', op: 'create' })
    return NextResponse.json({ error: 'Could not save that entry.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const g = await gate()
  if ('error' in g) return g.error
  const { supabase } = g

  const parsed = PatchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request.' }, { status: 400 }
    )
  }
  const { id, ...patch } = parsed.data

  try {
    const entry = await updateManualEntry(supabase, id, patch)
    if (!entry) return NextResponse.json({ error: 'No such entry.' }, { status: 404 })
    return NextResponse.json({ entry })
  } catch (e) {
    if (e instanceof Error && e.message === 'DERIVED') {
      return NextResponse.json({ error: DERIVED_MESSAGE }, { status: 409 })
    }
    captureError(e, { route: 'studio/calendar', op: 'update' })
    return NextResponse.json({ error: 'Could not update that entry.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const g = await gate()
  if ('error' in g) return g.error
  const { supabase } = g

  const parsed = DeleteSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'An entry id is required.' }, { status: 400 })
  }

  try {
    const gone = await deleteManualEntry(supabase, parsed.data.id)
    if (!gone) return NextResponse.json({ error: 'No such entry.' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof Error && e.message === 'DERIVED') {
      return NextResponse.json({ error: DERIVED_MESSAGE }, { status: 409 })
    }
    captureError(e, { route: 'studio/calendar', op: 'delete' })
    return NextResponse.json({ error: 'Could not remove that entry.' }, { status: 500 })
  }
}
