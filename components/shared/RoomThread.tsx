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
import {
  playMessageChime,
  primeAudio,
  messageSoundEnabled,
  setMessageSoundEnabled,
  playTestChime,
  focusModeEnabled,
  setFocusModeEnabled,
} from '@/lib/soundClient'
import { Pin, Bookmark, Settings2, Users, MoreVertical, Search as SearchIcon } from 'lucide-react'
import { mentionTrigger, setMentionTrigger, type MentionTrigger } from '@/lib/mentionClient'
import { projectColor } from '@/lib/projectColor'
import {
  wallpaperPattern,
  setWallpaperPattern,
  wallpaperIntensity,
  setWallpaperIntensity,
  INTENSITY_ALPHA,
  type WallpaperPattern,
  type WallpaperIntensity,
} from '@/lib/chatPrefs'
import type { ThreadMessagePayload } from '@/lib/realtimeBus'

export type RoomFilter =
  | { kind: 'all' }
  | { kind: 'general' }
  | { kind: 'project'; projectId: string }

export type ExternalRow = { row: Message; n: number; op?: 'insert' | 'update' }

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
  /** the other side's live composer state: typing, recording a voice note, or idle */
  onTypingChange?: (kind: 'typing' | 'recording' | null) => void
  /** hubs drive the room menu from their own header; pages keep the built-in one */
  panelCommand?: { which: 'pins' | 'saves' | 'settings' | 'people' | 'search'; n: number } | null
  showMenuButton?: boolean
  /** forward targets beyond this room (the studio's other client rooms) */
  forwardRooms?: { id: string; label: string }[]
}

// Instant-open cache (Batch 19): every view keeps its last rows across
// filter switches AND remounts, so a tap renders at 0ms from memory while
// the network refresh reconciles silently. A first-ever project view seeds
// from the All cache by local filtering — All is a superset.
const threadCache = new Map<
  string,
  { rows: Message[]; cursor: string | null; hasMore: boolean; roomId: string | null }
