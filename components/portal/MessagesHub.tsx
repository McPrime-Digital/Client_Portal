'use client'

import {
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react'
import { createClient } from '@/lib/supabase/client'
import StatusBadge from '@/components/portal/StatusBadge'
import {
  MessageSquare,
  Loader2,
  ChevronLeft,
} from 'lucide-react'
import MessageThread from '@/components/shared/MessageThread'
import type { Message } from '@/lib/types/database'
import { uploadFileToR2 } from '@/lib/uploadClient'
import { messagePreview } from '@/lib/messagePreview'
import { usePresenceStore, isAdminOnline } from '@/lib/stores/presence-store'
import { acquireHub, releaseHub, type ThreadMessagePayload } from '@/lib/realtimeBus'

type Thread = {
  id: string
  title: string
  status: string
  type: string
  latestMessage: Message | null
  unreadCount: number
}

type Props = {
  threads: Thread[]
  clientId: string
  clientName: string
}

// Returns true if the persisted message set is unchanged (ignoring optimistic
// temp messages), so polling can skip needless re-renders / scroll jumps.
function samePersisted(prev: Message[], incoming: Message[]) {
  const persisted = prev.filter((m) => !m.id.startsWith('temp-'))
  if (persisted.length !== incoming.length) return false
  for (let i = 0; i < incoming.length; i++) {
    const a = persisted[i]
    const b = incoming[i]
    if (
      a.id !== b.id ||
      a.read_at !== b.read_at ||
      a.delivered_at !== b.delivered_at ||
      a.edited_at !== b.edited_at ||
      a.is_deleted !== b.is_deleted ||
      a.body !== b.body
    ) {
      return false
    }
  }
  return true
}

function timeAgo(date: string) {
  const s = Math.floor(
    (Date.now() - new Date(date).getTime()) / 1000
  )
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

export default function MessagesHub({
  threads: initialThreads,
  clientId,
  clientName,
}: Props) {
  const supabase = createClient()
  const [threads, setThreads] = useState(initialThreads)
  const [activeThread, setActiveThread] =
    useState<Thread | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  // One persistent broadcast channel per thread (`thread:${projectId}`),
  // subscribed for EVERY thread — so a message in any thread reorders the list,
  // bumps its unread badge and flips ticks live, not just the open one.
  const threadChannelsRef = useRef<Record<string, any>>({})

  // Typing state (per active thread). Online/Away comes from app-wide presence.
  const [adminTyping, setAdminTyping] = useState(false)
  const online = usePresenceStore((s) => s.online)
  const adminOnline = isAdminOnline(online)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typingBroadcastRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Stable view of the active thread id for use inside realtime callbacks.
  const activeThreadIdRef = useRef<string | null>(null)
  useEffect(() => { activeThreadIdRef.current = activeThread?.id ?? null }, [activeThread?.id])

  // On mobile, show thread list or conversation
  const [mobileView, setMobileView] = useState<
    'list' | 'thread'
  >('list')

  // Auto-select the first thread (desktop) so the client can message right
  // away instead of landing on an empty conversation pane.
  useEffect(() => {
    if (!activeThread && threads.length > 0) setActiveThread(threads[0])
  }, [threads, activeThread])

  // Broadcast a lightweight "sync" ping on a thread's channel so the other side
  // refetches instantly — drives WhatsApp-speed tick/read updates without
  // relying on Postgres replication (which RLS can starve for the admin side).
  const broadcastSync = useCallback((projectId: string) => {
    const ch = threadChannelsRef.current[projectId]
    if (ch) ch.send({ type: 'broadcast', event: 'sync', payload: { projectId } })
  }, [])

  // Load messages for active thread
  const loadMessages = useCallback(
    async (projectId: string) => {
      setLoadingMessages(true)
      try {
        const res = await fetch(
          `/api/portal/messages?project_id=${projectId}`
        )
        const json = await res.json()
        setMessages(res.ok ? (json.messages ?? []) : [])
      } catch {
        setMessages([])
      } finally {
        setLoadingMessages(false)
      }

      // Mark admin messages as read (server-side, service role), then ping the
      // admin so their ticks turn blue instantly.
      fetch('/api/portal/messages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId }),
      })
        .then(() => broadcastSync(projectId))
        .catch(() => {})

      setThreads((prev) =>
        prev.map((t) =>
          t.id === projectId ? { ...t, unreadCount: 0 } : t
        )
      )
    },
    [broadcastSync]
  )

  // Refetch the active thread, reorder the thread list (newest on top), and —
  // if the client is viewing this thread — instantly mark incoming admin
  // messages read and tell the sender.
  const refetchMessages = useCallback(
    async (projectId: string) => {
      try {
        const res = await fetch(`/api/portal/messages?project_id=${projectId}`)
        const json = await res.json()
        if (!json.messages) return
        const incoming = json.messages as Message[]
        setMessages((prev) => {
          if (samePersisted(prev, incoming)) return prev
          const pending = prev.filter((m) => m.id.startsWith('temp-'))
          return [...incoming, ...pending]
        })
        const latest = incoming[incoming.length - 1] ?? null
        if (latest) {
          setThreads((prev) => {
            const idx = prev.findIndex((t) => t.id === projectId)
            if (idx === -1) return prev
            const isActive = activeThreadIdRef.current === projectId
            const updated = {
              ...prev[idx],
              latestMessage: latest,
              unreadCount: isActive ? 0 : prev[idx].unreadCount,
            }
            return [updated, ...prev.filter((t) => t.id !== projectId)]
          })
        }
        if (
          activeThreadIdRef.current === projectId &&
          incoming.some(
            (m) => m.sender_role === 'admin' && !m.read_at && !m.id.startsWith('temp-')
          )
        ) {
          fetch('/api/portal/messages', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project_id: projectId }),
          })
            .then(() => broadcastSync(projectId))
            .catch(() => {})
        }
      } catch {
        /* ignore */
      }
    },
    [broadcastSync]
  )

  // Apply a thread's incoming message broadcast (from the admin). Drives the
  // list whether or not that thread is open: reorder to top, bump the unread
  // badge for background threads, or pull it into the open conversation and
  // mark it read. Always acknowledges delivery so the admin's tick flips.
  const handleIncoming = useCallback(
    (payload: ThreadMessagePayload) => {
      const projectId = payload?.projectId
      if (!projectId) return
      // Our own outgoing message is already reflected locally on send.
      if (payload.senderRole === 'client') return

      const open =
        activeThreadIdRef.current === projectId &&
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible'

      if (open) {
        // Active + visible: pull the message in, mark read, flip admin ticks.
        refetchMessages(projectId)
        return
      }

      // Background thread: update the row + unread badge instantly (no fetch).
      const latest = {
        id: payload.messageId ?? `temp-${Date.now()}`,
        sender_role: payload.senderRole,
        sender_name: payload.senderName ?? '',
        body: payload.body ?? '',
        attachment_name: payload.attachmentName ?? null,
        is_deleted: false,
        created_at: payload.createdAt ?? new Date().toISOString(),
      } as unknown as Message
      setThreads((prev) => {
        const idx = prev.findIndex((t) => t.id === projectId)
        if (idx === -1) return prev
        const updated = {
          ...prev[idx],
          latestMessage: latest,
          unreadCount: prev[idx].unreadCount + 1,
        }
        return [updated, ...prev.filter((t) => t.id !== projectId)]
      })
      // We received it → mark delivered and ping the admin (double-grey tick).
      fetch('/api/portal/messages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, mode: 'delivered' }),
      })
        .then(() => broadcastSync(projectId))
        .catch(() => {})
    },
    [refetchMessages, broadcastSync]
  )

  // Persistent per-thread broadcast bus — one channel per thread, for ALL
  // threads (not just the open one). Each carries new-message, read/delivered
  // "sync" pings and typing. This is how a message in a background thread
  // reorders the list + bumps its unread badge live, and how ticks flip
  // instantly. `self: false` so we never react to our own broadcasts.
  // Order-independent: only the SET of threads matters, so reordering the list
  // (which happens constantly) doesn't tear channels down and rebuild them.
  const threadIdsKey = threads.map((t) => t.id).slice().sort().join(',')
  useEffect(() => {
    const ids = threads.map((t) => t.id)
    for (const projectId of ids) {
      if (threadChannelsRef.current[projectId]) continue
      const ch = supabase
        .channel(`thread:${projectId}`, { config: { broadcast: { self: false } } })
        .on('broadcast', { event: 'message' }, (p) => handleIncoming(p.payload))
        .on('broadcast', { event: 'sync' }, (p) => {
          const pid = p.payload?.projectId ?? projectId
          if (activeThreadIdRef.current === pid) refetchMessages(pid)
        })
        .on('broadcast', { event: 'typing' }, (p) => {
          if (activeThreadIdRef.current !== projectId) return
          if (p.payload?.role === 'admin') {
            setAdminTyping(true)
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
            typingTimeoutRef.current = setTimeout(() => setAdminTyping(false), 3000)
          }
        })
        .subscribe()
      threadChannelsRef.current[projectId] = ch
    }
    // Drop channels for threads that disappeared.
    for (const pid of Object.keys(threadChannelsRef.current)) {
      if (!ids.includes(pid)) {
        supabase.removeChannel(threadChannelsRef.current[pid])
        delete threadChannelsRef.current[pid]
      }
    }
  }, [threadIdsKey, handleIncoming, refetchMessages])

  // Tear every channel down on unmount. acquireHub/releaseHub tells
  // PresencePulse this tab owns the thread topics (so it won't double-subscribe
  // them for delivery receipts).
  useEffect(() => {
    acquireHub()
    return () => {
      releaseHub()
      for (const pid of Object.keys(threadChannelsRef.current)) {
        supabase.removeChannel(threadChannelsRef.current[pid])
      }
      threadChannelsRef.current = {}
    }
  }, [])

  // Polling safety net — keeps the thread live if realtime + broadcast both
  // drop. The broadcast layer above already makes updates feel instant.
  useEffect(() => {
    if (!activeThread) return
    const projectId = activeThread.id
    const interval = setInterval(() => refetchMessages(projectId), 6000)
    return () => clearInterval(interval)
  }, [activeThread?.id, refetchMessages])

  // Broadcast typing when client types (through the active thread's channel)
  function handleClientTyping() {
    if (!activeThread) return
    const ch = threadChannelsRef.current[activeThread.id]
    if (!ch || typingBroadcastRef.current) return
    ch.send({
      type: 'broadcast',
      event: 'typing',
      payload: { role: 'client' },
    })
    typingBroadcastRef.current = setTimeout(() => {
      typingBroadcastRef.current = null
    }, 2000)
  }

  function selectThread(thread: Thread) {
    setAdminTyping(false)
    setActiveThread(thread)
    setMobileView('thread')
    loadMessages(thread.id)
  }

  async function sendMessage(
    body: string,
    replyToId?: string,
    attachmentUrl?: string,
    attachmentName?: string
  ) {
    if (!activeThread) return

    const optimistic: Message = {
      id: `temp-${Date.now()}`,
      project_id: activeThread.id,
      sender_id: clientId,
      sender_role: 'client',
      sender_name: clientName,
      body,
      read_at: null,
      delivered_at: null,
      reply_to_id: replyToId || null,
      attachment_url: attachmentUrl || null,
      attachment_name: attachmentName || null,
      is_deleted: false,
      edited_at: null,
      created_at: new Date().toISOString(),
    }

    // Optimistic update — appear instantly
    setMessages((prev) => [...prev, optimistic])

    let inserted: Message | null = null
    try {
      const res = await fetch('/api/portal/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send_message',
          project_id: activeThread.id,
          body,
          reply_to_id: replyToId || null,
          attachment_url: attachmentUrl || null,
          attachment_name: attachmentName || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Send failed')
      inserted = json.message
    } catch (err: any) {
      // Roll back optimistic message on failure and surface the reason.
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
      setSendError(err?.message ?? 'Failed to send message.')
      setTimeout(() => setSendError(null), 6000)
      throw err
    }

    if (inserted) {
      // Replace optimistic with real (dedupe if realtime already added it)
      setMessages((prev) => {
        if (prev.some((m) => m.id === inserted!.id)) {
          return prev.filter((m) => m.id !== optimistic.id)
        }
        return prev.map((m) => (m.id === optimistic.id ? inserted! : m))
      })
      setThreads((prev) => {
        const idx = prev.findIndex((t) => t.id === activeThread.id)
        if (idx === -1) return prev
        const updated = { ...prev[idx], latestMessage: inserted }
        return [updated, ...prev.filter((t) => t.id !== activeThread.id)]
      })
      // Tell the admin instantly: reorder their thread, bump unread (or mark
      // read if they're in it), and flip our tick single→double.
      const ch = threadChannelsRef.current[activeThread.id]
      ch?.send({
        type: 'broadcast',
        event: 'message',
        payload: {
          projectId: activeThread.id,
          messageId: inserted.id,
          senderRole: 'client',
          senderName: inserted.sender_name,
          body: inserted.body,
          attachmentName: inserted.attachment_name,
          createdAt: inserted.created_at,
        },
      })
    }
  }

  async function handleAttachmentUpload(file: File): Promise<{ url: string; name: string }> {
    if (!activeThread) throw new Error('No active thread')
    const uploaded = await uploadFileToR2({
      file,
      projectId: activeThread.id,
      direction: 'client-upload',
      category: 'message',
    })

    return {
      url: `${uploaded.bucket}::${uploaded.file_path}`,
      name: uploaded.file_name,
    }
  }

  async function handleDeleteMessage(messageId: string) {
    const res = await fetch('/api/portal/messages/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id: messageId }),
    })
    if (!res.ok) {
      const json = await res.json()
      throw new Error(json.error || 'Delete failed')
    }
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId
          ? { ...m, is_deleted: true, body: '', attachment_url: null, attachment_name: null }
          : m
      )
    )
  }

  async function handleEditMessage(messageId: string, newBody: string) {
    const res = await fetch('/api/portal/messages/edit', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id: messageId, body: newBody }),
    })
    const json = await res.json()
    if (!res.ok) {
      alert(json.error || 'Edit failed')
      throw new Error(json.error || 'Edit failed')
    }
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId
          ? { ...m, body: newBody, edited_at: new Date().toISOString() }
          : m
      )
    )
  }

  const totalUnread = threads.reduce(
    (acc, t) => acc + t.unreadCount,
    0
  )

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col w-full">
      {/* Header */}
      <div className="mb-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <h1
            className="font-display text-2xl font-bold"
            style={{ color: 'hsl(var(--foreground))' }}
          >
            Messages
          </h1>
          {totalUnread > 0 && (
            <span
              className="text-xs font-bold px-2 py-0.5 
              rounded-full"
              style={{
                backgroundColor: 'hsl(var(--destructive) / 0.15)',
                color: 'hsl(var(--destructive))',
              }}
            >
              {totalUnread} unread
            </span>
          )}
        </div>
        <p className="text-sm mt-1"
          style={{ color: 'hsl(var(--muted-foreground))' }}>
          {threads.length} project thread
          {threads.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Layout */}
      <div
        className="flex-1 rounded-2xl overflow-hidden flex 
        min-h-0"
        style={{ border: '1px solid hsl(var(--border))' }}
      >
        {/* Thread list — hidden on mobile when thread open */}
        <div
          className={`flex-shrink-0 flex flex-col 
          border-r overflow-hidden
          ${mobileView === 'thread'
            ? 'hidden md:flex'
            : 'flex'
          } 
          w-full md:w-72`}
          style={{
            backgroundColor: 'hsl(var(--card))',
            borderColor: 'hsl(var(--border))',
          }}
        >
          {/* List header — fixed height so its divider aligns with the conversation header */}
          <div
            className="px-4 h-[60px] flex items-center flex-shrink-0"
            style={{ borderBottom: '1px solid hsl(var(--border))' }}
          >
            <p
              className="text-xs font-semibold uppercase
              tracking-widest"
              style={{ color: 'hsl(var(--text-faint))' }}
            >
              Project Threads
            </p>
          </div>

          {/* Threads */}
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {threads.length === 0 && (
              <div
                className="flex flex-col items-center 
                justify-center h-full py-12 px-4 text-center"
              >
                <MessageSquare size={28}
                  style={{ color: 'hsl(var(--text-faint))' }} />
                <p className="text-sm mt-3"
                  style={{ color: 'hsl(var(--muted-foreground))' }}>
                  No projects yet
                </p>
                <p className="text-xs mt-1"
                  style={{ color: 'hsl(var(--text-faint))' }}>
                  Messages will appear here once your 
                  projects are created
                </p>
              </div>
            )}

            {threads.map((thread) => {
              const isActive = activeThread?.id === thread.id
              const hasUnread = thread.unreadCount > 0

              return (
                <button
                  key={thread.id}
                  onClick={() => selectThread(thread)}
                  className="w-full text-left px-4 py-4 
                  transition-all"
                  style={{
                    backgroundColor: isActive
                      ? 'hsl(var(--border))'
                      : 'transparent',
                    borderBottom: '1px solid hsl(var(--border))',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive)
                      e.currentTarget.style.backgroundColor =
                        'hsl(var(--border))'
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive)
                      e.currentTarget.style.backgroundColor =
                        'transparent'
                  }}
                >
                  <div className="flex items-start 
                    justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center 
                        gap-2">
                        {hasUnread && (
                          <div
                            className="w-2 h-2 rounded-full 
                            flex-shrink-0"
                            style={{
                              backgroundColor: 'hsl(var(--destructive))',
                            }}
                          />
                        )}
                        <p
                          className="text-sm truncate"
                          style={{
                            color: 'hsl(var(--foreground))',
                            fontWeight: hasUnread ? 600 : 400,
                          }}
                        >
                          {thread.title}
                        </p>
                      </div>
                      {thread.latestMessage ? (
                        <p
                          className="text-xs mt-1 truncate"
                          style={{ color: 'hsl(var(--muted-foreground))' }}
                        >
                          {thread.latestMessage
                            .sender_role === 'admin'
                            ? 'McPrime: '
                            : 'You: '}
                          {messagePreview(thread.latestMessage)}
                        </p>
                      ) : (
                        <p
                          className="text-xs mt-1 italic"
                          style={{ color: 'hsl(var(--text-faint))' }}
                        >
                          No messages yet
                        </p>
                      )}
                    </div>

                    <div className="flex flex-col 
                      items-end gap-1.5 flex-shrink-0">
                      {thread.latestMessage && (
                        <span
                          className="text-[10px]"
                          style={{ color: 'hsl(var(--text-faint))' }}
                        >
                          {timeAgo(
                            thread.latestMessage.created_at
                          )}
                        </span>
                      )}
                      {hasUnread && (
                        <span
                          className="text-[10px] font-bold 
                          w-5 h-5 rounded-full flex items-center 
                          justify-center"
                          style={{
                            backgroundColor: 'hsl(var(--destructive))',
                            color: '#fff',
                          }}
                        >
                          {thread.unreadCount > 9
                            ? '9+'
                            : thread.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Status */}
                  <div className="mt-2">
                    <StatusBadge
                      status={thread.status}
                      size="xs"
                    />
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Conversation pane */}
        <div
          className={`flex-1 flex flex-col min-w-0 
          ${mobileView === 'list'
            ? 'hidden md:flex'
            : 'flex'
          }`}
          style={{ backgroundColor: 'hsl(var(--background))' }}
        >
          {!activeThread && (
            <div
              className="flex-1 flex flex-col items-center 
              justify-center"
            >
              <div
                className="w-16 h-16 rounded-2xl flex 
                items-center justify-center mb-4"
                style={{
                  backgroundColor: 'hsl(var(--primary) / 0.08)',
                }}
              >
                <MessageSquare size={28}
                  style={{ color: 'hsl(var(--primary))' }} />
              </div>
              <p
                className="text-base font-semibold"
                style={{ color: 'hsl(var(--foreground))' }}
              >
                Select a project thread
              </p>
              <p
                className="text-sm mt-1 text-center 
                max-w-[200px]"
                style={{ color: 'hsl(var(--muted-foreground))' }}
              >
                Choose a project from the left to view 
                messages
              </p>
            </div>
          )}

          {activeThread && (
            <>
              {/* Thread header — fixed height so its divider aligns with the threads list header */}
              <div
                className="flex items-center gap-3 px-5 h-[60px] flex-shrink-0"
                style={{
                  borderBottom: '1px solid hsl(var(--border))',
                  backgroundColor: 'hsl(var(--card))',
                }}
              >
                {/* Mobile back */}
                <button
                  onClick={() => setMobileView('list')}
                  className="md:hidden p-1 rounded 
                  transition-colors"
                  style={{ color: 'hsl(var(--muted-foreground))' }}
                >
                  <ChevronLeft size={18} />
                </button>

                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm font-semibold truncate"
                    style={{ color: 'hsl(var(--foreground))' }}
                  >
                    {activeThread.title}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <StatusBadge
                      status={activeThread.status}
                      size="xs"
                    />
                    <span
                      className="flex items-center gap-1.5 text-xs"
                      style={{
                        color: adminTyping
                          ? 'hsl(var(--primary))'
                          : adminOnline
                          ? 'hsl(var(--status-green))'
                          : 'hsl(var(--text-faint))',
                      }}
                    >
                      {!adminTyping && (
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{
                            backgroundColor: adminOnline
                              ? 'hsl(var(--status-green))'
                              : 'hsl(var(--text-faint))',
                          }}
                        />
                      )}
                      {adminTyping ? 'typing…' : adminOnline ? 'Online' : 'Away'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Messages & Input via shared component */}
              <div className="flex-1 min-h-0 relative">
                {sendError && (
                  <div
                    className="absolute top-2 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 rounded-lg text-xs font-medium"
                    style={{ backgroundColor: 'hsl(var(--destructive) / 0.15)', color: 'hsl(var(--destructive))', border: '1px solid hsl(var(--destructive) / 0.3)' }}
                  >
                    {sendError}
                  </div>
                )}
                {loadingMessages ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2
                      size={18}
                      className="animate-spin"
                      style={{ color: 'hsl(var(--text-faint))' }}
                    />
                  </div>
                ) : (
                  <MessageThread
                    messages={messages}
                    currentRole="client"
                    currentName={clientName}
                    otherName="McPrime Digital"
                    projectId={activeThread.id}
                    onSendMessage={sendMessage}
                    onUploadAttachment={handleAttachmentUpload}
                    onDeleteMessage={handleDeleteMessage}
                    onEditMessage={handleEditMessage}
                    onTyping={handleClientTyping}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
