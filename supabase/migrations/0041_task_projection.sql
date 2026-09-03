-- ============================================================================
-- 0041_task_projection.sql — Batch 22 item 8: the dual-write, as a trigger.
--
-- Governing: the batch brief's RULE ZERO (nothing may stop writing the legacy
-- task approval columns, remove a read of them, or change their semantics),
-- S3-c AP-2 (a lapse is never an approval), S3-c §3 (one row, three surfaces).
-- Runs after 0040. Forward-only, idempotent.
--
-- ── WHAT RULE ZERO ACTUALLY COVERS ──────────────────────────────────────────
-- The brief names three columns. The item-0 audit found SIX in live use:
--
--   requires_approval    approval_status    visible_to_client
--   approved_at          approval_note      auto_proceeded
--
-- and `approved_at` is the one that matters most — BOTH live approval pages
-- gate primarily on it, not on approval_status:
--   app/(portal)/approvals/page.tsx:112,121   `!t.approved_at` / `!!t.approved_at`
--   app/api/portal/badge-counts/route.ts:62   `.is('approved_at', null)`
--   components/shared/TaskBoard.tsx:199,603,610,1157,1167
-- A projection that wrote only the brief's three would have left the portal
-- queue and the portal badge frozen while every other surface moved.
--
-- ── WHY A TRIGGER, NOT THE ENGINE ───────────────────────────────────────────
-- Written first in TypeScript, where it could not work. `tasks` is
-- crew-writable only (tasks_client_read is SELECT-only), so the portal decide
-- path would have issued a PostgREST update matching zero rows and returning
-- NO ERROR — the identical silent no-op 0039 exists to end, one table over,
-- and this time it would have desynchronised the old pages from the new engine
-- rather than stalling a stage.
--
-- As a trigger on `approvals` it fires for every writer: both routes, the
-- item-5 sweep, the harness, a direct PostgREST write, and — importantly —
-- 0039's own nested UPDATE of approvals.status when a client's decision
-- advances a stage. Nested triggers are exactly what is wanted here.
--
-- ── THE MAPPING, AND THE ONE LINE THAT IS THE POINT ─────────────────────────
--   open               -> pending,            status review,       approved_at NULL
--   approved           -> approved,           status completed,    approved_at now
--   changes_requested  -> changes_requested,  status in_progress,  approved_at NULL
--   rejected           -> changes_requested,  status in_progress,  approved_at NULL
--   auto_advanced      -> auto_advanced,      status completed,    approved_at NULL
--   withdrawn          -> NULL,                                    approved_at NULL
--
-- `auto_advanced` projects as the LITERAL 'auto_advanced' — never 'approved',
-- and never the retired 'auto_approved'. The legacy column has no CHECK so it
-- accepts the value, and NO existing filter matches it, which is the correct
-- outcome: the task appears in neither the "approved" list nor the "awaiting"
-- list on the old pages. Writing 'auto_approved' here would have re-created
-- through the projection exactly the defect Batch 22 item 5 deleted from
-- deadline-check, where studio/client/review/page.tsx:131 counts
-- 'auto_approved' among the client sign-offs. `approved_at` stays NULL for the
-- same reason: it is the column that means a human signed off, and nobody did.
--
-- `rejected` collapses to 'changes_requested', deliberately and lossily — the
-- legacy vocabulary has three values where the engine has five, and that is
-- the only one that puts the task back in front of the studio. The approval
-- row keeps the true outcome; the projection is not the record.
--
-- ── DEPLOY ORDER ────────────────────────────────────────────────────────────
-- ADDITIVE. A new function and trigger; no table shape changes. Apply any
-- time. With zero approval rows live it changes nothing until the first
-- approval is opened against a task.
-- ============================================================================

begin;

create or replace function public.project_approval_to_task()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_now timestamptz := now();
begin
  -- Only approvals ABOUT a task. 'milestone' is included because a milestone
  -- is a task with category='milestone' (live CHECK on tasks.category); there
  -- is no milestones table and S-F does not ask for one.
  if new.subject_kind not in ('task', 'milestone') then
    return new;
  end if;

  -- Nothing to project when the status did not move.
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  if new.status = 'open' then
    update tasks set requires_approval = true, approval_status = 'pending',
                     status = 'review', approved_at = null, updated_at = v_now
     where id = new.subject_id;

  elsif new.status = 'approved' then
    update tasks set requires_approval = true, approval_status = 'approved',
                     status = 'completed', approved_at = v_now,
                     completed_at = v_now, updated_at = v_now
     where id = new.subject_id;

  elsif new.status in ('changes_requested', 'rejected') then
    update tasks set requires_approval = true, approval_status = 'changes_requested',
                     status = 'in_progress', approved_at = null, updated_at = v_now
     where id = new.subject_id;

  elsif new.status = 'auto_advanced' then
    -- AP-2. Not 'approved'. Not 'auto_approved'. approved_at stays NULL.
    update tasks set requires_approval = true, approval_status = 'auto_advanced',
                     status = 'completed', approved_at = null,
                     auto_proceeded = true, completed_at = v_now, updated_at = v_now
     where id = new.subject_id;

  elsif new.status = 'withdrawn' then
    update tasks set approval_status = null, approved_at = null, updated_at = v_now
     where id = new.subject_id;
  end if;

  return new;
end;
$function$;

comment on function public.project_approval_to_task() is
  'Batch 22 item 8 (RULE ZERO). Projects an approval''s state onto the legacy tasks approval columns so both existing approval pages and the Batch 12.2 rail badges keep working. The approval row is the authority; these columns are a projection and drop in a later batch. auto_advanced projects as ''auto_advanced'', never ''approved''.';

drop trigger if exists approvals_project_to_task on public.approvals;
create trigger approvals_project_to_task
  after insert or update of status on public.approvals
  for each row execute function public.project_approval_to_task();

commit;

-- ── VERIFY (run after apply) ────────────────────────────────────────────────
-- 1) The trigger exists:
--      select tgname, pg_get_triggerdef(oid) from pg_trigger
--       where tgrelid='public.approvals'::regclass and not tgisinternal;
--      -- expect approvals_project_to_task, AFTER INSERT OR UPDATE OF status
-- 2) SECURITY DEFINER with a pinned search_path:
--      select prosecdef, proconfig from pg_proc
--       where proname='project_approval_to_task';
--      -- expect true, {search_path=public}
-- 3) THE BEHAVIOURAL CHECK — open an approval against a task and confirm the
--    task reads approval_status='pending', status='review'; then approve it as
--    the assignee and confirm 'approved' + approved_at set; then lapse another
--    and confirm 'auto_advanced' with approved_at STILL NULL. Run live before
--    this file was committed.
