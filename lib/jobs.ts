import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * THE JOB QUEUE — Postgres is the queue, and that is the decision.
 *
 * `reference_infra-gaps-jobqueue-transcode` has recorded this as missing since
 * the architecture was first audited. Everything that cannot finish inside one
 * HTTP request has, until now, simply not happened — which is why a recording is
 * started and stopped and never becomes a file.
 *
 * ── WHY NOT pg-boss, BullMQ, OR A SERVICE ────────────────────────────────
 *
 * The mechanism those libraries are built on is `FOR UPDATE SKIP LOCKED`, and
 * 0083 uses it directly. Taking the mechanism rather than the dependency buys
 * three things that matter more here than a feature list:
 *
 *   · ENQUEUE IS TRANSACTIONAL. A job to transcode a file cannot exist if the
 *     file insert rolled back. A separate Redis queue invites exactly that bug
 *     and it is invisible until the worker runs.
 *   · It inherits RLS, so a tenant's jobs are already scoped and already
 *     readable by the product — a queue nobody can see is a queue nobody can
 *     debug.
 *   · There is no Redis in this stack and no worker service to deploy. Adding
 *     one to run a handful of encodes a week is infrastructure bought on a
 *     forecast.
 *
 * ── WHAT WAS TAKEN FROM THE STATE OF THE ART, AND WHAT BEATS IT ─────────
 *
 * Audited: graphile/worker (MIT), pg-boss (MIT), river (MPL-2.0, Go), pgmq
 * (PostgreSQL licence), livepeer/lpms (MIT). Taken as IDEAS, not code:
 *
 *   · JOB KEYS THAT REPLACE, from graphile/worker. Re-enqueueing a key updates
 *     the pending payload instead of being dropped — a contract re-sent after
 *     adding a signer must notify the signer who was added.
 *   · FLOW CONTROL, from pg-boss: a ceiling on concurrent work.
 *
 * **Beaten on fairness.** All five make the QUEUE the unit of fairness —
 * per-queue concurrency, multiple queues, a pool per worker. In a multi-tenant
 * OS that is the wrong axis: one studio uploading two hundred clips starves
 * every other tenant's contract notifications, and the documented workaround is
 * a queue per customer, which turns provisioning into queue administration.
 * 0084 round-robins across ORGANIZATIONS instead — every tenant's first job
 * before any tenant's second — so starvation is impossible rather than unlikely.
 *
 * **And `blocked` is a state none of them has.** "Nobody configured the encoder"
 * and "we tried five times and it broke" need different responses from a person
 * — a settings page versus a bug report — so they are not the same status.
 *
 * ── THE WORKER HOLDS THE SERVICE ROLE, AND ONLY THE WORKER ───────────────
 *
 * Claiming mutates rows across tenants by construction — that is what a queue
 * IS — and it runs from a cron with no session. `jobs` has a crew READ policy
 * and deliberately no write policy: enqueueing goes through this module, which
 * takes the caller's client when there is one.
 */

export type JobKind =
  | 'media.transcode'
  | 'media.probe'
  | 'recording.ingest'
  | 'contract.notify'

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'dead' | 'blocked'

export type Job = {
  id: string
  organization_id: string
  kind: JobKind
  payload: Record<string, unknown>
  status: JobStatus
  attempts: number
  max_attempts: number
  last_error: string | null
  result: Record<string, unknown> | null
  created_at: string
}

export type EnqueueParams = {
  organizationId: string
  kind: JobKind
  payload?: Record<string, unknown>
  /** One live job per (kind, key). A webhook delivered twice must not transcode
   *  twice, and at-least-once delivery means it WILL be delivered twice. */
  dedupeKey?: string
  priority?: number
  maxAttempts?: number
  runAfter?: Date
  createdBy?: string | null
}

