-- ============================================================================
-- 0039_approval_decision_advance.sql — Batch 22 item 4 (unplanned, and the
-- reason is recorded here rather than in a commit message alone).
--
-- Governing: S3-c AP-2 (silence is never approval), AP-3 (a stage awaiting
-- changes is not silent), S2 §4. Runs after 0038. Forward-only, idempotent.
--
-- ── THE DEFECT THIS EXISTS FOR ──────────────────────────────────────────────
-- Proven live before this file was written, as the harness personas:
--
--   client assignee reads the approval addressed to them   OK
--   client assignee reads the stage                        OK
--   client assignee INSERTS a decision                     OK  (0038 permits it)
--   client assignee ADVANCES the stage    error=NONE, rowsReturned=0
--   stage status afterwards                                'active'
--
-- `approval_stages_crew_write` is crew-only — correctly, a client must not be
-- able to set a stage to any status they like — and a PostgREST UPDATE that
-- matches zero rows RETURNS NO ERROR. So a client's decision was recorded and
-- the stage silently never advanced.
--
-- WHY THAT IS WORSE THAN A STUCK STAGE. The approval stays open, the item-5
-- sweep eventually lapses it, and the PERMANENT RECORD then reads "no response
-- was received by the agreed review date" — about a client who did respond,
-- whose approval is sitting in approval_decisions the entire time. That is the
-- false record AP-2 exists to prevent, arriving through a door AP-2 does not
-- watch. Item 2's probe missed it because it ran as the service role, which
-- bypasses RLS: the engine was correct, the PRIVILEGE was absent.
--
-- ── WHY A TRIGGER RATHER THAN AN RPC ────────────────────────────────────────
-- Three shapes were considered. An RPC (insert + advance in one function) and
-- a narrow definer function called after the insert both fix the ROUTES — but
-- 0038's approval_decisions INSERT policy deliberately lets an assignee insert
-- a decision DIRECTLY, and such an insert skips anything that lives above the
-- table, leaving exactly the inconsistency being fixed. A trigger cannot be
-- walked around: it fires for both routes, for the harness, for a direct
-- PostgREST write, and for anything built later.
--
-- The cost, stated plainly: the stage-transition rule now lives in SQL. The
-- TypeScript engine's copy is REMOVED in the same commit rather than left to
-- drift, because two implementations of one rule is the failure S3-c §3 names.
-- lib/approvals.ts keeps orchestration and the ledger, and RE-READS the row
-- after inserting — the database is the authority on what advanced.
--
-- A direct insert therefore advances the stage correctly but writes NO ledger
-- row (the ledger is written by the engine, which a direct write bypasses).
-- The DECISION ROW itself is the record; the ledger is corroboration. Noted so
-- the asymmetry is known rather than discovered.
--
-- ── DEPLOY ORDER ────────────────────────────────────────────────────────────
-- ADDITIVE — a new function and a new trigger; no table shape changes. Applies
-- before the code that stops advancing in TypeScript. In the window between
-- this file and that deploy, the trigger advances and the old TS then writes
-- the same values it computed; both agree today (the TS rule was ported
-- verbatim), so the window is safe rather than merely short.
-- ============================================================================

begin;

/**
 * Attribute every decision at the moment it is written.
 *
 * approval_decisions.actor_id is NULLABLE, and must stay so: AD-003 nulls it
 * when a person is deleted, and the decision survives them. But nullable at
 * REST is not the same as optional at WRITE, and the difference was found by
 * probe: a decision inserted without actor_id can never satisfy a user-based
 * assignee (NULL = uuid is NULL, not false), so the stage silently never
 * advances — the same silent-non-advance this migration exists to end,
 * reintroduced one layer down. 0038 deliberately permits an assignee to
 * insert a decision DIRECTLY, so the engine always passing actor_id is not
 * enough; this closes it for every writer.
 *
 * Not SECURITY DEFINER: it touches no table and needs no privilege. Under the
 * service role auth.uid() is null and the value passed in stands, which is
 * what the engine and the item-5 sweep rely on.
 */
create or replace function public.stamp_decision_actor()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.actor_id is null then
    new.actor_id := auth.uid();
  end if;
  return new;
end;
$function$;

drop trigger if exists approval_decisions_stamp_actor on public.approval_decisions;
create trigger approval_decisions_stamp_actor
  before insert on public.approval_decisions
  for each row execute function public.stamp_decision_actor();

/**
 * Recompute a stage from its RECORDED decisions and advance it.
 *
 * SECURITY DEFINER because the whole point is that a client assignee may not
 * write approval_stages directly. Nothing here is supplied by the caller: the
 * transition is DERIVED from approval_decisions, approval_assignees and the
 * rosters, so an assignee can cause a transition only by recording a decision
 * that a policy already permitted them to record.
 */
create or replace function public.advance_stage_after_decision()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_stage     approval_stages%rowtype;
  v_approval  approvals%rowtype;
  v_now       timestamptz := now();
  v_satisfied boolean;
  v_next_id   uuid;
  v_hours     int;
