-- ============================================================================
-- 0015_org_deep_roles.sql — deeper crew roles + multi-role members
-- Adds 'finance' and 'editor' to the org role set and a roles[] column so a
-- member can hold additional roles (capabilities = union of all held roles).
-- Idempotent.
-- ============================================================================

begin;

alter table public.organization_members
  add column if not exists roles text[] not null default '{}';

alter table public.organization_members
  drop constraint if exists organization_members_role_check;
alter table public.organization_members
  add constraint organization_members_role_check
  check (role in ('owner','admin','producer','finance','editor','member'));

commit;
