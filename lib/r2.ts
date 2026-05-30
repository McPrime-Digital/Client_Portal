import {
  S3Client,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
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
