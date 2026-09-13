-- ═══════════════════════════════════════════════════════════════════════════
-- 0075 · a booking produces a calendar entry   (S3-b §1.1, the last projection)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- S3-b §1.1, verbatim: "Bookings produce calendar entries. Not everything on
-- the calendar is a booking." 0066 built bookings and 0074 built the calendar's
-- writers, and this is the edge between them that neither could own alone.
--
-- Without it a booked casting slot exists in `bookings` and is invisible on the
-- calendar — which makes the calendar wrong in the most dangerous direction: it
-- shows time as free that somebody has already been promised.
--
-- ── source_kind GAINS A VALUE ──────────────────────────────────────────────
--
-- 0065's CHECK allows meeting | approval_stage | invoice | manual. A booking is
-- none of those, and reusing 'meeting' would make the two indistinguishable the
-- day meetings get their own projection — so the vocabulary widens by one.
--
-- ── THE SAME THREE RULES AS 0074 ───────────────────────────────────────────
--
--   · a trigger, not a call site, so every writer projects
--   · the entry is DELETED when the booking stops being one (cancelled,
--     rescheduled, soft-deleted) — a calendar that keeps cancelled bookings is
--     a calendar that shows time as busy when it is free, which is the same
--     failure as the reverse and just as expensive
--   · the entry is read-only to people, through 0074's existing projection
--     guard, which already covers anything carrying a source_id
--
-- `bookings.calendar_entry_id` is stamped back onto the booking so the link is
-- navigable from both ends. It is set in an AFTER trigger rather than a BEFORE
-- one because the entry cannot reference a booking row that does not exist yet.
--
-- I-12: forward-only, additive.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

alter table public.calendar_entries drop constraint if exists calendar_entries_source_kind_check;
alter table public.calendar_entries add constraint calendar_entries_source_kind_check
  check (
    source_kind is null
    or source_kind in ('meeting', 'approval_stage', 'invoice', 'manual', 'booking')
  );

create or replace function public.project_booking_entry()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_title text;
  v_entry uuid;
begin
  if new.status = 'confirmed' and new.deleted_at is null then
    select bt.title into v_title from public.booking_types bt where bt.id = new.booking_type_id;

    insert into public.calendar_entries (
      organization_id, kind, source_kind, source_id,
      project_id, client_id, title, starts_at, ends_at, all_day
    )
    values (
      new.organization_id, 'meeting', 'booking', new.id,
      null, new.client_id,
      coalesce(v_title, 'Booking'), new.starts_at, new.ends_at, false
    )
    on conflict (source_kind, source_id) where source_id is not null
    do update set
      title     = excluded.title,
      starts_at = excluded.starts_at,
      ends_at   = excluded.ends_at,
      client_id = excluded.client_id,
      deleted_at = null
    returning id into v_entry;

    if new.calendar_entry_id is distinct from v_entry then
      update public.bookings set calendar_entry_id = v_entry where id = new.id;
    end if;
  else
    delete from public.calendar_entries
     where source_kind = 'booking' and source_id = new.id;
    if new.calendar_entry_id is not null then
      update public.bookings set calendar_entry_id = null where id = new.id;
    end if;
  end if;

  return null;
end
$function$;

comment on function public.project_booking_entry() is
  'S3-b §1.1 / 0075. "Bookings produce calendar entries." Removes the entry when '
  'the booking is cancelled or rescheduled — a calendar holding cancelled '
  'bookings shows time as busy when it is free.';

-- AFTER, and on the columns that change what the entry SAYS. Not on
-- calendar_entry_id, or the write-back below would recurse.
drop trigger if exists bookings_calendar on public.bookings;
create trigger bookings_calendar
  after insert or update of status, starts_at, ends_at, client_id, booking_type_id, deleted_at
  on public.bookings
  for each row execute function public.project_booking_entry();

commit;

-- ── verification ───────────────────────────────────────────────────────────
-- -- a confirmed booking must appear on the calendar and carry the entry id;
-- -- cancelling it must remove the entry and null the link.
