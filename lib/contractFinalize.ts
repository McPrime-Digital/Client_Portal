import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readContract, listFields } from '@/lib/contracts'
import { renderContractPdf, signContractPdf, stampFieldsIntoPdf } from '@/lib/contractPdf'
import { uploadToR2, getSignedDownloadUrl } from '@/lib/r2'

/**
 * FINALISE — turn a fully-signed contract into a self-contained artifact.
 *
 * Runs once, when the last signature lands. It renders the agreement, the
 * signature block and the certificate of completion into one PDF, seals it with
 * a PAdES signature where a certificate is configured, stores it in the vault
 * and points `contracts.final_file_id` at it.
 *
 * ── WHY THE ARTIFACT MATTERS MORE THAN THE ROW ───────────────────────────
 *
 * The database already knows everything. The artifact exists for the day the
 * database is not available to the person who needs it — a dispute years later,
 * a change of vendor, an auditor who will not be given a login. Documenso and
 * DocuSeal both keep the audit trail on their own side; this one travels inside
 * the file, covered by the same signature as the agreement.
 *
 * ── FAILURE HERE MUST NOT UNDO A SIGNATURE ───────────────────────────────
 *
 * The signature is already recorded and the contract is already `completed`
 * before this runs. If R2 is down or the certificate is missing, the legal
 * position is unchanged — what is missing is a convenience copy. So this returns
 * a reason rather than throwing, and the caller records it rather than failing
 * the request. Rolling back a signature because a PDF would not upload would be
 * the worst possible response to a storage hiccup.
 */

export type FinalizeResult =
  | { ok: true; fileId: string; sealed: boolean; reason?: string }
  | { ok: false; reason: string }

export async function finalizeContract(
  db: SupabaseClient,
  contractId: string,
  studioName: string
): Promise<FinalizeResult> {
  try {
    const detail = await readContract(db, contractId)
    if (!detail) return { ok: false, reason: 'Contract not readable.' }
    if (detail.contract.status !== 'completed') {
      return { ok: false, reason: 'Not complete.' }
    }
    // Idempotent: two signers landing together must not produce two artifacts.
    if (detail.contract.final_file_id) {
      return { ok: true, fileId: detail.contract.final_file_id, sealed: true }
    }

    // TWO PATHS, and which one is taken is decided by what was SENT.
    //
    //   · An uploaded PDF (source_file_id) is the document people signed, so the
    //     filled fields are burned into THAT file. Re-rendering it from our own
    //     template would produce a different document from the one presented,
    //     which is the one thing a signed artifact must never do.
    //   · A typed body is rendered from the text whose hash was fixed at send.
    //
    // Either way the certificate of completion is appended before sealing.
    let base: Uint8Array
    const sourceFileId = detail.contract.source_file_id
    if (sourceFileId) {
      const { data: src } = await db
        .from('files').select('file_path, bucket').eq('id', sourceFileId).maybeSingle()
      const row = src as { file_path: string; bucket: string } | null
      if (!row || row.bucket !== 'r2') {
        return { ok: false, reason: 'The source document is missing from the vault.' }
      }
      const url = await getSignedDownloadUrl(row.file_path, 300, { disposition: 'inline' })
      const res = await fetch(url)
      if (!res.ok) return { ok: false, reason: 'Could not read the source document.' }
      const original = new Uint8Array(await res.arrayBuffer())

      const fields = await listFields(db, contractId)
      base = await stampFieldsIntoPdf(original, fields.map((f) => ({
        kind: f.kind, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, value: f.value,
      })))
    } else {
      base = await renderContractPdf(detail, studioName)
    }

    const seal = await signContractPdf(base)

    const safe = detail.contract.title.replace(/[^a-zA-Z0-9-_ ]/g, '').slice(0, 60).trim()
    const fileName = `${safe || 'contract'} (signed).pdf`
    // Under the contract's own prefix so it inherits the vault's shape and is
    // never confused with something a person uploaded.
    const path = `contracts/${detail.contract.organization_id}/${contractId}/${Date.now()}-signed.pdf`

    await uploadToR2(path, seal.bytes, 'application/pdf')

    const { data: fileRow, error } = await db.from('files').insert({
      organization_id: detail.contract.organization_id,
      client_id: detail.contract.client_id,
      project_id: detail.contract.project_id,
      file_name: fileName,
      file_path: path,
      file_size: seal.bytes.byteLength,
      file_type: 'application/pdf',
      mime_type: 'application/pdf',
      bucket: 'r2',
      category: 'document',
    }).select('id').maybeSingle()

    if (error || !fileRow) {
      return { ok: false, reason: error?.message ?? 'Could not record the file.' }
    }

    const fileId = (fileRow as { id: string }).id
    await db.from('contracts')
      .update({ final_file_id: fileId, certificate_file_id: fileId })
      .eq('id', contractId)

    return seal.sealed
      ? { ok: true, fileId, sealed: true }
      : { ok: true, fileId, sealed: false, reason: seal.reason }
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : 'Could not build the signed document.',
    }
  }
}
