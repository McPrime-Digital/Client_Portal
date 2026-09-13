-- ═══════════════════════════════════════════════════════════════════════════
-- 0066 · availability_rules + booking_types + bookings   (S3-b migration 3)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- S3-b §1.5: "Double-booking is prevented in the DATABASE, not in the
-- application. Application-side checks lose the race; a constraint does not."
-- That single sentence is why this migration exists in the order it does, and
-- it is correct: two people hitting Confirm in the same second is not an edge
-- case for a booking page, it is the normal failure.
--
-- ── A DEFECT IN THE SPEC, FOUND BY TRYING TO WRITE THE CONSTRAINT ──────────
--
-- §1.5 specifies the exclusion constraint "per `owner_user_id`" and then lists
-- the columns of `bookings` — WHICH CONTAIN NO `owner_user_id`. The owner lives
-- on `booking_types.owner_user_id`, one table away, and an exclusion constraint
-- cannot reach through a join. As written the constraint is unimplementable.
--
-- The two ways out are not equal:
--
--   · Constrain per `booking_type_id`. Wrong, and quietly so: one person with
--     two booking types ("30-min call", "1-hour review") could be booked twice
--     at the same moment, which is the exact thing the constraint exists to
--     stop. It would pass every test written against one booking type.
--   · Denormalise the owner onto the booking. Correct, and this is what is
--     built.
--
-- `owner_user_id` IS NOT WRITABLE BY THE APPLICATION. A trigger stamps it from
-- the booking type on every insert and update, so the column cannot disagree
-- with its type and a caller cannot pick whose calendar they occupy. A
-- denormalised column that an application maintains is a column that eventually
-- drifts; one a trigger maintains is a projection.
--
-- Recorded consequence: a ROOM-LEVEL booking type has `owner_user_id` NULL
-- (§1.4 allows it), and NULL is not equal to NULL, so the constraint does not
-- fire for those. A room cannot be double-booked by this constraint. That is
-- the honest limit of the shape S3-b specifies — room resources need their own
-- key — and it is written down rather than left to be discovered.
--
-- ── btree_gist, AND WHY search_path IS SET ─────────────────────────────────
--
-- `EXCLUDE USING gist` needs a gist operator class for `uuid` equality, which
-- core Postgres does not carry; btree_gist provides it. Supabase installs
-- extensions into the `extensions` schema, which is not on this session's
-- search_path during a migration, so the opclass lookup would fail with a
-- misleading "data type uuid has no default operator class". The search_path is
-- set explicitly for the transaction instead of hoping.
--
-- I-12: forward-only, additive, every create policy preceded by a drop.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

set local search_path = public, extensions;

create extension if not exists btree_gist with schema extensions;

-- ── availability_rules ─────────────────────────────────────────────────────
create table if not exists public.availability_rules (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,

  weekday    int  not null,
  start_time time not null,
  end_time   time not null,
  -- PER RULE, not per user (S3-b §1.3): a person who moves does not
  -- retroactively change what their availability meant last month.
  timezone   text not null,
  created_at timestamptz not null default now(),

  constraint availability_rules_weekday_check check (weekday between 0 and 6),
  constraint availability_rules_span_check    check (end_time > start_time)
);

comment on table public.availability_rules is
  'S3-b §1.3. Recurring weekly availability. Several rows per weekday are '
  'expected — a morning window and an afternoon one are two rules, not one.';

create index if not exists availability_rules_user_idx
  on public.availability_rules (user_id, weekday);

-- ── booking_types ──────────────────────────────────────────────────────────
create table if not exists public.booking_types (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- NULL means a room-level type rather than one person's (S3-b §1.4). See the
  -- constraint note above for what that costs.
  owner_user_id   uuid references auth.users(id) on delete cascade,
  client_id       uuid references public.clients(id) on delete cascade,

  slug             text not null,
  title            text not null,
  description      text,
  duration_minutes int  not null,
  buffer_before    int  not null default 0,
  buffer_after     int  not null default 0,
  min_notice_minutes int not null default 0,
  max_per_day      int,
  -- Validated by zod at the boundary (I-7); the column holds the shape.
  questions        jsonb,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz,

  constraint booking_types_duration_check check (duration_minutes between 1 and 1440),
  constraint booking_types_buffer_check   check (buffer_before >= 0 and buffer_after >= 0),
  constraint booking_types_notice_check   check (min_notice_minutes >= 0),
  constraint booking_types_max_check      check (max_per_day is null or max_per_day > 0)
);

comment on table public.booking_types is
  'S3-b §1.4, the Cal.com model reduced to v1. Round-robin and collective modes '
  'are v1.5 and are deliberately NOT a column yet — adding one is additive.';

-- Unique per org among LIVE rows only: a deleted type must not hold its slug
-- hostage, and a plain unique constraint would do exactly that.
create unique index if not exists booking_types_org_slug_live_idx
  on public.booking_types (organization_id, slug) where deleted_at is null;
create index if not exists booking_types_owner_idx
  on public.booking_types (owner_user_id) where owner_user_id is not null;

