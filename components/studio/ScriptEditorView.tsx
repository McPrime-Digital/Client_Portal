'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import * as Y from 'yjs'
import { ArrowLeft, Check, Loader2, Sparkle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { SupabaseYjsProvider, toB64, fromB64 } from '@/lib/collab/supabaseYjs'
import CollabEditor from './CollabEditor'

const COLORS = ['#C8A24A', '#6366f1', '#0ea5a3', '#d97706', '#db2777', '#65a30d']
function pickColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return COLORS[h % COLORS.length]
}

function Presence({ provider }: { provider: SupabaseYjsProvider }) {
  const [peers, setPeers] = useState<{ name: string; color: string }[]>([])
  useEffect(() => {
    const aw = provider.awareness
    const update = () => {
      const seen = new Map<string, { name: string; color: string }>()
      aw.getStates().forEach((s) => {
        const u = (s as { user?: { name?: string; color?: string } }).user
        if (u?.name) seen.set(u.name + (u.color ?? ''), { name: u.name, color: u.color ?? '#888' })
      })
      setPeers(Array.from(seen.values()))
    }
    aw.on('change', update)
    update()
    return () => aw.off('change', update)
  }, [provider])

  if (peers.length === 0) return null
  return (
    <div className="flex items-center -space-x-2" title={peers.map((p) => p.name).join(', ')}>
      {peers.slice(0, 6).map((p, i) => (
        <span
          key={i}
          className="grid h-7 w-7 place-items-center rounded-full border-2 border-card text-[10px] font-bold text-white"
          style={{ backgroundColor: p.color }}
        >
          {p.name.slice(0, 1).toUpperCase()}
        </span>
      ))}
    </div>
  )
}

type Ready = { userName: string; ydoc: Y.Doc; provider: SupabaseYjsProvider }

export default function ScriptEditorView({ docId }: { docId: string }) {
  const supabase = useMemo(() => createClient(), [])
  const [ready, setReady] = useState<Ready | null>(null)
  const [error, setError] = useState('')
  const [title, setTitle] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const cleanup = useRef<() => void>(() => {})

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        const userName =
          (user?.user_metadata?.name as string | undefined) ?? user?.email?.split('@')[0] ?? 'Guest'

        const { data: doc, error: selErr } = await supabase
          .from('documents')
          .select('id, title, ydoc')
          .eq('id', docId)
          .single()
        if (selErr) throw selErr
        if (cancelled || !doc) return

        const ydoc = new Y.Doc()
        if (doc.ydoc) {
          try {
            Y.applyUpdate(ydoc, fromB64(doc.ydoc))
          } catch {
            /* empty/corrupt — start fresh */
          }
        }
        const provider = new SupabaseYjsProvider(supabase, doc.id, ydoc, {
          name: userName,
          color: pickColor(userName),
        })

        // Durable persistence: debounced on edits, AND flushed on unmount / tab close.
        const persist = () =>
          supabase
            .from('documents')
            .update({ ydoc: toB64(Y.encodeStateAsUpdate(ydoc)), updated_at: new Date().toISOString() })
            .eq('id', doc.id)

        let t: ReturnType<typeof setTimeout>
        const save = () => {
          setSaveState('saving')
          clearTimeout(t)
          t = setTimeout(async () => {
            await persist()
            if (!cancelled) setSaveState('saved')
          }, 1000)
        }
        ydoc.on('update', save)
        const onBeforeUnload = () => {
          void persist()
        }
        window.addEventListener('beforeunload', onBeforeUnload)

        cleanup.current = () => {
          ydoc.off('update', save)
          clearTimeout(t)
          void persist() // flush the latest state when leaving the editor
          window.removeEventListener('beforeunload', onBeforeUnload)
          provider.destroy()
        }

        if (!cancelled) {
          setTitle(doc.title ?? 'Untitled')
          setReady({ userName, ydoc, provider })
        }
      } catch (e) {
        const msg = (e as { message?: string } | null)?.message ?? 'Failed to open document'
        if (!cancelled) setError(msg)
      }
    })()
    return () => {
      cancelled = true
      cleanup.current()
    }
  }, [supabase, docId])

  // Persist the title (debounced).
  useEffect(() => {
    if (!ready) return
    const t = setTimeout(() => {
      void supabase
        .from('documents')
        .update({ title: title.trim() || 'Untitled', updated_at: new Date().toISOString() })
        .eq('id', docId)
    }, 700)
    return () => clearTimeout(t)
  }, [title, ready, supabase, docId])

  return (
    <div className="flex h-full flex-col">
      <Link
        href="/studio/workspace/script"
        className="mb-2 inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft size={15} /> All documents
      </Link>

      <div className="mb-4 flex items-center gap-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled"
          aria-label="Document title"
          className="min-w-0 flex-1 bg-transparent font-display text-2xl font-semibold text-foreground outline-none placeholder:text-faint"
        />
        <div className="flex flex-shrink-0 items-center gap-4">
          {ready && <Presence provider={ready.provider} />}
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            {saveState === 'saving' ? (
              <>
                <Loader2 size={13} className="animate-spin" /> Saving…
              </>
            ) : saveState === 'saved' ? (
              <>
                <Check size={13} style={{ color: 'hsl(var(--status-green))' }} /> Saved
              </>
            ) : (
              <>
                <Sparkle size={13} className="text-primary" /> Live · Co-Direction
              </>
            )}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto rounded-2xl border border-border bg-white shadow-sm dark:bg-[#0a1430]">
        {error && (
          <div className="m-8 rounded-xl border border-destructive/40 p-4 text-sm text-destructive">
            Couldn’t open: {error}
          </div>
        )}
        {!error && !ready && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Loader2 size={18} className="mr-2 animate-spin" /> Opening document…
          </div>
        )}
        {ready && <CollabEditor ydoc={ready.ydoc} provider={ready.provider} userName={ready.userName} />}
      </div>
    </div>
  )
}
