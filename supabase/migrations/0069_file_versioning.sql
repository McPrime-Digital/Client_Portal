-- ═══════════════════════════════════════════════════════════════════════════
-- 0069 · file version stacking   (S3-core migration 9)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- S3-core §3.2: "A separate versions table would mean two places a byte can
-- live, two metering paths, and two RLS shapes. AD-004-R says one file pipeline.
-- A VERSION IS A FILE."
--
-- So this is three columns on `files`, not a new table. A version is a row
-- pointing at the stack head; the head is version 1 and points at nothing.
-- Everything downstream — review, compare, variants, approval subjects — already
-- addresses a file by id, and now asks the stack for its current.
--
-- ── THE PARTIAL UNIQUE INDEX IS THE WHOLE GUARANTEE ────────────────────────
--
-- One `is_current = true` per stack. Without it, "the current version" is a
-- question with two answers, and every surface that resolves it picks whichever
-- row its ORDER BY happened to return — so a reviewer approves v3 while the
-- vault shows v4 and neither screen is wrong.
--
-- The index is keyed on `coalesce(parent_file_id, id)`, which is the STACK KEY:
-- the head's own id for a head, the head's id for every version under it. That
-- one expression makes the head and its versions share a key without a second
-- column to keep in step.
--
-- ── A HEAD CANNOT POINT AT A VERSION ───────────────────────────────────────
--
-- Stacks are exactly two levels deep (§3.1: "a version is a files row pointing
-- at the stack head"). Nothing enforces that in a self-FK, so a trigger does:
-- if the parent itself has a parent, the write is refused. Without it the first
-- upload made against a version silently creates a three-level chain, and
-- `coalesce(parent_file_id, id)` then computes a DIFFERENT stack key for the
-- grandchild — which quietly defeats the unique index above by making the
-- grandchild its own stack.
--
-- ── APPLIED AGAINST 43 LIVE FILES ──────────────────────────────────────────
--
-- Every existing row becomes a stack head: parent NULL, version 1, current
-- true. That is what the defaults say and it is what those rows already mean —
-- there is no backfill to get wrong, which is why this is worth doing before
-- the vault holds thousands rather than after.
--
-- I-12: forward-only, additive.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

alter table public.files
  add column if not exists parent_file_id uuid references public.files(id) on delete cascade,
  add column if not exists version_no     int  not null default 1,
  add column if not exists is_current     boolean not null default true;

comment on column public.files.parent_file_id is
  'S3-core §3.1. NULL means this row is the head of a stack. A version points '
  'at the head and never at another version — enforced by files_version_depth().';
comment on column public.files.is_current is
  'Exactly one true per stack, enforced by files_one_current_per_stack_idx. '
  '"The current version" must not be a question with two answers.';

alter table public.files drop constraint if exists files_version_no_check;
alter table public.files add constraint files_version_no_check check (version_no >= 1);

-- A version must not be its own parent. The depth trigger below catches the
-- longer cycles; this catches the one a single UPDATE can create.
alter table public.files drop constraint if exists files_parent_not_self;
alter table public.files add constraint files_parent_not_self
  check (parent_file_id is null or parent_file_id <> id);

-- THE STACK KEY. coalesce(parent_file_id, id) is the head's id for every row in
-- a stack, head included.
create unique index if not exists files_one_current_per_stack_idx
  on public.files (coalesce(parent_file_id, id)) where is_current;

create index if not exists files_parent_idx
  on public.files (parent_file_id) where parent_file_id is not null;

-- ── two levels, not a chain ────────────────────────────────────────────────
create or replace function public.files_version_depth()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_grandparent uuid;
begin
  if new.parent_file_id is null then
    return new;
  end if;

  -- SECURITY DEFINER: the parent may be outside the caller's project scope
  -- (0059) while still being the right parent. A check that returns "no parent
  -- found" because of RLS would ACCEPT the write it is meant to refuse.
  select f.parent_file_id into v_grandparent
  from public.files f
  where f.id = new.parent_file_id;

  if not found then
    raise exception 'files.parent_file_id % does not exist', new.parent_file_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_grandparent is not null then
    raise exception
      'a file version must point at a stack HEAD, not at another version (% is itself a version of %)',
      new.parent_file_id, v_grandparent
      using errcode = 'check_violation';
  end if;

  return new;
end
$function$;

comment on function public.files_version_depth() is
  'S3-core §3.1 / 0069. Keeps stacks exactly two levels deep. A three-level '
  'chain would give the grandchild a different coalesce(parent_file_id, id) and '
  'so escape the one-current-per-stack index entirely.';

drop trigger if exists files_version_depth_t on public.files;
create trigger files_version_depth_t
  before insert or update of parent_file_id on public.files
  for each row execute function public.files_version_depth();

commit;

-- ── verification ───────────────────────────────────────────────────────────
-- select count(*) from files where parent_file_id is null and version_no = 1
--   and is_current;                       -- expect every pre-existing row (43)
-- -- two current versions in one stack must raise 23505.
-- -- a version pointing at a version must raise 23514.
