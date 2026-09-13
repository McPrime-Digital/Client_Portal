-- ═══════════════════════════════════════════════════════════════════════════
-- 0071 · the purge, and the ledger that must survive it   (S3-core migration 11)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- S3-core §4.2 asks for a function that hard-deletes rows past their grace
-- window, with two rules: work rows go 90 days after `deleted_at`, and the
-- ACTIVITY LEDGER IS NEVER TOUCHED WITHIN 7 YEARS.
--
-- ── A LIVE DATA-LOSS DEFECT, FOUND WHILE DESIGNING THE PURGE ───────────────
--
-- `activity_log.project_id` and `activity_log.client_id` are both **ON DELETE
-- CASCADE** (migration 0001). So the ledger does not merely fail to be protected
-- from the purge — it is already being destroyed today, by a route that ships:
-- `delete-client` hard-deletes a `clients` row, and every ledger entry about
-- that company goes with it. Seven-year retention has been contradicted by a
-- foreign key since the beginning, silently, and nothing reports it because a
-- cascade is not an error.
--
-- Both are repointed to SET NULL here. The ledger row survives with its
-- `organization_id` intact — NOT NULL on all 59 live rows, verified before
-- writing this — so it stays tenant-scoped and simply becomes org-level rather
-- than project-level. `activity_log_crew_all` already reads
-- `(project_id is null or org_project_visible(project_id))`, so a nulled row is
-- visible to the org exactly as an untagged entry is. The record outlives the
-- thing it describes; that is the entire point of a record.
--
-- ── THE GUARD IS A TRIGGER, BECAUSE A CASCADE IS NOT A DELETE STATEMENT ────
--
-- "The purge must refuse to touch it" cannot be implemented by omitting the
-- table from the purge's list: the defect above IS the counterexample — nobody
-- wrote `delete from activity_log` and rows disappeared anyway. A BEFORE DELETE
-- trigger fires on cascaded deletes too, which is the only place the rule can
-- actually live.
--
-- It FAILS CLOSED: `created_at` is nullable on this table, and a row whose age
-- is unknown is protected rather than purged.
--
-- ── contract_events GAINS ONE NARROW EXCEPTION, AND IT IS REQUIRED ─────────
--
-- 0068 made the signing record immutable for everyone including the service
-- role. S3-core §4.3 requires erasure to pseudonymise denormalised names. Those
-- two cannot both hold as written, and the collision is between two things this
-- batch itself built.
--
-- Resolved narrowly: an UPDATE is permitted **only when every column except
-- `actor_name` is unchanged**. The event, the signer, the timestamp, the IP and
-- the meta stay frozen; the name may be replaced by a pseudonym. Nothing about
-- WHO acted is lost, because `signer_id` is the identity and `actor_name` is a
-- denormalised convenience. DELETE stays refused unconditionally.
--
-- ── WHAT THE PURGE DELIBERATELY DOES NOT COVER ────────────────────────────
--
-- Only §4.1's nine tables. `contracts` and `contract_events` are excluded on
-- purpose: retention for signature records is a legal-review item
-- (S-F §8 decision 2), and a 90-day default on an executed agreement would be
-- the worst possible guess. The S3-b operational tables (calendar, meetings,
-- bookings) are not in §4.1's list and are not added silently — widening a
-- spec's list is a decision, not an implementation detail.
--
-- FILES: SQL cannot delete an R2 object, so the function deletes the ROW and
-- RETURNS the bucket and path of everything it removed. The caller destroys the
-- blobs. Row-before-blob is the order `lib/fileDelete.ts` already uses and the
-- reason is in CLAUDE.md: the reverse leaves a row pointing at bytes that no
-- longer exist.
--
-- TENANT-PREDICATED, and `mark_overdue_invoices` is why. Batch 7 shipped a
-- zero-argument sweep that rewrote EVERY tenant's rows on each page view. This
-- function refuses a null organization outright.
--
-- I-12: forward-only, additive.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── the ledger outlives what it describes ──────────────────────────────────
alter table public.activity_log drop constraint if exists activity_log_project_id_fkey;
alter table public.activity_log add constraint activity_log_project_id_fkey
  foreign key (project_id) references public.projects(id) on delete set null;

alter table public.activity_log drop constraint if exists activity_log_client_id_fkey;
alter table public.activity_log add constraint activity_log_client_id_fkey
  foreign key (client_id) references public.clients(id) on delete set null;

create or replace function public.activity_log_retention()
returns trigger
language plpgsql
as $function$
begin
  -- Fails closed on an unknown age: created_at is nullable here.
  if old.created_at is null or old.created_at > now() - interval '7 years' then
    raise exception
      'activity_log is retained for 7 years (S0 §4): refusing to delete a row from %',
      coalesce(old.created_at::text, 'an unknown date')
      using errcode = 'restrict_violation';
  end if;
  return old;
