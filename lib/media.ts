import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getSignedDownloadUrl } from '@/lib/r2'

/**
 * THE MEDIA PIPELINE — transcode, probe, and where a rendition lives.
 *
 * ── WHY CLOUDFLARE STREAM AND NOT ffmpeg ─────────────────────────────────
 *
 * There is nowhere to run ffmpeg. Vercel functions are short-lived and
 * CPU-capped; a two-hour dailies session would not finish, and `ffmpeg.wasm` in
 * a browser is slower than the upload it follows. The honest options are a
 * container worker (a service to deploy, monitor and pay for) or a managed
 * encoder.
 *
 * Stream is the one that fits the bytes we already have: it ingests FROM A URL,
 * which means it pulls straight from a presigned R2 link — the file never passes
 * through this application in either direction, exactly as Egress writes
 * recordings back to R2 without touching us. It also delivers the adaptive
 * HLS/DASH ladder that makes review usable on a hotel wifi, which a single MP4
 * never will.
 *
 * ── WHAT THIS DOES AND DOES NOT CLAIM ────────────────────────────────────
 *
 * It produces a web-deliverable, adaptive rendition. It does NOT produce a
 * colour-managed reference stream: a true grading review needs 10-bit transport
 * and a calibrated display, and no managed encoder hands you that over HTTP
 * today. 0082's `ColourCheck` still warns where the display falls short, and
 * the master is untouched — which is the point of a RENDITION being a separate
 * row rather than an overwrite.
 *
 * ── A RENDITION NEVER REPLACES THE MASTER ────────────────────────────────
 *
 * The thing an editor approves and the thing a browser can play are not the same
 * object. Conflating them loses the original, which is the same argument
 * `S3-core` §3.2 makes about a version being a file.
 */

export type StreamConfig = { accountId: string; token: string }

/** Null rather than a throw — the caller decides whether absence is fatal, and
 *  for a job it is `blocked`, not `dead` (I-11's lazy-accessor rule). */
function streamConfig(): StreamConfig | null {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.R2_ACCOUNT_ID
  const token = process.env.CLOUDFLARE_STREAM_TOKEN
  if (!accountId || !token) return null
  return { accountId, token }
}

export function transcodeConfigured(): boolean {
  return streamConfig() !== null
}

export type TranscodeOutcome =
  | { ok: true; providerUid: string; playbackUrl: string; thumbnailUrl: string | null }
  | { ok: false; blocked: true; reason: string }
  | { ok: false; blocked: false; reason: string }

/**
 * Hand Stream a URL and let it pull.
 *
 * The presigned link is deliberately SHORT-LIVED but long enough for the pull to
 * start: Stream copies the object, so the URL only has to survive the fetch, not
 * the encode. A long-lived link would be a readable copy of the master sitting
 * in a third party's job record.
 */
export async function requestTranscode(
  filePath: string, fileName: string
): Promise<TranscodeOutcome> {
  const cfg = streamConfig()
  if (!cfg) {
    return {
      ok: false, blocked: true,
      reason: 'Transcoding is not configured on this deployment. Set CLOUDFLARE_STREAM_TOKEN (and CLOUDFLARE_ACCOUNT_ID if it differs from R2_ACCOUNT_ID).',
    }
  }

  try {
    const source = await getSignedDownloadUrl(filePath, 1800, { disposition: 'inline' })

    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/stream/copy`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: source,
          meta: { name: fileName },
          // The studio's own asset, not a public video. Signed playback is what
          // keeps a cut from being shareable by URL alone.
          requireSignedURLs: true,
        }),
      }
    )

    const body = await res.json().catch(() => null) as {
      success?: boolean
      result?: { uid?: string; playback?: { hls?: string; dash?: string }; thumbnail?: string }
      errors?: { message?: string }[]
    } | null

    if (!res.ok || !body?.success || !body.result?.uid) {
      const detail = body?.errors?.map((e) => e.message).filter(Boolean).join('; ')
      return {
        ok: false, blocked: false,
        reason: detail || `Stream refused the copy (HTTP ${res.status}).`,
      }
    }

    return {
      ok: true,
      providerUid: body.result.uid,
      playbackUrl: body.result.playback?.hls ?? '',
      thumbnailUrl: body.result.thumbnail ?? null,
    }
  } catch (e) {
    return {
      ok: false, blocked: false,
      reason: e instanceof Error ? e.message : 'Could not reach the encoder.',
    }
  }
}

export type StreamStatus = {
  state: 'pending' | 'processing' | 'ready' | 'failed'
  durationSeconds: number | null
  width: number | null
  height: number | null
  playbackUrl: string | null
  thumbnailUrl: string | null
  error: string | null
}

/** Ask the encoder where it got to. Polled by the job rather than pushed,
 *  because a webhook needs a public URL per environment and a poll does not —
 *  and an encode finishing four minutes late is not an emergency. */
export async function readTranscodeStatus(uid: string): Promise<StreamStatus | null> {
  const cfg = streamConfig()
  if (!cfg) return null

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/stream/${uid}`,
    { headers: { Authorization: `Bearer ${cfg.token}` } }
  )
  const body = await res.json().catch(() => null) as {
    success?: boolean
    result?: {
      status?: { state?: string; errorReasonText?: string }
      duration?: number
      input?: { width?: number; height?: number }
      playback?: { hls?: string }
      thumbnail?: string
    }
  } | null

  if (!res.ok || !body?.success || !body.result) return null
  const r = body.result
  const state = r.status?.state === 'ready' ? 'ready'
    : r.status?.state === 'error' ? 'failed'
    : r.status?.state === 'inprogress' ? 'processing'
    : 'pending'

  return {
    state,
    durationSeconds: typeof r.duration === 'number' && r.duration > 0 ? r.duration : null,
    width: r.input?.width ?? null,
    height: r.input?.height ?? null,
    playbackUrl: r.playback?.hls ?? null,
    thumbnailUrl: r.thumbnail ?? null,
    error: r.status?.errorReasonText ?? null,
  }
}

/** Upsert the rendition row. One per (file, kind, provider) — the unique index
 *  in 0083 is what stops a retried job creating a second. */
export async function recordRendition(p: {
  organizationId: string
  fileId: string
  kind: 'stream' | 'proxy' | 'thumbnail'
  providerUid?: string | null
  playbackUrl?: string | null
  thumbnailUrl?: string | null
  status: 'pending' | 'processing' | 'ready' | 'failed'
  durationSeconds?: number | null
  width?: number | null
  height?: number | null
  error?: string | null
}): Promise<void> {
  const { error } = await supabaseAdmin.from('media_renditions').upsert({
    organization_id: p.organizationId,
    file_id: p.fileId,
    kind: p.kind,
    provider: 'cloudflare_stream',
    provider_uid: p.providerUid ?? null,
    playback_url: p.playbackUrl ?? null,
    thumbnail_url: p.thumbnailUrl ?? null,
    status: p.status,
    duration_seconds: p.durationSeconds ?? null,
    width: p.width ?? null,
    height: p.height ?? null,
    error: p.error ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'file_id,kind,provider' })
  if (error) throw new Error(`recordRendition: ${error.message}`)
}
