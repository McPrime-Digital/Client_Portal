'use client'

import { presenceView, PRESENCE_VIEW_EVENT } from '@/lib/presenceView'
import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { usePresenceStore, type PresenceEntry } from '@/lib/stores/presence-store'
import { isHubMounted } from '@/lib/realtimeBus'
import { playMessageChime, primeAudio } from '@/lib/soundClient'
import { hydratePrefs } from '@/lib/prefsSync'

// Mounted once per portal layout. Does three things, app-wide (every page):
//   1. Tracks the current user in a shared presence channel so the *other*
//      party's messaging hub shows an accurate Online/Away indicator. Presence
//      follows tab VISIBILITY — you are "Online" only while the app is actually
//      open in the foreground, and drop to "Away" the moment you switch away or
//      background it. This keeps Online truthful and aligned with the away-push
//      logic (away → device push; in-app → no push).
//   2. Auto-marks incoming messages as "delivered" the instant they arrive
//      while the user is anywhere in the app (the WhatsApp double-grey tick),
//      even if the chat isn't open, and pings the sender so their tick flips
//      live. When a messaging hub is open it owns that receipt itself, so this
//      only steps in when no hub is mounted.
//   3. Sends a lightweight heartbeat so the server can tell "away" from
//      "in-app" for deferred (push/email) alerts. Best-effort — never throws.
export default function PresencePulse({
  role,
  userId,
  clientId,
  orgId,
}: {
  role: 'admin' | 'client'
  userId: string
  clientId: string | null
  /** The tenant whose presence room this session joins. Server-resolved and
   *  passed in — a client component cannot read app_metadata.organization_id
   *  without a round trip, and presence must not wait on one. */
  orgId: string
}) {
  const setOnline = usePresenceStore((s) => s.setOnline)
  const deliverTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  useEffect(() => {
    if (!userId) return
    // Unlock WebAudio on the first gesture ANYWHERE in the app — without
    // this, the chime only worked after visiting a messaging surface.
    primeAudio()
    void hydratePrefs()
    const supabase = createClient()

    // ── 1. Shared app presence (visibility-gated), scoped to the tenant ─────
    // The key was 'presence:app' — one room for the entire product, so every
    // member of every tenant tracked into it and read everyone else's
    // {role, userId, clientId} back out (C-3; S-V §X-10: presence is scoped to
    // a tenant or a room, never app-wide). Presence broadcasts are NOT filtered
    // by RLS, so nothing downstream of this was going to catch it.
    //
    // Org, not client company, is the right room: the portal's "is the studio
    // online" indicator (isAdminOnline) must still see crew, and the studio's
    // per-company indicator (isClientOnline) already filters by clientId. So
    // this removes only entries both selectors were discarding — behaviour
    // inside a tenant is unchanged.
    //
    // Scope only. The subscription budget (I-2's second half) and the
    // multiplexed channel are S2.5/S5 work and are untouched here.
    const presenceCh = supabase.channel(`presence:org:${orgId}`, {
      config: { presence: { key: userId } },
    })
    // Track when the app is foregrounded; untrack when it's hidden, so the other
    // party never sees a stale "Online" for a backgrounded/closed tab.
    const syncPresence = () => {
      if (document.visibilityState === 'visible') {
        // `view` says WHICH conversation they are reading (item 6), so the
        // other side can distinguish "in this thread" from "signed in
        // somewhere". A hint, never authorization.
        presenceCh.track({ role, userId, clientId, view: presenceView() })
      } else {
        presenceCh.untrack()
      }
    }
    presenceCh
      .on('presence', { event: 'sync' }, () => {
        const state = presenceCh.presenceState() as Record<string, any[]>
        const entries: PresenceEntry[] = []
        for (const presences of Object.values(state)) {
          for (const p of presences) {
            if (p?.role) {
              entries.push({
                role: p.role,
                userId: p.userId ?? '',
                clientId: p.clientId ?? null,
                view: p.view ?? null,
              })
            }
          }
        }
        setOnline(entries)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') syncPresence()
      })

    // Re-track the moment the view changes rather than on the next heartbeat:
    // "they just opened this thread" is only useful if it is immediate.
    window.addEventListener(PRESENCE_VIEW_EVENT, syncPresence)

    // ── 2. Auto-deliver incoming messages anywhere in the app ──
    const endpoint = role === 'admin' ? '/api/admin/messages' : '/api/portal/messages'
    // Ping the sender (cross-browser) so their tick flips to double-grey the
    // instant we mark a message delivered. Uses a short-lived broadcast on the
    // thread's topic — but ONLY when no messaging hub is open in this tab (the
    // hub owns that topic and handles the receipt itself; two subscriptions to
    // one topic on the shared socket would collide).
    const pingDelivered = (projectId: string) => {
      if (isHubMounted()) return
      // ROOM topic, matching RoomThread (item 6). This used to ping
      // `thread:${projectId}` — the per-VIEW topic — which after the room-scoped
      // move would have been a broadcast into a channel nobody subscribes to:
      // a receipt that silently never arrived. A client session always has its
      // own room; an admin session outside a hub has no single room to name, so
      // it falls back to replication, which flips the tick a second later
      // rather than not at all.
      if (!clientId) return
      const ch = supabase.channel(`thread:room:${clientId}`)
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          ch.send({ type: 'broadcast', event: 'sync', payload: { projectId } })
          setTimeout(() => supabase.removeChannel(ch), 1500)
        }
      })
    }
    const markDelivered = (projectId: string) => {
      if (deliverTimers.current[projectId]) return
      deliverTimers.current[projectId] = setTimeout(() => {
        delete deliverTimers.current[projectId]
        fetch(endpoint, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project_id: projectId, mode: 'delivered' }),
        })
          .then(() => pingDelivered(projectId))
          .catch(() => {})
      }, 250)
    }
    const inboxCh = supabase
      .channel(`inbox:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const msg = payload.new as { project_id?: string; sender_id?: string }
          // The chime is APP-WIDE (Batch 16): you hear a message land from any
          // page, not just the hub. soundClient throttles, so a hub that also
          // chimes never doubles it; your own sends never chime.
          if (msg?.sender_id && msg.sender_id !== userId) playMessageChime()
          // A recipient marks someone else's message delivered. sender_id is
          // the predicate — sender_role left replication payloads with
          // Batch 21 item 3 (migration 12 drops the column). A colleague's
          // send now also marks delivered, which is honest: delivered means
          // "reached a device in the room", and the server's own scope
          // already excludes the marker's messages.
          if (msg?.project_id && msg.sender_id && msg.sender_id !== userId) {
            markDelivered(msg.project_id)
          }
        }
      )
      .subscribe()

    // ── 3. Presence heartbeat (best-effort; powers deferred alerts) ──
    const beat = () => {
      fetch('/api/presence/heartbeat', { method: 'POST' }).catch(() => {})
    }
    beat()
    const heartbeat = setInterval(() => {
      if (document.visibilityState === 'visible') beat()
    }, 30_000)

    // Tab focus/blur flips Online↔Away instantly and re-stamps the heartbeat on
    // return, so "away" coverage (push) and presence stay tight and in sync.
    const onVisibility = () => {
      syncPresence()
      if (document.visibilityState === 'visible') beat()
    }
    document.addEventListener('visibilitychange', onVisibility)

    // Kick the 5h "no reply" message nudge on load — the active party's visit
    // triggers an (idempotent) scan that alerts any away counterpart. This gives
    // near-real-time coverage between the once-daily Vercel cron runs (and works
    // on plans where finer-grained crons aren't available).
    fetch('/api/cron/message-nudge', { method: 'POST' }).catch(() => {})

    return () => {
      clearInterval(heartbeat)
      document.removeEventListener('visibilitychange', onVisibility)
      Object.values(deliverTimers.current).forEach(clearTimeout)
      deliverTimers.current = {}
      supabase.removeChannel(presenceCh)
      supabase.removeChannel(inboxCh)
      setOnline([])
    }
  }, [userId, role, clientId, orgId, setOnline])

  return null
}
