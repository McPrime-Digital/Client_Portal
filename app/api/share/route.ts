import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  resolveShareLink, passcodeMatches, openView, heartbeatView,
} from '@/lib/shareLinks'
import { getSignedDownloadUrl } from '@/lib/r2'
import { actorFromHeaders } from '@/lib/contracts'
import { captureError } from '@/lib/errors'

/**
 * The screening room's only endpoint. No session, by design.
 *
 * ── THE PLAYBACK URL IS HANDED OUT AFTER THE GATE, NOT BEFORE ───────────
 *
 * The page renders the gate; only `open` — with a correct passcode and, where
 * required, an email — returns a signed URL. Rendering the URL into the page and
 * hiding the player behind a form would put the asset one devtools inspection
 * away, which is the difference between a gate and a curtain.
 *
 * ── ONE ANSWER FOR EVERY FAILURE ────────────────────────────────────────
 *
 * Unknown token, expired, revoked, view limit reached, wrong passcode — all the
 * same 404 sentence. Distinguishing them tells somebody holding a guessed token
 * which guesses are close, and tells somebody brute-forcing a passcode that the
 * token at least is real.
 *
 * ── THE EMAIL IS NOT VERIFIED, AND THE PRODUCT DOES NOT PRETEND IT IS ───
 *
 * Somebody can type anything. What it buys is that the watermark bears what they
 * typed alongside their IP and the timestamp — a leaked recording carries the
 * identity its viewer chose to give, which is exactly how every screener portal
 * in the industry works and is worth having without overclaiming.
 */

const GONE = { error: 'This link is no longer available.' }

const Body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('open'),
    token: z.string().min(20).max(200),
    passcode: z.string().max(200).nullish(),
    email: z.string().trim().email().max(320).nullish(),
    name: z.string().trim().max(200).nullish(),
  }),
  z.object({
    action: z.literal('heartbeat'),
    token: z.string().min(20).max(200),
    viewId: z.uuid(),
    secondsWatched: z.number().int().min(0).max(86_400),
    furthestMs: z.number().int().min(0).max(86_400_000),
    durationMs: z.number().int().min(0).max(86_400_000).nullish(),
  }),
])

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const b = parsed.data

  try {
    const link = await resolveShareLink(b.token)
    if (!link) return NextResponse.json(GONE, { status: 404 })

    if (b.action === 'heartbeat') {
      // The view id is scoped to this link server-side, so a heartbeat cannot
      // be pointed at somebody else's view row.
      const { data: view } = await supabaseAdmin
        .from('share_link_views').select('id').eq('id', b.viewId).eq('link_id', link.id).maybeSingle()
      if (!view) return NextResponse.json(GONE, { status: 404 })

      await heartbeatView({
        viewId: b.viewId,
        secondsWatched: b.secondsWatched,
        furthestMs: b.furthestMs,
        durationMs: b.durationMs ?? null,
      })
      return NextResponse.json({ ok: true })
    }

    if (!passcodeMatches(link, b.passcode ?? null)) {
      // Same sentence as an unknown token: a distinct "wrong passcode" confirms
      // the token is real, which is half the work of guessing one.
      return NextResponse.json(GONE, { status: 404 })
    }
    if (link.require_email && !b.email) {
      return NextResponse.json(
        { error: 'An email address is needed to open this.' }, { status: 400 }
      )
    }

    // Only files carry playback today; the other subject kinds exist so the
    // same link shape can carry them without a second table.
    if (link.subject_kind !== 'file') {
      return NextResponse.json(
        { error: 'That kind of link is not viewable yet.' }, { status: 409 }
      )
    }

    const { data: f } = await supabaseAdmin
      .from('files')
      .select('file_path, bucket, file_name, mime_type, colour_space, transfer, bit_depth')
      .eq('id', link.subject_id).is('deleted_at', null).maybeSingle()
    const file = f as {
      file_path: string; bucket: string; file_name: string; mime_type: string | null
      colour_space: string | null; transfer: string | null; bit_depth: number | null
    } | null
    if (!file || file.bucket !== 'r2') return NextResponse.json(GONE, { status: 404 })

    const actor = actorFromHeaders(req.headers, b.email ?? 'guest')
    const viewId = await openView({
      link,
      viewerEmail: b.email ?? null,
      viewerName: b.name ?? null,
      ip: actor.ip,
      userAgent: actor.userAgent,
    })

    // Long enough to outlast a feature-length screening: a URL that expires
    // mid-viewing is a broken player nobody can explain.
    const url = await getSignedDownloadUrl(file.file_path, 6 * 3600, {
      disposition: 'inline',
      fileName: file.file_name,
      contentType: file.mime_type ?? undefined,
    })

    return NextResponse.json({
      viewId,
      url,
      fileName: file.file_name,
      allowDownload: link.allow_download,
      watermark: link.watermark
        // What the mark bears. Their own identity, their address, and the
        // moment — so a screen recording carries who was watching.
        ? {
            label: b.email ?? b.name ?? 'guest',
            ip: actor.ip ?? '',
            at: new Date().toISOString(),
          }
        : null,
      colour: {
        colourSpace: file.colour_space,
        transfer: file.transfer,
        bitDepth: file.bit_depth,
      },
    })
  } catch (e) {
    captureError(e, { route: 'share', action: b.action })
    return NextResponse.json({ error: 'Could not open that.' }, { status: 500 })
  }
}
