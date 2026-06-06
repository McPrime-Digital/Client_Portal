'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'
import { NotebookPen } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { SupabaseYjsProvider, toB64, fromB64 } from '@/lib/collab/supabaseYjs'
import CollabEditor from './CollabEditor'

const COLORS = ['#C8A24A', '#6366f1', '#0ea5a3', '#d97706', '#db2777', '#65a30d']
function pickColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return COLORS[h % COLORS.length]
}

type Ready = { docId: string; userName: string; ydoc: Y.Doc; provider: SupabaseYjsProvider }

export default function ScriptDesign() {
  const supabase = useMemo(() => createClient(), [])
  const [ready, setReady] = useState<Ready | null>(null)
  const [error, setError] = useState('')
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

        // fetch-or-create the org's default script doc (multi-doc list comes next increment)
        const sel = await supabase
          .from('documents')
          .select('id, ydoc')
          .eq('kind', 'script')
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()
        if (sel.error) throw sel.error
        let doc = sel.data
        if (!doc) {
          const { data: created, error: insErr } = await supabase
            .from('documents')
            .insert({ kind: 'script', title: 'Concept & Script' })
            .select('id, ydoc')
            .single()
          if (insErr) throw insErr
          doc = created
        }
        if (cancelled || !doc) return

        const ydoc = new Y.Doc()
        if (doc.ydoc) {
          try {
            Y.applyUpdate(ydoc, fromB64(doc.ydoc))
          } catch {
            /* corrupt/empty snapshot — start fresh */
          }
        }
        const provider = new SupabaseYjsProvider(supabase, doc.id, ydoc, {
          name: userName,
          color: pickColor(userName),
        })

        let t: ReturnType<typeof setTimeout>
        const save = () => {
          clearTimeout(t)
          t = setTimeout(() => {
            void supabase
              .from('documents')
              .update({ ydoc: toB64(Y.encodeStateAsUpdate(ydoc)), updated_at: new Date().toISOString() })
              .eq('id', doc!.id)
          }, 1200)
        }
        ydoc.on('update', save)
        cleanup.current = () => {
          ydoc.off('update', save)
          provider.destroy()
        }

        if (!cancelled) setReady({ docId: doc.id, userName, ydoc, provider })
      } catch (e) {
        const msg = (e as { message?: string } | null)?.message ?? 'Failed to open Script Design'
        if (!cancelled) setError(msg)
      }
    })()
    return () => {
      cancelled = true
      cleanup.current()
    }
  }, [supabase])

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5 flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-primary">
          <NotebookPen size={18} />
        </div>
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">Script Design</h1>
          <p className="text-xs text-muted-foreground">
            Concept · narrative · script — live with your crew. Open this in two tabs to watch Co-Direction.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/40 bg-card p-4 text-sm text-destructive">
          Couldn’t open: {error}. (Has <code>0004_documents.sql</code> been run on throughline-dev?)
        </div>
      )}
      {!error && !ready && (
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          Opening Script Design…
        </div>
      )}
      {ready && (
        <div className="rounded-xl border border-border bg-card p-2">
          <CollabEditor ydoc={ready.ydoc} provider={ready.provider} userName={ready.userName} />
        </div>
      )}
    </div>
  )
}
