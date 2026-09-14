import { NextRequest, NextResponse } from 'next/server'
import { WebhookReceiver } from 'livekit-server-sdk'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { enqueue } from '@/lib/jobs'
import { captureError } from '@/lib/errors'

/**
 * LiveKit tells us a recording finished.
 *
 * ── THE LOOP THIS CLOSES ─────────────────────────────────────────────────
 *
 * Egress is asynchronous: the request that stops a recording returns long before
 * the file exists. Until this route, `recording_status` went to `processing` and
 * stayed there forever — a recording that was started, stopped, written to R2,
 * and never became anything the product could show you. That was an open loop of
 * this repository's own making and it is the reason 0083's queue existed to
 * build at all.
 *
 * ── THE SIGNATURE IS THE AUTHENTICATION ──────────────────────────────────
 *
 * No session, by construction — LiveKit posts here, not a browser. The
 * `Authorization` header carries a JWT signed with the API secret, and
 * `WebhookReceiver.receive` verifies it AND the body hash. An unsigned or
 * mismatched payload is rejected before anything is read out of it, which is the
 * same shape `webhooks/stripe` already uses and the reason both sit on the I-8
 * allowlist as PERMANENT.
 *
 * ── IT ENQUEUES, IT DOES NOT WORK ────────────────────────────────────────
 *
 * A webhook that does the work is a webhook that times out and gets retried
 * while the first attempt is still running. This writes one row and returns; the
 * dedupe key means five deliveries of the same event produce one job.
 */

export async function POST(req: NextRequest) {
  const key = process.env.LIVEKIT_API_KEY
  const secret = process.env.LIVEKIT_API_SECRET
  if (!key || !secret) {
    return NextResponse.json({ error: 'LiveKit is not configured.' }, { status: 503 })
  }

  try {
    // The RAW body: the signature covers the exact bytes, so parsing first and
    // re-serialising would invalidate it.
    const body = await req.text()
    const auth = req.headers.get('authorization')
    if (!auth) return NextResponse.json({ error: 'Unsigned.' }, { status: 401 })

    const receiver = new WebhookReceiver(key, secret)
    const event = await receiver.receive(body, auth)

    if (event.event !== 'egress_ended') {
      // Everything else is acknowledged and ignored: returning non-2xx would
      // make LiveKit retry an event we were never going to act on.
      return NextResponse.json({ ok: true, ignored: event.event })
    }

    const info = event.egressInfo
    if (!info) return NextResponse.json({ ok: true, ignored: 'no egress info' })

    const { data: m } = await supabaseAdmin
      .from('meetings')
      .select('id, organization_id')
      .eq('recording_egress_id', info.egressId)
      .maybeSingle()
    const meeting = m as { id: string; organization_id: string } | null
    if (!meeting) return NextResponse.json({ ok: true, ignored: 'unknown egress' })

    const file = info.fileResults?.[0]
    if (!file?.filename) {
      await supabaseAdmin.from('meetings')
        .update({ recording_status: 'failed' }).eq('id', meeting.id)
      return NextResponse.json({ ok: true, failed: true })
    }

    await enqueue({
      organizationId: meeting.organization_id,
      kind: 'recording.ingest',
      payload: {
        meeting_id: meeting.id,
        path: file.filename,
        size: Number(file.size ?? 0),
      },
      // At-least-once delivery is the contract, so the same event WILL arrive
      // twice. One live job per egress id.
      dedupeKey: `recording:${info.egressId}`,
      priority: 10,
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    captureError(e, { webhook: 'livekit' })
    // A verification failure and a bug look the same from outside on purpose:
    // telling a caller WHICH is how they learn to probe.
    return NextResponse.json({ error: 'Rejected.' }, { status: 400 })
  }
}
