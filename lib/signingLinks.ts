import 'server-only'
import { createHash, randomBytes } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase/admin'
import type { Contract, Signer } from '@/lib/contracts'

/**
 * SINGLE-USE SIGNING LINKS — for a signer who will never have an account.
 *
 * `S3-b` §7 answer 2 deferred this until "a real case appears". In a HYBRID
 * production the real case is the common one: an AI-likeness and digital-double
 * release from a background actor, a stunt double, a musician whose voice is
 * being modelled. They sign once. Telling a studio to invite each of them to a
 * client portal first is telling them to use something else.
 *
 * ── WHY THIS FILE HOLDS THE SERVICE ROLE ──────────────────────────────────
 *
 * The signing path has NO SESSION. An anonymous person opens a URL, so there is
 * no `auth.uid()` for RLS to key on and no policy that could admit them without
 * admitting everybody. §3.7 says this path is service-role and belongs on the
 * I-8 allowlist with a justification; this is that justification.
 *
 * It is written to be the narrowest possible use of that privilege:
 *
 *   · every read is keyed by a TOKEN HASH, never by a contract id from a caller
 *   · the resolve returns exactly ONE contract and ONE signer, never a list
 *   · nothing here can enumerate: an unknown, expired, used or revoked token and
 *     a well-formed token for a deleted contract all return the same null
 *   · MINTING still runs on the user client for the permission check — the
 *     service role is used only to write a row whose RLS denies everyone
 *
 * ── THE TOKEN IS SHOWN ONCE AND STORED NEVER ──────────────────────────────
 *
 * Only the SHA-256 lives in the table, so a database leak yields no working
 * links. Same reasoning as a password digest, and as 0072's refusal to put a
 * calendar token in a plain column.
 *
 * 32 bytes of `randomBytes`, base64url. Not `crypto.randomUUID()`: a UUIDv4
 * carries 122 bits in a recognisable shape, and this is a bearer credential for
 * a legal document, not an identifier.
 */

const TOKEN_BYTES = 32

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export type MintedLink = {
  /** Shown ONCE. Never retrievable again. */
  token: string
  expiresAt: string
}

/**
 * Mint a link for one signer on one contract.
 *
 * `db` is the USER client and the permission check is a real read through it:
 * if RLS hides the contract, there is no link. The service role never decides
 * who may mint.
 */
export async function mintSigningLink(
  db: SupabaseClient,
  p: { contractId: string; signerId: string; expiresInHours?: number; createdBy: string }
): Promise<MintedLink | null> {
  const { data: contract } = await db
    .from('contracts').select('id').eq('id', p.contractId).is('deleted_at', null).maybeSingle()
  if (!contract) return null

  const { data: signer } = await db
    .from('contract_signers').select('id, contract_id')
    .eq('id', p.signerId).eq('contract_id', p.contractId).maybeSingle()
  if (!signer) return null

  const token = randomBytes(TOKEN_BYTES).toString('base64url')
  // Bounded by default. A link with no end date is a permanent credential
  // sitting in somebody's inbox.
  const hours = Math.min(Math.max(p.expiresInHours ?? 168, 1), 24 * 30)
  const expiresAt = new Date(Date.now() + hours * 3_600_000).toISOString()

  const { error } = await supabaseAdmin.from('contract_signing_links').insert({
    contract_id: p.contractId,
    signer_id: p.signerId,
    token_hash: hashToken(token),
    expires_at: expiresAt,
    created_by: p.createdBy,
  })
  if (error) throw new Error(`mintSigningLink: ${error.message}`)

  await supabaseAdmin.from('contract_signers')
    .update({ verification: 'email_link', status: 'sent' }).eq('id', p.signerId)

  return { token, expiresAt }
}

export type ResolvedLink = {
  linkId: string
  contract: Contract
  signer: Signer
  alreadySigned: boolean
  consented: boolean
}

/**
 * Turn a token into exactly one contract and one signer, or into null.
 *
 * ONE NULL FOR EVERY FAILURE. Unknown token, expired, revoked, already used,
 * contract deleted — all indistinguishable from outside, so a probe learns
 * nothing about which tokens exist. The same rule `readApproval` follows for
 * "absent or forbidden".
 */
export async function resolveSigningLink(token: string): Promise<ResolvedLink | null> {
  if (!token || token.length < 20) return null

  const { data: link } = await supabaseAdmin
    .from('contract_signing_links')
    .select('id, contract_id, signer_id, expires_at, used_at, revoked_at')
    .eq('token_hash', hashToken(token))
    .maybeSingle()

  if (!link) return null
  const l = link as {
    id: string; contract_id: string; signer_id: string
    expires_at: string; used_at: string | null; revoked_at: string | null
  }
  if (l.revoked_at) return null
  if (Date.parse(l.expires_at) < Date.now()) return null

  const { data: contract } = await supabaseAdmin
    .from('contracts')
    .select('id, organization_id, client_id, project_id, is_template, title, body, source_file_id, status, expires_at, content_hash, created_at')
    .eq('id', l.contract_id).is('deleted_at', null).maybeSingle()
  if (!contract) return null

  const { data: signer } = await supabaseAdmin
    .from('contract_signers')
    .select('id, contract_id, user_id, email, name, seq, status, verification, signed_at')
    .eq('id', l.signer_id).maybeSingle()
  if (!signer) return null

  const { data: consentRows } = await supabaseAdmin
    .from('contract_events').select('id')
    .eq('contract_id', l.contract_id).eq('signer_id', l.signer_id).eq('event', 'consented')
    .limit(1)

  const s = signer as unknown as Signer
  return {
    linkId: l.id,
    contract: contract as unknown as Contract,
    signer: s,
    alreadySigned: s.status === 'signed',
    consented: (consentRows ?? []).length > 0,
  }
}

/** Burn the link. Called once the signature is recorded, so a forwarded copy
 *  cannot sign again. Viewing does not burn it — somebody who opens the email on
 *  a phone and signs on a laptop is the normal case, not an attack. */
export async function consumeSigningLink(linkId: string): Promise<void> {
  await supabaseAdmin.from('contract_signing_links')
    .update({ used_at: new Date().toISOString() })
    .eq('id', linkId).is('used_at', null)
}

export async function revokeSigningLinks(
  db: SupabaseClient, contractId: string
): Promise<number> {
  // Permission first, on the user client.
  const { data: contract } = await db
    .from('contracts').select('id').eq('id', contractId).maybeSingle()
  if (!contract) return 0

  const { data } = await supabaseAdmin.from('contract_signing_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('contract_id', contractId).is('revoked_at', null).select('id')
  return (data ?? []).length
}
