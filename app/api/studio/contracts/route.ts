import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdmin, userOrgId } from '@/lib/auth/role'
import { capGate } from '@/lib/capabilities.server'
import { rosterName } from '@/lib/team'
import {
  createContract, addSigner, sendContract, voidContract, actorFromHeaders,
} from '@/lib/contracts'
import { mintSigningLink, revokeSigningLinks } from '@/lib/signingLinks'
import { appUrl } from '@/lib/appOrigin'
import { captureError } from '@/lib/errors'

/**
 * Contracts, studio side — draft, staff the signers, send, void.
 *
 * NO SERVICE-ROLE CLIENT. 0068's policies are the authorization: a crew member
 * reaches a contract through org membership and project scope, a client member
 * through their company. The signing record itself is append-only by TRIGGER,
 * so even this route cannot rewrite an event it wrote a moment ago.
 *
 * ── A SIGNER IS RESOLVED TO A PLATFORM ACCOUNT, OR REFUSED ────────────────
 *
 * `S3-b` §7 answer 2: v1 requires signers to be portal members. The
 * single-use-link path for an outside counterparty is a service-role surface on
 * a legal document and is not built — `contract_signers.user_id` stays nullable
 * so that path remains expressible the day it is.
 *
 * So adding a signer looks the address up in `client_members` FOR THIS ORG and
 * refuses when it finds nobody. The alternative is a contract addressed to
 * somebody who can never open it, which fails silently and late.
 */

const Create = z.object({
  action: z.literal('create'),
  title: z.string().trim().min(1).max(300),
  bodyText: z.string().trim().min(1).max(200_000),
  clientId: z.uuid().nullish(),
  projectId: z.uuid().nullish(),
  expiresAt: z.iso.datetime({ offset: true }).nullish(),
  // A RELEASE is a contract that grants rights over an asset (0079). Naming the
  // instrument and the asset is what lets a completed signature WRITE the rights
  // record instead of leaving somebody to tick a box that nothing substantiates.
  releaseKind: z.enum(['appearance', 'ai_likeness', 'location', 'music']).nullish(),
  subjectFileId: z.uuid().nullish(),
  // CAWG's own vocabulary, so it reaches `rights` untranslated. Defaults to
  // notAllowed: a release silent about AI training did not grant it.
  aiTraining: z.enum(['allowed', 'notAllowed', 'constrained']).optional(),
})

const AddSigner = z.object({
  action: z.literal('add-signer'),
  contractId: z.uuid(),
  email: z.email().max(320),
  name: z.string().trim().min(1).max(200),
  seq: z.number().int().min(0).max(50).optional(),
  /** An outside counterparty — a background actor signing an AI-likeness
   *  release, a location owner — who will never hold an account. They reach the
   *  document through a single-use link instead of a session (S3-b §3.7). */
  external: z.boolean().optional(),
})

const MintLink = z.object({
  action: z.literal('mint-link'),
  contractId: z.uuid(),
  signerId: z.uuid(),
  expiresInHours: z.number().int().min(1).max(720).optional(),
})

const RevokeLinks = z.object({ action: z.literal('revoke-links'), contractId: z.uuid() })

const Send = z.object({ action: z.literal('send'), contractId: z.uuid() })
const Void = z.object({ action: z.literal('void'), contractId: z.uuid() })

