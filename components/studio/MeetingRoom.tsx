'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  LiveKitRoom, VideoConference, useDataChannel, useRoomContext,
} from '@livekit/components-react'
import '@livekit/components-styles'
import { Loader2 } from 'lucide-react'
import AnnotationLayer from './AnnotationLayer'
import MediaEnhancements from './MediaEnhancements'

/**
 * THE ROOM.
 *
 * `VideoConference` is LiveKit's own prebuilt layout — grid, speaker view,
 * screenshare, device pickers, the lot. Reimplementing that would be a month of
 * work to arrive somewhere worse, and the differentiator in this product was
 * never the tile layout.
 *
 * ── THE DIFFERENTIATOR IS BELOW: EVERYONE ON THE SAME FRAME ──────────────
 *
 * `S3-b` §2.2 (AD-006). In a hybrid production the meeting that matters is three
 * people arguing about one shot, half of which came out of a model. A
 * screenshare gives the other two no control and anchors nothing they say. A
 * synced playhead gives everybody the scrubber.
 *
 * ── SYNC RIDES LIVEKIT'S DATA CHANNEL, NOT SUPABASE REALTIME ─────────────
 *
 * I-2 caps a session at two realtime channels and this app is already at roughly
 * six, so opening a seventh for a playhead would be a stop-and-report (S-R §7).
 * The data channel is already open, already authenticated by the same token, and
 * lower latency than a database round trip.
 *
 * The ROW is still written, throttled, because it is what a LATE JOINER reads —
 * somebody who joins after three seeks lands on the right frame instead of frame
 * zero looking at a different shot from the person talking.
 *
 * ── ECHO SUPPRESSION IS NOT OPTIONAL ─────────────────────────────────────
 *
 * A received seek must not be re-broadcast, or two clients drifting by 200ms
 * ping-pong each other into a seek storm. `applying` is the guard.
 *
 * ── WHAT WAS TAKEN FROM THE STATE OF THE ART, AND WHAT IS BUILT ON TOP ───
 *
 * Syncplay (GPL, studied not copied — this shares no code with it) settled the
 * core insight years ago in its "player command latency compensation": a play
 * command that arrives 180ms late lands 180ms behind, every time, because the
 * sender kept playing while the message was in flight. A naive implementation —
 * which the first draft of this file was — seeks to the number in the message
 * and is therefore permanently late by exactly the network delay.
 *
 * THREE THINGS ARE ADDED ON TOP OF THAT IDEA:
 *
 *   1. A CLOCK-OFFSET HANDSHAKE, because compensation needs the sender's clock
 *      and two browsers do not share one. An NTP-style ping/pong over the data
 *      channel estimates the offset per peer, so `elapsed` is measured against a
 *      corrected clock rather than trusting a raw timestamp from another
 *      machine. Syncplay gets this from its central server; there is no server
 *      here, so the peers work it out between themselves.
 *   2. RATE NUDGING INSTEAD OF SEEKING for small drift. The frame-sync
 *      literature is consistent that adding or removing a few frames a second is
 *      imperceptible while a seek is not, so drift under a quarter second is
 *      corrected by running at 0.97×–1.03× until it is gone. A review session
 *      where the picture hitches every few seconds is worse than one that is
 *      quietly 80ms apart.
 *   3. IT COSTS NO INFRASTRUCTURE. Syncplay needs its own server; this rides a
 *      WebRTC data channel that is already open and already authenticated by the
 *      same LiveKit token, which is also what keeps it inside I-2's channel cap.
 */

type SyncMessage =
  | { t: 'state'; positionMs: number; playing: boolean; at: number }
  | { t: 'ping'; id: string; c0: number }
  | { t: 'pong'; id: string; c0: number; c1: number }

const SYNC_TOPIC = 'gl-review-sync'

/** Under this, do nothing. Chasing noise is what makes playback stutter. */
const DEAD_ZONE_MS = 40
/** Between the dead zone and this, nudge the RATE. Above it, seek — at that
 *  distance a nudge would take minutes to converge and the picture is visibly
 *  wrong anyway. */
const NUDGE_CEILING_MS = 250
/** 3% is inaudible on speech and invisible on picture; 10% is neither. */
const MAX_RATE_TRIM = 0.03

