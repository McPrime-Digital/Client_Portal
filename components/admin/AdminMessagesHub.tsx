'use client'

/**
 * The studio Messages hub — Batch 15 item 1. Room-first: one row per client
 * COMPANY, not per project. Selecting a room opens the same RoomThread
 * engine the portal and the project pages use, with filter chips for that
 * company's projects.
 *
 * List movement rules (the founder's spec, verbatim): a NEW incoming message
 * or a NEW sent message moves the room up; opening a room with no new
 * activity does NOT move it. Enforced by comparing latest-message ids —
 * never by "something happened".
 */

import { prefetchThreads, cacheKeyFor, filterKeyFor, threadListUrl } from '@/lib/threadCache'
import { useDismissOnOutside } from '@/lib/hooks/useDismissOnOutside'
import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Volume2, VolumeX, MessageSquare, ChevronLeft, MoreVertical } from 'lucide-react'
import RoomThread, { type RoomFilter, type ExternalRow } from '@/components/shared/RoomThread'
import type { Message } from '@/lib/types/database'
import { messagePreview } from '@/lib/messagePreview'
import { projectColor } from '@/lib/projectColor'
import {
  playMessageChime,
  messageSoundEnabled,
  setMessageSoundEnabled,
  playTestChime,
  primeAudio,
} from '@/lib/soundClient'
import { usePresenceStore, isClientOnline, presenceWhere } from '@/lib/stores/presence-store'
import { acquireHub, releaseHub } from '@/lib/realtimeBus'

export type HubRoom = {
  clientId: string
  roomId: string
  name: string
  company: string | null
  avatarUrl: string | null
  latest: Message | null
  unread: number
  generalUnread: number
  projects: { id: string; title: string; unread: number }[]
}

type Props = {
  orgId: string
  adminName: string
  rooms: HubRoom[]
}

