import { redirect } from 'next/navigation'
import { CalendarClock, Clock } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { isAdmin, userOrgId } from '@/lib/auth/role'
import { requireOrgFeature } from '@/lib/studio/guard'
import { listBookingTypes, listAvailability, listBookings } from '@/lib/bookings'
import AvailabilityEditor from '@/components/studio/AvailabilityEditor'
import NewBookingType from '@/components/studio/NewBookingType'
import BookSlot from '@/components/studio/BookSlot'
import ActionButton from '@/components/studio/ActionButton'

/**
 * CREW · SCHEDULING — `S3-b` §1.3–1.5, the surface.
 *
 * WHAT THIS IS FOR, because "a booking page" undersells it in a production
 * company: the thing being booked is a casting slot, a client review session, an
 * hour in the grade suite, an ADR booking, a director's time against a shoot
 * date. §1.5 puts the double-booking rule in the DATABASE rather than the
 * application precisely because two people cannot have the same colourist at
 * 3pm, and an application-side check loses that race.
 *
 * ── EVERY OFFERED SLOT IS ONE THE DATABASE WILL ACCEPT ────────────────────
 *
 * Availability, buffers, minimum notice and existing bookings are all applied
 * before a time is shown (`slotsForDay`). Offering a slot that then bounces off
 * the exclusion constraint is worse than offering none — the page looks
 * available, the person picks, and they are refused.
 *
 * The constraint is still the authority, and the race is still real: a slot can
 * be taken between rendering and clicking. That comes back as a sentence, not a
 * 500.
 *
 * ── A BOOKING PRODUCES A CALENDAR ENTRY (0075) ────────────────────────────
 *
 * §1.1 again: "Bookings produce calendar entries. Not everything on the calendar
 * is a booking." Confirming one puts it on Crew · Calendar; cancelling takes it
 * off, because a calendar holding cancelled bookings shows time as busy when it
 * is free.
 */

const DAY = 86_400_000

function when(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export default async function SchedulingPage() {
  await requireOrgFeature('crew', 'scheduling')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) redirect('/login')

  const orgId = userOrgId(user)
  const now = new Date()

  const [types, rules, upcoming] = await Promise.all([
    listBookingTypes(supabase, orgId),
    listAvailability(supabase, user.id),
    listBookings(supabase, orgId, now, new Date(now.getTime() + 60 * DAY)),
  ])

  const confirmed = upcoming.filter((b) => b.status === 'confirmed')

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 font-display text-2xl font-semibold text-foreground">
            <CalendarClock size={24} className="text-primary" />
            Scheduling
          </h1>
          {/* SS-5 — one primary statement, and it is the number a person came
              for: what is actually on the books. */}
          <p className="mt-1 text-sm text-muted-foreground">
            {confirmed.length === 0
              ? 'Nothing is booked in the next sixty days.'
              : `${confirmed.length} booking${confirmed.length === 1 ? '' : 's'} in the next sixty days.`}
          </p>
        </div>
        <NewBookingType />
      </div>

      <section className="mb-8">
        <h2 className="mb-3 font-display text-sm font-semibold text-foreground">What can be booked</h2>
        {types.length === 0 ? (
          <p className="squircle border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
            Nothing yet. A booking type is anything with a duration somebody needs to
            claim — a casting session, an hour in the grade suite, a client review call.
          </p>
        ) : (
          <ul className="space-y-2">
            {types.map((t) => (
              <li key={t.id} className="squircle border border-border bg-card px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="text-[13px] font-medium text-foreground">{t.title}</span>
                  <span className="text-[12px] text-muted-foreground">
                    {t.duration_minutes} min
                    {(t.buffer_before > 0 || t.buffer_after > 0) &&
                      ` · ${t.buffer_before + t.buffer_after} min buffer`}
                    {t.max_per_day != null && ` · max ${t.max_per_day}/day`}
                  </span>
                </div>
                {t.description && (
                  <p className="mt-1 text-[12px] text-muted-foreground">{t.description}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <BookSlot typeId={t.id} title={t.title} />
                  <ActionButton
                    endpoint="/api/studio/scheduling"
                    body={{ action: 'archive-type', id: t.id }}
                    label="Archive"
                    tone="danger"
                    confirm={`Archive “${t.title}”? Bookings already made keep their record.`}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-3 font-display text-sm font-semibold text-foreground">On the books</h2>
        {confirmed.length === 0 ? (
          <p className="squircle border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
            Booked time appears here, and on the calendar at the same moment.
          </p>
        ) : (
          <ul className="space-y-2">
            {confirmed.map((b) => (
              <li key={b.id} className="squircle flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border border-border bg-card px-4 py-3">
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-foreground">
                    {b.booking_types?.title ?? 'Booking'}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1 text-[12px] text-muted-foreground">
                    <Clock size={11} /> {when(b.starts_at)}
                  </span>
                </span>
                <ActionButton
                  endpoint="/api/studio/scheduling"
                  body={{ action: 'cancel', id: b.id }}
                  label="Cancel"
                  tone="danger"
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <AvailabilityEditor rules={rules} />

      {rules.length === 0 && (
        <p className="mt-3 text-[12px] text-muted-foreground">
          Until there is at least one window here, every booking type shows no free
          times — the slots come from your availability, not from the duration.
        </p>
      )}
    </div>
  )
}
