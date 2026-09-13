import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { can } from '@/lib/capabilities.server'
import { listForProject } from '@/lib/assignments'
import { PROJECT_ROLE_LABEL, SEAT_CLASS_LABEL } from '@/lib/capabilities'

/**
 * WHO IS ON THIS PRODUCTION, AND AS WHAT — the other direction of item 7's axis.
 *
 * Read-only by design. Staffing is EDITED on the roster, where the person is,
 * because that is where an admin can see the rest of the answer: seat class and
 * scope decide whether an assignment narrows anything at all, and showing the
 * assignment without them invites "I added them and they still see everything."
 *
 * ── IT RENDERS NOTHING WITHOUT people.manage, RATHER THAN AN EMPTY BOX ──────
 * S-R R-6: "A denied surface does not render. Not greyed out, not disabled with a
 * tooltip, not present-but-erroring." And S-3: an empty state must never name what
 * is missing. So a crew member without the capability sees no panel, not a panel
 * saying they may not see it.
 *
 * Reads on the USER client, so 0053's has_cap('people.manage') predicate on
 * organization_member_projects is the control and this is only the message.
 */
export default async function ProjectStaffing({ projectId }: { projectId: string }) {
  const user = await getCurrentUser()
  if (!user) return null
  if (!(await can(user, 'people.roster.read'))) return null

  const supabase = await createClient()
  let staffing
  try {
    staffing = await listForProject(supabase, projectId)
  } catch {
    // A read that fails is not a staffing list of zero. Rendering nothing is
    // honest; rendering "nobody is on this production" would be a claim.
    return null
  }
  if (staffing.length === 0) return null

  // Computed BEFORE the JSX rather than inside it: this is a server component, so
  // "now" is the moment the page was rendered, and calling Date.now() during
  // render is impure (react-hooks/purity). Expiry is a G-5 fact about the row,
  // not a live clock — the page is re-rendered on navigation, which is the same
  // cadence S-R R-7 settles for everything else in this batch.
  const renderedAt = staffing.map((s) => ({
    ...s,
    expired: !!s.expiresAt && Date.parse(s.expiresAt) <= Date.parse(new Date().toISOString()),
  }))
  return (
    <div className="mb-4 rounded-2xl border border-border bg-card p-4">
      <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
        On this production
      </p>
      <div className="flex flex-wrap gap-2">
        {renderedAt.map((s) => {
          const expired = s.expired
          return (
            <div
              key={s.memberId}
              className={`flex items-center gap-2 rounded-xl border border-border px-2.5 py-1.5 ${expired ? 'opacity-50' : ''}`}
            >
              <span className="grid h-6 w-6 place-items-center rounded-full bg-secondary text-[10px] font-bold text-primary">
                {(s.name ?? s.email)[0]?.toUpperCase()}
              </span>
              <span className="text-xs font-medium text-foreground">{s.name ?? s.email}</span>
              <span className="text-[10px] text-muted-foreground">
                {/* 0057's null, named as the fact it is rather than left blank —
                    "on the production, no stated role" is a real state and a blank
                    cell reads as missing data. */}
                {s.projectRole ? PROJECT_ROLE_LABEL[s.projectRole] : 'no stated role'}
              </span>
              {s.seatClass === 'contractor' && (
                <span className="rounded border border-border px-1 text-[9px] uppercase tracking-wide text-faint">
                  {SEAT_CLASS_LABEL.contractor}
                </span>
              )}
              {expired && (
                <span className="text-[9px] uppercase tracking-wide text-faint">expired</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
