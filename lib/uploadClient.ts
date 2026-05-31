'use client'

// Client-side uploader: sends the file straight to Cloudflare R2 via
// a presigned URL, then records it. Because the bytes go browser → R2
// (not through our serverless function), there is no request-body size
// limit — large deliverables upload fine on Vercel.
//
//   1. POST /api/files/presign  → { uploadUrl, key, contentType }
//   2. PUT the file to uploadUrl (R2)         [progress reported here]
//   3. POST /api/files/commit   → { file }    [DB row created]

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

export async function uploadFileToR2(opts: {
  file: File
  // Project-scoped (most uploads) or client-scoped (e.g. invoice receipt
  // with no project) — supply projectId or clientId.
  projectId?: string
  clientId?: string
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
}): Promise<UploadedFile> {
  const { file, projectId, clientId, direction, category, invoiceId, folder, taskId, isFinal, onProgress } = opts
  const fileName = file.name
  const declaredType = file.type || 'application/octet-stream'

  // 1 — presign
  const presignRes = await fetch('/api/files/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, clientId, fileName, contentType: declaredType }),
  })
  const presign = await presignRes.json()
  if (!presignRes.ok) {
    throw new Error(presign.error ?? 'Could not start upload.')
  }
  const { uploadUrl, key, contentType } = presign as {
    uploadUrl: string
    key: string
    contentType: string
  }

  // 2 — PUT direct to R2. Use XHR so we can surface upload progress.
  // The Content-Type MUST match the value that was presigned, or R2
  // rejects the signature.
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl, true)
    xhr.setRequestHeader('Content-Type', contentType)
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100))
        }
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`Upload failed (${xhr.status}).`))
    }
    xhr.onerror = () => reject(new Error('Upload failed — network error.'))
    xhr.send(file)
  })

  // 3 — commit (create the files-table row)
  const commitRes = await fetch('/api/files/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      clientId,
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
