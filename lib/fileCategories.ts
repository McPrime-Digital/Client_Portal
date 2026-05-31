// Shared file categorization used by the client & admin File Vaults.
// Keeps the category taxonomy in one place so the two vaults (and any
// future tenant-facing views) stay consistent.

export type FileCategory =
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'archive'
  | 'receipt'
  | 'other'

const EXT: Record<string, FileCategory> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image',
  svg: 'image', avif: 'image', bmp: 'image', heic: 'image', ico: 'image',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video', mkv: 'video', avi: 'video', ogv: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', oga: 'audio', m4a: 'audio',
  aac: 'audio', flac: 'audio', opus: 'audio', weba: 'audio', amr: 'audio',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
  pdf: 'document', doc: 'document', docx: 'document', xls: 'document', xlsx: 'document',
  csv: 'document', ppt: 'document', pptx: 'document', txt: 'document', md: 'document',
  rtf: 'document', pages: 'document', numbers: 'document', key: 'document',
}

export function categorize(
  name: string | null,
  mime: string | null
): FileCategory {
  const m = (mime || '').toLowerCase()
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  if (m.includes('zip') || m.includes('compressed') || m.includes('tar')) return 'archive'
  if (
    m === 'application/pdf' ||
    m.includes('word') ||
    m.includes('sheet') ||
    m.includes('excel') ||
    m.includes('presentation') ||
    m.startsWith('text/')
  )
    return 'document'

  const ext = (name || '').includes('.')
    ? name!.split('.').pop()!.toLowerCase()
    : ''
  return EXT[ext] ?? 'other'
}

// Prefer an explicit stored category (e.g. invoices/receipts) when present,
// otherwise fall back to deriving from the file name / mime. Used by both
// File Vaults so receipts group into their own section.
const STORED: Record<string, FileCategory> = {
  receipt: 'receipt',
  invoice: 'receipt',
}
export function resolveCategory(
  stored: string | null | undefined,
  name: string | null,
  mime: string | null,
): FileCategory {
  if (stored && STORED[stored]) return STORED[stored]
  return categorize(name, mime)
}

export const CATEGORY_LABEL: Record<FileCategory, string> = {
  image: 'Images',
  video: 'Videos',
  audio: 'Audio',
  document: 'Documents',
  archive: 'Archives',
  receipt: 'Invoices & Receipts',
  other: 'Other',
}

// Tailwind token-aware accent per category (used for icon chips).
export const CATEGORY_COLOR: Record<FileCategory, string> = {
  image: 'hsl(var(--status-blue))',
  video: 'hsl(var(--primary))',
  audio: 'hsl(var(--status-violet))',
  document: 'hsl(var(--status-green))',
  archive: 'hsl(var(--destructive))',
  receipt: 'hsl(var(--primary))',
  other: 'hsl(var(--muted-foreground))',
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

// The "source" of a file — used to group the vault into folders so client
// uploads, admin deliverables and chat attachments stay distinguishable.
export type FileSource = 'delivery' | 'client' | 'chat'

export function fileSource(
  category: string | null | undefined,
  direction: string | null | undefined,
): FileSource {
  if (category === 'message') return 'chat'
  return direction === 'delivery' ? 'delivery' : 'client'
}

export const SOURCE_COLOR: Record<FileSource, string> = {
  delivery: 'hsl(var(--primary))',
  client: 'hsl(var(--status-blue))',
  chat: 'hsl(var(--status-violet))',
}

// Ordered for stable section rendering.
export const SOURCE_ORDER: FileSource[] = ['delivery', 'client', 'chat']

// ── Enterprise vault folder taxonomy ──────────────────────────────────────
// `files.folder` is the source of truth; when absent we derive a folder from
// the file's category/direction/task link so legacy rows still slot in. Both
// the admin and client vaults render the same folders for a consistent,
// SaaS-grade information architecture.
export type VaultFolder =
  | 'deliverables'
  | 'tasks'
  | 'brand'
  | 'invoices'
  | 'chat'
  | 'general'

// Stable render order (most important first).
export const VAULT_FOLDERS: VaultFolder[] = [
  'deliverables', 'tasks', 'brand', 'invoices', 'chat', 'general',
]

export const FOLDER_LABEL: Record<VaultFolder, string> = {
  deliverables: 'Deliverables',
  tasks: 'Tasks & Approvals',
  brand: 'Brand Assets',
  invoices: 'Invoices & Receipts',
  chat: 'Chat',
  general: 'General',
}

// One-line undertext shown beneath each folder header.
export const FOLDER_DESC: Record<VaultFolder, string> = {
  deliverables: 'Final files delivered by McPrime',
  tasks: 'Media shared for your review & approval',
  brand: 'Logos, guidelines & brand source files',
  invoices: 'Invoices and payment receipts',
  chat: 'Attachments shared in messages',
  general: 'Everything else',
}

export const FOLDER_COLOR: Record<VaultFolder, string> = {
  deliverables: 'hsl(var(--primary))',
  tasks: 'hsl(var(--status-amber))',
  brand: 'hsl(var(--status-violet))',
  invoices: 'hsl(var(--status-green))',
  chat: 'hsl(var(--status-blue))',
  general: 'hsl(var(--muted-foreground))',
}

// Folders a user may pick at upload time. Chat is auto-assigned (message
// attachments) and Tasks is admin-only (approval media carries a task_id),
// so neither appears in the client picker.
export const ADMIN_UPLOAD_FOLDERS: VaultFolder[] = [
  'deliverables', 'brand', 'invoices', 'general',
]
export const CLIENT_UPLOAD_FOLDERS: VaultFolder[] = [
  'brand', 'invoices', 'general',
]

// Resolve a file's vault folder. Explicit `folder` wins; otherwise derive
// from task link / category / direction so pre-taxonomy rows still group.
export function resolveFolder(opts: {
  folder?: string | null
  category?: string | null
  direction?: string | null
  taskId?: string | null
}): VaultFolder {
  const f = opts.folder
  if (f && (VAULT_FOLDERS as string[]).includes(f)) return f as VaultFolder
  if (opts.taskId) return 'tasks'
  if (opts.category === 'receipt' || opts.category === 'invoice') return 'invoices'
  if (opts.category === 'message') return 'chat'
  if (opts.direction === 'delivery') return 'deliverables'
  return 'general'
}
