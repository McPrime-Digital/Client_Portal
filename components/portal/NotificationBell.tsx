'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Bell,
  MessageSquare,
  Files,
  RefreshCw,
  CreditCard,
  CheckSquare,
  X,
  Check,
} from 'lucide-react'
import {
  useNotifications,
  type Notification,
} from '@/lib/hooks/useNotifications'

type Props = {
  clientId: string
}

function timeAgo(date: string) {
  const seconds = Math.floor(
    (Date.now() - new Date(date).getTime()) / 1000
  )
  if (seconds < 60) return 'just now'
  if (seconds < 3600)
    return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400)
    return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

function getNotifIcon(type: Notification['type']) {
  const map = {
    message: MessageSquare,
    file_delivered: Files,
    status_change: RefreshCw,
    invoice_created: CreditCard,
    task_updated: CheckSquare,
  }
  return map[type] ?? Bell
}

function getNotifColor(type: Notification['type']) {
  // Aligned with the admin bell + Recent Activity scheme (theme-adaptive tokens).
  const map = {
    message: 'hsl(var(--status-violet))',
    file_delivered: 'hsl(var(--status-blue))',
    status_change: 'hsl(var(--status-amber))',
    invoice_created: 'hsl(var(--status-green))',
    task_updated: 'hsl(var(--primary))',
  }
  return map[type] ?? 'hsl(var(--muted-foreground))'
}

