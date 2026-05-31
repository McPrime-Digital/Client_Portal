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
  const channelRef = useRef<any>(null)

  // Typing & presence state (per active thread)
  const [adminTyping, setAdminTyping] = useState(false)
  const [adminOnline, setAdminOnline] = useState(false)
  const typingChannelRef = useRef<any>(null)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typingBroadcastRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // On mobile, show thread list or conversation
  const [mobileView, setMobileView] = useState<
    'list' | 'thread'
  >('list')

  // Auto-select the first thread (desktop) so the client can message right
  // away instead of landing on an empty conversation pane.
  useEffect(() => {
    if (!activeThread && threads.length > 0) setActiveThread(threads[0])
  }, [threads, activeThread])

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

      // Mark admin messages as read (server-side, service role)
      fetch('/api/portal/messages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId }),
      }).catch(() => {})

      setThreads((prev) =>
        prev.map((t) =>
          t.id === projectId ? { ...t, unreadCount: 0 } : t
        )
      )
    },
    []
  )

  // Subscribe to realtime for active thread
  useEffect(() => {
    if (!activeThread) return

    // Unsub previous
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
    }

    const channel = supabase
      .channel(`messages-hub:${activeThread.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `project_id=eq.${activeThread.id}`,
        },
        async (payload) => {
          const msg = payload.new as Message

          // Add to messages
          setMessages((prev) => {
            if (prev.find((m) => m.id === msg.id))
              return prev
            return [...prev, msg]
          })

          // Update thread latest message
          setThreads((prev) =>
            prev.map((t) =>
              t.id === activeThread.id
                ? {
                    ...t,
                    latestMessage: msg,
                    unreadCount:
                      msg.sender_role === 'admin'
                        ? 0
                        : t.unreadCount,
                  }
                : t
            )
          )

          // Auto mark as read if from admin (read implies delivered)
          if (msg.sender_role === 'admin') {
            fetch('/api/portal/messages', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ project_id: activeThread.id }),
            }).catch(() => {})
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `project_id=eq.${activeThread.id}`,
        },
        (payload) => {
          const updated = payload.new as Message
          setMessages((prev) =>
            prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m))
          )
        }
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      supabase.removeChannel(channel)
    }
  }, [activeThread?.id])

  // Typing indicator + presence for the active thread
  useEffect(() => {
    if (!activeThread) {
      setAdminTyping(false)
      setAdminOnline(false)
      typingChannelRef.current = null
      return
    }
    const projectId = activeThread.id

    // Single subscribed channel used for BOTH listening and sending typing
    // events — sending through a subscribed channel is far more reliable
    // than spinning up a throwaway channel per keystroke.
    const typingCh = supabase
      .channel(`typing:${projectId}`)
      .on('broadcast', { event: 'typing' }, (payload) => {
        if (payload.payload?.role === 'admin') {
          setAdminTyping(true)
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
          typingTimeoutRef.current = setTimeout(() => setAdminTyping(false), 3000)
        }
      })
      .subscribe()
    typingChannelRef.current = typingCh

    const presenceCh = supabase.channel(`presence:${projectId}`, {
      config: { presence: { key: `client-${clientId}` } },
    })
    presenceCh
      .on('presence', { event: 'sync' }, () => {
        const state = presenceCh.presenceState()
        const adminPresent = Object.values(state).some((presences: any) =>
          presences.some((p: any) => p.role === 'admin')
        )
        setAdminOnline(adminPresent)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await presenceCh.track({ role: 'client' })
        }
      })

    return () => {
      typingChannelRef.current = null
      supabase.removeChannel(typingCh)
      supabase.removeChannel(presenceCh)
    }
  }, [activeThread?.id])

  // Polling fallback — keeps the thread live even when realtime replication
  // is unavailable. Picks up new messages and read/delivered changes.
  useEffect(() => {
    if (!activeThread) return
    const projectId = activeThread.id
    const interval = setInterval(() => {
      fetch(`/api/portal/messages?project_id=${projectId}`)
        .then((r) => r.json())
        .then((json) => {
          if (!json.messages) return
          setMessages((prev) => {
            const incoming = json.messages as Message[]
            if (samePersisted(prev, incoming)) return prev
            const pending = prev.filter((m) => m.id.startsWith('temp-'))
            return [...incoming, ...pending]
          })
        })
        .catch(() => {})
    }, 5000)
    return () => clearInterval(interval)
  }, [activeThread?.id])

  // Broadcast typing when client types (through the subscribed channel)
  function handleClientTyping() {
    const ch = typingChannelRef.current
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
      setThreads((prev) =>
        prev.map((t) =>
          t.id === activeThread.id
            ? { ...t, latestMessage: inserted }
            : t
        )
      )
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
                          {thread.latestMessage.body}
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
