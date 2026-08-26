-- ============================================================================
-- 0018_tenancy_foundation.sql — S1 §7: the tenancy schema batch
--
-- Resolves the schema half of T-2, T-3 and the crew-scoping gap from
-- docs/specs/S1-tenancy-and-entitlement.md. Forward-only and idempotent
-- (I-12): every statement is guarded, and re-running is a no-op.
--
--   A1  organizations.type          — the archetype axis (S1 §4)
--   A2  clients.email               — global UNIQUE becomes per-tenant (T-2)
--   A3  business_settings           — singleton becomes per-tenant (T-3)
--   A4  organization_member_projects — crew project scoping (S1 §5.1)
--   A5  scope_mode                  — replaces the "no rows means all" footgun
--   A6  client_member_projects.organization_id — consistency with A4/0012
--
-- SHIPS WITH the code batch (B1–B4). A3 drops business_settings.id, so the
-- six call sites that read `.eq('id','singleton')` break the moment this is
-- applied. Do not apply this file without deploying the paired commits.
--
-- Do NOT touch the retired supabase/migrations/2026*_phaseN.sql series.
-- ============================================================================

begin;

-- ── A1 · archetype axis ─────────────────────────────────────────────────────
-- Which SPACES render at all: client_serving = Workspace+Client+Crew (config A),
-- internal = Client space hidden (config B), solo = minimal Crew (config C).
-- Nothing sets this to anything but the default in v1; the value is that every
-- navigation and guard decision consults it from the start (S1 §4).
alter table public.organizations
  add column if not exists type text not null default 'client_serving';

alter table public.organizations drop constraint if exists organizations_type_check;
alter table public.organizations add constraint organizations_type_check
  check (type in ('client_serving','internal','solo'));

-- AD-002-R: one US region, but the column exists from day one so a second
-- region is a deployment rather than a rewrite. Nullable by design — no
-- region is hardcoded in application logic (lib/r2.ts's region:'auto' is the
-- required literal for an R2 S3-compatible endpoint, not a residency claim).
alter table public.organizations add column if not exists region text;
update public.organizations set region = 'us-east' where region is null;


-- ── A2 · T-2 · clients.email scoped per tenant ──────────────────────────────
-- 0000:252 made this UNIQUE(email) across ALL tenants: two studios could not
-- both have a client at the same address, and create-client surfaced the
-- collision as "already exists" — disclosing another tenant's roster.
do $$
declare dupes int;
begin
  select count(*) into dupes from (
    select organization_id, lower(email)
    from public.clients
    group by organization_id, lower(email)
    having count(*) > 1
  ) d;
  if dupes > 0 then
    raise exception
      '0018 A2: % (organization_id, email) duplicate group(s) in public.clients. Resolve before applying.', dupes;
  end if;
end $$;

alter table public.clients drop constraint if exists clients_email_key;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_org_email_key' and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients add constraint clients_org_email_key unique (organization_id, email);
  end if;
end $$;


-- ── A3 · T-3 · business_settings becomes per-tenant ─────────────────────────
-- Holds tenant identity, address and BANK DETAILS. As a literal singleton
-- (id text default 'singleton'), studio two would read studio one's account
-- number. organization_id already exists from 0001:41 (not null, defaulted to
-- the sentinel org), so this only swaps the primary key and retires `id`.
--
-- Guarded on the presence of the legacy `id` column, so a second run is a
-- no-op rather than a PK churn.
do $$
declare n int;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'business_settings' and column_name = 'id'
  ) then
    select count(*) into n from public.business_settings;
    if n <> 1 then
      raise exception
        '0018 A3: public.business_settings has % row(s), expected exactly 1. STOP — resolve manually.', n;
    end if;

    -- defensive: the column is already NOT NULL DEFAULT sentinel from 0001,
    -- so this matches nothing. Kept so the intent survives if that changes.
    update public.business_settings
       set organization_id = '00000000-0000-0000-0000-000000000001'
     where organization_id is null;

    alter table public.business_settings alter column organization_id set not null;
    alter table public.business_settings drop constraint if exists business_settings_pkey;
    alter table public.business_settings add primary key (organization_id);
    alter table public.business_settings drop column id;
  end if;
end $$;