-- ── bookings ───────────────────────────────────────────────────────────────
create table if not exists public.bookings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  booking_type_id uuid not null references public.booking_types(id) on delete cascade,

  -- STAMPED BY TRIGGER, never by the application. See the header.
  owner_user_id uuid references auth.users(id) on delete set null,

  -- Nullable: a client contact books as themselves and may not be a crew user.
  booked_by_user_id uuid references auth.users(id) on delete set null,   -- AD-003
  client_id         uuid references public.clients(id) on delete set null,

  starts_at timestamptz not null,
  ends_at   timestamptz not null,
  status    text not null default 'confirmed',
  answers   jsonb,

  calendar_entry_id uuid references public.calendar_entries(id) on delete set null,
  meeting_id        uuid,   -- FK added in 0067, which creates `meetings`

  created_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint bookings_status_check check (
    status in ('confirmed', 'cancelled', 'rescheduled')
  ),
  constraint bookings_span_check check (ends_at > starts_at)
);

comment on table public.bookings is
  'S3-b §1.5. A booking is the result of choosing a slot. Bookings produce '
  'calendar entries; not everything on the calendar is a booking.';

create index if not exists bookings_org_start_idx
  on public.bookings (organization_id, starts_at) where deleted_at is null;
create index if not exists bookings_type_idx  on public.bookings (booking_type_id);
create index if not exists bookings_client_idx on public.bookings (client_id) where client_id is not null;

-- ── the owner stamp ────────────────────────────────────────────────────────
create or replace function public.booking_stamp_owner()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- SECURITY DEFINER because the booker may be a client contact who cannot read
  -- booking_types at all. The stamp must resolve for every booker or the
  -- constraint it feeds is only enforced for some of them.
  select bt.owner_user_id into new.owner_user_id
  from public.booking_types bt
  where bt.id = new.booking_type_id;
  return new;
end
$function$;

comment on function public.booking_stamp_owner() is
  'S3-b §1.5 / 0066. Keeps bookings.owner_user_id equal to its booking type''s '
  'owner so the double-booking exclusion constraint cannot be evaded by an '
  'application that supplies its own value.';

-- ON EVERY INSERT AND EVERY UPDATE, not `update of booking_type_id`.
--
-- The narrow form was written first and a probe defeated it in one statement:
-- `update bookings set owner_user_id = <somebody else>` does not touch
-- booking_type_id, so the trigger never fired and the row kept a forged owner —
-- which moves a booking onto another person's calendar AND evades the exclusion
-- constraint, since the constraint compares the column the trigger was supposed
-- to own. A derived column is only derived if nothing can write it by hand.
drop trigger if exists bookings_stamp_owner on public.bookings;
create trigger bookings_stamp_owner
  before insert or update on public.bookings
  for each row execute function public.booking_stamp_owner();

-- ── THE CONSTRAINT ─────────────────────────────────────────────────────────
-- '[)' is half-open deliberately: a 10:00–11:00 booking and an 11:00–12:00 one
-- do not overlap. With '[]' they would, and every back-to-back slot on a
-- booking page would be refused.
alter table public.bookings drop constraint if exists bookings_no_double_booking;
alter table public.bookings add constraint bookings_no_double_booking
  exclude using gist (
    owner_user_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status = 'confirmed' and deleted_at is null);

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.availability_rules enable row level security;
alter table public.booking_types      enable row level security;
alter table public.bookings           enable row level security;

-- Availability is READABLE BY THE ORG and writable by its owner. §1.7 says so
-- and the reason is structural: you cannot book a slot you cannot see.
drop policy if exists availability_rules_org_read on public.availability_rules;
create policy availability_rules_org_read on public.availability_rules
  for select
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
  );

drop policy if exists availability_rules_own_write on public.availability_rules;
create policy availability_rules_own_write on public.availability_rules
  for all
  using (
    organization_id = (select public.current_org())
    and (user_id = auth.uid() or public.has_cap('people.manage'))
  )
  with check (
    organization_id = (select public.current_org())
    and (user_id = auth.uid() or public.has_cap('people.manage'))
  );

drop policy if exists booking_types_org_read on public.booking_types;
create policy booking_types_org_read on public.booking_types
  for select
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
  );

-- A client sees the types they are meant to book from, and only those: a type
-- with a NULL client_id is internal, so forgetting to set it fails closed.
drop policy if exists booking_types_client_read on public.booking_types;
create policy booking_types_client_read on public.booking_types
  for select
  using (
    client_id is not null
    and public.is_client_member(client_id)
    and active
    and deleted_at is null
  );

drop policy if exists booking_types_own_write on public.booking_types;
create policy booking_types_own_write on public.booking_types
  for all
  using (
    organization_id = (select public.current_org())
    and (owner_user_id = auth.uid() or public.has_cap('people.manage'))
  )
  with check (
    organization_id = (select public.current_org())
    and (owner_user_id = auth.uid() or public.has_cap('people.manage'))
  );

drop policy if exists bookings_crew_all on public.bookings;
create policy bookings_crew_all on public.bookings
  for all
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
  );

drop policy if exists bookings_client_read on public.bookings;
create policy bookings_client_read on public.bookings
  for select
  using (
    client_id is not null
    and public.is_client_member(client_id)
    and deleted_at is null
  );

-- A client contact books, and books only against a type their company may see.
-- The WITH CHECK is the control; the route is the message.
drop policy if exists bookings_client_insert on public.bookings;
create policy bookings_client_insert on public.bookings
  for insert
  with check (
    client_id is not null
    and public.is_client_member(client_id)
    and exists (
      select 1 from public.booking_types bt
      where bt.id = booking_type_id
        and bt.client_id = bookings.client_id
        and bt.active
        and bt.deleted_at is null
    )
  );

commit;

-- ── verification ───────────────────────────────────────────────────────────
-- select conname from pg_constraint where conname = 'bookings_no_double_booking';
-- -- two overlapping confirmed bookings on one owner must raise 23P01.
