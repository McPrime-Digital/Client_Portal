import { ShieldCheck, ShieldAlert, ShieldQuestion, Sparkles } from 'lucide-react'
import type { Clearance } from '@/lib/rights'
import { CLEARANCE_LABEL } from '@/lib/rights'

/**
 * WHAT THIS ASSET IS ALLOWED TO BE USED FOR.
 *
 * ONE COMPONENT, BOTH SIDES — the studio's review record and the client's
 * approval page. Deliberately, and it is the same argument `approvalTimeline`
 * makes: two renderings of a clearance is two things that can disagree, and the
 * day they disagree is the day somebody publishes on the wrong one.
 *
 * What differs between the sides is not the panel, it is what sits around it:
 * the studio sees it before delivery, the client sees it before they approve.
 * Neither sees a different answer.
 *
 * ── THREE STATES, AND THE THIRD IS THE POINT ────────────────────────────
 *
 * `unknown` is styled as a WARNING, not as a neutral absence, because that is
 * what it means: nobody has cleared this. A grey dash would read as "nothing to
 * see here" on precisely the asset that has not been looked at.
 */

const ICON = { cleared: ShieldCheck, restricted: ShieldAlert, unknown: ShieldQuestion }
const TONE: Record<Clearance['state'], string> = {
  cleared: 'text-[hsl(var(--glow))]',
  restricted: 'text-destructive',
  // Amber-by-token: unexamined is not fine and not broken.
  unknown: 'text-primary',
}

export default function ClearancePanel(
  { clearance, audience }: { clearance: Clearance; audience: 'studio' | 'client' }
) {
  const Icon = ICON[clearance.state]
  const generated = clearance.marks.length > 0

  return (
    <section className="squircle border border-border bg-card px-4 py-3.5">
      <div className="flex items-start gap-3">
        <Icon size={18} className={`mt-0.5 shrink-0 ${TONE[clearance.state]}`} strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[13px] font-semibold text-foreground">
              {audience === 'client' ? 'Rights and disclosure' : 'Clearance'}
            </span>
            <span className={`text-[12px] font-medium ${TONE[clearance.state]}`}>
              · {CLEARANCE_LABEL[clearance.state]}
            </span>
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
            {clearance.sentence}
          </p>

          {generated && (
            <div className="mt-3 border-t border-border pt-2.5">
              <p className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
                <Sparkles size={12} className="text-primary" />
                Recorded AI generation
              </p>
              <ul className="mt-1.5 space-y-1">
                {clearance.marks.slice(0, 6).map((m, i) => (
                  <li key={`${m.created_at}-${i}`} className="text-[12px] text-muted-foreground">
                    {/* C2PA's own vocabulary, unchanged. Translating it into
                        friendlier words would make the record say something the
                        standard does not. */}
                    <span className="font-mono text-[11px]">{m.action}</span>
                    {m.model && <> · {m.model}</>}
                    {' · '}
                    {new Date(m.created_at).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', year: 'numeric',
                    })}
                  </li>
                ))}
              </ul>
              {clearance.marks.length > 6 && (
                <p className="mt-1 text-[11px] text-faint">
                  and {clearance.marks.length - 6} more
                </p>
              )}
              {audience === 'client' && (
                // The client is the party the disclosure laws act on — they run
                // the advertisement and they take the penalty. Saying it here,
                // once, beside the thing they are about to approve.
                <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                  Where this runs as advertising, it may need a visible
                  AI-disclosure label. New York has required one for
                  AI-generated performers since 9 June 2026, and the EU AI Act
                  has required machine-readable labelling since 2 August 2026.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
