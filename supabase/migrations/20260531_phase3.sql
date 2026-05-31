-- Batch 3: invoice currency fix, phase-based tasks + approvals, vault
-- folders, admin notifications, deadline alerts. Idempotent — run once.

-- ── invoices: missing currency column (fixes "currency not in schema cache")
alter table public.invoices add column if not exists currency text default 'USD';

-- ── tasks: group under a phase + client approval workflow ────────────────
alter table public.tasks add column if not exists phase_id uuid;
alter table public.tasks add column if not exists requires_approval boolean default false;
alter table public.tasks add column if not exists approval_status text; -- pending|approved|changes_requested
alter table public.tasks add column if not exists approval_note text;
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'tasks_phase_id_fkey'
  ) then
    alter table public.tasks
      add constraint tasks_phase_id_fkey
      foreign key (phase_id) references public.project_phases(id) on delete set null;
  end if;
end $$;

-- ── files: folder taxonomy + link approval media to a task ──────────────
alter table public.files add column if not exists folder text;
alter table public.files add column if not exists task_id uuid;

-- ── notifications: admin-facing stream (bell for admins) ────────────────
alter table public.notifications add column if not exists for_admin boolean default false;

-- ── projects: dedupe deadline alerts ────────────────────────────────────
alter table public.projects add column if not exists deadline_notified_at timestamptz;
