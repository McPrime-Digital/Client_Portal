-- ============================================================================
-- 0000_baseline_schema.sql — THROUGHLINE BASELINE
-- Captured from the live McPrime portal on 2026-06-05 (Phase 0 / F1), AFTER the
-- security hardening (role→app_metadata; legacy user_metadata RLS policies dropped).
--
-- This is the repo's source-of-truth schema. Run it ONCE against a fresh Supabase
-- project (throughline-dev) to recreate the current production schema in its
-- CLEAN, SECURE state — all admin RLS via public.is_admin(); no legacy
-- user_metadata policies.
--
-- The older supabase/migrations/2026*_phaseN.sql files are historical: they are
-- already baked into THIS baseline. Do NOT re-run them on the dev project.
--
-- Parity items handled OUTSIDE this file, when their features are wired:
--   • Supabase Storage buckets: client-files, deliverables, client-uploads
--   • Realtime publication membership (alter publication supabase_realtime add table …)
--   • auth.users / app_metadata (managed by Supabase Auth)
--
-- Known drift, captured as-is (revisit during Throughline build, do not "fix" silently):
--   • files.uploaded_by (uuid, FK→auth.users) vs files.uploaded_by_id (uuid, orphan) — duplicate
--   • invoices.status CHECK allows 'partial'; lib/types/database.ts omits it AND lists
--     'draft', which the CHECK does NOT permit (code writing 'draft' would fail).
--   • tasks has approval_* / requires_approval / auto_proceeded columns absent from the TS type.
-- ============================================================================

begin;
set local check_function_bodies = off;

-- Idempotent reset (dev project only — these tables hold no data yet).
drop table if exists
  public.activity_log, public.business_settings, public.clients, public.files,
  public.invoices, public.messages, public.notifications, public.project_phases,
  public.projects, public.push_subscriptions, public.tasks cascade;

-- ===================== SEQUENCES =====================
-- Referenced by set_invoice_number(); not emitted by table DDL.
create sequence if not exists public.invoice_number_seq;

-- ===================== TABLES =====================
create table public.activity_log (
  id uuid not null default gen_random_uuid(),
  project_id uuid,
  client_id uuid,
  actor_id text,
  actor_name text not null,
  actor_role text default 'admin'::text,
  event_type text not null,
  title text not null,
  body text,
  meta jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now()
);

create table public.business_settings (
  id text not null default 'singleton'::text,
  business_name text,
  business_email text,
  business_address text,
  bank_name text,
  account_name text,
  account_number text,
  routing_number text,
  swift text,
  payment_instructions text,
  updated_at timestamp with time zone default now(),
  bank_address text,
  admin_last_seen_at timestamp with time zone,
  notification_prefs jsonb default '{}'::jsonb
);

create table public.clients (
  id uuid not null default gen_random_uuid(),
  user_id uuid,
  name text not null,
  email text not null,
  company text,
  phone text,
  avatar_url text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  notes text,
  invited_at timestamp with time zone,
  onboarded_at timestamp with time zone,
  is_active boolean default true,
  invite_count integer default 0,
  onboarding_completed_at timestamp with time zone,
  notification_prefs jsonb default '{}'::jsonb,
  welcome_dismissed_at timestamp with time zone,
  last_seen_at timestamp with time zone
);

create table public.files (
  id uuid not null default gen_random_uuid(),
  project_id uuid,
  client_id uuid,
  file_name text not null,
  file_path text not null,
  file_size bigint,
  file_type text,
  direction text not null default 'delivery'::text,
  bucket text not null default 'deliverables'::text,
  uploaded_by uuid,
  description text,
  created_at timestamp with time zone default now(),
  mime_type text,
  uploaded_by_id uuid,
  uploaded_by_role text,
  uploaded_by_name text,
  is_final boolean default false,
  version integer default 1,
  notes text,
  download_count integer default 0,
  category text,
  folder text,
  task_id uuid
);

create table public.invoices (
  id uuid not null default gen_random_uuid(),
  client_id uuid not null,
  project_id uuid,
  title text not null,
  amount numeric(10,2) not null default 0,
  status text not null default 'unpaid'::text,
  due_date date,
  paid_at timestamp with time zone,
  stripe_payment_url text,
  invoice_number text,
  notes text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  line_items jsonb default '[]'::jsonb,
  payment_method text default 'bank_transfer'::text,
  receipt_file_id uuid,
  currency text default 'USD'::text,
  receipt_status text default 'none'::text,
  receipt_uploaded_by text,
  receipt_submitted_at timestamp with time zone
);

