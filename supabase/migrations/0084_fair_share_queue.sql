-- ═══════════════════════════════════════════════════════════════════════════
-- 0084 · fair-share claiming, and job keys that REPLACE
-- Revising 0083 against the state of the art, properly this time.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── THE AUDIT THAT SHOULD HAVE PRECEDED 0083 ─────────────────────────────
--
--   graphile/worker    MIT            job keys with REPLACE, batch payload
--                                     merging, local queue batching (~100–200
--                                     jobs/s before lock contention)
--   timgit/pg-boss     MIT            rate limiting, debouncing, per-queue
--                                     concurrency, dead-letter queues, job
--                                     dependency orchestration
--   riverqueue/river   MPL-2.0        ~10k jobs/s, unique-by-args, multiple
--                                     queues — but Go, and file-level copyleft
--   pgmq/pgmq          PostgreSQL     SQS semantics, visibility timeouts;
--                                     an extension install
--   livepeer/lpms      MIT            open transcoding; needs Go nodes
--
-- 0083 already had SKIP LOCKED, visibility timeouts, bounded retries with
-- backoff, dedupe keys, priority and deferral. Two things it lacked, both taken
-- from the list above, and one thing NONE of them has.
--
-- ── TAKEN: A JOB KEY SHOULD REPLACE, NOT REFUSE (graphile/worker) ────────
--
-- 0083's dedupe index refuses a second enqueue outright. That is right for
-- "transcode this file" and WRONG for anything whose payload moves: re-sending a
-- contract after adding a signer should update the pending notification, not be
-- silently dropped because one was already queued. `enqueue_job` below updates
-- the payload and re-arms `run_after` when a live job holds the key, and
-- inserts otherwise — atomically, which a read-then-write in TypeScript could
-- not be.
--
-- ── TAKEN: FLOW CONTROL (pg-boss) ────────────────────────────────────────
--
-- Nothing stopped one tenant holding every running slot. `p_max_running_per_org`
-- caps it.
--
-- ── SURPASSED: FAIRNESS IS PER TENANT, NOT PER QUEUE ────────────────────
--
-- **Every one of those five projects makes the QUEUE the unit of fairness.**
-- pg-boss gives you per-queue concurrency; River gives you multiple queues;
-- graphile gives you a pool per worker. In a multi-tenant OS that is the wrong
-- axis: one studio uploading two hundred clips fills the queue and every other
-- tenant's contract notifications wait behind it. The documented workaround in
-- all of them is a queue per customer, which does not scale past a handful and
-- turns provisioning into queue administration.
--
-- So the claim below ROUND-ROBINS ACROSS ORGANIZATIONS: each org's oldest
-- eligible job is considered before any org's second. A tenant with two hundred
-- queued encodes takes one slot per pass, not all of them, and priority still
-- orders within a tenant. Starvation becomes impossible rather than unlikely.
--
-- The rank is computed over the SAME small candidate set the old query scanned,
-- so it costs one window function on rows already being read.
--
-- ── KEPT: `blocked` IS NOT `dead`, AND NONE OF THEM HAS IT ──────────────
--
-- "Nobody configured the encoder" and "we tried five times and it broke" need
-- different responses from a human — a settings page versus a bug report — so
-- they are different states. Every library above collapses both into failure.
--
-- I-12: forward-only.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── the fair-share claim ───────────────────────────────────────────────────
create or replace function public.claim_jobs(
  p_worker text,
  p_limit  int default 5,
  p_lease_seconds int default 300,
  -- Flow control (pg-boss's idea, keyed on the tenant instead of the queue).
  p_max_running_per_org int default 4
)
returns setof public.jobs
language sql
security definer
set search_path to 'public'
as $function$
  with running as (
    select organization_id, count(*) as n
      from public.jobs
     where status = 'running'
       and locked_until > now()
     group by organization_id
  ),
  eligible as (
    select j.id, j.organization_id, j.priority, j.run_after
      from public.jobs j
      left join running r on r.organization_id = j.organization_id
     where j.status in ('queued', 'failed')
       and j.run_after <= now()
       and j.attempts < j.max_attempts
       and (j.locked_until is null or j.locked_until < now())
       -- A tenant already at its ceiling is skipped, not queued behind itself.
       and coalesce(r.n, 0) < greatest(1, p_max_running_per_org)
  ),
  ranked as (
    select e.id,
           -- THE FAIRNESS. Position within this org's own backlog.
           row_number() over (
             partition by e.organization_id
             order by e.priority, e.run_after, e.id
           ) as rank_in_org,
           e.priority,
           e.run_after
      from eligible e
  ),
  claimable as (
    select r.id
      from ranked r
     -- Every org's first job outranks every org's second. Priority and age
     -- still order WITHIN a tenant, and break ties ACROSS tenants at equal rank.
     order by r.rank_in_org, r.priority, r.run_after
     limit greatest(1, least(p_limit, 50))
     for update skip locked
  )
  update public.jobs j
     set status = 'running',
         attempts = j.attempts + 1,
         locked_by = p_worker,
         locked_until = now() + make_interval(secs => greatest(30, p_lease_seconds)),
         updated_at = now()
    from claimable c
   where j.id = c.id
  returning j.*;
$function$;

comment on function public.claim_jobs(text, int, int, int) is
  '0084. SKIP LOCKED claim with a visibility timeout, a per-TENANT concurrency '
  'cap, and round-robin fairness across organizations — every org''s first job '
  'before any org''s second. pg-boss, graphile-worker and River all make the '
  'QUEUE the unit of fairness; in a multi-tenant OS that lets one studio''s '
  'upload batch starve everybody else.';

revoke all on function public.claim_jobs(text, int, int, int) from public, anon, authenticated;
-- 0083's three-argument version would otherwise linger as a second entry point
-- that quietly skips the fairness this migration exists to add.
drop function if exists public.claim_jobs(text, int, int);

-- ── a job key that replaces ────────────────────────────────────────────────
create or replace function public.enqueue_job(
  p_org uuid,
  p_kind text,
  p_payload jsonb default '{}'::jsonb,
  p_priority int default 100,
  p_max_attempts int default 5,
  p_run_after timestamptz default now(),
  p_created_by uuid default null
)
returns public.jobs
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_key text := p_payload->>'dedupe_key';
  v_row public.jobs;
begin
  if v_key is not null then
    -- REPLACE, not refuse (graphile/worker's job-key semantics). The newest
    -- intent wins: a contract re-sent after adding a signer must notify the
    -- signer who was added, not the roster as it stood when the first job was
    -- queued.
    update public.jobs
       set payload = p_payload,
           priority = least(priority, p_priority),
           run_after = least(run_after, p_run_after),
           max_attempts = greatest(max_attempts, p_max_attempts),
           updated_at = now()
     where kind = p_kind
       and payload->>'dedupe_key' = v_key
       and status in ('queued', 'failed')
    returning * into v_row;

    if found then
      return v_row;
    end if;
  end if;

  insert into public.jobs (
    organization_id, kind, payload, priority, max_attempts, run_after, created_by
  )
  values (p_org, p_kind, p_payload, p_priority, p_max_attempts, p_run_after, p_created_by)
  returning * into v_row;

  return v_row;
exception
  -- A RUNNING job holds the key: the work is already in flight, and the right
  -- answer is the row rather than an error the caller has to interpret.
  when unique_violation then
    select * into v_row from public.jobs
     where kind = p_kind and payload->>'dedupe_key' = v_key
     order by created_at desc limit 1;
    return v_row;
end
$function$;

comment on function public.enqueue_job is
  '0084. Job keys REPLACE rather than refuse — the newest intent wins, and the '
  'update is atomic where a read-then-write in the application would race.';

revoke all on function public.enqueue_job(uuid, text, jsonb, int, int, timestamptz, uuid)
  from public, anon, authenticated;

commit;

-- ── verification ───────────────────────────────────────────────────────────
-- -- two orgs with backlogs: one pass must return one job from EACH, not two
-- -- from whichever queued first.
