import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Video, Dot, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { isAdmin, userOrgId } from '@/lib/auth/role'
import { requireOrgFeature } from '@/lib/studio/guard'
import { listMeetings, MODE_LABEL, STATUS_LABEL } from '@/lib/meetings'
import { livekitConfigured } from '@/lib/livekit'
import NewMeeting from '@/components/studio/NewMeeting'

/**
 * CLIENT · MEETINGS — the same room, addressed to a company.
 *
 * ── THE COMPANY COLUMN IS THE BOUNDARY, EVERYWHERE ───────────────────────
 *
 * `client_id` null is the internal floor (Crew · Meetings); set means a client
 * company is party to it and its people can join from their portal. Batch 24
 * settled this for rooms after the crew hub filtered on the wrong thing and put
 * a conversation with a client's person on the studio's internal floor. Same
 * rule, one table over.
 *
 * A meeting created here is immediately joinable by that company's team at
 * /dashboard/meetings — there is no separate invite step, because
 * `meetings_client_read` already admits them and a second mechanism would be a
 * second thing to get wrong.
 */

function when(m: { scheduled_for: string | null; started_at: string | null; created_at: string }) {
  const at = m.scheduled_for ?? m.started_at ?? m.created_at
  return new Date(at).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export default async function ClientMeetingsPage() {
  await requireOrgFeature('client', 'meetings')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) redirect('/login')

  const orgId = userOrgId(user)
  const [meetings, { data: companies }] = await Promise.all([
    listMeetings(supabase, orgId, 'client'),
    supabase.from('clients').select('id, name, company')
      .is('deleted_at', null).order('name').limit(200),
  ])

  const byId = new Map(
    (companies ?? []).map((c) => [c.id as string, (c.company as string) || (c.name as string)])
  )

  const live = meetings.filter((m) => m.status === 'live')
  const upcoming = meetings.filter((m) => m.status === 'scheduled')
  const past = meetings.filter((m) => m.status === 'ended' || m.status === 'cancelled').slice(0, 20)

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 font-display text-2xl font-semibold text-foreground">
            <Video size={24} className="text-primary" />
            Client meetings
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {live.length > 0
              ? `${live.length} ${live.length === 1 ? 'room is' : 'rooms are'} live right now.`
              : upcoming.length > 0
                ? `${upcoming.length} scheduled with clients.`
                : 'Nothing scheduled. A review session puts the client on the same frame as you.'}
          </p>
        </div>
        {livekitConfigured() && (
          <NewMeeting
            basePath="/studio/client/meetings"
            companies={(companies ?? []).map((c) => ({
              id: c.id as string, name: (c.company as string) || (c.name as string),
            }))}
          />
        )}
      </div>

      {!livekitConfigured() && (
        <p className="squircle mb-6 border border-border bg-card px-4 py-3 text-[13px] text-muted-foreground">
          Video is not configured on this deployment, so no room can be opened yet.
        </p>
      )}

      {[
        { title: 'Live now', rows: live },
        { title: 'Scheduled', rows: upcoming },
        { title: 'Finished', rows: past },
      ].filter((s) => s.rows.length > 0).map((section) => (
        <section key={section.title} className="mb-8">
          <h2 className="mb-3 font-display text-sm font-semibold text-foreground">{section.title}</h2>
          <ul className="space-y-2">
            {section.rows.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/studio/client/meetings/${m.id}`}
                  className="squircle group flex items-center gap-3 border border-border bg-card px-4 py-3 outline-none transition-[border-color] duration-[--dur-pop] hover:border-[hsl(var(--glow)/0.45)] focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 text-[13px] font-medium text-foreground">
                      {m.status === 'live' && (
                        <Dot size={20} className="-ml-1.5 animate-pulse text-[hsl(var(--status-green,var(--primary)))]" />
                      )}
                      {MODE_LABEL[m.mode]}
                      {m.client_id && (
                        <span className="text-muted-foreground"> · {byId.get(m.client_id) ?? 'Client'}</span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[12px] text-muted-foreground">
                      {STATUS_LABEL[m.status]} · {when(m)}
                    </span>
                  </span>
                  <ChevronRight size={15} className="shrink-0 text-faint transition-transform duration-[--dur-pop] group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {meetings.length === 0 && livekitConfigured() && (
        <p className="squircle border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">
          Nothing yet. A meeting you open here appears in that company&apos;s portal
          straight away — they join from their own dashboard, with no invite to chase.
        </p>
      )}
    </div>
  )
}
