'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  Bell, MessageSquare, Files, RefreshCw, CreditCard, CheckSquare, X, Check,
} from 'lucide-react'

type AdminNotif = {
  id: string
  project_id: string | null
  client_id: string | null
  type: string
  title: string
  body: string | null
  read_at: string | null
  created_at: string
}

const ICON: Record<string, typeof Bell> = {
  message: MessageSquare,
  file_delivered: Files,
  status_change: RefreshCw,
  invoice_created: CreditCard,
  task_updated: CheckSquare,
}

function timeAgo(d: string) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function AdminNotificationBell() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AdminNotif[]>([])
  const ref = useRef<HTMLDivElement>(null)
  const unread = items.filter((n) => !n.read_at).length

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/notifications')
      if (!res.ok) return
      const json = await res.json()
      setItems(json.notifications ?? [])
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    // Raise any approaching-deadline alerts once on load, then refresh.
    fetch('/api/admin/deadline-check', { method: 'POST' })
      .then(() => load())
      .catch(() => {})
    load()
    const interval = setInterval(load, 20000)
    const supabase = createClient()
    const channel = supabase
      .channel('admin-notifications')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => load())
      .subscribe()
    return () => { clearInterval(interval); supabase.removeChannel(channel) }
  }, [load])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const t = setTimeout(() => document.addEventListener('click', onClick), 0)
    return () => { clearTimeout(t); document.removeEventListener('click', onClick) }
  }, [open])

  async function markAll() {
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })))
    await fetch('/api/admin/notifications', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    }).catch(() => {})
  }

  function go(n: AdminNotif) {
    setOpen(false)
    fetch('/api/admin/notifications', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [n.id] }),
    }).catch(() => {})
    if (n.project_id) router.push(`/admin/projects/${n.project_id}`)
    else if (n.client_id) router.push(`/admin/clients/${n.client_id}`)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-md transition-colors text-muted-foreground hover:text-foreground hover:bg-secondary"
        aria-label="Notifications"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold flex items-center justify-center bg-destructive text-destructive-foreground">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-[340px] max-w-[calc(100vw-2rem)] rounded-xl overflow-hidden z-50"
          style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', boxShadow: '0 10px 30px -8px rgba(0,0,0,0.45)' }}
        >
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid hsl(var(--border))' }}>
            <span className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>Notifications</span>
            {unread > 0 && (
              <button onClick={markAll} className="text-xs flex items-center gap-1" style={{ color: 'hsl(var(--primary))' }}>
                <Check size={12} /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-[400px] overflow-y-auto scrollbar-thin">
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10">
                <Bell size={22} style={{ color: 'hsl(var(--text-faint))' }} />
                <p className="text-xs mt-2" style={{ color: 'hsl(var(--text-faint))' }}>No notifications</p>
              </div>
            ) : (
              items.map((n) => {
                const Icon = ICON[n.type] ?? Bell
                return (
                  <button
                    key={n.id}
                    onClick={() => go(n)}
                    className="w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[hsl(var(--secondary))]"
                    style={{ backgroundColor: n.read_at ? 'transparent' : 'hsl(var(--primary) / 0.04)' }}
                  >
                    <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                      style={{ backgroundColor: 'hsl(var(--primary) / 0.1)' }}>
                      <Icon size={13} style={{ color: 'hsl(var(--primary))' }} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium leading-snug" style={{ color: 'hsl(var(--foreground))' }}>{n.title}</span>
                      {n.body && <span className="block text-[11px] truncate" style={{ color: 'hsl(var(--muted-foreground))' }}>{n.body}</span>}
                      <span className="block text-[10px] mt-0.5" style={{ color: 'hsl(var(--text-faint))' }}>{timeAgo(n.created_at)}</span>
                    </span>
                    {!n.read_at && <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1" style={{ backgroundColor: 'hsl(var(--primary))' }} />}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
