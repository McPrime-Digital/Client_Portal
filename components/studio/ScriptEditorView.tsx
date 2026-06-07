'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import * as Y from 'yjs'
import { ArrowLeft, Loader2, Sun, Moon, Plus, X, Share2, Copy, Check, Link2, Save, FileText } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { SupabaseYjsProvider, toB64, fromB64 } from '@/lib/collab/supabaseYjs'
import DocEditor from './DocEditor'

const COLORS = ['#C8A24A', '#6366f1', '#0ea5a3', '#d97706', '#db2777', '#65a30d']
function pickColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return COLORS[h % COLORS.length]
}

// A tab maps to a Y.Doc fragment. The original content lives under 'blocknote',
// so the first tab ('main') points there for backward compatibility.
function fragmentKeyFor(tabId: string): string {
  return tabId === 'main' ? 'blocknote' : `tab-${tabId}`
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

type Tab = { id: string; name: string }
type Ready = { userName: string; ydoc: Y.Doc; provider: SupabaseYjsProvider }

export default function ScriptEditorView({ docId, template }: { docId: string; template?: string }) {
  const supabase = useMemo(() => createClient(), [])
  const [ready, setReady] = useState<Ready | null>(null)
  const [error, setError] = useState('')
  const [title, setTitle] = useState('')
  const [docTheme, setDocTheme] = useState<'light' | 'dark'>('light')
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTab, setActiveTab] = useState('main')
  const [editingTab, setEditingTab] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [shareOpen, setShareOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const cleanup = useRef<() => void>(() => {})
  const firstLines = useRef<Record<string, string>>({}) // latest first line per tab
  const prevTab = useRef('main')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const saveNow = useRef<() => void>(() => {})

  // Per-document theme (independent of the app theme), remembered per doc.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`tl-doctheme-${docId}`)
      if (saved === 'light' || saved === 'dark') setDocTheme(saved)
    } catch {
      /* ignore */
    }
  }, [docId])
  function toggleDocTheme() {
    setDocTheme((prev) => {
      const next = prev === 'light' ? 'dark' : 'light'
      try {
        localStorage.setItem(`tl-doctheme-${docId}`, next)
      } catch {
        /* ignore */
      }
      return next
    })
  }

  // Load the document + set up the collaborative session with durable persistence.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // fetch session + doc in parallel (cut the open-time waterfall)
        const [{ data: { user } }, { data: doc, error: selErr }] = await Promise.all([
          supabase.auth.getUser(),
          supabase.from('documents').select('id, title, ydoc').eq('id', docId).single(),
        ])
        const userName =
          (user?.user_metadata?.name as string | undefined) ?? user?.email?.split('@')[0] ?? 'Guest'
        if (selErr) throw selErr
        if (cancelled || !doc) return
        // record the open (distinct from edit time) — fire and forget
        void supabase.from('documents').update({ last_opened_at: new Date().toISOString() }).eq('id', docId)

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

        const persist = () =>
          supabase
            .from('documents')
            .update({ ydoc: toB64(Y.encodeStateAsUpdate(ydoc)), updated_at: new Date().toISOString() })
            .eq('id', doc.id)

        // Always-on autosave — persist on idle, on manual save, and on exit. No
        // conditional skipping or deletion (that dropped new docs + tabs).
        let t: ReturnType<typeof setTimeout>
        const doPersist = async () => {
          setSaveState('saving')
          await persist()
          if (!cancelled) setSaveState('saved')
        }
        const save = () => {
          clearTimeout(t)
          t = setTimeout(() => {
            void doPersist()
          }, 500)
        }
        ydoc.on('update', save)
        saveNow.current = () => {
          clearTimeout(t)
          void doPersist()
        }
        const onBeforeUnload = () => {
          void persist()
        }
        window.addEventListener('beforeunload', onBeforeUnload)

        cleanup.current = () => {
          ydoc.off('update', save)
          clearTimeout(t)
          void persist()
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

  // Document tabs — a Y.Array of {id,name}, synced across collaborators.
  useEffect(() => {
    if (!ready) return
    const yTabs = ready.ydoc.getArray<Y.Map<string>>('tabs')
    const sync = () => {
      if (yTabs.length === 0) {
        ready.ydoc.transact(() => {
          const m = new Y.Map<string>()
          m.set('id', 'main')
          m.set('name', 'Tab 1')
          yTabs.push([m])
        })
        return
      }
      const list = yTabs.toArray().map((m) => ({ id: m.get('id') as string, name: (m.get('name') as string) || 'Untitled' }))
      setTabs(list)
      setActiveTab((prev) => (list.some((x) => x.id === prev) ? prev : list[0].id))
    }
    yTabs.observeDeep(sync)
    sync()
    return () => yTabs.unobserveDeep(sync)
  }, [ready])

  function yTabsArray() {
    return ready?.ydoc.getArray<Y.Map<string>>('tabs')
  }
  function addTab() {
    const arr = yTabsArray()
    if (!arr) return
    const id = crypto.randomUUID()
    const m = new Y.Map<string>()
    m.set('id', id)
    m.set('name', `Tab ${arr.length + 1}`)
    arr.push([m])
    setActiveTab(id)
  }
  function commitRename(id: string) {
    const arr = yTabsArray()
    if (arr) {
      const idx = arr.toArray().findIndex((m) => m.get('id') === id)
      if (idx >= 0) arr.get(idx).set('name', editName.trim() || 'Untitled')
    }
    setEditingTab(null)
  }
  function deleteTab(id: string) {
    const arr = yTabsArray()
    if (!arr || arr.length <= 1) return
    const idx = arr.toArray().findIndex((m) => m.get('id') === id)
    if (idx >= 0) arr.delete(idx, 1)
    if (activeTab === id) setActiveTab('main')
  }

  // Auto-name a tab from its first line — live as you type, unless manually renamed.
  function autoNameTab(id: string) {
    const arr = yTabsArray()
    if (!arr) return
    const idx = arr.toArray().findIndex((m) => m.get('id') === id)
    if (idx < 0) return
    const current = (arr.get(idx).get('name') as string) || ''
    const isDefault = current === '' || current === 'Untitled' || /^Tab \d+$/.test(current)
    const line = (firstLines.current[id] || '').trim()
    const next = line ? line.slice(0, 32) : ''
    if (isDefault && next && next !== current) arr.get(idx).set('name', next)
  }
  // When the active tab changes, auto-name the one we just left too.
  useEffect(() => {
    if (prevTab.current !== activeTab) {
      autoNameTab(prevTab.current)
      prevTab.current = activeTab
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  // Persist the title (debounced).
  useEffect(() => {
    if (!ready) return
    const t = setTimeout(() => {
      void supabase
        .from('documents')
        .update({ title: title.trim() || 'Untitled', updated_at: new Date().toISOString() })
        .eq('id', docId)
    }, 600)
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

      <div className="mb-4 flex items-center gap-3">
        <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg bg-[#4285F4]/10" title="Document">
          <FileText size={20} className="text-[#4285F4]" />
        </div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled"
          aria-label="Document title"
          className="min-w-0 flex-1 bg-transparent font-display text-2xl font-semibold text-foreground outline-none placeholder:text-faint"
        />
        <div className="flex flex-shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={toggleDocTheme}
            title="Page light / dark (this document only)"
            className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            {docTheme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
          </button>
          {ready && <Presence provider={ready.provider} />}
          <button
            type="button"
            onClick={() => saveNow.current()}
            title="Save now (also autosaves)"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            {saveState === 'saving' ? (
              <><Loader2 size={13} className="animate-spin" /> Saving…</>
            ) : saveState === 'saved' ? (
              <><Check size={13} style={{ color: 'hsl(var(--status-green))' }} /> Saved</>
            ) : (
              <><Save size={13} /> Save</>
            )}
          </button>
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Share2 size={14} /> Share
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        {/* document tabs (left rail) */}
        {ready && tabs.length > 0 && (
          <div className="flex w-44 flex-shrink-0 flex-col gap-0.5 overflow-y-auto">
            <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-faint">Tabs</p>
            {tabs.map((tab) => (
              <div
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                onDoubleClick={() => {
                  setEditingTab(tab.id)
                  setEditName(tab.name)
                }}
                className={`group flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                  tab.id === activeTab
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                }`}
              >
                {editingTab === tab.id ? (
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => commitRename(tab.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(tab.id)
                      if (e.key === 'Escape') setEditingTab(null)
                    }}
                    className="min-w-0 flex-1 bg-transparent outline-none"
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate">{tab.name}</span>
                )}
                {tabs.length > 1 && editingTab !== tab.id && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteTab(tab.id)
                    }}
                    className="opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    title="Delete tab"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={addTab}
              className="mt-1 flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
            >
              <Plus size={14} /> Add tab
            </button>
          </div>
        )}

        {/* document surface — per-doc light/dark */}
        <div
          className={`flex-1 overflow-hidden rounded-2xl border border-border shadow-sm ${
            docTheme === 'light' ? 'bg-white' : 'bg-[#0a1430]'
          }`}
        >
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
          {ready && (
            <DocEditor
              key={activeTab}
              docId={docId}
              ydoc={ready.ydoc}
              provider={ready.provider}
              userName={ready.userName}
              fragmentKey={fragmentKeyFor(activeTab)}
              theme={docTheme}
              template={activeTab === 'main' ? template : undefined}
              onFirstLine={(t) => {
                firstLines.current[activeTab] = t
                autoNameTab(activeTab)
              }}
            />
          )}
        </div>
      </div>

      {shareOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <button aria-hidden tabIndex={-1} className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShareOpen(false)} />
          <div className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
                <Share2 size={18} className="text-primary" /> Share “{title || 'Untitled'}”
              </h3>
              <button onClick={() => setShareOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                <X size={16} />
              </button>
            </div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Anyone on your team with the link can open this document.</p>
            <div className="flex items-center gap-2 rounded-xl border border-border bg-background p-2">
              <Link2 size={15} className="ml-1 flex-shrink-0 text-muted-foreground" />
              <input
                readOnly
                value={typeof window !== 'undefined' ? `${window.location.origin}/studio/workspace/script?doc=${docId}` : ''}
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(`${window.location.origin}/studio/workspace/script?doc=${docId}`)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1800)
                  } catch {
                    /* ignore */
                  }
                }}
                className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy link</>}
              </button>
            </div>
            <p className="mt-4 text-[11px] text-faint">
              Granular per-person permissions arrive with the team/RBAC layer.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
