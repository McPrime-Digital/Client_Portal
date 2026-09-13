-- ═══════════════════════════════════════════════════════════════════════════
-- 0063 · per-member AI budgets — S3-b §4.3, extended to daily and weekly
-- ═══════════════════════════════════════════════════════════════════════════
--
-- An owner or admin can cap what any individual spends on AI, per day, per week
-- or per month — including contractors, who are the case that makes it matter: a
-- freelance bench with unlimited access to a metered model is an unbounded
-- liability attached to somebody who leaves at the end of the job.
--
-- ── WHAT THIS CHANGES FROM S3-b §4.3 ───────────────────────────────────────
--
-- §4.3 specifies `member_budgets` keyed on (organization_id, user_id,
-- period_start) with a monthly period. Monthly alone is too coarse for the thing
-- people actually fear: a runaway loop or a careless paste can exhaust a month's
-- budget in an afternoon, and a cap that only notices at month end has not
-- capped anything. So the period is a GRANULARITY (`day` | `week` | `month`)
-- rather than a fixed month, and the row is keyed on the granularity instead of
-- a materialised period_start.
--
-- KEYED ON GRANULARITY, NOT ON A PERIOD ROW. §4.3's
-- (organization_id, user_id, period_start) primary key means a row PER PERSON
-- PER PERIOD — twelve rows a year that all say the same thing, and a limit that
-- silently lapses the first month nobody creates the row. Here one row states
-- the standing rule and the window is computed at read time, so a limit set once
-- keeps applying and no scheduled job is needed to keep it alive.
--
-- ── THE POLICY LAYER, WHICH IS THE PART THAT MAKES IT USABLE ───────────────
--
-- Setting a limit per person does not scale on a rotating freelance bench: the
-- limit that matters is "every contractor gets £X a week", applied to people who
-- have not been hired yet. So `org_seat_budgets` holds a DEFAULT per seat class,
-- and a member row overrides it. An admin sets policy once; the bench inherits.
--
-- Resolution order, and it is deliberately the same shape as the capability
-- layer's: the specific beats the general, and absence means no limit.
--     member_budgets row        → that limit
--     else org_seat_budgets row for their seat_class → that limit
--     else                      → no personal limit
--
-- ── hard_stop DEFAULTS TRUE HERE AND FALSE ON THE ORG ──────────────────────
--
-- `org_budgets.hard_stop` defaults false: an organisation-wide stop takes the
-- whole studio off the air, so it must be chosen. A PERSONAL cap that only warns
-- is not a cap — the person who exceeds it is usually not the person reading the
-- alert — so this one stops by default and the admin can soften it.
--
-- I-12: forward-only, policies dropped before created.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.org_seat_budgets (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  seat_class      text not null check (seat_class in ('staff', 'contractor')),
  period          text not null default 'month' check (period in ('day', 'week', 'month')),
  limit_cents     integer not null check (limit_cents >= 0),
  hard_stop       boolean not null default true,
  updated_at      timestamptz not null default now(),
  primary key (organization_id, seat_class)
);

create table if not exists public.member_budgets (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  period          text not null default 'month' check (period in ('day', 'week', 'month')),
  -- NULL is meaningful and is NOT the same as absent: a row with a null limit is
  -- an explicit "no cap for this person", which overrides a seat-class default
  -- that would otherwise apply. Deleting the row returns them to the default.
  limit_cents     integer null check (limit_cents is null or limit_cents >= 0),
  hard_stop       boolean not null default true,
  note            text null,
  set_by          uuid null references auth.users(id) on delete set null,
  updated_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);

comment on table public.member_budgets is
  'S3-b §4.3, extended: per-person AI spend caps at day/week/month granularity. '
  'One row states the standing rule; the window is computed at read time, so a '
  'limit set once keeps applying without a per-period row or a cron to mint it. '
  'A NULL limit_cents is an explicit "no cap", which overrides the seat-class '
  'default in org_seat_budgets; deleting the row restores the default.';

alter table public.org_seat_budgets enable row level security;
alter table public.member_budgets   enable row level security;

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Reading your OWN limit is never gated: a person must be able to see the cap
-- they are working under, or a refused AI call is indistinguishable from a bug.
-- The same reasoning that keeps roster self-read ungated so resolveCaps() can
-- resolve at all.
drop policy if exists member_budgets_self_read on public.member_budgets;
create policy member_budgets_self_read on public.member_budgets
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Setting somebody's spending limit is a MONEY decision, not a people one, so it
-- rides money.costs rather than people.manage — the same capability that opens
-- Control Tower, where the consequence is visible.
drop policy if exists member_budgets_admin_all on public.member_budgets;
create policy member_budgets_admin_all on public.member_budgets
  for all to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.has_cap('money.costs'))
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.has_cap('money.costs'))
  );

drop policy if exists org_seat_budgets_read on public.org_seat_budgets;
create policy org_seat_budgets_read on public.org_seat_budgets
  for select to authenticated
  using (organization_id = (select public.current_org()) and (select public.is_org_member()));

drop policy if exists org_seat_budgets_admin_all on public.org_seat_budgets;
create policy org_seat_budgets_admin_all on public.org_seat_budgets
  for all to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.has_cap('money.costs'))
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.has_cap('money.costs'))
  );

create index if not exists member_budgets_org_idx on public.member_budgets (organization_id);

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION
--   1 · both tables exist with RLS enabled
--   2 · a member reads their OWN row without money.costs
--   3 · a member WITHOUT money.costs cannot read another member's row, and
--       cannot write any row
--   4 · a holder of money.costs can set and clear both
-- Harness assertions 42-43 cover 2 and 3.
-- ═══════════════════════════════════════════════════════════════════════════
