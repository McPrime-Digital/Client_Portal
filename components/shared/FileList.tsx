'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Download,
  Trash2,
  FileText,
  FileImage,
  FileVideo,
  File as FileIcon,
  Loader2,
  Eye,
} from 'lucide-react'
import FileViewer from './FileViewer'

type FileRecord = {
  id: string
  file_name: string
  file_type: string | null
  mime_type: string | null
  file_size: number | null
  is_final: boolean
  direction: 'delivery' | 'client-upload'
  uploaded_by_role: string | null
  created_at: string
}

export default function FileList({
  files,
  isAdmin = false,
  onDeleted,
}: {
  files: FileRecord[]
  isAdmin?: boolean
  onDeleted?: (id: string) => void
}) {
  const router = useRouter()
  const [downloading, setDownloading] =
    useState<string | null>(null)
  const [deleting, setDeleting] =
    useState<string | null>(null)
  const [preview, setPreview] =
    useState<FileRecord | null>(null)

  function formatSize(
    bytes: number | null
  ) {
    if (!bytes) return '—'
    if (bytes < 1024 * 1024)
      return `${(
        bytes / 1024
      ).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024)
      return `${(
        bytes / (1024 * 1024)
      ).toFixed(1)} MB`
    return `${(
      bytes / (1024 * 1024 * 1024)
    ).toFixed(2)} GB`
  }

  function getFileIcon(
    mime: string | null
  ) {
    if (!mime)
      return <FileIcon size={16}
        style={{ color: 'hsl(var(--muted-foreground))' }} />
    if (mime.startsWith('image/'))
      return <FileImage size={16}
        style={{ color: 'hsl(var(--status-green))' }} />
    if (mime.startsWith('video/'))
      return <FileVideo size={16}
        style={{ color: 'hsl(var(--primary))' }} />
    if (
      mime.includes('pdf') ||
      mime.includes('document') ||
      mime.includes('text')
    )
      return <FileText size={16}
        style={{ color: 'hsl(var(--status-blue))' }} />
    return <FileIcon size={16}
      style={{ color: 'hsl(var(--muted-foreground))' }} />
  }

  function categoryLabel(f: FileRecord) {
    if (f.is_final) return 'Deliverable'
    return f.direction === 'delivery'
      ? 'Delivery'
      : 'Client Upload'
  }

  async function download(id: string) {
    setDownloading(id)
    try {
      const res = await fetch(
        `/api/files/${id}/download`
      )
      const data = await res.json()
      if (!res.ok) {
        alert(
          data.error ?? 'Download failed.'
        )
        return
      }
      window.open(data.url, '_blank')
    } catch {
      alert('Download failed.')
    } finally {
      setDownloading(null)
    }
  }

  async function deleteFile(id: string) {
    if (
      !confirm(
        'Permanently delete this file? ' +
        'This cannot be undone.'
      )
    ) return

    setDeleting(id)
    try {
      const res = await fetch(
        `/api/files/${id}`,
        { method: 'DELETE' }
      )
      const data = await res.json()
      if (!res.ok) {
        alert(
          data.error ?? 'Delete failed.'
        )
        return
      }
      onDeleted?.(id)
      router.refresh()
    } catch {
      alert('Delete failed.')
    } finally {
      setDeleting(null)
    }
  }

  if (files.length === 0) {
    return (
      <div
        className="py-10 text-center
        rounded-xl"
        style={{
          backgroundColor: 'hsl(var(--primary-foreground))',
          border: '1px solid hsl(var(--border))',
        }}
      >
        <FileIcon
          size={24}
          className="mx-auto mb-3"
          style={{ color: 'hsl(var(--border))' }}
        />
        <p className="text-sm"
          style={{ color: 'hsl(var(--text-faint))' }}>
          No files uploaded yet
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {files.map((file) => (
        <div
          key={file.id}
          className="flex items-center
          gap-3 p-3.5 rounded-xl
          transition-all"
          style={{
            backgroundColor: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
          }}
          onMouseEnter={(e) => {
            e.currentTarget
              .style.borderColor = 'hsl(var(--border))'
          }}
          onMouseLeave={(e) => {
            e.currentTarget
              .style.borderColor = 'hsl(var(--border))'
          }}
        >
          <div className="flex-shrink-0">
            {getFileIcon(
              file.mime_type || file.file_type
            )}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm
              font-medium truncate"
              style={{ color: 'hsl(var(--foreground))' }}>
              {file.file_name}
            </p>
            <div className="flex
              items-center gap-2
              mt-0.5 flex-wrap">
              <span className="text-xs"
                style={{ color: 'hsl(var(--text-faint))' }}>
                {formatSize(file.file_size)}
              </span>
              <span style={{
                color: 'hsl(var(--border))' }}>
                ·
              </span>
              <span className="text-xs
                px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: 'hsl(var(--secondary))',
                  color: 'hsl(var(--muted-foreground))',
                }}>
                {categoryLabel(file)}
              </span>
              <span style={{
                color: 'hsl(var(--border))' }}>
                ·
              </span>
              <span className="text-xs"
                style={{ color: 'hsl(var(--text-faint))' }}>
                {new Date(file.created_at)
                  .toLocaleDateString(
                    'en-US',
                    {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    }
                  )}
              </span>
            </div>
          </div>

          <div className="flex items-center
            gap-1 flex-shrink-0">

            <button
              onClick={() => setPreview(file)}
              title="Preview"
              className="p-2 rounded-lg
              transition-all"
              style={{ color: 'hsl(var(--muted-foreground))' }}
              onMouseEnter={(e) => {
                e.currentTarget
                  .style.backgroundColor =
                  'hsl(var(--secondary))'
                e.currentTarget
                  .style.color = 'hsl(var(--foreground))'
              }}
              onMouseLeave={(e) => {
                e.currentTarget
                  .style.backgroundColor =
                  'transparent'
                e.currentTarget
                  .style.color = 'hsl(var(--muted-foreground))'
              }}
            >
              <Eye size={15} />
            </button>

            <button
              onClick={() =>
                download(file.id)
              }
              disabled={
                downloading === file.id
              }
              title="Download"
              className="p-2 rounded-lg
              transition-all
              disabled:opacity-50"
              style={{ color: 'hsl(var(--muted-foreground))' }}
              onMouseEnter={(e) => {
                e.currentTarget
                  .style.backgroundColor =
                  'hsl(var(--secondary))'
                e.currentTarget
                  .style.color = 'hsl(var(--foreground))'
              }}
              onMouseLeave={(e) => {
                e.currentTarget
                  .style.backgroundColor =
                  'transparent'
                e.currentTarget
                  .style.color = 'hsl(var(--muted-foreground))'
              }}
            >
              {downloading === file.id
                ? <Loader2 size={15}
                    className="animate-spin" />
                : <Download size={15} />
              }
            </button>

            {isAdmin && (
              <button
                onClick={() =>
                  deleteFile(file.id)
                }
                disabled={
                  deleting === file.id
                }
                title="Delete file"
                className="p-2 rounded-lg
                transition-all
                disabled:opacity-50"
                style={{ color: 'hsl(var(--muted-foreground))' }}
                onMouseEnter={(e) => {
                  e.currentTarget
                    .style.backgroundColor =
                    'hsl(var(--destructive) / 0.1)'
                  e.currentTarget
                    .style.color = 'hsl(var(--destructive))'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget
                    .style.backgroundColor =
                    'transparent'
                  e.currentTarget
                    .style.color = 'hsl(var(--muted-foreground))'
                }}
              >
                {deleting === file.id
                  ? <Loader2 size={15}
                      className=
                        "animate-spin" />
                  : <Trash2 size={15} />
                }
              </button>
            )}
          </div>
        </div>
      ))}

      {preview && (
        <FileViewer
          key={preview.id}
          file={preview}
          onClose={() => setPreview(null)}
          onDownload={() => download(preview.id)}
        />
      )}
    </div>
  )
}
