import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * CONTRACTS AND SIGNATURES — the one write path.
 *
 * `S3-b` §0: "The signing record is the whole point. Get it wrong and every
 * contract signed before the fix is legally weaker." That is the only sentence
 * in that document describing a defect you cannot repair later — a bad calendar
 * is an annoyance; an unenforceable agreement is not discovered until it is
 * contested.
 *
 * WHAT THIS IS FOR IN A PRODUCTION COMPANY, since "e-signature" undersells it:
 * talent and appearance releases for every person on camera, location
 * agreements, crew deal memos, NDAs before a script goes out, music and stock
 * licences, client SOWs and change orders. It also closes a loop the provenance
 * engine left open — `rights.talent_consent` is a boolean that nothing could
 * substantiate, and a signed appearance release is the evidence behind it.
 *
 * ── THE THREE RULES ESIGN/UETA ACTUALLY TURN ON (§3.6) ────────────────────
 *
 *   1. INTENT TO SIGN — the `signed` event, with its timestamp.
 *   2. CONSENT TO TRANSACT ELECTRONICALLY — the `consented` event, recorded
 *      BEFORE anything can be signed. `sign()` refuses without it, because a
 *      signature gathered before consent is the one a dispute attacks first.
 *   3. ASSOCIATION WITH THE RECORD — `content_hash`, computed over the exact
 *      bytes presented at SEND and never recomputed. If the hash were taken at
 *      signing time it would describe whatever the document had become, which
 *      is the opposite of what it is for.
 *
 * ── SENDING FREEZES THE CONTRACT ──────────────────────────────────────────
 *
 * After `send()` the body is not editable through this module. A contract whose
 * text can change after it goes out has a `content_hash` that lies.
 *
 * ── EVERY FUNCTION TAKES `db`, AND IT IS THE USER CLIENT ──────────────────
 *
 * 0068's policies are the authorization (AD-001). The events table is
 * append-only by trigger for everyone including the service role, and 0071 opens
 * exactly one gap in it for the AD-003 tombstone.
 */

export type ContractStatus =
  | 'draft' | 'sent' | 'viewed' | 'partially_signed'
  | 'completed' | 'declined' | 'voided' | 'expired'

export type SignerStatus = 'pending' | 'sent' | 'viewed' | 'signed' | 'declined'

export type ContractEventName =
  | 'created' | 'sent' | 'opened' | 'viewed' | 'consented'
  | 'field_filled' | 'signed' | 'declined' | 'reminded' | 'expired' | 'voided'

export type Contract = {
  id: string
  organization_id: string
  client_id: string | null
  project_id: string | null
  is_template: boolean
  title: string
  release_kind: 'appearance' | 'ai_likeness' | 'location' | 'music' | null
  subject_file_id: string | null
  ai_training: 'allowed' | 'notAllowed' | 'constrained'
  body: { text?: string } | null
  source_file_id: string | null
  status: ContractStatus
  expires_at: string | null
  content_hash: string | null
  final_file_id: string | null
  created_at: string
}

export type Signer = {
  id: string
  contract_id: string
  user_id: string | null
  email: string
  name: string
  seq: number
  status: SignerStatus
  verification: 'session' | 'sms_passcode' | 'email_link'
  signed_at: string | null
}

export type ContractEvent = {
  id: string
  contract_id: string
  signer_id: string | null
  event: ContractEventName
  actor_name: string
  ip_address: string | null
  user_agent: string | null
  occurred_at: string
  meta: Record<string, unknown>
}

const CONTRACT_COLUMNS =
  'id, organization_id, client_id, project_id, is_template, title, release_kind, subject_file_id, ai_training, body, source_file_id, status, expires_at, content_hash, final_file_id, created_at'
const SIGNER_COLUMNS =
  'id, contract_id, user_id, email, name, seq, status, verification, signed_at'
const EVENT_COLUMNS =
  'id, contract_id, signer_id, event, actor_name, ip_address, user_agent, occurred_at, meta'

