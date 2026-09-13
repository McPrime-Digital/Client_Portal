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
 * CREW · MEETINGS — `S3-b` §2, the surface.
 *
 * The point of building this rather than pasting a Zoom link is `review_session`
 * (AD-006): everybody on the same frame, with the scrubber shared. In a hybrid
 * production the meeting that matters is an argument about ONE SHOT, half of
 * which came out of a model — and a screenshare gives the other people neither
 * control nor anything to anchor a comment to.
 *
 * NOT CONFIGURED IS SAID OUT LOUD. Without LiveKit keys the page renders the
 * reason rather than a Join button that fails — the same courtesy every other
 * optional integration in this repo gets.
 */

function when(m: { scheduled_for: string | null; started_at: string | null; created_at: string }) {
  const at = m.scheduled_for ?? m.started_at ?? m.created_at
  return new Date(at).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export default async function MeetingsPage() {
  await requireOrgFeature('crew', 'meetings')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) redirect('/login')

  const meetings = await listMeetings(supabase, userOrgId(user))
  const live = meetings.filter((m) => m.status === 'live')
  const upcoming = meetings.filter((m) => m.status === 'scheduled')
  const past = meetings.filter((m) => m.status === 'ended' || m.status === 'cancelled').slice(0, 20)

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 font-display text-2xl font-semibold text-foreground">
            <Video size={24} className="text-primary" />
            Meetings
          </h1>
          {/* SS-5 — one statement, and "live now" outranks everything else. */}
          <p className="mt-1 text-sm text-muted-foreground">
            {live.length > 0
              ? `${live.length} ${live.length === 1 ? 'room is' : 'rooms are'} live right now.`
              : upcoming.length > 0
                ? `${upcoming.length} scheduled.`
                : 'Nothing running. A review session puts everyone on the same frame.'}
          </p>
        </div>
        {livekitConfigured() && <NewMeeting />}
      </div>

      {!livekitConfigured() && (
        <p className="squircle mb-6 border border-border bg-card px-4 py-3 text-[13px] text-muted-foreground">
          Video is not configured on this deployment. Set{' '}
          <code className="text-foreground">LIVEKIT_API_KEY</code>,{' '}
          <code className="text-foreground">LIVEKIT_API_SECRET</code> and{' '}
          <code className="text-foreground">NEXT_PUBLIC_LIVEKIT_URL</code>, and this page
          becomes a room. Everything else here already works.
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
                  href={`/studio/crew/meetings/${m.id}`}
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
          Nothing yet. A review session opens a room with a shared playhead — play,
          pause and scrub are the same for everybody in it.
        </p>
      )}
    </div>
  )
}
