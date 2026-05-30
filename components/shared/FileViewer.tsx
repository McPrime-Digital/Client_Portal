'use client'

import {
  useEffect,
  useState,
  useCallback,
  useRef,
} from 'react'
import {
  Download,
  Loader2,
  X,
  FileQuestion,
  ChevronLeft,
  Folder,
  File as FileIcon,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import AudioPlayer from './AudioPlayer'

export type ViewerFile = {
  id: string
  file_name: string
  mime_type?: string | null
  file_type?: string | null
  file_size?: number | null
}

// A direct source (e.g. a chat attachment) that isn't a row in the
// `files` table. `url` is an inline URL used directly by media/pdf/
// image elements; `rawUrl` (falls back to `url`) is fetched for
// parse-based types (text/docx/xlsx/zip).
export type ViewerSource = {
  name: string
  mime?: string | null
  url: string
  rawUrl?: string
}

type Props = {
  /** A files-table row — fetched via the file APIs. */
  file?: ViewerFile
  /** A direct URL source (chat attachments, etc.). */
  source?: ViewerSource
  onClose: () => void
  /** Optional download handler; shows a Download button when set. */
  onDownload?: () => void
}

type Kind =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'text'
  | 'document'
  | 'spreadsheet'
  | 'archive'
  | 'unknown'

type ZipEntry = { name: string; size: number; bytes: Uint8Array }

// Resolved, ready-to-render representation of a file or zip entry.
type View =
  | { kind: 'image' | 'video' | 'audio' | 'pdf'; url: string; name: string; mime: string }
  | { kind: 'text'; text: string; name: string; truncated: boolean }
  | { kind: 'document'; html: string; name: string }
  | { kind: 'spreadsheet'; sheets: { name: string; rows: string[][] }[]; name: string; truncated: boolean }
  | { kind: 'archive'; name: string; entries: ZipEntry[] }
  | { kind: 'unknown'; name: string; mime: string }

const EXT_KIND: Record<string, Kind> = {
  // image
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image',
  svg: 'image', avif: 'image', bmp: 'image', ico: 'image', heic: 'image',
  // video
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video', ogv: 'video', mkv: 'video',
  // audio
  mp3: 'audio', wav: 'audio', ogg: 'audio', oga: 'audio', m4a: 'audio',
  aac: 'audio', flac: 'audio', opus: 'audio', weba: 'audio', amr: 'audio',
  // pdf
  pdf: 'pdf',
  // spreadsheet
  xlsx: 'spreadsheet', xls: 'spreadsheet', csv: 'spreadsheet',
  // document
  docx: 'document',
  // archive
  zip: 'archive',
  // text / code
  txt: 'text', md: 'text', markdown: 'text', json: 'text', js: 'text',
  ts: 'text', tsx: 'text', jsx: 'text', css: 'text', scss: 'text',
  html: 'text', xml: 'text', yml: 'text', yaml: 'text', log: 'text',
  sql: 'text', py: 'text', rb: 'text', go: 'text', sh: 'text', env: 'text',
}

const EXT_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
  aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/opus', weba: 'audio/webm',
  pdf: 'application/pdf',
}

const TEXT_LIMIT = 2_000_000 // 2 MB of text rendered inline
const ARCHIVE_LIMIT = 200 * 1024 * 1024 // 200 MB zip cap
const SHEET_ROW_CAP = 500
const SHEET_COL_CAP = 60

function extOf(name: string) {
  return name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
}

function detectKind(name: string, mime: string): Kind {
  const m = (mime || '').toLowerCase()
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  if (m === 'application/pdf') return 'pdf'
  if (m.includes('spreadsheet') || m.includes('excel') || m === 'text/csv') return 'spreadsheet'
  if (m.includes('wordprocessingml')) return 'document'
  if (m.includes('zip') || m.includes('compressed')) return 'archive'
  if (m.startsWith('text/') || m.includes('json') || m.includes('xml')) {
    // fall through to extension for finer detail, default text
  }
  const byExt = EXT_KIND[extOf(name)]
  if (byExt) return byExt
  if (m.startsWith('text/')) return 'text'
  return 'unknown'
}