/** The exact bytes a signer is shown, hashed. Deliberately over the TEXT rather
 *  than the row: a row carries timestamps and ids that change without the
 *  agreement changing, and a hash that moves for those reasons proves nothing. */
export function contentHash(title: string, bodyText: string): string {
  return createHash('sha256').update(`${title}\n\n${bodyText}`, 'utf8').digest('hex')
}

export type Actor = {
  name: string
  ip: string | null
  userAgent: string | null
}

/** The request's originating address, as far as it can be trusted. Written down
 *  rather than guessed at the call site, and null when absent — an invented IP
 *  is worse evidence than none. */
export function actorFromHeaders(h: Headers, name: string): Actor {
  const fwd = h.get('x-forwarded-for')
  const ip = fwd ? (fwd.split(',')[0]?.trim() || null) : (h.get('x-real-ip') || null)
  return { name, ip, userAgent: h.get('user-agent') }
}

async function recordEvent(
  db: SupabaseClient,
  contractId: string,
  event: ContractEventName,
  actor: Actor,
  opts: { signerId?: string | null; meta?: Record<string, unknown> } = {}
): Promise<void> {
  // occurred_at is NOT supplied — 0068's trigger stamps it, because a
  // client-set timestamp on a legal record is a backdating facility.
  const { error } = await db.from('contract_events').insert({
    contract_id: contractId,
    signer_id: opts.signerId ?? null,
    event,
    actor_name: actor.name,
    ip_address: actor.ip,
    user_agent: actor.userAgent,
    meta: opts.meta ?? {},
  })
  if (error) throw new Error(`contract_events(${event}): ${error.message}`)
}

// ── reads ───────────────────────────────────────────────────────────────────

export async function listContracts(
  db: SupabaseClient,
  params: { orgId?: string; clientId?: string; includeTemplates?: boolean }
): Promise<Contract[]> {
  let q = db.from('contracts').select(CONTRACT_COLUMNS)
    // 0073's standing obligation: the crew policy deliberately does not filter
    // soft-deleted rows, so every crew read must.
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200)
  if (params.orgId) q = q.eq('organization_id', params.orgId)
  if (params.clientId) q = q.eq('client_id', params.clientId)
  if (!params.includeTemplates) q = q.eq('is_template', false)

  const { data, error } = await q
  if (error) throw new Error(`listContracts: ${error.message}`)
  return (data ?? []) as unknown as Contract[]
}

export type ContractDetail = {
  contract: Contract
  signers: Signer[]
  events: ContractEvent[]
}

export async function readContract(
  db: SupabaseClient, id: string
): Promise<ContractDetail | null> {
  const { data: c, error } = await db
    .from('contracts').select(CONTRACT_COLUMNS).eq('id', id).is('deleted_at', null).maybeSingle()
  if (error) throw new Error(`readContract: ${error.message}`)
  if (!c) return null

  const [{ data: s }, { data: e }] = await Promise.all([
    db.from('contract_signers').select(SIGNER_COLUMNS).eq('contract_id', id).order('seq'),
    db.from('contract_events').select(EVENT_COLUMNS).eq('contract_id', id)
      .order('occurred_at', { ascending: true }).limit(500),
  ])

  return {
    contract: c as unknown as Contract,
    signers: (s ?? []) as unknown as Signer[],
    events: (e ?? []) as unknown as ContractEvent[],
  }
}

// ── writes ──────────────────────────────────────────────────────────────────

