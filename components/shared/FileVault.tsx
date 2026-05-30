'use client'

import {
  useState,
  useRef,
  useCallback,
  useEffect,
} from 'react'
import { useFileUpload } from '@/hooks/useFileUpload'
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
  Filter,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import FileViewer, { type ViewerFile } from './FileViewer'

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
}

// mime_type can be null on legacy rows — fall back to file_type.
function fileMime(f: FileRecord): string {
  return f.mime_type || f.file_type || ''
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
  return `${parseFloat(
    (bytes / Math.pow(k, i)).toFixed(1)
  )} ${sizes[i]}`
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
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
  const [files, setFiles] =
    useState<FileRecord[]>(initialFiles)
  const [isDragging, setIsDragging] = useState(false)
  const [filter, setFilter] = useState<
    'all' | 'final' | 'video' | 'image' | 'document'
  >('all')
  const [isFinalUpload, setIsFinalUpload] =
    useState(userRole === 'admin')
  const [downloadingId, setDownloadingId] =
    useState<string | null>(null)
  const [deletingId, setDeletingId] =
    useState<string | null>(null)
  const [previewFile, setPreviewFile] =
    useState<FileRecord | null>(null)

  const dropRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { uploadFiles, uploads } = useFileUpload(
    projectId,
    clientId,
    userId,
    userRole,
    userName
  )

  // Realtime — new files from other users
  useEffect(() => {
    const channel = supabase
      .channel(`files:${projectId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'files',
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          const newFile = payload.new as FileRecord
          setFiles((prev) => {
            if (prev.some((f) => f.id === newFile.id)) {
              return prev
            }
            return [newFile, ...prev]
          })
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'files',
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          setFiles((prev) =>
            prev.filter((f) => f.id !== payload.old.id)
          )
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [projectId])

  // Drag handlers
  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(true)
    },
    []
  )

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
    },
    []
  )

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)

      const droppedFiles = e.dataTransfer.files
      if (!droppedFiles.length) return

      const newFiles = await uploadFiles(droppedFiles, {
        isFinal: isFinalUpload,
      })

      setFiles((prev) => [...newFiles as FileRecord[], ...prev])
    },
    [uploadFiles, isFinalUpload]
  )

  const handleFileInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files
      if (!selected?.length) return

      const newFiles = await uploadFiles(selected, {
        isFinal: isFinalUpload,
      })

      setFiles((prev) => [...newFiles as FileRecord[], ...prev])
      e.target.value = ''
    },
    [uploadFiles, isFinalUpload]
  )

  // Download via signed URL
  async function handleDownload(file: ViewerFile) {
    setDownloadingId(file.id)

    try {
      const res = await fetch('/api/files/signed-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileId: file.id,
        }),
      })

      const { signedUrl, error } = await res.json()
      if (error) throw new Error(error)

      // Trigger download
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
    if (!confirm(
      `Delete "${file.file_name}"? This cannot be undone.`
    )) return

    setDeletingId(file.id)

    try {
      // Delete via API (handles R2 + DB)
      const res = await fetch(`/api/files/${file.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Delete failed')
      }

      setFiles((prev) =>
        prev.filter((f) => f.id !== file.id)
      )
    } catch (err) {
      console.error('Delete error:', err)
    } finally {
      setDeletingId(null)
    }
  }



  const filteredFiles = files.filter((f) => {
    if (filter === 'all') return true
    if (filter === 'final') return f.is_final
    return getFileType(fileMime(f)) === filter
  })

  const totalSize = files.reduce(
    (acc, f) => acc + (f.file_size ?? 0),
    0
  )

  return (
    <div className="space-y-4">

      {/* Upload zone */}
      <div
        ref={dropRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className="relative rounded-2xl transition-all 
        cursor-pointer"
        style={{
          border: isDragging
            ? '2px dashed hsl(var(--primary))'
            : '2px dashed hsl(var(--border))',
          backgroundColor: isDragging
            ? 'hsl(var(--primary) / 0.04)'
            : 'hsl(var(--card))',
          padding: '2rem',
        }}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          accept="video/*,image/*,audio/*,.pdf,
          .doc,.docx,.txt,.zip,.ai,.psd,.fig"
          onChange={handleFileInput}
        />

        <div className="flex flex-col items-center 
          gap-3">
          <div
            className="w-12 h-12 rounded-2xl flex 
            items-center justify-center transition-all"
            style={{
              backgroundColor: isDragging
                ? 'hsl(var(--primary) / 0.15)'
                : 'hsl(var(--secondary))',
            }}
          >
            <Upload
              size={22}
              style={{
                color: isDragging
                  ? 'hsl(var(--primary))'
                  : 'hsl(var(--text-faint))',
              }}
            />
          </div>
          <div className="text-center">
            <p
              className="text-sm font-semibold"
              style={{
                color: isDragging
                  ? 'hsl(var(--primary))'
                  : 'hsl(var(--foreground))',
              }}
            >
              {isDragging
                ? 'Drop files here'
                : 'Drag & drop files'}
            </p>
            <p className="text-xs mt-1"
              style={{ color: 'hsl(var(--muted-foreground))' }}>
              or click to browse · Videos, images, 
              documents up to 500MB
            </p>
          </div>

          {/* Final toggle — admin only */}
          {userRole === 'admin' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setIsFinalUpload(!isFinalUpload)
              }}
              className="flex items-center gap-2 px-3 
              py-1.5 rounded-full text-xs font-medium 
              transition-all"
              style={{
                backgroundColor: isFinalUpload
                  ? 'hsl(var(--primary) / 0.12)'
                  : 'hsl(var(--secondary))',
                color: isFinalUpload
                  ? 'hsl(var(--primary))'
                  : 'hsl(var(--muted-foreground))',
                border: isFinalUpload
                  ? '1px solid hsl(var(--primary) / 0.25)'
                  : '1px solid hsl(var(--border))',
              }}
            >
              {isFinalUpload ? (
                <Star size={11} />
              ) : (
                <StarOff size={11} />
              )}
              {isFinalUpload
                ? 'Marking as Final Delivery'
                : 'Mark as Final Delivery'}
            </button>
          )}
        </div>
      </div>

      {/* Upload progress bars */}
      {uploads.length > 0 && (
        <div className="space-y-2">
          {uploads.map((upload) => (
            <div
              key={upload.id}
              className="flex items-center gap-3 p-3 
              rounded-xl"
              style={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
              }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center 
                  justify-between mb-1.5">
                  <p
                    className="text-xs font-medium 
                    truncate"
                    style={{ color: 'hsl(var(--foreground))' }}
                  >
                    {upload.fileName}
                  </p>
                  {upload.status === 'uploading' && (
                    <span className="text-[10px] 
                      tabular-nums flex-shrink-0 ml-2"
                      style={{ color: 'hsl(var(--muted-foreground))' }}>
                      {upload.progress}%
                    </span>
                  )}
                </div>
                <div
                  className="h-1 rounded-full 
                  overflow-hidden"
                  style={{ backgroundColor: 'hsl(var(--secondary))' }}
                >
                  <div
                    className="h-full rounded-full 
                    transition-all duration-300"
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
                  <p className="text-[10px] mt-1"
                    style={{ color: 'hsl(var(--destructive))' }}>
                    {upload.error}
                  </p>
                )}
              </div>

              {/* Status icon */}
              <div className="flex-shrink-0">
                {upload.status === 'uploading' && (
                  <Loader2 size={15}
                    className="animate-spin"
                    style={{ color: 'hsl(var(--primary))' }} />
                )}
                {upload.status === 'success' && (
                  <CheckCircle size={15}
                    style={{ color: 'hsl(var(--status-green))' }} />
                )}
                {upload.status === 'error' && (
                  <XCircle size={15}
                    style={{ color: 'hsl(var(--destructive))' }} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filter bar */}
      {files.length > 0 && (
        <div className="flex items-center 
          justify-between gap-3 flex-wrap">
          <div className="flex gap-1.5 flex-wrap">
            {[
              { key: 'all', label: 'All' },
              { key: 'final', label: '⭐ Finals' },
              { key: 'video', label: 'Videos' },
              { key: 'image', label: 'Images' },
              { key: 'document', label: 'Docs' },
            ].map(({ key, label }) => {
              const count =
                key === 'all'
                  ? files.length
                  : key === 'final'
                  ? files.filter((f) => f.is_final)
                      .length
                  : files.filter(
                      (f) => getFileType(fileMime(f)) === key
                    ).length

              if (count === 0 && key !== 'all')
                return null

              return (
                <button
                  key={key}
                  onClick={() =>
                    setFilter(key as typeof filter)
                  }
                  className="px-3 py-1.5 rounded-full 
                  text-xs font-medium transition-all"
                  style={{
                    backgroundColor:
                      filter === key
                        ? 'hsl(var(--primary))'
                        : 'hsl(var(--secondary))',
                    color:
                      filter === key
                        ? 'hsl(var(--primary-foreground))'
                        : 'hsl(var(--muted-foreground))',
                  }}
                >
                  {label} {count}
                </button>
              )
            })}
          </div>
          <span className="text-xs"
            style={{ color: 'hsl(var(--text-faint))' }}>
            {formatBytes(totalSize)} total
          </span>
        </div>
      )}

      {/* File list */}
      {filteredFiles.length === 0 && (
        <div
          className="flex flex-col items-center 
          justify-center py-12 rounded-xl"
          style={{
            backgroundColor: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
          }}
        >
          <FolderOpen size={28}
            style={{ color: 'hsl(var(--text-faint))' }} />
          <p className="text-sm mt-3"
            style={{ color: 'hsl(var(--muted-foreground))' }}>
            {filter === 'all'
              ? 'No files yet — upload your first file'
              : `No ${filter} files`}
          </p>
        </div>
      )}

      <div className="space-y-2">
        {filteredFiles.map((file) => {
          const fileType = getFileType(fileMime(file))
          const Icon =
            FILE_ICONS[fileType] ?? FileText
          const iconColor =
            FILE_COLORS[fileType] ?? 'hsl(var(--muted-foreground))'

          return (
            <div
              key={file.id}
              className="flex items-center gap-4 p-4 
              rounded-xl group transition-all"
              style={{
                backgroundColor: 'hsl(var(--card))',
                border: file.is_final
                  ? '1px solid hsl(var(--primary) / 0.2)'
                  : '1px solid hsl(var(--border))',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor =
                  'hsl(var(--secondary))'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor =
                  'hsl(var(--card))'
              }}
            >
              {/* File type icon */}
              <div
                className="w-10 h-10 rounded-xl flex 
                items-center justify-center flex-shrink-0"
                style={{
                  backgroundColor: `color-mix(in srgb, ${iconColor} 9%, transparent)`,
                }}
              >
                <Icon size={18}
                  style={{ color: iconColor }} />
              </div>

              {/* File info — click to open in the viewer */}
              <div
                className="flex-1 min-w-0 cursor-pointer"
                onClick={() => setPreviewFile(file)}
                title="Open preview"
              >
                <div className="flex items-center
                  gap-2 flex-wrap">
                  <p
                    className="text-sm font-semibold
                    truncate"
                    style={{ color: 'hsl(var(--foreground))' }}
                  >
                    {file.file_name}
                  </p>
                  {file.is_final && (
                    <span
                      className="flex items-center 
                      gap-1 text-[10px] font-bold 
                      px-2 py-0.5 rounded-full 
                      flex-shrink-0"
                      style={{
                        backgroundColor:
                          'hsl(var(--primary) / 0.12)',
                        color: 'hsl(var(--primary))',
                      }}
                    >
                      <Star size={9} />
                      FINAL
                    </span>
                  )}
                </div>
                <div className="flex items-center 
                  gap-3 mt-1">
                    <span className="text-xs"
                      style={{ color: 'hsl(var(--muted-foreground))' }}>
                      {formatBytes(file.file_size ?? 0)}
                    </span>
                    <span className="text-xs"
                      style={{ color: 'hsl(var(--text-faint))' }}>
                      {formatDate(file.created_at)}
                    </span>
                    <span className="text-xs"
                      style={{ color: 'hsl(var(--text-faint))' }}>
                      {file.uploaded_by_role === 'admin'
                        ? 'McPrime'
                        : file.uploaded_by_role}
                    </span>
                  </div>
                {file.description && (
                  <p className="text-xs mt-1"
                    style={{ color: 'hsl(var(--muted-foreground))' }}>
                    {file.description}
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 
                flex-shrink-0 opacity-0 
                group-hover:opacity-100 transition-opacity">

                {/* Preview — available for every file type */}
                {(
                  <button
                    onClick={() => setPreviewFile(file)}
                    className="p-2 rounded-lg transition-all"
                    style={{ color: 'hsl(var(--text-faint))' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor
                        = 'hsl(var(--secondary))'
                      e.currentTarget.style.color
                        = 'hsl(var(--foreground))'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor
                        = 'transparent'
                      e.currentTarget.style.color
                        = 'hsl(var(--text-faint))'
                    }}
                    title="Preview"
                  >
                    <Eye size={15} />
                  </button>
                )}



                {/* Download */}
                <button
                  onClick={() => handleDownload(file)}
                  disabled={downloadingId === file.id}
                  className="p-2 rounded-lg transition-all 
                  disabled:opacity-50"
                  style={{ color: 'hsl(var(--text-faint))' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor
                      = 'hsl(var(--secondary))'
                    e.currentTarget.style.color
                      = 'hsl(var(--foreground))'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor
                      = 'transparent'
                    e.currentTarget.style.color
                      = 'hsl(var(--text-faint))'
                  }}
                  title="Download"
                >
                  {downloadingId === file.id ? (
                    <Loader2 size={15}
                      className="animate-spin" />
                  ) : (
                    <Download size={15} />
                  )}
                </button>

                {/* Delete (admin only) */}
                {userRole === 'admin' && (
                  <button
                    onClick={() => handleDelete(file)}
                    disabled={deletingId === file.id}
                    className="p-2 rounded-lg transition-all 
                    disabled:opacity-50"
                    style={{ color: 'hsl(var(--text-faint))' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor
                        = 'hsl(var(--destructive) / 0.1)'
                      e.currentTarget.style.color
                        = 'hsl(var(--destructive))'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor
                        = 'transparent'
                      e.currentTarget.style.color
                        = 'hsl(var(--text-faint))'
                    }}
                    title="Delete"
                  >
                    {deletingId === file.id ? (
                      <Loader2 size={15}
                        className="animate-spin" />
                    ) : (
                      <Trash2 size={15} />
                    )}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

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