const Body = z.discriminatedUnion('action', [
  Create, AddSigner, Send, Void, MintLink, RevokeLinks,
])

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const denied = await capGate(user, 'record.contract.write')
  if (denied) return NextResponse.json(denied, { status: 403 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request.' }, { status: 400 }
    )
  }
  const b = parsed.data
  // The roster name, falling back to the address — `actor_name` is NOT NULL on
  // the signing record, and an event that cannot name who acted is not evidence.
  const actor = actorFromHeaders(
    req.headers,
    (await rosterName(user)) ?? user.email ?? 'Unknown'
  )

  try {
    if (b.action === 'create') {
      const contract = await createContract(supabase, {
        organizationId: userOrgId(user),
        title: b.title,
        bodyText: b.bodyText,
        clientId: b.clientId ?? null,
        projectId: b.projectId ?? null,
        expiresAt: b.expiresAt ?? null,
        releaseKind: b.releaseKind ?? null,
        subjectFileId: b.subjectFileId ?? null,
        aiTraining: b.aiTraining ?? 'notAllowed',
      }, actor)
      if (!contract) {
        return NextResponse.json(
          { error: 'That production is not in your scope.' }, { status: 403 }
        )
      }
      return NextResponse.json({ id: contract.id })
    }

    if (b.action === 'mint-link') {
      const link = await mintSigningLink(supabase, {
        contractId: b.contractId,
        signerId: b.signerId,
        expiresInHours: b.expiresInHours,
        createdBy: user.id,
      })
      if (!link) return NextResponse.json({ error: 'Not permitted.' }, { status: 403 })
      // SHOWN ONCE. The token is hashed at rest and cannot be retrieved again,
      // which is the property that makes a database leak yield no live links.
      return NextResponse.json({
        url: appUrl(`/sign/${link.token}`),
        expiresAt: link.expiresAt,
      })
    }

    if (b.action === 'revoke-links') {
      const n = await revokeSigningLinks(supabase, b.contractId)
      return NextResponse.json({ ok: true, revoked: n })
    }

    if (b.action === 'add-signer') {
      // An EXTERNAL signer is not looked up: by definition there is no account
      // to find. They are verified by holding the link, and the row records
      // that with verification='email_link'.
      if (b.external) {
        const { data: existing } = await supabase
          .from('contract_signers').select('seq').eq('contract_id', b.contractId)
          .order('seq', { ascending: false }).limit(1)
        const seq = b.seq ?? ((existing?.[0]?.seq as number | undefined) ?? -1) + 1

        const signer = await addSigner(supabase, {
          contractId: b.contractId, name: b.name, email: b.email, userId: null, seq,
        })
        if (!signer) return NextResponse.json({ error: 'Not permitted.' }, { status: 403 })
        return NextResponse.json({ id: signer.id, external: true })
      }

      const { data: member } = await supabase
        .from('client_members')
        .select('user_id, name')
        .eq('organization_id', userOrgId(user))
        .eq('email', b.email)
        .eq('status', 'active')
        .maybeSingle()

      if (!member?.user_id) {
        return NextResponse.json({
          error: 'That address is not on a client team. Add them as an outside signer instead, and send them a single-use link.',
        }, { status: 409 })
      }

      // Next in line unless told otherwise, so the common case needs no input.
      let seq = b.seq
      if (seq === undefined) {
        const { data: existing } = await supabase
          .from('contract_signers').select('seq').eq('contract_id', b.contractId)
          .order('seq', { ascending: false }).limit(1)
        seq = ((existing?.[0]?.seq as number | undefined) ?? -1) + 1
      }

      const signer = await addSigner(supabase, {
        contractId: b.contractId,
        name: b.name,
        email: b.email,
        userId: member.user_id as string,
        seq,
      })
      if (!signer) return NextResponse.json({ error: 'Not permitted.' }, { status: 403 })
      return NextResponse.json({ id: signer.id })
    }

    if (b.action === 'send') {
      const out = await sendContract(supabase, b.contractId, actor)
      if (!out.ok) {
        const message =
          out.reason === 'NO_SIGNERS'
            ? 'Add at least one signer first — a contract with none would complete the moment it was opened.'
            : out.reason === 'NOT_DRAFT'
              ? 'This has already been sent.'
              : 'No such contract.'
        return NextResponse.json({ error: message }, { status: out.reason === 'GONE' ? 404 : 409 })
      }
      return NextResponse.json({ ok: true })
    }

    const voided = await voidContract(supabase, b.contractId, actor)
    if (!voided) {
      return NextResponse.json(
        { error: 'A fully signed contract cannot be voided.' }, { status: 409 }
      )
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof Error && e.message === 'SEQ_TAKEN') {
      return NextResponse.json(
        { error: 'That signing position is already taken.' }, { status: 409 }
      )
    }
    captureError(e, { route: 'studio/contracts', action: b.action })
    return NextResponse.json({ error: 'Could not complete that.' }, { status: 500 })
  }
}