export async function createContract(
  db: SupabaseClient,
  p: {
    organizationId: string
    title: string
    bodyText: string
    clientId?: string | null
    projectId?: string | null
    expiresAt?: string | null
    releaseKind?: Contract['release_kind']
    subjectFileId?: string | null
    aiTraining?: Contract['ai_training']
  },
  actor: Actor
): Promise<Contract | null> {
  const { data, error } = await db.from('contracts').insert({
    organization_id: p.organizationId,
    client_id: p.clientId ?? null,
    project_id: p.projectId ?? null,
    title: p.title,
    body: { text: p.bodyText },
    status: 'draft',
    expires_at: p.expiresAt ?? null,
    release_kind: p.releaseKind ?? null,
    subject_file_id: p.subjectFileId ?? null,
    ai_training: p.aiTraining ?? 'notAllowed',
  }).select(CONTRACT_COLUMNS).maybeSingle()

  if (error) throw new Error(`createContract: ${error.message}`)
  if (!data) return null

  const contract = data as unknown as Contract
  await recordEvent(db, contract.id, 'created', actor)
  return contract
}

export async function addSigner(
  db: SupabaseClient,
  p: { contractId: string; name: string; email: string; userId?: string | null; seq: number }
): Promise<Signer | null> {
  const { data, error } = await db.from('contract_signers').insert({
    contract_id: p.contractId,
    user_id: p.userId ?? null,
    name: p.name,
    email: p.email,
    seq: p.seq,
    status: 'pending',
    verification: 'session',
  }).select(SIGNER_COLUMNS).maybeSingle()

  if (error?.code === '23505') throw new Error('SEQ_TAKEN')
  if (error) throw new Error(`addSigner: ${error.message}`)
  return (data as unknown as Signer) ?? null
}

/**
 * Freeze the text, hash it, and put it in front of the signers.
 *
 * A contract with no signers cannot be sent — it would reach `completed` the
 * moment it was opened, which is a completed agreement nobody agreed to.
 */
export async function sendContract(
  db: SupabaseClient, id: string, actor: Actor
): Promise<{ ok: true } | { ok: false; reason: 'NO_SIGNERS' | 'NOT_DRAFT' | 'GONE' }> {
  const detail = await readContract(db, id)
  if (!detail) return { ok: false, reason: 'GONE' }
  if (detail.contract.status !== 'draft') return { ok: false, reason: 'NOT_DRAFT' }
  if (detail.signers.length === 0) return { ok: false, reason: 'NO_SIGNERS' }

  const hash = contentHash(detail.contract.title, detail.contract.body?.text ?? '')

  const { data, error } = await db.from('contracts')
    .update({ status: 'sent', content_hash: hash })
    .eq('id', id).eq('status', 'draft')
    .select('id')
  if (error) throw new Error(`sendContract: ${error.message}`)
  if ((data ?? []).length === 0) return { ok: false, reason: 'NOT_DRAFT' }

  await db.from('contract_signers')
    .update({ status: 'sent' }).eq('contract_id', id).eq('status', 'pending')

  await recordEvent(db, id, 'sent', actor, {
    meta: { content_hash: hash, signers: detail.signers.length },
  })
  return { ok: true }
}

/** Whose turn it is. `seq` is a signing ORDER, so a later signer waiting on an
 *  earlier one is not "pending" in the same sense — they are blocked, and the
 *  surface should say which. */
export function isSignersTurn(signers: Signer[], signerId: string): boolean {
  const me = signers.find((s) => s.id === signerId)
  if (!me) return false
  return signers.every((s) => s.seq >= me.seq || s.status === 'signed' || s.status === 'declined')
}

export async function recordConsent(
  db: SupabaseClient,
  p: { contractId: string; signerId: string; consentText: string },
  actor: Actor
): Promise<void> {
  await recordEvent(db, p.contractId, 'consented', actor, {
    signerId: p.signerId,
    meta: { consent_text: p.consentText },
  })
}

export async function markViewed(
  db: SupabaseClient, contractId: string, signerId: string, actor: Actor
): Promise<void> {
  await db.from('contract_signers')
    .update({ status: 'viewed' }).eq('id', signerId).eq('status', 'sent')
  await recordEvent(db, contractId, 'viewed', actor, { signerId })
}

