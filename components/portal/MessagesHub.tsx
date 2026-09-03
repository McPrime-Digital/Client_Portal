'use client'

/**
 * The portal Messages hub — Batch 15 item 1. Room-first: a client company
 * has ONE conversation with its studio. The filter chips (All · General ·
 * per-project) are views over that single room — the same code path the
 * project pages use (RoomThread), never a second query shape.
 */

import { prefetchThreads, cacheKeyFor, filterKeyFor, threadListUrl } from '@/lib/threadCache'
import { useDismissOnOutside } from '@/lib/hooks/useDismissOnOutside'
import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Volume2, VolumeX, MessageSquare, MoreVertical } from 'lucide-react'
import RoomThread, { type RoomFilter, type ExternalRow } from '@/components/shared/RoomThread'
import type { Message } from '@/lib/types/database'
import {
  playMessageChime,
  messageSoundEnabled,
  setMessageSoundEnabled,
  playTestChime,
  primeAudio,
} from '@/lib/soundClient'
import { usePresenceStore, isAdminOnline, presenceWhere } from '@/lib/stores/presence-store'
import { acquireHub, releaseHub } from '@/lib/realtimeBus'
import { projectColor } from '@/lib/projectColor'

type ProjectChip = { id: string; title: string; status: string | null }

type Props = {
  clientId: string
  clientName: string
  /** The studio on the other side of this room (S0-B §3). */
  studioName: string
  studioLogoUrl?: string | null
  roomId?: string | null
  orgId?: string | null
  projects: ProjectChip[]
  unread: { general: number; byProject: Record<string, number> }
  canSend?: boolean
}

type DmRoom = {
  id: string
  label: string
  unread: number
  membership: { canPost: boolean }
  members: { userId: string; name: string; avatarUrl: string | null }[]
}

