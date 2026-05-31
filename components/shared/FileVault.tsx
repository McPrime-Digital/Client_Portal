'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { uploadFileToR2 } from '@/lib/uploadClient'
import {
  Upload,
  Film,
  Image as ImageIcon,
  FileText,
  Music,
  Archive,
  Download,
  Trash2,
  Eye,
  Star,
  StarOff,
  Loader2,
  CheckCircle,
  XCircle,
  FolderOpen,
  ChevronDown,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import FileViewer, { type ViewerFile } from './FileViewer'
import {
  resolveFolder,
  FOLDER_LABEL,
  FOLDER_DESC,
  FOLDER_COLOR,
  VAULT_FOLDERS,
  ADMIN_UPLOAD_FOLDERS,
  CLIENT_UPLOAD_FOLDERS,
  type VaultFolder,
} from '@/lib/fileCategories'

type FileRecord = {
  id: string
  file_name: string
  file_path: string
  file_size: number | null
  file_type: string | null
  mime_type: string | null
  is_final: boolean
  bucket: string
  uploaded_by_role: string | null
  description: string | null
  created_at: string
  folder?: string | null
  category?: string | null
  direction?: string | null
  task_id?: string | null
}

// mime_type can be null on legacy rows — fall back to file_type.
function fileMime(f: FileRecord): string {
  return f.mime_type || f.file_type || ''
}

function folderOf(f: FileRecord): VaultFolder {
  return resolveFolder({
    folder: f.folder,
    category: f.category,
    direction: f.direction,
    taskId: f.task_id,
  })
}

type Props = {
  projectId: string
  clientId: string
  userId: string
  userRole: 'admin' | 'client'
  userName: string
  initialFiles: FileRecord[]
}

const FILE_ICONS: Record<string, any> = {
  video: Film,
  image: ImageIcon,
  audio: Music,
  archive: Archive,
  document: FileText,
}

const FILE_COLORS: Record<string, string> = {
  video: 'hsl(var(--primary))',
  image: 'hsl(var(--status-blue))',
  audio: 'hsl(var(--status-violet))',
  archive: 'hsl(var(--destructive))',
  document: 'hsl(var(--status-green))',
}

function getFileType(mime: string): string {
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.includes('zip') || mime.includes('compressed')) return 'archive'
  return 'document'
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

type UploadProgress = {
  id: string
  fileName: string
  progress: number
  status: 'uploading' | 'success' | 'error'
  error?: string
}

export default function FileVault({
  projectId,
  clientId,
  userId,
  userRole,
  userName,
  initialFiles,
}: Props) {
  const supabase = createClient()
  const [files, setFiles] = useState<FileRecord[]>(initialFiles)
  const [isDragging, setIsDragging] = useState(false)
  const [uploads, setUploads] = useState<UploadProgress[]>([])
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [previewFile, setPreviewFile] = useState<FileRecord | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  // The folder new uploads land in. Admins default to Deliverables, clients
  // to General (clients can't write Deliverables/Tasks/Chat from here).
  const pickableFolders = userRole === 'admin' ? ADMIN_UPLOAD_FOLDERS : CLIENT_UPLOAD_FOLDERS
  const [targetFolder, setTargetFolder] = useState<VaultFolder>(
    userRole === 'admin' ? 'deliverables' : 'general'
  )

  const dropRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Realtime — new/removed files from other users
  useEffect(() => {
    const channel = supabase
      .channel(`files:${projectId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'files', filter: `project_id=eq.${projectId}` },
        (payload) => {
          const newFile = payload.new as FileRecord
          setFiles((prev) => (prev.some((f) => f.id === newFile.id) ? prev : [newFile, ...prev]))
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'files', filter: `project_id=eq.${projectId}` },
        (payload) => setFiles((prev) => prev.filter((f) => f.id !== payload.old.id))
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [projectId])

  // ── Upload: direct browser → R2 (Vercel-safe, no body-size limit) ──
  const doUpload = useCallback(
    async (fileList: FileList | File[]) => {
      const arr = Array.from(fileList)
      for (const file of arr) {
        const id = `u-${Date.now()}-${Math.random()}`
        setUploads((p) => [...p, { id, fileName: file.name, progress: 0, status: 'uploading' }])
        try {
          const uploaded = await uploadFileToR2({
            file,
            projectId,
            clientId,
            direction: userRole === 'admin' ? 'delivery' : 'client-upload',
            folder: targetFolder,
            isFinal: userRole === 'admin' && targetFolder === 'deliverables',
            onProgress: (pct) =>
              setUploads((p) => p.map((u) => (u.id === id ? { ...u, progress: pct } : u))),
          })
          setUploads((p) => p.map((u) => (u.id === id ? { ...u, progress: 100, status: 'success' } : u)))
          setFiles((prev) =>
            prev.some((f) => f.id === (uploaded as any).id) ? prev : [uploaded as any, ...prev]
          )
          setTimeout(() => setUploads((p) => p.filter((u) => u.id !== id)), 2500)
        } catch (err: any) {
          setUploads((p) =>
            p.map((u) => (u.id === id ? { ...u, status: 'error', error: err.message ?? 'Upload failed' } : u))
          )
          setTimeout(() => setUploads((p) => p.filter((u) => u.id !== id)), 5000)
        }
      }
    },
    [projectId, clientId, userRole, targetFolder]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      if (e.dataTransfer.files.length) await doUpload(e.dataTransfer.files)
    },
    [doUpload]
  )
  const handleFileInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) await doUpload(e.target.files)
      e.target.value = ''
    },
    [doUpload]
  )

  // Download via signed URL
  async function handleDownload(file: ViewerFile) {
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

  // Delete (admin only)
  async function handleDelete(file: FileRecord) {
    if (!confirm(`Delete "${file.file_name}"? This cannot be undone.`)) return
    setDeletingId(file.id)
    try {
      const res = await fetch(`/api/files/${file.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Delete failed')
      }
      setFiles((prev) => prev.filter((f) => f.id !== file.id))
    } catch (err) {
      console.error('Delete error:', err)
    } finally {
      setDeletingId(null)
    }
  }

  const totalSize = files.reduce((acc, f) => acc + (f.file_size ?? 0), 0)

  // Group files into vault folders, rendered in canonical order.
  const grouped = VAULT_FOLDERS.map((folder) => ({
    folder,
    items: files.filter((f) => folderOf(f) === folder),
  })).filter((g) => g.items.length > 0)

  function renderCard(file: FileRecord) {
    const fileType = getFileType(fileMime(file))
    const Icon = FILE_ICONS[fileType] ?? FileText
    const iconColor = FILE_COLORS[fileType] ?? 'hsl(var(--muted-foreground))'
    return (
      <div
        key={file.id}
        className="flex items-center gap-3 p-3 rounded-xl group transition-colors hover:border-ring/40"
        style={{
          backgroundColor: 'hsl(var(--card))',
          border: file.is_final ? '1px solid hsl(var(--primary) / 0.2)' : '1px solid hsl(var(--border))',
        }}
      >
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `color-mix(in srgb, ${iconColor} 9%, transparent)` }}
        >
          <Icon size={18} style={{ color: iconColor }} />
        </div>

        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setPreviewFile(file)} title="Open preview">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold truncate" style={{ color: 'hsl(var(--foreground))' }}>
              {file.file_name}
            </p>
            {file.is_final && (
              <span
                className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: 'hsl(var(--primary) / 0.12)', color: 'hsl(var(--primary))' }}
              >
                <Star size={9} />
                FINAL
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
              {formatBytes(file.file_size ?? 0)}
            </span>
            <span className="text-xs" style={{ color: 'hsl(var(--text-faint))' }}>
              {formatDate(file.created_at)}
            </span>
            <span className="text-xs" style={{ color: 'hsl(var(--text-faint))' }}>
              {file.uploaded_by_role === 'admin' ? 'McPrime' : file.uploaded_by_role}
            </span>
          </div>
          {file.description && (
            <p className="text-xs mt-1" style={{ color: 'hsl(var(--muted-foreground))' }}>
              {file.description}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => setPreviewFile(file)}
            className="p-2 rounded-lg transition-colors text-faint hover:text-foreground hover:bg-secondary"
            title="Preview"
          >
            <Eye size={15} />
          </button>
          <button
            onClick={() => handleDownload(file)}
            disabled={downloadingId === file.id}
            className="p-2 rounded-lg transition-colors disabled:opacity-50 text-faint hover:text-foreground hover:bg-secondary"
            title="Download"
          >
            {downloadingId === file.id ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          </button>
          {userRole === 'admin' && (
            <button
              onClick={() => handleDelete(file)}
              disabled={deletingId === file.id}
              className="p-2 rounded-lg transition-colors disabled:opacity-50 text-faint hover:text-destructive hover:bg-destructive/10"
              title="Delete"
            >
              {deletingId === file.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Upload zone */}
      <div
        ref={dropRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className="relative rounded-2xl transition-all cursor-pointer"
        style={{
          border: isDragging ? '2px dashed hsl(var(--primary))' : '2px dashed hsl(var(--border))',
          backgroundColor: isDragging ? 'hsl(var(--primary) / 0.04)' : 'hsl(var(--card))',
          padding: '2rem',
        }}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          accept="video/*,image/*,audio/*,.pdf,.doc,.docx,.txt,.zip,.ai,.psd,.fig"
          onChange={handleFileInput}
        />

        <div className="flex flex-col items-center gap-3">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center transition-all"
            style={{ backgroundColor: isDragging ? 'hsl(var(--primary) / 0.15)' : 'hsl(var(--secondary))' }}
          >
            <Upload size={22} style={{ color: isDragging ? 'hsl(var(--primary))' : 'hsl(var(--text-faint))' }} />
          </div>
          <div className="text-center">
            <p
              className="text-sm font-semibold"
              style={{ color: isDragging ? 'hsl(var(--primary))' : 'hsl(var(--foreground))' }}
            >
              {isDragging ? 'Drop files here' : 'Drag & drop files'}
            </p>
            <p className="text-xs mt-1" style={{ color: 'hsl(var(--muted-foreground))' }}>
              or click to browse · uploads land in{' '}
              <span style={{ color: FOLDER_COLOR[targetFolder] }}>{FOLDER_LABEL[targetFolder]}</span>
            </p>
          </div>

          {/* Folder picker — where the upload lands */}
          <div className="flex items-center gap-1.5 flex-wrap justify-center" onClick={(e) => e.stopPropagation()}>
            {pickableFolders.map((f) => {
              const active = targetFolder === f
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setTargetFolder(f)}
                  className="px-3 py-1.5 rounded-full text-xs font-medium transition-all border"
                  style={{
                    backgroundColor: active ? `color-mix(in srgb, ${FOLDER_COLOR[f]} 14%, transparent)` : 'hsl(var(--secondary))',
                    color: active ? FOLDER_COLOR[f] : 'hsl(var(--muted-foreground))',
                    borderColor: active ? `color-mix(in srgb, ${FOLDER_COLOR[f]} 35%, transparent)` : 'hsl(var(--border))',
                  }}
                >
                  {FOLDER_LABEL[f]}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Upload progress bars */}
      {uploads.length > 0 && (
        <div className="space-y-2">
          {uploads.map((upload) => (
            <div
              key={upload.id}
              className="flex items-center gap-3 p-3 rounded-xl"
              style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-medium truncate" style={{ color: 'hsl(var(--foreground))' }}>
                    {upload.fileName}
                  </p>
                  {upload.status === 'uploading' && (
                    <span className="text-[10px] tabular-nums flex-shrink-0 ml-2" style={{ color: 'hsl(var(--muted-foreground))' }}>
                      {upload.progress}%
                    </span>
                  )}
                </div>
                <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'hsl(var(--secondary))' }}>
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${upload.progress}%`,
                      backgroundColor:
                        upload.status === 'error'
                          ? 'hsl(var(--destructive))'
                          : upload.status === 'success'
                          ? 'hsl(var(--status-green))'
                          : 'hsl(var(--primary))',
                    }}
                  />
                </div>
                {upload.error && (
                  <p className="text-[10px] mt-1" style={{ color: 'hsl(var(--destructive))' }}>
                    {upload.error}
                  </p>
                )}
              </div>
              <div className="flex-shrink-0">
                {upload.status === 'uploading' && <Loader2 size={15} className="animate-spin" style={{ color: 'hsl(var(--primary))' }} />}
                {upload.status === 'success' && <CheckCircle size={15} style={{ color: 'hsl(var(--status-green))' }} />}
                {upload.status === 'error' && <XCircle size={15} style={{ color: 'hsl(var(--destructive))' }} />}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Totals */}
      {files.length > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
            {files.length} file{files.length === 1 ? '' : 's'} · {grouped.length} folder{grouped.length === 1 ? '' : 's'}
          </span>
          <span className="text-xs" style={{ color: 'hsl(var(--text-faint))' }}>
            {formatBytes(totalSize)} total
          </span>
        </div>
      )}

      {/* Empty state */}
      {files.length === 0 && (
        <div
          className="flex flex-col items-center justify-center py-12 rounded-xl"
          style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
        >
          <FolderOpen size={28} style={{ color: 'hsl(var(--text-faint))' }} />
          <p className="text-sm mt-3" style={{ color: 'hsl(var(--muted-foreground))' }}>
            No files yet — upload your first file
          </p>
        </div>
      )}

      {/* Folder sections */}
      {grouped.map(({ folder, items }) => {
        const isCollapsed = collapsed[folder]
        return (
          <div key={folder} className="space-y-2">
            <button
              onClick={() => setCollapsed((c) => ({ ...c, [folder]: !c[folder] }))}
              className="w-full flex items-center gap-2.5 text-left group/header"
            >
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: FOLDER_COLOR[folder] }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
                    {FOLDER_LABEL[folder]}
                  </span>
                  <span className="text-xs tabular-nums" style={{ color: 'hsl(var(--text-faint))' }}>
                    {items.length}
                  </span>
                </div>
                <p className="text-[11px]" style={{ color: 'hsl(var(--text-faint))' }}>
                  {FOLDER_DESC[folder]}
                </p>
              </div>
              <ChevronDown
                size={15}
                className="flex-shrink-0 transition-transform"
                style={{ color: 'hsl(var(--text-faint))', transform: isCollapsed ? 'rotate(-90deg)' : 'none' }}
              />
            </button>
            {!isCollapsed && (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                {items.map(renderCard)}
              </div>
            )}
          </div>
        )
      })}

      {/* Universal file viewer */}
      {previewFile && (
        <FileViewer
          key={previewFile.id}
          file={previewFile}
          onClose={() => setPreviewFile(null)}
          onDownload={() => handleDownload(previewFile)}
        />
      )}
    </div>
  )
}