export type SignOutcome =
  | { ok: true; completed: boolean }
  | {
      ok: false
      reason: 'NOT_YOUR_TURN' | 'NO_CONSENT' | 'ALREADY' | 'GONE' | 'NOT_SENT'
        | 'FIELDS_OUTSTANDING'
    }

/**
 * The signature itself.
 *
 * REFUSES WITHOUT A RECORDED CONSENT, which is ESIGN's second requirement and
 * the one a dispute attacks first. The check is against the EVENT rather than a
 * flag on the signer, because the event is what the certificate prints.
 */
export async function sign(
  db: SupabaseClient,
  p: { contractId: string; signerId: string },
  actor: Actor
): Promise<SignOutcome> {
  const detail = await readContract(db, p.contractId)
  if (!detail) return { ok: false, reason: 'GONE' }

  const me = detail.signers.find((s) => s.id === p.signerId)
  if (!me) return { ok: false, reason: 'GONE' }
  if (me.status === 'signed') return { ok: false, reason: 'ALREADY' }
  if (!['sent', 'viewed', 'partially_signed'].includes(detail.contract.status)) {
    return { ok: false, reason: 'NOT_SENT' }
  }
  if (!isSignersTurn(detail.signers, p.signerId)) return { ok: false, reason: 'NOT_YOUR_TURN' }

  const consented = detail.events.some(
    (e) => e.event === 'consented' && e.signer_id === p.signerId
  )
  if (!consented) return { ok: false, reason: 'NO_CONSENT' }

  // A signature that leaves a required box empty is an incomplete document that
  // LOOKS complete — the one failure mode worse than refusing to sign.
  const fields = await listFields(db, p.contractId)
  if (outstandingFor(fields, p.signerId).length > 0) {
    return { ok: false, reason: 'FIELDS_OUTSTANDING' }
  }

  const now = new Date().toISOString()
  const { data } = await db.from('contract_signers')
    .update({ status: 'signed', signed_at: now })
    .eq('id', p.signerId).neq('status', 'signed')
    .select('id')
  if ((data ?? []).length === 0) return { ok: false, reason: 'ALREADY' }

  await recordEvent(db, p.contractId, 'signed', actor, {
    signerId: p.signerId,
    meta: { content_hash: detail.contract.content_hash },
  })

  // Re-read rather than reason about the copy in memory: another signer may
  // have landed between the read above and this write.
  const after = await readContract(db, p.contractId)
  const all = (after?.signers ?? []).every((s) => s.status === 'signed')
  await db.from('contracts')
    .update({ status: all ? 'completed' : 'partially_signed' })
    .eq('id', p.contractId)

  return { ok: true, completed: all }
}

export async function declineContract(
  db: SupabaseClient,
  p: { contractId: string; signerId: string; reason?: string | null },
  actor: Actor
): Promise<boolean> {
  const { data } = await db.from('contract_signers')
    .update({ status: 'declined' }).eq('id', p.signerId).neq('status', 'signed').select('id')
  if ((data ?? []).length === 0) return false

  await recordEvent(db, p.contractId, 'declined', actor, {
    signerId: p.signerId, meta: { reason: p.reason ?? null },
  })
  await db.from('contracts').update({ status: 'declined' }).eq('id', p.contractId)
  return true
}

export async function voidContract(
  db: SupabaseClient, id: string, actor: Actor
): Promise<boolean> {
  const { data } = await db.from('contracts')
    .update({ status: 'voided' }).eq('id', id)
    .not('status', 'in', '("completed","voided")').select('id')
  if ((data ?? []).length === 0) return false
  await recordEvent(db, id, 'voided', actor)
  return true
}

export const STATUS_LABEL: Record<ContractStatus, string> = {
  draft: 'Draft',
  sent: 'Out for signature',
  viewed: 'Opened',
  partially_signed: 'Partly signed',
  completed: 'Fully signed',
  declined: 'Declined',
  voided: 'Voided',
  expired: 'Expired',
}