-- ── A4 · crew project scoping ───────────────────────────────────────────────
-- organization_members had no project scoping while client_members did. A
-- freelance editor should see one production, not the whole studio (S1 §5.1).
create table if not exists public.organization_member_projects (
  member_id       uuid not null references public.organization_members(id) on delete cascade,
  project_id      uuid not null references public.projects(id) on delete cascade,
  organization_id uuid not null default '00000000-0000-0000-0000-000000000001'
                    references public.organizations(id),
  created_at      timestamptz not null default now(),
  primary key (member_id, project_id)
);

-- Defensive: brings the column in if an earlier draft of this file was ever
-- partially applied (create table if not exists would skip the column above).
alter table public.organization_member_projects
  add column if not exists organization_id uuid not null
  default '00000000-0000-0000-0000-000000000001' references public.organizations(id);

create index if not exists organization_member_projects_project_idx
  on public.organization_member_projects(project_id);
create index if not exists organization_member_projects_org_idx
  on public.organization_member_projects(organization_id);

alter table public.organization_member_projects enable row level security;

-- Mirrors client_member_projects (0013:27,35) but WITH the organization_id
-- predicate those two policies lack — is_admin() alone would let any admin of
-- any org read every org's scoping rows the moment a second tenant exists
-- (S1 §6 fix 1). The column is on the row, so no correlated subquery is needed
-- and the org_idx above can serve the predicate.
drop policy if exists organization_member_projects_admin_all on public.organization_member_projects;
create policy organization_member_projects_admin_all on public.organization_member_projects
  for all to authenticated
  using (public.is_admin() and organization_id = public.current_org())
  with check (public.is_admin() and organization_id = public.current_org());

-- SELF read, not org-wide read: the subquery is what makes this "my own
-- scoping rows" rather than "every crew member's". It mirrors
-- organization_members_self_read (0012:73). Only the org half of the old
-- subquery is replaced by the column — dropping the user_id half as well would
-- let any crew member enumerate every colleague's project assignments.
drop policy if exists organization_member_projects_self_read on public.organization_member_projects;
create policy organization_member_projects_self_read on public.organization_member_projects
  for select to authenticated
  using (
    organization_id = public.current_org()
    and exists (
      select 1 from public.organization_members m
      where m.id = member_id and m.user_id = auth.uid()
    )
  );

-- Realtime: membership tables must be in the publication or roster
-- subscriptions never fire. Mirrors 0013's handling of client_member_projects.
do $$ begin
  alter publication supabase_realtime add table public.organization_member_projects;
exception when duplicate_object then null; end $$;


-- ── A5 · explicit scope mode ────────────────────────────────────────────────
-- Replaces "no rows means all projects; any rows means only those" — under
-- which a bulk delete of the scoping rows SILENTLY GRANTS full access. Scope
-- is now stated, not inferred: 'selected' with zero rows means zero projects.
--
-- The backfill runs only on the pass that adds the column, so a re-run can
-- never reclassify a member an owner has since set back to 'all'.
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'client_members' and column_name = 'scope_mode'
  ) then
    alter table public.client_members add column scope_mode text not null default 'all';
    update public.client_members m
       set scope_mode = 'selected'
     where exists (select 1 from public.client_member_projects p where p.member_id = m.id);
  end if;
end $$;

alter table public.client_members drop constraint if exists client_members_scope_mode_check;
alter table public.client_members add constraint client_members_scope_mode_check
  check (scope_mode in ('all','selected'));

-- Crew side: organization_member_projects is created empty in A4 above, so
-- there is nothing to backfill and every existing member correctly stays 'all'.
alter table public.organization_members
  add column if not exists scope_mode text not null default 'all';

alter table public.organization_members drop constraint if exists organization_members_scope_mode_check;
alter table public.organization_members add constraint organization_members_scope_mode_check
  check (scope_mode in ('all','selected'));


-- ── A6 · client_member_projects.organization_id ─────────────────────────────
-- Consistency with organization_members / client_members (0012), and the
-- column an org predicate on this table's policies would need.
alter table public.client_member_projects
  add column if not exists organization_id uuid references public.organizations(id);

update public.client_member_projects p
   set organization_id = m.organization_id
  from public.client_members m
 where m.id = p.member_id
   and p.organization_id is distinct from m.organization_id;

alter table public.client_member_projects
  alter column organization_id set default '00000000-0000-0000-0000-000000000001';
alter table public.client_member_projects
  alter column organization_id set not null;

create index if not exists client_member_projects_org_idx
  on public.client_member_projects(organization_id);

commit;
