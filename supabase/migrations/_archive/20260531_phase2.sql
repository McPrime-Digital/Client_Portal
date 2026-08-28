-- Batch 2: phase descriptions, task approval, onboarding fields.
-- Safe to run multiple times (idempotent). Paste into Supabase → SQL Editor → Run.

-- Production phase undertext (shown beneath each phase name).
alter table public.project_phases add column if not exists description text;

-- Notifications: normalise `type` to free text so the app can use
-- message|file_delivered|status_change|invoice_created|task_updated
-- regardless of any prior enum/CHECK.
alter table public.notifications alter column type type text using type::text;

-- Client approval on shared tasks.
alter table public.tasks add column if not exists approved_at timestamptz;

-- Self-serve onboarding.
alter table public.clients add column if not exists onboarding_completed_at timestamptz;
alter table public.clients add column if not exists notification_prefs jsonb default '{}'::jsonb;

-- ── Realtime ────────────────────────────────────────────────────────────
-- Enable live updates by adding these tables to the supabase_realtime
-- publication. (Equivalent to toggling Realtime on in the Table editor.)
-- Wrapped so re-running is safe.
do $$
declare t text;
begin
  foreach t in array array['notifications','activity_log','projects','project_phases','tasks','invoices','messages','files']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
