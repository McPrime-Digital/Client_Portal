'use client'

import { useMemo, useState } from 'react'
import {
  Image as ImageIcon,
  Film,
  Music,
  FileText,
  Archive,
  File as FileIcon,
  Download,
  Search,
  Star,
  Loader2,
  FolderOpen,
  Receipt,
} from 'lucide-react'
import FileViewer, { type ViewerFile } from '@/components/shared/FileViewer'
import {
  resolveCategory,
  CATEGORY_COLOR,
  formatBytes,
  resolveFolder,
  FOLDER_LABEL,
  FOLDER_DESC,
  FOLDER_COLOR,
  VAULT_FOLDERS,
  type FileCategory,
} from '@/lib/fileCategories'

type FileRow = {
  id: string
  project_id: string | null
  file_name: string
  file_size: number | null
  file_type: string | null
  mime_type: string | null
  category: string | null
  is_final: boolean
  direction: 'delivery' | 'client-upload'
  folder: string | null
  task_id: string | null
  created_at: string
}

type Props = {
  files: FileRow[]
  projects: { id: string; title: string }[]
}

const CAT_ICON: Record<FileCategory, typeof FileIcon> = {
  image: ImageIcon,
  video: Film,
  audio: Music,
  document: FileText,
  archive: Archive,
  receipt: Receipt,
  other: FileIcon,
}

type FilterKey = 'all' | 'final' | FileCategory

function formatDate(s: string) {
  return new Date(s).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function AllFilesVault({ files, projects }: Props) {
  const [filter, setFilter] = useState<FilterKey>('all')
  const [projectId, setProjectId] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [preview, setPreview] = useState<ViewerFile | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  const projectName = useMemo(() => {
    const m = new Map(projects.map((p) => [p.id, p.title]))
    return (id: string | null) => (id ? m.get(id) ?? 'Project' : 'No project')
  }, [projects])

  // Annotate once with vault folder (for grouping) and type category (for
  // filtering/counts). Resolve folder from the raw stored fields before
  // category is overwritten with the resolved display type.
  const annotated = useMemo(
    () => files.map((f) => ({
      ...f,
      folder: resolveFolder({ folder: f.folder, category: f.category, direction: f.direction, taskId: f.task_id }),
      category: resolveCategory(f.category, f.file_name, f.mime_type || f.file_type),
    })),
    [files]
  )

  const visible = annotated.filter((f) => {
    if (projectId !== 'all' && f.project_id !== projectId) return false
    if (search && !f.file_name.toLowerCase().includes(search.toLowerCase())) return false
    if (filter === 'all') return true
    if (filter === 'final') return f.is_final
    return f.category === filter
  })

  const counts = useMemo(() => {
    const scoped = annotated.filter(
      (f) => projectId === 'all' || f.project_id === projectId
    )
    const c: Record<string, number> = {
      all: scoped.length,
      final: scoped.filter((f) => f.is_final).length,
    }
    for (const f of scoped) c[f.category] = (c[f.category] ?? 0) + 1
    return c
  }, [annotated, projectId])

  const totalSize = visible.reduce((a, f) => a + (f.file_size ?? 0), 0)

  async function handleDownload(file: { id: string; file_name: string }) {
    setDownloadingId(file.id)
    try {
      const res = await fetch('/api/files/signed-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: file.id }),
      })
      const { signedUrl, error } = await res.json()
      if (error) throw new Error(error)
      const a = document.createElement('a')
      a.href = signedUrl
      a.download = file.file_name
      a.target = '_blank'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch (err) {
      console.error('Download error:', err)
    } finally {
      setDownloadingId(null)
    }
  }

  const TABS: { key: FilterKey; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'final', label: '⭐ Finals' },
    { key: 'image', label: 'Images' },
    { key: 'video', label: 'Videos' },
    { key: 'audio', label: 'Audio' },
    { key: 'document', label: 'Documents' },
    { key: 'archive', label: 'Archives' },
    { key: 'receipt', label: 'Invoices & Receipts' },
    { key: 'other', label: 'Other' },
  ]

  return (
    <div className="space-y-6 w-full">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">File Vault</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            All your deliverables and shared files, in one place.
          </p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{annotated.length}</span> files ·{' '}
          {formatBytes(annotated.reduce((a, f) => a + (f.file_size ?? 0), 0))}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search files…"
            className="w-full rounded-lg border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
          />
        </div>
        {projects.length > 1 && (
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
          >
            <option value="all">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-1.5">
        {TABS.map(({ key, label }) => {
          const count = counts[key] ?? 0
          if (count === 0 && key !== 'all') return null
          const active = filter === key
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              {label} {count}
            </button>
          )
        })}
      </div>

      {/* Files */}
      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card py-16">
          <FolderOpen size={28} className="text-faint" />
          <p className="text-sm text-muted-foreground">No files match this view.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {VAULT_FOLDERS.map((folder) => {
            const group = visible.filter((f) => f.folder === folder)
            if (group.length === 0) return null
            return (
              <div key={folder}>
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: FOLDER_COLOR[folder] }} />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-faint">
                    {FOLDER_LABEL[folder]}
                  </h3>
                  <span className="text-[11px] text-faint">({group.length})</span>
                  <span className="text-[11px] text-faint hidden sm:inline">· {FOLDER_DESC[folder]}</span>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {group.map((file) => {
                    const Icon = CAT_ICON[file.category]
                    const color = CATEGORY_COLOR[file.category]
                    return (
                      <div
                        key={file.id}
                        className="group relative flex items-center gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-ring/40"
                      >
                        <button
                          onClick={() => setPreview(file)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          title="Open preview"
                        >
                          <span
                            className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-lg"
                            style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` }}
                          >
                            <Icon size={18} style={{ color }} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium text-foreground">
                                {file.file_name}
                              </span>
                              {file.is_final && (
                                <Star size={11} className="flex-shrink-0 fill-primary text-primary" />
                              )}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              {formatBytes(file.file_size)} · {projectName(file.project_id)} ·{' '}
                              {formatDate(file.created_at)}
                            </span>
                          </span>
                        </button>
                        <button
                          onClick={() => handleDownload(file)}
                          disabled={downloadingId === file.id}
                          className="flex-shrink-0 rounded-lg p-2 text-faint opacity-0 transition-all hover:bg-secondary hover:text-foreground group-hover:opacity-100 disabled:opacity-50"
                          title="Download"
                        >
                          {downloadingId === file.id ? (
                            <Loader2 size={15} className="animate-spin" />
                          ) : (
                            <Download size={15} />
                          )}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
          <p className="text-xs text-faint">{formatBytes(totalSize)} shown</p>
        </div>
      )}

      {preview && (
        <FileViewer
          key={preview.id}
          file={preview}
          onClose={() => setPreview(null)}
          onDownload={() => handleDownload(preview)}
        />
      )}
    </div>
  )
}
