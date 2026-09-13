import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * SCHEDULING — availability, booking types, and the slot arithmetic.
 *
 * `S3-b` §1.4 calls this "the Cal.com model reduced to what v1 needs", which is
 * accurate about the SHAPE and says nothing about what it is for here. In a
 * production company the thing being booked is rarely a sales call: it is a
 * casting slot, a client review session, an hour in the grade suite, an ADR
 * booking, or a director's time against a shoot date. That is why §1.5 puts the
 * double-booking constraint in the DATABASE rather than the application — two
 * people cannot have the same colourist at 3pm, and an application-side check
 * loses that race.
 *
 * ── THE SLOT MATH IS PURE, AND TIMEZONES ARE WHY ──────────────────────────
 *
 * `availability_rules.timezone` is stored PER RULE (§1.3) because a person who
 * moves does not retroactively change what their availability meant last month.
 * So a rule says "09:00–17:00 on Tuesdays in Europe/London", and turning that
 * into instants means resolving a WALL TIME in a named zone — which changes
 * twice a year and cannot be done with a fixed offset.
 *
 * `zonedTime()` below does it with the standard two-pass Intl technique, and it
 * is the reason this file is testable at all: every function that decides when
 * something can happen takes its inputs and returns a value, with no I/O.
 */

export type AvailabilityRule = {
  id: string
  user_id: string
  weekday: number
  start_time: string
  end_time: string
  timezone: string
}

export type BookingType = {
  id: string
  organization_id: string
  owner_user_id: string | null
  client_id: string | null
  slug: string
  title: string
  description: string | null
  duration_minutes: number
  buffer_before: number
  buffer_after: number
  min_notice_minutes: number
  max_per_day: number | null
  active: boolean
}

export type Booking = {
  id: string
  booking_type_id: string
  owner_user_id: string | null
  client_id: string | null
  starts_at: string
  ends_at: string
  status: 'confirmed' | 'cancelled' | 'rescheduled'
}

const MINUTE = 60_000

// ── timezone arithmetic ─────────────────────────────────────────────────────

/** How far `date`'s wall clock in `tz` is ahead of UTC, in ms, at that instant. */
function offsetMs(tz: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const p: Record<string, number> = {}
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value)
  }
  // `hour` comes back as 24 at midnight under hour12:false in some runtimes.
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second)
  return asUTC - date.getTime()
}

/**
 * The instant at which the wall clock in `tz` reads the given local time.
 *
 * TWO PASSES, and the second is not redundant: the offset depends on the
 * instant, and the instant is what we are solving for. One pass is wrong for
 * every local time on a DST changeover day, which is the day somebody will
 * inevitably be booked.
 */
export function zonedTime(
  y: number, m: number, d: number, hh: number, mm: number, tz: string
): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm)
  const first = guess - offsetMs(tz, new Date(guess))
  const second = guess - offsetMs(tz, new Date(first))
  return new Date(second)
}

/** The weekday (0=Sun … 6=Sat) that `at` falls on, read in `tz` rather than
 *  locally — a 23:00 UTC instant is already tomorrow in Sydney. */
export function weekdayIn(at: Date, tz: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' })
    .format(at)
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name)
}

function parseHm(t: string): { hh: number; mm: number } {
  const [hh, mm] = t.split(':').map(Number)
  return { hh: hh ?? 0, mm: mm ?? 0 }
}

// ── slots ───────────────────────────────────────────────────────────────────

export type SlotParams = {
  /** Calendar day to generate for, as local Y/M/D in the RULE's timezone. */
  day: { y: number; m: number; d: number }
  rules: AvailabilityRule[]
  type: Pick<BookingType,
    'duration_minutes' | 'buffer_before' | 'buffer_after' | 'min_notice_minutes' | 'max_per_day'>
  /** Confirmed bookings that already occupy the owner's time. */
  existing: Pick<Booking, 'starts_at' | 'ends_at' | 'status'>[]
  now?: Date
}

