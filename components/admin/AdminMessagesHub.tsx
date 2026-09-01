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
  ChevronLeft,
  Volume2,
  VolumeX,
} from 'lucide-react'
import MessageThread from '@/components/shared/MessageThread'
import type { Message } from '@/lib/types/database'
import { uploadFileToR2 } from '@/lib/uploadClient'
import { messagePreview } from '@/lib/messagePreview'
import { playMessageChime, messageSoundEnabled, setMessageSoundEnabled } from '@/lib/soundClient'
import { usePresenceStore, isClientOnline } from '@/lib/stores/presence-store'
import { acquireHub, releaseHub, type ThreadMessagePayload } from '@/lib/realtimeBus'

type Thread = {
  id: string
  title: string
  status: string | null
  type: string | null
  /** the company's room-level conversation — id is "room:<clientId>" */
  isGeneral?: boolean
  client?: {
    id: string
    name: string
    company: string | null
  }
  latestMessage: Message | null
  unreadCount: number
}


type Props = {
  threads: Thread[]
  adminName: string
  /** the org id — powers the replication fallback subscription */
  orgId?: string | null
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

export default function AdminMessagesHub({
  threads: initialThreads,
  adminName, orgId,
}: Props) {
  const supabase = createClient()
  const [threads, setThreads] = useState(initialThreads)
  const [activeThread, setActiveThread] =
    useState<Thread | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  // Own auth uid — echo suppression compares sender identity, never role.
  const ownIdRef = useRef<string | null>(null)
  const seenIdsRef = useRef<Set<string>>(new Set())
  // Device-level chime switch (localStorage); per-room preference is
  // message_room_prefs, wired when the hub grows its settings surface.
  // Lazy init: messageSoundEnabled() guards storage access, so SSR renders
  // the default and the client hydrates the stored choice.
  const [soundOn, setSoundOn] = useState(() => messageSoundEnabled())
  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => { ownIdRef.current = data.user?.id ?? null })
  }, [])
  // One persistent broadcast channel per thread (`thread:${projectId}`),
  // subscribed for EVERY thread — so a message in any thread reorders the list,
  // bumps its unread badge and flips ticks live, not just the open one.
  const threadChannelsRef = useRef<Record<string, any>>({})

  // Typing state (per active thread). Online/Away comes from app-wide presence.
  const [clientTyping, setClientTyping] = useState(false)
  const online = usePresenceStore((s) => s.online)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typingBroadcastRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Stable view of the active thread id for use inside realtime callbacks.
  const activeThreadIdRef = useRef<string | null>(null)
  useEffect(() => { activeThreadIdRef.current = activeThread?.id ?? null }, [activeThread?.id])
  const clientOnline = isClientOnline(online, activeThread?.client?.id ?? null)

  const [mobileView, setMobileView] = useState<
    'list' | 'thread'
  >('list')

  // Broadcast a lightweight "sync" ping on a thread's channel so the client
  // refetches instantly — drives WhatsApp-speed ticks without relying on
  // Postgres replication (which RLS starves on the admin side).
  const broadcastSync = useCallback((projectId: string) => {
    const ch = threadChannelsRef.current[projectId]
    if (ch) ch.send({ type: 'broadcast', event: 'sync', payload: { projectId } })
  }, [])

  const loadMessages = useCallback(
    async (projectId: string) => {
      setLoadingMessages(true)
      try {
        const res = await fetch(
          `/api/admin/messages?project_id=${projectId}`
        )
        const json = await res.json()
        setMessages(res.ok ? (json.messages ?? []) : [])
      } catch {
        setMessages([])
      } finally {
        setLoadingMessages(false)
      }

      // Mark client messages as read (server-side, service role), then ping the
      // client so their ticks turn blue instantly.
      fetch('/api/admin/messages', {
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

  // Scroll behavior now handled inside MessageThread

  // Refetch the active thread, reorder the thread list (newest on top), and —
  // if the admin is viewing this thread — instantly mark incoming client
  // messages read and tell the client.
  const refetchMessages = useCallback(
    async (projectId: string) => {
      try {
        const res = await fetch(`/api/admin/messages?project_id=${projectId}`)
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
            (m) => m.sender_role === 'client' && !m.read_at && !m.id.startsWith('temp-')
          )
        ) {
          fetch('/api/admin/messages', {
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

  // Apply a thread's incoming message broadcast (from the client). Drives the
  // list whether or not that thread is open: reorder to top, bump the unread
  // badge for background threads, or pull it into the open conversation and
  // mark it read. Always acknowledges delivery so the client's tick flips.
  const handleIncoming = useCallback(
    (payload: ThreadMessagePayload) => {
      const projectId = payload?.projectId
      if (!projectId) return
      // Our own outgoing message is already reflected locally on send.
      // Compare IDENTITY, never role — crew members share the admin role.
      if (payload.senderId ? payload.senderId === ownIdRef.current : payload.senderRole === 'admin') return
      // Broadcast + replication fallback can both deliver one message; the
      // first one wins so the badge never counts it twice.
      if (payload.messageId) {
        if (seenIdsRef.current.has(payload.messageId)) return
        if (seenIdsRef.current.size > 400) seenIdsRef.current.clear()
        seenIdsRef.current.add(payload.messageId)
      }
      playMessageChime()

      const open =
        activeThreadIdRef.current === projectId &&
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible'

      if (open) {
        // Active + visible: pull the message in, mark read, flip client ticks.
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
      // We received it → mark delivered and ping the client (double-grey tick).
      fetch('/api/admin/messages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, mode: 'delivered' }),
      })
        .then(() => broadcastSync(projectId))
        .catch(() => {})
    },
    [refetchMessages, broadcastSync]
  )

  // Replication fallback (Batch 14 item 9): admin replication was assumed
  // "RLS-starved" when these hubs were built on broadcast alone — the Batch 13
  // probe disproved that (delivery ~2s under the room policies). One
  // org-filtered subscription backstops any send surface that forgets to
  // broadcast; untagged rows skip (General threads live in hubs, which always
  // broadcast). handleIncoming dedupes against the broadcast copy.
  useEffect(() => {
    if (!orgId) return
    const ch = supabase
      .channel(`hub-fallback:${orgId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `organization_id=eq.${orgId}`,
      }, (p) => {
        const r = p.new as Message
        if (!r.project_id) return
        handleIncoming({
          projectId: r.project_id,
          messageId: r.id,
          senderRole: r.sender_role,
          senderId: r.sender_id,
          senderName: r.sender_name,
          body: r.body,
          attachmentName: r.attachment_name,
          createdAt: r.created_at,
        })
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [orgId, handleIncoming])

  // Persistent per-thread broadcast bus — one channel per thread, for ALL
  // threads (not just the open one). Each carries new-message, read/delivered
  // "sync" pings and typing. This is how a message in a background thread
  // reorders the list + bumps its unread badge live, and how ticks flip
  // instantly — all without relying on Postgres replication (RLS-starved for
  // admins). `self: false` so we never react to our own broadcasts.
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
          if (p.payload?.role === 'client') {
            setClientTyping(true)
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
            typingTimeoutRef.current = setTimeout(() => setClientTyping(false), 3000)
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
    const interval = setInterval(() => refetchMessages(projectId), 60_000)
    return () => clearInterval(interval)
  }, [activeThread?.id, refetchMessages])

  // Broadcast typing when admin types (through the active thread's channel)
  function handleAdminTyping() {
    if (!activeThread) return
    const ch = threadChannelsRef.current[activeThread.id]
    if (!ch || typingBroadcastRef.current) return
    ch.send({
      type: 'broadcast',
      event: 'typing',
      payload: { role: 'admin' },
    })
    typingBroadcastRef.current = setTimeout(() => {
      typingBroadcastRef.current = null
    }, 2000)
  }

  function selectThread(thread: Thread) {
    setClientTyping(false)
    setActiveThread(thread)
    setMobileView('thread')
    loadMessages(thread.id)
  }

  async function sendMessage(body: string, replyToId?: string, attachmentUrl?: string, attachmentName?: string, attachmentFileId?: string) {
    if (!activeThread) return

    const optimistic: Message = {
      id: `temp-${Date.now()}`,
      room_id: null,
      thread_root_id: null,
      deleted_at: null,
      project_id: activeThread.id,
      sender_id: '',
      sender_role: 'admin',
      sender_name: adminName,
      body: body,
      read_at: null,
      delivered_at: null,
      reply_to_id: replyToId || null,
      attachment_url: attachmentUrl || null,
      attachment_name: attachmentName || null,
      is_deleted: false,
      edited_at: null,
      created_at: new Date().toISOString(),
    }

    // Show instantly + float this thread to the top right away.
    setMessages((prev) => [...prev, optimistic])
    setThreads((prev) => {
      const idx = prev.findIndex((t) => t.id === activeThread.id)
      if (idx === -1) return prev
      const updated = { ...prev[idx], latestMessage: optimistic }
      return [updated, ...prev.filter((t) => t.id !== activeThread.id)]
    })

    let inserted: Message | null = null
    try {
      const res = await fetch('/api/admin/project-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send_message',
          project_id: activeThread.id,
          body,
          reply_to_id: replyToId || null,
          attachment_url: attachmentUrl || null,
          attachment_name: attachmentName || null,
          attachment_file_id: attachmentFileId || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Send failed')
      inserted = json.message
    } catch (err: any) {
      // Roll back the optimistic message on failure and surface the reason.
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
      // Tell the client instantly: reorder their thread, bump unread (or mark
      // read if they're in it), and flip our tick single→double.
      const ch = threadChannelsRef.current[activeThread.id]
      ch?.send({
        type: 'broadcast',
        event: 'message',
        payload: {
          projectId: activeThread.id,
          messageId: inserted.id,
          senderRole: 'admin',
          senderId: inserted.sender_id,
          senderName: inserted.sender_name,
          body: inserted.body,
          attachmentName: inserted.attachment_name,
          createdAt: inserted.created_at,
        },
      })
    }
  }

  async function handleAttachmentUpload(file: File): Promise<{ url: string; name: string; fileId?: string }> {
    if (!activeThread || !activeThread.client) throw new Error('No active thread or client')
    const uploaded = await uploadFileToR2({
      file,
      projectId: activeThread.id,
      direction: 'delivery',
      category: 'message',
    })

    return {
      url: `${uploaded.bucket}::${uploaded.file_path}`,
      name: uploaded.file_name,
      fileId: uploaded.id,
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
    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, is_deleted: true, body: '', attachment_url: null, attachment_name: null } : m))
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
    // Update locally
    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, body: newBody, edited_at: new Date().toISOString() } : m))
  }

  const totalUnread = threads.reduce(
    (acc, t) => acc + t.unreadCount,
    0
  )

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col">
      {/* Header */}
      <div className="mb-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <h1
            className="font-display text-2xl font-bold"
            style={{ color: 'hsl(var(--foreground))' }}
          >
            All Messages
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
              {totalUnread} new from clients
            </span>
          )}
        </div>
        <p className="text-sm mt-1"
          style={{ color: 'hsl(var(--muted-foreground))' }}>
          Monitoring {threads.length} active conversation
          {threads.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Layout */}
      <div
        className="flex-1 rounded-2xl overflow-hidden flex 
        min-h-0"
        style={{ border: '1px solid hsl(var(--border))' }}
      >
        {/* Thread list */}
        <div
          className={`flex-shrink-0 flex flex-col 
          border-r overflow-hidden
          ${mobileView === 'thread'
            ? 'hidden md:flex'
            : 'flex'
          } 
          w-full md:w-80`}
          style={{
            backgroundColor: 'hsl(var(--card))',
            borderColor: 'hsl(var(--border))',
          }}
        >
          <div
            className="px-4 h-[60px] flex items-center justify-between flex-shrink-0"
            style={{ borderBottom: '1px solid hsl(var(--border))' }}
          >
            <p
              className="text-xs font-semibold uppercase
              tracking-widest"
              style={{ color: 'hsl(var(--text-faint))' }}
            >
              All Conversations
            </p>
            <button
              type="button"
              onClick={() => { const next = !soundOn; setSoundOn(next); setMessageSoundEnabled(next) }}
              className="p-1.5 rounded-lg transition-colors hover:bg-[hsl(var(--border))]"
              style={{ color: soundOn ? 'hsl(var(--primary))' : 'hsl(var(--text-faint))' }}
              title={soundOn ? 'Mute message sound' : 'Unmute message sound'}
            >
              {soundOn ? <Volume2 size={14} /> : <VolumeX size={14} />}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {threads.length === 0 && (
              <div className="py-12 px-4 text-center">
                <MessageSquare size={28}
                  className="mx-auto"
                  style={{ color: 'hsl(var(--text-faint))' }} />
                <p className="text-sm mt-3"
                  style={{ color: 'hsl(var(--muted-foreground))' }}>
                  No messages yet
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
                      ? 'hsl(var(--primary) / 0.07)'
                      : 'transparent',
                    boxShadow: isActive ? 'inset 2px 0 0 hsl(var(--primary))' : 'none',
                    borderBottom: '1px solid hsl(var(--border))',
                  }}
                >
                  <div className="flex items-start 
                    justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm font-semibold truncate flex items-center gap-1.5"
                        style={{ color: 'hsl(var(--foreground))' }}
                      >
                        {thread.isGeneral && (
                          <span
                            className="w-4 h-4 rounded-md flex items-center justify-center flex-shrink-0"
                            style={{
                              backgroundColor: 'hsl(var(--primary) / 0.12)',
                              border: '1px solid hsl(var(--primary) / 0.35)',
                            }}
                          >
                            <MessageSquare size={9} style={{ color: 'hsl(var(--primary))' }} />
                          </span>
                        )}
                        {thread.title}
                      </p>
                      <p
                        className="text-[11px] font-medium 
                        mt-0.5"
                        style={{ color: 'hsl(var(--primary))' }}
                      >
                        {thread.client?.name}
                        {thread.client?.company ? ` · ${thread.client.company}` : ''}
                      </p>
                      
                      {thread.latestMessage ? (
                        <p
                          className="text-xs mt-1.5 truncate"
                          style={{ color: hasUnread ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))' }}
                        >
                          {thread.latestMessage.sender_role === 'admin'
                            ? 'You: '
                            : `${thread.client?.name}: `}
                          {messagePreview(thread.latestMessage)}
                        </p>
                      ) : (
                        <p className="text-xs mt-1.5 italic"
                          style={{ color: 'hsl(var(--text-faint))' }}>
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
                            backgroundColor: 'hsl(var(--primary))',
                            color: 'hsl(var(--primary-foreground))',
                          }}
                        >
                          {thread.unreadCount}
                        </span>
                      )}
                    </div>
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
            <div className="flex-1 flex flex-col items-center justify-center">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                style={{ backgroundColor: 'hsl(var(--primary) / 0.08)' }}>
                <MessageSquare size={28} style={{ color: 'hsl(var(--primary))' }} />
              </div>
              <p className="text-base font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
                Admin Messaging Hub
              </p>
              <p className="text-sm mt-1 text-center max-w-[250px]" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Select a thread to chat with the client
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
                <button
                  onClick={() => setMobileView('list')}
                  className="md:hidden p-1 rounded transition-colors"
                  style={{ color: 'hsl(var(--muted-foreground))' }}
                >
                  <ChevronLeft size={18} />
                </button>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: 'hsl(var(--foreground))' }}>
                    {activeThread.title}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs truncate" style={{ color: 'hsl(var(--primary))' }}>
                      {activeThread.client?.name}
                    </span>
                    <span
                      className="flex items-center gap-1.5 text-xs flex-shrink-0"
                      style={{ color: clientTyping ? 'hsl(var(--primary))' : clientOnline ? 'hsl(var(--status-green))' : 'hsl(var(--text-faint))' }}
                    >
                      {!clientTyping && (
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: clientOnline ? 'hsl(var(--status-green))' : 'hsl(var(--text-faint))' }}
                        />
                      )}
                      {clientTyping ? 'typing…' : clientOnline ? 'Online' : 'Away'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Messages & Input via Shared Component */}
              <div className="flex-1 min-h-0 relative">
                {sendError && (
                  <div
                    className="absolute top-2 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 rounded-lg text-xs font-medium"
                    style={{ backgroundColor: 'hsl(var(--destructive) / 0.15)', color: 'hsl(var(--destructive))', border: '1px solid hsl(var(--destructive) / 0.3)' }}
                  >
                    {sendError}
                  </div>
                )}
                <MessageThread
                  messages={messages}
                  currentRole="admin"
                  currentName={adminName}
                  otherName={activeThread.client?.name}
                  projectId={activeThread.id}
                  onSendMessage={sendMessage}
                  onUploadAttachment={activeThread.isGeneral ? undefined : handleAttachmentUpload}
                  onDeleteMessage={handleDeleteMessage}
                  onEditMessage={handleEditMessage}
                  onTyping={handleAdminTyping}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