create table public.messages (
  id uuid not null default gen_random_uuid(),
  project_id uuid,
  sender_id uuid,
  sender_role text not null,
  sender_name text not null,
  body text not null,
  read_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  attachment_url text,
  attachment_name text,
  reply_to_id uuid,
  is_deleted boolean default false,
  edited_at timestamp with time zone,
  delivered_at timestamp with time zone,
  nudged_at timestamp with time zone
);

create table public.notifications (
  id uuid not null default gen_random_uuid(),
  client_id uuid not null,
  project_id uuid,
  type text not null,
  title text not null,
  body text,
  read_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  for_admin boolean default false,
  dismissed_at timestamp with time zone
);

create table public.project_phases (
  id uuid not null default gen_random_uuid(),
  project_id uuid,
  name text not null,
  progress smallint default 0,
  is_complete boolean default false,
  sort_order smallint default 0,
  created_at timestamp with time zone default now(),
  description text
);

create table public.projects (
  id uuid not null default gen_random_uuid(),
  client_id uuid,
  title text not null,
  type text not null default 'Other'::text,
  status text not null default 'Planning'::text,
  progress smallint default 0,
  brief text,
  due_date date,
  kickoff_date date,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  stripe_payment_url text,
  invoice_amount numeric,
  deadline_notified_at timestamp with time zone,
  image_url text
);

create table public.push_subscriptions (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  role text not null default 'client'::text,
  client_id uuid,
  endpoint text not null,
  subscription jsonb not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table public.tasks (
  id uuid not null default gen_random_uuid(),
  project_id uuid,
  title text not null,
  description text,
  status text default 'pending'::text,
  priority text default 'medium'::text,
  category text default 'deliverable'::text,
  due_date date,
  completed_at timestamp with time zone,
  sort_order integer default 0,
  visible_to_client boolean default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  approved_at timestamp with time zone,
  phase_id uuid,
  requires_approval boolean default false,
  approval_status text,
  approval_note text,
  review_requested_at timestamp with time zone,
  auto_proceeded boolean default false
);

-- ===================== CONSTRAINTS =====================
-- Primary keys + uniques FIRST (so FKs below have a key to reference), then checks, then FKs.

-- primary keys
alter table public.activity_log add constraint activity_log_pkey PRIMARY KEY (id);
alter table public.business_settings add constraint business_settings_pkey PRIMARY KEY (id);
alter table public.clients add constraint clients_pkey PRIMARY KEY (id);
alter table public.files add constraint files_pkey PRIMARY KEY (id);
alter table public.invoices add constraint invoices_pkey PRIMARY KEY (id);
alter table public.messages add constraint messages_pkey PRIMARY KEY (id);
alter table public.notifications add constraint notifications_pkey PRIMARY KEY (id);
alter table public.project_phases add constraint project_phases_pkey PRIMARY KEY (id);
alter table public.projects add constraint projects_pkey PRIMARY KEY (id);
alter table public.push_subscriptions add constraint push_subscriptions_pkey PRIMARY KEY (id);
alter table public.tasks add constraint tasks_pkey PRIMARY KEY (id);

-- uniques
alter table public.clients add constraint clients_email_key UNIQUE (email);
alter table public.push_subscriptions add constraint push_subscriptions_endpoint_key UNIQUE (endpoint);

-- checks
alter table public.files add constraint files_uploaded_by_role_check CHECK ((uploaded_by_role = ANY (ARRAY['admin'::text, 'client'::text])));
alter table public.invoices add constraint invoices_status_check CHECK ((status = ANY (ARRAY['unpaid'::text, 'paid'::text, 'overdue'::text, 'partial'::text])));
alter table public.messages add constraint messages_body_check CHECK ((char_length(body) <= 5000));
alter table public.messages add constraint messages_sender_role_check CHECK ((sender_role = ANY (ARRAY['admin'::text, 'client'::text])));
alter table public.notifications add constraint notifications_type_check CHECK ((type = ANY (ARRAY['message'::text, 'file_delivered'::text, 'status_change'::text, 'invoice_created'::text, 'task_updated'::text])));
alter table public.project_phases add constraint project_phases_progress_check CHECK (((progress >= 0) AND (progress <= 100)));
alter table public.projects add constraint projects_progress_check CHECK (((progress >= 0) AND (progress <= 100)));
alter table public.tasks add constraint tasks_category_check CHECK ((category = ANY (ARRAY['deliverable'::text, 'milestone'::text, 'revision'::text, 'approval'::text, 'internal'::text])));
alter table public.tasks add constraint tasks_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'urgent'::text])));
alter table public.tasks add constraint tasks_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'review'::text, 'completed'::text, 'blocked'::text])));