/**
 * Every start time that is genuinely offerable on one day.
 *
 * A slot survives four filters, and each one exists because offering a slot that
 * cannot be taken is worse than offering none: the booking page looks available,
 * the person picks, and the database refuses them.
 *
 *   1. it fits inside an availability window, END included
 *   2. it is not inside the minimum notice
 *   3. it does not collide with a confirmed booking, BUFFERS included
 *   4. the day has not already hit `max_per_day`
 *
 * BUFFERS WIDEN THE COLLISION, NOT THE SLOT. A 30-minute booking with a 15-minute
 * buffer still occupies 30 minutes on the calendar; what the buffer does is make
 * the neighbouring slot unofferable. Widening the slot instead would shorten the
 * meeting, which is the wrong end of the mistake.
 */
export function slotsForDay(p: SlotParams): Date[] {
  const now = p.now ?? new Date()
  const notBefore = new Date(now.getTime() + p.type.min_notice_minutes * MINUTE)

  const taken = p.existing
    .filter((b) => b.status === 'confirmed')
    .map((b) => ({ s: Date.parse(b.starts_at), e: Date.parse(b.ends_at) }))

  if (p.type.max_per_day != null && taken.length >= p.type.max_per_day) return []

  const out: Date[] = []
  const seen = new Set<number>()

  for (const rule of p.rules) {
    // The rule's own timezone decides which weekday this day IS for the rule.
    const probe = zonedTime(p.day.y, p.day.m, p.day.d, 12, 0, rule.timezone)
    if (weekdayIn(probe, rule.timezone) !== rule.weekday) continue

    const from = parseHm(rule.start_time)
    const to = parseHm(rule.end_time)
    const windowStart = zonedTime(p.day.y, p.day.m, p.day.d, from.hh, from.mm, rule.timezone)
    const windowEnd = zonedTime(p.day.y, p.day.m, p.day.d, to.hh, to.mm, rule.timezone)

    const step = p.type.duration_minutes * MINUTE
    if (step <= 0) continue

    for (let t = windowStart.getTime(); t + step <= windowEnd.getTime(); t += step) {
      if (t < notBefore.getTime()) continue

      const blockStart = t - p.type.buffer_before * MINUTE
      const blockEnd = t + step + p.type.buffer_after * MINUTE
      const collides = taken.some((b) => blockStart < b.e && b.s < blockEnd)
      if (collides) continue

      if (!seen.has(t)) {
        seen.add(t)
        out.push(new Date(t))
      }
    }
  }

  out.sort((a, b) => a.getTime() - b.getTime())
  if (p.type.max_per_day != null) {
    const room = p.type.max_per_day - taken.length
    return out.slice(0, Math.max(0, room))
  }
  return out
}

// ── reads ───────────────────────────────────────────────────────────────────

const TYPE_COLUMNS =
  'id, organization_id, owner_user_id, client_id, slug, title, description, duration_minutes, buffer_before, buffer_after, min_notice_minutes, max_per_day, active'

export async function listBookingTypes(
  db: SupabaseClient, orgId: string
): Promise<BookingType[]> {
  const { data, error } = await db
    .from('booking_types')
    .select(TYPE_COLUMNS)
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .order('title')
    .limit(200)
  if (error) throw new Error(`listBookingTypes: ${error.message}`)
  return (data ?? []) as unknown as BookingType[]
}

export async function listAvailability(
  db: SupabaseClient, userId: string
): Promise<AvailabilityRule[]> {
  const { data, error } = await db
    .from('availability_rules')
    .select('id, user_id, weekday, start_time, end_time, timezone')
    .eq('user_id', userId)
    .order('weekday')
    .order('start_time')
    .limit(200)
  if (error) throw new Error(`listAvailability: ${error.message}`)
  return (data ?? []) as unknown as AvailabilityRule[]
}

export async function listBookings(
  db: SupabaseClient, orgId: string, from: Date, to: Date
): Promise<(Booking & { booking_types: { title: string } | null })[]> {
  const { data, error } = await db
    .from('bookings')
    .select('id, booking_type_id, owner_user_id, client_id, starts_at, ends_at, status, booking_types(title)')
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .gte('starts_at', from.toISOString())
    .lt('starts_at', to.toISOString())
    .order('starts_at')
    .limit(500)
  if (error) throw new Error(`listBookings: ${error.message}`)
  return (data ?? []) as unknown as (Booking & { booking_types: { title: string } | null })[]
}

export const WEEKDAY_LABEL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** The studio's own zone, for seeding a new availability rule. Resolved at the
 *  boundary rather than stored as a constant, because a studio that moves is a
 *  studio whose NEW rules should move with it — the old ones keep their own. */
export function defaultTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}