end
$function$;

comment on function public.activity_log_retention() is
  'S3-core §4.2 / 0071. A BEFORE DELETE trigger rather than an omission from the '
  'purge list, because the defect this closes was a CASCADE — nobody wrote a '
  'delete statement and rows vanished anyway.';

drop trigger if exists activity_log_retention_t on public.activity_log;
create trigger activity_log_retention_t
  before delete on public.activity_log
  for each row execute function public.activity_log_retention();

-- ── the tombstone's narrow window into the signing record ──────────────────
create or replace function public.contract_events_immutable()
returns trigger
language plpgsql
as $function$
begin
  if tg_op = 'UPDATE'
     and new.id          is not distinct from old.id
     and new.contract_id is not distinct from old.contract_id
     and new.signer_id   is not distinct from old.signer_id
     and new.event       is not distinct from old.event
     and new.ip_address  is not distinct from old.ip_address
     and new.user_agent  is not distinct from old.user_agent
     and new.occurred_at is not distinct from old.occurred_at
     and new.meta        is not distinct from old.meta
  then
    -- actor_name alone changed: the AD-003 tombstone (S3-core §4.3).
    return new;
  end if;

  raise exception
    'contract_events is append-only: % is refused on the signing record (S3-b §3.5). '
    'Only actor_name may change, and only for the AD-003 tombstone.',
    tg_op
    using errcode = 'restrict_violation';
end
$function$;

-- ── the purge ──────────────────────────────────────────────────────────────
create or replace function public.purge_deleted_rows(
  p_org uuid,
  p_grace_days int default 90
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cutoff timestamptz;
  v_counts jsonb := '{}'::jsonb;
  v_files  jsonb := '[]'::jsonb;
  n bigint;
begin
  if p_org is null then
    raise exception 'purge_deleted_rows requires an organization (mark_overdue_invoices, Batch 7)'
      using errcode = 'null_value_not_allowed';
  end if;
  if p_grace_days is null or p_grace_days < 1 then
    raise exception 'purge_deleted_rows: grace must be at least 1 day, got %', p_grace_days
      using errcode = 'invalid_parameter_value';
  end if;

  v_cutoff := now() - make_interval(days => p_grace_days);

  -- FILES FIRST, and the only one whose identity is returned: the caller has to
  -- destroy the R2 object after the row is gone.
  with doomed as (
    delete from public.files
    where organization_id = p_org
      and deleted_at is not null
      and deleted_at < v_cutoff
    returning id, bucket, file_path
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'bucket', bucket, 'path', file_path)), '[]'::jsonb),
         count(*)
    into v_files, n
    from doomed;
  v_counts := v_counts || jsonb_build_object('files', n);

  delete from public.messages
   where organization_id = p_org and deleted_at is not null and deleted_at < v_cutoff;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('messages', n);

  delete from public.documents
   where organization_id = p_org and deleted_at is not null and deleted_at < v_cutoff;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('documents', n);

  delete from public.tasks
   where organization_id = p_org and deleted_at is not null and deleted_at < v_cutoff;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('tasks', n);

  delete from public.approvals
   where organization_id = p_org and deleted_at is not null and deleted_at < v_cutoff;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('approvals', n);

  delete from public.invoices
   where organization_id = p_org and deleted_at is not null and deleted_at < v_cutoff;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('invoices', n);

  delete from public.message_rooms
   where organization_id = p_org and deleted_at is not null and deleted_at < v_cutoff;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('message_rooms', n);

  -- Projects and clients LAST: both cascade widely, and both are now safe to
  -- delete only because the two activity_log FKs above became SET NULL.
  delete from public.projects
   where organization_id = p_org and deleted_at is not null and deleted_at < v_cutoff;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('projects', n);

  delete from public.clients
   where organization_id = p_org and deleted_at is not null and deleted_at < v_cutoff;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('clients', n);

  return jsonb_build_object(
    'organization_id', p_org,
    'grace_days', p_grace_days,
    'cutoff', v_cutoff,
    'purged', v_counts,
    -- The caller MUST destroy these objects; the rows are already gone.
    'r2_objects', v_files
  );
end
$function$;

comment on function public.purge_deleted_rows(uuid, int) is
  'S3-core §4.2. Hard-deletes soft-deleted rows past their grace window for ONE '
  'organization. Never touches activity_log (and could not — see '
  'activity_log_retention()). Excludes contracts: signature retention is a '
  'legal-review item, not a 90-day default. Returns the R2 objects the caller '
  'must now destroy.';

revoke all on function public.purge_deleted_rows(uuid, int) from public, anon, authenticated;

commit;

-- ── verification ───────────────────────────────────────────────────────────
-- select purge_deleted_rows(null);                      -- must raise 22004
-- delete from activity_log where id = <recent>;         -- must raise 23001
-- select purge_deleted_rows('…org…', 90);               -- all-zero on clean data
