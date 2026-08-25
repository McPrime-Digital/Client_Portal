-- ============================================================================
-- 0012_memberships.sql — Teams & Roles (both sides of the house)
-- organization_members: the org's crew with differentiated roles.
-- client_members: a client company becomes a team (Owner/Approver/Member/Viewer).
-- clients.invite_policy: per-company control over who may grow the client team.
-- is_client_member(): the membership predicate future RLS pivots on.
-- Additive + idempotent. Backfills: every existing admin auth user → org owner;
-- every clients.user_id → client owner. Runs after 0011.
-- ============================================================================

begin;

-- ── org crew ────────────────────────────────────────────────────────────────
create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organizations(id) on delete cascade,
  user_id uuid unique,
  name text,
  email text not null,
  role text not null default 'member' check (role in ('owner','admin','producer','member')),
  status text not null default 'invited' check (status in ('invited','active','revoked')),
  invited_by uuid,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists organization_members_org_idx on public.organization_members(organization_id, status);

-- ── client teams ────────────────────────────────────────────────────────────
create table if not exists public.client_members (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  organization_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organizations(id) on delete cascade,
  user_id uuid,
  name text,
  email text not null,
  role text not null default 'member' check (role in ('owner','approver','member','viewer')),
  -- pending = awaiting org approval (invite_policy='approval'); invited = email sent
  status text not null default 'invited' check (status in ('pending','invited','active','revoked')),
  invited_by uuid,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (client_id, email)
);
create index if not exists client_members_client_idx on public.client_members(client_id, status);
create index if not exists client_members_user_idx on public.client_members(user_id);

-- per-company invite policy: open (owner invites freely) | approval | locked
alter table public.clients add column if not exists invite_policy text not null default 'open'
  check (invite_policy in ('open','approval','locked'));

-- ── membership predicate (future RLS pivots on this) ────────────────────────
create or replace function public.is_client_member(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.client_members m
    where m.client_id = cid and m.user_id = auth.uid() and m.status = 'active'
  ) or exists (
    select 1 from public.clients c where c.id = cid and c.user_id = auth.uid()
  )
$$;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.organization_members enable row level security;
alter table public.client_members enable row level security;

drop policy if exists organization_members_admin_all on public.organization_members;
create policy organization_members_admin_all on public.organization_members
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists organization_members_self_read on public.organization_members;
create policy organization_members_self_read on public.organization_members
  for select to authenticated using (user_id = auth.uid());

drop policy if exists client_members_admin_all on public.client_members;
create policy client_members_admin_all on public.client_members
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists client_members_team_read on public.client_members;
create policy client_members_team_read on public.client_members
  for select to authenticated using (public.is_client_member(client_id));

-- ── notifications: drop any legacy CHECK on type so member_* events insert ──
-- (same class of bug as the activity_log event_type constraint)
do $$
declare c text;
begin
  select conname into c
  from pg_constraint
  where conrelid = 'public.notifications'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%type%';
  if c is not null then
    execute format('alter table public.notifications drop constraint %I', c);
  end if;
end $$;

-- ── backfills (idempotent) ──────────────────────────────────────────────────
-- every existing admin auth user becomes an active org owner
insert into public.organization_members (organization_id, user_id, name, email, role, status, accepted_at)
select
  coalesce(nullif(u.raw_app_meta_data->>'organization_id','')::uuid, '00000000-0000-0000-0000-000000000001'),
  u.id,
  coalesce(u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
  u.email,
  'owner', 'active', now()
from auth.users u
where u.raw_app_meta_data->>'role' = 'admin'
on conflict (user_id) do nothing;

-- every existing client login becomes the active owner of its company team
insert into public.client_members (client_id, organization_id, user_id, name, email, role, status, accepted_at)
select c.id, c.organization_id, c.user_id, c.name, c.email, 'owner', 'active', now()
from public.clients c
where c.user_id is not null
on conflict (client_id, email) do nothing;

commit;
