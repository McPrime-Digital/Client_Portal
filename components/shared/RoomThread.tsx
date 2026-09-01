'use client'

/**
 * RoomThread — Batch 15 item 1. THE conversation engine.
 *
 * One room, three views, one code path: the hub's "All" view, the General
 * (untagged) thread, and every project page render THIS component with a
 * filter. It owns fetching (bounded, keyset-extended in item 2), realtime
 * (the thread-bus broadcast topic + an optional replication fallback),
 * sending, receipts, typing, and the chime. The 14.10 MessageThread renderer
 * sits inside it untouched — rule zero.
 *
 * Realtime protocol (shared with PresencePulse and the hubs since 14.9):
 * topic `thread:<key>` where key is the project id for a tagged view and
 * `room:<clientId>` for room-level views; events `message`, `typing`, `sync`.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import MessageThread from '@/components/shared/MessageThread'
import type { Message } from '@/lib/types/database'
import { uploadFileToR2 } from '@/lib/uploadClient'
import { playMessageChime, primeAudio } from '@/lib/soundClient'
import type { ThreadMessagePayload } from '@/lib/realtimeBus'

export type RoomFilter =
  | { kind: 'all' }
  | { kind: 'general' }
  | { kind: 'project'; projectId: string }

export type ExternalRow = { row: Message; n: number }

type Props = {
  role: 'admin' | 'client'
  /** the room's company */
  clientId: string
  /** badge-ping target: the tenant this conversation belongs to */
  orgId?: string | null
  filter: RoomFilter
  currentName: string
  otherName?: string
  canSend?: boolean
  /**
   * General/All uploads use the client-scoped `_general` prefix (item 7);
   * project views use the project scope as always.
   */
  allowAttachments?: boolean
  /** standalone surfaces (project pages) subscribe their own replication fallback */
  selfFallback?: boolean
  /** hubs forward their fallback rows here instead (one subscription, not two) */
  externalRow?: ExternalRow | null
  /** list-movement hook: fires ONLY on real activity (new message), never on open */
  onActivity?: (latest: Message, direction: 'incoming' | 'sent') => void
  onTypingChange?: (typing: boolean) => void
}

function matchesFilter(filter: RoomFilter, projectId: string | null): boolean {
  if (filter.kind === 'all') return true
  if (filter.kind === 'general') return projectId == null
  // A project view is the room filtered to its tag PLUS untagged (S-F §2.2).
  return projectId == null || projectId === filter.projectId
}

