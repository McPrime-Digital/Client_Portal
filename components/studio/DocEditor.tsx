'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'
import { useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import {
  Undo2, Redo2, Pilcrow, Heading1, Heading2, Heading3,
  Bold, Italic, Underline, Strikethrough, Code,
  List, ListOrdered, ListChecks, AlignLeft, AlignCenter, AlignRight, Link2, ListTree, Search, X,
  Eye, PencilLine, Download, Upload, History, RotateCcw, FileCode2, Printer, MessageSquare, FileType,
} from 'lucide-react'
import type { SupabaseYjsProvider } from '@/lib/collab/supabaseYjs'
import { SCRIPT_TEMPLATES } from '@/lib/studio/scriptTemplates'
import { createClient } from '@/lib/supabase/client'
import DocComments from './DocComments'

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyEditor = ReturnType<typeof useCreateBlockNote>

function blockText(block: any): string {
  return Array.isArray(block?.content)
    ? block.content.map((c: any) => (typeof c?.text === 'string' ? c.text : '')).join('')
    : ''
}
function allText(editor: AnyEditor): string {
  return (editor.document as any[]).map(blockText).join('\n')
}
type Heading = { id: string; text: string; level: number }
function getHeadings(editor: AnyEditor): Heading[] {
  const out: Heading[] = []
  for (const b of editor.document as any[]) {
    if (b.type === 'heading') out.push({ id: b.id, text: blockText(b) || 'Heading', level: b.props?.level ?? 1 })
  }
  return out
}

function Sep() {
  return <span className="mx-1 h-5 w-px bg-current opacity-10" />
}

// Full-page collaborative document editor: persistent formatting toolbar,
// outline/TOC, and live word/character count. `theme` is the per-document light/dark.
type DocVersion = { id: string; label: string | null; content: any; created_by_name: string | null; created_at: string }

export default function DocEditor({
  docId,
  ydoc,
  provider,
  userName,
  fragmentKey,
  theme,
  template,
}: {
  docId: string
  ydoc: Y.Doc
  provider: SupabaseYjsProvider
  userName: string
  fragmentKey: string
  theme: 'light' | 'dark'
  template?: string
}) {
  const editor = useCreateBlockNote({
    collaboration: {
      provider,
      fragment: ydoc.getXmlFragment(fragmentKey),
      user: { name: userName, color: provider.userColor },
    },
  })

  const [, force] = useState(0)
  const [outline, setOutline] = useState<Heading[]>([])
  const [counts, setCounts] = useState({ words: 0, chars: 0 })
  const [showOutline, setShowOutline] = useState(false)
  const [showFind, setShowFind] = useState(false)
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [mode, setMode] = useState<'editing' | 'viewing'>('editing')
  const fileRef = useRef<HTMLInputElement>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [showComments, setShowComments] = useState(false)
  const [versions, setVersions] = useState<DocVersion[] | null>(null)
  const [vBusy, setVBusy] = useState(false)
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    const update = () => {
      const text = allText(editor)
      setCounts({
        words: (text.trim().match(/\S+/g) || []).length,
        chars: text.replace(/\n/g, '').length,
      })
      setOutline(getHeadings(editor))
      force((n) => n + 1)
    }
    update()
    const off = editor.onChange(update)
    const onSel = () => force((n) => n + 1)
    document.addEventListener('selectionchange', onSel)
    return () => {
      if (typeof off === 'function') off()
      document.removeEventListener('selectionchange', onSel)
    }
  }, [editor])

  // Seed a brand-new doc with its template's starter content (once, only if empty).
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || !template) return
    const md = SCRIPT_TEMPLATES[template]
    if (!md) {
      seeded.current = true
      return
    }
    const docBlocks = editor.document as any[]
    const empty = docBlocks.length <= 1 && !blockText(docBlocks[0] ?? {})
    if (!empty) {
      seeded.current = true
      return
    }
    seeded.current = true
    void (async () => {
      const blocks = await editor.tryParseMarkdownToBlocks(md)
      editor.replaceBlocks(editor.document, blocks as any)
    })()
  }, [editor, template])

  const isLight = theme === 'light'
  const barBg = isLight ? 'border-black/10 bg-black/[0.02]' : 'border-white/10 bg-white/[0.03]'
  const btn = `grid h-8 w-8 place-items-center rounded-md transition-colors ${
    isLight ? 'text-gray-600 hover:bg-black/5' : 'text-gray-300 hover:bg-white/10'
  }`
  const on = 'bg-primary/15 text-primary'

  const styles: any = (() => {
    try {
      return editor.getActiveStyles()
    } catch {
      return {}
    }
  })()
  const block: any = (() => {
    try {
      return editor.getTextCursorPosition().block
    } catch {
      return null
    }
  })()
  const type = block?.type
  const level = block?.props?.level
  const align = block?.props?.textAlignment

  const toggle = (s: string) => {
    editor.toggleStyles({ [s]: true } as any)
    editor.focus()
  }
  const setBlock = (t: string, props?: any) => {
    if (block) editor.updateBlock(block, { type: t, ...(props ? { props } : {}) } as any)
    editor.focus()
  }
  const setAlign = (a: string) => {
    if (block) editor.updateBlock(block, { props: { textAlignment: a } } as any)
    editor.focus()
  }
  const addLink = () => {
    const url = window.prompt('Link URL')
    if (url) {
      try {
        editor.createLink(url)
      } catch {
        /* nothing selected */
      }
    }
  }

  const matchCount = (() => {
    if (!find) return 0
    let n = 0
    for (const b of editor.document as any[]) {
      const text = blockText(b)
      let i = 0
      while ((i = text.indexOf(find, i)) !== -1) {
        n++
        i += find.length
      }
    }
    return n
  })()
  const replaceAll = () => {
    if (!find) return
    for (const b of editor.document as any[]) {
      if (!Array.isArray(b.content)) continue
      let changed = false
      const content = b.content.map((node: any) => {
        if (node?.type === 'text' && typeof node.text === 'string' && node.text.includes(find)) {
          changed = true
          return { ...node, text: node.text.split(find).join(replace) }
        }
        return node
      })
      if (changed) editor.updateBlock(b, { content } as any)
    }
    editor.focus()
  }

  const download = (text: string, name: string, type: string) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type }))
    a.download = name
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const exportMarkdown = async () => {
    const md = await editor.blocksToMarkdownLossy(editor.document)
    download(md, 'document.md', 'text/markdown')
  }
  const importMarkdown = async (file: File) => {
    const blocks = await editor.tryParseMarkdownToBlocks(await file.text())
    editor.replaceBlocks(editor.document, blocks as any)
  }
  const exportHtml = async () => {
    const html = await editor.blocksToHTMLLossy(editor.document)
    download(html, 'document.html', 'text/html')
  }
  const printDoc = async () => {
    const html = await editor.blocksToHTMLLossy(editor.document)
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>Document</title>` +
        `<style>body{font-family:Inter,system-ui,-apple-system,sans-serif;max-width:46rem;margin:2.5rem auto;padding:0 1.5rem;line-height:1.7;color:#111}` +
        `h1,h2,h3{line-height:1.25;margin:1.4em 0 .5em}img{max-width:100%}blockquote{border-left:3px solid #ddd;margin:1em 0;padding-left:1em;color:#555}` +
        `pre,code{font-family:ui-monospace,Menlo,monospace}</style></head><body>${html}</body></html>`,
    )
    w.document.close()
    w.focus()
    w.print()
  }
  const exportWord = async () => {
    const html = await editor.blocksToHTMLLossy(editor.document)
    const doc =
      `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" ` +
      `xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"></head><body>${html}</body></html>`
    download(doc, 'document.doc', 'application/msword')
  }

  // Version history (per tab) — manual snapshots of the block content.
  const loadVersions = async () => {
    setVersions(null)
    const { data } = await supabase
      .from('document_versions')
      .select('id, label, content, created_by_name, created_at')
      .eq('document_id', docId)
      .eq('tab_key', fragmentKey)
      .order('created_at', { ascending: false })
    setVersions((data as DocVersion[] | null) ?? [])
  }
  const toggleHistory = () => {
    setShowHistory((s) => {
      if (!s) void loadVersions()
      return !s
    })
  }
  const saveVersion = async () => {
    const label = window.prompt('Name this version (optional)')?.trim() || null
    setVBusy(true)
    await supabase.from('document_versions').insert({
      document_id: docId,
      tab_key: fragmentKey,
      label,
      content: editor.document,
      created_by_name: userName,
    })
    setVBusy(false)
    await loadVersions()
  }
  const restore = (v: DocVersion) => {
    if (!window.confirm('Restore this version? The current content of this tab will be replaced.')) return
    editor.replaceBlocks(editor.document, v.content as any)
    editor.focus()
  }

  return (
    <div
      className="flex h-full flex-col"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
          e.preventDefault()
          setShowFind(true)
        }
      }}
    >
      {/* persistent formatting toolbar */}
      <div className={`flex flex-shrink-0 flex-wrap items-center gap-0.5 border-b px-3 py-1.5 ${barBg}`}>
        <button className={btn} title="Undo" onClick={() => editor.undo()}><Undo2 size={16} /></button>
        <button className={btn} title="Redo" onClick={() => editor.redo()}><Redo2 size={16} /></button>
        <Sep />
        <button className={`${btn} ${type === 'paragraph' ? on : ''}`} title="Paragraph" onClick={() => setBlock('paragraph')}><Pilcrow size={16} /></button>
        <button className={`${btn} ${type === 'heading' && level === 1 ? on : ''}`} title="Heading 1" onClick={() => setBlock('heading', { level: 1 })}><Heading1 size={16} /></button>
        <button className={`${btn} ${type === 'heading' && level === 2 ? on : ''}`} title="Heading 2" onClick={() => setBlock('heading', { level: 2 })}><Heading2 size={16} /></button>
        <button className={`${btn} ${type === 'heading' && level === 3 ? on : ''}`} title="Heading 3" onClick={() => setBlock('heading', { level: 3 })}><Heading3 size={16} /></button>
        <Sep />
        <button className={`${btn} ${styles.bold ? on : ''}`} title="Bold" onClick={() => toggle('bold')}><Bold size={16} /></button>
        <button className={`${btn} ${styles.italic ? on : ''}`} title="Italic" onClick={() => toggle('italic')}><Italic size={16} /></button>
        <button className={`${btn} ${styles.underline ? on : ''}`} title="Underline" onClick={() => toggle('underline')}><Underline size={16} /></button>
        <button className={`${btn} ${styles.strike ? on : ''}`} title="Strikethrough" onClick={() => toggle('strike')}><Strikethrough size={16} /></button>
        <button className={`${btn} ${styles.code ? on : ''}`} title="Inline code" onClick={() => toggle('code')}><Code size={16} /></button>
        <Sep />
        <button className={`${btn} ${type === 'bulletListItem' ? on : ''}`} title="Bulleted list" onClick={() => setBlock('bulletListItem')}><List size={16} /></button>
        <button className={`${btn} ${type === 'numberedListItem' ? on : ''}`} title="Numbered list" onClick={() => setBlock('numberedListItem')}><ListOrdered size={16} /></button>
        <button className={`${btn} ${type === 'checkListItem' ? on : ''}`} title="Checklist" onClick={() => setBlock('checkListItem')}><ListChecks size={16} /></button>
        <Sep />
        <button className={`${btn} ${align === 'left' || !align ? on : ''}`} title="Align left" onClick={() => setAlign('left')}><AlignLeft size={16} /></button>
        <button className={`${btn} ${align === 'center' ? on : ''}`} title="Align center" onClick={() => setAlign('center')}><AlignCenter size={16} /></button>
        <button className={`${btn} ${align === 'right' ? on : ''}`} title="Align right" onClick={() => setAlign('right')}><AlignRight size={16} /></button>
        <Sep />
        <button className={btn} title="Add link" onClick={addLink}><Link2 size={16} /></button>
        <Sep />
        <button className={`${btn} ${showFind ? on : ''}`} title="Find & replace" onClick={() => setShowFind((s) => !s)}><Search size={16} /></button>
        <button className={`${btn} ${showHistory ? on : ''}`} title="Version history" onClick={toggleHistory}><History size={16} /></button>
        <button className={`${btn} ${showComments ? on : ''}`} title="Comments" onClick={() => setShowComments((s) => !s)}><MessageSquare size={16} /></button>
        <Sep />
        <button className={btn} title="Export as Markdown" onClick={exportMarkdown}><Download size={16} /></button>
        <button className={btn} title="Export as HTML" onClick={exportHtml}><FileCode2 size={16} /></button>
        <button className={btn} title="Export as Word (.doc)" onClick={exportWord}><FileType size={16} /></button>
        <button className={btn} title="Print / Save as PDF" onClick={printDoc}><Printer size={16} /></button>
        <button className={btn} title="Import Markdown" onClick={() => fileRef.current?.click()}><Upload size={16} /></button>
        <input
          ref={fileRef}
          type="file"
          accept=".md,.markdown,text/markdown"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void importMarkdown(f)
            e.target.value = ''
          }}
        />
        <button
          className={`${btn} ${mode === 'viewing' ? on : ''}`}
          title={mode === 'editing' ? 'Switch to View mode' : 'Switch to Edit mode'}
          onClick={() => setMode((m) => (m === 'editing' ? 'viewing' : 'editing'))}
        >
          {mode === 'editing' ? <Eye size={16} /> : <PencilLine size={16} />}
        </button>
      </div>

      {showFind && (
        <div className={`flex flex-shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 ${barBg}`}>
          <input
            value={find}
            onChange={(e) => setFind(e.target.value)}
            placeholder="Find"
            className={`w-44 rounded-md border px-2 py-1 text-sm outline-none ${isLight ? 'border-black/10 bg-white text-gray-800' : 'border-white/10 bg-white/5 text-gray-100'}`}
          />
          <input
            value={replace}
            onChange={(e) => setReplace(e.target.value)}
            placeholder="Replace with"
            className={`w-44 rounded-md border px-2 py-1 text-sm outline-none ${isLight ? 'border-black/10 bg-white text-gray-800' : 'border-white/10 bg-white/5 text-gray-100'}`}
          />
          <button
            onClick={replaceAll}
            disabled={!find}
            className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Replace all
          </button>
          <span className={`text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
            {matchCount} match{matchCount === 1 ? '' : 'es'}
          </span>
          <button onClick={() => setShowFind(false)} className={`ml-auto ${btn}`} title="Close">
            <X size={15} />
          </button>
        </div>
      )}

      {/* editor + outline */}
      <div className="flex min-h-0 flex-1">
        <div
          className="flex-1 overflow-y-auto"
          onMouseDown={(e) => {
            const t = e.target as HTMLElement
            if (t && !t.closest('.ProseMirror') && !t.closest('button') && !t.closest('a')) {
              e.preventDefault()
              editor.focus()
            }
          }}
        >
          <div className="tl-editor mx-auto min-h-full w-full max-w-5xl px-6 py-10 sm:px-12 sm:py-14">
            <BlockNoteView editor={editor} editable={mode === 'editing'} theme={theme} />
          </div>
        </div>

        {showOutline && (
          <aside className={`w-56 flex-shrink-0 overflow-y-auto border-l p-3 ${isLight ? 'border-black/10' : 'border-white/10'}`}>
            <p className={`mb-2 text-[10px] font-semibold uppercase tracking-widest ${isLight ? 'text-gray-400' : 'text-gray-500'}`}>Outline</p>
            {outline.length === 0 ? (
              <p className={`text-xs ${isLight ? 'text-gray-400' : 'text-gray-500'}`}>Add headings to build an outline.</p>
            ) : (
              outline.map((h) => (
                <button
                  key={h.id}
                  onClick={() =>
                    document.querySelector(`[data-id="${h.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }
                  className={`block w-full truncate rounded px-2 py-1 text-left text-[13px] ${
                    isLight ? 'text-gray-600 hover:bg-black/5' : 'text-gray-300 hover:bg-white/10'
                  }`}
                  style={{ paddingLeft: `${0.5 + (h.level - 1) * 0.75}rem` }}
                >
                  {h.text}
                </button>
              ))
            )}
          </aside>
        )}

        {showHistory && (
          <aside className={`w-64 flex-shrink-0 overflow-y-auto border-l p-3 ${isLight ? 'border-black/10' : 'border-white/10'}`}>
            <div className="mb-2 flex items-center justify-between">
              <p className={`text-[10px] font-semibold uppercase tracking-widest ${isLight ? 'text-gray-400' : 'text-gray-500'}`}>Version history</p>
              <button onClick={() => setShowHistory(false)} className={btn} title="Close"><X size={14} /></button>
            </div>
            <button
              onClick={saveVersion}
              disabled={vBusy}
              className="mb-3 w-full rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {vBusy ? 'Saving…' : 'Save current version'}
            </button>
            {versions === null ? (
              <p className={`text-xs ${isLight ? 'text-gray-400' : 'text-gray-500'}`}>Loading…</p>
            ) : versions.length === 0 ? (
              <p className={`text-xs ${isLight ? 'text-gray-400' : 'text-gray-500'}`}>No saved versions yet. Save one to capture this draft.</p>
            ) : (
              <ul className="space-y-1">
                {versions.map((v) => (
                  <li key={v.id} className={`rounded-lg px-2.5 py-2 ${isLight ? 'hover:bg-black/5' : 'hover:bg-white/10'}`}>
                    <p className={`truncate text-[13px] font-medium ${isLight ? 'text-gray-700' : 'text-gray-200'}`}>
                      {v.label || new Date(v.created_at).toLocaleString()}
                    </p>
                    <p className={`text-[11px] ${isLight ? 'text-gray-400' : 'text-gray-500'}`}>
                      {v.label ? `${new Date(v.created_at).toLocaleString()}` : ''}
                      {v.created_by_name ? `${v.label ? ' · ' : ''}${v.created_by_name}` : ''}
                    </p>
                    <button
                      onClick={() => restore(v)}
                      className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                    >
                      <RotateCcw size={11} /> Restore
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}

        {showComments && (
          <DocComments
            docId={docId}
            tabKey={fragmentKey}
            userName={userName}
            provider={provider}
            isLight={isLight}
            onClose={() => setShowComments(false)}
          />
        )}
      </div>

      {/* status bar */}
      <div className={`flex flex-shrink-0 items-center gap-4 border-t px-4 py-1.5 text-[11px] ${barBg} ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
        <span>{counts.words.toLocaleString()} words</span>
        <span>{counts.chars.toLocaleString()} characters</span>
        <button
          className={`ml-auto flex items-center gap-1.5 rounded px-2 py-1 transition-colors ${showOutline ? on : ''} ${
            isLight ? 'hover:bg-black/5' : 'hover:bg-white/10'
          }`}
          onClick={() => setShowOutline((s) => !s)}
        >
          <ListTree size={13} /> Outline
        </button>
      </div>
    </div>
  )
}
