import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { resolveSigningLink, consumeSigningLink } from '@/lib/signingLinks'
import { actorFromHeaders, isSignersTurn, CONSENT_TEXT, type Signer } from '@/lib/contracts'
import { finalizeContract } from '@/lib/contractFinalize'
import { tenantBrand } from '@/lib/tenantBrand'
import { captureError } from '@/lib/errors'

/**
 * The anonymous signing endpoint.
 *
 * THIS IS THE ONLY ROUTE IN THE APPLICATION WITH NO SESSION AND NO RLS, and
 * every line of it is written on that basis. `S3-b` §3.7 asks for it by name;
 * `lib/signingLinks.ts` carries the I-8 justification.
 *
 * ── THE TOKEN IS THE ONLY AUTHORITY, SO NOTHING ELSE IS TRUSTED ──────────
 *
 * The body carries a token and NOTHING that identifies a contract, a signer or
 * a person. Every one of those is derived from the token, so a caller cannot
 * point a valid token at somebody else's document. That is the whole design:
 * the request has exactly one degree of freedom.
 *
 * ── ONE ANSWER FOR EVERY FAILURE ─────────────────────────────────────────
 *
 * Unknown, expired, revoked, used, or pointing at a deleted contract — all 404
 * with the same sentence. A probe learns nothing about which tokens exist.
 *
 * ── THE SAME ESIGN ORDER AS THE PORTAL PATH ──────────────────────────────
 *
 * Consent is recorded BEFORE the signature, with its exact wording, and the
 * signature is refused without it. A link signer gets a weaker IDENTITY proof
 * than a logged-in one — that is what `verification = 'email_link'` records on
 * the row, honestly, rather than pretending the two are equivalent.
 */

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('consent'), token: z.string().min(20).max(200) }),
  z.object({ action: z.literal('sign'), token: z.string().min(20).max(200) }),
  z.object({
    action: z.literal('decline'),
    token: z.string().min(20).max(200),
    reason: z.string().trim().max(1000).nullish(),
  }),
])

const GONE = { error: 'This signing link is no longer valid.' }

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const b = parsed.data

  try {
    const link = await resolveSigningLink(b.token)
    if (!link) return NextResponse.json(GONE, { status: 404 })

    const actor = actorFromHeaders(req.headers, link.signer.name)

    if (b.action === 'consent') {
      if (link.consented) return NextResponse.json({ ok: true, already: true })
      const { error } = await supabaseAdmin.from('contract_events').insert({
        contract_id: link.contract.id,
        signer_id: link.signer.id,
        event: 'consented',
        actor_name: actor.name,
        ip_address: actor.ip,
        user_agent: actor.userAgent,
        meta: { consent_text: CONSENT_TEXT, via: 'signing_link' },
      })
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true })
    }

    if (b.action === 'decline') {
      if (link.alreadySigned) {
        return NextResponse.json({ error: 'You have already signed this.' }, { status: 409 })
      }
      await supabaseAdmin.from('contract_signers')
        .update({ status: 'declined' }).eq('id', link.signer.id)
      await supabaseAdmin.from('contract_events').insert({
        contract_id: link.contract.id,
        signer_id: link.signer.id,
        event: 'declined',
        actor_name: actor.name,
        ip_address: actor.ip,
        user_agent: actor.userAgent,
        meta: { reason: b.reason ?? null, via: 'signing_link' },
      })
      await supabaseAdmin.from('contracts')
        .update({ status: 'declined' }).eq('id', link.contract.id)
      await consumeSigningLink(link.linkId)
      return NextResponse.json({ ok: true })
    }

    // sign
    if (link.alreadySigned) {
      return NextResponse.json({ error: 'You have already signed this.' }, { status: 409 })
    }
    if (!['sent', 'viewed', 'partially_signed'].includes(link.contract.status)) {
      return NextResponse.json({ error: 'This document is not open for signature.' }, { status: 409 })
    }
    if (!link.consented) {
      return NextResponse.json({ error: 'Agree to sign electronically first.' }, { status: 409 })
    }

    // Signing ORDER still applies to a link signer. The whole roster is read to
    // answer it, which is why this needs the service role rather than a
    // narrower read of one row.
    const { data: allSigners } = await supabaseAdmin
      .from('contract_signers')
      .select('id, contract_id, user_id, email, name, seq, status, verification, signed_at')
      .eq('contract_id', link.contract.id).order('seq')
    const signers = (allSigners ?? []) as unknown as Signer[]
    if (!isSignersTurn(signers, link.signer.id)) {
      return NextResponse.json({ error: 'Someone ahead of you still has to sign.' }, { status: 409 })
    }

    const now = new Date().toISOString()
    const { data: updated } = await supabaseAdmin.from('contract_signers')
      .update({ status: 'signed', signed_at: now })
      .eq('id', link.signer.id).neq('status', 'signed').select('id')
    if ((updated ?? []).length === 0) {
      return NextResponse.json({ error: 'You have already signed this.' }, { status: 409 })
    }

    await supabaseAdmin.from('contract_events').insert({
      contract_id: link.contract.id,
      signer_id: link.signer.id,
      event: 'signed',
      actor_name: actor.name,
      ip_address: actor.ip,
      user_agent: actor.userAgent,
      meta: { content_hash: link.contract.content_hash, via: 'signing_link' },
    })

    // Re-read: another signer may have landed in between.
    const { data: after } = await supabaseAdmin
      .from('contract_signers').select('status').eq('contract_id', link.contract.id)
    const all = (after ?? []).every((s) => (s as { status: string }).status === 'signed')
    await supabaseAdmin.from('contracts')
      .update({ status: all ? 'completed' : 'partially_signed' })
      .eq('id', link.contract.id)

    // Burn it only now. Viewing does not consume — opening the email on a phone
    // and signing on a laptop is the normal case, not an attack.
    await consumeSigningLink(link.linkId)

    if (all) {
      const brand = await tenantBrand(link.contract.organization_id)
      // supabaseAdmin, because this path has no session at all — the same
      // justification the whole route carries on the I-8 allowlist.
      const fin = await finalizeContract(supabaseAdmin, link.contract.id, brand.name)
      return NextResponse.json({
        ok: true, completed: true,
        sealed: fin.ok ? fin.sealed : false,
      })
    }

    return NextResponse.json({ ok: true, completed: false })
  } catch (e) {
    captureError(e, { route: 'sign', action: b.action })
    return NextResponse.json({ error: 'Could not complete that.' }, { status: 500 })
  }
}