function timeAgo(date: string) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 604800) return `${Math.floor(s / 86400)}d`
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function AdminMessagesHub({ orgId, adminName, rooms: initialRooms }: Props) {
  const supabase = createClient()
  const [rooms, setRooms] = useState(initialRooms)
  // Seeded from the ROOM LIST rather than set by an effect: the studio should
  // land in the busiest room on the first paint, not on a second render after
  // one. This was `useState(null)` plus an effect that immediately called
  // setState — a cascading render, and the react-hooks rule was right about
  // it (it only surfaced once an unrelated effect stopped the analyser
  // bailing out of this file).
  const [activeClientId, setActiveClientId] = useState<string | null>(
    () => initialRooms[0]?.clientId ?? null
  )
  const [filter, setFilter] = useState<RoomFilter>({ kind: 'all' })
  const [externalRow, setExternalRow] = useState<ExternalRow | null>(null)
  const [clientActivity, setClientActivity] = useState<'typing' | 'recording' | null>(null)
  // Per-room composer activity for the LIST (clients announce on the org
  // badge topic; 3s decay per room).
  const [activityByClient, setActivityByClient] = useState<Record<string, 'typing' | 'recording'>>({})
  const activityTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const [soundOn, setSoundOn] = useState(() => messageSoundEnabled())
  const [roomMenuOpen, setRoomMenuOpen] = useState(false)
  // Tap anywhere else, or Escape, closes it (shared hook — the same behaviour
  // both portals get, from one implementation).
  useDismissOnOutside(roomMenuOpen, useCallback(() => setRoomMenuOpen(false), []))
  const [panelCommand, setPanelCommand] = useState<{ which: 'pins' | 'saves' | 'settings' | 'people' | 'search'; n: number } | null>(null)
  const [mobileView, setMobileView] = useState<'list' | 'thread'>('list')

  const online = usePresenceStore((s) => s.online)
  const ownIdRef = useRef<string | null>(null)
  const activeRef = useRef<{ clientId: string | null; filter: RoomFilter }>({
    clientId: null,
    filter,
  })
  useEffect(() => {
    activeRef.current = { clientId: activeClientId, filter }
  }, [activeClientId, filter])

  const active = rooms.find((r) => r.clientId === activeClientId) ?? null
  /** Where the client side is right now — "in All", "in AMP", or "Online"
   *  when they are signed in but not in this room (item 3). */
  const whereClient = presenceWhere(
    online, 'client', active?.clientId,
    (pid) => active?.projects.find((p) => p.id === pid)?.title
  )

  useEffect(() => {
    primeAudio()
    createClient().auth.getUser().then(({ data }) => {
      ownIdRef.current = data.user?.id ?? null
    })
    acquireHub()
    return () => releaseHub()
  }, [])

  // ── Movement: ONLY on a genuinely new latest message ─────────────────────
  const applyActivity = useCallback(
    (clientId: string, latest: Message, opts: { bumpUnread: boolean }) => {
      setRooms((prev) => {
        const idx = prev.findIndex((r) => r.clientId === clientId)
        if (idx === -1) return prev
        const room = prev[idx]
        if (room.latest?.id === latest.id) return prev // not new — do not move
        const updated: HubRoom = {
          ...room,
          latest,
          unread: opts.bumpUnread ? room.unread + 1 : room.unread,
          generalUnread:
            opts.bumpUnread && latest.project_id == null
              ? room.generalUnread + 1
              : room.generalUnread,
          projects: opts.bumpUnread
            ? room.projects.map((p) =>
                p.id === latest.project_id ? { ...p, unread: p.unread + 1 } : p
              )
            : room.projects,
        }
        return [updated, ...prev.filter((r) => r.clientId !== clientId)]
      })
    },
    []
  )

  // ── ONE replication fallback for the whole org ───────────────────────────
  const roomToClient = useRef(new Map(initialRooms.map((r) => [r.roomId, r.clientId])))
  useEffect(() => {
    roomToClient.current = new Map(rooms.map((r) => [r.roomId, r.clientId]))
  }, [rooms])

  // WARM THE ROOMS BEFORE THEY ARE TAPPED (item 7). The studio side lists
  // client COMPANIES, so the All view of each is what a first tap opens —
  // those get warmed first, then the ACTIVE company's project chips. Capped in
  // threadCache: a studio with forty companies must not fire forty requests on
  // hub load, and past a dozen the user's own tap beats the stampede anyway.
  useEffect(() => {
    const jobs = [
      ...rooms.map((r) => ({ clientId: r.clientId, f: { kind: 'all' as const } })),
      ...(active?.projects ?? []).map((p) => ({
        clientId: active!.clientId,
        f: { kind: 'project' as const, projectId: p.id },
      })),
    ]
    prefetchThreads(jobs.map(({ clientId, f }) => ({
      key: cacheKeyFor('admin', clientId, filterKeyFor(f)),
      url: threadListUrl('admin', clientId, f),
    })))
  }, [rooms, active])

  useEffect(() => {
    const ch = supabase
      .channel(`hub-fallback:${orgId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `organization_id=eq.${orgId}` },
        (p) => {
          const row = p.new as Message
          const clientId = row.room_id ? roomToClient.current.get(row.room_id) : null
          if (!clientId || activeRef.current.clientId !== clientId) return
          setExternalRow({ row, n: Date.now(), op: 'update' })
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `organization_id=eq.${orgId}` },
        (p) => {
          const row = p.new as Message
          if (row.sender_id === ownIdRef.current) return
          const clientId = row.room_id ? roomToClient.current.get(row.room_id) : null
          if (!clientId) return
          const a = activeRef.current
          const isActiveRoom = a.clientId === clientId
          const inActiveView =
            isActiveRoom &&
            (a.filter.kind === 'all' ||
              (a.filter.kind === 'general' && row.project_id == null) ||
              (a.filter.kind === 'project' &&
                (row.project_id == null || row.project_id === a.filter.projectId)))
          if (isActiveRoom) setExternalRow({ row, n: Date.now(), op: 'insert' })
          if (!inActiveView) playMessageChime()
          applyActivity(clientId, row, { bumpUnread: !inActiveView })
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [orgId, supabase, applyActivity])

  // The org badge topic carries client composer activity (Batch 16): the
  // list shows "typing…" / "recording audio…" for rooms that are not open.
  useEffect(() => {
    const ch = supabase
      .channel(`badges:org:${orgId}`)
      .on('broadcast', { event: 'activity' }, (p) => {
        const pl = p.payload as { clientId?: string; kind?: 'typing' | 'recording' }
        if (!pl?.clientId || !pl.kind) return
        const cid = pl.clientId
        const kind = pl.kind
        setActivityByClient((prev) => ({ ...prev, [cid]: kind }))
        if (activityTimers.current[cid]) clearTimeout(activityTimers.current[cid])
        activityTimers.current[cid] = setTimeout(() => {
          setActivityByClient((prev) => {
            const next = { ...prev }
            delete next[cid]
            return next
          })
        }, 3000)
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [orgId, supabase])

  const selectRoom = useCallback((clientId: string) => {
    setActiveClientId(clientId)
    setFilter({ kind: 'all' })
    setMobileView('thread')
    setClientActivity(null)
    // Opening clears the badge — the watermark PATCH inside RoomThread is the
    // durable half. The row does NOT move: opening is not activity.
    setRooms((prev) =>
      prev.map((r) =>
        r.clientId === clientId
          ? {
              ...r,
              unread: 0,
              generalUnread: 0,
              projects: r.projects.map((p) => ({ ...p, unread: 0 })),
            }
          : r
      )
    )
  }, [])

  const onActivity = useCallback(
    (latest: Message, direction: 'incoming' | 'sent') => {
      const a = activeRef.current
      if (!a.clientId) return
      void direction
      applyActivity(a.clientId, latest, { bumpUnread: false })
    },
    [applyActivity]
  )

  const totalUnread = rooms.reduce((acc, r) => acc + r.unread, 0)

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col w-full min-h-0">
      <div className="mb-4 flex-shrink-0 flex items-center gap-3">
        <h1 className="font-display text-2xl font-bold" style={{ color: 'hsl(var(--foreground))' }}>
          Messages
        </h1>
        {totalUnread > 0 && (
          <span
            className="text-xs font-bold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: 'hsl(var(--primary) / 0.14)', color: 'hsl(var(--primary))' }}
          >
            {totalUnread} unread
          </span>
        )}
      </div>

      <div
        className="flex-1 min-h-0 flex rounded-2xl border overflow-hidden"
        style={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}
      >
        {/* ── Room list: one row per client company ── */}
        <div
          className={`${mobileView === 'list' ? 'flex' : 'hidden'} md:flex flex-col w-full md:w-80 border-r flex-shrink-0`}
          style={{ borderColor: 'hsl(var(--border))' }}
        >
          <div
            className="px-3.5 h-[52px] flex items-center justify-between flex-shrink-0 border-b"
            style={{ borderColor: 'hsl(var(--border))' }}
          >
            <p
              className="text-xs font-semibold uppercase tracking-widest"
              style={{ color: 'hsl(var(--text-faint))' }}
            >
              Rooms
            </p>
            <button
              type="button"
              onClick={() => {
                const next = !soundOn
                setSoundOn(next)
                setMessageSoundEnabled(next)
                if (next) playTestChime()
              }}
              className="p-1.5 rounded-lg transition-colors hover:bg-[hsl(var(--border))]"
              style={{ color: soundOn ? 'hsl(var(--primary))' : 'hsl(var(--text-faint))' }}
              title={soundOn ? 'Mute message sound' : 'Unmute message sound'}
            >
              {soundOn ? <Volume2 size={14} /> : <VolumeX size={14} />}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {rooms.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full py-12 px-4 text-center">
                <MessageSquare size={28} style={{ color: 'hsl(var(--text-faint))' }} />
                <p className="text-sm mt-3" style={{ color: 'hsl(var(--muted-foreground))' }}>
                  No client rooms yet
                </p>
                <p className="text-xs mt-1" style={{ color: 'hsl(var(--text-faint))' }}>
                  A room opens the moment a client company is created
                </p>
              </div>
            )}
            {rooms.map((room) => {
              const isActive = activeClientId === room.clientId
              const clientOnline = isClientOnline(online, room.clientId)
              const hasUnread = room.unread > 0
              return (
                <button
                  key={room.clientId}
                  onClick={() => selectRoom(room.clientId)}
                  className="w-full text-left px-3 py-2.5 transition-all border-b"
                  style={{
                    backgroundColor: isActive ? 'hsl(var(--primary) / 0.07)' : 'transparent',
                    boxShadow: isActive ? 'inset 2px 0 0 hsl(var(--primary))' : 'none',
                    borderColor: 'hsl(var(--border))',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="relative flex-shrink-0">
                      <div
                        className="w-9 h-9 rounded-xl overflow-hidden flex items-center justify-center"
                        style={{
                          backgroundColor: 'hsl(var(--primary) / 0.1)',
                          border: '1px solid hsl(var(--border))',
                        }}
                      >
                        {room.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={room.avatarUrl}
                            alt={room.company ?? room.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-sm font-bold" style={{ color: 'hsl(var(--primary))' }}>
                            {(room.company ?? room.name).charAt(0).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <span
                        className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2"
                        style={{
                          backgroundColor: clientOnline
                            ? 'hsl(var(--status-green))'
                            : 'hsl(var(--text-faint))',
                          borderColor: 'hsl(var(--card))',
                        }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm truncate"
                        style={{
                          color: 'hsl(var(--foreground))',
                          fontWeight: hasUnread ? 700 : 500,
                        }}
                      >
                        {room.company ?? room.name}
                      </p>
                      {activityByClient[room.clientId] ? (
                        <p className="text-xs mt-0.5 italic font-medium" style={{ color: 'hsl(var(--primary))' }}>
                          {activityByClient[room.clientId] === 'recording' ? 'recording audio…' : 'typing…'}
                        </p>
                      ) : room.latest ? (
                        <p
                          className="text-xs mt-0.5 truncate"
                          style={{
                            color: hasUnread
                              ? 'hsl(var(--foreground))'
                              : 'hsl(var(--muted-foreground))',
                          }}
                        >
                          {room.latest.sender_role === 'admin' ? 'You: ' : ''}
                          {messagePreview(room.latest)}
                        </p>
                      ) : (
                        <p className="text-xs mt-0.5 italic" style={{ color: 'hsl(var(--text-faint))' }}>
                          No messages yet
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      {room.latest && (
                        <span className="text-[10px]" style={{ color: 'hsl(var(--text-faint))' }}>
                          {timeAgo(room.latest.created_at)}
                        </span>
                      )}
                      {hasUnread && (
                        <span
                          className="text-[10px] font-bold min-w-[20px] h-5 px-1 rounded-full flex items-center justify-center"
                          style={{
                            backgroundColor: 'hsl(var(--primary))',
                            color: 'hsl(var(--primary-foreground))',
                          }}
                        >
                          {room.unread > 99 ? '99+' : room.unread}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Conversation ── */}
        <div className={`${mobileView === 'thread' ? 'flex' : 'hidden'} md:flex flex-col flex-1 min-w-0`}>
          {!active ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <MessageSquare size={32} style={{ color: 'hsl(var(--text-faint))' }} />
              <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Select a room to open the conversation
              </p>
            </div>
          ) : (
            <>
              {/* Room header */}
              <div
                className="flex items-center gap-2.5 px-3.5 h-[52px] flex-shrink-0 border-b"
                style={{ borderColor: 'hsl(var(--border))' }}
              >
                <button
                  onClick={() => setMobileView('list')}
                  className="md:hidden p-1.5 rounded-lg hover:bg-[hsl(var(--border))]"
                  style={{ color: 'hsl(var(--muted-foreground))' }}
                >
                  <ChevronLeft size={18} />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: 'hsl(var(--foreground))' }}>
                    {active.company ?? active.name}
                  </p>
                  <p
                    className="text-xs flex items-center gap-1.5"
                    style={{
                      color: clientActivity
                        ? 'hsl(var(--primary))'
                        : isClientOnline(online, active.clientId)
                          ? 'hsl(var(--status-green))'
                          : 'hsl(var(--text-faint))',
                    }}
                  >
                    {!clientActivity && (
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{
                          backgroundColor: isClientOnline(online, active.clientId)
                            ? 'hsl(var(--status-green))'
                            : 'hsl(var(--text-faint))',
                        }}
                      />
                    )}
                    {clientActivity === 'recording'
                      ? 'recording audio…'
                      : clientActivity === 'typing'
                        ? 'typing…'
                        : whereClient
                          // WHICH view they are reading, not just that they
                          // are here (item 3). "in AMP" is actionable before
                          // you type; "Online" is not.
                          ? `${active.name} · ${whereClient}`
                          : `${active.name} · Away`}
                  </p>
                </div>
                {/* THE room menu — extreme right (Batch 16) */}
                <div className="relative flex-shrink-0" data-tl-keep-open>
                  <button
                    type="button"
                    onClick={() => setRoomMenuOpen((v) => !v)}
                    className="p-2 rounded-lg transition-colors hover:bg-[hsl(var(--border))]"
                    style={{ color: roomMenuOpen ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))' }}
                    title="Room menu"
                  >
                    <MoreVertical size={15} />
                  </button>
                  {roomMenuOpen && (
                    <div
                      className="absolute right-0 mt-1 w-56 rounded-xl overflow-hidden shadow-2xl z-40"
                      style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                    >
                      {([
                        ['search', 'Search in conversation'],
                        ['pins', 'Pinned messages'],
                        ['saves', 'Saved for you'],
                        ['people', 'People in this room'],
                        ['settings', 'Chat settings & wallpaper'],
                      ] as const).map(([which, label]) => (
                        <button
                          key={which}
                          onClick={() => {
                            setRoomMenuOpen(false)
                            setPanelCommand({ which, n: Date.now() })
                          }}
                          className="w-full px-3.5 py-2.5 text-sm text-left transition-colors hover:bg-[hsl(var(--primary)/0.08)]"
                          style={{ color: 'hsl(var(--foreground))' }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Filter chips: views over the ONE room, in THE NOTCH — a
                  single squircle hanging from the header. Only the squircle
                  carries a background; the conversation scrolls beneath it,
                  where the old full-width band cost the chat a strip of
                  height and read as page chrome. */}
              <div className="flex-1 min-h-0 relative">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 z-30 max-w-[calc(100%-96px)]">
                <div
                  className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-b-2xl max-w-full overflow-x-auto scrollbar-none shadow-lg"
                  style={{
                    backgroundColor: 'hsl(var(--card) / 0.88)',
                    border: '1px solid hsl(var(--border))',
                    borderTop: 'none',
                    backdropFilter: 'blur(10px)',
                    WebkitBackdropFilter: 'blur(10px)',
                  }}
                >
                {[
                  { key: 'all', label: 'All', count: 0, f: { kind: 'all' } as RoomFilter, general: false },
                  ...active.projects.map((p) => ({
                    key: p.id,
                    label: p.title,
                    count: p.unread,
                    f: { kind: 'project', projectId: p.id } as RoomFilter,
                    general: false,
                  })),
                ].map((c) => {
                  const isOn =
                    (c.f.kind === filter.kind && c.f.kind !== 'project') ||
                    (c.f.kind === 'project' &&
                      filter.kind === 'project' &&
                      c.f.projectId === filter.projectId)
                  // An active chip wears ITS OWN colour (item 9), so the chip,
                  // the bubble stripe and the composer tag all agree. ALL is
                  // the only gold one — it is the view over everything rather
                  // than a project, and gold is the shell's accent.
                  const tone = c.f.kind === 'project' ? projectColor(c.f.projectId) : null
                  return (
                    <button
                      key={c.key}
                      onClick={() => setFilter(c.f)}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-all duration-150 flex-shrink-0 active:scale-95"
                      style={{
                        backgroundColor: isOn ? (tone ?? 'hsl(var(--primary))') : 'hsl(var(--background))',
                        color: isOn ? 'hsl(var(--primary-foreground))' : 'hsl(var(--foreground))',
                        border: `1px solid ${isOn ? (tone ?? 'hsl(var(--primary))') : 'hsl(var(--border))'}`,
                        boxShadow: isOn
                          ? `0 0 12px ${tone ? `${tone}40` : 'hsl(var(--primary) / 0.25)'}`
                          : 'none',
                      }}
                    >
                      {c.general && (
                        <MessageSquare
                          size={10}
                          style={{
                            color: isOn ? 'hsl(var(--primary-foreground))' : 'hsl(var(--primary))',
                          }}
                        />
                      )}
                      {c.f.kind === 'project' && !isOn && (
                        <span
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: projectColor(c.f.projectId) }}
                        />
                      )}
                      {c.label}
                      {c.count > 0 && !isOn && (
                        <span
                          className="min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center"
                          style={{
                            backgroundColor: 'hsl(var(--primary))',
                            color: 'hsl(var(--primary-foreground))',
                          }}
                        >
                          {c.count > 99 ? '99+' : c.count}
                        </span>
                      )}
                    </button>
                  )
                })}
                </div>
              </div>

                <RoomThread
                  key={active.clientId}
                  role="admin"
                  clientId={active.clientId}
                  orgId={orgId}
                  filter={filter}
                  currentName={adminName}
                  otherName={active.name}
                          externalRow={externalRow}
                  onActivity={onActivity}
                  onTypingChange={setClientActivity}
                  panelCommand={panelCommand}
                  showMenuButton={false}
                  forwardRooms={rooms.map((r) => ({ id: r.clientId, label: r.company ?? r.name }))}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
