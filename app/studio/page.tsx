import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { userOrgId } from '@/lib/auth/role'
import { resolveCaps } from '@/lib/capabilities.server'
import { heldSurfaces } from '@/lib/studio/surfaces'
import { getSpace } from '@/lib/studio/spaces'
import { orgAccessOf } from '@/lib/team'
import { createClient } from '@/lib/supabase/server'
import { orgUnread } from '@/lib/messageRead'
import StudioHomeAttention from '@/components/studio/StudioHomeAttention'

/**
 * THE STUDIO HOME — S-R §8 S-1, built.
 *
 * "A dashboard is a projection of a capability set, not a design. There is no
 * per-role layout file. The surfaces a person holds are computed, and the
 * dashboard renders their union."
 *
 * This route was `redirect('/studio/crew')`, which meant the studio had no home:
 * everybody landed on the Crew space's animated stage regardless of what they
 * held. A finance member with no craft floor and a crew member with no money saw
 * the identical page. The rail filtered correctly; the landing was not a surface.
 *
 * NOTHING BELOW NAMES A ROLE. `heldSurfaces()` asks the one resolver and returns
 * what this person holds; this file groups it and draws it. Grant somebody
 * money.costs and the Control Tower appears on their home with no layout change —
 * which is S-1's actual test, and the reason this is worth building rather than
 * hand-writing six dashboards that drift apart.
 *
 * ── THE DESIGN DECISION, STATED ────────────────────────────────────────────
 *
 * A studio home could be a KPI row and a grid of identical cards. It is not,
 * because that is the default treatment rather than a choice, and it answers the
 * wrong question. The person opening this asks "is anything waiting on me, and
 * where do I go" — so the page is two things in that order: a CALL SHEET written
 * as a sentence, then the surfaces they hold, grouped by space.
 *
 * Built surfaces lead. Unbuilt ones are held back behind one line rather than
 * hidden (hiding a held surface tells somebody they lack a capability they have)
 * and rather than mixed in (an owner holds 32 surfaces of which 18 are unbuilt,
 * and a home that is half grey reads as a construction site).
 *
 * ── MOTION ─────────────────────────────────────────────────────────────────
 *
 * There is none on load. A page a person opens many times a day earns no
 * entrance animation; a fade-and-slide-up on each section is the generic default
 * and reads as lag on the second viewing. Hover and press feedback only, on the
 * shared tokens.
 */