function ReviewPlayer({
  meetingId, fileUrl, fileId, initial, endpoint,
}: {
  meetingId: string
  fileUrl: string
  fileId: string | null
  initial: { positionMs: number; playing: boolean } | null
  endpoint: string
}) {
  const video = useRef<HTMLVideoElement | null>(null)
  const applying = useRef(false)
  const lastPersist = useRef(0)
  /** Estimated clock offset per peer identity: peerClock - myClock, in ms. */
  const offsets = useRef<Map<string, number>>(new Map())
  const pending = useRef<Map<string, number>>(new Map())
  const room = useRoomContext()

  const send = useCallback((msg: SyncMessage) => {
    void room.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify(msg)),
      { reliable: true, topic: SYNC_TOPIC },
    )
  }, [room])

  const persist = useCallback((positionMs: number, playing: boolean) => {
    const now = Date.now()
    // The durable row is for LATE JOINERS, so a couple of seconds is plenty —
    // a write per scrub tick would be hundreds of rows a minute for a value
    // only one person ever reads, once.
    if (now - lastPersist.current < 2000) return
    lastPersist.current = now
    void fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sync', meetingId, positionMs, playing }),
    }).catch(() => { /* the live channel already carried it; the row catches up */ })
  }, [meetingId, endpoint])

  const broadcast = useCallback((positionMs: number, playing: boolean) => {
    if (applying.current) return
    send({ t: 'state', positionMs, playing, at: Date.now() })
    persist(positionMs, playing)
  }, [send, persist])

  // ── the clock-offset handshake ────────────────────────────────────────────
  // Without this, `elapsed` is computed against another machine's wall clock,
  // and browsers routinely disagree by seconds. One exchange per peer is enough
  // for a review session; drift over an hour is far below the dead zone.
  useEffect(() => {
    const id = Math.random().toString(36).slice(2)
    const c0 = Date.now()
    pending.current.set(id, c0)
    send({ t: 'ping', id, c0 })
  }, [send])

  useDataChannel(SYNC_TOPIC, (msg) => {
    let data: SyncMessage
    try {
      data = JSON.parse(new TextDecoder().decode(msg.payload)) as SyncMessage
    } catch { return }

    const from = msg.from?.identity
    if (!from) return

    if (data.t === 'ping') {
      send({ t: 'pong', id: data.id, c0: data.c0, c1: Date.now() })
      return
    }

    if (data.t === 'pong') {
      const sentAt = pending.current.get(data.id)
      if (sentAt === undefined) return
      pending.current.delete(data.id)
      // NTP's estimator: half the round trip is the one-way delay, so the peer's
      // clock at c1 corresponds to (c0 + rtt/2) on mine.
      const rtt = Date.now() - sentAt
      offsets.current.set(from, data.c1 - (sentAt + rtt / 2))
      return
    }

    const el = video.current
    if (!el) return

    // LATENCY COMPENSATION. The sender kept playing while this was in flight,
    // so the target is where they are NOW, not where they were when they sent.
    const offset = offsets.current.get(from) ?? 0
    const sentAtMine = data.at - offset
    const elapsed = data.playing ? Math.max(0, Date.now() - sentAtMine) : 0
    const targetSec = (data.positionMs + elapsed) / 1000

    applying.current = true
    const driftMs = (el.currentTime - targetSec) * 1000
    const absDrift = Math.abs(driftMs)

    if (absDrift > NUDGE_CEILING_MS) {
      // Too far to nudge: a 3% trim would take a minute to close a second.
      el.currentTime = targetSec
      el.playbackRate = 1
    } else if (absDrift > DEAD_ZONE_MS && data.playing) {
      // Imperceptible correction — run slightly slow or fast until it is gone,
      // rather than hitching the picture with a seek.
      const trim = Math.min(MAX_RATE_TRIM, absDrift / 8000)
      el.playbackRate = driftMs > 0 ? 1 - trim : 1 + trim
    } else {
      el.playbackRate = 1
    }

    if (data.playing && el.paused) void el.play().catch(() => {})
    if (!data.playing && !el.paused) el.pause()
    setTimeout(() => { applying.current = false }, 0)
  })

  // Stop nudging once the drift is closed. Without this the trim persists and
  // the two clients slowly swap which one is ahead.
  useEffect(() => {
    const el = video.current
    if (!el) return
    const t = setInterval(() => {
      if (!applying.current && el.playbackRate !== 1 && !el.paused) {
        el.playbackRate = 1
      }
    }, 3000)
    return () => clearInterval(t)
  }, [])

  // Land a late joiner on the frame everybody else is on.
  useEffect(() => {
    const el = video.current
    if (!el || !initial) return
    const onReady = () => {
      el.currentTime = initial.positionMs / 1000
      if (initial.playing) void el.play().catch(() => {})
    }
    if (el.readyState >= 1) onReady()
    else el.addEventListener('loadedmetadata', onReady, { once: true })
  }, [initial])

  return (
    <div className="mb-3">
      <div className="squircle relative overflow-hidden bg-black">
        <video
          ref={video}
          src={fileUrl}
          controls
          playsInline
          className="block w-full bg-black"
          onPlay={(e) => broadcast(e.currentTarget.currentTime * 1000, true)}
          onPause={(e) => broadcast(e.currentTarget.currentTime * 1000, false)}
          onSeeked={(e) => broadcast(e.currentTarget.currentTime * 1000, !e.currentTarget.paused)}
        />
        <AnnotationLayer meetingId={meetingId} fileId={fileId} video={video} endpoint={endpoint} />
      </div>
      <p className="mt-1.5 text-[11px] text-faint">
        Everyone in this room is on the same frame. Play, pause and scrub are shared,
        and small drift is corrected by running fractionally slow rather than jumping.
      </p>
    </div>
  )
}