/**
 * Add work.
 *
 * `db` is the CALLER'S client wherever one exists, so the enqueue rides the same
 * transaction and the same RLS as whatever caused it. The service role is the
 * fallback for paths that genuinely have no session — a webhook from LiveKit,
 * the cron itself.
 */
export async function enqueue(
  p: EnqueueParams,
  db: SupabaseClient = supabaseAdmin
): Promise<Job | null> {
  const payload = { ...(p.payload ?? {}) }
  if (p.dedupeKey) payload.dedupe_key = p.dedupeKey

  // Through the RPC, not a bare insert: 0084 makes a job key REPLACE the
  // pending payload, and doing that as read-then-write here would race two
  // callers into two rows.
  const { data, error } = await db.rpc('enqueue_job', {
    p_org: p.organizationId,
    p_kind: p.kind,
    p_payload: payload,
    p_priority: p.priority ?? 100,
    p_max_attempts: p.maxAttempts ?? 5,
    p_run_after: (p.runAfter ?? new Date()).toISOString(),
    p_created_by: p.createdBy ?? null,
  })

  if (error) throw new Error(`enqueue(${p.kind}): ${error.message}`)
  return (data as unknown as Job) ?? null
}

/**
 * Take up to `limit` runnable jobs, fairly.
 *
 * Two workers running this at the same instant take disjoint sets (SKIP LOCKED),
 * and no single tenant can take the batch: 0084 ranks each organization's
 * backlog and interleaves, so a studio with two hundred queued encodes gets one
 * slot per pass rather than all of them.
 *
 * `maxRunningPerOrg` is the ceiling on concurrent work per tenant — low enough
 * that one busy studio cannot occupy every worker, high enough that a single
 * upload batch still makes progress.
 */
export async function claim(
  worker: string, limit = 5, leaseSeconds = 300, maxRunningPerOrg = 4
): Promise<Job[]> {
  const { data, error } = await supabaseAdmin.rpc('claim_jobs', {
    p_worker: worker,
    p_limit: limit,
    p_lease_seconds: leaseSeconds,
    p_max_running_per_org: maxRunningPerOrg,
  })
  if (error) throw new Error(`claim: ${error.message}`)
  return (data ?? []) as unknown as Job[]
}

export async function complete(
  id: string, result: Record<string, unknown> = {}
): Promise<void> {
  await supabaseAdmin.from('jobs').update({
    status: 'done',
    result,
    locked_until: null,
    locked_by: null,
    finished_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', id)
}

/**
 * Record a failure and decide whether to try again.
 *
 * EXPONENTIAL BACKOFF, because the commonest reason a job fails is that
 * something downstream is briefly unavailable, and retrying immediately turns
 * one outage into a stampede. Exhausting `max_attempts` makes the row `dead` and
 * LEAVES IT: a queue that deletes what it could not do cannot tell you what it
 * did not do.
 */
export async function fail(job: Job, message: string): Promise<void> {
  const exhausted = job.attempts >= job.max_attempts
  const backoffSeconds = Math.min(3600, 2 ** Math.max(0, job.attempts) * 15)

  await supabaseAdmin.from('jobs').update({
    status: exhausted ? 'dead' : 'failed',
    last_error: message.slice(0, 2000),
    locked_until: null,
    locked_by: null,
    run_after: new Date(Date.now() + backoffSeconds * 1000).toISOString(),
    finished_at: exhausted ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq('id', job.id)
}

/**
 * Not a failure: the work cannot proceed and retrying will not change that —
 * an integration with no credentials, a provider the deployment does not use.
 *
 * A distinct state on purpose. `dead` means "we tried five times and it broke";
 * `blocked` means "nobody configured this", and telling those two apart is the
 * difference between a bug report and a settings page.
 */
export async function block(id: string, reason: string): Promise<void> {
  await supabaseAdmin.from('jobs').update({
    status: 'blocked',
    last_error: reason.slice(0, 2000),
    locked_until: null,
    locked_by: null,
    finished_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', id)
}