export default function MessagesHub({
  clientId,
  clientName,
  studioName,
  studioLogoUrl = null,
  roomId,
  orgId,
  projects,
  unread: initialUnread,
  canSend = true,
}: Props) {
  const supabase = createClient()
  const [filter, setFilter] = useState<RoomFilter>({ kind: 'all' })
  const [chipUnread, setChipUnread] = useState(initialUnread)
  // DMs with the studio (Batch 23, S3-d): a client owner/approver may open a
  // direct line to the studio's owners/admins. They render as chips in the
  // notch beside the project views, and swap the engine into room mode.
  const [dmRooms, setDmRooms] = useState<DmRoom[]>([])
  const [dmPeople, setDmPeople] = useState<{ id: string; name: string; avatarUrl: string | null; sub: string }[]>([])
  const [activeDm, setActiveDm] = useState<DmRoom | null>(null)
  const [dmPickerOpen, setDmPickerOpen] = useState(false)
  useDismissOnOutside(dmPickerOpen, useCallback(() => setDmPickerOpen(false), []))
  const loadDms = useCallback(async () => {
    try {
      const res = await fetch('/api/rooms')
      const json = await res.json()
      if (res.ok && json.rooms) {
        setDmRooms((json.rooms as (DmRoom & { kind: string })[]).filter((r) => r.kind === 'dm'))
      }
    } catch { /* retried on next mount */ }
  }, [])
  useEffect(() => {
    // Both setters land after a network await, never in this effect's own
    // pass — the rule cannot see through the async boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadDms()
    fetch('/api/rooms?people=1')
      .then((r) => r.json())
      .then((json) => { if (json.people) setDmPeople(json.people) })
      .catch(() => {})
  }, [loadDms])
  const startDm = useCallback(async (withUserId: string) => {
    setDmPickerOpen(false)
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'dm', with_user_id: withUserId }),
      })
      const json = await res.json()
      if (!res.ok) return
      await loadDms()
      const person = dmPeople.find((p) => p.id === withUserId)
      setActiveDm({
        id: json.room.id, label: person?.name ?? 'Direct message',
        unread: 0, membership: { canPost: true }, members: [],
      })
    } catch { /* the picker can be tapped again */ }
  }, [dmPeople, loadDms])
  const [externalRow, setExternalRow] = useState<ExternalRow | null>(null)
  const [adminActivity, setAdminActivity] = useState<'typing' | 'recording' | null>(null)
  const [soundOn, setSoundOn] = useState(() => messageSoundEnabled())
  const [roomMenuOpen, setRoomMenuOpen] = useState(false)

  // WARM EVERY CHIP BEFORE IT IS TAPPED (item 7). The cache already made a
  // revisit instant; this makes the FIRST open instant too, which is most of
  // them. Runs at idle, once per view per page load, capped in threadCache —
  // it is a head start, not a poll.
  useEffect(() => {
    prefetchThreads([
      { kind: 'all' as const },
      ...projects.map((p) => ({ kind: 'project' as const, projectId: p.id })),
    ].map((f) => ({
      key: cacheKeyFor('client', clientId, filterKeyFor(f)),
      url: threadListUrl('client', clientId, f),
    })))
  }, [clientId, projects])
  // Tap anywhere else, or Escape, closes it (shared hook — the same behaviour
  // both portals get, from one implementation).
  useDismissOnOutside(roomMenuOpen, useCallback(() => setRoomMenuOpen(false), []))
  const [panelCommand, setPanelCommand] = useState<{ which: 'pins' | 'saves' | 'settings' | 'people' | 'search'; n: number } | null>(null)

  const online = usePresenceStore((s) => s.online)
  const adminOnline = isAdminOnline(online)
  /** Where the STUDIO is right now — "in All", "in AMP", or "Online" when
   *  they are signed in but not reading this room (item 3). */
  const whereAdmin = presenceWhere(
    online, 'admin', clientId,
    (pid) => projects.find((p) => p.id === pid)?.title
  )
  const ownIdRef = useRef<string | null>(null)
  const filterRef = useRef(filter)
  useEffect(() => { filterRef.current = filter }, [filter])

  useEffect(() => {
    primeAudio()
    createClient().auth.getUser().then(({ data }) => {
      ownIdRef.current = data.user?.id ?? null
    })
    acquireHub()
    return () => releaseHub()
  }, [])

  // ── ONE replication fallback for the whole room; rows fan into the active
  //    view (via RoomThread) and into the chip badges. ─────────────────────
  useEffect(() => {
    if (!roomId) return
    const ch = supabase
      .channel(`hub-fallback:${roomId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
        (p) => {
          // Ticks, edits, deletes — patch the open view, badges untouched.
          setExternalRow({ row: p.new as Message, n: Date.now(), op: 'update' })
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
        (p) => {
          const row = p.new as Message
          if (row.sender_id === ownIdRef.current) return
          setExternalRow({ row, n: Date.now(), op: 'insert' })
          const f = filterRef.current
          const inActive =
            f.kind === 'all' ||
            (f.kind === 'general' && row.project_id == null) ||
            (f.kind === 'project' && (row.project_id == null || row.project_id === f.projectId))
          if (!inActive) {
            playMessageChime()
            if (row.project_id != null) {
              const pid = row.project_id
              setChipUnread((prev) => ({
                ...prev,
                byProject: { ...prev.byProject, [pid]: (prev.byProject[pid] ?? 0) + 1 },
              }))
            }
          }
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [roomId, supabase])

  // Opening a view clears its chip — the read PATCH inside RoomThread does
  // the durable half (the watermark); this is the instant local half.
  const selectFilter = useCallback((f: RoomFilter) => {
    setActiveDm(null)
    setFilter(f)
    setChipUnread((prev) => {
      if (f.kind === 'all') return { general: 0, byProject: {} }
      if (f.kind === 'general') return { ...prev, general: 0 }
      const rest = { ...prev.byProject }
      delete rest[f.projectId]
      return { general: 0, byProject: rest } // project views include untagged
    })
  }, [])

  const totalUnread =
    chipUnread.general +
    Object.values(chipUnread.byProject).reduce((a, n) => a + n, 0)

  const chip = (
    key: string,
    label: string,
    active: boolean,
    count: number,
    onClick: () => void,
    isGeneral = false,
    dotColor: string | null = null
  ) => (
    <button
      key={key}
      onClick={onClick}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-all duration-150 flex-shrink-0 active:scale-95"
      // An active chip wears ITS OWN colour (item 9): each project carries the
      // colour that already binds its messages, so the chip, the bubble stripe
      // and the composer tag all agree. ALL is the only gold one — it is the
      // view over everything, not a project, and gold is the shell's accent.
      style={{
        backgroundColor: active ? (dotColor ?? 'hsl(var(--primary))') : 'hsl(var(--card))',
        color: active ? 'hsl(var(--primary-foreground))' : 'hsl(var(--foreground))',
        border: `1px solid ${active ? (dotColor ?? 'hsl(var(--primary))') : 'hsl(var(--border))'}`,
        boxShadow: active
          ? `0 0 12px ${dotColor ? `${dotColor}40` : 'hsl(var(--primary) / 0.25)'}`
          : 'none',
      }}
    >
      {isGeneral && (
        <MessageSquare
          size={10}
          style={{ color: active ? 'hsl(var(--primary-foreground))' : 'hsl(var(--primary))' }}
        />
      )}
      {dotColor && !active && (
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: dotColor }} />
      )}
      {label}
      {count > 0 && !active && (
        <span
          className="min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center"
          style={{
            backgroundColor: 'hsl(var(--primary))',
            color: 'hsl(var(--primary-foreground))',
          }}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  )

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col w-full min-h-0">
      {/* ── Room header: who you are talking to ── */}
      <div
        className="flex items-center gap-2.5 px-3.5 py-2 rounded-t-2xl border border-b-0"
        style={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}
      >
        <div
          className="w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center flex-shrink-0"
          style={
            studioLogoUrl
              ? {
                  // Logos are drawn for light ground: give them one, whole and
                  // uncropped — a Slack-workspace-style chip, not a zoomed crop.
                  backgroundColor: '#ffffff',
                  border: '1px solid hsl(var(--border))',
                  padding: 4,
                  boxShadow: '0 1px 3px hsl(var(--background) / 0.4)',
                }
              : {
                  backgroundColor: 'hsl(var(--primary) / 0.1)',
                  border: '1px solid hsl(var(--primary) / 0.3)',
                }
          }
        >
          {studioLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={studioLogoUrl} alt={studioName} className="w-full h-full object-contain" />
          ) : (
            <span className="text-sm font-bold" style={{ color: 'hsl(var(--primary))' }}>
              {studioName.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: 'hsl(var(--foreground))' }}>
            {studioName}
          </p>
          <p
            className="text-xs flex items-center gap-1.5"
            style={{
              color: adminActivity
                ? 'hsl(var(--primary))'
                : adminOnline
                  ? 'hsl(var(--status-green))'
                  : 'hsl(var(--text-faint))',
            }}
          >
            {!adminActivity && (
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  backgroundColor: adminOnline
                    ? 'hsl(var(--status-green))'
                    : 'hsl(var(--text-faint))',
                }}
              />
            )}
            {adminActivity === 'recording'
              ? 'recording audio…'
              : adminActivity === 'typing'
                ? 'typing…'
                : whereAdmin
                  // WHICH view they are reading, not just that they are here.
                  ? whereAdmin
                  : 'Away'}
          </p>
        </div>
        {totalUnread > 0 && (
          <span
            className="text-xs font-bold px-2 py-0.5 rounded-full"
            style={{
              backgroundColor: 'hsl(var(--primary) / 0.14)',
              color: 'hsl(var(--primary))',
            }}
          >
            {totalUnread} unread
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            const next = !soundOn
            setSoundOn(next)
            setMessageSoundEnabled(next)
            if (next) playTestChime()
          }}
          className="p-2 rounded-lg transition-colors hover:bg-[hsl(var(--border))]"
          style={{ color: soundOn ? 'hsl(var(--primary))' : 'hsl(var(--text-faint))' }}
          title={soundOn ? 'Mute message sound' : 'Unmute message sound'}
        >
          {soundOn ? <Volume2 size={15} /> : <VolumeX size={15} />}
        </button>
        {/* THE room menu — extreme right of the top bar (Batch 16) */}
        <div className="relative" data-tl-keep-open>
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

      {/* ── The one conversation engine, with THE NOTCH over it ──
          The thread tabs live in a single squircle hanging from the header —
          a notch. ONLY the squircle carries a background; everything around
          it is the conversation itself, scrolling underneath. It used to be a
          full-width band that consumed a strip of the page between header and
          chat, which read as chrome and cost the chat that height. */}
      <div
        className="flex-1 min-h-0 rounded-b-2xl border overflow-hidden relative"
        style={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}
      >
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
            {chip('all', 'All', !activeDm && filter.kind === 'all', 0, () => selectFilter({ kind: 'all' }))}
            {projects.map((p) =>
              chip(
                p.id,
                p.title,
                !activeDm && filter.kind === 'project' && filter.projectId === p.id,
                chipUnread.byProject[p.id] ?? 0,
                () => selectFilter({ kind: 'project', projectId: p.id }),
                false,
                projectColor(p.id)
              )
            )}
            {dmRooms.map((dm) =>
              chip(
                dm.id,
                `✉ ${dm.label}`,
                activeDm?.id === dm.id,
                dm.unread,
                () => {
                  setActiveDm(dm)
                  setDmRooms((prev) => prev.map((r) => (r.id === dm.id ? { ...r, unread: 0 } : r)))
                }
              )
            )}
            {dmPeople.length > 0 && (
              <div className="relative flex-shrink-0" data-tl-keep-open>
                <button
                  onClick={() => setDmPickerOpen((v) => !v)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-all duration-150 active:scale-95"
                  style={{
                    backgroundColor: 'transparent',
                    color: 'hsl(var(--primary))',
                    border: '1px dashed hsl(var(--primary) / 0.5)',
                  }}
                  title="Message the studio directly"
                >
                  + Direct
                </button>
                {dmPickerOpen && (
                  <div
                    className="absolute top-8 left-1/2 -translate-x-1/2 z-50 w-56 rounded-xl overflow-hidden shadow-2xl"
                    style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                  >
                    <p className="px-3 pt-2.5 pb-1 text-[9px] font-semibold uppercase tracking-widest"
                      style={{ color: 'hsl(var(--text-faint))' }}>
                      Message the studio
                    </p>
                    {dmPeople.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => void startDm(p.id)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-[hsl(var(--primary)/0.08)]"
                        style={{ color: 'hsl(var(--foreground))' }}
                      >
                        <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                          style={{ backgroundColor: 'hsl(var(--primary) / 0.12)', color: 'hsl(var(--primary))' }}>
                          {p.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block truncate">{p.name}</span>
                          <span className="block text-[9px] uppercase tracking-wide" style={{ color: 'hsl(var(--text-faint))' }}>
                            {p.sub}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        {activeDm ? (
          <RoomThread
            key={activeDm.id}
            role="client"
            clientId={activeDm.id}
            room={{ id: activeDm.id, kind: 'dm', label: activeDm.label }}
            orgId={orgId}
            filter={{ kind: 'all' }}
            currentName={clientName}
            otherName={activeDm.label}
            canSend={activeDm.membership.canPost}
            allowAttachments={false}
            selfFallback
            panelCommand={panelCommand}
            showMenuButton={false}
          />
        ) : (
          <RoomThread
            role="client"
            clientId={clientId}
            orgId={orgId}
            filter={filter}
            currentName={clientName}
            otherName={studioName}
            canSend={canSend}
            externalRow={externalRow}
            onTypingChange={setAdminActivity}
            panelCommand={panelCommand}
            showMenuButton={false}
          />
        )}
      </div>
    </div>
  )
}