export default function MeetingRoom({
  meetingId, mode, fileUrl, fileId, endpoint = '/api/studio/meetings',
}: {
  meetingId: string
  mode: 'call' | 'review_session'
  fileUrl: string | null
  fileId: string | null
  /** '/api/meet' for a PARTICIPANT of any kind — client member, external
   *  collaborator, or crew joining as one. The two routes differ only in what
   *  they REFUSE: create, end, cancel and record exist on the studio route
   *  alone, so the room does not need to know which side it is on. */
  endpoint?: string
}) {
  const router = useRouter()
  const [conn, setConn] = useState<
    { token: string; url: string; sync: { position_ms: number; playing: boolean } | null } | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const join = useCallback(async () => {
    setBusy(true); setError(null)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join', meetingId }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(j?.error ?? 'Could not join.'); return }
      setConn({ token: j.token, url: j.url, sync: j.sync })
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }, [meetingId, endpoint])

  // Closing the span is what meters the minute, so it must survive a tab close
  // as well as a click. `sendBeacon` is the only thing that reliably runs then.
  const leave = useCallback(() => {
    const body = JSON.stringify({ action: 'leave', meetingId })
    try {
      navigator.sendBeacon?.(endpoint, new Blob([body], { type: 'application/json' }))
    } catch {
      void fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true,
      }).catch(() => {})
    }
  }, [meetingId, endpoint])

  useEffect(() => {
    if (!conn) return
    window.addEventListener('pagehide', leave)
    return () => { window.removeEventListener('pagehide', leave) }
  }, [conn, leave])

  if (!conn) {
    return (
      <div className="squircle border border-border bg-card p-6 text-center">
        <button
          type="button" onClick={() => void join()} disabled={busy}
          className="squircle-sm inline-flex items-center gap-2 bg-primary px-5 py-2.5 text-[14px] font-semibold text-primary-foreground outline-none transition-[opacity,transform] duration-[--dur-pop] ease-[--ease-out] hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] disabled:opacity-40"
        >
          {busy && <Loader2 size={15} className="animate-spin" />}
          Join {mode === 'review_session' ? 'review session' : 'meeting'}
        </button>
        {error && <p role="status" className="mt-3 text-[13px] text-destructive">{error}</p>}
      </div>
    )
  }

  return (
    <LiveKitRoom
      token={conn.token}
      serverUrl={conn.url}
      connect
      video
      audio
      onDisconnected={() => { leave(); setConn(null); router.refresh() }}
      data-lk-theme="default"
      style={{ borderRadius: '1rem', overflow: 'hidden' }}
    >
      {mode === 'review_session' && fileUrl && (
        <ReviewPlayer
          meetingId={meetingId}
          fileUrl={fileUrl}
          fileId={fileId}
          endpoint={endpoint}
          initial={conn.sync ? { positionMs: conn.sync.position_ms, playing: conn.sync.playing } : null}
        />
      )}
      <MediaEnhancements />
      <div style={{ height: mode === 'review_session' ? '44vh' : '70vh' }}>
        <VideoConference />
      </div>
    </LiveKitRoom>
  )
}
