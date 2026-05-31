export type Client = {
  id: string
  user_id: string
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
  project_id: string
  sender_id: string
  sender_role: 'admin' | 'client'
  sender_name: string
  body: string
  read_at: string | null
  delivered_at: string | null
  reply_to_id: string | null
  attachment_url: string | null
  attachment_name: string | null
  is_deleted: boolean
  edited_at: string | null
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
  status: 'draft' | 'unpaid' | 'paid' | 'overdue'
  payment_method: string | null
  line_items: InvoiceLineItem[] | null
  notes: string | null
  receipt_file_id: string | null
  stripe_payment_link: string | null
  stripe_payment_intent: string | null
  description: string | null
  due_date: string | null
  paid_at: string | null
  updated_at: string | null
  created_at: string
}

export type BusinessSettings = {
  id: string
  business_name: string | null
  business_email: string | null
  business_address: string | null
  bank_name: string | null
  account_name: string | null
  account_number: string | null
  routing_number: string | null
  swift: string | null
  payment_instructions: string | null
  updated_at: string | null
}

export type Notification = {
  id: string
  user_id: string
  type: 'new_message' | 'file_delivered' | 'task_updated' | 'invoice_issued'
  title: string
  body: string | null
  read: boolean
  link: string | null
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
