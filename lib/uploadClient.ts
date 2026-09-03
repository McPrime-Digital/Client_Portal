'use client'

// Client-side uploader: sends the file straight to Cloudflare R2 via
// presigned URLs, then records it. Because the bytes go browser → R2
// (not through our serverless function), there is no request-body size
// limit — large deliverables upload fine on Vercel.
//
// TWO PATHS, one call site (Batch 24):
//
//   SMALL (< 8 MB) — one presigned PUT, as before.
//     1. POST /api/files/presign  → { uploadUrl, key, contentType }
//     2. PUT the file to R2                     [progress reported here]
//     3. POST /api/files/commit   → { file }    [DB row created]
//
//   LARGE (≥ 8 MB) — multipart, and therefore PAUSABLE and RESUMABLE.
//     1. POST /api/files/multipart {create}  → { key, uploadId, partSize }
//     2. per batch: {sign} → presigned part urls, then PUT each part
//     3. POST /api/files/multipart {complete}   [server reads parts from R2]
//     4. POST /api/files/commit   → { file }
//
// A single PUT cannot be paused — the only stop is an abort that throws away
// everything already sent. That is why the threshold exists at all: above it
// the upload is long enough for pause to be a real thing to offer, and below
// it the upload is over before the button could be pressed. `handle.canPause`
// tells the UI which one it got, so it never shows a control that would lie.

export type UploadedFile = {
  id: string
  project_id: string
  client_id: string | null
  file_name: string
  file_path: string
  file_size: number
  file_type: string
  mime_type: string
  direction: string
  bucket: string
  [key: string]: unknown
}

/** Live control over an upload in flight, handed to the caller immediately so
 *  the bubble carrying the file can drive it. */
export type UploadHandle = {
  /** Multipart only. Below the threshold there is nothing to pause. */
  canPause: boolean
  pause: () => void
  resume: () => void
  /** Stops the upload and destroys whatever reached R2. Idempotent. */
  cancel: () => void
  isPaused: () => boolean
  isCancelled: () => boolean
}

/** Thrown when the user cancels. Callers treat this as "not an error to
 *  report" — a cancelled upload is a decision, not a failure. */
export class UploadCancelled extends Error {
  constructor() {
    super('Upload cancelled')
    this.name = 'UploadCancelled'
  }
}

export const MULTIPART_MIN_FILE = 8 * 1024 * 1024

type UploadOpts = {
  file: File
  // Project-scoped (most uploads) or client-scoped (e.g. invoice receipt
  // with no project) — supply projectId or clientId.
  projectId?: string
  clientId?: string
  /** A room's own scope — channels/groups/DMs have neither project nor,
   *  often, a client (Batch 24). Membership is the authorization. */
  roomId?: string
  direction?: 'delivery' | 'client-upload'
  // Explicit Files Vault category (e.g. 'receipt') and an optional invoice
  // to link the uploaded file to as its payment receipt.
  category?: string
  invoiceId?: string
  // Vault folder taxonomy (deliverables/tasks/brand/invoices/chat/general)
  // and an optional task this upload is the approval media for.
  folder?: string
  taskId?: string
  // Admin-only: mark this as the final delivery.
  isFinal?: boolean
  onProgress?: (percent: number) => void
  /** Called once, synchronously, before any byte moves. */
  onHandle?: (handle: UploadHandle) => void
}

/** One PUT, abortable. Resolves when R2 has the whole object. */
function putWholeFile(
  uploadUrl: string,
  contentType: string,
  file: Blob,
  onProgress: ((pct: number) => void) | undefined,
  registerAbort: (abort: () => void) => void
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    registerAbort(() => xhr.abort())
    xhr.open('PUT', uploadUrl, true)
    xhr.setRequestHeader('Content-Type', contentType)
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`Upload failed (${xhr.status}).`))
    }
    xhr.onerror = () => reject(new Error('Upload failed — network error.'))
    xhr.onabort = () => reject(new UploadCancelled())
    xhr.send(file)
  })
}

/** One part, abortable, reporting bytes so the caller can total them. */
function putPart(
  url: string,
  chunk: Blob,
  onBytes: (loaded: number) => void,
  registerAbort: (abort: () => void) => void
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    registerAbort(() => xhr.abort())
    xhr.open('PUT', url, true)
    // NO Content-Type header: the part urls are signed without one, and
    // sending a header the signature does not cover makes R2 reject it.
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onBytes(e.loaded)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`Part upload failed (${xhr.status}).`))
    }
    xhr.onerror = () => reject(new Error('Part upload failed — network error.'))
    xhr.onabort = () => reject(new UploadCancelled())
    xhr.send(chunk)
  })
}

