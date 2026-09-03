'use client'

/**
 * CrewChatHub — Batch 23 (S3-d §8 step 8). The crew space's Chat feature,
 * real: the org's General room, channels, private groups, broadcasts and
 * DMs, over the membership model (MD-1) and the /api/rooms surface.
 *
 * Client-company rooms deliberately do NOT appear here — they live in
 * Client › Messages, which is the studio's window into client work. This
 * hub is the INTERNAL side (plus external collaborators seated per room).
 *
 * The conversation engine is RoomThread in room mode — the same renderer,
 * realtime protocol, reactions, pins, saves, search and read model every
 * other messaging surface uses. This file owns the LIST, creation, and
 * member management.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Hash, Lock, Megaphone, Users, MessageSquare, Plus, ChevronLeft,
  MoreVertical, Settings2, Search as SearchIcon, Pin, Bookmark, X,
  Volume2, VolumeX, Archive, UserPlus,
} from 'lucide-react'
import RoomThread, { type ExternalRow } from '@/components/shared/RoomThread'
import type { Message } from '@/lib/types/database'
import {
  playMessageChime, messageSoundEnabled, setMessageSoundEnabled,
  playTestChime, primeAudio,
} from '@/lib/soundClient'
import { usePresenceStore } from '@/lib/stores/presence-store'
import { acquireHub, releaseHub } from '@/lib/realtimeBus'
import { useDismissOnOutside } from '@/lib/hooks/useDismissOnOutside'
import { senderColor } from '@/lib/projectColor'

type RoomEntry = {
  id: string
  kind: 'client' | 'crew' | 'channel' | 'group' | 'dm' | 'broadcast'
  /** Null means INTERNAL — this hub's whole population (the owner's
   *  correction): anything carrying a company belongs to Client › Messages. */
  clientId: string | null
  label: string
  name: string | null
  topic: string | null
  isPrivate: boolean
  archived: boolean
  lastMessageAt: string | null
  unread: number
  membership: { role: string; canPost: boolean; notify: string }
  members: { userId: string; name: string; avatarUrl: string | null; side: string; role: string; canPost: boolean }[]
  memberCount: number
  latest: { senderName: string | null; body: string; createdAt: string } | null
}

type Person = { id: string; name: string; avatarUrl: string | null; side: 'crew' | 'client'; sub: string }

/** Copy that says who this space is for, so the emptiness reads as a
 *  boundary rather than as a missing feature. */
const INTERNAL_ONLY_NOTE = 'Crew and collaborators. Client conversations live in Client · Messages.'

function timeAgo(date: string) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 604800) return `${Math.floor(s / 86400)}d`
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const KIND_ICON: Record<string, typeof Hash> = {
  crew: Users, channel: Hash, broadcast: Megaphone, group: Lock, dm: MessageSquare,
}

/** Small stacked avatar row for groups/channels. */
function AvatarStack({ members, size = 20 }: { members: RoomEntry['members']; size?: number }) {
  const shown = members.slice(0, 4)
  return (
    <span className="flex -space-x-1.5">
      {shown.map((m) => (
        m.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={m.userId} src={m.avatarUrl} alt={m.name}
            className="rounded-full object-cover"
            style={{ width: size, height: size, border: '1.5px solid hsl(var(--card))' }} />
        ) : (
          <span key={m.userId}
            className="rounded-full flex items-center justify-center font-bold"
            style={{
              width: size, height: size, fontSize: size * 0.42,
              backgroundColor: `${senderColor(m.userId)}30`,
              color: senderColor(m.userId),
              border: '1.5px solid hsl(var(--card))',
            }}>
            {m.name.slice(0, 1).toUpperCase()}
          </span>
        )
      ))}
    </span>
  )
}

