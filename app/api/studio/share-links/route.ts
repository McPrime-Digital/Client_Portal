import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdmin, userOrgId } from '@/lib/auth/role'
import { capGate } from '@/lib/capabilities.server'
import { mintShareLink, revokeShareLink } from '@/lib/shareLinks'
import { appUrl } from '@/lib/appOrigin'
import { captureError } from '@/lib/errors'

/**
 * SCREENING LINKS, studio side — mint and withdraw.
 *
 * NO SERVICE-ROLE CLIENT. 0085's crew policy is the authorization, and
 * `mintShareLink` proves the asset is readable BY THIS CALLER before it writes
 * anything. That is the property that stops a share link becoming a way to
 * launder access: a scoped colourist cannot mint a link to a production they
 * cannot see, because the read that would authorize it returns nothing.
 *
 * ── THE URL IS RETURNED EXACTLY ONCE ─────────────────────────────────────
 *
 * Only the token's SHA-256 is stored, so this response is the only time the
 * working link exists anywhere. That is the same trade a password manager makes
 * and for the same reason — a database leak yields no working screeners.
 * The surface says so rather than letting somebody discover it by closing a
 * dialog.
 */

const Create = z.object({
  action: z.literal('create'),
  fileId: z.uuid(),
  title: z.string().trim().max(300).nullish(),
  // Null is "no expiry", which is a deliberate choice a person makes rather
  // than the default — the default below is a week.
  expiresInHours: z.number().int().min(1).max(24 * 90).nullable().optional(),
  passcode: z.string().trim().min(4).max(200).nullish(),
  maxViews: z.number().int().min(1).max(10_000).nullish(),
  allowDownload: z.boolean().optional(),
  watermark: z.boolean().optional(),
  requireEmail: z.boolean().optional(),
})

const Revoke = z.object({ action: z.literal('revoke'), id: z.uuid() })

const Body = z.discriminatedUnion('action', [Create, Revoke])

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const b = parsed.data

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  // Sending a cut outside the building is its own question, even though it
  // resolves to the same coarse capability as reading one today.
  const denied = await capGate(user, 'work.file.share')
  if (denied) return NextResponse.json(denied, { status: 403 })

  try {
    if (b.action === 'revoke') {
      const ok = await revokeShareLink(supabase, b.id)
      // The ROW is the witness: RLS refuses with zero rows and no error, so a
      // false here means "not yours, or already withdrawn" rather than a crash.
      if (!ok) {
        return NextResponse.json(
          { error: 'That link is already withdrawn, or is not yours.' }, { status: 404 }
        )
      }
      return NextResponse.json({ ok: true })
    }

    const minted = await mintShareLink(supabase, {
      organizationId: userOrgId(user),
      subjectKind: 'file',
      subjectId: b.fileId,
      title: b.title ?? null,
      expiresInHours: b.expiresInHours === undefined ? 168 : b.expiresInHours,
      passcode: b.passcode ?? null,
      maxViews: b.maxViews ?? null,
      allowDownload: b.allowDownload ?? false,
      watermark: b.watermark ?? true,
      requireEmail: b.requireEmail ?? true,
      createdBy: user.id,
    })
    if (!minted) {
      // Indistinguishable from "no such file", deliberately: a crew member
      // outside the production's scope learns nothing about what it contains.
      return NextResponse.json({ error: 'That file is not available.' }, { status: 404 })
    }

    return NextResponse.json({
      id: minted.link.id,
      // appUrl() throws on a missing origin rather than shipping
      // "undefined/s/<token>" — a dead link nobody but its recipient can see.
      url: appUrl(`/s/${minted.token}`),
    })
  } catch (e) {
    captureError(e, { route: 'studio/share-links', action: b.action })
    return NextResponse.json({ error: 'Could not do that.' }, { status: 500 })
  }
}
