-- ═══════════════════════════════════════════════════════════════════════════
-- 0074 · the calendar gets its writers   (S3-b §1.2, the projection half)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 0065 created `calendar_entries` and NOTHING WRITES TO IT. A calendar surface
-- over an empty table is the dormant-engine trap 0064 just spent a migration
-- closing, one table over, so the writers come before the surface.
--
-- ── TRIGGERS, NOT CALL SITES, AND 0041 IS THE PRECEDENT ───────────────────
--
-- S3-b §1.2 says a derived entry is "written by the same server action that
-- sets the deadline". Taken literally that means editing every place a deadline
-- is set — `lib/approvals.ts` alone has FOUR (`createApproval`,
-- `activateNextStage`, `setReviewWindow`, `ensureApprovalForTaskGate`) — and
-- then every place written later. The first one somebody forgets is a deadline
-- that silently never reaches the calendar, which is indistinguishable from
-- having no deadline.
--
-- 0041 already settled this exact question for the task projection, and its
-- reasoning is quoted in `lib/approvals.ts`: the projection "lives in 0041 as a
-- trigger on `approvals`, which fires for every writer including 0039's own
-- nested update, and needs no privilege the caller does not have." Same shape,
-- same reason.
--
-- ── AN ENTRY IS A PROJECTION, SO IT IS DELETED AS WELL AS WRITTEN ─────────
--
-- The hard half of a projection is not the insert. A stage that advances, an
-- approval that is withdrawn, an invoice that gets paid — each must REMOVE its
-- entry, or the calendar accumulates deadlines that no longer exist and becomes
-- the thing nobody trusts. Both functions below delete on every state that is
-- no longer a pending obligation, and both are idempotent.
--
-- ── SECURITY DEFINER, DELIBERATELY ────────────────────────────────────────
--
-- `calendar_entries` is RLS'd on org membership and project scope (0065). The
-- writer runs inside somebody else's transaction — the approvals sweep has no
-- session at all (AP-2: a lapse has no actor) — so an INVOKER trigger would
-- silently write nothing for exactly the cases that matter most. The functions
-- copy `organization_id`, `project_id` and `client_id` straight off the source
-- row, so the entry inherits the source's tenancy rather than choosing its own.
--
-- ── NO BACKFILL, AND THAT IS A CHOICE ─────────────────────────────────────
--
-- Live rows today: 5 approval stages (1 active with a deadline) and 9 invoices,
-- of which exactly ONE is both unpaid-ish and carries a due date. Rather than
-- a backfill whose correctness nobody could check, the migration TOUCHES the
-- existing rows (a no-op update) so the triggers fire and project them. The
-- result is verifiable by counting, which a backfill's output is not.
--
-- I-12: forward-only, additive.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── approval stage deadlines ───────────────────────────────────────────────
create or replace function public.project_stage_deadline()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a record;
begin
  select id, organization_id, project_id, client_id, title, status, deleted_at
    into a
    from public.approvals
   where id = new.approval_id;

  if not found then
    return new;
  end if;

  -- A deadline is only an obligation while the stage is ACTIVE and the approval
  -- is still open. Every other state removes the entry.
  if new.status = 'active'
     and new.deadline_at is not null
     and a.deleted_at is null
     and a.status in ('open', 'changes_requested')
  then
    insert into public.calendar_entries (
      organization_id, kind, source_kind, source_id,
      project_id, client_id, title, starts_at, ends_at, all_day
    )
    values (
      a.organization_id, 'approval_deadline', 'approval_stage', new.id,
      a.project_id, a.client_id,
      a.title || ' — ' || new.name, new.deadline_at, new.deadline_at, false
    )
    on conflict (source_kind, source_id) where source_id is not null
    do update set
      title      = excluded.title,
      starts_at  = excluded.starts_at,
      ends_at    = excluded.ends_at,
      project_id = excluded.project_id,
      client_id  = excluded.client_id,
      deleted_at = null;
  else
    delete from public.calendar_entries
     where source_kind = 'approval_stage' and source_id = new.id;
  end if;

  return new;
