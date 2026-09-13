import 'server-only'
import {
  AccessToken, EgressClient, EncodedFileType, EncodedFileOutput, S3Upload,
} from 'livekit-server-sdk'

/**
 * LiveKit access tokens — minted server-side, per participant, per room.
 *
 * `S3-b` §2.3 states the rule this file exists to keep: **no token is ever
 * issued to a browser that has not passed the same RLS-backed check that would
 * let it read the meeting row.** A media token is a capability in the most
 * literal sense — whoever holds it is in the call — so it is minted only after
 * the meeting has been read on the USER client and come back non-null.
 *
 * ── LAZY, BECAUSE I-11 AND BECAUSE A DEPLOY SHOULD NOT DIE OVER IT ───────
 *
 * `lib/supabase/admin.ts` and `lib/r2.ts` build their clients at module scope
 * and both are recorded I-11 violations; `lib/stripe.ts` shows the pattern this
 * follows. It matters more than style here: Next collects page data at build
 * time, so a module-scope throw over a missing key fails the BUILD of every page
 * that transitively imports it — the failure mode
 * `reference_module-scope-sdk-clients` was written down for.
 *
 * With no keys set, `livekitConfigured()` is false and the surface says so in a
 * sentence. Meetings degrade to "not configured", which is what every other
 * optional integration in this repo does.
 */

export type LiveKitCreds = { key: string; secret: string; url: string }

/** Null rather than a throw: the caller decides whether absence is fatal. */
function creds(): LiveKitCreds | null {
  const key = process.env.LIVEKIT_API_KEY
  const secret = process.env.LIVEKIT_API_SECRET
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL
  if (!key || !secret || !url) return null
  return { key, secret, url }
}

export function livekitConfigured(): boolean {
  return creds() !== null
}

/** The websocket URL the browser connects to. Public by design — it is not a
 *  secret, and the TOKEN is what grants entry. */
export function livekitUrl(): string | null {
  return process.env.NEXT_PUBLIC_LIVEKIT_URL ?? null
}

export type JoinGrant = {
  roomName: string
  /** Stable per person, so reconnects are the same participant rather than a
   *  second ghost in the room. */
  identity: string
  displayName: string
  /** An OBSERVER joins muted and cannot publish — S3-b §2.1's third role, and
   *  the reason it is a token grant rather than a UI state is that a UI state
   *  is a suggestion. */
  canPublish: boolean
}

/**
 * A short-lived token scoped to ONE room.
 *
 * TEN MINUTES, not ten hours. The token only has to survive the join; LiveKit
 * keeps the session alive after that. A long TTL is a link somebody can forward
 * into a call they were removed from.
 */
export async function mintJoinToken(g: JoinGrant): Promise<string | null> {
  const c = creds()
  if (!c) return null

  const at = new AccessToken(c.key, c.secret, {
    identity: g.identity,
    name: g.displayName,
    ttl: '10m',
  })
  at.addGrant({
    room: g.roomName,
    roomJoin: true,
    canPublish: g.canPublish,
    canPublishData: true,   // the review-session playhead rides this
    canSubscribe: true,
  })
  return at.toJwt()
}

// ── recording ───────────────────────────────────────────────────────────────

/**
 * RECORDING GOES STRAIGHT FROM LIVEKIT TO R2, and that is the whole design.
 *
 * Egress composites the room server-side and uploads the finished MP4 to an
 * S3-compatible bucket itself. The bytes never pass through this application —
 * no serverless function holds a multi-gigabyte recording in memory, no
 * 4.5MB Vercel body limit applies, and nothing has to be resumed if a deploy
 * restarts mid-call. The same reasoning that made uploads direct-to-R2
 * (AD-004-R) applies with more force to a two-hour dailies session.
 *
 * R2 IS S3-COMPATIBLE, which is why this works at all: Egress speaks S3, and R2
 * answers. `region: 'auto'` is R2's requirement, not a placeholder.
 *
 * IT IS ASYNCHRONOUS AND THE SCHEMA ADMITS IT. Requesting a recording returns an
 * egress id, not a file. 0080 stores that id and a status so the surface can say
 * "processing" honestly rather than inferring readiness from whether an object
 * has appeared.
 */
function egress(): EgressClient | null {
  const c = creds()
  if (!c) return null
  // The HTTP API lives on the same host as the websocket endpoint.
  const httpUrl = c.url.replace(/^ws/, 'http')
  return new EgressClient(httpUrl, c.key, c.secret)
}

export function recordingConfigured(): boolean {
  return (
    livekitConfigured() &&
    !!process.env.R2_ACCESS_KEY_ID &&
    !!process.env.R2_SECRET_ACCESS_KEY &&
    !!process.env.R2_BUCKET_NAME &&
    !!process.env.R2_ACCOUNT_ID
  )
}

export type StartedRecording = { egressId: string; path: string }

export async function startRoomRecording(
  roomName: string, path: string
): Promise<StartedRecording | null> {
  const client = egress()
  if (!client || !recordingConfigured()) return null

  // Protobuf message instances, not plain objects — the SDK's generated types
  // reject a structural lookalike, which is the one place TypeScript saves you
  // from a runtime shape error at a vendor boundary.
  const output = new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath: path,
    output: {
      case: 's3',
      value: new S3Upload({
        accessKey: process.env.R2_ACCESS_KEY_ID!,
        secret: process.env.R2_SECRET_ACCESS_KEY!,
        bucket: process.env.R2_BUCKET_NAME!,
        // R2's requirement, not a placeholder.
        region: 'auto',
        endpoint: `https://${process.env.R2_ACCOUNT_ID!}.r2.cloudflarestorage.com`,
        forcePathStyle: true,
      }),
    },
  })

  const info = await client.startRoomCompositeEgress(
    roomName,
    output,
    {
      // `speaker` follows whoever is talking, which is wrong for a review
      // session: the thing being discussed is the picture, not the face of the
      // person discussing it. A grid keeps every reaction in frame.
      layout: 'grid',
    }
  )

  return { egressId: info.egressId, path }
}

export async function stopRoomRecording(egressId: string): Promise<boolean> {
  const client = egress()
  if (!client) return false
  try {
    await client.stopEgress(egressId)
    return true
  } catch {
    // Already stopped, or the room died first. Not an error worth failing a
    // request over — the status column is corrected by the next poll.
    return false
  }
}
