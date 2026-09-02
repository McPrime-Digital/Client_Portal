-- ============================================================================
-- 0040_decision_attribution.sql — Batch 22 item 4: a decision cannot lie about
-- who made it.
--
-- Governing: S0 P-1 ("who signed off on v3, and when" is what settles a
-- dispute), I-6 (ownership server-resolved, never from the body), S3-c §3.2
-- (the Review & Approval page is the record you cannot argue with), and the
-- Batch 7.8 / 11.5 lesson about forgeable attribution. Runs after 0039.
-- Forward-only, idempotent.
--
-- ── THE DEFECT, found by probe before any UI existed ────────────────────────
-- 0039 stamped actor_id from auth.uid() only WHEN IT WAS NULL. A caller who
-- supplied one kept it. And 0038 deliberately permits an ASSIGNEE to insert a
-- decision directly, so a client with a legitimate seat at one stage could
-- POST to PostgREST with
--
--     { stage_id: <their own stage>, actor_id: <somebody else>,
--       actor_name: 'Somebody Else', decision: 'approved' }
--
-- and the permanent record would attribute their approval to a colleague.
-- Proven live: "a decision naming ANOTHER user was accepted".
--
-- The ROUTES were never wrong — both pass user.id from the verified session
-- and the name from the roster. But a route being careful is not a control
-- when the table accepts direct writes by design. This is the same shape as
-- Batch 6.1 (the ledger accepting forged entries until it validated the
-- target) and 7.8 (actor_name preferring user-editable user_metadata): the
-- attribution has to be taken from the session, not accepted from the caller.
--
-- ── WHAT CHANGES ────────────────────────────────────────────────────────────
-- When there IS a session, both attribution columns are OVERWRITTEN from it:
--   · actor_id   := auth.uid(), always — not only when null
--   · actor_name := the caller's own ROSTER name (organization_members for
--                   crew, client_members for portal), when the roster has one
--
-- actor_name is still a SNAPSHOT stored on the row, deliberately: it must
-- survive the person being renamed or deleted (AD-003 nulls actor_id and the
-- decision outlives them). This only fixes WHERE the snapshot is taken from.
-- If no roster row carries a name, the supplied value stands rather than the
-- decision being blocked — refusing to record a decision is worse than
-- recording it with a weaker name, and the row is still tied to a real
-- auth.uid().
--
-- Under the SERVICE ROLE auth.uid() is null, so the values passed in stand
-- untouched. That is what the engine and the item-5 sweep rely on, and it is
-- not a hole: reaching the service role already means running trusted server
-- code, which is the boundary I-8 governs.
--
-- ── DEPLOY ORDER ────────────────────────────────────────────────────────────
-- ADDITIVE — replaces one function body, adds nothing. Apply any time; no code
-- change is required, because the routes already send the correct values and
-- this only stops anyone else sending different ones.
-- ============================================================================

begin;

create or replace function public.stamp_decision_actor()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid  uuid := auth.uid();
  v_name text;
begin
  -- No session: a trusted server path (the engine under the service role, or
  -- the item-5 sweep). What it supplied stands.
  if v_uid is null then
    return new;
  end if;

  -- A session: the caller does not get to say who they are.
  new.actor_id := v_uid;

  select m.name into v_name
    from organization_members m
   where m.user_id = v_uid and m.status = 'active' and coalesce(m.name, '') <> ''
   order by m.created_at
   limit 1;

  if v_name is null then
    select m.name into v_name
      from client_members m
     where m.user_id = v_uid and m.status = 'active' and coalesce(m.name, '') <> ''
     order by m.created_at
     limit 1;
  end if;

  -- Roster wins; a nameless roster leaves the caller's value rather than
  -- blocking the decision. actor_name is NOT NULL, so it always says something.
  if v_name is not null then
    new.actor_name := v_name;
  end if;

  return new;
end;
$function$;

comment on function public.stamp_decision_actor() is
  'Batch 22. Takes a decision''s attribution from the SESSION, never the caller: actor_id := auth.uid() and actor_name := the roster name. 0038 permits assignees to insert decisions directly, so a route being careful is not a control. Service-role paths (auth.uid() null) keep what they supplied.';

commit;

-- ── VERIFY (run after apply) ────────────────────────────────────────────────
-- 1) The function is SECURITY DEFINER with a pinned search_path:
--      select prosecdef, proconfig from pg_proc where proname = 'stamp_decision_actor';
--      -- expect true, {search_path=public}
-- 2) Both triggers are still present and correctly ordered:
--      select tgname, case when tgtype & 2 = 2 then 'BEFORE' else 'AFTER' end
--        from pg_trigger where tgrelid='public.approval_decisions'::regclass
--         and not tgisinternal order by tgname;
--      -- expect approval_decisions_advance AFTER, approval_decisions_stamp_actor BEFORE
-- 3) THE BEHAVIOURAL CHECK — as a CLIENT assignee, insert a decision naming a
--    DIFFERENT real user and a false name:
--      · expect the stored row to carry actor_id = the session user and
--        actor_name = that user's roster name
--    Covered by the item-6 harness; run live before this file was committed.
