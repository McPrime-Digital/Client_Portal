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
