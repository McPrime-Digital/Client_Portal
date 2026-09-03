'use client'

import type { Message } from '@/lib/types/database'

/**
 * The conversation render cache — Batch 19, extracted and given a PREFETCH.
 *
 * ── WHY IT MOVED OUT OF RoomThread ──────────────────────────────────────────
 * The cache made a REVISIT instant: tap a chip you have already opened and it
 * paints from memory at 0ms while the network reconciles behind. But the FIRST
 * open of any conversation still waited on a round trip, and since most taps
 * in a working day are first opens, the product read as "it loads every time".
 *
 * Warming it needs a caller the cache used to be invisible to — the hub, which
 * knows every room and project the moment it renders its list. So the cache
 * lives here and the hub can fill it before you tap.
 *
 * ── WHAT PREFETCH DOES AND DOES NOT DO ──────────────────────────────────────
 * It fetches the same first page the thread would, at idle, once per view, and
 * drops the result in. It does NOT retry, does NOT block anything, and never
 * touches a view the user is already reading (that view owns its own state and
 * a background write into it would fight the live merge).
 *
 * Bounded on purpose: a studio with forty client companies must not fire forty
 * requests on hub load. The hub passes its visible views, and the cap here is
 * the backstop.
 */

export type CachedThread = {
  rows: Message[]
  cursor: string | null
  hasMore: boolean
  roomId: string | null
}

const cache = new Map<string, CachedThread>()

/** In-flight prefetches, so two hubs mounting together do not double-fetch. */
const inflight = new Set<string>()

/** Views warmed per page load. A prefetch is a head start, not a poll. */
const warmed = new Set<string>()

/** Views prefetched in one pass. Above this the user's own taps are faster
 *  than the stampede would be. */
const MAX_PREFETCH = 12

export function cacheKeyFor(role: string, clientId: string, filterKey: string): string {
  return `${role}:${clientId}:${filterKey}`
}

export function readThread(key: string): CachedThread | undefined {
  return cache.get(key)
}

export function writeThread(key: string, value: CachedThread): void {
  cache.set(key, value)
}

/**
 * Warm one view. Safe to call repeatedly — it runs at most once per key per
 * page load, and never overwrites a view that already holds rows (the live
 * thread's own state is always the fresher of the two).
 */
export async function prefetchThread(key: string, url: string): Promise<void> {
  if (typeof window === 'undefined') return
  if (warmed.has(key) || inflight.has(key) || cache.has(key)) return
  if (warmed.size >= MAX_PREFETCH) return
  inflight.add(key)
  try {
    const res = await fetch(url)
    if (!res.ok) return
    const json = await res.json()
    const rows = (json.messages ?? []) as Message[]
    // An empty first page is still a useful answer — it means "this opens to
    // nothing", and caching it stops the empty state flickering in later.
    cache.set(key, {
      rows,
      cursor: json.nextCursor ?? null,
      hasMore: !!json.hasMore,
      roomId: json.roomId ?? null,
    })
    warmed.add(key)
  } catch {
    // A failed warm costs nothing: the thread fetches normally on open.
  } finally {
    inflight.delete(key)
  }
}

/** Warm several views at idle, in order, without blocking paint. */
export function prefetchThreads(jobs: { key: string; url: string }[]): void {
  if (typeof window === 'undefined' || jobs.length === 0) return
  const run = () => { for (const j of jobs.slice(0, MAX_PREFETCH)) void prefetchThread(j.key, j.url) }
  // requestIdleCallback where it exists (not Safari), a short timeout where it
  // does not — either way the first paint is never waiting on this.
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback
  if (ric) ric(run)
  else setTimeout(run, 300)
}

/**
 * The exact URL RoomThread's own `listUrl()` builds. Kept HERE, next to the
 * cache, because a prefetch that fetches a slightly different URL warms a key
 * nothing ever reads — the cache would look full and every open would still
 * wait, which is worse than no prefetch because it hides the problem.
 */
export function threadListUrl(
  role: 'admin' | 'client',
  clientId: string,
  filter: { kind: 'all' | 'general' } | { kind: 'project'; projectId: string }
): string {
  const base = role === 'admin' ? '/api/admin/messages' : '/api/portal/messages'
  const p = new URLSearchParams()
  if (filter.kind === 'project') p.set('project_id', filter.projectId)
  else {
    p.set('scope', filter.kind === 'general' ? 'general' : 'room')
    if (role === 'admin') p.set('client_id', clientId)
  }
  return `${base}?${p.toString()}`
}

/** The filterKey RoomThread uses for its cache key, from the same filter. */
export function filterKeyFor(
  filter: { kind: 'all' | 'general' } | { kind: 'project'; projectId: string }
): string {
  return filter.kind === 'project' ? `project:${filter.projectId}` : filter.kind
}
