import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { isAdmin, userOrgId } from '@/lib/auth/role'
import { requireOrgFeature } from '@/lib/studio/guard'
import {
  listEntries, monthGrid, groupByDay, dayKey, parseMonth, monthParam,
  KIND_LABEL, KIND_TONE, type CalendarEntry, type CalendarKind,
} from '@/lib/calendar'
import NewCalendarEntry from '@/components/studio/NewCalendarEntry'
import DeleteCalendarEntry from '@/components/studio/DeleteCalendarEntry'

/**
 * CREW · CALENDAR — `S3-b` §1, the surface.
 *
 * §1.1's premise is the whole design: a meeting, an approval deadline and an
 * invoice due date are THE SAME KIND OF THING to a person looking at a week.
 * There is one grid, and what an entry IS shows as a colour rather than as a
 * separate calendar.
 *
 * ── DERIVED ENTRIES ARE NOT EDITABLE, AND THE PAGE SAYS SO ────────────────
 *
 * An approval deadline and an invoice due date are projections (0074). They
 * carry no delete control here — not because it is hidden, but because it does
 * not exist: the database refuses it, and offering a control that fails is worse
 * than not offering it. Only manual entries carry one.
 *
 * ── NO REALTIME CHANNEL ───────────────────────────────────────────────────
 *
 * SS-3, and I-2 is already violated at ~6 subscriptions per session. A calendar
 * is not a live-collaboration surface: it re-renders on navigation and after a
 * write, and a seventh channel to save a `router.refresh()` would be a bad
 * trade. This is deliberate rather than unfinished.
 *
 * ── THE READ FILTERS deleted_at ITSELF ────────────────────────────────────
 *
 * 0073's standing obligation — crew policies deliberately do not carry the
 * predicate, so every crew read must. It happens once, in `listEntries`.
 */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY = 86_400_000

function monthLabel(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function timeLabel(e: CalendarEntry) {
  if (e.all_day) return null
  return new Date(e.starts_at).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  })
}

/**
 * SS-5 — ONE primary statement, and it is about the next seven days rather than
 * the month on screen. A person paging back to March does not want to be told
 * what was due in March; the question a calendar answers first is always "what
 * is coming".
 */
function comingUp(entries: CalendarEntry[], now: Date): string {
  const soon = entries.filter((e) => {
    const t = Date.parse(e.starts_at)
    return t >= now.getTime() && t < now.getTime() + 7 * DAY
  })
  if (soon.length === 0) return 'Nothing falls in the next seven days.'

  const byKind = new Map<CalendarKind, number>()
  for (const e of soon) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1)

  const parts = [...byKind.entries()].map(([kind, n]) => {
    const label = KIND_LABEL[kind].toLowerCase()
    return `${n} ${label}${n === 1 ? '' : 's'}`
  })
  const list =
    parts.length === 1 ? parts[0]
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return `${list} in the next seven days.`
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>
}) {
  await requireOrgFeature('crew', 'calendar')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) redirect('/login')

  const { m } = await searchParams
  const month = parseMonth(m)
  const grid = monthGrid(month)
  const orgId = userOrgId(user)

  const entries = await listEntries(supabase, { orgId, from: grid.from, to: grid.to })
  const byDay = groupByDay(entries)

  // A window wide enough to answer "what is coming" even when the reader has
  // paged to a different month.
  const now = new Date()
  const horizon = await listEntries(supabase, {
    orgId, from: now, to: new Date(now.getTime() + 7 * DAY),
  })

  const prev = new Date(month.getFullYear(), month.getMonth() - 1, 1)
  const next = new Date(month.getFullYear(), month.getMonth() + 1, 1)
  const todayKey = dayKey(now)
  const thisMonth = month.getMonth()

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 font-display text-2xl font-semibold text-foreground">
            <CalendarDays size={24} className="text-primary" />
            Calendar
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {comingUp(horizon, now)}
          </p>
        </div>
        <NewCalendarEntry defaultDate={dayKey(month.getMonth() === now.getMonth() ? now : month)} />
      </div>

      <div className="mb-3 flex items-center gap-1">
        <Link
          href={`/studio/crew/calendar?m=${monthParam(prev)}`}
          aria-label="Previous month"
          className="squircle-sm grid h-8 w-8 place-items-center border border-border text-muted-foreground outline-none transition-[border-color,transform] duration-[--dur-pop] ease-[--ease-out] hover:border-[hsl(var(--glow)/0.45)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
        >
          <ChevronLeft size={15} />
        </Link>
        <Link
          href={`/studio/crew/calendar?m=${monthParam(next)}`}
          aria-label="Next month"
          className="squircle-sm grid h-8 w-8 place-items-center border border-border text-muted-foreground outline-none transition-[border-color,transform] duration-[--dur-pop] ease-[--ease-out] hover:border-[hsl(var(--glow)/0.45)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
        >
          <ChevronRight size={15} />
        </Link>
        <h2 className="ml-2 font-display text-[15px] font-semibold text-foreground">
          {monthLabel(month)}
        </h2>
        {monthParam(month) !== monthParam(now) && (
          <Link
            href="/studio/crew/calendar"
            className="ml-2 text-[12px] text-faint outline-none transition-colors duration-[--dur-pop] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            Today
          </Link>
        )}
      </div>

      {/* The grid scrolls sideways rather than crushing seven columns on a
          phone — a week is only legible at a certain width. */}
      <div className="overflow-x-auto">
        <div className="min-w-[46rem]">
          <div className="grid grid-cols-7 gap-px">
            {WEEKDAYS.map((d) => (
              <div key={d} className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">
                {d}
              </div>
            ))}
          </div>

          <div className="squircle grid grid-cols-7 gap-px overflow-hidden border border-border bg-border">
            {grid.days.map((d) => {
              const key = dayKey(d)
              const dayEntries = byDay.get(key) ?? []
              const outside = d.getMonth() !== thisMonth
              const isToday = key === todayKey
              return (
                <div
                  key={key}
                  className={`min-h-[6.5rem] bg-card p-1.5 ${outside ? 'opacity-45' : ''}`}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span
                      className={
                        isToday
                          ? 'grid h-5 w-5 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground'
                          : 'px-1 text-[11px] text-muted-foreground'
                      }
                    >
                      {d.getDate()}
                    </span>
                  </div>

                  <ul className="space-y-0.5">
                    {dayEntries.map((e) => (
                      <li key={e.id} className="group/entry flex items-start gap-1.5 rounded px-1 py-0.5 hover:bg-secondary/50">
                        <span
                          aria-hidden
                          className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: `hsl(${KIND_TONE[e.kind]})` }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11px] leading-tight text-foreground" title={e.title}>
                            {e.title}
                          </span>
                          <span className="block text-[10px] text-faint">
                            {timeLabel(e) ?? KIND_LABEL[e.kind]}
                          </span>
                        </span>
                        {/* Only a manual entry gets a control, because only a
                            manual entry can be removed (0074's guard). */}
                        {e.source_id === null && <DeleteCalendarEntry id={e.id} title={e.title} />}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {entries.length === 0 && (
        // SS-6 — an empty state is onboarding, and names no capability and no
        // production.
        <p className="mt-4 text-[13px] text-muted-foreground">
          Nothing is scheduled this month. Review dates and invoice due dates appear
          here on their own as they are set; anything else you add yourself.
        </p>
      )}
    </div>
  )
}
