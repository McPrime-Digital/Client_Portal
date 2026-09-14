/**
 * Does the client's calendar say the true thing?
 *
 * The RLS half is already asserted (harness 46/47). What is NOT covered by any
 * assertion is the SENTENCE — and a consequence that is confidently wrong is
 * worse than no page at all, because somebody will act on it. So this signs in
 * as a real client persona and reads what they would actually be shown.
 *
 *   npx tsx scripts/ops/probe-portal-calendar.ts
 */
import { createClient } from '@supabase/supabase-js'
import { PERSONAS, loadEnv, requireEnv, APPROVAL_CLIENT_STAGE_ID } from '../harness-constants'
import { clientAgenda, orderAgenda, untilPhrase } from '../../lib/portalCalendar'

async function main() {
  const env = loadEnv()
  const url = requireEnv(env, 'NEXT_PUBLIC_SUPABASE_URL')
  const anon = requireEnv(env, 'NEXT_PUBLIC_SUPABASE_ANON_KEY')

  let bad = 0
  for (const key of ['c1own', 'c1mate', 'c2own'] as const) {
    const p = PERSONAS[key]
    const db = createClient(url, anon, { auth: { persistSession: false } })
    const { error } = await db.auth.signInWithPassword({
      email: p.email, password: requireEnv(env, p.envKey),
    })
    if (error) { console.log(`  ✗ ${key}: ${error.message}`); bad++; continue }
    const { data: { user } } = await db.auth.getUser()
    if (!user) { console.log(`  ✗ ${key}: no user`); bad++; continue }

    const items = orderAgenda(await clientAgenda(db, user.id))
    console.log(`\n  ${p.label}`)
    if (items.length === 0) { console.log('    (nothing visible)'); continue }
    for (const i of items) {
      console.log(
        `    [${i.move.padEnd(6)}]${i.lapsed ? ' (passed)' : '        '} ` +
        `${i.entry.kind.padEnd(18)} ${i.entry.title.slice(0, 34).padEnd(34)} ${untilPhrase(i.entry.starts_at)}`
      )
      if (i.consequence) console.log(`             → ${i.consequence}`)

      // THE TENSE CHECK. "If you do nothing by X" about a date already past is
      // the exact defect approvalIntel shipped once and had to be corrected for
      // (HANDOFF §12): a sentence that is grammatical, confident and false.
      if (i.lapsed && i.consequence?.startsWith('If')) {
        console.log('             ✗ FUTURE TENSE ON A PAST DATE'); bad++
      }
      // And the reverse: a live deadline that says it already happened.
      if (!i.lapsed && i.consequence?.includes('was approved automatically')) {
        console.log('             ✗ PAST TENSE ON A LIVE DEADLINE'); bad++
      }
      // A row claiming to be the client's move must carry a reason.
      if (i.move === 'you' && !i.consequence) {
        console.log('             ✗ "waiting on you" with nothing said about why'); bad++
      }
    }
    await db.auth.signOut()
  }

  // ── THE CONSTRUCTED CASE ───────────────────────────────────────────────
  //
  // An ACTIVE stage whose deadline has already passed — the window between the
  // deadline and the next daily sweep. It is the branch most likely to be wrong
  // and the least likely to exist when somebody happens to run a probe, so it
  // is BUILT rather than waited for (§12 lesson 9: a control that cannot be
  // constructed proves nothing and looks like a pass).
  //
  // The stage is moved back, read as the client, and moved forward again in a
  // `finally` — 0074's trigger re-projects the calendar entry both ways.
  {
    const owner = createClient(url, anon, { auth: { persistSession: false } })
    await owner.auth.signInWithPassword({
      email: PERSONAS.owner.email, password: requireEnv(env, PERSONAS.owner.envKey),
    })
    const { data: before } = await owner.from('approval_stages')
      .select('deadline_at').eq('id', APPROVAL_CLIENT_STAGE_ID).maybeSingle()
    const original = (before as { deadline_at: string | null } | null)?.deadline_at ?? null

    try {
      const past = new Date(Date.now() - 2 * 86_400_000).toISOString()
      const { data: moved } = await owner.from('approval_stages')
        .update({ deadline_at: past }).eq('id', APPROVAL_CLIENT_STAGE_ID).select('id')
      if ((moved ?? []).length === 0) {
        console.log('\n  ! could not construct the overdue case (stage not writable) — NOT a pass')
        bad++
      } else {
        const db = createClient(url, anon, { auth: { persistSession: false } })
        await db.auth.signInWithPassword({
          email: PERSONAS.c1own.email, password: requireEnv(env, PERSONAS.c1own.envKey),
        })
        const { data: { user } } = await db.auth.getUser()
        const items = orderAgenda(await clientAgenda(db, user!.id))
        const overdue = items.find((i) => i.entry.kind === 'approval_deadline')
        console.log('\n  constructed: an ACTIVE stage two days past its deadline')
        if (!overdue) { console.log('    ✗ the overdue deadline vanished from the calendar'); bad++ }
        else {
          console.log(`    [${overdue.move}] ${overdue.lapsed ? '(passed)' : ''} → ${overdue.consequence}`)
          if (!overdue.lapsed) { console.log('    ✗ not marked lapsed'); bad++ }
          if (overdue.move !== 'you') { console.log('    ✗ an overdue decision stopped being the client\'s move'); bad++ }
          if (overdue.consequence?.startsWith('If')) { console.log('    ✗ FUTURE TENSE ON A PAST DATE'); bad++ }
          // And it must still sort to the TOP — an emergency filed under
          // history is an emergency nobody sees.
          if (items[0] !== overdue) { console.log('    ✗ the overdue decision did not sort first'); bad++ }
        }
        await db.auth.signOut()
      }
    } finally {
      await owner.from('approval_stages')
        .update({ deadline_at: original }).eq('id', APPROVAL_CLIENT_STAGE_ID)
      await owner.auth.signOut()
    }
  }

  console.log(`\n  ${bad === 0 ? '✓ every sentence agrees with its own date' : `✗ ${bad} problem(s)`}\n`)
  process.exit(bad === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
