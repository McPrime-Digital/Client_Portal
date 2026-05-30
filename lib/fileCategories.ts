// Shared file categorization used by the client & admin File Vaults.
// Keeps the category taxonomy in one place so the two vaults (and any
// future tenant-facing views) stay consistent.

export type FileCategory =
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'archive'
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

export const CATEGORY_LABEL: Record<FileCategory, string> = {
  image: 'Images',
  video: 'Videos',
  audio: 'Audio',
  document: 'Documents',
  archive: 'Archives',
  other: 'Other',
}

// Tailwind token-aware accent per category (used for icon chips).
export const CATEGORY_COLOR: Record<FileCategory, string> = {
  image: 'hsl(var(--status-blue))',
  video: 'hsl(var(--primary))',
  audio: 'hsl(var(--status-violet))',
  document: 'hsl(var(--status-green))',
  archive: 'hsl(var(--destructive))',
  other: 'hsl(var(--muted-foreground))',
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}