function guessMime(name: string, fallback = 'application/octet-stream') {
  return EXT_MIME[extOf(name)] ?? fallback
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export default function FileViewer({ file, source, onClose, onDownload }: Props) {
  const displayName = source?.name ?? file?.file_name ?? 'File'
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string>('')
  const [rootView, setRootView] = useState<View | null>(null)

  // Zip navigation: a stack of archive frames + the selected entry.
  const [stack, setStack] = useState<{ name: string; entries: ZipEntry[] }[]>([])
  const [entryView, setEntryView] = useState<View | null>(null)
  const [entryLoading, setEntryLoading] = useState(false)

  const [zoom, setZoom] = useState(1)
  const objectUrls = useRef<string[]>([])

  const makeUrl = useCallback((bytes: Uint8Array, mime: string) => {
    const url = URL.createObjectURL(
      new Blob([bytes as unknown as BlobPart], { type: mime })
    )
    objectUrls.current.push(url)
    return url
  }, [])

  // Build a renderable view from raw bytes (used for zip entries and
  // for parse-based root types once their bytes have been fetched).
  const buildViewFromBytes = useCallback(
    async (name: string, mime: string, bytes: Uint8Array): Promise<View> => {
      const kind = detectKind(name, mime)
      switch (kind) {
        case 'image':
        case 'video':
        case 'audio':
        case 'pdf':
          return { kind, name, mime: mime || guessMime(name), url: makeUrl(bytes, mime || guessMime(name)) }
        case 'text': {
          const truncated = bytes.byteLength > TEXT_LIMIT
          const slice = truncated ? bytes.subarray(0, TEXT_LIMIT) : bytes
          return { kind, name, truncated, text: new TextDecoder().decode(slice) }
        }
        case 'document': {
          const mammoth = await import('mammoth')
          const { value } = await mammoth.convertToHtml({
            arrayBuffer: bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength
            ) as ArrayBuffer,
          })
          return { kind, name, html: value }
        }
        case 'spreadsheet': {
          const XLSX = await import('xlsx')
          const isCsv = extOf(name) === 'csv'
          const wb = isCsv
            ? XLSX.read(new TextDecoder().decode(bytes), { type: 'string' })
            : XLSX.read(bytes, { type: 'array' })
          let truncated = false
          const sheets = wb.SheetNames.map((sn) => {
            const raw = XLSX.utils.sheet_to_json(wb.Sheets[sn], {
              header: 1,
              blankrows: false,
              defval: '',
            }) as unknown[][]
            if (raw.length > SHEET_ROW_CAP) truncated = true
            const rows = raw.slice(0, SHEET_ROW_CAP).map((r) =>
              r.slice(0, SHEET_COL_CAP).map((c) => String(c ?? ''))
            )
            return { name: sn, rows }
          })
          return { kind, name, sheets, truncated }
        }
        case 'archive': {
          if (bytes.byteLength > ARCHIVE_LIMIT) {
            return { kind: 'unknown', name, mime: 'application/zip' }
          }
          const { unzipSync } = await import('fflate')
          const unzipped = unzipSync(bytes)
          const entries: ZipEntry[] = Object.entries(unzipped)
            .filter(([p]) => !p.endsWith('/'))
            .map(([p, b]) => ({ name: p, size: b.byteLength, bytes: b }))
            .sort((a, b) => a.name.localeCompare(b.name))
          return { kind, name, entries }
        }
        default:
          return { kind: 'unknown', name, mime: mime || guessMime(name) }
      }
    },
    [makeUrl]
  )

  // Load the top-level file. Media/PDF/images stream from an inline
  // URL directly (no download); parse-based types fetch their bytes
  // (same-origin proxy for files-table rows, the source URL for
  // direct sources). The viewer is mounted with a `key`, so a fresh
  // instance (and clean initial state) is created per file.
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        // Resolve name, mime, the inline view URL, and a bytes-loader,
        // from whichever source the viewer was given.
        let name: string
        let mime: string
        let viewUrl: string
        let loadBytes: () => Promise<Uint8Array>

        if (source) {
          name = source.name
          mime = source.mime || guessMime(name)
          viewUrl = source.url
          const bytesUrl = source.rawUrl ?? source.url
          loadBytes = async () => {
            const raw = await fetch(bytesUrl)
            if (!raw.ok) throw new Error('Could not load file contents')
            return new Uint8Array(await raw.arrayBuffer())
          }
        } else if (file) {
          const res = await fetch('/api/files/signed-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileId: file.id, inline: true }),
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error ?? 'Could not open file')
          name = data.fileName ?? file.file_name
          mime = data.mimeType ?? file.mime_type ?? file.file_type ?? guessMime(name)
          viewUrl = data.signedUrl
          loadBytes = async () => {
            const raw = await fetch(`/api/files/${file.id}/raw`)
            if (!raw.ok) throw new Error('Could not load file contents')
            return new Uint8Array(await raw.arrayBuffer())
          }
        } else {
          throw new Error('Nothing to preview')
        }

        const kind = detectKind(name, mime)

        let view: View
        if (kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'pdf') {
          view = { kind, name, mime, url: viewUrl }
        } else if (kind === 'unknown') {
          view = { kind, name, mime }
        } else {
          // Needs parsing — pull the bytes, then build the view.
          const buf = await loadBytes()
          view = await buildViewFromBytes(name, mime, buf)
        }

        if (cancelled) return
        setRootView(view)
        if (view.kind === 'archive') {
          setStack([{ name: view.name, entries: view.entries }])
        }
        setPhase('ready')
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Could not open file')
        setPhase('error')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [file, source, buildViewFromBytes])

  // Revoke any blob URLs on unmount.
  useEffect(() => {
    return () => {
      objectUrls.current.forEach((u) => URL.revokeObjectURL(u))
      objectUrls.current = []
    }
  }, [])

  // Escape to close + lock body scroll.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (entryView) setEntryView(null)
        else onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose, entryView])

  async function openEntry(entry: ZipEntry) {
    setEntryLoading(true)
    try {
      const mime = guessMime(entry.name)
      const view = await buildViewFromBytes(entry.name, mime, entry.bytes)
      if (view.kind === 'archive') {
        // Nested zip — push a new frame instead of previewing.
        setStack((s) => [...s, { name: entry.name, entries: view.entries }])
        setEntryView(null)
      } else {
        setEntryView(view)
      }
    } catch {
      setEntryView({ kind: 'unknown', name: entry.name, mime: guessMime(entry.name) })
    } finally {
      setEntryLoading(false)
    }
  }

  const inArchive = rootView?.kind === 'archive'
  const currentFrame = stack[stack.length - 1]
  const headerName = entryView?.name ?? rootView?.name ?? displayName

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      style={{ backgroundColor: 'rgba(0,0,0,0.8)' }}
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3 sm:px-5">
          {/* Back inside an archive */}
          {inArchive && (entryView || stack.length > 1) ? (
            <button
              onClick={() =>
                entryView ? setEntryView(null) : setStack((s) => s.slice(0, -1))
              }
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <ChevronLeft size={16} />
              Back
            </button>
          ) : null}

          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
            {headerName}
          </p>

          <div className="flex flex-shrink-0 items-center gap-2">
            {(rootView?.kind === 'image') && (
              <>
                <button
                  onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
                  className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  aria-label="Zoom out"
                >
                  <ZoomOut size={16} />
                </button>
                <button
                  onClick={() => setZoom((z) => Math.min(5, z + 0.25))}
                  className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  aria-label="Zoom in"
                >
                  <ZoomIn size={16} />
                </button>
              </>
            )}
            {onDownload && (
              <button
                onClick={onDownload}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                <Download size={13} />
                Download
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="min-h-[300px] flex-1 overflow-auto bg-background">
          {phase === 'loading' && (
            <div className="flex h-[60vh] items-center justify-center">
              <Loader2 size={26} className="animate-spin text-primary" />
            </div>
          )}

          {phase === 'error' && (
            <Fallback name={displayName} message={error} onDownload={onDownload} />
          )}

          {phase === 'ready' && (
            <>
              {entryLoading && (
                <div className="flex h-[60vh] items-center justify-center">
                  <Loader2 size={26} className="animate-spin text-primary" />
                </div>
              )}

              {!entryLoading && inArchive && !entryView && currentFrame && (
                <ArchiveListing frame={currentFrame} onOpen={openEntry} />
              )}

              {!entryLoading && inArchive && entryView && (
                <ViewBody view={entryView} zoom={1} onDownload={onDownload} />
              )}

              {!entryLoading && !inArchive && rootView && (
                <ViewBody view={rootView} zoom={zoom} onDownload={onDownload} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ────────────────────────── renderers ────────────────────────── */

function ViewBody({
  view,
  zoom,
  onDownload,
}: {
  view: View
  zoom: number
  onDownload?: () => void
}) {
  switch (view.kind) {
    case 'image':
      return (
        <div className="flex min-h-[60vh] items-center justify-center overflow-auto p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={view.url}
            alt={view.name}
            style={{ transform: `scale(${zoom})`, transition: 'transform 0.15s' }}
            className="max-h-[78vh] max-w-full origin-center rounded-lg object-contain"
          />
        </div>
      )
    case 'video':
      return (
        <div className="flex min-h-[60vh] items-center justify-center bg-black p-2">
          <video
            src={view.url}
            controls
            playsInline
            className="max-h-[80vh] w-full rounded-lg"
          />
        </div>
      )
    case 'audio':
      return (
        <div className="flex min-h-[60vh] items-center justify-center p-6">
          <AudioPlayer key={view.url} src={view.url} name={view.name} />
        </div>
      )
    case 'pdf':
      return (
        <iframe
          src={view.url}
          title={view.name}
          className="h-[80vh] w-full border-0 bg-white"
        />
      )
    case 'text':
      return (
        <div className="p-4 sm:p-6">
          {view.truncated && (
            <p className="mb-3 rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">
              Showing the first part of a large file. Download to view it all.
            </p>
          )}
          <pre className="overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-card p-4 font-mono text-xs leading-relaxed text-foreground">
            {view.text}
          </pre>
        </div>
      )
    case 'document':
      // mammoth output rendered in a sandboxed iframe — neutralises
      // any markup that slipped through, and keeps document styles
      // isolated from the app.
      return (
        <iframe
          title={view.name}
          sandbox=""
          className="h-[80vh] w-full border-0 bg-white"
          srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>
            body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;line-height:1.6;padding:40px 48px;max-width:820px;margin:0 auto}
            h1,h2,h3{font-weight:600;margin:1.2em 0 .5em}
            p{margin:0 0 .8em}img{max-width:100%}
            table{border-collapse:collapse;margin:1em 0}td,th{border:1px solid #ddd;padding:6px 10px}
          </style></head><body>${view.html || '<p>This document is empty.</p>'}</body></html>`}
        />
      )
    case 'spreadsheet':
      return <SpreadsheetView view={view} />
    case 'unknown':
      return <Fallback name={view.name} mime={view.mime} onDownload={onDownload} />
    default:
      return null
  }
}

function SpreadsheetView({
  view,
}: {
  view: Extract<View, { kind: 'spreadsheet' }>
}) {
  const [active, setActive] = useState(0)
  const sheet = view.sheets[active]
  return (
    <div className="flex h-full flex-col">
      {view.sheets.length > 1 && (
        <div className="flex flex-shrink-0 gap-1 overflow-x-auto border-b border-border bg-card px-3 py-2">
          {view.sheets.map((s, i) => (
            <button
              key={s.name + i}
              onClick={() => setActive(i)}
              className={`whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                i === active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-secondary'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 overflow-auto p-4">
        {view.truncated && (
          <p className="mb-3 rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">
            Large sheet — showing the first {SHEET_ROW_CAP} rows. Download for the full file.
          </p>
        )}
        <table className="w-full border-collapse text-xs">
          <tbody>
            {sheet?.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className="whitespace-nowrap border border-border px-2.5 py-1.5 text-foreground"
                    style={r === 0 ? { fontWeight: 600, background: 'hsl(var(--secondary))' } : undefined}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {(!sheet || sheet.rows.length === 0) && (
          <p className="text-sm text-muted-foreground">This sheet is empty.</p>
        )}
      </div>
    </div>
  )
}

function ArchiveListing({
  frame,
  onOpen,
}: {
  frame: { name: string; entries: ZipEntry[] }
  onOpen: (e: ZipEntry) => void
}) {
  return (
    <div className="p-3 sm:p-4">
      <div className="mb-2 flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <Folder size={14} />
        {frame.entries.length} item{frame.entries.length === 1 ? '' : 's'}
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {frame.entries.map((entry) => (
          <button
            key={entry.name}
            onClick={() => onOpen(entry)}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-secondary"
          >
            <FileIcon size={16} className="flex-shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">
              {entry.name}
            </span>
            <span className="flex-shrink-0 text-xs tabular-nums text-muted-foreground">
              {formatBytes(entry.size)}
            </span>
          </button>
        ))}
        {frame.entries.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            This archive is empty.
          </p>
        )}
      </div>
    </div>
  )
}

function Fallback({
  name,
  mime,
  message,
  onDownload,
}: {
  name: string
  mime?: string
  message?: string
  onDownload?: () => void
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-secondary text-muted-foreground">
        <FileQuestion size={30} />
      </div>
      <div>
        <p className="text-sm font-semibold text-foreground">{name}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {message ?? "This file type can't be previewed in the browser."}
        </p>
        {mime && <p className="mt-0.5 text-xs text-faint">{mime}</p>}
      </div>
      {onDownload && (
        <button
          onClick={onDownload}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Download size={15} />
          Download file
        </button>
      )}
    </div>
  )
}