begin
  select * into v_stage from approval_stages where id = new.stage_id;
  -- AP-3, enforced at the write: only an ACTIVE stage advances. A stage in
  -- 'blocked_on_changes' is not silent and is not waiting; a completed or
  -- auto_advanced one is already resolved. Return rather than raise — the
  -- decision row is still legitimately recorded (a late objection, S3-c §2.5,
  -- is a fact worth holding).
  if not found or v_stage.status <> 'active' then
    return new;
  end if;

  select * into v_approval from approvals where id = v_stage.approval_id;
  if not found then
    return new;
  end if;

  if new.decision = 'changes_requested' then
    update approval_stages
       set status = 'blocked_on_changes', advanced_at = v_now
     where id = v_stage.id;
    update approvals set status = 'changes_requested' where id = v_approval.id;
    return new;
  end if;

  if new.decision = 'rejected' then
    update approval_stages
       set status = 'complete', advanced_at = v_now
     where id = v_stage.id;
    update approvals set status = 'rejected' where id = v_approval.id;
    return new;
  end if;

  -- 'approved' — the stage completes only when EVERY required assignee is
  -- satisfied by some approving decision. Role and company assignees are
  -- resolved against the roster and scoped to THIS approval's tenant, never
  -- to any holder of the role anywhere (the same scoping is_stage_assignee()
  -- applies in 0038).
  select not exists (
    select 1
      from approval_assignees asg
     where asg.stage_id = v_stage.id
       and asg.required
       and not exists (
         select 1
           from approval_decisions d
          where d.stage_id = v_stage.id
            and d.decision = 'approved'
            and (
                 (asg.user_id is not null and d.actor_id = asg.user_id)
              or (asg.client_id is not null and exists (
                    select 1 from client_members cm
                     where cm.user_id = d.actor_id
                       and cm.status = 'active'
                       and cm.client_id = asg.client_id))
              or (asg.role is not null and (
                    exists (
                      select 1 from organization_members om
                       where om.user_id = d.actor_id
                         and om.status = 'active'
                         and om.organization_id = v_approval.organization_id
                         and (om.role = asg.role
                              or asg.role = any(coalesce(om.roles, array[]::text[]))))
                    or (v_approval.client_id is not null and exists (
                          select 1 from client_members cm
                           where cm.user_id = d.actor_id
                             and cm.status = 'active'
                             and cm.client_id = v_approval.client_id
                             and cm.role = asg.role))))
            )
       )
  ) into v_satisfied;

  -- Not everyone has answered. The decision is recorded and the stage stays
  -- open for the rest — nothing is lost and nothing advances early.
  if not v_satisfied then
    return new;
  end if;

  update approval_stages
     set status = 'complete', advanced_at = v_now
   where id = v_stage.id;

  v_hours := coalesce(
    v_approval.review_window_hours,
    (select approval_window_hours from organizations where id = v_approval.organization_id),
    120
  );

  select id into v_next_id
    from approval_stages
   where approval_id = v_approval.id
     and seq > v_stage.seq
     and status = 'pending'
   order by seq
   limit 1;

  if v_next_id is not null then
    -- The next stage starts its clock NOW, not at creation: a stage that had
    -- not begun has consumed none of the client's window.
    update approval_stages
       set status = 'active', deadline_at = v_now + make_interval(hours => v_hours)
     where id = v_next_id;
    update approvals set status = 'open' where id = v_approval.id and status <> 'open';
  else
    update approvals set status = 'approved' where id = v_approval.id;
  end if;

  return new;
end;
$function$;

comment on function public.advance_stage_after_decision() is
  'Batch 22. Derives a stage transition from its recorded decisions. SECURITY DEFINER because approval_stages is crew-writable only and a client assignee must still be able to advance the stage they legitimately decided on. Nothing is caller-supplied.';

drop trigger if exists approval_decisions_advance on public.approval_decisions;
create trigger approval_decisions_advance
  after insert on public.approval_decisions
  for each row execute function public.advance_stage_after_decision();

commit;

-- ── VERIFY (run after apply) ────────────────────────────────────────────────
-- 1) The trigger exists and is not internal:
--      select tgname, pg_get_triggerdef(oid) from pg_trigger
--       where tgrelid = 'public.approval_decisions'::regclass and not tgisinternal;
--      -- expect approval_decisions_advance, AFTER INSERT FOR EACH ROW
-- 2) The function is SECURITY DEFINER with a pinned search_path:
--      select prosecdef, proconfig from pg_proc
--       where proname = 'advance_stage_after_decision';
--      -- expect true, {search_path=public}
-- 3) THE BEHAVIOURAL CHECK, which is the one that matters — run as a CLIENT
--    assignee (the harness personas), not as the service role, because the
--    service role bypasses the RLS that caused the defect:
--      · insert an approved decision on an active stage where that client is
--        the only required assignee
--      · expect the stage to read 'complete' with advanced_at set, and the
--        approval to read 'approved', WITHOUT the client ever updating
--        approval_stages
--    Covered by the item-6 harness; run live before this file was committed.
