-- ============================================================================
-- 0023_overdue_predicate.sql — Batch 6 item 7: mark_overdue_invoices() gets a
-- tenant predicate.
--
-- Governing: S0 I-9 (every query against a tenant-scoped table carries an
-- explicit tenant filter). Runs after 0022. Forward-only, idempotent (I-12).
--
-- THE DEFECT. 0000:337 defined the function with no tenant predicate:
--     UPDATE invoices SET status='overdue'
--     WHERE status='unpaid' AND due_date < CURRENT_DATE
-- Any caller rewrote EVERY tenant's invoice statuses. Batch 3A inlined an
-- org-scoped replacement on the admin invoices page — but the portal invoices
-- page ((portal)/dashboard/invoices/page.tsx:32) still called the bare RPC,
-- so every CLIENT viewing their invoices swept all tenants. The paired code
-- change converts both pages to the parameterized call.
--
-- SHAPE. The zero-arg function is DROPPED, not kept alongside: leaving it
-- callable preserves the loaded gun this migration exists to melt down. The
-- replacement requires the org and refuses null.
--
-- NOT a table-shape change — no PostgREST schema-cache dependency for tables,
-- but the RPC SIGNATURE changes, so the paired deploy is still queued behind
-- this file: old code's bare rpc('mark_overdue_invoices') fails (silently —
-- its result was never checked) between apply and deploy. During that window
-- statuses simply stop flipping, which is strictly better than the current
-- behaviour of flipping them across every tenant.
-- ============================================================================

begin;

drop function if exists public.mark_overdue_invoices();

create or replace function public.mark_overdue_invoices(p_org uuid)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update invoices
     set status = 'overdue'
   where organization_id = p_org
     and p_org is not null          -- a null org must sweep nothing, not everything
     and status = 'unpaid'
     and due_date < current_date;
$$;

comment on function public.mark_overdue_invoices(uuid) is
  'Batch 6 item 7. Org-scoped lazy overdue sweep; replaces the 0000:337 zero-arg version that updated every tenant. What "overdue" means is unchanged: unpaid past due_date.';

-- Same grant posture 0000:375-385 gave the zero-arg version: service role
-- only. create function defaults EXECUTE to PUBLIC — revoke it.
revoke execute on function public.mark_overdue_invoices(uuid) from public, anon, authenticated;
grant execute on function public.mark_overdue_invoices(uuid) to service_role;

commit;
