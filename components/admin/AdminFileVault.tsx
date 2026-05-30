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
  ChevronRight,
  Users,
  FolderOpen,
} from 'lucide-react'
import FileViewer, { type ViewerFile } from '@/components/shared/FileViewer'
import {
  categorize,
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  formatBytes,
  type FileCategory,
} from '@/lib/fileCategories'

export type AdminFileRow = {
  id: string
  project_id: string
  client_id: string
  file_name: string
  file_size: number | null
  file_type: string | null
  mime_type: string | null
  is_final: boolean
  direction: 'delivery' | 'client-upload'
  created_at: string
  client_name: string
  client_company: string | null
  project_title: string
}

const CAT_ICON: Record<FileCategory, typeof FileIcon> = {
  image: ImageIcon,
  video: Film,
  audio: Music,
  document: FileText,
  archive: Archive,
  other: FileIcon,
}

type CatFilter = 'all' | 'final' | FileCategory

function formatDate(s: string) {
  return new Date(s).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function AdminFileVault({ files }: { files: AdminFileRow[] }) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<CatFilter>('all')
  const [collapsedClients, setCollapsedClients] = useState<Set<string>>(new Set())
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<ViewerFile | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  const annotated = useMemo(
    () => files.map((f) => ({ ...f, category: categorize(f.file_name, f.mime_type || f.file_type) })),
    [files]
  )

  const filtered = annotated.filter((f) => {
    if (search && !f.file_name.toLowerCase().includes(search.toLowerCase())) return false
    if (filter === 'all') return true
    if (filter === 'final') return f.is_final
    return f.category === filter
  })

  // Group: client → project → files.
  const grouped = useMemo(() => {
    const clients = new Map<
      string,
      {
        id: string
        name: string
        company: string | null
        size: number
        count: number
        projects: Map<string, { id: string; title: string; files: typeof filtered }>
      }
    >()
    for (const f of filtered) {
      let c = clients.get(f.client_id)
      if (!c) {
        c = {
          id: f.client_id,
          name: f.client_name,
          company: f.client_company,
          size: 0,
          count: 0,
          projects: new Map(),
        }
        clients.set(f.client_id, c)
      }
      c.size += f.file_size ?? 0
      c.count += 1
      let p = c.projects.get(f.project_id)
      if (!p) {
        p = { id: f.project_id, title: f.project_title, files: [] }
        c.projects.set(f.project_id, p)
      }
      p.files.push(f)
    }
    return Array.from(clients.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [filtered])

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      all: annotated.length,
      final: annotated.filter((f) => f.is_final).length,
    }
    for (const f of annotated) c[f.category] = (c[f.category] ?? 0) + 1
    return c
  }, [annotated])

  const searching = search.length > 0 || filter !== 'all'

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

  function toggle(set: Set<string>, setter: (s: Set<string>) => void, id: string) {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setter(next)
  }

  const TABS: { key: CatFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'final', label: '⭐ Finals' },
    ...(['image', 'video', 'audio', 'document', 'archive', 'other'] as FileCategory[]).map((c) => ({
      key: c as CatFilter,
      label: CATEGORY_LABEL[c],
    })),
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">File Vault</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every file across all clients, grouped by client and project.
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

      {/* Grouped list */}
      {grouped.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card py-16">
          <FolderOpen size={28} className="text-faint" />
          <p className="text-sm text-muted-foreground">No files match this view.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.map((client) => {
            const clientOpen = searching || !collapsedClients.has(client.id)
            return (
              <div key={client.id} className="overflow-hidden rounded-xl border border-border bg-card">
                {/* Client header */}
                <button
                  onClick={() => toggle(collapsedClients, setCollapsedClients, client.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary"
                >
                  <ChevronRight
                    size={16}
                    className={`flex-shrink-0 text-muted-foreground transition-transform ${clientOpen ? 'rotate-90' : ''}`}
                  />
                  <span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Users size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">
                      {client.name}
                    </span>
                    {client.company && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {client.company}
                      </span>
                    )}
                  </span>
                  <span className="flex-shrink-0 text-xs text-muted-foreground">
                    {client.count} file{client.count === 1 ? '' : 's'} · {formatBytes(client.size)}
                  </span>
                </button>

                {/* Projects */}
                {clientOpen && (
                  <div className="border-t border-border">
                    {Array.from(client.projects.values()).map((project) => {
                      const pKey = `${client.id}:${project.id}`
                      const projOpen = searching || !collapsedProjects.has(pKey)
                      return (
                        <div key={pKey} className="border-b border-border last:border-b-0">
                          <button
                            onClick={() => toggle(collapsedProjects, setCollapsedProjects, pKey)}
                            className="flex w-full items-center gap-2 px-4 py-2.5 pl-11 text-left transition-colors hover:bg-secondary"
                          >
                            <ChevronRight
                              size={14}
                              className={`flex-shrink-0 text-faint transition-transform ${projOpen ? 'rotate-90' : ''}`}
                            />
                            <FolderOpen size={14} className="flex-shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                              {project.title}
                            </span>
                            <span className="flex-shrink-0 text-xs text-faint">
                              {project.files.length}
                            </span>
                          </button>

                          {projOpen && (
                            <div className="pb-1">
                              {project.files.map((file) => {
                                const Icon = CAT_ICON[file.category]
                                const color = CATEGORY_COLOR[file.category]
                                return (
                                  <div
                                    key={file.id}
                                    className="group flex items-center gap-3 px-4 py-2 pl-[4.5rem] transition-colors hover:bg-secondary"
                                  >
                                    <button
                                      onClick={() => setPreview(file)}
                                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                                      title="Open preview"
                                    >
                                      <span
                                        className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg"
                                        style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` }}
                                      >
                                        <Icon size={15} style={{ color }} />
                                      </span>
                                      <span className="min-w-0 flex-1">
                                        <span className="flex items-center gap-1.5">
                                          <span className="truncate text-sm text-foreground">
                                            {file.file_name}
                                          </span>
                                          {file.is_final && (
                                            <Star size={11} className="flex-shrink-0 fill-primary text-primary" />
                                          )}
                                        </span>
                                        <span className="mt-0.5 block text-xs text-muted-foreground">
                                          {formatBytes(file.file_size)} ·{' '}
                                          {file.direction === 'delivery' ? 'Delivery' : 'Client upload'} ·{' '}
                                          {formatDate(file.created_at)}
                                        </span>
                                      </span>
                                    </button>
                                    <button
                                      onClick={() => handleDownload(file)}
                                      disabled={downloadingId === file.id}
                                      className="flex-shrink-0 rounded-lg p-2 text-faint opacity-0 transition-all hover:bg-background hover:text-foreground group-hover:opacity-100 disabled:opacity-50"
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
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
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