/** Shared person row for the pickers. */
function PersonRow({ p, selected, onToggle }: { p: Person; selected: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-colors hover:bg-[hsl(var(--primary)/0.08)]"
      style={selected ? { backgroundColor: 'hsl(var(--primary) / 0.12)' } : undefined}
    >
      {p.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.avatarUrl} alt={p.name} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
      ) : (
        <span className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
          style={{ backgroundColor: `${senderColor(p.id)}22`, color: senderColor(p.id) }}>
          {p.name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="flex-1 min-w-0">
        <span className="block text-sm truncate" style={{ color: 'hsl(var(--foreground))' }}>{p.name}</span>
        <span className="block text-[10px] uppercase tracking-wide" style={{ color: 'hsl(var(--text-faint))' }}>{p.sub}</span>
      </span>
      <span
        className="w-4 h-4 rounded-full flex-shrink-0"
        style={{
          border: `2px solid ${selected ? 'hsl(var(--primary))' : 'hsl(var(--border))'}`,
          backgroundColor: selected ? 'hsl(var(--primary))' : 'transparent',
        }}
      />
    </button>
  )
}

export default function CrewChatHub({ orgId, adminName }: { orgId: string; adminName: string }) {
  const supabase = createClient()
  const [rooms, setRooms] = useState<RoomEntry[]>([])
  const [me, setMe] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [externalRow, setExternalRow] = useState<ExternalRow | null>(null)
  const [soundOn, setSoundOn] = useState(() => messageSoundEnabled())
  const [mobileView, setMobileView] = useState<'list' | 'thread'>('list')
  const [roomMenuOpen, setRoomMenuOpen] = useState(false)
  const [panelCommand, setPanelCommand] = useState<{ which: 'pins' | 'saves' | 'settings' | 'people' | 'search'; n: number } | null>(null)
  useDismissOnOutside(roomMenuOpen, useCallback(() => setRoomMenuOpen(false), []))

  // Dialogs
  const [createOpen, setCreateOpen] = useState(false)
  const [dmOpen, setDmOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [people, setPeople] = useState<Person[]>([])
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Create form
  const [newKind, setNewKind] = useState<'channel' | 'group' | 'broadcast'>('channel')
  const [newName, setNewName] = useState('')
  const [newTopic, setNewTopic] = useState('')
  const [newPrivate, setNewPrivate] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [personQuery, setPersonQuery] = useState('')

  const online = usePresenceStore((s) => s.online)
  const activeRef = useRef<string | null>(null)
  useEffect(() => { activeRef.current = activeId }, [activeId])

  const active = rooms.find((r) => r.id === activeId) ?? null

  const loadRooms = useCallback(async () => {
    try {
      const res = await fetch('/api/rooms')
      const json = await res.json()
      if (!res.ok) return
      // INTERNAL ONLY. `kind !== 'client'` was the wrong predicate: a DM or
      // a channel opened with a client company's person is client-facing
      // work and was showing up on the studio's internal floor. The company
      // column is what separates the two spaces.
      const mine = ((json.rooms ?? []) as RoomEntry[]).filter((r) => r.clientId == null)
      setRooms(mine)
      setMe(json.me ?? null)
      setActiveId((cur) => cur ?? mine.find((r) => r.kind === 'crew')?.id ?? mine[0]?.id ?? null)
    } catch { /* the list retries on the next visibility change */ }
  }, [])

  useEffect(() => {
    primeAudio()
    acquireHub()
    // setRooms lands after a network await, never in this effect's own pass.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRooms()
    const onVis = () => { if (document.visibilityState === 'visible') void loadRooms() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      releaseHub()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [loadRooms])

  useEffect(() => {
    // Internal directory: crew and seated collaborators, never a client's
    // contacts — this space is the studio's own floor.
    fetch('/api/rooms?people=1&scope=internal')
      .then((r) => r.json())
      .then((json) => { if (json.people) setPeople(json.people) })
      .catch(() => {})
  }, [])

  // ── ONE replication fallback for the whole org (the AdminMessagesHub shape,
  //    over room ids instead of client ids). RLS scopes it to member rooms. ──
  const roomIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => { roomIdsRef.current = new Set(rooms.map((r) => r.id)) }, [rooms])
  const meRef = useRef<string | null>(null)
  useEffect(() => { meRef.current = me }, [me])

  useEffect(() => {
    const ch = supabase
      .channel(`crew-hub-fallback:${orgId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `organization_id=eq.${orgId}` },
        (p) => {
          const row = p.new as Message
          if (row.room_id && row.room_id === activeRef.current) {
            setExternalRow({ row, n: Date.now(), op: 'update' })
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `organization_id=eq.${orgId}` },
        (p) => {
          const row = p.new as Message
          if (!row.room_id || !roomIdsRef.current.has(row.room_id)) return
          if (row.sender_id === meRef.current) return
          const isActive = row.room_id === activeRef.current
          if (isActive) setExternalRow({ row, n: Date.now(), op: 'insert' })
          else playMessageChime()
          setRooms((prev) => {
            const idx = prev.findIndex((r) => r.id === row.room_id)
            if (idx === -1) return prev
            const r = prev[idx]
            const updated: RoomEntry = {
              ...r,
              lastMessageAt: row.created_at,
              unread: isActive ? r.unread : r.unread + 1,
              latest: {
                senderName: row.sender_name ?? null,
                body: row.body || '📎 Attachment',
                createdAt: row.created_at,
              },
            }
            return [updated, ...prev.filter((x) => x.id !== row.room_id)]
          })
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [orgId, supabase])

  const selectRoom = useCallback((id: string) => {
    setActiveId(id)
    setMobileView('thread')
    setManageOpen(false)
    setRooms((prev) => prev.map((r) => (r.id === id ? { ...r, unread: 0 } : r)))
  }, [])

  const filteredPeople = people.filter((p) =>
    !personQuery.trim() || p.name.toLowerCase().includes(personQuery.trim().toLowerCase())
  )

  const resetCreate = () => {
    setNewKind('channel'); setNewName(''); setNewTopic(''); setNewPrivate(false)
    setPicked(new Set()); setPersonQuery(''); setErrorMsg(null)
  }

  const doCreate = async () => {
    if (!newName.trim() || busy) return
    setBusy(true); setErrorMsg(null)
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: newKind,
          name: newName.trim(),
          topic: newTopic.trim() || undefined,
          is_private: newKind === 'group' ? true : newPrivate,
          member_ids: [...picked],
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not create the room')
      setCreateOpen(false)
      resetCreate()
      await loadRooms()
      if (json.room?.id) selectRoom(json.room.id)
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Could not create the room')
    } finally {
      setBusy(false)
    }
  }

  const doStartDm = async (personId: string) => {
    if (busy) return
    setBusy(true); setErrorMsg(null)
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'dm', with_user_id: personId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not open the conversation')
      setDmOpen(false)
      setPersonQuery('')
      await loadRooms()
      if (json.room?.id) selectRoom(json.room.id)
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Could not open the conversation')
    } finally {
      setBusy(false)
    }
  }

  const isManager = !!active && ['owner', 'admin'].includes(active.membership.role)

  const sections: { key: string; title: string | null; rooms: RoomEntry[] }[] = [
    { key: 'general', title: null, rooms: rooms.filter((r) => r.kind === 'crew') },
    { key: 'channels', title: 'Channels', rooms: rooms.filter((r) => r.kind === 'channel' || r.kind === 'broadcast') },
    { key: 'groups', title: 'Groups', rooms: rooms.filter((r) => r.kind === 'group') },
    { key: 'dms', title: 'Direct messages', rooms: rooms.filter((r) => r.kind === 'dm') },
  ]

  const dmOnline = (r: RoomEntry) => {
    const other = r.members.find((m) => m.userId !== me)
    return !!other && online.some((o) => o.userId === other.userId)
  }

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col w-full min-h-0">
      <div className="mb-4 flex-shrink-0 flex items-center gap-3">
        <h1 className="font-display text-2xl font-bold" style={{ color: 'hsl(var(--foreground))' }}>
          Chat
        </h1>
        {rooms.reduce((a, r) => a + r.unread, 0) > 0 && (
          <span className="text-xs font-bold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: 'hsl(var(--primary) / 0.14)', color: 'hsl(var(--primary))' }}>
            {rooms.reduce((a, r) => a + r.unread, 0)} unread
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 flex rounded-2xl border overflow-hidden"
        style={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}>

        {/* ── Rail: rooms by shape ── */}
        <div className={`${mobileView === 'list' ? 'flex' : 'hidden'} md:flex flex-col w-full md:w-80 border-r flex-shrink-0`}
          style={{ borderColor: 'hsl(var(--border))' }}>
          <div className="px-3.5 h-[52px] flex items-center justify-between flex-shrink-0 border-b"
            style={{ borderColor: 'hsl(var(--border))' }}>
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'hsl(var(--text-faint))' }}>
              Rooms
            </p>
            <div className="flex items-center gap-1">
              <button type="button"
                onClick={() => { setDmOpen(true); setErrorMsg(null); setPersonQuery('') }}
                className="p-1.5 rounded-lg transition-colors hover:bg-[hsl(var(--border))]"
                style={{ color: 'hsl(var(--muted-foreground))' }}
                title="New direct message">
                <MessageSquare size={14} />
              </button>
              <button type="button"
                onClick={() => { setCreateOpen(true); resetCreate() }}
                className="p-1.5 rounded-lg transition-colors hover:bg-[hsl(var(--border))]"
                style={{ color: 'hsl(var(--primary))' }}
                title="New channel or group">
                <Plus size={15} />
              </button>
              <button type="button"
                onClick={() => {
                  const next = !soundOn
                  setSoundOn(next); setMessageSoundEnabled(next)
                  if (next) playTestChime()
                }}
                className="p-1.5 rounded-lg transition-colors hover:bg-[hsl(var(--border))]"
                style={{ color: soundOn ? 'hsl(var(--primary))' : 'hsl(var(--text-faint))' }}
                title={soundOn ? 'Mute message sound' : 'Unmute message sound'}>
                {soundOn ? <Volume2 size={14} /> : <VolumeX size={14} />}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin py-1">
            {rooms.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full py-12 px-4 text-center">
                <Hash size={26} style={{ color: 'hsl(var(--text-faint))' }} />
                <p className="text-sm mt-3" style={{ color: 'hsl(var(--muted-foreground))' }}>
                  No rooms yet
                </p>
                <p className="text-xs mt-1" style={{ color: 'hsl(var(--text-faint))' }}>
                  Create a channel, or send the first General message
                </p>
                <p className="text-[11px] mt-3 max-w-[220px] leading-snug" style={{ color: 'hsl(var(--text-faint))' }}>
                  {INTERNAL_ONLY_NOTE}
                </p>
              </div>
            )}
            {sections.map((sec) => sec.rooms.length > 0 && (
              <div key={sec.key} className="mb-1">
                {sec.title && (
                  <p className="px-3.5 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest"
                    style={{ color: 'hsl(var(--text-faint))' }}>
                    {sec.title}
                  </p>
                )}
                {sec.rooms.map((room) => {
                  const Icon = KIND_ICON[room.kind] ?? Hash
                  const isOn = activeId === room.id
                  const other = room.kind === 'dm' ? room.members.find((m) => m.userId !== me) : null
                  return (
                    <button key={room.id} onClick={() => selectRoom(room.id)}
                      className="w-full text-left px-3 py-2 transition-all"
                      style={{
                        backgroundColor: isOn ? 'hsl(var(--primary) / 0.07)' : 'transparent',
                        boxShadow: isOn ? 'inset 2px 0 0 hsl(var(--primary))' : 'none',
                      }}>
                      <div className="flex items-center gap-2.5">
                        {room.kind === 'dm' ? (
                          <div className="relative flex-shrink-0">
                            {other?.avatarUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={other.avatarUrl} alt={room.label} className="w-8 h-8 rounded-full object-cover" />
                            ) : (
                              <span className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                                style={{
                                  backgroundColor: `${senderColor(other?.userId)}22`,
                                  color: senderColor(other?.userId),
                                }}>
                                {room.label.slice(0, 1).toUpperCase()}
                              </span>
                            )}
                            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2"
                              style={{
                                backgroundColor: dmOnline(room) ? 'hsl(var(--status-green))' : 'hsl(var(--text-faint))',
                                borderColor: 'hsl(var(--card))',
                              }} />
                          </div>
                        ) : (
                          <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{
                              backgroundColor: 'hsl(var(--primary) / 0.08)',
                              border: '1px solid hsl(var(--border))',
                              color: 'hsl(var(--primary))',
                            }}>
                            <Icon size={14} />
                          </span>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm truncate"
                              style={{ color: 'hsl(var(--foreground))', fontWeight: room.unread > 0 ? 700 : 500 }}>
                              {room.label}
                            </p>
                            {room.kind === 'group' && <Lock size={9} style={{ color: 'hsl(var(--text-faint))' }} />}
                            {room.archived && <Archive size={9} style={{ color: 'hsl(var(--text-faint))' }} />}
                          </div>
                          {room.latest ? (
                            <p className="text-xs mt-0.5 truncate"
                              style={{ color: room.unread > 0 ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))' }}>
                              {room.latest.senderName ? `${room.latest.senderName.split(' ')[0]}: ` : ''}
                              {room.latest.body}
                            </p>
                          ) : (
                            <p className="text-xs mt-0.5 italic" style={{ color: 'hsl(var(--text-faint))' }}>
                              {room.topic || 'No messages yet'}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          {room.lastMessageAt && (
                            <span className="text-[10px]" style={{ color: 'hsl(var(--text-faint))' }}>
                              {timeAgo(room.lastMessageAt)}
                            </span>
                          )}
                          {room.unread > 0 && (
                            <span className="text-[10px] font-bold min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center"
                              style={{ backgroundColor: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}>
                              {room.unread > 99 ? '99+' : room.unread}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        {/* ── Conversation ── */}
        <div className={`${mobileView === 'thread' ? 'flex' : 'hidden'} md:flex flex-col flex-1 min-w-0`}>
          {!active ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <Hash size={30} style={{ color: 'hsl(var(--text-faint))' }} />
              <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Pick a room, or create one
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2.5 px-3.5 h-[52px] flex-shrink-0 border-b"
                style={{ borderColor: 'hsl(var(--border))' }}>
                <button onClick={() => setMobileView('list')}
                  className="md:hidden p-1.5 rounded-lg hover:bg-[hsl(var(--border))]"
                  style={{ color: 'hsl(var(--muted-foreground))' }}>
                  <ChevronLeft size={18} />
                </button>
                <div className="flex-1 min-w-0 flex items-center gap-2.5">
                  <span className="flex items-center gap-1.5 text-sm font-semibold truncate"
                    style={{ color: 'hsl(var(--foreground))' }}>
                    {(() => { const I = KIND_ICON[active.kind] ?? Hash; return active.kind !== 'dm' ? <I size={14} style={{ color: 'hsl(var(--primary))' }} /> : null })()}
                    {active.label}
                  </span>
                  {active.topic && (
                    <span className="text-xs truncate hidden sm:block" style={{ color: 'hsl(var(--text-faint))' }}>
                      {active.topic}
                    </span>
                  )}
                  {active.kind === 'broadcast' && !active.membership.canPost && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide flex-shrink-0"
                      style={{ backgroundColor: 'hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}>
                      read-only
                    </span>
                  )}
                </div>
                {active.kind !== 'dm' && (
                  <button type="button"
                    onClick={() => setManageOpen(true)}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-lg transition-colors hover:bg-[hsl(var(--border))]"
                    style={{ color: 'hsl(var(--muted-foreground))' }}
                    title="Members">
                    <AvatarStack members={active.members} />
                    <span className="text-[11px] font-semibold">{active.memberCount}</span>
                  </button>
                )}
                <div className="relative flex-shrink-0" data-tl-keep-open>
                  <button type="button" onClick={() => setRoomMenuOpen((v) => !v)}
                    className="p-2 rounded-lg transition-colors hover:bg-[hsl(var(--border))]"
                    style={{ color: roomMenuOpen ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))' }}
                    title="Room menu">
                    <MoreVertical size={15} />
                  </button>
                  {roomMenuOpen && (
                    <div className="absolute right-0 mt-1 w-56 rounded-xl overflow-hidden shadow-2xl z-40"
                      style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
                      {([
                        ['search', 'Search in conversation', SearchIcon],
                        ['pins', 'Pinned messages', Pin],
                        ['saves', 'Saved for you', Bookmark],
                        ['people', 'People in this room', Users],
                        ['settings', 'Chat settings & wallpaper', Settings2],
                      ] as const).map(([which, label, Icon]) => (
                        <button key={which}
                          onClick={() => { setRoomMenuOpen(false); setPanelCommand({ which, n: Date.now() }) }}
                          className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-left transition-colors hover:bg-[hsl(var(--primary)/0.08)]"
                          style={{ color: 'hsl(var(--foreground))' }}>
                          <Icon size={14} style={{ color: 'hsl(var(--primary))' }} />
                          {label}
                        </button>
                      ))}
                      {isManager && active.kind !== 'dm' && (
                        <button
                          onClick={() => { setRoomMenuOpen(false); setManageOpen(true) }}
                          className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-left transition-colors hover:bg-[hsl(var(--primary)/0.08)] border-t"
                          style={{ color: 'hsl(var(--foreground))', borderColor: 'hsl(var(--border))' }}>
                          <UserPlus size={14} style={{ color: 'hsl(var(--primary))' }} />
                          Manage room
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex-1 min-h-0 relative">
                <RoomThread
                  key={active.id}
                  role="admin"
                  clientId={active.id}
                  room={{ id: active.id, kind: active.kind, label: active.label }}
                  orgId={orgId}
                  filter={{ kind: 'all' }}
                  currentName={adminName}
                  otherName={active.label}
                  canSend={active.membership.canPost && !active.archived}
                  allowAttachments={active.membership.canPost && !active.archived}
                  externalRow={externalRow}
                  panelCommand={panelCommand}
                  showMenuButton={false}
                />
                {manageOpen && (
                  <RoomManagePanel
                    room={active}
                    me={me}
                    isManager={isManager}
                    people={people}
                    onClose={() => setManageOpen(false)}
                    onChanged={() => void loadRooms()}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Create channel / group / broadcast ── */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ backgroundColor: 'hsl(var(--background) / 0.6)', backdropFilter: 'blur(4px)' }}
          onClick={() => setCreateOpen(false)}>
          <div className="w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
            style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
            onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'hsl(var(--border))' }}>
              <p className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>New room</p>
              <button onClick={() => setCreateOpen(false)} className="p-1 rounded-lg hover:bg-[hsl(var(--border))]"
                style={{ color: 'hsl(var(--muted-foreground))' }}>
                <X size={15} />
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto scrollbar-thin">
              <div className="grid grid-cols-3 gap-2">
                {([
                  ['channel', 'Channel', Hash, 'A named stream — open to the crew, or private'],
                  ['group', 'Group', Lock, 'A private set of people'],
                  ['broadcast', 'Broadcast', Megaphone, 'Managers post; everyone reads'],
                ] as const).map(([kind, label, Icon, hint]) => (
                  <button key={kind} type="button" onClick={() => setNewKind(kind)}
                    className="rounded-xl p-3 text-left border transition-colors"
                    style={{
                      borderColor: newKind === kind ? 'hsl(var(--primary))' : 'hsl(var(--border))',
                      backgroundColor: newKind === kind ? 'hsl(var(--primary) / 0.08)' : 'transparent',
                    }}
                    title={hint}>
                    <Icon size={15} style={{ color: newKind === kind ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))' }} />
                    <p className="text-xs font-semibold mt-1.5" style={{ color: 'hsl(var(--foreground))' }}>{label}</p>
                  </button>
                ))}
              </div>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus
                placeholder={newKind === 'group' ? 'Group name' : newKind === 'broadcast' ? 'Announcement channel name' : 'Channel name'}
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none focus:border-[hsl(var(--primary))]"
                style={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }} />
              <input value={newTopic} onChange={(e) => setNewTopic(e.target.value)}
                placeholder="Topic (optional)"
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none focus:border-[hsl(var(--primary))]"
                style={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }} />
              {newKind === 'channel' && (
                <label className="flex items-center gap-2.5 text-sm cursor-pointer" style={{ color: 'hsl(var(--foreground))' }}>
                  <button type="button" role="switch" aria-checked={newPrivate}
                    onClick={() => setNewPrivate((v) => !v)}
                    className="relative w-9 h-5 rounded-full transition-colors flex-shrink-0"
                    style={{ backgroundColor: newPrivate ? 'hsl(var(--primary))' : 'hsl(var(--border))' }}>
                    <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
                      style={{ left: newPrivate ? 18 : 2 }} />
                  </button>
                  Private — visible to members only
                </label>
              )}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'hsl(var(--text-faint))' }}>
                  Add people {picked.size > 0 && `· ${picked.size} selected`}
                </p>
                <input value={personQuery} onChange={(e) => setPersonQuery(e.target.value)}
                  placeholder="Search people"
                  className="w-full px-3 py-2 rounded-xl text-xs outline-none mb-1.5"
                  style={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }} />
                <div className="max-h-44 overflow-y-auto scrollbar-thin space-y-0.5">
                  {filteredPeople.map((p) => (
                    <PersonRow key={p.id} p={p} selected={picked.has(p.id)}
                      onToggle={() => setPicked((prev) => {
                        const next = new Set(prev)
                        if (next.has(p.id)) next.delete(p.id); else next.add(p.id)
                        return next
                      })} />
                  ))}
                </div>
              </div>
              {errorMsg && <p className="text-xs" style={{ color: 'hsl(var(--destructive))' }}>{errorMsg}</p>}
            </div>
            <div className="px-5 py-4 border-t flex justify-end gap-2" style={{ borderColor: 'hsl(var(--border))' }}>
              <button onClick={() => setCreateOpen(false)} className="text-xs px-3 py-2 rounded-xl"
                style={{ color: 'hsl(var(--muted-foreground))' }}>
                Cancel
              </button>
              <button onClick={() => void doCreate()} disabled={!newName.trim() || busy}
                className="text-xs font-bold px-4 py-2 rounded-xl disabled:opacity-40"
                style={{ backgroundColor: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}>
                {busy ? 'Creating…' : 'Create room'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── New DM ── */}
      {dmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ backgroundColor: 'hsl(var(--background) / 0.6)', backdropFilter: 'blur(4px)' }}
          onClick={() => setDmOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[75vh]"
            style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
            onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'hsl(var(--border))' }}>
              <p className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>New direct message</p>
              <button onClick={() => setDmOpen(false)} className="p-1 rounded-lg hover:bg-[hsl(var(--border))]"
                style={{ color: 'hsl(var(--muted-foreground))' }}>
                <X size={15} />
              </button>
            </div>
            <div className="p-4 overflow-y-auto scrollbar-thin">
              <input value={personQuery} onChange={(e) => setPersonQuery(e.target.value)} autoFocus
                placeholder="Search crew and collaborators"
                className="w-full px-3 py-2 rounded-xl text-xs outline-none mb-1.5"
                style={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }} />
              <p className="text-[10px] mb-2 leading-snug" style={{ color: 'hsl(var(--text-faint))' }}>
                {INTERNAL_ONLY_NOTE}
              </p>
              <div className="space-y-0.5">
                {filteredPeople.map((p) => (
                  <button key={p.id} type="button" disabled={busy}
                    onClick={() => void doStartDm(p.id)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-colors hover:bg-[hsl(var(--primary)/0.08)] disabled:opacity-50">
                    {p.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.avatarUrl} alt={p.name} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <span className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                        style={{ backgroundColor: `${senderColor(p.id)}22`, color: senderColor(p.id) }}>
                        {p.name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm truncate" style={{ color: 'hsl(var(--foreground))' }}>{p.name}</span>
                      <span className="block text-[10px] uppercase tracking-wide" style={{ color: 'hsl(var(--text-faint))' }}>{p.sub}</span>
                    </span>
                  </button>
                ))}
              </div>
              {errorMsg && <p className="text-xs mt-2" style={{ color: 'hsl(var(--destructive))' }}>{errorMsg}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Member management — the manager's drawer over the open room. Adds, removes,
 * promotes, mutes posting (broadcast), renames, archives. Every write is a
 * thin call onto /api/rooms/*, whose authorization is the 0046 policies.
 */
function RoomManagePanel({
  room, me, isManager, people, onClose, onChanged,
}: {
  room: RoomEntry
  me: string | null
  isManager: boolean
  people: Person[]
  onClose: () => void
  onChanged: () => void
}) {
  const [name, setName] = useState(room.name ?? room.label)
  const [topic, setTopic] = useState(room.topic ?? '')
  const [addQuery, setAddQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const memberIds = new Set(room.members.map((m) => m.userId))
  const addable = people.filter((p) =>
    !memberIds.has(p.id) &&
    (!addQuery.trim() || p.name.toLowerCase().includes(addQuery.trim().toLowerCase()))
  )

  const call = async (fn: () => Promise<Response>) => {
    if (busy) return
    setBusy(true); setErr(null)
    try {
      const res = await fn()
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'That change failed')
      onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That change failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="absolute inset-y-0 right-0 z-30 w-full md:w-[380px] flex flex-col border-l shadow-2xl"
      style={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}>
      <div className="flex items-center gap-2 px-4 h-[52px] flex-shrink-0 border-b" style={{ borderColor: 'hsl(var(--border))' }}>
        <p className="text-xs font-semibold uppercase tracking-widest flex-1" style={{ color: 'hsl(var(--text-faint))' }}>
          {isManager ? 'Manage room' : 'Room members'}
        </p>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[hsl(var(--border))] text-sm"
          style={{ color: 'hsl(var(--muted-foreground))' }}>
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4">
        {isManager && room.kind !== 'crew' && (
          <div className="space-y-2">
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-xl text-sm outline-none"
              style={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }} />
            <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic"
              className="w-full px-3 py-2 rounded-xl text-sm outline-none"
              style={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }} />
            <div className="flex gap-2">
              <button disabled={busy || !name.trim()}
                onClick={() => void call(() => fetch(`/api/rooms/${room.id}`, {
                  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name: name.trim(), topic: topic.trim() || null }),
                }))}
                className="text-xs font-bold px-3 py-1.5 rounded-lg disabled:opacity-40"
                style={{ backgroundColor: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}>
                Save
              </button>
              <button disabled={busy}
                onClick={() => void call(() => fetch(`/api/rooms/${room.id}`, {
                  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ archived: !room.archived }),
                }))}
                className="text-xs px-3 py-1.5 rounded-lg border"
                style={{ color: 'hsl(var(--muted-foreground))', borderColor: 'hsl(var(--border))' }}>
                {room.archived ? 'Unarchive' : 'Archive'}
              </button>
            </div>
          </div>
        )}

        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'hsl(var(--text-faint))' }}>
            Members · {room.memberCount}
          </p>
          <div className="space-y-1">
            {room.members.map((m) => (
              <div key={m.userId} className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl border"
                style={{ backgroundColor: 'hsl(var(--background))', borderColor: 'hsl(var(--border))' }}>
                {m.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.avatarUrl} alt={m.name} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                ) : (
                  <span className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                    style={{ backgroundColor: `${senderColor(m.userId)}22`, color: senderColor(m.userId) }}>
                    {m.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate" style={{ color: 'hsl(var(--foreground))' }}>
                    {m.name}{m.userId === me && <span className="opacity-60"> · you</span>}
                  </p>
                  <p className="text-[10px] uppercase tracking-wide" style={{ color: 'hsl(var(--text-faint))' }}>
                    {m.side === 'crew' ? 'Studio' : m.side === 'external' ? 'Collaborator' : 'Client'} · {m.role}
                  </p>
                </div>
                {isManager && m.userId !== me && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {room.kind === 'broadcast' && (
                      <button disabled={busy} title={m.canPost ? 'Revoke posting' : 'Allow posting'}
                        onClick={() => void call(() => fetch(`/api/rooms/${room.id}/members`, {
                          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ user_id: m.userId, can_post: !m.canPost }),
                        }))}
                        className="p-1 rounded-lg hover:bg-[hsl(var(--border))]"
                        style={{ color: m.canPost ? 'hsl(var(--primary))' : 'hsl(var(--text-faint))' }}>
                        <Megaphone size={12} />
                      </button>
                    )}
                    <button disabled={busy} title={m.role === 'admin' || m.role === 'owner' ? 'Make member' : 'Make manager'}
                      onClick={() => void call(() => fetch(`/api/rooms/${room.id}/members`, {
                        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          user_id: m.userId,
                          role: m.role === 'admin' || m.role === 'owner' ? 'member' : 'admin',
                        }),
                      }))}
                      className="p-1 rounded-lg hover:bg-[hsl(var(--border))]"
                      style={{ color: ['admin', 'owner'].includes(m.role) ? 'hsl(var(--primary))' : 'hsl(var(--text-faint))' }}>
                      <Settings2 size={12} />
                    </button>
                    <button disabled={busy} title="Remove from room"
                      onClick={() => void call(() => fetch(`/api/rooms/${room.id}/members`, {
                        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ user_id: m.userId }),
                      }))}
                      className="p-1 rounded-lg hover:bg-[hsl(var(--destructive)/0.12)]"
                      style={{ color: 'hsl(var(--destructive))' }}>
                      <X size={12} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {isManager && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'hsl(var(--text-faint))' }}>
              Add people
            </p>
            <input value={addQuery} onChange={(e) => setAddQuery(e.target.value)} placeholder="Search people"
              className="w-full px-3 py-2 rounded-xl text-xs outline-none mb-1.5"
              style={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }} />
            <div className="max-h-48 overflow-y-auto scrollbar-thin space-y-0.5">
              {addable.map((p) => (
                <button key={p.id} type="button" disabled={busy}
                  onClick={() => void call(() => fetch(`/api/rooms/${room.id}/members`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      member_ids: [p.id],
                      can_post: room.kind !== 'broadcast',
                    }),
                  }))}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-colors hover:bg-[hsl(var(--primary)/0.08)] disabled:opacity-50">
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                    style={{ backgroundColor: `${senderColor(p.id)}22`, color: senderColor(p.id) }}>
                    {p.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs truncate" style={{ color: 'hsl(var(--foreground))' }}>{p.name}</span>
                    <span className="block text-[9px] uppercase tracking-wide" style={{ color: 'hsl(var(--text-faint))' }}>{p.sub}</span>
                  </span>
                  <Plus size={12} style={{ color: 'hsl(var(--primary))' }} />
                </button>
              ))}
            </div>
          </div>
        )}

        {err && <p className="text-xs" style={{ color: 'hsl(var(--destructive))' }}>{err}</p>}
      </div>
    </div>
  )
}