>()

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
  panelCommand = null,
  showMenuButton = true,
  forwardRooms = [],
}: Props) {
  const supabase = createClient()
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [sendError, setSendError] = useState<string | null>(null)
  // Keyset pagination (item 2): cursor of the oldest loaded message.
  const [pageCursor, setPageCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  // Threads (item 3): one level deep — a panel over the room, root on top.
  const [replyMeta, setReplyMeta] = useState<Record<string, { count: number; lastAt: string }>>({})
  const [threadRoot, setThreadRoot] = useState<Message | null>(null)
  const [threadReplies, setThreadReplies] = useState<Message[]>([])
  // Reactions/pins/saves (item 4). Reactions ride on message rows; pins are
  // room-wide; saves are private (user_id = auth.uid() by RLS construction).
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set())
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  const [panel, setPanel] = useState<'pins' | 'saves' | 'settings' | 'people' | 'search' | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const [searching, setSearching] = useState(false)
  const [panelRows, setPanelRows] = useState<Message[]>([])
  const [highlightId, setHighlightId] = useState<string | null>(null)
  // Mentions (item 5): per-viewer resolution rides each page; candidates
  // come from the roster endpoint once per room.
  const [mentionTargets, setMentionTargets] = useState<Record<string, Record<string, { label: string; sub?: string; href?: string } | null>> | null>(null)
  const [mentionCandidates, setMentionCandidates] = useState<{ users: { id: string; name: string }[]; projects: { id: string; title: string }[] } | null>(null)
  // Per-room notification preference (item 6a) + this device's switches.
  const [roomLevel, setRoomLevel] = useState<'all' | 'mentions' | 'muted'>('all')
  const [soundOn, setSoundOn] = useState(() => messageSoundEnabled())
  const [focusOn, setFocusOn] = useState(() => focusModeEnabled())
  const [people, setPeople] = useState<{ name: string; role: string; side: 'client' | 'crew' }[]>([])
  // Forward + bulk select (Batch 18)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [forwardFor, setForwardFor] = useState<Message[] | null>(null)
  const [trigger, setTrigger] = useState<MentionTrigger>(() => mentionTrigger())
  // Sticky composer tag (Batch 17): in All, the chosen project tags every
  // send until changed — persisted per room, per device.
  const [stickyTag, setStickyTag] = useState<string | null>(() => {
    try { return localStorage.getItem(`genreline-room-tag:${clientId}`) } catch { return null }
  })
  const [wpPattern, setWpPattern] = useState<WallpaperPattern>(() => wallpaperPattern())
  const [wpIntensity, setWpIntensity] = useState<WallpaperIntensity>(() => wallpaperIntensity())
  const setSticky = useCallback((id: string | null) => {
    setStickyTag(id)
    try {
      if (id) localStorage.setItem(`genreline-room-tag:${clientId}`, id)
      else localStorage.removeItem(`genreline-room-tag:${clientId}`)
    } catch { /* non-persistent */ }
  }, [clientId])
  // Project colour-bonding (Batch 16): title + deterministic colour per tag,
  // built from the candidates roster the room already fetches.
  const projectMeta = (mentionCandidates?.projects ?? []).reduce<Record<string, { title: string; color: string }>>(
    (acc, p) => {
      acc[p.id] = { title: p.title, color: projectColor(p.id) }
      return acc
    },
    {}
  )
  const projectIds = Object.keys(projectMeta)
  const effectiveTag =
    filter.kind === 'project'
      ? filter.projectId
      : stickyTag && projectMeta[stickyTag]
        ? stickyTag
        : projectIds.length === 1
          ? projectIds[0] // one project: All IS that project's line — auto-tag
          : null
  const threadRootRef = useRef<string | null>(null)
  useEffect(() => { threadRootRef.current = threadRoot?.id ?? null }, [threadRoot])

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
    createClient().auth.getUser().then(async ({ data }) => {
      ownIdRef.current = data.user?.id ?? null
      if (!data.user) return
      // Saves are read with the USER client under RLS — the policy is
      // user_id = auth.uid(), so this cannot see anyone else's by construction.
      const { data: saves } = await createClient()
        .from('message_saves')
        .select('message_id')
        .eq('user_id', data.user.id)
        .limit(500)
      if (saves) setSavedIds(new Set(saves.map((r) => r.message_id as string)))
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
  // Union by id, ordered (created_at, id) — pages and live rows interleave
  // safely, optimistic temps stay at the tail.
  const mergeRows = useCallback((prev: Message[], incoming: Message[]) => {
    const temps = prev.filter((m) => m.id.startsWith('temp-'))
    const byId = new Map<string, Message>()
    for (const m of prev) if (!m.id.startsWith('temp-')) byId.set(m.id, m)
    for (const m of incoming) byId.set(m.id, m)
    const rows = [...byId.values()].sort((a, b) =>
      a.created_at === b.created_at
        ? a.id < b.id ? -1 : 1
        : a.created_at < b.created_at ? -1 : 1
    )
    return [...rows, ...temps]
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(listUrl())
      const json = await res.json()
      const rows: Message[] = res.ok ? json.messages ?? [] : []
      setMessages((prev) => (prev.length ? mergeRows(prev, rows) : rows))
      setPageCursor(json.nextCursor ?? null)
      setHasMore(!!json.hasMore)
      if (json.replyMeta) setReplyMeta(json.replyMeta)
      if (json.pinnedIds) setPinnedIds(new Set(json.pinnedIds as string[]))
      if (json.mentionTargets) {
        // MERGE, never replace: cached messages from another view keep
        // rendering their already-resolved tags after a filter switch.
        const incoming = json.mentionTargets as Record<string, Record<string, { label: string; sub?: string; href?: string } | null>>
        setMentionTargets((prev) => {
          const next = { ...(prev ?? {}) }
          for (const [kind, m] of Object.entries(incoming)) next[kind] = { ...(next[kind] ?? {}), ...m }
          return next
        })
      }
      if (json.roomId) roomIdRef.current = json.roomId
      for (const r of rows) seenIdsRef.current.add(r.id)
    } catch {
      setMessages([])
    } finally {
      setLoading(false)
    }
    markRead()
  }, [listUrl, markRead, mergeRows])

  const loadOlder = useCallback(async () => {
    if (!pageCursor || loadingOlder) return
    setLoadingOlder(true)
    try {
      const res = await fetch(`${listUrl()}&before=${encodeURIComponent(pageCursor)}`)
      const json = await res.json()
      if (res.ok && json.messages) {
        const older = json.messages as Message[]
        for (const r of older) seenIdsRef.current.add(r.id)
        setMessages((prev) => mergeRows(prev, older))
        setPageCursor(json.nextCursor ?? null)
        setHasMore(!!json.hasMore)
      }
    } catch {} finally {
      setLoadingOlder(false)
    }
  }, [pageCursor, loadingOlder, listUrl, mergeRows])

  const cacheKey = `${role}:${clientId}:${filterKey}`
  useEffect(() => {
    // 0ms render: this view's cache, or a local filter of the All superset.
    const cached = threadCache.get(cacheKey)
    const allCached = threadCache.get(`${role}:${clientId}:all`)
    if (cached) {
      setMessages(cached.rows)
      setPageCursor(cached.cursor)
      setHasMore(cached.hasMore)
      if (cached.roomId) roomIdRef.current = cached.roomId
      for (const r of cached.rows) seenIdsRef.current.add(r.id)
    } else if (filter.kind !== 'all' && allCached) {
      const seeded = allCached.rows.filter((m) => matchesFilter(filter, m.project_id ?? null))
      setMessages(seeded)
      for (const r of seeded) seenIdsRef.current.add(r.id)
    } else {
      setMessages([])
    }
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  // Keep the cache current so the NEXT tap is instant too.
  useEffect(() => {
    if (messages.length === 0 && loading) return
    threadCache.set(cacheKey, {
      rows: messages.filter((m) => !m.id.startsWith('temp-')),
      cursor: pageCursor,
      hasMore,
      roomId: roomIdRef.current,
    })
  }, [messages, pageCursor, hasMore, cacheKey, loading])

  useEffect(() => {
    const base = role === 'admin' ? '/api/admin/messages' : '/api/portal/messages'
    const p = new URLSearchParams({ mention_candidates: '1' })
    if (role === 'admin') p.set('client_id', clientId)
    fetch(`${base}?${p.toString()}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.users) setMentionCandidates({ users: json.users, projects: json.projects ?? [] })
      })
      .catch(() => {})
  }, [role, clientId])

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(listUrl())
      const json = await res.json()
      if (!res.ok || !json.messages) return
      const incoming = json.messages as Message[]
      for (const r of incoming) seenIdsRef.current.add(r.id)
      // Merge, never replace — older keyset pages already on screen survive.
      setMessages((prev) => mergeRows(prev, incoming))
      if (json.replyMeta) setReplyMeta((prev) => ({ ...prev, ...json.replyMeta }))
    } catch {}
  }, [listUrl, mergeRows])

  // ── Reactions (item 4): optimistic, user-client RLS write, bus reconcile ──
  const applyReaction = useCallback(
    (messageId: string, userId: string, emoji: string, op: 'add' | 'remove') => {
      const patch = (m: Message): Message => {
        if (m.id !== messageId) return m
        const cur = m.reactions ?? []
        const without = cur.filter((r) => !(r.user_id === userId && r.emoji === emoji))
        return {
          ...m,
          reactions: op === 'add' ? [...without, { user_id: userId, emoji }] : without,
        }
      }
      setMessages((prev) => prev.map(patch))
      setThreadReplies((prev) => prev.map(patch))
      setThreadRoot((prev) => (prev ? patch(prev) : prev))
    },
    []
  )


  // ── One incoming path for broadcast AND replication ──────────────────────
  const handleIncomingRow = useCallback(
    (row: Message) => {
      if (row.sender_id === ownIdRef.current) return
      if (!matchesFilter(filter, row.project_id ?? null)) return
      if (seenIdsRef.current.has(row.id)) return
      seenIdsRef.current.add(row.id)
      playMessageChime()
      if (row.thread_root_id) {
        // A thread reply: never the main list (item 3). Into the open panel
        // if it matches, and onto the root's affordance either way.
        if (threadRootRef.current === row.thread_root_id) {
          setThreadReplies((prev) =>
            prev.some((m) => m.id === row.id) ? prev : [...prev, row]
          )
        }
        setReplyMeta((prev) => {
          const cur = prev[row.thread_root_id as string]
          return {
            ...prev,
            [row.thread_root_id as string]: {
              count: (cur?.count ?? 0) + 1,
              lastAt: row.created_at,
            },
          }
        })
        return
      }
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

  // Row UPDATES (read/delivered ticks, edits, deletes) patch in place —
  // including YOUR OWN messages, whose ticks are the whole point (Batch 18:
  // the receipts died when the project pages' UPDATE listeners were
  // consolidated away without a replacement).
  const patchRow = useCallback((row: Message) => {
    const patch = (m: Message): Message => (m.id === row.id ? { ...m, ...row } : m)
    setMessages((prev) => prev.map(patch))
    setThreadReplies((prev) => prev.map(patch))
    setThreadRoot((prev) => (prev && prev.id === row.id ? { ...prev, ...row } : prev))
  }, [])

  // Hub-forwarded replication rows (one subscription in the hub, not two).
  const lastExternalN = useRef(0)
  useEffect(() => {
    if (!externalRow || externalRow.n === lastExternalN.current) return
    lastExternalN.current = externalRow.n
    if (externalRow.op === 'update') patchRow(externalRow.row)
    else handleIncomingRow(externalRow.row)
  }, [externalRow, handleIncomingRow, patchRow])

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
        const kind = p.payload?.kind === 'recording' ? 'recording' : 'typing'
        onTypingChange?.(kind)
        if (typingClearRef.current) clearTimeout(typingClearRef.current)
        typingClearRef.current = setTimeout(() => onTypingChange?.(null), 3000)
      })
      .on('broadcast', { event: 'reaction' }, (p) => {
        const pl = p.payload as { messageId?: string; userId?: string; emoji?: string; op?: 'add' | 'remove' }
        if (!pl?.messageId || !pl.userId || !pl.emoji || !pl.op) return
        if (pl.userId === ownIdRef.current) return
        applyReaction(pl.messageId, pl.userId, pl.emoji, pl.op)
      })
      .on('broadcast', { event: 'sync' }, () => void refetch())
      .subscribe()
    channelRef.current = ch
    return () => {
      channelRef.current = null
      supabase.removeChannel(ch)
    }
  }, [threadKey, role, applyReaction]) // eslint-disable-line react-hooks/exhaustive-deps

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
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
          (p) => patchRow(p.new as Message)
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
  }, [selfFallback, threadKey, patchRow]) // eslint-disable-line react-hooks/exhaustive-deps

  const openThread = useCallback(
    async (root: Message) => {
      setThreadRoot(root)
      setThreadReplies([])
      try {
        const res = await fetch(`${listUrl()}&thread_root=${root.id}`)
        const json = await res.json()
        if (res.ok && json.messages) {
          for (const r of json.messages as Message[]) seenIdsRef.current.add(r.id)
          setThreadReplies(json.messages as Message[])
        }
      } catch {}
    },
    [listUrl]
  )

  const toggleReaction = useCallback(
    async (msg: Message, emoji: string) => {
      const me = ownIdRef.current
      if (!me || msg.id.startsWith('temp-')) return
      const mine = (msg.reactions ?? []).some((r) => r.user_id === me && r.emoji === emoji)
      applyReaction(msg.id, me, emoji, mine ? 'remove' : 'add')
      channelRef.current?.send({
        type: 'broadcast',
        event: 'reaction',
        payload: { messageId: msg.id, userId: me, emoji, op: mine ? 'remove' : 'add' },
      })
      const db = createClient()
      if (mine) {
        await db.from('message_reactions').delete().match({ message_id: msg.id, user_id: me, emoji })
      } else {
        await db.from('message_reactions').insert({ message_id: msg.id, user_id: me, emoji })
      }
    },
    [applyReaction]
  )

  // ── Pins: room furniture; anyone in the room sees them ───────────────────
  const togglePin = useCallback(async (msg: Message) => {
    const me = ownIdRef.current
    const roomId = roomIdRef.current
    if (!me || !roomId || msg.id.startsWith('temp-')) return
    const pinned = pinnedIds.has(msg.id)
    setPinnedIds((prev) => {
      const next = new Set(prev)
      if (pinned) next.delete(msg.id)
      else next.add(msg.id)
      return next
    })
    const db = createClient()
    if (pinned) {
      await db.from('message_pins').delete().match({ room_id: roomId, message_id: msg.id })
    } else {
      await db.from('message_pins').insert({ room_id: roomId, message_id: msg.id, pinned_by: me })
    }
  }, [pinnedIds])

  // ── Saves: private per user ───────────────────────────────────────────────
  const toggleSave = useCallback(async (msg: Message) => {
    const me = ownIdRef.current
    if (!me || msg.id.startsWith('temp-')) return
    const saved = savedIds.has(msg.id)
    setSavedIds((prev) => {
      const next = new Set(prev)
      if (saved) next.delete(msg.id)
      else next.add(msg.id)
      return next
    })
    const db = createClient()
    if (saved) {
      await db.from('message_saves').delete().match({ user_id: me, message_id: msg.id })
    } else {
      await db.from('message_saves').insert({ user_id: me, message_id: msg.id })
    }
  }, [savedIds])

  const openPanel = useCallback(
    async (which: 'pins' | 'saves' | 'settings' | 'people' | 'search') => {
      setMenuOpen(false)
      setPanel(which)
      setPanelRows([])
      if (which === 'search') {
        setSearchQ('')
        return
      }
      if (which === 'settings') {
        const me = ownIdRef.current
        const roomId = roomIdRef.current
        if (me && roomId) {
          // The USER client under Class C RLS — this row is yours alone.
          const { data } = await createClient()
            .from('message_room_prefs')
            .select('level')
            .eq('room_id', roomId)
            .eq('user_id', me)
            .maybeSingle()
          setRoomLevel((data?.level as 'all' | 'mentions' | 'muted') ?? 'all')
        }
        return
      }
      if (which === 'people') {
        // EXISTING roster operations surfaced in place (item 6b) — no new
        // permission logic; the canonical managers stay the write surface.
        try {
          if (role === 'client') {
            const res = await fetch('/api/portal/team')
            const json = await res.json()
            setPeople(
              (json.members ?? []).map((m: { name: string; role: string }) => ({
                name: m.name,
                role: m.role,
                side: 'client' as const,
              }))
            )
          } else {
            const [ct, crew] = await Promise.all([
              fetch(`/api/admin/client-team?clientId=${clientId}`).then((r) => r.json()),
              fetch('/api/admin/team').then((r) => r.json()),
            ])
            setPeople([
              ...((ct.members ?? []) as { name: string; role: string }[]).map((m) => ({
                name: m.name, role: m.role, side: 'client' as const,
              })),
              ...((crew.members ?? []) as { name: string; role: string }[]).map((m) => ({
                name: m.name, role: m.role, side: 'crew' as const,
              })),
            ])
          }
        } catch {}
        return
      }
      if (which === 'pins') {
        try {
          const res = await fetch(`${listUrl()}&pins=full`)
          const json = await res.json()
          if (res.ok && json.messages) setPanelRows(json.messages as Message[])
        } catch {}
      } else {
        const me = ownIdRef.current
        if (!me) return
        const { data } = await createClient()
          .from('message_saves')
          .select('saved_at, messages(*, message_attachments(file_id))')
          .eq('user_id', me)
          .order('saved_at', { ascending: false })
          .limit(100)
        const rows = (data ?? [])
          .map((r) => (Array.isArray(r.messages) ? r.messages[0] : r.messages))
          .filter((m): m is NonNullable<typeof m> => m != null) as unknown as Message[]
        setPanelRows(rows)
      }
    },
    [listUrl]
  )

  const lastPanelCmd = useRef(0)
  useEffect(() => {
    if (!panelCommand || panelCommand.n === lastPanelCmd.current) return
    lastPanelCmd.current = panelCommand.n
    void openPanel(panelCommand.which)
  }, [panelCommand, openPanel])

  const runSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setPanelRows([])
      return
    }
    setSearching(true)
    try {
      const res = await fetch(`${listUrl()}&q=${encodeURIComponent(query.trim())}`)
      const json = await res.json()
      setPanelRows(res.ok && json.messages ? (json.messages as Message[]) : [])
    } catch {
      setPanelRows([])
    } finally {
      setSearching(false)
    }
  }, [listUrl])

  const setLevel = useCallback(async (level: 'all' | 'mentions' | 'muted') => {
    const me = ownIdRef.current
    const roomId = roomIdRef.current
    if (!me || !roomId) return
    setRoomLevel(level)
    await createClient()
      .from('message_room_prefs')
      .upsert({ room_id: roomId, user_id: me, level }, { onConflict: 'room_id,user_id' })
  }, [])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Jump-to-message: a window around the target (item 2's `around`).
  const jumpTo = useCallback(
    async (id: string) => {
      setPanel(null)
      try {
        const res = await fetch(`${listUrl()}&around=${id}`)
        const json = await res.json()
        if (res.ok && json.messages) {
          const rows = json.messages as Message[]
          for (const r of rows) seenIdsRef.current.add(r.id)
          setMessages(rows)
          setPageCursor(json.nextCursor ?? null)
          setHasMore(!!json.nextCursor)
          setHighlightId(id)
          setTimeout(() => setHighlightId(null), 2500)
        }
      } catch {}
    },
    [listUrl]
  )

  // ── Typing / recording (throttled, over the bus) ─────────────────────────
  // Clients also announce composer activity on the org's badge topic, so the
  // STUDIO ROOM LIST shows "typing…" for rooms that aren't open (Batch 16).
  const orgActivityRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  useEffect(() => {
    if (role !== 'client' || !orgId) return
    const ch = supabase.channel(`badges:org:${orgId}`).subscribe()
    orgActivityRef.current = ch
    return () => {
      orgActivityRef.current = null
      supabase.removeChannel(ch)
    }
  }, [role, orgId, supabase])

  const recordingRef = useRef(false)
  const sendActivity = useCallback(
    (kind: 'typing' | 'recording') => {
      channelRef.current?.send({
        type: 'broadcast',
        event: 'typing',
        payload: { role, kind },
      })
      orgActivityRef.current?.send({
        type: 'broadcast',
        event: 'activity',
        payload: { clientId, kind },
      })
    },
    [role, clientId]
  )

  const handleTyping = useCallback(() => {
    if (typingSendRef.current || recordingRef.current) return
    sendActivity('typing')
    typingSendRef.current = setTimeout(() => {
      typingSendRef.current = null
    }, 2000)
  }, [sendActivity])

  // Recording pings repeat while the mic is live so the indicator survives
  // the 3s decay on the other side.
  const recordingPingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const handleRecordingChange = useCallback(
    (recording: boolean) => {
      recordingRef.current = recording
      if (recordingPingRef.current) {
        clearInterval(recordingPingRef.current)
        recordingPingRef.current = null
      }
      if (recording) {
        sendActivity('recording')
        recordingPingRef.current = setInterval(() => sendActivity('recording'), 2500)
      }
    },
    [sendActivity]
  )
  useEffect(() => () => {
    if (recordingPingRef.current) clearInterval(recordingPingRef.current)
  }, [])

  // ── Badge bus: tell the OTHER side's rail instantly ──────────────────────
  const pingBadges = useCallback(() => {
    if (role === 'client') {
      // The persistent org channel doubles as the badge pipe.
      orgActivityRef.current?.send({ type: 'broadcast', event: 'badge', payload: {} })
      return
    }
    const topics = [`badges:client:${clientId}`, ...(orgId ? [`badges:org:${orgId}`] : [])]
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

  // Forward: re-send body + attachment into another destination. Within the
  // room a destination is a project tag; the studio can also cross rooms.
  const doForward = useCallback(
    async (msgs: Message[], dest: { kind: 'project'; projectId: string } | { kind: 'general' } | { kind: 'room'; clientId: string }) => {
      setForwardFor(null)
      setSelectionMode(false)
      setSelectedIds(new Set())
      for (const m of msgs) {
        try {
          await fetch(role === 'admin' ? '/api/admin/project-actions' : '/api/portal/actions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'send_message',
              ...(dest.kind === 'project'
                ? { project_id: dest.projectId }
                : dest.kind === 'room'
                  ? { client_id: dest.clientId }
                  : role === 'admin'
                    ? { client_id: clientId }
                    : {}),
              body: m.body ?? '',
              attachment_url: m.attachment_url ?? null,
              attachment_name: m.attachment_name ?? null,
              attachment_file_id: m.attachment_file_id ?? null,
            }),
          })
        } catch { /* per-message best effort */ }
      }
      void refetch()
      pingBadges()
    },
    [role, clientId, refetch, pingBadges]
  )


  // ── Send ─────────────────────────────────────────────────────────────────
  async function sendMessage(
    body: string,
    replyToId?: string,
    attachmentUrl?: string,
    attachmentName?: string,
    attachmentFileId?: string,
    threadRootId?: string
  ) {
    const optimistic: Message = {
      id: `temp-${Date.now()}`,
      room_id: null,
      thread_root_id: null,
      deleted_at: null,
      project_id: effectiveTag as unknown as string,
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
    if (threadRootId) setThreadReplies((prev) => [...prev, optimistic])
    else setMessages((prev) => [...prev, optimistic])

    let inserted: Message | null = null
    try {
      const res = await fetch(
        role === 'admin' ? '/api/admin/project-actions' : '/api/portal/actions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'send_message',
            ...(effectiveTag
              ? { project_id: effectiveTag }
              : role === 'admin'
                ? { client_id: clientId }
                : {}),
            body,
            reply_to_id: replyToId || null,
            attachment_url: attachmentUrl || null,
            attachment_name: attachmentName || null,
            attachment_file_id: attachmentFileId || null,
            thread_root_id: threadRootId || null,
          }),
        }
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Send failed')
      inserted = json.message ?? null
    } catch (err) {
      if (threadRootId) setThreadReplies((prev) => prev.filter((m) => m.id !== optimistic.id))
      else setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
      setSendError(err instanceof Error ? err.message : 'Failed to send message.')
      setTimeout(() => setSendError(null), 6000)
      throw err
    }

    if (inserted) {
      seenIdsRef.current.add(inserted.id)
      const reconcile = (prev: Message[]) => {
        if (prev.some((m) => m.id === inserted!.id)) {
          return prev.filter((m) => m.id !== optimistic.id)
        }
        return prev.map((m) => (m.id === optimistic.id ? inserted! : m))
      }
      if (threadRootId) {
        setThreadReplies(reconcile)
        setReplyMeta((prev) => {
          const cur = prev[threadRootId]
          return {
            ...prev,
            [threadRootId]: { count: (cur?.count ?? 0) + 1, lastAt: inserted!.created_at },
          }
        })
      } else setMessages(reconcile)
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

  // ── Instant voice send (Batch 17): optimistic bubble on a blob URL, the
  //    upload + send ride behind it, reconciled or rolled back with a reason.
  async function sendVoice(file: File) {
    const blobUrl = URL.createObjectURL(file)
    const optimistic: Message = {
      id: `temp-${Date.now()}`,
      room_id: null,
      thread_root_id: null,
      deleted_at: null,
      project_id: effectiveTag as unknown as string,
      sender_id: ownIdRef.current ?? '',
      sender_role: role,
      sender_name: currentName,
      body: '',
      read_at: null,
      delivered_at: null,
      reply_to_id: null,
      attachment_url: blobUrl,
      attachment_name: file.name,
      is_deleted: false,
      edited_at: null,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimistic])
    try {
      const uploaded = await handleAttachmentUpload(file)
      const res = await fetch(
        role === 'admin' ? '/api/admin/project-actions' : '/api/portal/actions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'send_message',
            ...(effectiveTag
              ? { project_id: effectiveTag }
              : role === 'admin'
                ? { client_id: clientId }
                : {}),
            body: '',
            attachment_url: uploaded.url,
            attachment_name: uploaded.name,
            attachment_file_id: uploaded.fileId ?? null,
          }),
        }
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Send failed')
      const inserted: Message | null = json.message ?? null
      if (inserted) {
        seenIdsRef.current.add(inserted.id)
        setMessages((prev) =>
          prev.some((m) => m.id === inserted.id)
            ? prev.filter((m) => m.id !== optimistic.id)
            : prev.map((m) => (m.id === optimistic.id ? inserted : m))
        )
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
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
      setSendError(
        `Voice note failed: ${err instanceof Error ? err.message : 'unknown error'}`
      )
      setTimeout(() => setSendError(null), 8000)
    } finally {
      URL.revokeObjectURL(blobUrl)
    }
  }

  // ── Attachments (project scope, or the client's `_general` scope) ────────
  async function handleAttachmentUpload(file: File) {
    const uploaded = await uploadFileToR2({
      file,
      ...(effectiveTag ? { projectId: effectiveTag } : { clientId }),
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
      {(
        <>
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
            onRecordingChange={handleRecordingChange}
            onSendVoice={allowAttachments ? sendVoice : undefined}
            composerTag={effectiveTag ? { id: effectiveTag, ...projectMeta[effectiveTag] } : null}
            composerTagOptions={Object.entries(projectMeta).map(([id, m]) => ({ id, ...m }))}
            composerTagLocked={filter.kind === 'project'}
            onComposerTagChange={setSticky}
            wallpaper={{ pattern: wpPattern, alpha: INTENSITY_ALPHA[wpIntensity] }}
            onForward={(msgs) => setForwardFor(msgs)}
            selectionMode={selectionMode}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onLoadOlder={loadOlder}
            hasMore={hasMore}
            loadingOlder={loadingOlder}
            replyMeta={replyMeta}
            onOpenThread={openThread}
            ownUserId={ownIdRef.current}
            onToggleReaction={toggleReaction}
            onTogglePin={togglePin}
            onToggleSave={toggleSave}
            pinnedIds={pinnedIds}
            savedIds={savedIds}
            highlightId={highlightId}
            mentionTargets={mentionTargets}
            mentionCandidates={mentionCandidates}
            projectMeta={projectMeta}
          />
          {/* Bulk-selection action bar (Batch 18) */}
          {selectionMode && (
            <div
              className="absolute bottom-20 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-2 rounded-full shadow-2xl"
              style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--primary) / 0.4)' }}
            >
              <span className="text-xs font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
                {selectedIds.size} selected
              </span>
              <button
                disabled={selectedIds.size === 0}
                onClick={() => setForwardFor(messages.filter((m) => selectedIds.has(m.id)))}
                className="text-xs font-bold px-3 py-1 rounded-full disabled:opacity-40"
                style={{ backgroundColor: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
              >
                Forward
              </button>
              <button
                onClick={() => { setSelectionMode(false); setSelectedIds(new Set()) }}
                className="text-xs px-2 py-1"
                style={{ color: 'hsl(var(--muted-foreground))' }}
              >
                Cancel
              </button>
            </div>
          )}

          {/* Forward destination picker (Batch 18) */}
          {forwardFor && (
            <div
              className="absolute inset-0 z-40 flex items-center justify-center p-6"
              style={{ backgroundColor: 'hsl(var(--background) / 0.6)', backdropFilter: 'blur(4px)' }}
              onClick={() => setForwardFor(null)}
            >
              <div
                className="w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden"
                style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-4 py-3 border-b" style={{ borderColor: 'hsl(var(--border))' }}>
                  <p className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
                    Forward {forwardFor.length > 1 ? `${forwardFor.length} messages` : 'message'} to
                  </p>
                </div>
                <div className="max-h-72 overflow-y-auto scrollbar-thin p-2 space-y-1">
                  <button
                    onClick={() => void doForward(forwardFor, { kind: 'general' })}
                    className="w-full text-left px-3 py-2.5 rounded-xl text-sm hover:bg-[hsl(var(--primary)/0.08)]"
                    style={{ color: 'hsl(var(--foreground))' }}
                  >
                    This room · no project
                  </button>
                  {Object.entries(projectMeta).map(([id, m]) => (
                    <button
                      key={id}
                      onClick={() => void doForward(forwardFor, { kind: 'project', projectId: id })}
                      className="w-full flex items-center gap-2 text-left px-3 py-2.5 rounded-xl text-sm hover:bg-[hsl(var(--primary)/0.08)]"
                      style={{ color: 'hsl(var(--foreground))' }}
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: m.color }} />
                      {m.title}
                    </button>
                  ))}
                  {forwardRooms.filter((r) => r.id !== clientId).map((r) => (
                    <button
                      key={r.id}
                      onClick={() => void doForward(forwardFor, { kind: 'room', clientId: r.id })}
                      className="w-full text-left px-3 py-2.5 rounded-xl text-sm hover:bg-[hsl(var(--primary)/0.08)]"
                      style={{ color: 'hsl(var(--foreground))' }}
                    >
                      ↪ {r.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* The room menu — ONE control, extreme right (Batch 16) */}
          {showMenuButton && (
            <div className="absolute top-2 right-2 z-20">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="p-1.5 rounded-lg transition-colors"
                style={{
                  backgroundColor: menuOpen ? 'hsl(var(--primary) / 0.15)' : 'hsl(var(--card) / 0.8)',
                  border: '1px solid hsl(var(--border))',
                  color: menuOpen ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
                  backdropFilter: 'blur(8px)',
                }}
                title="Room menu"
              >
                <MoreVertical size={14} />
              </button>
              {menuOpen && (
                <div
                  className="absolute right-0 mt-1 w-52 rounded-xl overflow-hidden shadow-2xl z-30"
                  style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                >
                  <button
                    onClick={() => { setSelectionMode((v) => !v); setSelectedIds(new Set()); setMenuOpen(false) }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-left transition-colors hover:bg-[hsl(var(--primary)/0.08)]"
                    style={{ color: selectionMode ? 'hsl(var(--primary))' : 'hsl(var(--foreground))' }}
                  >
                    <Users size={14} style={{ color: 'hsl(var(--primary))', visibility: 'hidden' }} />
                    {selectionMode ? 'Cancel selection' : 'Select messages'}
                  </button>
                  {([
                    ['search', 'Search in conversation', SearchIcon],
                    ['pins', 'Pinned messages', Pin],
                    ['saves', 'Saved for you', Bookmark],
                    ['people', 'People in this room', Users],
                    ['settings', 'Chat settings & wallpaper', Settings2],
                  ] as const).map(([which, label, Icon]) => (
                    <button
                      key={which}
                      onClick={() => void openPanel(which)}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-left transition-colors hover:bg-[hsl(var(--primary)/0.08)]"
                      style={{ color: 'hsl(var(--foreground))' }}
                    >
                      <Icon size={14} style={{ color: 'hsl(var(--primary))' }} />
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {panel && (
            <div
              className="absolute inset-y-0 right-0 z-30 w-full md:w-[360px] flex flex-col border-l shadow-2xl"
              style={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}
            >
              <div
                className="flex items-center gap-2 px-4 h-[52px] flex-shrink-0 border-b"
                style={{ borderColor: 'hsl(var(--border))' }}
              >
                <p
                  className="text-xs font-semibold uppercase tracking-widest flex-1"
                  style={{ color: 'hsl(var(--text-faint))' }}
                >
                  {panel === 'pins' ? 'Pinned' : panel === 'saves' ? 'Saved for you' : panel === 'people' ? 'People' : panel === 'search' ? 'Search' : 'Chat settings'}
                </p>
                <button
                  onClick={() => setPanel(null)}
                  className="p-1.5 rounded-lg hover:bg-[hsl(var(--border))] text-sm"
                  style={{ color: 'hsl(var(--muted-foreground))' }}
                >
                  ✕
                </button>
              </div>
              <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-2">
                {panel === 'search' && (
                  <div className="space-y-2">
                    <input
                      autoFocus
                      type="text"
                      value={searchQ}
                      onChange={(e) => {
                        setSearchQ(e.target.value)
                        void runSearch(e.target.value)
                      }}
                      placeholder="Search this conversation"
                      className="w-full px-3 py-2.5 rounded-xl text-sm outline-none focus:border-[hsl(var(--primary))]"
                      style={{
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        color: 'hsl(var(--foreground))',
                      }}
                    />
                    {searching && (
                      <p className="text-xs text-center py-2" style={{ color: 'hsl(var(--text-faint))' }}>
                        Searching…
                      </p>
                    )}
                    {!searching && searchQ.trim() && panelRows.length === 0 && (
                      <p className="text-xs text-center py-6" style={{ color: 'hsl(var(--text-faint))' }}>
                        No messages match “{searchQ.trim()}”.
                      </p>
                    )}
                  </div>
                )}
                {panel === 'settings' && (
                  <div className="space-y-4 p-1">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'hsl(var(--text-faint))' }}>
                        This room notifies you about
                      </p>
                      {([
                        ['all', 'Everything', 'Every new message'],
                        ['mentions', 'Mentions only', 'Only when someone @mentions you'],
                        ['muted', 'Nothing', 'No pushes, no chime — the badge still counts'],
                      ] as const).map(([value, label, sub]) => (
                        <button
                          key={value}
                          onClick={() => void setLevel(value)}
                          className="w-full text-left px-3 py-2.5 rounded-xl mb-1.5 border transition-colors"
                          style={{
                            backgroundColor: roomLevel === value ? 'hsl(var(--primary) / 0.08)' : 'hsl(var(--background))',
                            borderColor: roomLevel === value ? 'hsl(var(--primary) / 0.5)' : 'hsl(var(--border))',
                          }}
                        >
                          <p className="text-sm font-medium" style={{ color: roomLevel === value ? 'hsl(var(--primary))' : 'hsl(var(--foreground))' }}>
                            {label}
                          </p>
                          <p className="text-[11px] mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>{sub}</p>
                        </button>
                      ))}
                    </div>
                    <div className="pt-2 border-t space-y-2" style={{ borderColor: 'hsl(var(--border))' }}>
                      <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'hsl(var(--text-faint))' }}>
                        This device
                      </p>
                      <button
                        onClick={() => {
                          const next = !soundOn
                          setSoundOn(next)
                          setMessageSoundEnabled(next)
                          if (next) playTestChime()
                        }}
                        className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl border"
                        style={{ backgroundColor: 'hsl(var(--background))', borderColor: 'hsl(var(--border))' }}
                      >
                        <span className="text-sm" style={{ color: 'hsl(var(--foreground))' }}>Message sound</span>
                        <span className="text-xs font-semibold" style={{ color: soundOn ? 'hsl(var(--primary))' : 'hsl(var(--text-faint))' }}>
                          {soundOn ? 'On' : 'Off'}
                        </span>
                      </button>
                      <div
                        className="w-full px-3 py-2.5 rounded-xl border"
                        style={{ backgroundColor: 'hsl(var(--background))', borderColor: 'hsl(var(--border))' }}
                      >
                        <p className="text-sm mb-2" style={{ color: 'hsl(var(--foreground))' }}>Mention trigger</p>
                        <div className="flex gap-1.5">
                          {([
                            ['at', '@ only'],
                            ['slash', '/ only'],
                            ['both', '@ and /'],
                          ] as const).map(([value, label]) => (
                            <button
                              key={value}
                              onClick={() => { setTrigger(value); setMentionTrigger(value) }}
                              className="flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors"
                              style={{
                                backgroundColor: trigger === value ? 'hsl(var(--primary))' : 'hsl(var(--card))',
                                color: trigger === value ? 'hsl(var(--primary-foreground))' : 'hsl(var(--foreground))',
                                border: '1px solid ' + (trigger === value ? 'hsl(var(--primary))' : 'hsl(var(--border))'),
                              }}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div
                        className="w-full px-3 py-2.5 rounded-xl border"
                        style={{ backgroundColor: 'hsl(var(--background))', borderColor: 'hsl(var(--border))' }}
                      >
                        <p className="text-sm mb-2" style={{ color: 'hsl(var(--foreground))' }}>Wallpaper</p>
                        <div className="grid grid-cols-3 gap-1.5 mb-2">
                          {([
                            ['film', 'Film'],
                            ['aurora', 'Aurora'],
                            ['waves', 'Waves'],
                            ['dots', 'Dots'],
                            ['grid', 'Grid'],
                            ['none', 'None'],
                          ] as const).map(([value, label]) => (
                            <button
                              key={value}
                              onClick={() => { setWpPattern(value); setWallpaperPattern(value) }}
                              className="px-2 py-1.5 rounded-lg text-xs font-medium transition-colors"
                              style={{
                                backgroundColor: wpPattern === value ? 'hsl(var(--primary))' : 'hsl(var(--card))',
                                color: wpPattern === value ? 'hsl(var(--primary-foreground))' : 'hsl(var(--foreground))',
                                border: '1px solid ' + (wpPattern === value ? 'hsl(var(--primary))' : 'hsl(var(--border))'),
                              }}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-1.5">
                          {([
                            ['faint', 'Faint'],
                            ['medium', 'Medium'],
                            ['bold', 'Bold'],
                          ] as const).map(([value, label]) => (
                            <button
                              key={value}
                              disabled={wpPattern === 'none'}
                              onClick={() => { setWpIntensity(value); setWallpaperIntensity(value) }}
                              className="flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
                              style={{
                                backgroundColor: wpIntensity === value ? 'hsl(var(--primary) / 0.15)' : 'hsl(var(--card))',
                                color: wpIntensity === value ? 'hsl(var(--primary))' : 'hsl(var(--foreground))',
                                border: '1px solid ' + (wpIntensity === value ? 'hsl(var(--primary) / 0.5)' : 'hsl(var(--border))'),
                              }}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          const next = !focusOn
                          setFocusOn(next)
                          setFocusModeEnabled(next)
                        }}
                        className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl border"
                        style={{ backgroundColor: 'hsl(var(--background))', borderColor: 'hsl(var(--border))' }}
                      >
                        <span className="text-left">
                          <span className="text-sm block" style={{ color: 'hsl(var(--foreground))' }}>Focus mode</span>
                          <span className="text-[11px]" style={{ color: 'hsl(var(--muted-foreground))' }}>
                            Silence the chime everywhere on this device
                          </span>
                        </span>
                        <span className="text-xs font-semibold" style={{ color: focusOn ? 'hsl(var(--primary))' : 'hsl(var(--text-faint))' }}>
                          {focusOn ? 'On' : 'Off'}
                        </span>
                      </button>
                    </div>
                  </div>
                )}
                {panel === 'people' && (
                  <div className="space-y-1.5 p-1">
                    {people.length === 0 && (
                      <p className="text-xs text-center py-8" style={{ color: 'hsl(var(--text-faint))' }}>
                        Loading the roster…
                      </p>
                    )}
                    {people.map((p, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl border"
                        style={{ backgroundColor: 'hsl(var(--background))', borderColor: 'hsl(var(--border))' }}
                      >
                        <span
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                          style={{
                            backgroundColor: p.side === 'crew' ? 'hsl(var(--primary) / 0.12)' : 'hsl(var(--border))',
                            color: p.side === 'crew' ? 'hsl(var(--primary))' : 'hsl(var(--foreground))',
                          }}
                        >
                          {p.name.charAt(0).toUpperCase()}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate" style={{ color: 'hsl(var(--foreground))' }}>{p.name}</p>
                          <p className="text-[10px] uppercase tracking-wide" style={{ color: 'hsl(var(--text-faint))' }}>
                            {p.side === 'crew' ? 'Studio' : 'Company'} · {p.role}
                          </p>
                        </div>
                      </div>
                    ))}
                    <a
                      href={role === 'client' ? '/team' : `/studio/client/companies/${clientId}`}
                      className="block text-center text-xs font-semibold py-2.5 rounded-xl border mt-2 transition-colors hover:border-[hsl(var(--primary))]"
                      style={{ color: 'hsl(var(--primary))', borderColor: 'hsl(var(--border))' }}
                    >
                      Manage team →
                    </a>
                  </div>
                )}
                {(panel === 'pins' || panel === 'saves') && panelRows.length === 0 && (
                  <p className="text-xs text-center py-8" style={{ color: 'hsl(var(--text-faint))' }}>
                    {panel === 'pins'
                      ? 'Nothing pinned yet. Pin a message from its hover menu.'
                      : 'Nothing saved yet. Save a message from its hover menu — only you see this list.'}
                  </p>
                )}
                {(panel === 'pins' || panel === 'saves' || panel === 'search') && panelRows.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => void jumpTo(m.id)}
                    className="w-full text-left p-3 rounded-xl border transition-colors hover:border-[hsl(var(--primary))]"
                    style={{ backgroundColor: 'hsl(var(--background))', borderColor: 'hsl(var(--border))' }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-semibold truncate" style={{ color: 'hsl(var(--primary))' }}>
                        {m.sender_name}
                      </p>
                      <span className="text-[10px] flex-shrink-0" style={{ color: 'hsl(var(--text-faint))' }}>
                        {new Date(m.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                    <p className="text-xs mt-1 line-clamp-2" style={{ color: 'hsl(var(--foreground))' }}>
                      {m.body || (m.attachment_name ? `📎 ${m.attachment_name}` : '…')}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}
          {threadRoot && (
            <div
              className="absolute inset-y-0 right-0 z-30 w-full md:w-[400px] flex flex-col border-l shadow-2xl"
              style={{
                backgroundColor: 'hsl(var(--card))',
                borderColor: 'hsl(var(--border))',
              }}
            >
              <div
                className="flex items-center gap-2 px-4 h-[52px] flex-shrink-0 border-b"
                style={{ borderColor: 'hsl(var(--border))' }}
              >
                <p
                  className="text-xs font-semibold uppercase tracking-widest flex-1"
                  style={{ color: 'hsl(var(--text-faint))' }}
                >
                  Thread
                </p>
                <button
                  onClick={() => { setThreadRoot(null); setThreadReplies([]) }}
                  className="p-1.5 rounded-lg hover:bg-[hsl(var(--border))] text-sm"
                  style={{ color: 'hsl(var(--muted-foreground))' }}
                  title="Close thread"
                >
                  ✕
                </button>
              </div>
              <div className="flex-1 min-h-0">
                <MessageThread
                  messages={[threadRoot, ...threadReplies]}
                  currentRole={role}
                  currentName={currentName}
                  otherName={otherName}
                  projectId={`${threadKey}:thread`}
                  onSendMessage={(b, r, u, n, f) => sendMessage(b, r, u, n, f, threadRoot.id)}
                  readOnly={!canSend}
                  onUploadAttachment={allowAttachments ? handleAttachmentUpload : undefined}
                  onDeleteMessage={handleDeleteMessage}
                  onEditMessage={handleEditMessage}
                  onTyping={handleTyping}
                  onRecordingChange={handleRecordingChange}
                  onSendVoice={allowAttachments ? sendVoice : undefined}
                  wallpaper={{ pattern: wpPattern, alpha: INTENSITY_ALPHA[wpIntensity] }}
                  mentionTargets={mentionTargets}
                  mentionCandidates={mentionCandidates}
                  projectMeta={projectMeta}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
