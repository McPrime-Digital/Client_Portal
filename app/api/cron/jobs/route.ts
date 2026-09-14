import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { claim, complete, fail, block, enqueue, type Job } from '@/lib/jobs'
import {
  requestTranscode, readTranscodeStatus, recordRendition, transcodeConfigured,
} from '@/lib/media'
import { tenantBrand } from '@/lib/tenantBrand'
import { senderForTenant } from '@/lib/mailSender'
import { notificationEmail } from '@/lib/email/messages'
import { sendMail } from '@/lib/email/send'
import { appUrl } from '@/lib/appOrigin'
import { captureError } from '@/lib/errors'

/**
 * THE WORKER TICK.
 *
 * Claims a small batch, runs each handler, records the outcome. Called by Vercel
 * cron; safe to call concurrently because 0083's `claim_jobs` uses SKIP LOCKED —
 * two ticks overlapping take disjoint sets rather than doing the same work
 * twice.
 *
 * ── SHORT BATCHES, NOT A LOOP UNTIL EMPTY ────────────────────────────────
 *
 * A serverless function has a wall clock. Draining the queue inside one
 * invocation means the last job is the one that gets killed half-finished, and a
 * half-finished job with a held lease is the worst state available. A small
 * batch per tick, with the lease expiring if the platform kills us mid-flight,
 * degrades into "try again shortly" instead.
 *
 * ── POLLING, NOT WEBHOOKS, FOR THE ENCODER ───────────────────────────────
 *
 * A transcode is requested once and then WATCHED: the job re-enqueues itself
 * with a delay until the encoder says ready. That avoids needing a publicly
 * reachable callback URL per environment — a preview deploy has a different
 * hostname, and a webhook pointed at the wrong one is silence. An encode
 * finishing four minutes late is not an emergency.
 *
 * ── FAILS OPEN IS NOT AN OPTION HERE ─────────────────────────────────────
 *
 * `message-nudge` only checks its bearer token IF CRON_SECRET is set, which
 * means an unset variable leaves it unauthenticated (HANDOFF records it as a
 * live I-8 defect). This route refuses to run without one, deliberately, rather
 * than copying the shape next door.
 */

export const maxDuration = 60

const BATCH = 5