-- foreign keys (after all PK/UNIQUE exist)
alter table public.activity_log add constraint activity_log_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
alter table public.activity_log add constraint activity_log_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.clients add constraint clients_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.files add constraint files_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
alter table public.files add constraint files_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.files add constraint files_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id);
alter table public.invoices add constraint invoices_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
alter table public.invoices add constraint invoices_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
alter table public.invoices add constraint invoices_receipt_file_id_fkey FOREIGN KEY (receipt_file_id) REFERENCES files(id) ON DELETE SET NULL;
alter table public.messages add constraint messages_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.messages add constraint messages_reply_to_id_fkey FOREIGN KEY (reply_to_id) REFERENCES messages(id) ON DELETE SET NULL;
alter table public.messages add constraint messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES auth.users(id);
alter table public.notifications add constraint notifications_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
alter table public.notifications add constraint notifications_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.project_phases add constraint project_phases_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.projects add constraint projects_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
alter table public.tasks add constraint tasks_phase_id_fkey FOREIGN KEY (phase_id) REFERENCES project_phases(id) ON DELETE SET NULL;
alter table public.tasks add constraint tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

-- ===================== INDEXES =====================
CREATE INDEX activity_log_project_created_idx ON public.activity_log USING btree (project_id, created_at DESC);
CREATE INDEX idx_activity_client ON public.activity_log USING btree (client_id, created_at DESC);
CREATE INDEX idx_activity_created ON public.activity_log USING btree (created_at DESC);
CREATE INDEX idx_activity_project ON public.activity_log USING btree (project_id, created_at DESC);
CREATE INDEX idx_clients_email ON public.clients USING btree (email);
CREATE UNIQUE INDEX idx_clients_user_id ON public.clients USING btree (user_id) WHERE (user_id IS NOT NULL);
CREATE INDEX idx_files_direction ON public.files USING btree (direction);
CREATE INDEX idx_files_project ON public.files USING btree (project_id, created_at DESC);
CREATE INDEX idx_files_project_id ON public.files USING btree (project_id);
CREATE INDEX idx_invoices_client ON public.invoices USING btree (client_id, status);
CREATE INDEX idx_invoices_project ON public.invoices USING btree (project_id);
CREATE INDEX idx_invoices_status ON public.invoices USING btree (status, due_date);
CREATE INDEX idx_messages_created_at ON public.messages USING btree (created_at);
CREATE INDEX idx_messages_project_id ON public.messages USING btree (project_id);
CREATE INDEX idx_messages_sender_id ON public.messages USING btree (sender_id);
CREATE INDEX messages_unread_nudge_idx ON public.messages USING btree (project_id, sender_role, created_at) WHERE ((read_at IS NULL) AND (nudged_at IS NULL));
CREATE INDEX notifications_admin_active_idx ON public.notifications USING btree (for_admin, created_at DESC) WHERE (dismissed_at IS NULL);
CREATE INDEX notifications_client_active_idx ON public.notifications USING btree (client_id, created_at DESC) WHERE (dismissed_at IS NULL);
CREATE INDEX idx_projects_client_id ON public.projects USING btree (client_id);
CREATE INDEX push_subscriptions_role_idx ON public.push_subscriptions USING btree (role);
CREATE INDEX push_subscriptions_user_idx ON public.push_subscriptions USING btree (user_id);
CREATE INDEX idx_tasks_project ON public.tasks USING btree (project_id, sort_order);
CREATE INDEX idx_tasks_status ON public.tasks USING btree (project_id, status);

