'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

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
  created_at: string
}

const POLL_INTERVAL = 20_000

export function useNotifications(clientId: string | null) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  // Tracks ids optimistically marked read so a poll mid-flight can't un-read them.
  const readIds = useRef<Set<string>>(new Set())

  const unreadCount = notifications.filter((n) => !n.read_at).length

  const loadNotifications = useCallback(async () => {
    try {
      const res = await fetch('/api/portal/notifications')
      if (!res.ok) return
      const json = await res.json()
      const incoming: Notification[] = json.notifications ?? []
      setNotifications(
        incoming.map((n) =>
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
    const interval = setInterval(loadNotifications, POLL_INTERVAL)
    return () => clearInterval(interval)
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

  return {
    notifications,
    unreadCount,
    loading,
    markAllRead,
    markOneRead,
  }
}
