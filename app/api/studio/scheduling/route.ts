import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdmin, userOrgId } from '@/lib/auth/role'
import { capGate } from '@/lib/capabilities.server'
import { listAvailability, slotsForDay, type BookingType } from '@/lib/bookings'
import { captureError } from '@/lib/errors'

/**
 * Scheduling — availability, booking types, and bookings.
 *
 * ONE route with a discriminated action, following `portal/approvals/actions`.
 * The three concerns share a capability, a tenant resolution and an error shape;
 * splitting them into three files would triplicate all three and give the next
 * person three places to forget a gate.
 *
 * NO SERVICE-ROLE CLIENT. 0066's policies are the authorization throughout:
 * availability is writable by its owner or `people.manage`, a booking type by
 * its owner, and `bookings` by any org member. The route returns the message;
 * the policy is the control.
 *
 * ── THE DOUBLE-BOOKING REFUSAL IS NOT AN ERROR, IT IS AN ANSWER ───────────
 *
 * 0066's exclusion constraint raises `23P01` when two bookings overlap on one
 * person. That is the constraint doing its job under a race, and it reaches the
 * caller as a sentence about the slot being taken rather than a 500 — because
 * the person who lost the race needs to pick another time, not file a bug.
 */

const CreateType = z.object({
  action: z.literal('create-type'),
  title: z.string().trim().min(1).max(200),
  slug: z.string().trim().regex(/^[a-z0-9-]{1,60}$/, 'Use lowercase letters, numbers and dashes.'),
  durationMinutes: z.number().int().min(5).max(1440),
  bufferBefore: z.number().int().min(0).max(240).optional(),
  bufferAfter: z.number().int().min(0).max(240).optional(),
  minNoticeMinutes: z.number().int().min(0).max(20160).optional(),
  maxPerDay: z.number().int().min(1).max(50).nullish(),
  description: z.string().trim().max(1000).nullish(),
  clientId: z.uuid().nullish(),
})

const ArchiveType = z.object({ action: z.literal('archive-type'), id: z.uuid() })

const SetAvailability = z.object({
  action: z.literal('set-availability'),
  timezone: z.string().trim().min(1).max(80),
  rules: z.array(z.object({
    weekday: z.number().int().min(0).max(6),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
  })).max(40),
})

const Book = z.object({
  action: z.literal('book'),
  bookingTypeId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }),
  clientId: z.uuid().nullish(),
})

const Cancel = z.object({ action: z.literal('cancel'), id: z.uuid() })

const Body = z.discriminatedUnion('action', [
  CreateType, ArchiveType, SetAvailability, Book, Cancel,
])

async function gate(cap: 'work.booking.read' | 'work.booking.write') {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const denied = await capGate(user, cap)
  if (denied) return { error: NextResponse.json(denied, { status: 403 }) }
  return { supabase, user }
}

