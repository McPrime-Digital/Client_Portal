'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, RotateCcw, Trash2, Send, AtSign, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseYjsProvider } from '@/lib/collab/supabaseYjs'

type Comment = {
  id: string
  body: string
  author_name: string | null
  mentions: string[]
  resolved: boolean
  created_at: string
  anchor_id: string | null
}

const MENTION_RE = /@([\p{L}\p{N}_.\-]+)/gu

function rel(ts: string): string {
  const d = (Date.now() - new Date(ts).getTime()) / 1000
  if (d < 60) return 'just now'
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`
  if (d < 604800) return `${Math.floor(d / 86400)}d ago`
  return new Date(ts).toLocaleDateString()
}

function renderBody(text: string) {
  return text.split(/(@[\p{L}\p{N}_.\-]+)/gu).map((part, i) =>
    part.startsWith('@') ? (
      <span key={i} className="font-medium text-primary">{part}</span>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}

// Threaded comment panel for one document tab. Live via Postgres changes.
// @mentions are picked from current collaborators (Yjs awareness) and parsed
// out of the body into mentions[].
export default function DocComments({
  docId,
  tabKey,
  userName,
  provider,
  isLight,
  onClose,
  pendingAnchor,
  onAnchorUsed,
  onRemoveAnchor,
  onJumpAnchor,
}: {
  docId: string
  tabKey: string
  userName: string
  provider: SupabaseYjsProvider
  isLight: boolean
  onClose: () => void
  pendingAnchor?: string | null
  onAnchorUsed?: () => void
  onRemoveAnchor?: (anchorId: string) => void
  onJumpAnchor?: (anchorId: string) => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const [comments, setComments] = useState<Comment[] | null>(null)
  const [body, setBody] = useState('')
  const [showResolved, setShowResolved] = useState(false)
  const [peers, setPeers] = useState<string[]>([])
  const [pickMention, setPickMention] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // collaborators available to @mention (from live awareness)
  useEffect(() => {
    const aw = provider.awareness
    const update = () => {
      const names = new Set<string>()
      aw.getStates().forEach((s) => {
        const u = (s as { user?: { name?: string } }).user
        if (u?.name) names.add(u.name)
      })
      names.add(userName)
      setPeers(Array.from(names))
    }
    aw.on('change', update)
    update()
    return () => aw.off('change', update)
  }, [provider, userName])

  const load = useMemo(
    () => async () => {
      const { data } = await supabase
        .from('document_comments')
        .select('id, body, author_name, mentions, resolved, created_at, anchor_id')
        .eq('document_id', docId)
        .eq('tab_key', tabKey)
        .order('created_at', { ascending: true })
      setComments((data as Comment[] | null) ?? [])
    },
    [supabase, docId, tabKey],
  )

  useEffect(() => {
    void load()
    const ch = supabase
      .channel(`comments:${docId}:${tabKey}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'document_comments', filter: `document_id=eq.${docId}` },
        () => void load(),
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [supabase, docId, tabKey, load])

  const send = async () => {
    const text = body.trim()
    if (!text) return
    const mentions = Array.from(new Set(Array.from(text.matchAll(MENTION_RE), (m) => m[1])))
    setBody('')
    await supabase.from('document_comments').insert({
      document_id: docId,
      tab_key: tabKey,
      body: text,
      author_name: userName,
      mentions,
      anchor_id: pendingAnchor ?? null,
    })
    if (pendingAnchor) onAnchorUsed?.()
    void load()
  }
  const toggleResolved = async (c: Comment) => {
    const next = !c.resolved
    await supabase.from('document_comments').update({ resolved: next }).eq('id', c.id)
    if (next && c.anchor_id) onRemoveAnchor?.(c.anchor_id) // resolving clears the highlight
    void load()
  }
  const del = async (c: Comment) => {
    await supabase.from('document_comments').delete().eq('id', c.id)
    if (c.anchor_id) onRemoveAnchor?.(c.anchor_id)
    void load()
  }
  const insertMention = (name: string) => {
    setBody((b) => `${b}${b && !b.endsWith(' ') ? ' ' : ''}@${name} `)
    setPickMention(false)
    taRef.current?.focus()
  }

  const muted = isLight ? 'text-gray-400' : 'text-gray-500'
  const visible = (comments ?? []).filter((c) => showResolved || !c.resolved)
  const openCount = (comments ?? []).filter((c) => !c.resolved).length

  return (
    <aside className={`flex w-72 flex-shrink-0 flex-col border-l ${isLight ? 'border-black/10' : 'border-white/10'}`}>
      <div className="flex items-center justify-between px-3 py-2.5">
        <p className={`text-[10px] font-semibold uppercase tracking-widest ${muted}`}>
          Comments {openCount > 0 && <span className="text-primary">· {openCount} open</span>}
        </p>
        <button onClick={onClose} className={`grid h-7 w-7 place-items-center rounded-md ${isLight ? 'text-gray-500 hover:bg-black/5' : 'text-gray-300 hover:bg-white/10'}`} title="Close">
          <X size={14} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3">
        {comments === null ? (
          <p className={`py-2 text-xs ${muted}`}>Loading…</p>
        ) : visible.length === 0 ? (
          <p className={`py-2 text-xs ${muted}`}>No comments yet. Start the discussion below.</p>
        ) : (
          <ul className="space-y-2 pb-2">
            {visible.map((c) => (
              <li
                key={c.id}
                className={`rounded-xl border p-2.5 ${
                  c.resolved
                    ? isLight ? 'border-black/5 opacity-60' : 'border-white/5 opacity-60'
                    : isLight ? 'border-black/10 bg-black/[0.02]' : 'border-white/10 bg-white/[0.03]'
                }`}
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-primary/20 text-[9px] font-bold text-primary">
                    {(c.author_name ?? '?').slice(0, 1).toUpperCase()}
                  </span>
                  <span className={`truncate text-xs font-semibold ${isLight ? 'text-gray-700' : 'text-gray-200'}`}>
                    {c.author_name ?? 'Someone'}
                  </span>
                  {c.anchor_id && !c.resolved && (
                    <button onClick={() => onJumpAnchor?.(c.anchor_id!)} title="Jump to highlighted text" className="rounded bg-amber-400/20 px-1 text-[9px] font-semibold text-amber-600 hover:bg-amber-400/30">text</button>
                  )}
                  <span className={`ml-auto text-[10px] ${muted}`}>{rel(c.created_at)}</span>
                </div>
                <p className={`whitespace-pre-wrap break-words text-[13px] leading-snug ${isLight ? 'text-gray-700' : 'text-gray-200'}`}>
                  {renderBody(c.body)}
                </p>
                <div className="mt-1.5 flex items-center gap-3">
                  <button
                    onClick={() => toggleResolved(c)}
                    className={`inline-flex items-center gap-1 text-[11px] font-medium ${c.resolved ? muted : 'text-primary'} hover:underline`}
                  >
                    {c.resolved ? <><RotateCcw size={11} /> Reopen</> : <><Check size={11} /> Resolve</>}
                  </button>
                  <button onClick={() => del(c)} className={`inline-flex items-center gap-1 text-[11px] ${muted} hover:text-destructive`}>
                    <Trash2 size={11} /> Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* composer */}
      <div className={`relative border-t p-2.5 ${isLight ? 'border-black/10' : 'border-white/10'}`}>
        {pendingAnchor && (
          <div className="mb-1.5 flex items-center gap-1.5 rounded-md bg-amber-400/15 px-2 py-1 text-[11px] font-medium text-amber-600">
            <span className="h-2 w-2 rounded-full bg-amber-400" /> Commenting on the selected text
          </div>
        )}
        {pickMention && peers.length > 0 && (
          <div className={`absolute bottom-full left-2.5 mb-1 w-40 overflow-hidden rounded-lg border shadow-lg ${isLight ? 'border-black/10 bg-white' : 'border-white/10 bg-[#0f1c3f]'}`}>
            {peers.map((p) => (
              <button
                key={p}
                onClick={() => insertMention(p)}
                className={`block w-full truncate px-3 py-1.5 text-left text-xs ${isLight ? 'text-gray-700 hover:bg-black/5' : 'text-gray-200 hover:bg-white/10'}`}
              >
                @{p}
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={taRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void send()
            }
          }}
          rows={2}
          placeholder="Comment… (⌘↵ to send)"
          className={`w-full resize-none rounded-lg border px-2.5 py-1.5 text-sm outline-none ${
            isLight ? 'border-black/10 bg-white text-gray-800 placeholder:text-gray-400' : 'border-white/10 bg-white/5 text-gray-100 placeholder:text-gray-500'
          }`}
        />
        <div className="mt-1.5 flex items-center gap-2">
          <button
            onClick={() => setPickMention((s) => !s)}
            title="Mention a collaborator"
            className={`grid h-7 w-7 place-items-center rounded-md ${isLight ? 'text-gray-500 hover:bg-black/5' : 'text-gray-300 hover:bg-white/10'}`}
          >
            <AtSign size={14} />
          </button>
          <label className={`ml-auto flex items-center gap-1.5 text-[11px] ${muted}`}>
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} className="accent-[hsl(var(--primary))]" />
            Show resolved
          </label>
          <button
            onClick={send}
            disabled={!body.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Send size={13} /> Send
          </button>
        </div>
      </div>
    </aside>
  )
}
