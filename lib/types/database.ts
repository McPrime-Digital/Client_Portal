export type Organization = {
  id: string
  name: string
  subdomain: string | null
  logo_url: string | null
  branding: Record<string, unknown>
  plan: string
  created_at: string
  updated_at: string
}

export type Client = {
  id: string
  // user_id is gone — retired by migration 0026. A company's people are its
  // client_members rows (S1 §5.2); resolve them with lib/team.ts, never from
  // a column on the company.
  organization_id: string
  name: string
  email: string
  company: string | null
  phone: string | null
  avatar_url: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type Project = {
  id: string
  client_id: string
  title: string
  type: 'Brand Film' | 'Social Content' | 'AI Automation' | 'Commercial' | 'Other'
  status: 'Planning' | 'Pre-Production' | 'In Production' | 'In Review' | 'Revisions' | 'Completed' | 'On Hold'
  progress: number
  brief: string | null
  due_date: string | null
  kickoff_date: string | null
  created_at: string
  updated_at: string
}

export type ProjectPhase = {
  id: string
  project_id: string
  name: string
  description: string | null
  progress: number
  is_complete: boolean
  sort_order: number
  created_at: string
}

export type FileRecord = {
  id: string
  project_id: string | null
  client_id: string
  file_name: string
  file_path: string
  file_size: number | null
  file_type: string | null
  mime_type: string | null
  direction: 'delivery' | 'client-upload'
  // 'r2' marks Cloudflare R2 objects (admin deliverables); the others are Supabase Storage buckets.
  bucket: 'deliverables' | 'client-uploads' | 'r2'
  is_final: boolean
  // Explicit category override (e.g. 'receipt', 'invoice'); null = derive
  // from the file name / mime type. See lib/fileCategories.ts.
  category: string | null
  uploaded_by: string | null
  uploaded_by_role: string | null
  uploaded_by_name: string | null
  description: string | null
  created_at: string
}

export type Message = {
  id: string
  // Nullable through the Batch 13 transition: rows predating the 0029
  // backfill carry null until it runs; 0030 sets NOT NULL and this tightens.
  room_id: string | null
  project_id: string
  sender_id: string
  sender_role: 'admin' | 'client'
  sender_name: string
  body: string
  read_at: string | null
  delivered_at: string | null
  reply_to_id: string | null
  thread_root_id: string | null
  attachment_url: string | null
  attachment_name: string | null
  attachment_file_id?: string | null
  is_deleted: boolean
  edited_at: string | null
  deleted_at: string | null
  created_at: string
}

export type Task = {
  id: string
  project_id: string
  title: string
  description: string | null
  status: string
  priority: string
  category: string
  due_date: string | null
  completed_at: string | null
  approved_at: string | null
  sort_order: number
  visible_to_client: boolean
  created_at: string
  updated_at: string
}

export type InvoiceLineItem = {
  description: string
  quantity: number
  unit_price: number
  total: number
}

export type Invoice = {
  id: string
  project_id: string | null
  client_id: string
  invoice_number: string
  title: string | null
  amount: number
  currency: string
  // The full set permitted by invoices_status_check (0019). 'partial' was
  // missing here while the DB has always allowed it; 'draft' was declared here
  // while the DB rejected it until 0019.
  status: 'draft' | 'unpaid' | 'paid' | 'overdue' | 'partial'
  payment_method: string | null
  line_items: InvoiceLineItem[] | null
  notes: string | null
  receipt_file_id: string | null
  stripe_payment_url: string | null
  due_date: string | null
  paid_at: string | null
  updated_at: string | null
  created_at: string
}

// Per-tenant since migration 0018 (T-3): keyed by organization_id, and the
// legacy `id text default 'singleton'` column is gone. Read and written only
// through lib/businessSettings.ts.
export type BusinessSettings = {
  organization_id: string
  business_name: string | null
  business_email: string | null
  business_address: string | null
  bank_name: string | null
  bank_address: string | null
  account_name: string | null
  account_number: string | null
  routing_number: string | null
  swift: string | null
  payment_instructions: string | null
  admin_last_seen_at: string | null
  notification_prefs: Record<string, unknown> | null
  updated_at: string | null
}

export type Notification = {
  id: string
  client_id: string | null
  project_id: string | null
  // Free text in the DB; the bell maps these to icons/colours.
  type: 'message' | 'file_delivered' | 'status_change' | 'invoice_created' | 'task_updated'
  title: string
  body: string | null
  read_at: string | null
  for_admin: boolean
  created_at: string
}

// Extended types with joined data (used in UI)
export type ProjectWithClient = Project & {
  clients: Client
}

export type FileWithProject = FileRecord & {
  projects: Project
}

export type MessageWithSender = Message & {
  sender: { name: string; avatar_url: string | null }
}

export type InvoiceWithProject = Invoice & {
  projects: Project
}
