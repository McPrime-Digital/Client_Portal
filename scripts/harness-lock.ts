import { existsSync, writeFileSync, unlinkSync } from 'node:fs'

/**
 * ── THE TWO TEST SURFACES MUTATE THE SAME ROW, AND MUST NOT OVERLAP ─────────
 *
 * `npm run check:caps` phase 3 (gen-capability-sql.ts, legacyAliasParity) writes
 * `extra_caps = array['client_money']` onto the harness CREW member and reverts
 * it in a `finally`. `client_money` normalizes to `money.invoices` — exactly the
 * capability assertion 30 asserts that member does NOT hold. Run concurrently,
 * assertion 30 FAILS.
 *
 * It cost a wrong answer in Batch 26 item 2: the failure appeared immediately
 * after a migration was applied, so it read as "the migration broke the money
 * boundary", and the revert in the `finally` erased the evidence before the row
 * could be inspected. A false failure that points at innocent code is worse than
 * no test, and CLAUDE.md documents that both surfaces must be RUN after a
 * capability change without saying they cannot run TOGETHER.
 *
 * So they refuse to. The message NAMES THE OTHER SURFACE rather than saying
 * "busy", because the whole failure mode is not knowing what you are looking at.
 *
 * ── WHY THIS IS ITS OWN MODULE ─────────────────────────────────────────────
 * The first version exported these from test-rls.ts and had check:caps import
 * them. test-rls.ts calls main() at module scope, so that import would have RUN
 * THE ENTIRE HARNESS as a side effect of starting check:caps — the two surfaces
 * colliding through the very code meant to keep them apart. Caught before it
 * shipped; recorded because it is funnier than it is obvious.
 */

const LOCK = new URL('./.harness.lock', import.meta.url).pathname

export function takeLock(who: string): void {
  if (existsSync(LOCK)) {
    console.error(
      `\n✗ REFUSING TO RUN: scripts/.harness.lock exists.\n` +
      `  npm run test:rls and npm run check:caps MUTATE THE SAME harness rows —\n` +
      `  check:caps phase 3 writes extra_caps onto the crew member that assertion 30\n` +
      `  asserts is empty — so a concurrent run produces a FALSE FAILURE pointing at\n` +
      `  whatever you just changed.\n` +
      `  Wait for the other run to finish. If nothing is running, delete the file.\n`,
    )
    process.exit(1)
  }
  writeFileSync(LOCK, `${who} pid=${process.pid} ${new Date().toISOString()}\n`)
}

/** Safe to call twice, and called on every exit path: a lock that survives a
 *  crash turns a guard into an outage. */
export function releaseLock(): void {
  try { unlinkSync(LOCK) } catch { /* already gone */ }
}
