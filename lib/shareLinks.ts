import 'server-only'
import { createHash, randomBytes } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase/admin'

/**
 * SCREENING LINKS — a cut, shown to somebody with no account, traceably.
 *
 * ── WHAT THE MARKET DOES, AND WHERE IT STOPS ─────────────────────────────
 *
 * A no-signup review link is table stakes. Dynamic watermarking is not:
 * Dropbox Replay has it on every paid plan, **Frame.io gates it behind
 * Enterprise**, and MediaSilo goes furthest with session-based watermarked
 * streams and full audit logs. Studied and NOT copied: papermark (AGPL-3.0 — a
 * network-served derivative would oblige this product to publish its source),
 * cloakshare (MIT, and its feature set is the sanity check for this one).
 *
 * **Where all of them stop is EVIDENCE.** They record views for analytics — an
 * engagement dashboard. None connects the view to the DECISION, and in a
 * production that is the interesting fact: somebody who opened a cut for four
 * seconds and approved it is not the same record as somebody who watched
 * ninety-two percent and approved it. `approvalIntel` already grades how well a
 * record would hold up; this is the first thing that can tell it what the
 * approver actually saw.
 *
 * ── THE TOKEN IS NEVER STORED, AND ONE NULL MEANS EVERYTHING ────────────
 *
 * Only the SHA-256, exactly as 0078's signing links. And every failure — unknown
 * token, expired, revoked, view limit reached, subject deleted — returns the
 * same null, so a probe learns nothing about which tokens exist.
 *
 * ── WATERMARKING: WHAT THIS IS AND IS NOT ───────────────────────────────
 *
 * The mark is rendered IN THE PLAYER, bearing the viewer's own identity, their
 * IP and the time, and it MOVES. That is aimed squarely at the actual leak
 * vector for a screener — somebody pointing a screen recorder at it — because a
 * screen capture carries the overlay with it, and a moving mark cannot be
 * cropped out without destroying the frame.
 *
 * It is NOT invisible forensic watermarking. That needs a per-recipient encode;
 * `facebookresearch/videoseal` is MIT and is exactly the tool, but it is
 * Python and GPU-bound, so it belongs in the job queue (0083) as a worker rather
 * than pretending here. Claiming forensic protection we do not have would be
 * worse than claiming none.
 */

const TOKEN_BYTES = 32

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export type ShareSubjectKind = 'file' | 'project' | 'approval'

export type ShareLink = {
  id: string
  organization_id: string
  subject_kind: ShareSubjectKind
  subject_id: string
  title: string | null
  expires_at: string | null
  passcode_hash: string | null
  max_views: number | null
  view_count: number
  allow_download: boolean
  watermark: boolean
  require_email: boolean
  revoked_at: string | null
  created_at: string
}

const COLUMNS =
  'id, organization_id, subject_kind, subject_id, title, expires_at, passcode_hash, max_views, view_count, allow_download, watermark, require_email, revoked_at, created_at'

export type MintParams = {
  organizationId: string
  subjectKind: ShareSubjectKind
  subjectId: string
  title?: string | null
  expiresInHours?: number | null
  passcode?: string | null
  maxViews?: number | null
  allowDownload?: boolean
  watermark?: boolean
  requireEmail?: boolean
  createdBy: string
}

/**
 * Mint a link.
 *
 * `db` is the USER client and the permission check is a real read through it: if
 * RLS hides the asset, there is no link. The service role never decides who may
 * share — which is the property that stops a share link becoming a way to
 * launder access to something you could not otherwise see.
 */
export async function mintShareLink(
  db: SupabaseClient, p: MintParams
): Promise<{ token: string; link: ShareLink } | null> {
  if (p.subjectKind === 'file') {
    const { data } = await db.from('files').select('id').eq('id', p.subjectId).maybeSingle()
    if (!data) return null
  } else if (p.subjectKind === 'project') {
    const { data } = await db.from('projects').select('id').eq('id', p.subjectId).maybeSingle()
    if (!data) return null
  } else {
    const { data } = await db.from('approvals').select('id').eq('id', p.subjectId).maybeSingle()
    if (!data) return null
  }

  const token = randomBytes(TOKEN_BYTES).toString('base64url')
  const hours = p.expiresInHours === null
    ? null
    : Math.min(Math.max(p.expiresInHours ?? 168, 1), 24 * 90)

  const { data, error } = await db.from('share_links').insert({
    organization_id: p.organizationId,
    subject_kind: p.subjectKind,
    subject_id: p.subjectId,
    title: p.title ?? null,
    token_hash: hashToken(token),
    expires_at: hours === null ? null : new Date(Date.now() + hours * 3_600_000).toISOString(),
    passcode_hash: p.passcode ? hashToken(p.passcode) : null,
    max_views: p.maxViews ?? null,
    allow_download: p.allowDownload ?? false,
    watermark: p.watermark ?? true,
    require_email: p.requireEmail ?? true,
    created_by: p.createdBy,
  }).select(COLUMNS).maybeSingle()

  if (error) throw new Error(`mintShareLink: ${error.message}`)
  if (!data) return null
  return { token, link: data as unknown as ShareLink }
}