end
$function$;

comment on function public.project_stage_deadline() is
  'S3-b §1.2 / 0074. Projects an ACTIVE stage deadline onto the calendar and '
  'removes it the moment the stage stops being an obligation. A trigger rather '
  'than four call sites, for 0041''s reason.';

-- ── invoice due dates ──────────────────────────────────────────────────────
create or replace function public.project_invoice_due()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- The live status vocabulary is draft|unpaid|paid|overdue|partial (0001's
  -- CHECK, read before this was written — there is no 'void' or 'cancelled').
  -- A DRAFT is not yet owed and a PAID invoice is no longer owed; overdue,
  -- unpaid and partial all still are.
  if new.due_date is not null
     and new.deleted_at is null
     and new.status not in ('draft', 'paid')
  then
    insert into public.calendar_entries (
      organization_id, kind, source_kind, source_id,
      project_id, client_id, title, starts_at, ends_at, all_day
    )
    values (
      new.organization_id, 'invoice_due', 'invoice', new.id,
      new.project_id, new.client_id,
      'Invoice ' || coalesce(nullif(new.invoice_number, ''), '') || ' due',
      new.due_date::timestamptz, new.due_date::timestamptz, true
    )
    on conflict (source_kind, source_id) where source_id is not null
    do update set
      title      = excluded.title,
      starts_at  = excluded.starts_at,
      ends_at    = excluded.ends_at,
      project_id = excluded.project_id,
      client_id  = excluded.client_id,
      deleted_at = null;
  else
    delete from public.calendar_entries
     where source_kind = 'invoice' and source_id = new.id;
  end if;

  return new;
end
$function$;

-- ONE entry per source. Without this the ON CONFLICT above has nothing to
-- conflict against and every re-save of a deadline adds a duplicate row —
-- which is how a calendar ends up showing the same deadline four times.
create unique index if not exists calendar_entries_source_unique_idx
  on public.calendar_entries (source_kind, source_id) where source_id is not null;

drop trigger if exists approval_stages_calendar on public.approval_stages;
create trigger approval_stages_calendar
  after insert or update of deadline_at, status, name on public.approval_stages
  for each row execute function public.project_stage_deadline();

drop trigger if exists invoices_calendar on public.invoices;
create trigger invoices_calendar
  after insert or update of due_date, status, deleted_at, project_id, client_id
  on public.invoices
  for each row execute function public.project_invoice_due();

-- ── a projected entry is READ-ONLY to people ──────────────────────────────
--
-- A derived entry belongs to its source. If somebody drags an approval deadline
-- on the calendar, the next time the stage is saved the trigger above rewrites
-- it — so the edit silently disappears, which is worse than not offering it.
--
-- The route will refuse it too, but HANDOFF §12 is explicit that "a route being
-- careful is not a control when the table accepts direct writes". The control
-- is here.
--
-- It distinguishes callers by ROLE, which works because the projection
-- functions are SECURITY DEFINER and therefore run as the function owner, while
-- anything arriving through PostgREST runs as `authenticated`.
create or replace function public.calendar_entry_projection_guard()
returns trigger
language plpgsql
as $function$
begin
  if current_user = 'authenticated'
     and coalesce(old.source_id, new.source_id) is not null then
    raise exception
      'this calendar entry is a projection of its % and is edited there, not here',
      coalesce(old.source_kind, new.source_kind)
      using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end
$function$;

drop trigger if exists calendar_entries_projection_guard on public.calendar_entries;
create trigger calendar_entries_projection_guard
  before update or delete on public.calendar_entries
  for each row execute function public.calendar_entry_projection_guard();

-- Fire the triggers over what already exists, instead of a backfill whose
-- correctness could not be checked. A no-op update is enough.
update public.approval_stages set status = status;
update public.invoices set status = status;

commit;

-- ── verification ───────────────────────────────────────────────────────────
-- select kind, count(*) from calendar_entries group by 1;
-- -- clearing a deadline, or completing a stage, must REMOVE its entry.