async function runJob(job: Job): Promise<void> {
  switch (job.kind) {
    case 'media.transcode': {
      if (!transcodeConfigured()) {
        // BLOCKED, not dead: nobody configured it, and retrying five times will
        // not conjure a token. The distinction is a settings page vs a bug.
        await block(job.id, 'Transcoding is not configured on this deployment.')
        return
      }
      const fileId = String(job.payload.file_id ?? '')
      const { data: f } = await supabaseAdmin
        .from('files').select('id, organization_id, file_path, file_name, bucket')
        .eq('id', fileId).maybeSingle()
      const file = f as {
        id: string; organization_id: string; file_path: string
        file_name: string; bucket: string
      } | null
      if (!file || file.bucket !== 'r2') {
        await block(job.id, 'The source file is not in the vault.')
        return
      }

      const out = await requestTranscode(file.file_path, file.file_name)
      if (!out.ok) {
        if (out.blocked) await block(job.id, out.reason)
        else await fail(job, out.reason)
        return
      }

      await recordRendition({
        organizationId: file.organization_id,
        fileId: file.id,
        kind: 'stream',
        providerUid: out.providerUid,
        playbackUrl: out.playbackUrl || null,
        thumbnailUrl: out.thumbnailUrl,
        status: 'processing',
      })

      // Watch it. Separate job so a slow encode never holds this tick open.
      await enqueue({
        organizationId: file.organization_id,
        kind: 'media.probe',
        payload: { file_id: file.id, uid: out.providerUid },
        dedupeKey: `probe:${out.providerUid}`,
        // An encode takes minutes; asking again in seconds is noise.
        runAfter: new Date(Date.now() + 60_000),
        maxAttempts: 60,
      })
      await complete(job.id, { uid: out.providerUid })
      return
    }

    case 'media.probe': {
      const uid = String(job.payload.uid ?? '')
      const fileId = String(job.payload.file_id ?? '')
      const status = await readTranscodeStatus(uid)
      if (!status) {
        await fail(job, 'Could not read the encoder status.')
        return
      }

      const { data: f } = await supabaseAdmin
        .from('files').select('organization_id').eq('id', fileId).maybeSingle()
      const orgId = (f as { organization_id: string } | null)?.organization_id
      if (!orgId) { await block(job.id, 'The file is gone.'); return }

      await recordRendition({
        organizationId: orgId,
        fileId,
        kind: 'stream',
        providerUid: uid,
        playbackUrl: status.playbackUrl,
        thumbnailUrl: status.thumbnailUrl,
        status: status.state,
        durationSeconds: status.durationSeconds,
        width: status.width,
        height: status.height,
        error: status.error,
      })

      if (status.state === 'ready') {
        await complete(job.id, { state: 'ready' })
      } else if (status.state === 'failed') {
        await block(job.id, status.error ?? 'The encoder rejected this file.')
      } else {
        // Still working. `fail` is the retry path, and its backoff is exactly
        // the polling interval we want.
        await fail(job, `Encoder state: ${status.state}`)
      }
      return
    }

    case 'recording.ingest': {
      // Egress has written the object to R2 itself; this records it as a FILE so
      // it inherits the vault, its metering and its retention — the loop that
      // was open between starting a recording and having one.
      const meetingId = String(job.payload.meeting_id ?? '')
      const path = String(job.payload.path ?? '')
      const sizeBytes = Number(job.payload.size ?? 0) || null

      const { data: m } = await supabaseAdmin
        .from('meetings')
        .select('id, organization_id, project_id, client_id, mode, recording_file_id')
        .eq('id', meetingId).maybeSingle()
      const meeting = m as {
        id: string; organization_id: string; project_id: string | null
        client_id: string | null; mode: string; recording_file_id: string | null
      } | null
      if (!meeting) { await block(job.id, 'That meeting is gone.'); return }
      if (meeting.recording_file_id) { await complete(job.id, { already: true }); return }

      const { data: fileRow, error } = await supabaseAdmin.from('files').insert({
        organization_id: meeting.organization_id,
        project_id: meeting.project_id,
        client_id: meeting.client_id,
        file_name: `${meeting.mode === 'review_session' ? 'Review session' : 'Meeting'} recording.mp4`,
        file_path: path,
        file_size: sizeBytes,
        file_type: 'video/mp4',
        mime_type: 'video/mp4',
        bucket: 'r2',
        category: 'video',
      }).select('id').maybeSingle()
      if (error || !fileRow) { await fail(job, error?.message ?? 'Could not record the file.'); return }

      const fileId = (fileRow as { id: string }).id
      await supabaseAdmin.from('meetings').update({
        recording_file_id: fileId,
        recording_status: 'ready',
      }).eq('id', meetingId)

      // A recording nobody can scrub is an archive, not a review asset.
      await enqueue({
        organizationId: meeting.organization_id,
        kind: 'media.transcode',
        payload: { file_id: fileId },
        dedupeKey: `transcode:${fileId}`,
      })
      await complete(job.id, { file_id: fileId })
      return
    }

    case 'contract.notify': {
      // The loop that made sending a contract mean "copy the link yourself".
      const contractId = String(job.payload.contract_id ?? '')
      const { data: c } = await supabaseAdmin
        .from('contracts').select('id, organization_id, title').eq('id', contractId).maybeSingle()
      const contract = c as { id: string; organization_id: string; title: string } | null
      if (!contract) { await block(job.id, 'That contract is gone.'); return }

      const { data: signers } = await supabaseAdmin
        .from('contract_signers').select('id, name, email, user_id, status')
        .eq('contract_id', contractId)
      const rows = (signers ?? []) as { id: string; name: string; email: string; user_id: string | null; status: string }[]

      const brand = await tenantBrand(contract.organization_id)
      const sender = await senderForTenant(brand)
      let sent = 0
      const undelivered: string[] = []

      for (const s of rows) {
        if (s.status === 'signed' || s.status === 'declined') continue
        // A signer with an ACCOUNT gets a portal link. One without gets nothing
        // here on purpose: their route in is a single-use link the studio mints
        // and sends deliberately, and emailing a bearer credential unprompted is
        // not a decision a background job should make.
        if (!s.user_id) { undelivered.push(s.email); continue }

        const rendered = notificationEmail(brand, {
          title: `${contract.title} — your signature is needed`,
          body: `${brand.name} has sent you a document to review and sign.`,
          url: appUrl(`/dashboard/contracts/${contract.id}`),
        })
        if (await sendMail(s.email, rendered, sender)) sent += 1
        else undelivered.push(s.email)
      }

      // Recorded, not thrown: the contract is sent either way, and a delivery
      // failure that silently disappears is how Batch 10.4's second send path
      // went unnoticed for two commits.
      await complete(job.id, { sent, undelivered })
      return
    }

    default:
      await block(job.id, `No handler for ${job.kind}.`)
  }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    // Deliberately NOT message-nudge's shape: an unset variable there leaves the
    // endpoint unauthenticated (HANDOFF §8.3). Refusing is the correct failure.
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured; refusing to run.' }, { status: 503 }
    )
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const worker = `tick-${Math.random().toString(36).slice(2, 8)}`
  try {
    const jobs = await claim(worker, BATCH)
    const outcomes: { id: string; kind: string; ok: boolean }[] = []

    for (const job of jobs) {
      try {
        await runJob(job)
        outcomes.push({ id: job.id, kind: job.kind, ok: true })
      } catch (e) {
        // One bad job must not take the batch with it.
        await fail(job, e instanceof Error ? e.message : 'Handler threw.')
        captureError(e, { cron: 'jobs', job: job.id, kind: job.kind })
        outcomes.push({ id: job.id, kind: job.kind, ok: false })
      }
    }

    return NextResponse.json({ claimed: jobs.length, outcomes })
  } catch (e) {
    captureError(e, { cron: 'jobs' })
    return NextResponse.json({ error: 'Worker tick failed.' }, { status: 500 })
  }
}
