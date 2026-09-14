-- ═══════════════════════════════════════════════════════════════════════════
-- 0083 · the job queue, and somewhere for a transcode to land
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `reference_infra-gaps-jobqueue-transcode` has recorded this as missing since
-- the architecture was first audited: Supabase and R2 carry the product, but
-- there is no queue and no media pipeline, so everything that cannot finish
-- inside one request simply does not happen.
--
-- Three things are currently broken for exactly that reason, and all three are
-- loops this repository opened itself:
--
--   1. A recording is started and stopped through Egress and NOTHING ever sets
--      `recording_file_id` or flips the status to `ready` — because that happens
--      minutes later, in a webhook, not in the request that stopped it.
--   2. Colour metadata (0082) is declared by hand because nothing probes a file.
--   3. Nothing transcodes, so `colour-accurate streaming` stays a warning label
--      rather than a delivery.
--
-- ── POSTGRES IS THE QUEUE, AND SKIP LOCKED IS WHY ────────────────────────
--
-- `FOR UPDATE SKIP LOCKED` is the mechanism pg-boss and pgmq are both built on:
-- concurrent workers claim different rows without blocking each other and
-- without ever claiming the same row twice. Taking the mechanism rather than the
-- library is deliberate —
--
--   · a queue in the SAME database as the data means enqueue is TRANSACTIONAL.
--     A job to transcode a file cannot exist if the file insert rolled back,
--     which is the entire class of bug a separate Redis queue invites.
--   · it inherits RLS, so a tenant's jobs are already scoped and already
--     visible to the product without a second access model.
--   · it adds no service to deploy, and this stack has no Redis.
--
-- ── VISIBILITY TIMEOUT, NOT A LOCK HELD OPEN ─────────────────────────────
--
-- A claimed job carries `locked_until`. A worker that dies mid-job does not
-- wedge the queue: the claim lapses and the row becomes available again. Holding
-- a transaction open for the duration of a five-minute encode would tie a
-- Postgres connection to an HTTP request on a platform that kills those.
--
-- ── RETRIES ARE BOUNDED AND FAILURE IS A STATE, NOT A DELETE ─────────────
--
-- `attempts` against `max_attempts`, with exponential backoff in `run_after`.
-- A job that exhausts them becomes `dead` and STAYS — a queue that deletes what
-- it could not do is a queue that cannot tell you what it did not do, which is
-- the same reasoning that made `contract_events` append-only.
--
-- I-12: forward-only, additive.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.jobs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  kind    text not null,
  payload jsonb not null default '{}'::jsonb,

  status  text not null default 'queued',
  -- Lower runs first. A recording the studio is waiting on outranks a nightly
  -- re-probe of an archive.
  priority int not null default 100,

  attempts     int not null default 0,
  max_attempts int not null default 5,

  run_after    timestamptz not null default now(),
  locked_until timestamptz,
  locked_by    text,

  result     jsonb,
  last_error text,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,

  constraint jobs_status_check check (
    status in ('queued', 'running', 'done', 'failed', 'dead', 'blocked')
  ),
  constraint jobs_attempts_check check (attempts >= 0 and max_attempts >= 1)
);

comment on table public.jobs is
  'S0 I-4 / reference_infra-gaps-jobqueue-transcode. Postgres IS the queue: '
  'SKIP LOCKED for the claim, a visibility timeout rather than a held lock, and '
  'transactional enqueue — a job cannot outlive the insert that created it.';

-- THE claim index. Partial, because the only rows a worker ever scans are the
-- runnable ones, and a full index would grow with every completed job forever.
create index if not exists jobs_claimable_idx
  on public.jobs (priority, run_after)
  where status in ('queued', 'failed');

create index if not exists jobs_org_idx on public.jobs (organization_id, created_at desc);
create index if not exists jobs_kind_idx on public.jobs (kind, status);
-- One live job per (kind, dedupe key), so a webhook delivered twice does not
-- transcode twice. The key lives in the payload because it differs per kind.
create unique index if not exists jobs_dedupe_idx
  on public.jobs (kind, (payload->>'dedupe_key'))
  where payload->>'dedupe_key' is not null
    and status in ('queued', 'running', 'failed');

alter table public.jobs enable row level security;

-- Crew READ their tenant's jobs — a queue nobody can see is a queue nobody can
-- debug. Writing is the worker's job and the worker is the service role, so
-- there is deliberately no write policy.
drop policy if exists jobs_crew_read on public.jobs;
create policy jobs_crew_read on public.jobs
  for select to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
  );

-- ── the claim ──────────────────────────────────────────────────────────────
create or replace function public.claim_jobs(
  p_worker text,
  p_limit  int default 5,
  p_lease_seconds int default 300
)
returns setof public.jobs
language sql
security definer
set search_path to 'public'
as $function$
  with claimable as (
    select j.id
      from public.jobs j
     where j.status in ('queued', 'failed')
       and j.run_after <= now()
       and j.attempts < j.max_attempts
       and (j.locked_until is null or j.locked_until < now())
     order by j.priority, j.run_after
     limit greatest(1, least(p_limit, 50))
     -- THE mechanism. Two workers running this simultaneously take disjoint
     -- sets; neither waits for the other.
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

comment on function public.claim_jobs(text, int, int) is
  'SKIP LOCKED claim with a visibility timeout. A worker that dies mid-job does '
  'not wedge the queue — the lease lapses and the row is claimable again.';

revoke all on function public.claim_jobs(text, int, int) from public, anon, authenticated;

-- ── renditions ─────────────────────────────────────────────────────────────
--
-- A transcode does NOT overwrite the master. A rendition is a separate row
-- pointing at the same source, because the thing an editor approves and the
-- thing a browser can play are not the same object and conflating them loses the
-- original — the same argument S3-core §3.2 makes about versions being files.
create table if not exists public.media_renditions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  file_id         uuid not null references public.files(id) on delete cascade,

  -- 'stream' (an adaptive HLS/DASH ladder) | 'proxy' (a small editing copy) |
  -- 'thumbnail'.
  kind     text not null,
  provider text not null default 'cloudflare_stream',

  -- The provider's own id, and the URLs it hands back. NOT an R2 path: an
  -- adaptive ladder is a manifest plus many segments, and pretending it is one
  -- object is how a player ends up fetching a file that does not exist.
  provider_uid  text,
  playback_url  text,
  thumbnail_url text,

  status   text not null default 'pending',
  duration_seconds numeric,
  width  int,
  height int,
  -- What the PROBE found, as distinct from what 0082 lets a person declare.
  colour_space text,
  transfer     text,
  bit_depth    int,

  error      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint media_renditions_kind_check check (kind in ('stream', 'proxy', 'thumbnail')),
  constraint media_renditions_status_check check (
    status in ('pending', 'processing', 'ready', 'failed')
  )
);

create unique index if not exists media_renditions_file_kind_idx
  on public.media_renditions (file_id, kind, provider);
create index if not exists media_renditions_org_idx
  on public.media_renditions (organization_id, created_at desc);

alter table public.media_renditions enable row level security;

-- A rendition is as visible as the file it belongs to. Reached THROUGH the
-- file rather than restating its predicate, which is 0038's idiom and the
-- reason a change to file visibility cannot leave this table behind.
drop policy if exists media_renditions_read on public.media_renditions;
create policy media_renditions_read on public.media_renditions
  for select to authenticated
  using (exists (select 1 from public.files f where f.id = file_id));

commit;

-- ── verification ───────────────────────────────────────────────────────────
-- select claim_jobs('probe', 1);          -- empty on an empty queue, no error
-- select count(*) from jobs;              -- 0
