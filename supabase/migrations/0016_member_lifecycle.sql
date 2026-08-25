-- ============================================================================
-- 0016_member_lifecycle.sql — pause/resume + permanent deletion (both sides)
-- 'paused': owner holds a member's access, reinstatable later.
-- Deletion is forever: the auth account itself is removed — no portal, no
-- Throughline, nothing. Also purges everyone previously 'revoked' (the old
-- soft state): their auth users are deleted (when not used elsewhere) and
-- their member rows removed. Idempotent.
-- ============================================================================

begin;

alter table public.client_members drop constraint if exists client_members_status_check;
alter table public.client_members add constraint client_members_status_check
  check (status in ('pending','invited','active','paused','revoked'));

alter table public.organization_members drop constraint if exists organization_members_status_check;
alter table public.organization_members add constraint organization_members_status_check
  check (status in ('invited','active','paused','revoked'));

-- ── deleting a PERSON must never delete the WORK ────────────────────────────
-- Every public-table FK onto auth.users becomes ON DELETE SET NULL (the rows
-- keep their stored display names), except device subscriptions which follow
-- their user. Without this, deleting any member who ever sent a message fails.
do $$
declare r record;
begin
  for r in
    select con.conname, rel.relname, att.attname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    cross join lateral unnest(con.conkey) as k(attnum)
    join pg_attribute att on att.attrelid = rel.oid and att.attnum = k.attnum
    where con.contype = 'f'
      and con.confrelid = 'auth.users'::regclass
      and nsp.nspname = 'public'
  loop
    execute format('alter table public.%I drop constraint %I', r.relname, r.conname);
    if r.relname = 'push_subscriptions' then
      execute format(
        'alter table public.%I add constraint %I foreign key (%I) references auth.users(id) on delete cascade',
        r.relname, r.conname, r.attname);
    else
      execute format('alter table public.%I alter column %I drop not null', r.relname, r.attname);
      execute format(
        'alter table public.%I add constraint %I foreign key (%I) references auth.users(id) on delete set null',
        r.relname, r.conname, r.attname);
    end if;
  end loop;
end $$;

-- ── purge: previously revoked members are deleted for good ──────────────────
-- Delete the auth account only when that user id isn't a company primary
-- login and holds no non-revoked membership anywhere.
delete from auth.users u
where u.id in (
    select m.user_id from public.client_members m where m.status = 'revoked' and m.user_id is not null
    union
    select m.user_id from public.organization_members m where m.status = 'revoked' and m.user_id is not null
  )
  and not exists (select 1 from public.clients c where c.user_id = u.id)
  and not exists (select 1 from public.client_members m2 where m2.user_id = u.id and m2.status <> 'revoked')
  and not exists (select 1 from public.organization_members m3 where m3.user_id = u.id and m3.status <> 'revoked');

delete from public.client_members where status = 'revoked';
delete from public.organization_members where status = 'revoked';

commit;
