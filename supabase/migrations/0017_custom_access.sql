-- ============================================================================
-- 0017_custom_access.sql — per-member custom access + custom role naming
-- Role = the DEFAULT capability set. extra_caps = capabilities the owner
-- granted this member on top (effective access = union). title = the custom
-- role name shown across the UI (falls back to the role's standard label).
-- Both sides of the house. Idempotent.
-- ============================================================================

begin;

alter table public.client_members add column if not exists extra_caps text[] not null default '{}';
alter table public.client_members add column if not exists title text;

alter table public.organization_members add column if not exists extra_caps text[] not null default '{}';
alter table public.organization_members add column if not exists title text;

commit;
