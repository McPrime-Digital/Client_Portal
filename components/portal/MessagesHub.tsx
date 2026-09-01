'use client'

/**
 * The portal Messages hub — Batch 15 item 1. Room-first: a client company
 * has ONE conversation with its studio. The filter chips (All · General ·
 * per-project) are views over that single room — the same code path the
 * project pages use (RoomThread), never a second query shape.
 */

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
import { usePresenceStore, isAdminOnline } from '@/lib/stores/presence-store'
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
  const [externalRow, setExternalRow] = useState<ExternalRow | null>(null)
  const [adminActivity, setAdminActivity] = useState<'typing' | 'recording' | null>(null)
  const [soundOn, setSoundOn] = useState(() => messageSoundEnabled())
  const [roomMenuOpen, setRoomMenuOpen] = useState(false)
  const [panelCommand, setPanelCommand] = useState<{ which: 'pins' | 'saves' | 'settings' | 'people' | 'search'; n: number } | null>(null)

  const online = usePresenceStore((s) => s.online)
  const adminOnline = isAdminOnline(online)
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
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
        (p) => {
          const row = p.new as Message
          if (row.sender_id === ownIdRef.current) return
          setExternalRow({ row, n: Date.now() })
          const f = filterRef.current
          const inActive =
            f.kind === 'all' ||
            (f.kind === 'general' && row.project_id == null) ||
            (f.kind === 'project' && (row.project_id == null || row.project_id === f.projectId))
          if (!inActive) {
            playMessageChime()
            setChipUnread((prev) =>
              row.project_id == null
                ? { ...prev, general: prev.general + 1 }
                : {
                    ...prev,
                    byProject: {
                      ...prev.byProject,
                      [row.project_id]: (prev.byProject[row.project_id] ?? 0) + 1,
                    },
                  }
            )
          }
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [roomId, supabase])

  // Opening a view clears its chip — the read PATCH inside RoomThread does
  // the durable half (the watermark); this is the instant local half.
  const selectFilter = useCallback((f: RoomFilter) => {
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
      style={{
        backgroundColor: active ? 'hsl(var(--primary))' : 'hsl(var(--card))',
        color: active ? 'hsl(var(--primary-foreground))' : 'hsl(var(--foreground))',
        border: active ? '1px solid hsl(var(--primary))' : '1px solid hsl(var(--border))',
        boxShadow: active ? '0 0 12px hsl(var(--primary) / 0.25)' : 'none',
      }}
    >
      {isGeneral && (
        <MessageSquare
          size={10}
          style={{ color: active ? 'hsl(var(--primary-foreground))' : 'hsl(var(--primary))' }}
        />
      )}
      {dotColor && (
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
          className="w-9 h-9 rounded-xl overflow-hidden flex items-center justify-center flex-shrink-0"
          style={{
            backgroundColor: 'hsl(var(--primary) / 0.1)',
            border: '1px solid hsl(var(--primary) / 0.3)',
          }}
        >
          {studioLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={studioLogoUrl} alt={studioName} className="w-full h-full object-cover" />
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
                : adminOnline
                  ? 'Online'
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
        <div className="relative">
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
                ['settings', 'Notification settings'],
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

      {/* ── Filter chips: views over one room ── */}
      <div
        className="flex items-center gap-1.5 px-3.5 py-1.5 border border-b-0 border-t-0 overflow-x-auto scrollbar-thin"
        style={{ backgroundColor: 'hsl(var(--card) / 0.6)', borderColor: 'hsl(var(--border))' }}
      >
        {chip('all', 'All', filter.kind === 'all', 0, () => selectFilter({ kind: 'all' }))}
        {chip(
          'general',
          'General',
          filter.kind === 'general',
          chipUnread.general,
          () => selectFilter({ kind: 'general' }),
          true
        )}
        {projects.map((p) =>
          chip(
            p.id,
            p.title,
            filter.kind === 'project' && filter.projectId === p.id,
            chipUnread.byProject[p.id] ?? 0,
            () => selectFilter({ kind: 'project', projectId: p.id }),
            false,
            projectColor(p.id)
          )
        )}
      </div>

      {/* ── The one conversation engine ── */}
      <div
        className="flex-1 min-h-0 rounded-b-2xl border overflow-hidden"
        style={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}
      >
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
      </div>
    </div>
  )
}
