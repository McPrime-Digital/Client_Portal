import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { can } from '@/lib/capabilities.server'
import {
  readContract, recordConsent, markViewed, sign, declineContract,
  actorFromHeaders, CONSENT_TEXT,
} from '@/lib/contracts'
import { finalizeContract } from '@/lib/contractFinalize'
import { tenantBrand } from '@/lib/tenantBrand'
import { captureError } from '@/lib/errors'

/**
 * Signing, client side — open, consent, sign, decline.
 *
 * ── THE CONTROL HERE IS IDENTITY, NOT A CAPABILITY ────────────────────────
 *
 * Every other portal route asks "may this ROLE do this". A signature asks
 * something narrower and stricter: are you THE PERSON NAMED. A client owner with
 * every capability in the matrix still cannot sign on a colleague's behalf, so
 * the signer row is resolved from `auth.uid()` and never from the body — the
 * caller does not get to say who they are.
 *
 * `portal.view` is checked first only to keep a revoked seat out; it is not what
 * authorizes the signature.
 *
 * ── CONSENT BEFORE SIGNATURE, AND THE ORDER IS THE POINT (§3.6) ───────────
 *
 * ESIGN/UETA want consent to transact electronically recorded BEFORE the
 * signature, so `sign()` refuses without a `consented` event for that signer.
 * The exact wording is stored on the event rather than assumed, because "they
 * consented" is worth nothing in a dispute without "to this text".
 *
 * ── EVERY ACTION LEAVES AN IP AND A USER AGENT ────────────────────────────
 *
 * Personal data, collected because an enforceable record requires it, and kept
 * for the contract's life. §3.5 records that tension rather than resolving it,
 * and so does this: the AD-003 tombstone pseudonymises the NAME on these rows
 * and deliberately leaves the address, because removing it destroys the
 * evidentiary value the table exists for.
 */

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('open'), contractId: z.uuid() }),
  z.object({ action: z.literal('consent'), contractId: z.uuid() }),
  z.object({ action: z.literal('sign'), contractId: z.uuid() }),
  z.object({
    action: z.literal('fill-field'),
    contractId: z.uuid(),
    fieldId: z.uuid(),
    value: z.string().max(500).nullable(),
  }),
  z.object({
    action: z.literal('decline'),
    contractId: z.uuid(),
    reason: z.string().trim().max(1000).nullish(),
  }),
])

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await can(user, 'portal.view'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request.' }, { status: 400 }
    )
  }
  const b = parsed.data

  try {
    const detail = await readContract(supabase, b.contractId)
    if (!detail) return NextResponse.json({ error: 'No such contract.' }, { status: 404 })

    // THE identity check. Not a parameter.
    const me = detail.signers.find((s) => s.user_id === user.id)
    if (!me) {
      return NextResponse.json(
        { error: 'You are not a signer on this document.' }, { status: 403 }
      )
    }

    const actor = actorFromHeaders(req.headers, me.name)

    if (b.action === 'open') {
      await markViewed(supabase, b.contractId, me.id, actor)
      return NextResponse.json({ ok: true })
    }

    if (b.action === 'consent') {
      const already = detail.events.some(
        (e) => e.event === 'consented' && e.signer_id === me.id
      )
      if (already) return NextResponse.json({ ok: true, already: true })
      await recordConsent(
        supabase,
        { contractId: b.contractId, signerId: me.id, consentText: CONSENT_TEXT },
        actor
      )
      return NextResponse.json({ ok: true })
    }

    if (b.action === 'fill-field') {
      // The field must belong to THIS signer. 0068's
      // contract_fields_signer_update enforces it on the row; this is the
      // message, not the control.
      const { data } = await supabase.from('contract_fields')
        .update({ value: b.value, filled_at: new Date().toISOString() })
        .eq('id', b.fieldId).eq('signer_id', me.id).select('id')
      if ((data ?? []).length === 0) {
        return NextResponse.json({ error: 'That field is not yours.' }, { status: 403 })
      }
      return NextResponse.json({ ok: true })
    }

    if (b.action === 'sign') {
      const out = await sign(supabase, { contractId: b.contractId, signerId: me.id }, actor)
      if (!out.ok) {
        const message = {
          NOT_YOUR_TURN: 'Someone ahead of you still has to sign.',
          NO_CONSENT: 'Agree to sign electronically first.',
          ALREADY: 'You have already signed this.',
          NOT_SENT: 'This document is not open for signature.',
          GONE: 'No such contract.',
          FIELDS_OUTSTANDING: 'Fill in every required box before signing.',
        }[out.reason]
        return NextResponse.json({ error: message }, { status: out.reason === 'GONE' ? 404 : 409 })
      }
      if (out.completed) {
        // The signature is already recorded; the artifact is a convenience copy,
        // so a failure here is reported and never unwinds the signature.
        const brand = await tenantBrand(detail.contract.organization_id)
        const fin = await finalizeContract(supabase, b.contractId, brand.name)
        return NextResponse.json({
          ok: true, completed: true,
          sealed: fin.ok ? fin.sealed : false,
          note: fin.ok ? fin.reason : fin.reason,
        })
      }
      return NextResponse.json({ ok: true, completed: false })
    }

    const declined = await declineContract(
      supabase, { contractId: b.contractId, signerId: me.id, reason: b.reason ?? null }, actor
    )
    if (!declined) {
      return NextResponse.json({ error: 'You have already signed this.' }, { status: 409 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    captureError(e, { route: 'portal/contracts', action: b.action })
    return NextResponse.json({ error: 'Could not complete that.' }, { status: 500 })
  }
}
