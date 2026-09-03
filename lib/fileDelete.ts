import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { deleteFromR2 } from '@/lib/r2'

/**
 * Permanent file destruction — Batch 24.
 *
 * "Delete" used to mean different things in three places: the vault deleted
 * the blob and the row (admin only), a chat delete soft-deleted the MESSAGE
 * and left the file and its R2 object behind forever (HANDOFF §8.3 item 2's
 * open half), and nothing at all cleaned up a cancelled upload. This is the
 * one path, and it destroys in the order that cannot orphan:
 *
 *   1. detach references (message_attachments, invoice receipt links)
 *   2. delete the `files` row
 *   3. delete the object from R2
 *
 * ROW BEFORE BLOB, deliberately. The reverse leaves a row pointing at bytes
 * that no longer exist — a file that lists, previews as broken, and can never
 * be cleaned up because the delete already "succeeded". A row deleted with the
 * blob still present is an orphaned OBJECT, which costs storage and is
 * recoverable by a sweep; the other way costs the user their trust in the list.
 *
 * The blob failure is REPORTED, not swallowed (I-10): the caller decides
 * whether a storage error is worth surfacing, and the returned flag is what
 * a future orphan sweep would key on.
 */

export type FileDeletion = {
  fileId: string
  fileName: string | null
  blobDeleted: boolean
  blobError: string | null
}

/**
 * Destroy one file completely. `db` must be able to write `files` — the
 * service role for today's callers.
 */
export async function deleteFilePermanently(
  db: SupabaseClient,
  file: { id: string; file_path: string; bucket: string; file_name?: string | null }
): Promise<FileDeletion> {
  // 1 · detach. message_attachments cascades on files delete only if the FK
  // says so; doing it explicitly means this works regardless and leaves no
  // message pointing at a row that is about to vanish.
  await db.from('message_attachments').delete().eq('file_id', file.id)
  await db.from('invoices').update({ receipt_file_id: null }).eq('receipt_file_id', file.id)

  // 2 · the row
  const { error: rowErr } = await db.from('files').delete().eq('id', file.id)
  if (rowErr) throw new Error(`file row delete failed: ${rowErr.message}`)

  // 3 · the bytes
  let blobDeleted = false
  let blobError: string | null = null
  try {
    if (file.bucket === 'r2') {
      await deleteFromR2(file.file_path)
    } else {
      const { error } = await db.storage.from(file.bucket).remove([file.file_path])
      if (error) throw new Error(error.message)
    }
    blobDeleted = true
  } catch (e) {
    blobError = e instanceof Error ? e.message : String(e)
  }

  return {
    fileId: file.id,
    fileName: file.file_name ?? null,
    blobDeleted,
    blobError,
  }
}

/**
 * Every file a message carries — through the attachment FK, and through the
 * legacy `attachment_url` string for rows that predate it (0033 backfilled
 * the FK, but a `bucket::path` value is still what some old rows hold).
 */
export async function filesForMessage(
  db: SupabaseClient,
  messageId: string
): Promise<{ id: string; file_path: string; bucket: string; file_name: string | null }[]> {
  const { data: links } = await db
    .from('message_attachments')
    .select('file_id, files(id, file_path, bucket, file_name)')
    .eq('message_id', messageId)
  const out: { id: string; file_path: string; bucket: string; file_name: string | null }[] = []
  for (const l of links ?? []) {
    const f = Array.isArray(l.files) ? l.files[0] : l.files
    if (f) out.push(f as (typeof out)[number])
  }
  return out
}