export default async function StudioHome() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const resolved = await resolveCaps(user)
  // A crew CLAIM with no active roster row is not a member of anything. The
  // layout renders the "No studio access" card for that case, so arriving here
  // means it let them through and a redirect back would loop.
  if (resolved.side !== 'crew') redirect('/dashboard')

  const orgId = userOrgId(user)
  // EVERY READ BELOW IS ON THE USER CLIENT. The first draft reached for
  // supabaseAdmin and the I-8 ratchet refused it — correctly: this is the
  // hottest page in the studio, it has a session, and every table it touches is
  // covered by RLS (messages and room_members through orgUnread's injected
  // client, tasks and invoices by their own crew policies, the roster row by the
  // ungated self-read). A service-role read here would also have made the
  // capability checks below decorative, since the rows would arrive regardless.
  const supabase = await createClient()
  const seesWork = resolved.caps.has('work.projects')
  const seesMoney = resolved.caps.has('money.invoices')
  const today = new Date().toISOString().slice(0, 10)

  // Each count is OMITTED rather than zeroed when the capability is absent: a
  // count is a disclosure even without the rows behind it.
  const [held, access, me, unread, changes, overdue] = await Promise.all([
    heldSurfaces(user),
    orgAccessOf(user),
    supabase.from('organization_members').select('name').eq('user_id', user.id).maybeSingle(),
    seesWork ? orgUnread(supabase, { userId: user.id, orgId }) : Promise.resolve({ total: 0 }),
    seesWork
      ? supabase.from('tasks').select('*', { count: 'exact', head: true })
          .eq('approval_status', 'changes_requested')
      : Promise.resolve({ count: null }),
    seesMoney
      ? supabase.from('invoices').select('*', { count: 'exact', head: true })
          .or(`status.eq.overdue,and(status.eq.unpaid,due_date.lt.${today})`)
      : Promise.resolve({ count: null }),
  ])

  // Written to read as a sentence: "3 unread messages and 1 gate waiting".
  const callSheet = [
    seesWork && { key: 'messages', label: unread.total === 1 ? 'unread message' : 'unread messages', n: unread.total, href: '/studio/client/messages' },
    seesWork && { key: 'review', label: changes.count === 1 ? 'gate waiting on you' : 'gates waiting on you', n: changes.count ?? 0, href: '/studio/client/review' },
    seesMoney && { key: 'invoices', label: overdue.count === 1 ? 'overdue invoice' : 'overdue invoices', n: overdue.count ?? 0, href: '/studio/client/invoices' },
  ].filter(Boolean) as { key: string; label: string; n: number; href: string }[]

  const spaces = ['crew', 'client', 'suite']
    .map((id) => ({
      space: getSpace(id)!,
      built: held.filter((h) => h.space === id && h.built),
      soon: held.filter((h) => h.space === id && !h.built),
    }))
    .filter((g) => g.built.length + g.soon.length > 0)

  const firstName = (me.data?.name ?? user.email?.split('@')[0] ?? 'there').split(' ')[0]
  const roleLabel = access.title ?? (resolved.roles[0]
    ? resolved.roles[0][0].toUpperCase() + resolved.roles[0].slice(1)
    : 'Crew')
  const soonTotal = spaces.reduce((n, g) => n + g.soon.length, 0)

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-7">
        <h1 className="font-display text-[28px] font-semibold leading-tight tracking-[-0.01em] text-foreground">
          {firstName}
        </h1>
        <p className="mt-0.5 text-[13px] text-faint">{roleLabel}</p>
      </header>

      <StudioHomeAttention items={callSheet} orgId={orgId} />

      {spaces.map(({ space, built, soon }) => (
        <section key={space.id} className="mb-8">
          <h2 className="mb-3 font-display text-[13px] font-semibold text-muted-foreground">
            {space.label}
          </h2>

          <div className="grid gap-2 sm:grid-cols-2">
            {built.map((f) => {
              const Icon = space.features.find((x) => x.slug === f.slug)!.icon
              return (
                <Link
                  key={f.slug}
                  href={`/studio/${space.id}/${f.slug}`}
                  className="group squircle flex items-center gap-3 border border-border bg-card px-3.5 py-3 outline-none transition-[border-color,transform] duration-[--dur-pop] ease-[--ease-out] hover:border-[hsl(var(--glow)/0.45)] focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
                >
                  <Icon size={16} className="flex-shrink-0 text-faint transition-colors duration-[--dur-pop] group-hover:text-[hsl(var(--glow))]" />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{f.label}</span>
                  {f.badge === 'COST' && (
                    <span className="flex-shrink-0 text-[10px] text-faint">cost</span>
                  )}
                </Link>
              )
            })}
          </div>

          {soon.length > 0 && (
            // Held but unbuilt. Not hidden — hiding a surface somebody holds
            // tells them they lack a capability they have. Not mixed in either:
            // it is not somewhere they can go yet.
            <p className="mt-2.5 text-[12px] text-faint">
              {soon.map((f) => f.label).join(', ')} — coming soon
            </p>
          )}
        </section>
      ))}

      {spaces.length === 0 && (
        // The hardest S-3 case: an active member whose capabilities show them
        // nothing. It says what is true and names the one thing that helps. It
        // never names a production or a capability they lack.
        <div className="squircle-lg border border-border bg-card p-8">
          <p className="font-display text-base font-semibold text-foreground">Nothing here yet</p>
          <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
            Your access hasn&apos;t been set up with any tools. An owner or admin can
            change that from the team settings.
          </p>
        </div>
      )}

      {soonTotal > 0 && (
        <p className="mt-10 text-[11.5px] text-faint">
          {soonTotal} more {soonTotal === 1 ? 'surface is' : 'surfaces are'} on the way.
        </p>
      )}
    </div>
  )
}
