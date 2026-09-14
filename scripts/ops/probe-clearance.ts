/**
 * Does the clearance panel ever say "cleared" about something nobody cleared?
 *
 * That is the only output of this feature that can cause harm: a green tick on
 * an unexamined asset is worse than no panel, because somebody publishes on it.
 * `assess` is pure, so the states are driven directly.
 *
 *   npx tsx --conditions=react-server scripts/ops/probe-clearance.ts
 */
import { assess, type RightsRow, type ProvenanceMark } from '../../lib/rights'

const day = 86_400_000
let bad = 0
const check = (label: string, ok: boolean, got: string) => {
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(56)} ${got}`)
  if (!ok) bad++
}

const row = (over: Partial<RightsRow>): RightsRow => ({
  file_id: 'f', license: 'appearance', commercial_ok: true, talent_consent: true,
  expires_at: null, notes: null,
  data_mining: 'notAllowed', ai_inference: 'notAllowed', ai_generative_training: 'notAllowed',
  ...over,
})
const mark: ProvenanceMark = {
  action: 'c2pa.created', digital_source_type: 'trainedAlgorithmicMedia',
  model: 'some-model', created_at: new Date().toISOString(),
}

// ── THE ONE THAT MATTERS ─────────────────────────────────────────────────────
const none = assess('f', null, [])
check('no rights row → unknown, never cleared', none.state === 'unknown', none.state)
check('…and it says so in words', /not the same as cleared/.test(none.sentence), none.sentence)

const noneGen = assess('f', null, [mark])
check('AI generated + no release → unknown and named', noneGen.state === 'unknown', noneGen.sentence)

// ── restrictions must read as restrictions, not as absences ──────────────────
const expired = assess('f', row({ expires_at: new Date(Date.now() - 30 * day).toISOString() }), [])
check('expired release → restricted', expired.state === 'restricted', expired.sentence)

const withdrawn = assess('f', row({
  talent_consent: false, notes: 'Release abc was voided',
}), [])
check('withdrawn release → restricted, says withdrawn',
  withdrawn.state === 'restricted' && /withdrawn/.test(withdrawn.sentence), withdrawn.sentence)

const noCommercial = assess('f', row({ commercial_ok: false }), [])
check('commercial_ok false → restricted', noCommercial.state === 'restricted', noCommercial.state)

// ── cleared, and what it must still say ──────────────────────────────────────
const ok1 = assess('f', row({}), [])
check('signed appearance release → cleared', ok1.state === 'cleared', ok1.sentence)
check('…and states the AI training permission even at the default',
  /AI training on it is NOT permitted/.test(ok1.sentence), 'stated')

const ok2 = assess('f', row({ ai_generative_training: 'allowed' }), [])
check('training allowed → said plainly', /AI training on it is permitted/.test(ok2.sentence), ok2.sentence)

// A CLEARED asset that contains generated material is still cleared AND still
// carries a publication obligation — NY 9 June 2026. Both facts, not one colour.
const ok3 = assess('f', row({}), [mark])
check('cleared + AI generation → still cleared, obligation stated',
  ok3.state === 'cleared' && /needs a disclosure/.test(ok3.sentence), ok3.sentence)

// A location agreement carries no person's likeness and must never assert one.
const loc = assess('f', row({ license: 'location', talent_consent: false }), [])
check('location release without consent → cleared, no likeness claimed',
  loc.state === 'cleared' && !/performer consented/.test(loc.sentence), loc.sentence)

console.log(`\n  ${bad === 0 ? '✓ nothing unexamined is ever called cleared' : `✗ ${bad} failure(s)`}\n`)
process.exit(bad === 0 ? 0 : 1)
