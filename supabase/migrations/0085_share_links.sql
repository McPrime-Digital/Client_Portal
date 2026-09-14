-- ═══════════════════════════════════════════════════════════════════════════
-- 0085 · the screening room — guest review without an account
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── THE MARKET, AND WHERE IT STOPS ───────────────────────────────────────
--
-- A no-signup review link is table stakes: Frame.io, Dropbox Replay, Filestage,
-- Wipster and Vimeo Review all have one. Where they differ is security, and
-- where they ALL stop is evidence.
--
--   · Dropbox Replay puts dynamic watermarking on every paid plan.
--   · **Frame.io gates watermarking behind ENTERPRISE.**
--   · MediaSilo goes furthest: session-based watermarked streams plus audit
--     logs of every action.
--
-- Audited for this build (ideas only, no code): cloakshare/cloakshare (MIT —
-- per-viewer watermarks, email gates, expiry, per-view analytics),
-- papermark/papermark (**AGPL-3.0 — studied, deliberately not used**, since a
-- network-served derivative would oblige this product to publish its source),
-- facebookresearch/videoseal (MIT — INVISIBLE forensic watermarking, Python and
-- GPU, so it belongs in the job queue as a worker rather than here).
--
-- ── WHAT NOBODY DOES, AND WHY IT MATTERS HERE ────────────────────────────
--
-- Every one of them records views for ANALYTICS — a dashboard of engagement.
-- None of them connects the view to the DECISION. In a production that is the
-- interesting fact: somebody who opened a cut for four seconds and then
-- approved it is not the same record as somebody who watched ninety-two percent
-- of it and then approved it.
--
-- `share_link_views` therefore stores `furthest_ms` and `seconds_watched`
-- against the same asset an approval is about, so the approval record can show
-- what the approver actually saw. `approvalIntel` already grades how well a
-- record would hold up; "approved without watching" is exactly that kind of
-- signal, and it has never been available to it.
--
-- ── THE TOKEN IS NEVER STORED ────────────────────────────────────────────
--
-- Only its SHA-256, exactly as 0078's signing links. A database leak yields no
-- working links. The same reasoning keeps a password out of a users table.
--
-- ── RLS: CREW MANAGE, NOBODY ELSE READS ──────────────────────────────────
--
-- The anonymous viewer has no session, so there is nothing for a policy to key
-- on — that path is service-role and narrowly scoped to one token, which is the
-- shape §3.7 already blessed for signing links and which carries the same I-8
-- justification.
--
-- I-12: forward-only, additive.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.share_links (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- What is being shown. A FILE today; the other two are the shapes the same
  -- link will carry rather than a second table invented later under pressure.
  subject_kind text not null default 'file',
  subject_id   uuid not null,
  title        text,

  token_hash text not null,

  -- ── the controls a screener needs ──────────────────────────────────────
  expires_at   timestamptz,
  -- SHA-256, never the passcode. Same reasoning as the token.
  passcode_hash text,
  max_views    int,
  view_count   int not null default 0,
  -- Off by default: a screener is for WATCHING. Turning download on is a
  -- deliberate act, not something somebody forgets to turn off.
  allow_download boolean not null default false,
  -- On by default, and this is the point: Frame.io charges Enterprise for it.
  watermark      boolean not null default true,
  -- An email gate makes the watermark mean something — a mark bearing
  -- "anonymous" identifies nobody.
  require_email  boolean not null default true,

  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,   -- AD-003
  created_at timestamptz not null default now(),

  constraint share_links_subject_kind_check check (
    subject_kind in ('file', 'project', 'approval')
  ),
  constraint share_links_max_views_check check (max_views is null or max_views > 0)
);

comment on table public.share_links is
  '0085. A no-signup screening link. Watermarking is ON by default — Frame.io '
  'gates it behind Enterprise, and a leaked screener is the failure this table '
  'exists to make traceable.';

create unique index if not exists share_links_token_idx on public.share_links (token_hash);
create index if not exists share_links_org_idx on public.share_links (organization_id, created_at desc);
create index if not exists share_links_subject_idx on public.share_links (subject_kind, subject_id);

-- ── every view, and how much of it ─────────────────────────────────────────
create table if not exists public.share_link_views (
  id              uuid primary key default gen_random_uuid(),
  link_id         uuid not null references public.share_links(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,

  viewer_email text,
  viewer_name  text,
  ip_address   inet,
  user_agent   text,

  started_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- WHAT THEY ACTUALLY SAW. `furthest_ms` is the high-water mark rather than the
  -- final position, because scrubbing back to the start must not erase the fact
  -- that they reached the end.
  seconds_watched int not null default 0,
  furthest_ms     int not null default 0,
  duration_ms     int,

  constraint share_link_views_watched_check check (seconds_watched >= 0),
  constraint share_link_views_furthest_check check (furthest_ms >= 0)
);

comment on column public.share_link_views.furthest_ms is
  'High-water mark, not the last position: scrubbing back must not erase having '
  'reached the end. This is what lets an approval say what the approver saw.';

create index if not exists share_link_views_link_idx
  on public.share_link_views (link_id, started_at desc);
create index if not exists share_link_views_org_idx
  on public.share_link_views (organization_id, started_at desc);

alter table public.share_links      enable row level security;
alter table public.share_link_views enable row level security;

-- Crew manage their tenant's links. The anonymous viewer has no session, so
-- that path is service-role and scoped to one resolved token — 0078's shape.
drop policy if exists share_links_crew_all on public.share_links;
create policy share_links_crew_all on public.share_links
  for all to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
  );

-- Views are READ-ONLY to everybody with a session. They are evidence about what
-- somebody saw, and evidence a studio can edit is evidence worth less — the same
-- reasoning that made `contract_events` append-only. The viewer's own heartbeat
-- writes them, server-side, through the resolved token.
drop policy if exists share_link_views_crew_read on public.share_link_views;
create policy share_link_views_crew_read on public.share_link_views
  for select to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
  );

commit;

-- ── verification ───────────────────────────────────────────────────────────
-- select count(*) from pg_policies where tablename='share_link_views';  -- 1
-- -- no session may INSERT or UPDATE a view row.
