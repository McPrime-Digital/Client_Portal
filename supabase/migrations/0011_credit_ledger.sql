-- ============================================================================
-- 0011_credit_ledger.sql — SaaS credits: ledger + atomic charge / top-up
-- Builds on 0002 (org_credits / org_budgets / usage_events). Credits are held in
-- cents on org_credits.balance_cents; every change is journaled in credit_ledger.
-- charge_credits() is called server-side (service role) at the AI/worker boundary;
-- add_credits() is called by the Stripe webhook on a successful credit purchase.
-- Runs on throughline-dev (after 0010).
-- ============================================================================

begin;

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  delta_cents integer not null,                 -- negative = charge, positive = top-up
  reason text,                                  -- 'primeos' | 'generation' | 'topup' | ...
  ref jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists credit_ledger_org_idx on public.credit_ledger(organization_id, created_at desc);

alter table public.credit_ledger enable row level security;
drop policy if exists credit_ledger_admin_read on public.credit_ledger;
create policy credit_ledger_admin_read on public.credit_ledger for select to authenticated
  using (public.is_admin() and organization_id = public.current_org());

-- atomic charge: decrement balance + journal, returns the new balance
create or replace function public.charge_credits(p_org uuid, p_cents integer, p_reason text, p_ref jsonb default '{}'::jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare new_bal integer;
begin
  insert into public.org_credits (organization_id, balance_cents)
    values (p_org, 0) on conflict (organization_id) do nothing;
  update public.org_credits set balance_cents = balance_cents - p_cents, updated_at = now()
    where organization_id = p_org returning balance_cents into new_bal;
  insert into public.credit_ledger (organization_id, delta_cents, reason, ref)
    values (p_org, -p_cents, p_reason, coalesce(p_ref, '{}'::jsonb));
  return new_bal;
end $$;

-- atomic top-up (Stripe webhook), returns the new balance
create or replace function public.add_credits(p_org uuid, p_cents integer, p_reason text, p_ref jsonb default '{}'::jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare new_bal integer;
begin
  insert into public.org_credits (organization_id, balance_cents)
    values (p_org, 0) on conflict (organization_id) do nothing;
  update public.org_credits set balance_cents = balance_cents + p_cents, updated_at = now()
    where organization_id = p_org returning balance_cents into new_bal;
  insert into public.credit_ledger (organization_id, delta_cents, reason, ref)
    values (p_org, p_cents, p_reason, coalesce(p_ref, '{}'::jsonb));
  return new_bal;
end $$;

revoke all on function public.charge_credits(uuid, integer, text, jsonb) from public, anon, authenticated;
revoke all on function public.add_credits(uuid, integer, text, jsonb) from public, anon, authenticated;
grant execute on function public.charge_credits(uuid, integer, text, jsonb) to service_role;
grant execute on function public.add_credits(uuid, integer, text, jsonb) to service_role;

notify pgrst, 'reload schema';

commit;