/** The wording §3.6 requires before anything can be signed. Held here so the
 *  studio and the portal cannot show two different sentences and so the exact
 *  text is recorded on the `consented` event. */
export const CONSENT_TEXT =
  'I agree to sign this document electronically, and I understand that my electronic signature is as binding as a handwritten one. This is not legal advice — review the document, and take independent advice before signing if you are unsure.'

// ── fields on a PDF (S3-b §3.3) ─────────────────────────────────────────────

/**
 * A box on a page that somebody has to fill.
 *
 * POSITIONS ARE FRACTIONS OF THE PAGE, not points. §3.3 says positions are
 * stored "so the field renders identically on every device and in the final
 * PDF" — which only holds if the unit survives a change of page size. A field at
 * x=0.62 is 62% across whether it is rendered in a browser at 900px wide or
 * stamped into a 595pt A4 page; a field at x=370 is correct on exactly one of
 * those.
 *
 * The origin is TOP-LEFT, because that is what every browser and every canvas
 * uses. PDF's own origin is bottom-left, and the conversion happens once, at the
 * stamping edge, rather than at every call site that ever touches a coordinate.
 */
export type FieldKind = 'signature' | 'initials' | 'date' | 'text' | 'checkbox'

export type ContractField = {
  id: string
  contract_id: string
  signer_id: string | null
  kind: FieldKind
  page: number
  x: number
  y: number
  w: number
  h: number
  required: boolean
  value: string | null
  filled_at: string | null
}

const FIELD_COLUMNS =
  'id, contract_id, signer_id, kind, page, x, y, w, h, required, value, filled_at'

export async function listFields(
  db: SupabaseClient, contractId: string
): Promise<ContractField[]> {
  const { data, error } = await db
    .from('contract_fields').select(FIELD_COLUMNS)
    .eq('contract_id', contractId)
    .order('page').order('y')
    .limit(500)
  if (error) throw new Error(`listFields: ${error.message}`)
  return (data ?? []) as unknown as ContractField[]
}

/**
 * Replace the whole field set for a contract.
 *
 * REPLACE, not merge — the placer shows every field at once, so a field the
 * person deleted is absent from what it sends, and a merge would make deletion
 * impossible. Same reasoning the availability editor used before it was removed.
 *
 * Refused once the contract has left draft: fields are part of what a signer was
 * shown, so moving one after sending changes the document without changing its
 * hash.
 */
export async function replaceFields(
  db: SupabaseClient,
  contractId: string,
  fields: Omit<ContractField, 'id' | 'contract_id' | 'value' | 'filled_at'>[]
): Promise<{ ok: boolean; reason?: 'NOT_DRAFT' | 'GONE' }> {
  const { data: contract } = await db
    .from('contracts').select('id, status').eq('id', contractId).maybeSingle()
  if (!contract) return { ok: false, reason: 'GONE' }
  if ((contract as { status: string }).status !== 'draft') {
    return { ok: false, reason: 'NOT_DRAFT' }
  }

  const { error: delErr } = await db
    .from('contract_fields').delete().eq('contract_id', contractId)
  if (delErr) throw new Error(`replaceFields: ${delErr.message}`)

  if (fields.length === 0) return { ok: true }

  const { error } = await db.from('contract_fields').insert(
    fields.map((f) => ({
      contract_id: contractId,
      signer_id: f.signer_id,
      kind: f.kind,
      page: f.page,
      x: f.x, y: f.y, w: f.w, h: f.h,
      required: f.required,
    }))
  )
  if (error) throw new Error(`replaceFields: ${error.message}`)
  return { ok: true }
}

/** Every required field belonging to this signer, answered. A signature that
 *  leaves a required initials box empty is an incomplete document that looks
 *  complete, which is the failure this check exists to prevent. */
export function outstandingFor(fields: ContractField[], signerId: string): ContractField[] {
  return fields.filter(
    (f) => f.signer_id === signerId && f.required && (f.value === null || f.value === '')
  )
}
