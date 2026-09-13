import 'server-only'
import { AccessToken } from 'livekit-server-sdk'

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