export default function NotificationBell({ clientId }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const {
    notifications,
    unreadCount,
    loading,
    markAllRead,
    markOneRead,
    dismissOne,
  } = useNotifications(clientId)

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () =>
      document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Notifications persist in the bell until the user opens one (click →
  // navigate + mark read) or closes it (the X → dismiss). Opening the bell
  // never clears anything on its own.

  function handleNotifClick(notif: Notification) {
    markOneRead(notif.id)
    setOpen(false)
    if (notif.project_id) {
      const tab =
        notif.type === 'message'
          ? '?tab=messages'
          : notif.type === 'file_delivered'
          ? '?tab=files'
          : notif.type === 'task_updated'
          ? '?tab=tasks'
          : ''
      router.push(`/projects/${notif.project_id}${tab}`)
    } else if (notif.type === 'invoice_created') {
      router.push('/invoices')
    }
  }

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(!open)}
        className="relative w-9 h-9 rounded-lg flex items-center 
        justify-center transition-all"
        style={{ color: 'hsl(var(--muted-foreground))' }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'hsl(var(--border))'
          e.currentTarget.style.color = 'hsl(var(--foreground))'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent'
          e.currentTarget.style.color = 'hsl(var(--muted-foreground))'
        }}
        aria-label="Notifications"
      >
        <Bell size={17} />
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 w-4 h-4 
            rounded-full flex items-center justify-center 
            text-[10px] font-bold"
            style={{
              backgroundColor: 'hsl(var(--destructive))',
              color: '#fff',
            }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-80 
          rounded-2xl overflow-hidden z-50"
          style={{
            backgroundColor: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            boxShadow: '0 16px 40px rgba(0,0,0,0.4)',
          }}
        >
          {/* Panel header */}
          <div
            className="flex items-center justify-between 
            px-4 py-3"
            style={{ borderBottom: '1px solid hsl(var(--border))' }}
          >
            <div className="flex items-center gap-2">
              <Bell size={14} style={{ color: 'hsl(var(--primary))' }} />
              <span
                className="text-sm font-semibold"
                style={{ color: 'hsl(var(--foreground))' }}
              >
                Notifications
              </span>
              {unreadCount > 0 && (
                <span
                  className="text-xs px-1.5 py-0.5 rounded-full 
                  font-semibold"
                  style={{
                    backgroundColor: 'hsl(var(--destructive) / 0.15)',
                    color: 'hsl(var(--destructive))',
                  }}
                >
                  {unreadCount} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="flex items-center gap-1 px-2 py-1 
                  rounded text-xs transition-colors"
                  style={{ color: 'hsl(var(--muted-foreground))' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'hsl(var(--foreground))'
                    e.currentTarget.style.backgroundColor =
                      'hsl(var(--border))'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'hsl(var(--muted-foreground))'
                    e.currentTarget.style.backgroundColor =
                      'transparent'
                  }}
                >
                  <Check size={11} />
                  All read
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="w-6 h-6 rounded flex items-center 
                justify-center transition-colors"
                style={{ color: 'hsl(var(--text-faint))' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'hsl(var(--foreground))'
                  e.currentTarget.style.backgroundColor =
                    'hsl(var(--border))'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'hsl(var(--text-faint))'
                  e.currentTarget.style.backgroundColor =
                    'transparent'
                }}
              >
                <X size={13} />
              </button>
            </div>
          </div>

          {/* Notification list */}
          <div className="max-h-[400px] overflow-y-auto scrollbar-thin">
            {loading && (
              <div className="flex items-center justify-center 
                py-8">
                <div
                  className="w-5 h-5 rounded-full border-2 
                  border-t-transparent animate-spin"
                  style={{ borderColor: 'hsl(var(--text-faint))',
                    borderTopColor: 'transparent' }}
                />
              </div>
            )}

            {!loading && notifications.length === 0 && (
              <div className="flex flex-col items-center 
                justify-center py-10">
                <Bell size={28} style={{ color: 'hsl(var(--text-faint))' }} />
                <p className="text-sm mt-3"
                  style={{ color: 'hsl(var(--muted-foreground))' }}>
                  You're all caught up
                </p>
                <p className="text-xs mt-1"
                  style={{ color: 'hsl(var(--text-faint))' }}>
                  Notifications appear here
                </p>
              </div>
            )}

            {!loading &&
              notifications.map((notif, index) => {
                const Icon = getNotifIcon(notif.type)
                const color = getNotifColor(notif.type)
                const isUnread = !notif.read_at

                return (
                  <div
                    key={notif.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleNotifClick(notif)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') handleNotifClick(notif)
                    }}
                    className="group w-full flex items-start gap-3
                    px-4 py-3 text-left transition-all cursor-pointer"
                    style={{
                      backgroundColor: isUnread
                        ? 'hsl(var(--primary) / 0.04)'
                        : 'transparent',
                      borderBottom:
                        index < notifications.length - 1
                          ? '1px solid hsl(var(--border))'
                          : 'none',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor =
                        'hsl(var(--border))'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor =
                        isUnread
                          ? 'hsl(var(--primary) / 0.04)'
                          : 'transparent'
                    }}
                  >
                    {/* Icon */}
                    <div
                      className="w-8 h-8 rounded-lg flex
                      items-center justify-center flex-shrink-0
                      mt-0.5"
                      style={{
                        backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
                        border: `1px solid color-mix(in srgb, ${color} 22%, transparent)`,
                      }}
                    >
                      <Icon size={14}
                        style={{ color }} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start
                        justify-between gap-2">
                        <p
                          className="text-sm leading-tight"
                          style={{
                            color: isUnread
                              ? 'hsl(var(--foreground))'
                              : 'hsl(var(--muted-foreground))',
                            fontWeight: isUnread ? 500 : 400,
                          }}
                        >
                          {notif.title}
                        </p>
                        {isUnread && (
                          <div
                            className="w-2 h-2 rounded-full
                            flex-shrink-0 mt-1.5"
                            style={{
                              backgroundColor: 'hsl(var(--destructive))',
                            }}
                          />
                        )}
                      </div>
                      {notif.body && (
                        <p
                          className="text-xs mt-0.5 truncate"
                          style={{ color: 'hsl(var(--text-faint))' }}
                        >
                          {notif.body}
                        </p>
                      )}
                      <p className="text-xs mt-1"
                        style={{ color: 'hsl(var(--text-faint))' }}>
                        {timeAgo(notif.created_at)}
                      </p>
                    </div>

                    {/* Dismiss (X) — closes this notification from the bell.
                        The action stays recorded in the project's records. */}
                    <button
                      type="button"
                      aria-label="Dismiss notification"
                      onClick={(e) => {
                        e.stopPropagation()
                        dismissOne(notif.id)
                      }}
                      className="w-6 h-6 rounded-md flex items-center
                      justify-center flex-shrink-0 transition-all
                      opacity-60 hover:opacity-100"
                      style={{ color: 'hsl(var(--text-faint))' }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = 'hsl(var(--foreground))'
                        e.currentTarget.style.backgroundColor = 'hsl(var(--secondary))'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = 'hsl(var(--text-faint))'
                        e.currentTarget.style.backgroundColor = 'transparent'
                      }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                )
              })}
          </div>
        </div>
      )}
    </div>
  )
}