export type ResolvedShare = {
  link: ShareLink
  /** Present only once the gate is satisfied. */
  needsPasscode: boolean
  needsEmail: boolean
}

/**
 * Token → link, or null.
 *
 * ONE NULL FOR EVERY FAILURE. Unknown, expired, revoked, view limit reached —
 * indistinguishable from outside, so a probe cannot learn which tokens exist.
 */
export async function resolveShareLink(token: string): Promise<ShareLink | null> {
  if (!token || token.length < 20) return null

  const { data } = await supabaseAdmin
    .from('share_links').select(COLUMNS).eq('token_hash', hashToken(token)).maybeSingle()
  if (!data) return null
  const link = data as unknown as ShareLink

  if (link.revoked_at) return null
  if (link.expires_at && Date.parse(link.expires_at) < Date.now()) return null
  if (link.max_views !== null && link.view_count >= link.max_views) return null
  return link
}

export function passcodeMatches(link: ShareLink, passcode: string | null): boolean {
  if (!link.passcode_hash) return true
  if (!passcode) return false
  // Compared as hashes, so a wrong passcode never reveals the right one by
  // timing on the plaintext.
  return hashToken(passcode) === link.passcode_hash
}

/** Open a view and count it. Returns the view id the player heartbeats against. */
export async function openView(p: {
  link: ShareLink
  viewerEmail: string | null
  viewerName: string | null
  ip: string | null
  userAgent: string | null
}): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from('share_link_views').insert({
    link_id: p.link.id,
    organization_id: p.link.organization_id,
    viewer_email: p.viewerEmail,
    viewer_name: p.viewerName,
    ip_address: p.ip,
    user_agent: p.userAgent,
  }).select('id').maybeSingle()
  if (error) throw new Error(`openView: ${error.message}`)

  // The counter is what `max_views` enforces, so it moves when a view OPENS
  // rather than when it ends — a viewer who closes the tab still used one — and
  // it increments IN THE DATABASE (0086). A read-then-write here would let two
  // people opening the same link in the same second both consume slot five.
  await supabaseAdmin.rpc('increment_share_view', { p_link: p.link.id })

  return (data as { id: string } | null)?.id ?? null
}

/**
 * Progress.
 *
 * `furthest_ms` only ever moves FORWARD — scrubbing back must not erase having
 * reached the end, which is the whole reason this column is a high-water mark
 * rather than the last known position.
 */
export async function heartbeatView(p: {
  viewId: string
  secondsWatched: number
  furthestMs: number
  durationMs: number | null
}): Promise<void> {
  const { data } = await supabaseAdmin
    .from('share_link_views')
    .select('seconds_watched, furthest_ms')
    .eq('id', p.viewId).maybeSingle()
  const prev = data as { seconds_watched: number; furthest_ms: number } | null
  if (!prev) return

  await supabaseAdmin.from('share_link_views').update({
    last_seen_at: new Date().toISOString(),
    seconds_watched: Math.max(prev.seconds_watched, Math.round(p.secondsWatched)),
    furthest_ms: Math.max(prev.furthest_ms, Math.round(p.furthestMs)),
    duration_ms: p.durationMs ?? null,
  }).eq('id', p.viewId)
}

export type ViewRow = {
  id: string
  viewer_email: string | null
  viewer_name: string | null
  ip_address: string | null
  started_at: string
  last_seen_at: string
  seconds_watched: number
  furthest_ms: number
  duration_ms: number | null
}

export async function listViews(
  db: SupabaseClient, linkId: string
): Promise<ViewRow[]> {
  const { data, error } = await db
    .from('share_link_views')
    .select('id, viewer_email, viewer_name, ip_address, started_at, last_seen_at, seconds_watched, furthest_ms, duration_ms')
    .eq('link_id', linkId)
    .order('started_at', { ascending: false })
    .limit(500)
  if (error) throw new Error(`listViews: ${error.message}`)
  return (data ?? []) as unknown as ViewRow[]
}

/** Every view of a FILE, whichever link it came through — what the approval
 *  record needs to say what an approver actually saw. */
