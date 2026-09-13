import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdmin, userOrgId } from '@/lib/auth/role'
import { capGate } from '@/lib/capabilities.server'
import {
  recordGeneration,
  readDocumentProvenance,
  disclosure,
  IPTC_SOURCE,
  type IptcSource,
} from '@/lib/provenance'
import { captureError } from '@/lib/errors'

/**
 * Content provenance — record an accepted generation (POST), read a document's
 * disclosure (GET).
 *
 * NO SERVICE-ROLE CLIENT. Both halves run on the cookie-bound user client, so
 * 0064's policy is the authorization: org match, membership, and the project
 * scope of the document the row is about. A caller who cannot see the document
 * cannot write provenance against it — which is the single property that makes
 * this record worth anything, because a provenance row nobody could have
 * written is a provenance row anybody could have forged.
 *
 * THE ORG COMES FROM THE SESSION, NEVER THE BODY (I-6). A caller supplying
 * `organization_id` would be choosing whose disclosure they are writing.
 *
 * POST IS CALLED ON APPLY, NOT ON GENERATE. `lib/provenance.ts` explains why at
 * length: text the writer discarded is not a fact about the document.
 */

const SOURCE_VALUES = Object.values(IPTC_SOURCE) as [IptcSource, ...IptcSource[]]

const RecordSchema = z
  .object({
    documentId: z.uuid().nullish(),
    fileId: z.uuid().nullish(),
    model: z.string().trim().min(1).max(120),
    prompt: z.string().max(8000).nullish(),
    seed: z.string().max(200).nullish(),
    chars: z.number().int().min(1).max(5_000_000),
    action: z.enum(['c2pa.created', 'c2pa.edited', 'c2pa.placed', 'c2pa.opened']),
    digitalSourceType: z.enum(SOURCE_VALUES).optional(),
    parentAssetId: z.uuid().nullish(),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((b) => !!(b.documentId || b.fileId), {
    message: 'A provenance record must name a document or a file.',
  })

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Writing provenance is a side effect of USING the assistant, so it rides the
  // Suite's capability rather than the project's.
  const denied = await capGate(user, 'record.provenance.write')
  if (denied) return NextResponse.json(denied, { status: 403 })

  const parsed = RecordSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request.' },
      { status: 400 }
    )
  }
  const b = parsed.data

  try {
    const row = await recordGeneration(supabase, {
      organizationId: userOrgId(user),
      documentId: b.documentId ?? null,
      fileId: b.fileId ?? null,
      model: b.model,
      prompt: b.prompt ?? null,
      seed: b.seed ?? null,
      params: b.params ?? {},
      chars: b.chars,
      action: b.action,
      digitalSourceType: b.digitalSourceType,
      parentAssetId: b.parentAssetId ?? null,
      createdBy: user.id,
    })

    // Absent rather than errored is how RLS refuses. Say so plainly instead of
    // reporting a success the database did not perform.
    if (!row) {
      return NextResponse.json(
        { error: 'That document is not in your scope.' },
        { status: 403 }
      )
    }
    return NextResponse.json({ provenance: row })
  } catch (e) {
    captureError(e, { route: 'studio/provenance', op: 'record' })
    return NextResponse.json({ error: 'Could not record provenance.' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const denied = await capGate(user, 'record.provenance.read')
  if (denied) return NextResponse.json(denied, { status: 403 })

  const documentId = req.nextUrl.searchParams.get('document_id')
  if (!documentId || !z.uuid().safeParse(documentId).success) {
    return NextResponse.json({ error: 'A document id is required.' }, { status: 400 })
  }

  const docChars = Number(req.nextUrl.searchParams.get('doc_chars') ?? '') || null

  try {
    const rows = await readDocumentProvenance(supabase, documentId)
    return NextResponse.json({
      provenance: rows,
      disclosure: disclosure(rows, docChars),
    })
  } catch (e) {
    captureError(e, { route: 'studio/provenance', op: 'read' })
    return NextResponse.json({ error: 'Could not read provenance.' }, { status: 500 })
  }
}
