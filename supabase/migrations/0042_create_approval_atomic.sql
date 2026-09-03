-- ============================================================================
-- 0042_create_approval_atomic.sql — Batch 22 follow-up: closing the one gap
-- lib/approvals.ts documented rather than fixed.
--
-- Governing: S3-c §2 (an approval is a record), the batch brief's item 2
-- ("creates stages and assignees in the same transaction"). Runs after 0041.
-- Forward-only, idempotent.
--
-- ── THE GAP ─────────────────────────────────────────────────────────────────
-- createApproval inserted the approval, then its stages, then its assignees,
-- then the ledger row and the card — five statements, because supabase-js has
-- no client-side transactions. Failure was handled by COMPENSATING CLEANUP
-- (delete the approval; 0038's cascade takes its children), following the
-- create-client:230 precedent. That covers an error. It does not cover a
-- CRASH between the insert and the cleanup — a lambda freeze, a deploy, a
-- killed connection — which leaves an approval row with NO STAGES.
--
-- That state is the bad kind of broken: `status = 'open'` with nothing active,
-- so it has no deadline, the item-5 sweep skips it (it predicates on active
-- stages), nobody can decide on it, and it sits on the review page looking
-- like a live approval forever. Invisible, not loud.
--
-- ── SCOPE, AND WHY IT STOPS WHERE IT DOES ───────────────────────────────────
-- This function covers approval + stages + assignees. It does NOT post the
-- card or write the ledger row, and that is deliberate rather than lazy:
--
--   · the card needs room resolution, which is idempotent-by-unique-index
--     race handling that already exists in lib/messageRooms.ts (0027). Porting
--     it to SQL would be a second implementation of a thing that is correct.
--   · a missing card is VISIBLE — the approval shows on the review page
--     without one. A missing stage is not.
--   · a missing ledger row does not change behaviour.
--
-- So the engine still compensates for those two, and the state that
-- compensation cannot recover from is now impossible.
--
-- ── SECURITY INVOKER, NOT DEFINER ───────────────────────────────────────────
-- Unlike 0039/0040/0041, this function must NOT bypass RLS. Those three
-- exist because a caller legitimately lacked a privilege; this one exists
-- only for atomicity, and the authorization question is unchanged: 0038's
-- `approvals_crew_insert` and `approval_stages_crew_write` still decide.
-- A client calling this gets zero rows inserted and an error, exactly as they
-- would calling the table directly. Making it DEFINER would hand every
-- authenticated user an approval factory.
--
-- ── DEPLOY ORDER ────────────────────────────────────────────────────────────
-- ADDITIVE — one new function. Apply any time; the running deploy does not
-- call it.
-- ============================================================================

begin;

/**
 * Create an approval with its stages and assignees, atomically.
 *
 * p_stages is a jsonb ARRAY, in order; element N becomes seq N+1:
 *   [{ "name": "Client sign-off",
 *      "mode": "sequential",
 *      "assignees": [{ "user_id": null, "client_id": "...", "role": null,
 *                      "required": true }] }]
 *
 * The FIRST stage is activated with a deadline of now + p_window_hours; the
 * rest stay 'pending' with no clock, because a stage that has not started has
 * consumed none of the client's window.
 *
 * The caller resolves p_window_hours (per-approval override, else the org
 * default) and validates the subject — the polymorphism cost in S3-core §2.2
 * stays in the engine, where the error message can say which subject and why.
 */
create or replace function public.create_approval_with_stages(
  p_org                uuid,
  p_subject_kind       text,
  p_subject_id         uuid,
  p_title              text,
  p_client_id          uuid,
  p_project_id         uuid,
  p_review_window_hours int,
  p_contract_id        uuid,
  p_subject_version_id uuid,
  p_created_by         uuid,
  p_window_hours       int,
  p_stages             jsonb
)
returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare
  v_approval_id uuid;
  v_stage       jsonb;
  v_assignee    jsonb;
  v_stage_id    uuid;
  v_seq         int := 0;
begin
  if p_stages is null or jsonb_typeof(p_stages) <> 'array' or jsonb_array_length(p_stages) = 0 then
    raise exception 'create_approval_with_stages: at least one stage is required';
  end if;

  insert into approvals (
    organization_id, subject_kind, subject_id, project_id, client_id, title,
    status, review_window_hours, contract_id, subject_version_id, created_by
  ) values (
    p_org, p_subject_kind, p_subject_id, p_project_id, p_client_id, p_title,
    'open', p_review_window_hours, p_contract_id, p_subject_version_id, p_created_by
  )
  returning id into v_approval_id;

  for v_stage in select * from jsonb_array_elements(p_stages) loop
    v_seq := v_seq + 1;

    insert into approval_stages (approval_id, seq, name, mode, status, deadline_at)
    values (
      v_approval_id,
      v_seq,
      coalesce(v_stage->>'name', 'Review'),
      coalesce(v_stage->>'mode', 'sequential'),
      case when v_seq = 1 then 'active' else 'pending' end,
      case when v_seq = 1 then now() + make_interval(hours => p_window_hours) else null end
    )
    returning id into v_stage_id;

    if jsonb_typeof(v_stage->'assignees') <> 'array'
       or jsonb_array_length(v_stage->'assignees') = 0 then
      -- A stage nobody can decide on would sit active until it lapsed, which
      -- would write "no response received" about a review nobody was asked
      -- for. Refuse rather than create it.
      raise exception 'create_approval_with_stages: stage % ("%") has no assignees',
        v_seq, coalesce(v_stage->>'name', 'Review');
    end if;

    for v_assignee in select * from jsonb_array_elements(v_stage->'assignees') loop
      insert into approval_assignees (stage_id, user_id, client_id, role, required)
      values (
        v_stage_id,
        nullif(v_assignee->>'user_id', '')::uuid,
        nullif(v_assignee->>'client_id', '')::uuid,
        nullif(v_assignee->>'role', ''),
        coalesce((v_assignee->>'required')::boolean, true)
      );
    end loop;
  end loop;

  return v_approval_id;
end;
$function$;

comment on function public.create_approval_with_stages is
  'Batch 22 follow-up. Creates an approval with its stages and assignees in ONE transaction, closing the crash window that compensating cleanup could not (an approval with no stages has no deadline, is skipped by the sweep, and cannot be decided on). SECURITY INVOKER deliberately: 0038''s policies still decide who may create.';

-- A function''s EXECUTE defaults to PUBLIC. Narrow it: anon has no business
-- calling this even though RLS would refuse the insert anyway — depth, and
-- the same posture 0023 took with mark_overdue_invoices.
revoke execute on function public.create_approval_with_stages(
  uuid, text, uuid, text, uuid, uuid, int, uuid, uuid, uuid, int, jsonb) from public, anon;
grant execute on function public.create_approval_with_stages(
  uuid, text, uuid, text, uuid, uuid, int, uuid, uuid, uuid, int, jsonb) to authenticated, service_role;

commit;

-- ── VERIFY (run after apply) ────────────────────────────────────────────────
-- 1) Exists, and is INVOKER (prosecdef false) with a pinned search_path:
--      select prosecdef, proconfig from pg_proc
--       where proname = 'create_approval_with_stages';
--      -- expect false, {search_path=public}
-- 2) anon cannot execute it:
--      select has_function_privilege('anon',
--        'public.create_approval_with_stages(uuid,text,uuid,text,uuid,uuid,int,uuid,uuid,uuid,int,jsonb)',
--        'EXECUTE');
--      -- expect false
-- 3) THE BEHAVIOURAL CHECK — call it with a stage carrying an empty assignee
--    list and confirm NO approval row survives: the whole function is one
--    transaction, so the raise must roll the approval back too. That is the
--    property the compensating-cleanup version could not guarantee.
