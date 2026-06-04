'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { usePresenceStore, type PresenceEntry } from '@/lib/stores/presence-store'

// Mounted once per portal layout. Does three things, app-wide (every page):
//   1. Tracks the current user in a shared presence channel so the *other*
//      party's messaging hub can show an accurate Online/Away indicator.
//   2. Auto-marks incoming messages as "delivered" the instant they arrive
//      while the user is anywhere in the app (the WhatsApp double-grey tick),
//      even if the chat isn't open. Clients have RLS read on their own
//      messages so Realtime delivers here; the mark is debounced per project.
//   3. Sends a lightweight heartbeat so the server can tell "away" from
//      "in-app" for deferred (email) alerts. Best-effort — never throws.
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

    // ── 1. Shared app presence ────────────────────────────────
    const presenceCh = supabase.channel('presence:app', {
      config: { presence: { key: userId } },
    })
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
        if (status === 'SUBSCRIBED') {
          await presenceCh.track({ role, userId, clientId })
        }
      })

    // ── 2. Auto-deliver incoming messages anywhere in the app ──
    const endpoint = role === 'admin' ? '/api/admin/messages' : '/api/portal/messages'
    const markDelivered = (projectId: string) => {
      if (deliverTimers.current[projectId]) return
      deliverTimers.current[projectId] = setTimeout(() => {
        delete deliverTimers.current[projectId]
        fetch(endpoint, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project_id: projectId, mode: 'delivered' }),
        }).catch(() => {})
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

    // Kick the 5h "no reply" message nudge on load — the active party's visit
    // triggers a (idempotent) scan that alerts any away counterpart. This makes
    // the nudge work even on Vercel plans without scheduled crons.
    fetch('/api/cron/message-nudge', { method: 'POST' }).catch(() => {})

    return () => {
      clearInterval(heartbeat)
      Object.values(deliverTimers.current).forEach(clearTimeout)
      deliverTimers.current = {}
      supabase.removeChannel(presenceCh)
      supabase.removeChannel(inboxCh)
      setOnline([])
    }
  }, [userId, role, clientId, setOnline])

  return null
}
