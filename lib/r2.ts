import 'server-only'

import {
  S3Client,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl }
  from '@aws-sdk/s3-request-presigner'

export const r2 = new S3Client({
  region: 'auto',
  endpoint:
    `https://${process.env.R2_ACCOUNT_ID}` +
    `.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:
      process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey:
      process.env.R2_SECRET_ACCESS_KEY!,
  },
})

// Files under 5GB use a single PUT.
// Files 5GB+ automatically switch to
// multipart upload (supports up to 5TB).
const MULTIPART_THRESHOLD =
  5 * 1024 * 1024 * 1024  // 5 GB

// Each multipart chunk is 256MB
const CHUNK_SIZE =
  256 * 1024 * 1024  // 256 MB

export async function uploadToR2(
  path: string,
  body: Uint8Array,
  contentType: string
): Promise<void> {

  // ── Small file: single PUT ───────────
  if (body.byteLength < MULTIPART_THRESHOLD) {
    await r2.send(
      new PutObjectCommand({
        Bucket:
          process.env.R2_BUCKET_NAME!,
        Key: path,
        Body: body,
        ContentType: contentType,
      })
    )
    return
  }

  // ── Large file: multipart upload ─────
  // Splits into 256MB chunks.
  // On failure, aborts cleanly so you
  // are not billed for partial uploads.

  const { UploadId } = await r2.send(
    new CreateMultipartUploadCommand({
      Bucket:
        process.env.R2_BUCKET_NAME!,
      Key: path,
      ContentType: contentType,
    })
  )

  const parts: {
    ETag: string
    PartNumber: number
  }[] = []

  try {
    let partNumber = 1
    let offset = 0

    while (offset < body.byteLength) {
      const chunk = body.slice(
        offset,
        offset + CHUNK_SIZE
      )

      const { ETag } = await r2.send(
        new UploadPartCommand({
          Bucket:
            process.env.R2_BUCKET_NAME!,
          Key: path,
          UploadId,
          PartNumber: partNumber,
          Body: chunk,
        })
      )

      parts.push({
        ETag: ETag!,
        PartNumber: partNumber,
      })

      partNumber++
      offset += CHUNK_SIZE
    }

    await r2.send(
      new CompleteMultipartUploadCommand({
        Bucket:
          process.env.R2_BUCKET_NAME!,
        Key: path,
        UploadId,
        MultipartUpload: { Parts: parts },
      })
    )
  } catch (err) {
    // Abort so partial upload
    // does not incur storage costs
    await r2.send(
      new AbortMultipartUploadCommand({
        Bucket:
          process.env.R2_BUCKET_NAME!,
        Key: path,
        UploadId,
      })
    )
    throw err
  }
}

// Generates a signed URL — private, secure, expiring.
//
// `opts.disposition` controls whether the browser renders the
// object in place (`inline`, for the in-app viewer) or downloads
// it (`attachment`). `opts.contentType` overrides the stored
// Content-Type so legacy rows saved as application/octet-stream
// still render (e.g. a PDF embedded in an <iframe>).
export async function getSignedDownloadUrl(
  path: string,
  expiresInSeconds = 120,
  opts?: {
    disposition?: 'inline' | 'attachment'
    fileName?: string
    contentType?: string
  }
): Promise<string> {
  let contentDisposition: string | undefined
  if (opts?.disposition) {
    // RFC 5987 filename* keeps unicode names intact.
    const namePart = opts.fileName
      ? `; filename*=UTF-8''${encodeURIComponent(opts.fileName)}`
      : ''
    contentDisposition = `${opts.disposition}${namePart}`
  }

  return getSignedUrl(
    r2,
    new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: path,
      ResponseContentDisposition: contentDisposition,
      ResponseContentType: opts?.contentType,
    }),
    { expiresIn: expiresInSeconds }
  )
}

// Streams an object straight from R2 (no signed URL round-trip).
// Used by the same-origin file proxy so the in-app viewer can
// fetch() document bytes (docx, xlsx, zip, text) without needing
// CORS configured on the bucket.
export async function getR2ObjectStream(path: string): Promise<{
  stream: ReadableStream
  contentType?: string
  contentLength?: number
}> {
  const obj = await r2.send(
    new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: path,
    })
  )
  return {
    stream: (obj.Body as any).transformToWebStream(),
    contentType: obj.ContentType,
    contentLength: obj.ContentLength,
  }
}

export async function deleteFromR2(
  path: string
): Promise<void> {
  await r2.send(
    new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: path,
    })
  )
}

// ── Browser-driven multipart: pause, resume, cancel ─────────────────────────
//
// `uploadToR2` above buffers the whole file in the function's memory, which is
// why nothing calls it. THESE helpers are the direct-to-R2 equivalent: the
// server only ever mints an upload id and presigned PART urls, and the bytes
// go browser → R2 exactly as the single-PUT path does.
//
// WHY THIS EXISTS AT ALL: a single PUT cannot be paused or resumed — the only
// stop is an abort that discards everything already sent. Parts can be, and a
// 4 GB master on hotel wifi is precisely the case where that matters.
//
// THE ETag TRAP, and why completion reads the parts back from R2 rather than
// from the browser. S3 completion needs every part's ETag. The obvious design
// has the browser read `ETag` off each PUT response — but a cross-origin XHR
// can only read a header the bucket's CORS policy names in
// `ExposeHeaders`. Ours does not, and requiring that would be a fourth
// silent, deploy-time CORS dependency of exactly the kind Batch 17 spent a
// round chasing. `ListParts` asks R2 what it actually stored, from the
// server, with no CORS surface at all.

/** R2/S3 minimum part size (except the final part). */
export const MULTIPART_PART_SIZE = 8 * 1024 * 1024 // 8 MB
/** Below this a single PUT is over before a pause button could be pressed. */
export const MULTIPART_MIN_FILE = 8 * 1024 * 1024

export async function createMultipartUpload(
  path: string,
  contentType: string
): Promise<string> {
  const { UploadId } = await r2.send(
    new CreateMultipartUploadCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: path,
      ContentType: contentType,
    })
  )
  if (!UploadId) throw new Error('R2 did not return an upload id')
  return UploadId
}

/** Presigned PUT urls for a batch of part numbers. Signed in batches by the
 *  caller so a 500-part upload does not sign 500 urls up front — a presigned
 *  url has a lifetime, and one minted an hour before it is used is a failure
 *  waiting on a slow connection. */
export async function signUploadParts(
  path: string,
  uploadId: string,
  partNumbers: number[],
  expiresInSeconds = 3600
): Promise<Record<number, string>> {
  const out: Record<number, string> = {}
  await Promise.all(
    partNumbers.map(async (n) => {
      out[n] = await getSignedUrl(
        r2,
        new UploadPartCommand({
          Bucket: process.env.R2_BUCKET_NAME!,
          Key: path,
          UploadId: uploadId,
          PartNumber: n,
        }),
        { expiresIn: expiresInSeconds }
      )
    })
  )
  return out
}

/** Which parts R2 already holds — the resume cursor, and the ETag source. */
export async function listUploadedParts(
  path: string,
  uploadId: string
): Promise<{ PartNumber: number; ETag: string }[]> {
  const parts: { PartNumber: number; ETag: string }[] = []
  let marker: number | undefined
  // Paginated deliberately: 10,000 parts is the S3 ceiling and one page is
  // 1,000, so a large master would silently complete with a truncated part
  // list — which R2 accepts and which produces a corrupt object.
  for (;;) {
    const res = await r2.send(
      new ListPartsCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: path,
        UploadId: uploadId,
        PartNumberMarker: marker != null ? String(marker) : undefined,
      })
    )
    for (const p of res.Parts ?? []) {
      if (p.PartNumber != null && p.ETag) parts.push({ PartNumber: p.PartNumber, ETag: p.ETag })
    }
    if (!res.IsTruncated) break
    marker = res.NextPartNumberMarker ? Number(res.NextPartNumberMarker) : undefined
    if (marker == null) break
  }
  return parts.sort((a, b) => a.PartNumber - b.PartNumber)
}

export async function completeMultipartUpload(
  path: string,
  uploadId: string,
  parts: { PartNumber: number; ETag: string }[]
): Promise<void> {
  await r2.send(
    new CompleteMultipartUploadCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: path,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    })
  )
}

/** Abort and destroy every uploaded part. Called on cancel and on failure —
 *  an abandoned multipart upload is billed storage until it is aborted. */
export async function abortMultipartUpload(
  path: string,
  uploadId: string
): Promise<void> {
  await r2.send(
    new AbortMultipartUploadCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: path,
      UploadId: uploadId,
    })
  )
}

// Generates a presigned PUT URL so the browser can upload a file
// straight to R2 — bypassing the serverless function entirely.
// This is what makes large uploads work on hosts (e.g. Vercel) that
// cap request bodies at a few MB: the bytes never touch our function.
// The key is always generated server-side (see /api/files/presign)
// so a client can't target an arbitrary object.
export async function getSignedUploadUrl(
  path: string,
  contentType: string,
  expiresInSeconds = 600
): Promise<string> {
  return getSignedUrl(
    r2,
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: path,
      ContentType: contentType,
    }),
    { expiresIn: expiresInSeconds }
  )
}