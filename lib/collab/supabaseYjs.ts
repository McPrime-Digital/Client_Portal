import * as Y from 'yjs'
import {
  Awareness,
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness'
import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js'

export function toB64(u: Uint8Array): string {
  let s = ''
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i])
  return btoa(s)
}
export function fromB64(s: string): Uint8Array {
  const bin = atob(s)
  const u = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  return u
}

// Minimal Yjs sync provider over Supabase Realtime broadcast. Yjs is local-first,
// so edits apply instantly and this just fans them out to peers on a per-doc channel;
// awareness carries live cursors/presence (Co-Direction).
//
// SWAPPABLE: the editor only needs `.awareness` + a shared, synced Y.Doc — so this
// can be replaced by a Liveblocks/Hocuspocus provider later with no editor changes.
export class SupabaseYjsProvider {
  readonly awareness: Awareness
  readonly userColor: string
  private channel: RealtimeChannel
  private doc: Y.Doc
  private onDocUpdate: (update: Uint8Array, origin: unknown) => void
  private onAwareness: (changes: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => void

  constructor(
    supabase: SupabaseClient,
    docId: string,
    doc: Y.Doc,
    user: { name: string; color: string },
  ) {
    this.doc = doc
    this.userColor = user.color
    this.awareness = new Awareness(doc)
    this.awareness.setLocalStateField('user', user)

    this.channel = supabase.channel(`doc:${docId}`, { config: { broadcast: { self: false } } })

    // broadcast local doc edits immediately (skip echoes of applied remote updates)
    this.onDocUpdate = (update, origin) => {
      if (origin === this) return
      this.channel.send({ type: 'broadcast', event: 'yjs', payload: { u: toB64(update) } })
    }
    doc.on('update', this.onDocUpdate)

    // broadcast only LOCAL awareness changes (not remote ones we just applied)
    this.onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === this) return
      const changed = added.concat(updated, removed)
      this.channel.send({ type: 'broadcast', event: 'awareness', payload: { u: toB64(encodeAwarenessUpdate(this.awareness, changed)) } })
    }
    this.awareness.on('update', this.onAwareness)

    const sendFullState = () => {
      this.channel.send({ type: 'broadcast', event: 'yjs', payload: { u: toB64(Y.encodeStateAsUpdate(this.doc)) } })
      const ids = Array.from(this.awareness.getStates().keys())
      if (ids.length) {
        this.channel.send({ type: 'broadcast', event: 'awareness', payload: { u: toB64(encodeAwarenessUpdate(this.awareness, ids)) } })
      }
    }

    this.channel
      .on('broadcast', { event: 'yjs' }, ({ payload }) => {
        Y.applyUpdate(this.doc, fromB64((payload as { u: string }).u), this)
      })
      .on('broadcast', { event: 'awareness' }, ({ payload }) => {
        applyAwarenessUpdate(this.awareness, fromB64((payload as { u: string }).u), this)
      })
      // a peer just joined and asked everyone for their current state → answer
      .on('broadcast', { event: 'sync-request' }, () => sendFullState())
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // push our state to existing peers AND ask them for theirs, so a late
          // joiner converges instantly (not only after the next keystroke)
          sendFullState()
          this.channel.send({ type: 'broadcast', event: 'sync-request', payload: {} })
        }
      })
  }

  destroy() {
    this.doc.off('update', this.onDocUpdate)
    this.awareness.off('update', this.onAwareness)
    removeAwarenessStates(this.awareness, [this.doc.clientID], 'destroy')
    this.channel.unsubscribe()
  }
}