export default function RoomThread({
  role,
  clientId,
  orgId,
  filter,
  currentName,
  otherName,
  canSend = true,
  allowAttachments = true,
  selfFallback = false,
  externalRow = null,
  onActivity,
  onTypingChange,
}: Props) {
  const supabase = createClient()
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [sendError, setSendError] = useState<string | null>(null)

  const ownIdRef = useRef<string | null>(null)
  const seenIdsRef = useRef<Set<string>>(new Set())
  const roomIdRef = useRef<string | null>(null)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const typingSendRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typingClearRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const filterKey =
    filter.kind === 'project' ? `project:${filter.projectId}` : filter.kind
  const threadKey =
    filter.kind === 'project' ? filter.projectId : `room:${clientId}`

  useEffect(() => {
    primeAudio()
    createClient().auth.getUser().then(({ data }) => {
      ownIdRef.current = data.user?.id ?? null
    })
  }, [])

  // ── URLs / payload mapping per role + filter ─────────────────────────────
  const listUrl = useCallback(() => {
    const base = role === 'admin' ? '/api/admin/messages' : '/api/portal/messages'
    const p = new URLSearchParams()
    if (filter.kind === 'project') p.set('project_id', filter.projectId)
    else {
      p.set('scope', filter.kind === 'general' ? 'general' : 'room')
      if (role === 'admin') p.set('client_id', clientId)
    }
    return `${base}?${p.toString()}`
  }, [role, clientId, filterKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const patchBody = useCallback(
    (mode?: 'delivered') => {
      const body: Record<string, unknown> = mode ? { mode } : {}
      if (filter.kind === 'project') body.project_id = filter.projectId
      else {
        body.scope = filter.kind === 'general' ? 'general' : 'room'
        if (role === 'admin') body.client_id = clientId
      }
      return body
    },
    [role, clientId, filterKey] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const markRead = useCallback(() => {
    const base = role === 'admin' ? '/api/admin/messages' : '/api/portal/messages'
    fetch(base, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patchBody()),
    })
      .then(() => {
        channelRef.current?.send({
          type: 'broadcast',
          event: 'sync',
          payload: { projectId: threadKey },
        })
      })
      .catch(() => {})
  }, [role, patchBody, threadKey])

  // ── Load (bounded latest page; item 2 adds the cursor) ───────────────────
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(listUrl())
      const json = await res.json()
      const rows: Message[] = res.ok ? json.messages ?? [] : []
      setMessages(rows)
      if (json.roomId) roomIdRef.current = json.roomId
      for (const r of rows) seenIdsRef.current.add(r.id)
    } catch {
      setMessages([])
    } finally {
      setLoading(false)
    }
    markRead()
  }, [listUrl, markRead])

  useEffect(() => {
    seenIdsRef.current.clear()
    setMessages([])
    void load()
  }, [load])

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(listUrl())
      const json = await res.json()
      if (!res.ok || !json.messages) return
      const incoming = json.messages as Message[]
      setMessages((prev) => {
        const pending = prev.filter((m) => m.id.startsWith('temp-'))
        for (const r of incoming) seenIdsRef.current.add(r.id)
        return [...incoming, ...pending]
      })
    } catch {}
  }, [listUrl])

  // ── One incoming path for broadcast AND replication ──────────────────────
  const handleIncomingRow = useCallback(
    (row: Message) => {
      if (row.sender_id === ownIdRef.current) return
      if (!matchesFilter(filter, row.project_id ?? null)) return
      if (seenIdsRef.current.has(row.id)) return
      seenIdsRef.current.add(row.id)
      playMessageChime()
      setMessages((prev) =>
        prev.some((m) => m.id === row.id) ? prev : [...prev, row]
      )
      onActivity?.(row, 'incoming')
      const visible =
        typeof document !== 'undefined' && document.visibilityState === 'visible'
      if (visible) markRead()
      else {
        const base = role === 'admin' ? '/api/admin/messages' : '/api/portal/messages'
        fetch(base, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patchBody('delivered')),
        }).catch(() => {})
      }
    },
    [filter, role, patchBody, markRead, onActivity] // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Hub-forwarded replication rows (one subscription in the hub, not two).
  const lastExternalN = useRef(0)
  useEffect(() => {
    if (!externalRow || externalRow.n === lastExternalN.current) return
    lastExternalN.current = externalRow.n
    handleIncomingRow(externalRow.row)
  }, [externalRow, handleIncomingRow])

  // ── The thread bus ───────────────────────────────────────────────────────
  useEffect(() => {
    const ch = supabase
      .channel(`thread:${threadKey}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'message' }, (p) => {
        const pl = p.payload as ThreadMessagePayload | undefined
        if (!pl?.messageId) return
        if (pl.senderId && pl.senderId === ownIdRef.current) return
        // The broadcast is the instant signal; the row itself follows via
        // refetch (cheap: one bounded page) so we render the real thing.
        if (!seenIdsRef.current.has(pl.messageId)) {
          seenIdsRef.current.add(pl.messageId)
          playMessageChime()
          void refetch().then(() => markRead())
        }
      })
      .on('broadcast', { event: 'typing' }, (p) => {
        const otherRole = role === 'admin' ? 'client' : 'admin'
        if (p.payload?.role !== otherRole) return
        onTypingChange?.(true)
        if (typingClearRef.current) clearTimeout(typingClearRef.current)
        typingClearRef.current = setTimeout(() => onTypingChange?.(false), 3000)
      })
      .on('broadcast', { event: 'sync' }, () => void refetch())
      .subscribe()
    channelRef.current = ch
    return () => {
      channelRef.current = null
      supabase.removeChannel(ch)
    }
  }, [threadKey, role]) // eslint-disable-line react-hooks/exhaustive-deps

  // Standalone surfaces: replication fallback, filtered to this room, so a
  // send surface that forgets to broadcast still lands here in ~2s.
  useEffect(() => {
    if (!selfFallback) return
    let ch: ReturnType<typeof supabase.channel> | null = null
    let cancelled = false
    const start = (roomId: string) => {
      if (cancelled) return
      ch = supabase
        .channel(`room-fallback:${roomId}:${threadKey}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
          (p) => handleIncomingRow(p.new as Message)
        )
        .subscribe()
    }
    if (roomIdRef.current) start(roomIdRef.current)
    else {
      const t = setInterval(() => {
        if (roomIdRef.current) {
          clearInterval(t)
          start(roomIdRef.current)
        }
      }, 500)
      setTimeout(() => clearInterval(t), 10_000)
    }
    return () => {
      cancelled = true
      if (ch) supabase.removeChannel(ch)
    }
  }, [selfFallback, threadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Typing (throttled, over the bus) ─────────────────────────────────────
  const handleTyping = useCallback(() => {
    if (typingSendRef.current) return
    channelRef.current?.send({
      type: 'broadcast',
      event: 'typing',
      payload: { role },
    })
    typingSendRef.current = setTimeout(() => {
      typingSendRef.current = null
    }, 2000)
  }, [role])

  // ── Badge bus: tell the OTHER side's rail instantly ──────────────────────
  const pingBadges = useCallback(() => {
    const topics =
      role === 'admin'
        ? [`badges:client:${clientId}`, ...(orgId ? [`badges:org:${orgId}`] : [])]
        : orgId
          ? [`badges:org:${orgId}`]
          : []
    for (const topic of topics) {
      const ch = supabase.channel(topic)
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          ch.send({ type: 'broadcast', event: 'badge', payload: {} })
          setTimeout(() => supabase.removeChannel(ch), 1500)
        }
      })
    }
  }, [role, clientId, orgId, supabase])

  // ── Send ─────────────────────────────────────────────────────────────────
  async function sendMessage(
    body: string,
    replyToId?: string,
    attachmentUrl?: string,
    attachmentName?: string,
    attachmentFileId?: string
  ) {
    const optimistic: Message = {
      id: `temp-${Date.now()}`,
      room_id: null,
      thread_root_id: null,
      deleted_at: null,
      project_id: (filter.kind === 'project' ? filter.projectId : null) as unknown as string,
      sender_id: ownIdRef.current ?? '',
      sender_role: role,
      sender_name: currentName,
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
    setMessages((prev) => [...prev, optimistic])

    let inserted: Message | null = null
    try {
      const res = await fetch(
        role === 'admin' ? '/api/admin/project-actions' : '/api/portal/actions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'send_message',
            ...(filter.kind === 'project'
              ? { project_id: filter.projectId }
              : role === 'admin'
                ? { client_id: clientId }
                : {}),
            body,
            reply_to_id: replyToId || null,
            attachment_url: attachmentUrl || null,
            attachment_name: attachmentName || null,
            attachment_file_id: attachmentFileId || null,
          }),
        }
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Send failed')
      inserted = json.message ?? null
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
      setSendError(err instanceof Error ? err.message : 'Failed to send message.')
      setTimeout(() => setSendError(null), 6000)
      throw err
    }

    if (inserted) {
      seenIdsRef.current.add(inserted.id)
      setMessages((prev) => {
        if (prev.some((m) => m.id === inserted!.id)) {
          return prev.filter((m) => m.id !== optimistic.id)
        }
        return prev.map((m) => (m.id === optimistic.id ? inserted! : m))
      })
      onActivity?.(inserted, 'sent')
      channelRef.current?.send({
        type: 'broadcast',
        event: 'message',
        payload: {
          projectId: threadKey,
          messageId: inserted.id,
          senderRole: role,
          senderId: inserted.sender_id,
          senderName: inserted.sender_name,
          body: inserted.body,
          attachmentName: inserted.attachment_name,
          createdAt: inserted.created_at,
        },
      })
      pingBadges()
    }
  }

  // ── Attachments (project scope, or the client's `_general` scope) ────────
  async function handleAttachmentUpload(file: File) {
    const uploaded = await uploadFileToR2({
      file,
      ...(filter.kind === 'project'
        ? { projectId: filter.projectId }
        : { clientId }),
      direction: role === 'admin' ? 'delivery' : 'client-upload',
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
    setMessages((prev) => prev.filter((m) => m.id !== messageId))
  }

  async function handleEditMessage(messageId: string, newBody: string) {
    const res = await fetch('/api/portal/messages/edit', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id: messageId, body: newBody }),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Edit failed')
    if (json.message) {
      setMessages((prev) => prev.map((m) => (m.id === messageId ? json.message : m)))
    }
  }

  return (
    <div className="h-full min-h-0 relative flex flex-col">
      {sendError && (
        <div
          className="absolute top-2 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 rounded-lg text-xs font-medium"
          style={{
            backgroundColor: 'hsl(var(--destructive) / 0.15)',
            color: 'hsl(var(--destructive))',
            border: '1px solid hsl(var(--destructive) / 0.3)',
          }}
        >
          {sendError}
        </div>
      )}
      {loading && messages.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div
            className="w-6 h-6 rounded-full border-2 animate-spin"
            style={{
              borderColor: 'hsl(var(--border))',
              borderTopColor: 'hsl(var(--primary))',
            }}
          />
        </div>
      ) : (
        <MessageThread
          messages={messages}
          currentRole={role}
          currentName={currentName}
          otherName={otherName}
          projectId={threadKey}
          onSendMessage={sendMessage}
          readOnly={!canSend}
          onUploadAttachment={allowAttachments ? handleAttachmentUpload : undefined}
          onDeleteMessage={handleDeleteMessage}
          onEditMessage={handleEditMessage}
          onTyping={handleTyping}
        />
      )}
    </div>
  )
}
