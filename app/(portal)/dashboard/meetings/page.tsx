import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Video, Dot, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { can } from '@/lib/capabilities.server'
import { listClientMeetings, MODE_LABEL, STATUS_LABEL } from '@/lib/meetings'

/**
 * Meetings this company has been asked into.
 *
 * RLS decides what appears: `meetings_client_read` admits a meeting that names
 * your company, on a production you can see. An INTERNAL meeting — `client_id`
 * null — is invisible here by construction, so the studio's own floor stays its
 * own and nobody has to remember to filter it.
 *
 * THERE IS NO INVITE TO ACCEPT. A meeting the studio opens against your company
 * is joinable the moment it exists; a second mechanism would be a second thing
 * to keep in step with the first.
 */
export default async function PortalMeetingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await can(user, 'portal.view'))) redirect('/dashboard')

  const meetings = await listClientMeetings(supabase)
  const live = meetings.filter((m) => m.status === 'live')
  const upcoming = meetings.filter((m) => m.status === 'scheduled')

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="flex items-center gap-3 font-display text-2xl font-semibold text-foreground">
        <Video size={24} className="text-primary" />
        Meetings
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {live.length > 0
          ? `${live.length} ${live.length === 1 ? 'room is' : 'rooms are'} live now — you can join.`
          : upcoming.length > 0
            ? `${upcoming.length} scheduled.`
            : 'Nothing scheduled right now.'}
      </p>

      {meetings.length === 0 ? (
        <p className="squircle mt-6 border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">
          Calls and review sessions appear here when your team is asked into one.
          In a review session you can play, pause and draw on the picture — everyone
          sees the same frame.
        </p>
      ) : (
        <ul className="mt-6 space-y-2">
          {meetings.map((m) => (
            <li key={m.id}>
              <Link
                href={`/dashboard/meetings/${m.id}`}
                className="squircle group flex items-center gap-3 border border-border bg-card px-4 py-3 outline-none transition-[border-color] duration-[--dur-pop] hover:border-[hsl(var(--glow)/0.45)] focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 text-[13px] font-medium text-foreground">
                    {m.status === 'live' && (
                      <Dot size={20} className="-ml-1.5 animate-pulse text-[hsl(var(--status-green,var(--primary)))]" />
                    )}
                    {MODE_LABEL[m.mode]}
                  </span>
                  <span className="mt-0.5 block text-[12px] text-muted-foreground">
                    {STATUS_LABEL[m.status]}
                    {m.scheduled_for && ` · ${new Date(m.scheduled_for).toLocaleString('en-US', {
                      weekday: 'short', month: 'short', day: 'numeric',
                      hour: 'numeric', minute: '2-digit',
                    })}`}
                  </span>
                </span>
                <ChevronRight size={15} className="shrink-0 text-faint transition-transform duration-[--dur-pop] group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
