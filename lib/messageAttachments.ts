import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Attachment verification — Batch 14 item 4 (S3-core §1.5, AD-004-R item 2).
 *
 * Closes HANDOFF §8.3 item 1: the send/approve/attach routes used to write
 * whatever `attachment_url` string the request body carried (I-6). Now the
 * reference is resolved to a `files` ROW server-side — by id when the client
 * supplies one, by its `bucket::path` otherwise — and the row must belong to
 * the caller's tenant, or the send is refused. The stored `attachment_url`
 * is then DERIVED from the verified row, never echoed from the body, and a
 * `message_attachments` row records the real FK.
 *
 * `attachment_url` keeps being written until S3-core migration 12 so Batch
 * 13 and 14 deploys stay independently revertable.
 */

export type VerifiedAttachment = {
  fileId: string
  /** `bucket::path`, derived from the verified files row */
  url: string
  name: string
}

type FileRow = {
  id: string
  bucket: string
  file_path: string
  file_name: string
  client_id: string | null
  organization_id: string
}

async function fileById(db: SupabaseClient, id: string): Promise<FileRow | null> {
  const { data, error } = await db
    .from('files')
    .select('id, bucket, file_path, file_name, client_id, organization_id')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`files lookup failed: ${error.message}`)
  return (data as FileRow | null) ?? null
}

async function fileByRef(db: SupabaseClient, ref: string): Promise<FileRow | null> {
  const sep = ref.indexOf('::')
  if (sep === -1) return null
  const path = ref.slice(sep + 2)
  const { data, error } = await db
    .from('files')
    .select('id, bucket, file_path, file_name, client_id, organization_id')
    .eq('file_path', path)
    .maybeSingle()
  if (error) throw new Error(`files lookup failed: ${error.message}`)
  return (data as FileRow | null) ?? null
}

/**
 * Resolve and authorize an attachment reference for a send. Returns null
 * when no attachment was supplied; THROWS when one was supplied but does not
 * resolve to a file in the caller's tenant — that is a forged reference, and
 * the send must fail loudly rather than store it.
 */
export async function verifyAttachment(
  db: SupabaseClient,
  opts: {
    fileId?: string | null
    url?: string | null
    /** portal callers: the sending company — the file must be theirs */
    clientId?: string | null
    /** studio callers: the org — the file must be tenant-local */
    orgId?: string | null
  }
): Promise<VerifiedAttachment | null> {
  if (!opts.fileId && !opts.url) return null

  const row = opts.fileId
    ? await fileById(db, opts.fileId)
    : await fileByRef(db, opts.url as string)

  if (!row) throw new Error('Attachment does not resolve to a stored file.')
  if (opts.clientId && row.client_id !== opts.clientId) {
    throw new Error('Attachment belongs to another company.')
  }
  if (opts.orgId && row.organization_id !== opts.orgId) {
    throw new Error('Attachment belongs to another organization.')
  }

  return {
    fileId: row.id,
    url: `${row.bucket}::${row.file_path}`,
    name: row.file_name,
  }
}

/** Record the FK once the message row exists. seq 1 — one attachment per message today. */
export async function writeAttachmentRow(
  db: SupabaseClient,
  messageId: string,
  fileId: string
): Promise<void> {
  const { error } = await db
    .from('message_attachments')
    .upsert({ message_id: messageId, file_id: fileId, seq: 1 }, { onConflict: 'message_id,seq' })
  if (error) throw new Error(`message_attachments write failed: ${error.message}`)
}
