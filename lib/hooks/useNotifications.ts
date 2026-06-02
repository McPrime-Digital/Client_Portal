'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

export type Notification = {
  id: string
  project_id: string | null
  type:
    | 'message'
    | 'file_delivered'
    | 'status_change'
    | 'invoice_created'
    | 'task_updated'
  title: string
  body: string | null
  read_at: string | null
  dismissed_at?: string | null
  created_at: string
}

const POLL_INTERVAL = 20_000

export function useNotifications(clientId: string | null) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  // Tracks ids optimistically marked read so a poll mid-flight can't un-read them.
  const readIds = useRef<Set<string>>(new Set())
  // Tracks ids optimistically dismissed so a poll mid-flight can't resurrect them.
  const dismissedIds = useRef<Set<string>>(new Set())

  const unreadCount = notifications.filter((n) => !n.read_at).length

  const loadNotifications = useCallback(async () => {
    try {
      const res = await fetch('/api/portal/notifications')
      if (!res.ok) return
      const json = await res.json()
      const incoming: Notification[] = json.notifications ?? []
      setNotifications(
        incoming
          // Drop anything dismissed (server-side or optimistically pending).
          .filter((n) => !n.dismissed_at && !dismissedIds.current.has(n.id))
          .map((n) =>
            readIds.current.has(n.id) && !n.read_at
              ? { ...n, read_at: new Date().toISOString() }
              : n
          )
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!clientId) {
      setLoading(false)
      return
    }
    loadNotifications()
    // Poll as a safety net; Supabase Realtime gives instant delivery.
    const interval = setInterval(loadNotifications, POLL_INTERVAL)
    const supabase = createClient()
    // Unique channel suffix so multiple hook instances (e.g. the bell + a
    // project page's tab badges) don't double-join the same topic on one
    // socket — same pattern as RealtimeRefresh.
    const channel = supabase
      .channel(`notifications:${clientId}:${Math.random().toString(36).slice(2, 8)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `client_id=eq.${clientId}` },
        () => loadNotifications()
      )
      .subscribe()
    return () => {
      clearInterval(interval)
      supabase.removeChannel(channel)
    }
  }, [clientId, loadNotifications])

  const markRead = useCallback(
    async (body: { ids?: string[]; all?: boolean }) => {
      await fetch('/api/portal/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    },
    []
  )

  async function markAllRead() {
    const unreadIds = notifications
      .filter((n) => !n.read_at)
      .map((n) => n.id)
    if (unreadIds.length === 0) return

    unreadIds.forEach((id) => readIds.current.add(id))
    const now = new Date().toISOString()
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, read_at: n.read_at ?? now }))
    )
    await markRead({ all: true })
  }

  async function markOneRead(notificationId: string) {
    readIds.current.add(notificationId)
    const now = new Date().toISOString()
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === notificationId
          ? { ...n, read_at: n.read_at ?? now }
          : n
      )
    )
    await markRead({ ids: [notificationId] })
  }

  // Dismiss (the bell X) — remove the row from the bell. The action stays
  // recorded in activity_log, so the audit trail is untouched.
  const dismiss = useCallback(
    async (body: { ids?: string[]; all?: boolean }) => {
      await fetch('/api/portal/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, dismiss: true }),
      })
    },
    []
  )

  async function dismissOne(notificationId: string) {
    dismissedIds.current.add(notificationId)
    setNotifications((prev) => prev.filter((n) => n.id !== notificationId))
    await dismiss({ ids: [notificationId] })
  }

  async function dismissAll() {
    const ids = notifications.map((n) => n.id)
    if (ids.length === 0) return
    ids.forEach((id) => dismissedIds.current.add(id))
    setNotifications([])
    await dismiss({ all: true })
  }

  return {
    notifications,
    unreadCount,
    loading,
    markAllRead,
    markOneRead,
    dismissOne,
    dismissAll,
  }
}