-- ===================== FUNCTIONS =====================
CREATE OR REPLACE FUNCTION public.increment_download_count(file_id uuid)
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  UPDATE files SET download_count = download_count + 1 WHERE id = file_id;
$function$;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean LANGUAGE sql STABLE SET search_path TO ''
AS $function$ select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false); $function$;

CREATE OR REPLACE FUNCTION public.log_activity(p_project_id uuid, p_client_id uuid, p_actor_id uuid, p_actor_name text, p_actor_role text, p_event_type text, p_title text, p_body text DEFAULT NULL::text, p_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  INSERT INTO activity_log (project_id, client_id, actor_id, actor_name, actor_role, event_type, title, body, meta)
  VALUES (p_project_id, p_client_id, p_actor_id, p_actor_name, p_actor_role, p_event_type, p_title, p_body, p_meta);
$function$;

CREATE OR REPLACE FUNCTION public.log_activity(p_project_id uuid, p_client_id uuid, p_actor_id text, p_actor_name text, p_actor_role text, p_event_type text, p_title text, p_body text, p_meta jsonb)
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  INSERT INTO activity_log (project_id, client_id, actor_id, actor_name, actor_role, event_type, title, body, meta)
  VALUES (p_project_id, p_client_id, p_actor_id, p_actor_name, p_actor_role, p_event_type, p_title, p_body, p_meta);
$function$;

CREATE OR REPLACE FUNCTION public.mark_overdue_invoices()
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  UPDATE invoices SET status = 'overdue' WHERE status = 'unpaid' AND due_date < CURRENT_DATE;
$function$;

CREATE OR REPLACE FUNCTION public.project_completion(p_id uuid)
 RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN COUNT(*) = 0 THEN 0
    ELSE ROUND(COUNT(*) FILTER (WHERE status = 'completed') * 100.0 / COUNT(*))::INTEGER END
  FROM tasks WHERE project_id = p_id AND visible_to_client = TRUE;
$function$;

CREATE OR REPLACE FUNCTION public.set_invoice_number()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.invoice_number IS NULL THEN
    NEW.invoice_number := 'MPD-' || LPAD(nextval('invoice_number_seq')::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

-- ===================== FUNCTION HARDENING =====================
-- Default CREATE grants EXECUTE to PUBLIC (anon+authenticated inherit it). Lock the
-- SECURITY DEFINER RPCs to server-only (service_role), matching hardened prod.
do $$
declare r record;
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
    where p.proname in ('log_activity','increment_download_count','mark_overdue_invoices','project_completion')
  loop
    execute format('revoke execute on function public.%I(%s) from public, anon, authenticated', r.proname, r.args);
    execute format('grant execute on function public.%I(%s) to service_role', r.proname, r.args);
  end loop;
end $$;

-- ===================== TRIGGERS =====================
CREATE TRIGGER invoice_number_trigger BEFORE INSERT ON public.invoices FOR EACH ROW EXECUTE FUNCTION set_invoice_number();
CREATE TRIGGER tasks_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ===================== RLS ENABLE =====================
alter table public.activity_log enable row level security;
alter table public.business_settings enable row level security;
alter table public.clients enable row level security;
alter table public.files enable row level security;
alter table public.invoices enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;
alter table public.project_phases enable row level security;
alter table public.projects enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.tasks enable row level security;

-- ===================== POLICIES (clean, secure — admin via public.is_admin()) =====================
-- activity_log
create policy admin_full_activity_log on public.activity_log for ALL to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_realtime_select_activity_log on public.activity_log for SELECT to authenticated using (public.is_admin());
create policy admin_select_activity_log on public.activity_log for SELECT to authenticated using (public.is_admin());
create policy client_select_activity_log on public.activity_log for SELECT to authenticated using (
  (client_id IN (SELECT clients.id FROM clients WHERE clients.user_id = auth.uid()))
  OR (project_id IN (SELECT p.id FROM projects p JOIN clients c ON c.id = p.client_id WHERE c.user_id = auth.uid())));

-- clients
create policy admin_full_clients on public.clients for ALL to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Client can view own record" on public.clients for SELECT to public using (user_id = auth.uid());
create policy "Client can update own record" on public.clients for UPDATE to public using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy clients_read_own on public.clients for SELECT to public using (user_id = auth.uid());

-- files
create policy "Admins manage files" on public.files for ALL to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_realtime_select_files on public.files for SELECT to authenticated using (public.is_admin());
create policy "Client view own project files" on public.files for SELECT to public using (
  EXISTS (SELECT 1 FROM clients c JOIN projects p ON p.client_id = c.id WHERE c.user_id = auth.uid() AND p.id = files.project_id));
create policy clients_read_own_files on public.files for SELECT to public using (
  project_id IN (SELECT p.id FROM projects p JOIN clients c ON c.id = p.client_id WHERE c.user_id = auth.uid()));
create policy "Client insert own project files" on public.files for INSERT to public with check (
  EXISTS (SELECT 1 FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.id = files.project_id AND c.user_id = auth.uid()));
create policy "Client upload to own projects" on public.files for INSERT to public with check (
  EXISTS (SELECT 1 FROM clients c JOIN projects p ON p.client_id = c.id WHERE c.user_id = auth.uid() AND p.id = files.project_id));
create policy clients_upload_own_files on public.files for INSERT to public with check (
  (project_id IN (SELECT p.id FROM projects p JOIN clients c ON c.id = p.client_id WHERE c.user_id = auth.uid()))
  AND direction = 'client-upload'::text AND bucket = 'client-uploads'::text);

-- invoices
create policy admin_full_invoices on public.invoices for ALL to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_realtime_select_invoices on public.invoices for SELECT to authenticated using (public.is_admin());
create policy "Client view own invoices" on public.invoices for SELECT to public using (
  EXISTS (SELECT 1 FROM clients WHERE clients.id = invoices.client_id AND clients.user_id = auth.uid()));
create policy "Clients see own invoices" on public.invoices for SELECT to public using (
  client_id IN (SELECT clients.id FROM clients WHERE clients.user_id = auth.uid()));

-- messages
create policy "Admins manage messages" on public.messages for ALL to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_realtime_select_messages on public.messages for SELECT to authenticated using (public.is_admin());
create policy clients_read_own_messages on public.messages for SELECT to public using (
  project_id IN (SELECT p.id FROM projects p JOIN clients c ON c.id = p.client_id WHERE c.user_id = auth.uid()));
create policy clients_send_messages on public.messages for INSERT to public with check (
  (project_id IN (SELECT p.id FROM projects p JOIN clients c ON c.id = p.client_id WHERE c.user_id = auth.uid()))
  AND sender_role = 'client'::text AND sender_id = auth.uid());

-- notifications
create policy admin_full_notifications on public.notifications for ALL to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_realtime_select_notifications on public.notifications for SELECT to authenticated using (public.is_admin());
create policy "Clients see own notifications" on public.notifications for SELECT to public using (
  client_id IN (SELECT clients.id FROM clients WHERE clients.user_id = auth.uid()));
create policy "Clients update own notifications" on public.notifications for UPDATE to public using (
  client_id IN (SELECT clients.id FROM clients WHERE clients.user_id = auth.uid()));

-- project_phases
create policy "Admins manage phases" on public.project_phases for ALL to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_realtime_select_project_phases on public.project_phases for SELECT to authenticated using (public.is_admin());
create policy clients_read_own_phases on public.project_phases for SELECT to public using (
  project_id IN (SELECT p.id FROM projects p JOIN clients c ON c.id = p.client_id WHERE c.user_id = auth.uid()));

-- projects
create policy "Admins manage projects" on public.projects for ALL to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_realtime_select_projects on public.projects for SELECT to authenticated using (public.is_admin());
create policy clients_read_own_projects on public.projects for SELECT to public using (
  client_id IN (SELECT clients.id FROM clients WHERE clients.user_id = auth.uid()));

-- tasks
create policy admin_full_tasks on public.tasks for ALL to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_realtime_select_tasks on public.tasks for SELECT to authenticated using (public.is_admin());
create policy "Client view own project tasks" on public.tasks for SELECT to public using (
  visible_to_client = true
  AND EXISTS (SELECT 1 FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.id = tasks.project_id AND c.user_id = auth.uid()));

-- business_settings: agency-wide settings — admin only (clients have no access).
create policy admin_full_business_settings on public.business_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- push_subscriptions: each user manages only their own device subscriptions.
create policy users_manage_own_push on public.push_subscriptions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

commit;
