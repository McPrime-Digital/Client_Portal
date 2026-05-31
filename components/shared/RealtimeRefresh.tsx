'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Drop this into any server-rendered page to make it live: it subscribes
// to Supabase Realtime on the given tables and calls router.refresh()
// (re-running the server query) when any of them change — debounced so a
// burst of changes triggers a single refresh. An optional poll acts as a
// safety net if Realtime drops. Renders nothing.
export default function RealtimeRefresh({
  tables,
  pollMs = 0,
}: {
  tables: string[]
  pollMs?: number
}) {
  const router = useRouter()
  const key = tables.join(',')

  useEffect(() => {
    const supabase = createClient()
    let debounce: ReturnType<typeof setTimeout> | null = null
    const refresh = () => {
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => router.refresh(), 400)
    }

    const channel = supabase.channel(
      `live:${key}:${Math.random().toString(36).slice(2, 8)}`
    )
    for (const table of key.split(',')) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        refresh
      )
    }
    channel.subscribe()

    const poll = pollMs > 0 ? setInterval(() => router.refresh(), pollMs) : null

    return () => {
      if (debounce) clearTimeout(debounce)
      if (poll) clearInterval(poll)
      supabase.removeChannel(channel)
    }
  }, [router, key, pollMs])

  return null
}