export async function listViewsForSubject(
  db: SupabaseClient, subjectKind: ShareSubjectKind, subjectId: string
): Promise<ViewRow[]> {
  const { data: links } = await db
    .from('share_links').select('id')
    .eq('subject_kind', subjectKind).eq('subject_id', subjectId).limit(100)
  const ids = (links ?? []).map((l) => (l as { id: string }).id)
  if (ids.length === 0) return []

  const { data, error } = await db
    .from('share_link_views')
    .select('id, viewer_email, viewer_name, ip_address, started_at, last_seen_at, seconds_watched, furthest_ms, duration_ms')
    .in('link_id', ids)
    .order('started_at', { ascending: false })
    .limit(200)
  if (error) throw new Error(`listViewsForSubject: ${error.message}`)
  return (data ?? []) as unknown as ViewRow[]
}

/**
 * The same thing for MANY subjects, in two queries.
 *
 * The Review list grades a page of approvals at once, and its grade must agree
 * with the record page's — `approvalIntel` downgrades on a token viewing, so a
 * list that skipped the viewing read would show `strong` next to a record that
 * says `thin`. Two surfaces disagreeing about one number is the exact drift
 * `approvalTimeline` exists to prevent, one module over.
 */
export async function listViewsForSubjects(
  db: SupabaseClient, subjectKind: ShareSubjectKind, subjectIds: string[]
): Promise<Map<string, ViewRow[]>> {
  const out = new Map<string, ViewRow[]>()
  const ids = [...new Set(subjectIds)].slice(0, 200)
  if (ids.length === 0) return out

  const { data: links } = await db
    .from('share_links').select('id, subject_id')
    .eq('subject_kind', subjectKind).in('subject_id', ids).limit(500)
  const linkRows = (links ?? []) as unknown as { id: string; subject_id: string }[]
  if (linkRows.length === 0) return out

  const subjectOf = new Map(linkRows.map((l) => [l.id, l.subject_id]))
  const { data, error } = await db
    .from('share_link_views')
    .select('id, link_id, viewer_email, viewer_name, ip_address, started_at, last_seen_at, seconds_watched, furthest_ms, duration_ms')
    .in('link_id', [...subjectOf.keys()])
    .order('started_at', { ascending: false })
    .limit(1000)
  if (error) throw new Error(`listViewsForSubjects: ${error.message}`)

  for (const raw of (data ?? []) as unknown[]) {
    const v = raw as ViewRow & { link_id: string }
    const subject = subjectOf.get(v.link_id)
    if (!subject) continue
    const list = out.get(subject) ?? []
    list.push(v)
    out.set(subject, list)
  }
  return out
}

/* `watchedShare` WAS HERE and is deleted. It computed one view's share and
   nothing ever called it: `watchEvidence` in lib/approvalIntel.ts takes the
   high-water mark ACROSS viewings, which is the only version that answers the
   question — a glance followed by a full watch is a full watch, and a per-row
   share cannot say so. Left in place it would have been a second, subtly wrong
   way to ask the same thing, which is how two surfaces start disagreeing. */

/** Every live link this tenant has minted, newest first. RLS is the tenant
 *  boundary — `db` is the user client, so a scoped crew member sees what their
 *  own policies admit and nothing is filtered in application code. */
export async function listShareLinks(
  db: SupabaseClient, limit = 200
): Promise<ShareLink[]> {
  const { data, error } = await db
    .from('share_links').select(COLUMNS)
    .order('created_at', { ascending: false }).limit(limit)
  if (error) throw new Error(`listShareLinks: ${error.message}`)
  return (data ?? []) as unknown as ShareLink[]
}

/**
 * Withdraw a link.
 *
 * A REVOCATION IS A STAMP, NOT A DELETE. The row stays, and so do its views —
 * "this link was open for three days and four people watched it" is exactly the
 * fact somebody needs after a screener leaks, and a DELETE would destroy it in
 * the name of tidiness. `resolveShareLink` refuses a revoked row, so the link
 * stops working in the same instant either way.
 */
export async function revokeShareLink(
  db: SupabaseClient, id: string
): Promise<boolean> {
  const { data, error } = await db
    .from('share_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id).is('revoked_at', null)
    .select('id').maybeSingle()
  if (error) throw new Error(`revokeShareLink: ${error.message}`)
  // The ROW is the witness. RLS refuses with zero rows and no error, so testing
  // `error` here would report a refused revocation as a successful one.
  return !!data
}

/** Live, expired, spent or withdrawn — as one word a person can act on. */
export function linkState(l: ShareLink): 'live' | 'expired' | 'spent' | 'withdrawn' {
  if (l.revoked_at) return 'withdrawn'
  if (l.expires_at && Date.parse(l.expires_at) < Date.now()) return 'expired'
  if (l.max_views !== null && l.view_count >= l.max_views) return 'spent'
  return 'live'
}