export async function POST(req: NextRequest) {
  const g = await gate('work.booking.write')
  if ('error' in g) return g.error
  const { supabase, user } = g
  const orgId = userOrgId(user)

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request.' }, { status: 400 }
    )
  }
  const b = parsed.data

  try {
    if (b.action === 'create-type') {
      const { data, error } = await supabase.from('booking_types').insert({
        organization_id: orgId,
        owner_user_id: user.id,
        client_id: b.clientId ?? null,
        slug: b.slug,
        title: b.title,
        description: b.description ?? null,
        duration_minutes: b.durationMinutes,
        buffer_before: b.bufferBefore ?? 0,
        buffer_after: b.bufferAfter ?? 0,
        min_notice_minutes: b.minNoticeMinutes ?? 0,
        max_per_day: b.maxPerDay ?? null,
      }).select('id').maybeSingle()

      if (error?.code === '23505') {
        return NextResponse.json(
          { error: 'You already have a booking type with that link.' }, { status: 409 }
        )
      }
      if (error) throw new Error(error.message)
      if (!data) return NextResponse.json({ error: 'Not permitted.' }, { status: 403 })
      return NextResponse.json({ id: (data as { id: string }).id })
    }

    if (b.action === 'archive-type') {
      // SOFT, so the slug is released (0066's live-only unique index) while any
      // bookings already made against it keep their parent.
      const { data } = await supabase.from('booking_types')
        .update({ deleted_at: new Date().toISOString(), active: false })
        .eq('id', b.id).select('id')
      if ((data ?? []).length === 0) {
        return NextResponse.json({ error: 'Not yours to archive.' }, { status: 403 })
      }
      return NextResponse.json({ ok: true })
    }

    if (b.action === 'set-availability') {
      // REPLACE, not merge: an availability editor shows the whole week, so the
      // absence of a row is a statement ("not available then") and a merge would
      // make it impossible to remove a window.
      const { error: delErr } = await supabase
        .from('availability_rules').delete().eq('user_id', user.id)
      if (delErr) throw new Error(delErr.message)

      if (b.rules.length > 0) {
        const { error } = await supabase.from('availability_rules').insert(
          b.rules.map((r) => ({
            organization_id: orgId,
            user_id: user.id,
            weekday: r.weekday,
            start_time: r.startTime,
            end_time: r.endTime,
            timezone: b.timezone,
          }))
        )
        if (error?.code === '23514') {
          return NextResponse.json(
            { error: 'A window has to end after it starts.' }, { status: 400 }
          )
        }
        if (error) throw new Error(error.message)
      }
      return NextResponse.json({ ok: true })
    }

    if (b.action === 'book') {
      const { data: type } = await supabase.from('booking_types')
        .select('id, duration_minutes').eq('id', b.bookingTypeId).maybeSingle()
      if (!type) return NextResponse.json({ error: 'No such booking type.' }, { status: 404 })

      const starts = new Date(b.startsAt)
      const ends = new Date(
        starts.getTime() + (type as { duration_minutes: number }).duration_minutes * 60_000
      )

      const { data, error } = await supabase.from('bookings').insert({
        organization_id: orgId,
        booking_type_id: b.bookingTypeId,
        booked_by_user_id: user.id,
        client_id: b.clientId ?? null,
        starts_at: starts.toISOString(),
        ends_at: ends.toISOString(),
      }).select('id').maybeSingle()

      // 23P01 is 0066's exclusion constraint, and it is the answer rather than
      // a fault: somebody else took the slot in between.
      if (error?.code === '23P01') {
        return NextResponse.json(
          { error: 'That time was taken while you were choosing. Pick another slot.' },
          { status: 409 }
        )
      }
      if (error) throw new Error(error.message)
      if (!data) return NextResponse.json({ error: 'Not permitted.' }, { status: 403 })
      return NextResponse.json({ id: (data as { id: string }).id })
    }

    // cancel
    const { data } = await supabase.from('bookings')
      .update({ status: 'cancelled' }).eq('id', b.id).select('id')
    if ((data ?? []).length === 0) {
      return NextResponse.json({ error: 'No such booking.' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    captureError(e, { route: 'studio/scheduling', action: b.action })
    return NextResponse.json({ error: 'Could not complete that.' }, { status: 500 })
  }
}

/** Offerable start times for one booking type on one day. */
export async function GET(req: NextRequest) {
  const g = await gate('work.booking.read')
  if ('error' in g) return g.error
  const { supabase } = g

  const typeId = req.nextUrl.searchParams.get('type')
  const date = req.nextUrl.searchParams.get('date')
  if (!typeId || !z.uuid().safeParse(typeId).success) {
    return NextResponse.json({ error: 'A booking type is required.' }, { status: 400 })
  }
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '')
  if (!ymd) return NextResponse.json({ error: 'A date is required.' }, { status: 400 })

  try {
    const { data: typeRow } = await supabase.from('booking_types')
      .select('id, owner_user_id, duration_minutes, buffer_before, buffer_after, min_notice_minutes, max_per_day')
      .eq('id', typeId).is('deleted_at', null).maybeSingle()
    if (!typeRow) return NextResponse.json({ error: 'No such booking type.' }, { status: 404 })
    const type = typeRow as unknown as BookingType

    // A room-level type has no owner, so it has no availability to read and no
    // person to double-book. Stated rather than crashing on a null.
    if (!type.owner_user_id) return NextResponse.json({ slots: [], reason: 'no-owner' })

    const rules = await listAvailability(supabase, type.owner_user_id)

    // The owner's whole day, so a collision is caught whatever booking type
    // produced it — a colourist booked through "Grade suite" is just as busy to
    // "Client review".
    const dayStart = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]))
    const dayEnd = new Date(dayStart.getTime() + 86_400_000 * 2)
    const { data: existing } = await supabase.from('bookings')
      .select('starts_at, ends_at, status')
      .eq('owner_user_id', type.owner_user_id)
      .is('deleted_at', null)
      .gte('starts_at', new Date(dayStart.getTime() - 86_400_000).toISOString())
      .lt('starts_at', dayEnd.toISOString())
      .limit(200)

    const slots = slotsForDay({
      day: { y: Number(ymd[1]), m: Number(ymd[2]), d: Number(ymd[3]) },
      rules,
      type,
      existing: (existing ?? []) as { starts_at: string; ends_at: string; status: 'confirmed' | 'cancelled' | 'rescheduled' }[],
    })
    return NextResponse.json({ slots: slots.map((s) => s.toISOString()) })
  } catch (e) {
    captureError(e, { route: 'studio/scheduling', op: 'slots' })
    return NextResponse.json({ error: 'Could not work out the free slots.' }, { status: 500 })
  }
}
