/**
 * Does the approval record say the true thing about what the approver saw?
 *
 * `watchEvidence` is pure, so this runs it directly against the states that
 * matter — including the two that must produce NOTHING. A grader that reads
 * "no viewing recorded" as "approved without watching" would be confidently
 * defaming the careful client (the portal's own player records nothing) while
 * saying nothing at all about the careless one.
 *
 *   npx tsx scripts/ops/probe-watch-evidence.ts
 */
import { watchEvidence, approvalIntel, type IntelView } from '../../lib/approvalIntel'

const at = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()
let bad = 0
const check = (label: string, ok: boolean, got: string) => {
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(52)} ${got}`)
  if (!ok) bad++
}

// ── the two that must say NOTHING ────────────────────────────────────────────
check('nobody asked (undefined) → no finding', watchEvidence(undefined) === null, 'null')
check('asked, nothing recorded ([]) → no finding', watchEvidence([]) === null, 'null')

// ── positive evidence ────────────────────────────────────────────────────────
const four: IntelView[] = [{ at: at(1), who: 'a@b.com', furthestMs: 4_000, durationMs: 720_000 }]
const e1 = watchEvidence(four)!
check('four seconds of a twelve-minute cut → token', e1.token === true, e1.sentence)

const most: IntelView[] = [{ at: at(1), who: 'a@b.com', furthestMs: 690_000, durationMs: 720_000 }]
const e2 = watchEvidence(most)!
check('96% → not token', e2.token === false, e2.sentence)

// The HIGH-WATER MARK across viewings: a first glance then a full watch is a
// full watch, and taking the last or the mean would say the opposite.
const twice: IntelView[] = [
  { at: at(3), who: 'a@b.com', furthestMs: 3_000, durationMs: 720_000 },
  { at: at(1), who: 'a@b.com', furthestMs: 715_000, durationMs: 720_000 },
]
const e3 = watchEvidence(twice)!
check('a glance then a full watch → not token', e3.token === false, e3.sentence)

// Unknown duration must NOT become 0%.
const nodur: IntelView[] = [{ at: at(1), who: null, furthestMs: 9_000, durationMs: null }]
const e4 = watchEvidence(nodur)!
check('duration unknown → share null, never token', e4.share === null && !e4.token, e4.sentence)

// ── and what it does to the grade ────────────────────────────────────────────
const base = {
  approval: { status: 'open', client_id: 'c', review_window_hours: 72, created_at: at(9) },
  stages: [{
    id: 's1', seq: 1, name: 'Client sign-off', mode: 'any', status: 'active',
    deadline_at: at(-2), advanced_at: null,
    assignees: [{ client_id: 'c', user_id: 'u', role: null }],
    decisions: [],
  }],
  // The real event shape, read off `remindersFor`: `approval_reminded`, with
  // `recipient` (not `to`) as the distinct-person key. The first version of this
  // fixture invented both names and every grade came back `broken` — a probe
  // whose SETUP is wrong reports the code as broken and looks like a finding.
  events: [
    { event_type: 'approval_reminded', created_at: at(4), meta: { delivered: true, recipient: 'a@b.com', stage_id: 's1' } },
    { event_type: 'approval_reminded', created_at: at(2), meta: { delivered: true, recipient: 'b@b.com', stage_id: 's1' } },
  ],
} as unknown as Parameters<typeof approvalIntel>[0]

const clean = approvalIntel(base)
const withToken = approvalIntel({ ...base, views: four })
const withFull = approvalIntel({ ...base, views: most })

check('two reminders, no views asked → grade unchanged',
  clean.defensibility === 'strong' && clean.viewing === null, clean.defensibility)
check('…plus a four-second viewing → strong drops to thin',
  withToken.defensibility === 'thin', `${withToken.defensibility}: ${withToken.because}`)
check('…plus a full watch → stays strong',
  withFull.defensibility === 'strong', withFull.defensibility)
// It must never REACH broken: that is a claim about a certificate asserting
// silence it cannot support, which viewing evidence has nothing to say about.
check('a token viewing never reaches broken', withToken.defensibility !== 'broken', withToken.defensibility)

console.log(`\n  ${bad === 0 ? '✓ positive evidence only, and only downward' : `✗ ${bad} failure(s)`}\n`)
process.exit(bad === 0 ? 0 : 1)