export async function uploadFileToR2(opts: UploadOpts): Promise<UploadedFile> {
  const {
    file, projectId, clientId, roomId, direction, category, invoiceId,
    folder, taskId, isFinal, onProgress, onHandle,
  } = opts
  const fileName = file.name
  const declaredType = file.type || 'application/octet-stream'
  const multipart = file.size >= MULTIPART_MIN_FILE

  // ── Control surface, live from before the first byte ──────────────────────
  let cancelled = false
  let paused = false
  let abortCurrent: (() => void) | null = null
  let wake: (() => void) | null = null
  const registerAbort = (fn: () => void) => { abortCurrent = fn }
  const handle: UploadHandle = {
    canPause: multipart,
    pause: () => {
      if (!multipart || cancelled) return
      paused = true
      // Stop the part in flight; it restarts whole on resume. A part is at
      // most 8 MB, so the discarded work is bounded and small.
      abortCurrent?.()
    },
    resume: () => {
      if (!paused || cancelled) return
      paused = false
      wake?.()
    },
    cancel: () => {
      if (cancelled) return
      cancelled = true
      paused = false
      wake?.()
      abortCurrent?.()
    },
    isPaused: () => paused,
    isCancelled: () => cancelled,
  }
  onHandle?.(handle)

  const throwIfCancelled = () => { if (cancelled) throw new UploadCancelled() }
  const waitWhilePaused = async () => {
    while (paused && !cancelled) {
      await new Promise<void>((r) => { wake = r })
      wake = null
    }
    throwIfCancelled()
  }

  let key: string

  if (!multipart) {
    // ── Small file: one presigned PUT ───────────────────────────────────────
    throwIfCancelled()
    const presignRes = await fetch('/api/files/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, clientId, roomId, fileName, contentType: declaredType }),
    })
    const presign = await presignRes.json()
    if (!presignRes.ok) throw new Error(presign.error ?? 'Could not start upload.')
    const { uploadUrl, key: putKey, contentType } = presign as {
      uploadUrl: string; key: string; contentType: string
    }
    throwIfCancelled()
    await putWholeFile(uploadUrl, contentType, file, onProgress, registerAbort)
    key = putKey
  } else {
    // ── Large file: multipart, pausable ─────────────────────────────────────
    throwIfCancelled()
    const createRes = await fetch('/api/files/multipart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create', projectId, clientId, roomId, fileName,
        contentType: declaredType, fileSize: file.size,
      }),
    })
    const created = await createRes.json()
    if (!createRes.ok) throw new Error(created.error ?? 'Could not start upload.')
    const { key: mpKey, uploadId, partSize } = created as {
      key: string; uploadId: string; partSize: number
    }
    key = mpKey

    const abortServerSide = async () => {
      await fetch('/api/files/multipart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'abort', projectId, clientId, roomId, key, uploadId }),
      }).catch(() => {})
    }

    const partCount = Math.max(1, Math.ceil(file.size / partSize))
    let completedBytes = 0
    const SIGN_BATCH = 10

    try {
      for (let start = 1; start <= partCount; start += SIGN_BATCH) {
        await waitWhilePaused()
        const batch: number[] = []
        for (let n = start; n < start + SIGN_BATCH && n <= partCount; n++) batch.push(n)

        // Signed per batch, not up front: a url minted an hour before it is
        // used expires mid-upload on a slow line.
        const signRes = await fetch('/api/files/multipart', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'sign', projectId, clientId, roomId, key, uploadId, partNumbers: batch,
          }),
        })
        const signed = await signRes.json()
        if (!signRes.ok) throw new Error(signed.error ?? 'Could not sign upload parts.')
        const urls = signed.urls as Record<string, string>

        for (const n of batch) {
          await waitWhilePaused()
          const from = (n - 1) * partSize
          const chunk = file.slice(from, Math.min(from + partSize, file.size))
          const settled = completedBytes
          await putPart(
            urls[String(n)],
            chunk,
            (loaded) => onProgress?.(
              Math.min(99, Math.round(((settled + loaded) / file.size) * 100))
            ),
            registerAbort
          )
          completedBytes = settled + chunk.size
          onProgress?.(Math.min(99, Math.round((completedBytes / file.size) * 100)))
        }
      }

      await waitWhilePaused()
      const doneRes = await fetch('/api/files/multipart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'complete', projectId, clientId, roomId, key, uploadId, expectedParts: partCount,
        }),
      })
      const done = await doneRes.json()
      if (!doneRes.ok) throw new Error(done.error ?? 'Could not finish the upload.')
      onProgress?.(100)
    } catch (err) {
      // Cancel OR failure: the parts already in R2 are billed until aborted.
      // A paused upload is NOT here — pause never leaves this loop.
      await abortServerSide()
      throw err
    }
  }

  // ── Commit (create the files-table row) ───────────────────────────────────
  throwIfCancelled()
  const commitRes = await fetch('/api/files/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      clientId,
      roomId,
      key,
      fileName,
      fileSize: file.size,
      contentType: declaredType,
      direction,
      category,
      invoiceId,
      folder,
      taskId,
      isFinal,
    }),
  })
  const commit = await commitRes.json()
  if (!commitRes.ok) {
    throw new Error(commit.error ?? 'Upload could not be saved.')
  }
  return commit.file as UploadedFile
}
