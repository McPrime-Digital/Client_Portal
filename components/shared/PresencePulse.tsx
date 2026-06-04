'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { usePresenceStore, type PresenceEntry } from '@/lib/stores/presence-store'
import { isHubMounted } from '@/lib/realtimeBus'

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
}: {
  role: 'admin' | 'client'
  userId: string
  clientId: string | null
}) {
  const setOnline = usePresenceStore((s) => s.setOnline)
  const deliverTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  useEffect(() => {
    if (!userId) return
    const supabase = createClient()

    // ── 1. Shared app presence (visibility-gated) ─────────────
    const presenceCh = supabase.channel('presence:app', {
      config: { presence: { key: userId } },
    })
    // Track when the app is foregrounded; untrack when it's hidden, so the other
    // party never sees a stale "Online" for a backgrounded/closed tab.
    const syncPresence = () => {
      if (document.visibilityState === 'visible') {
        presenceCh.track({ role, userId, clientId })
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
              })
            }
          }
        }
        setOnline(entries)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') syncPresence()
      })

    // ── 2. Auto-deliver incoming messages anywhere in the app ──
    const endpoint = role === 'admin' ? '/api/admin/messages' : '/api/portal/messages'
    // Ping the sender (cross-browser) so their tick flips to double-grey the
    // instant we mark a message delivered. Uses a short-lived broadcast on the
    // thread's topic — but ONLY when no messaging hub is open in this tab (the
    // hub owns that topic and handles the receipt itself; two subscriptions to
    // one topic on the shared socket would collide).
    const pingDelivered = (projectId: string) => {
      if (isHubMounted()) return
      const ch = supabase.channel(`thread:${projectId}`)
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
          const msg = payload.new as { project_id?: string; sender_role?: string }
          // Only the recipient marks delivered (a message from the *other* role).
          if (msg?.project_id && msg.sender_role && msg.sender_role !== role) {
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
  }, [userId, role, clientId, setOnline])

  return null
}
