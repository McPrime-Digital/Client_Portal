import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CalendarDays, ChevronRight, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { can } from '@/lib/capabilities.server'
import { clientAgenda, orderAgenda, untilPhrase, type AgendaItem } from '@/lib/portalCalendar'
import { KIND_LABEL } from '@/lib/calendar'

/**
 * WHAT'S COMING — the client's own calendar.
 *
 * `calendar_entries` has had a client SELECT policy since 0065 and its writers
 * since 0074, and in all that time there has been NO client-facing surface: a
 * deadline the studio could see was invisible to the company it binds. That is
 * the gap this closes, and it is the last dormant reader in the portal.
 *
 * ── IT IS NOT A MONTH GRID, AND THAT IS THE DESIGN ──────────────────────
 *
 * Audited and NOT used: `fullcalendar/fullcalendar` (MIT core — but its
 * resource and timeline views are commercially licensed, so the ecosystem has a
 * paywall a future ask walks straight into), `schedule-x/schedule-x` (MIT, zero
 * dependencies, genuinely good) and `vkurko/calendar` (MIT). All three render a
 * grid of events beautifully. This repo already has `monthGrid` and
 * `groupByDay` in `lib/calendar.ts`, used by the crew calendar, so a library
 * would buy a second calendar idiom and a dependency and move nothing.
 *
 * What was taken is schedule-x's AGENDA view as an IDEA: a client checking on a
 * phone wants a list of what is coming, not twelve empty Tuesdays.
 *
 * ── AND IT LEADS WITH WHOSE MOVE IT IS ──────────────────────────────────
 *
 * See `lib/portalCalendar.ts`. The rows that say what happens if you do nothing
 * come first, because a chronological list buries the decision that lapses on
 * Thursday under three shoot days in between.
 */
export default async function PortalCalendarPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await can(user, 'portal.view'))) redirect('/dashboard')

  const items = orderAgenda(await clientAgenda(supabase, user.id))
  // "Yours" INCLUDES a lapsed row that is still your move — an active stage past
  // its deadline is about to be decided by silence, and filing it under
  // "already passed" would hide the one row that can still be changed.
  const yours = items.filter((i) => i.move === 'you')
  const ahead = items.filter((i) => i.move !== 'you' && !i.lapsed)
  const past = items.filter((i) => i.move !== 'you' && i.lapsed).slice(0, 8)

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="flex items-center gap-3 font-display text-2xl font-semibold text-foreground">
        <CalendarDays size={24} className="text-primary" />
        What&rsquo;s coming
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {yours.length > 0
          ? `${yours.length} ${yours.length === 1 ? 'thing is' : 'things are'} waiting on you.`
          : items.length > 0
            ? 'Nothing is waiting on you.'
            : 'Nothing on the calendar yet.'}
      </p>

      {items.length === 0 && (
        <p className="squircle mt-6 border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">
          Review deadlines, invoice dates, shoot days and scheduled calls appear
          here as your production moves.
        </p>
      )}

      {yours.length > 0 && (
        <Section title="Waiting on you">
          {yours.map((i) => <Row key={i.entry.id} item={i} emphasis />)}
        </Section>
      )}

      {ahead.length > 0 && (
        <Section title="Ahead">
          {ahead.map((i) => <Row key={i.entry.id} item={i} />)}
        </Section>
      )}

      {past.length > 0 && (
        <Section title="Already passed">
          {past.map((i) => <Row key={i.entry.id} item={i} />)}
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="text-[12px] font-medium uppercase tracking-wider text-faint">{title}</h2>
      <ul className="mt-2 space-y-2">{children}</ul>
    </section>
  )
}

function Row({ item, emphasis }: { item: AgendaItem; emphasis?: boolean }) {
  const { entry, consequence, lapsed } = item
  const date = new Date(entry.starts_at)

  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className={`truncate text-[13px] ${emphasis ? 'font-semibold text-foreground' : 'font-medium text-foreground'}`}>
            {entry.title}
          </span>
          <span className="text-[11px] text-faint">{KIND_LABEL[entry.kind]}</span>
        </span>
        <span className="mt-0.5 block text-[12px] text-muted-foreground">
          {entry.all_day
            ? date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
            : date.toLocaleString('en-US', {
                weekday: 'long', month: 'long', day: 'numeric',
                hour: 'numeric', minute: '2-digit',
              })}
          {' · '}
          {untilPhrase(entry.starts_at)}
        </span>
        {/* THE SENTENCE. The reason this page exists rather than a date list. */}
        {consequence && (
          <span className={`mt-1.5 flex items-start gap-1.5 text-[12px] leading-relaxed ${
            emphasis ? 'text-foreground' : 'text-muted-foreground'
          }`}>
            {/* An overdue row that is STILL your move is the loudest thing on
                the page, not the quietest — `lapsed` does not soften it. */}
            {emphasis && (
              <AlertCircle size={13} className="mt-px shrink-0 text-primary" />
            )}
            {consequence}
          </span>
        )}
      </span>
      {item.href && (
        <ChevronRight
          size={15}
          className="mt-1 shrink-0 text-faint transition-transform duration-[--dur-pop] group-hover:translate-x-0.5"
        />
      )}
    </>
  )

  const shell = `squircle group flex gap-3 border px-4 py-3 ${
    emphasis
      ? 'border-[hsl(var(--primary)/0.45)] bg-card'
      : 'border-border bg-card'
  } ${lapsed && !emphasis ? 'opacity-70' : ''}`

  return (
    <li>
      {item.href ? (
        <Link
          href={item.href}
          className={`${shell} outline-none transition-[border-color] duration-[--dur-pop] hover:border-[hsl(var(--glow)/0.45)] focus-visible:ring-2 focus-visible:ring-ring`}
        >
          {body}
        </Link>
      ) : (
        <div className={shell}>{body}</div>
      )}
    </li>
  )
}
