'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'
import {
  useCreateBlockNote, useActiveStyles, FormattingToolbar, FormattingToolbarController,
  getFormattingToolbarItems, useComponentsContext,
} from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import {
  Undo2, Redo2, Pilcrow, Heading1, Heading2, Heading3,
  Bold, Italic, Underline, Strikethrough, Code,
  List, ListOrdered, ListChecks, AlignLeft, AlignCenter, AlignRight, Link2, ListTree, Search, X,
  Eye, PencilLine, Download, Upload, History, RotateCcw, FileCode2, Printer, MessageSquare, FileType,
  Minus, Plus, ChevronDown, FileDown, StretchHorizontal, FileText, Aperture,
  Baseline, Highlighter, Paintbrush, AlignJustify, Subscript, Superscript, Eraser,
} from 'lucide-react'
import type { SupabaseYjsProvider } from '@/lib/collab/supabaseYjs'
import { SCRIPT_TEMPLATES } from '@/lib/studio/scriptTemplates'
import { docSchema } from '@/lib/studio/editorSchema'
import { FONT_FAMILIES, FONT_SIZES } from '@/lib/studio/fonts'
import { createClient } from '@/lib/supabase/client'
import DocComments from './DocComments'
import PrimeOSAssistant from './PrimeOSAssistant'

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyEditor = any

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

const TEXT_PALETTE = [
  '#000000', '#434343', '#666666', '#999999', '#cccccc', '#ffffff',
  '#e11d48', '#f97316', '#f59e0b', '#eab308', '#22c55e', '#10b981',
  '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#ec4899',
  '#7f1d1d', '#7c2d12', '#713f12', '#365314', '#0c4a6e', '#1e1b4b',
]
const HIGHLIGHTS = ['', '#fef08a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#fed7aa', '#e9d5ff', '#fecaca', '#a7f3d0', '#bae6fd', '#ddd6fe']
const GRADIENTS = [
  'linear-gradient(90deg,#f97316,#db2777)',
  'linear-gradient(90deg,#6366f1,#06b6d4)',
  'linear-gradient(90deg,#10b981,#3b82f6)',
  'linear-gradient(90deg,#f59e0b,#ef4444)',
  'linear-gradient(90deg,#8b5cf6,#ec4899)',
  'linear-gradient(90deg,#0ea5e9,#22d3ee)',
  'linear-gradient(90deg,#facc15,#f97316,#db2777)',
  'linear-gradient(90deg,#22d3ee,#818cf8,#c084fc)',
]

// Horizontal ruler over the page (Letter, 1in margins) — inch + half-inch ticks.
function Ruler({ isLight }: { isLight: boolean }) {
  const line = isLight ? 'bg-gray-300' : 'bg-white/20'
  const marginTone = isLight ? 'bg-gray-200/70' : 'bg-white/5'
  return (
    <div className="mx-auto hidden w-[816px] max-w-full select-none px-0 sm:block">
      <div className={`relative flex h-5 items-end ${isLight ? 'text-gray-400' : 'text-gray-500'}`}>
        {/* margins (1in each side) */}
        <div className={`absolute left-0 top-0 h-full w-24 ${marginTone}`} />
        <div className={`absolute right-0 top-0 h-full w-24 ${marginTone}`} />
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="relative" style={{ width: 96 }}>
            <span className={`absolute bottom-0 left-0 ${line}`} style={{ width: 1, height: 8 }} />
            <span className={`absolute bottom-0 ${line}`} style={{ left: 48, width: 1, height: 4 }} />
            <span className="absolute bottom-[9px] left-[3px] text-[9px] leading-none">{i || ''}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Vertical ruler down the left of the page (Letter, inch ticks). Height tracks the page.
function VerticalRuler({ isLight, height }: { isLight: boolean; height: number }) {
  const line = isLight ? 'bg-gray-300' : 'bg-white/20'
  const marginTone = isLight ? 'bg-gray-200/70' : 'bg-white/5'
  const inches = Math.max(11, Math.ceil(height / 96))
  return (
    <div className={`relative mr-1 hidden flex-shrink-0 select-none sm:block ${isLight ? 'text-gray-400' : 'text-gray-500'}`} style={{ width: 18, height }}>
      <div className={`absolute left-0 top-0 w-full ${marginTone}`} style={{ height: 96 }} />
      {Array.from({ length: inches }).map((_, i) => (
        <div key={i} className="absolute right-0" style={{ top: i * 96 }}>
          <span className={`absolute right-0 ${line}`} style={{ width: 8, height: 1 }} />
          <span className={`absolute right-0 ${line}`} style={{ top: 48, width: 4, height: 1 }} />
          {i > 0 && <span className="absolute right-[2px] top-[2px] text-[8px] leading-none">{i}</span>}
        </div>
      ))}
    </div>
  )
}

// PrimeOS AI button injected into BlockNote's selection (formatting) toolbar.
function PrimeToolbarButton({ onMuse }: { onMuse: () => void }) {
  const Components = useComponentsContext()!
  return (
    <Components.FormattingToolbar.Button
      className="bn-prime-btn"
      mainTooltip="PrimeOS AI — refine the selection"
      label="PrimeOS AI"
      onClick={onMuse}
      icon={<Aperture size={16} />}
    />
  )
}

// Full-page collaborative document editor: persistent formatting toolbar,
// outline/TOC, and live word/character count. `theme` is the per-document light/dark.
type DocVersion = { id: string; label: string | null; content: any; created_by_name: string | null; created_at: string }
type MuseAnchor = { text: string; rect: DOMRect | null; range: { from: number; to: number } | null }

export default function DocEditor({
  docId,
  ydoc,
  provider,
  userName,
  fragmentKey,
  theme,
  template,
  onFirstLine,
}: {
  docId: string
  ydoc: Y.Doc
  provider: SupabaseYjsProvider
  userName: string
  fragmentKey: string
  theme: 'light' | 'dark'
  template?: string
  onFirstLine?: (text: string) => void
}) {
  const editor = useCreateBlockNote({
    schema: docSchema,
    collaboration: {
      provider,
      fragment: ydoc.getXmlFragment(fragmentKey),
      user: { name: userName, color: provider.userColor },
    },
  }) as any
  const isPrimary = fragmentKey === 'blocknote'

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
  const [fontOpen, setFontOpen] = useState(false)
  const [sizeOpen, setSizeOpen] = useState(false)
  const [colorOpen, setColorOpen] = useState(false)
  const [hlOpen, setHlOpen] = useState(false)
  const [gradOpen, setGradOpen] = useState(false)
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [layout, setLayout] = useState<'page' | 'pageless'>('page')

  // remember page/pageless per document
  useEffect(() => {
    try {
      const v = localStorage.getItem(`tl-doclayout-${docId}`)
      if (v === 'page' || v === 'pageless') setLayout(v)
    } catch {
      /* ignore */
    }
  }, [docId])
  const toggleLayout = () =>
    setLayout((p) => {
      const next = p === 'page' ? 'pageless' : 'page'
      try {
        localStorage.setItem(`tl-doclayout-${docId}`, next)
      } catch {
        /* ignore */
      }
      return next
    })

  // Measure the page surface so the side ruler + page-break guides track its height.
  const PAGE_H = 1056 // Letter @ 96dpi
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [contentHeight, setContentHeight] = useState(PAGE_H)
  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setContentHeight(el.offsetHeight))
    ro.observe(el)
    setContentHeight(el.offsetHeight)
    return () => ro.disconnect()
  }, [layout])
  const [versions, setVersions] = useState<DocVersion[] | null>(null)
  const [vBusy, setVBusy] = useState(false)
  const supabase = useMemo(() => createClient(), [])
  const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    const update = () => {
      const text = allText(editor)
      setCounts({
        words: (text.trim().match(/\S+/g) || []).length,
        chars: text.replace(/\n/g, '').length,
      })
      setOutline(getHeadings(editor))
      force((n) => n + 1)
      const firstLine = text.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
      onFirstLine?.(firstLine)
      if (isPrimary) {
        clearTimeout(previewTimer.current)
        previewTimer.current = setTimeout(() => {
          void supabase.from('documents').update({ preview: text.slice(0, 800) }).eq('id', docId)
        }, 500)
      }
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

  const styles: any = useActiveStyles(editor)
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

  // font family + size (Google-Docs-style)
  const curFamilyValue = (styles.fontFamily as string | undefined) ?? ''
  const curFamily = FONT_FAMILIES.find((f) => f.value === curFamilyValue)?.label ?? (curFamilyValue ? 'Custom' : 'Default')
  const curSizeNum = styles.fontSize ? parseInt(String(styles.fontSize), 10) || 16 : 16
  // If nothing is selected, select the current block's text so font changes are visible.
  const ensureSelection = () => {
    const tip = editor._tiptapEditor
    try {
      if (tip && tip.state.selection.empty) {
        const $from = tip.state.selection.$from
        tip.chain().focus().setTextSelection({ from: $from.start(), to: $from.end() }).run()
        return
      }
    } catch {
      /* fall through */
    }
    editor.focus()
  }
  const applyFont = (family: string) => {
    ensureSelection()
    if (family) editor.addStyles({ fontFamily: family })
    else editor.removeStyles({ fontFamily: curFamilyValue || ' ' })
    editor.focus()
  }
  const applySize = (size: number) => {
    const n = Math.min(400, Math.max(1, size))
    ensureSelection()
    editor.addStyles({ fontSize: `${n}px` })
    editor.focus()
  }
  const applyColor = (c: string) => {
    ensureSelection()
    if (c) editor.addStyles({ color: c })
    else editor.removeStyles({ color: styles.color || ' ' })
    editor.focus()
  }
  const applyHighlight = (c: string) => {
    ensureSelection()
    if (c) editor.addStyles({ highlight: c })
    else editor.removeStyles({ highlight: styles.highlight || ' ' })
    editor.focus()
  }
  const applyGradient = (g: string) => {
    ensureSelection()
    if (g) editor.addStyles({ gradient: g })
    else editor.removeStyles({ gradient: styles.gradient || ' ' })
    editor.focus()
  }
  const clearFormatting = () => {
    ensureSelection()
    try { editor.removeStyles(editor.getActiveStyles()) } catch { /* noop */ }
    const b = editor.getTextCursorPosition?.().block
    if (b) editor.updateBlock(b, { type: 'paragraph', props: { textAlignment: 'left' } } as any)
    editor.focus()
  }

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

  // Muse inline — open a chat anchored to the current selection, apply to it.
  const [muse, setMuse] = useState<MuseAnchor | null>(null)
  const openMuse = () => {
    const text = (editor.getSelectedText?.() || window.getSelection()?.toString() || '').trim()
    if (!text) return
    const sel = typeof window !== 'undefined' ? window.getSelection() : null
    const rect = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null
    const tip = editor._tiptapEditor
    const range = tip ? { from: tip.state.selection.from, to: tip.state.selection.to } : null
    setMuse({ text, rect, range })
  }
  const applyMuse = (newText: string, modeKind: 'replace' | 'after') => {
    const tip = editor._tiptapEditor
    if (tip && muse?.range) {
      if (modeKind === 'replace') {
        tip.chain().focus().insertContentAt(muse.range, newText).run()
        setMuse((m) => (m ? { ...m, range: { from: muse.range!.from, to: muse.range!.from + newText.length }, text: newText } : m))
      } else {
        tip.chain().focus().insertContentAt(muse.range.to, `\n${newText}`).run()
      }
    } else {
      editor.insertInlineContent([{ type: 'text', text: newText, styles: {} }] as any)
    }
  }
  const editorView = (
    <BlockNoteView editor={editor} editable={mode === 'editing'} theme={theme} formattingToolbar={false}>
      <FormattingToolbarController
        formattingToolbar={() => (
          <FormattingToolbar>
            {getFormattingToolbarItems()}
            <PrimeToolbarButton key="primeos" onMuse={openMuse} />
          </FormattingToolbar>
        )}
      />
    </BlockNoteView>
  )

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
        {/* font family */}
        <div className="relative">
          <button
            type="button"
            title="Font"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setFontOpen((o) => !o)}
            className={`flex h-8 items-center gap-1 rounded-md px-2 text-sm transition-colors ${isLight ? 'text-gray-700 hover:bg-black/5' : 'text-gray-200 hover:bg-white/10'}`}
          >
            <span className="max-w-[7.5rem] truncate" style={{ fontFamily: curFamilyValue || undefined }}>{curFamily}</span>
            <ChevronDown size={13} className="opacity-60" />
          </button>
          {fontOpen && (
            <>
              <button aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setFontOpen(false)} />
              <div className={`absolute left-0 top-full z-20 mt-1 max-h-80 w-52 overflow-y-auto rounded-xl border py-1 shadow-2xl ${isLight ? 'border-black/10 bg-white' : 'border-white/10 bg-[#0f1c3f]'}`}>
                {FONT_FAMILIES.map((f) => (
                  <button
                    key={f.label}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { applyFont(f.value); setFontOpen(false) }}
                    style={{ fontFamily: f.value || undefined }}
                    className={`block w-full truncate px-3 py-1.5 text-left text-sm transition-colors ${curFamily === f.label ? 'text-primary' : isLight ? 'text-gray-700 hover:bg-black/5' : 'text-gray-200 hover:bg-white/10'}`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {/* font size */}
        <div className="relative flex items-center gap-0.5">
          <button className={btn} title="Decrease font size" onMouseDown={(e) => e.preventDefault()} onClick={() => applySize(curSizeNum - 1)}><Minus size={14} /></button>
          <input
            key={curSizeNum}
            defaultValue={curSizeNum}
            inputMode="numeric"
            aria-label="Font size"
            onBlur={(e) => { const n = parseInt(e.target.value, 10); if (!Number.isNaN(n)) applySize(n) }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            className={`h-7 w-10 rounded-md border text-center text-sm outline-none ${isLight ? 'border-black/10 bg-white text-gray-800' : 'border-white/10 bg-white/5 text-gray-100'}`}
          />
          <button className={`grid h-8 w-4 place-items-center rounded-md transition-colors ${isLight ? 'text-gray-500 hover:bg-black/5' : 'text-gray-300 hover:bg-white/10'}`} title="Font sizes" onMouseDown={(e) => e.preventDefault()} onClick={() => setSizeOpen((o) => !o)}><ChevronDown size={12} /></button>
          <button className={btn} title="Increase font size" onMouseDown={(e) => e.preventDefault()} onClick={() => applySize(curSizeNum + 1)}><Plus size={14} /></button>
          {sizeOpen && (
            <>
              <button aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setSizeOpen(false)} />
              <div className={`absolute left-0 top-full z-20 mt-1 max-h-72 w-16 overflow-y-auto rounded-xl border py-1 shadow-2xl ${isLight ? 'border-black/10 bg-white' : 'border-white/10 bg-[#0f1c3f]'}`}>
                {FONT_SIZES.map((s) => (
                  <button
                    key={s}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { applySize(s); setSizeOpen(false) }}
                    className={`block w-full px-3 py-1 text-left text-sm transition-colors ${s === curSizeNum ? 'text-primary' : isLight ? 'text-gray-700 hover:bg-black/5' : 'text-gray-200 hover:bg-white/10'}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <Sep />
        <button className={`${btn} ${styles.bold ? on : ''}`} title="Bold" onClick={() => toggle('bold')}><Bold size={16} /></button>
        <button className={`${btn} ${styles.italic ? on : ''}`} title="Italic" onClick={() => toggle('italic')}><Italic size={16} /></button>
        <button className={`${btn} ${styles.underline ? on : ''}`} title="Underline" onClick={() => toggle('underline')}><Underline size={16} /></button>
        <button className={`${btn} ${styles.strike ? on : ''}`} title="Strikethrough" onClick={() => toggle('strike')}><Strikethrough size={16} /></button>
        <button className={`${btn} ${styles.code ? on : ''}`} title="Inline code" onClick={() => toggle('code')}><Code size={16} /></button>
        <button className={`${btn} ${styles.sup ? on : ''}`} title="Superscript" onClick={() => toggle('sup')}><Superscript size={16} /></button>
        <button className={`${btn} ${styles.sub ? on : ''}`} title="Subscript" onClick={() => toggle('sub')}><Subscript size={16} /></button>
        <Sep />
        {/* text color */}
        <div className="relative">
          <button className={btn} title="Text color" onMouseDown={(e) => e.preventDefault()} onClick={() => setColorOpen((o) => !o)}><Baseline size={16} style={{ color: (styles.color as string) || undefined }} /></button>
          {colorOpen && (
            <>
              <button aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setColorOpen(false)} />
              <div className={`absolute left-0 top-full z-20 mt-1 w-44 rounded-xl border p-2 shadow-2xl ${isLight ? 'border-black/10 bg-white' : 'border-white/10 bg-[#0f1c3f]'}`}>
                <div className="grid grid-cols-6 gap-1">
                  {TEXT_PALETTE.map((c) => (
                    <button key={c} title={c} onMouseDown={(e) => e.preventDefault()} onClick={() => { applyColor(c); setColorOpen(false) }} className="h-5 w-5 rounded ring-1 ring-black/10" style={{ background: c }} />
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <input type="color" aria-label="Custom text color" onChange={(e) => applyColor(e.target.value)} className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0" />
                  <button onMouseDown={(e) => e.preventDefault()} onClick={() => { applyColor(''); setColorOpen(false) }} className={`text-[11px] font-medium ${isLight ? 'text-gray-600 hover:text-gray-900' : 'text-gray-300 hover:text-white'}`}>Reset</button>
                </div>
              </div>
            </>
          )}
        </div>
        {/* highlight */}
        <div className="relative">
          <button className={btn} title="Highlight" onMouseDown={(e) => e.preventDefault()} onClick={() => setHlOpen((o) => !o)}><Highlighter size={16} style={{ color: (styles.highlight as string) || undefined }} /></button>
          {hlOpen && (
            <>
              <button aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setHlOpen(false)} />
              <div className={`absolute left-0 top-full z-20 mt-1 w-44 rounded-xl border p-2 shadow-2xl ${isLight ? 'border-black/10 bg-white' : 'border-white/10 bg-[#0f1c3f]'}`}>
                <div className="grid grid-cols-6 gap-1">
                  {HIGHLIGHTS.map((c, i) => (
                    <button key={i} title={c || 'None'} onMouseDown={(e) => e.preventDefault()} onClick={() => { applyHighlight(c); setHlOpen(false) }} className="grid h-5 w-5 place-items-center rounded ring-1 ring-black/10" style={{ background: c || 'transparent' }}>
                      {!c && <X size={11} className="text-gray-400" />}
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex items-center">
                  <input type="color" aria-label="Custom highlight" onChange={(e) => applyHighlight(e.target.value)} className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0" />
                </div>
              </div>
            </>
          )}
        </div>
        {/* gradient text */}
        <div className="relative">
          <button className={btn} title="Gradient text" onMouseDown={(e) => e.preventDefault()} onClick={() => setGradOpen((o) => !o)}><Paintbrush size={16} /></button>
          {gradOpen && (
            <>
              <button aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setGradOpen(false)} />
              <div className={`absolute left-0 top-full z-20 mt-1 w-48 space-y-1 rounded-xl border p-2 shadow-2xl ${isLight ? 'border-black/10 bg-white' : 'border-white/10 bg-[#0f1c3f]'}`}>
                {GRADIENTS.map((g, i) => (
                  <button key={i} onMouseDown={(e) => e.preventDefault()} onClick={() => { applyGradient(g); setGradOpen(false) }} className="h-6 w-full rounded ring-1 ring-black/10" style={{ backgroundImage: g }} />
                ))}
                <button onMouseDown={(e) => e.preventDefault()} onClick={() => { applyGradient(''); setGradOpen(false) }} className={`pt-0.5 text-[11px] font-medium ${isLight ? 'text-gray-600 hover:text-gray-900' : 'text-gray-300 hover:text-white'}`}>Remove gradient</button>
              </div>
            </>
          )}
        </div>
        <button className={btn} title="Clear formatting" onClick={clearFormatting}><Eraser size={16} /></button>
        <Sep />
        <button className={`${btn} ${type === 'bulletListItem' ? on : ''}`} title="Bulleted list" onClick={() => setBlock('bulletListItem')}><List size={16} /></button>
        <button className={`${btn} ${type === 'numberedListItem' ? on : ''}`} title="Numbered list" onClick={() => setBlock('numberedListItem')}><ListOrdered size={16} /></button>
        <button className={`${btn} ${type === 'checkListItem' ? on : ''}`} title="Checklist" onClick={() => setBlock('checkListItem')}><ListChecks size={16} /></button>
        <Sep />
        <button className={`${btn} ${align === 'left' || !align ? on : ''}`} title="Align left" onClick={() => setAlign('left')}><AlignLeft size={16} /></button>
        <button className={`${btn} ${align === 'center' ? on : ''}`} title="Align center" onClick={() => setAlign('center')}><AlignCenter size={16} /></button>
        <button className={`${btn} ${align === 'right' ? on : ''}`} title="Align right" onClick={() => setAlign('right')}><AlignRight size={16} /></button>
        <button className={`${btn} ${align === 'justify' ? on : ''}`} title="Justify" onClick={() => setAlign('justify')}><AlignJustify size={16} /></button>
        <Sep />
        <button className={btn} title="Add link" onClick={addLink}><Link2 size={16} /></button>
        <Sep />
        <button className={`${btn} ${showFind ? on : ''}`} title="Find & replace" onClick={() => setShowFind((s) => !s)}><Search size={16} /></button>
        <button className={`${btn} ${showHistory ? on : ''}`} title="Version history" onClick={toggleHistory}><History size={16} /></button>
        <button className={`${btn} ${showComments ? on : ''}`} title="Comments" onClick={() => setShowComments((s) => !s)}><MessageSquare size={16} /></button>
        <Sep />
        <button
          className={`${btn} ${type === 'paragraph' || type ? '' : ''} ${layout === 'pageless' ? on : ''}`}
          title={layout === 'page' ? 'Switch to pageless' : 'Switch to pages'}
          onClick={toggleLayout}
        >
          {layout === 'page' ? <StretchHorizontal size={16} /> : <FileText size={16} />}
        </button>
        <Sep />
        {/* download menu */}
        <div className="relative">
          <button
            className={`${btn} ${downloadOpen ? on : ''}`}
            title="Download"
            onClick={() => setDownloadOpen((o) => !o)}
          >
            <FileDown size={16} />
          </button>
          {downloadOpen && (
            <>
              <button aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setDownloadOpen(false)} />
              <div className={`absolute right-0 top-full z-20 mt-1 w-52 overflow-hidden rounded-xl border py-1 shadow-2xl ${isLight ? 'border-black/10 bg-white' : 'border-white/10 bg-[#0f1c3f]'}`}>
                {[
                  { label: 'PDF (Print)', icon: Printer, fn: printDoc },
                  { label: 'Microsoft Word (.doc)', icon: FileType, fn: exportWord },
                  { label: 'Web page (.html)', icon: FileCode2, fn: exportHtml },
                  { label: 'Markdown (.md)', icon: Download, fn: exportMarkdown },
                ].map((it) => {
                  const I = it.icon
                  return (
                    <button
                      key={it.label}
                      onClick={() => { setDownloadOpen(false); void it.fn() }}
                      className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] transition-colors ${isLight ? 'text-gray-700 hover:bg-black/5' : 'text-gray-200 hover:bg-white/10'}`}
                    >
                      <I size={14} className="opacity-70" /> {it.label}
                    </button>
                  )
                })}
                <div className={`my-1 h-px ${isLight ? 'bg-black/10' : 'bg-white/10'}`} />
                <button
                  onClick={() => { setDownloadOpen(false); fileRef.current?.click() }}
                  className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] transition-colors ${isLight ? 'text-gray-700 hover:bg-black/5' : 'text-gray-200 hover:bg-white/10'}`}
                >
                  <Upload size={14} className="opacity-70" /> Import Markdown…
                </button>
              </div>
            </>
          )}
        </div>
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
          className={`flex-1 overflow-y-auto ${layout === 'page' ? `px-4 pb-20 pt-3 ${isLight ? 'bg-[#f3f5f7]' : 'bg-[#070f24]'}` : ''}`}
          onMouseDown={(e) => {
            const t = e.target as HTMLElement
            if (t && !t.closest('.ProseMirror') && !t.closest('button') && !t.closest('a')) {
              e.preventDefault()
              editor.focus()
            }
          }}
        >
          {/* top ruler (aligned over the page) */}
          {layout === 'page' && (
            <div className="mx-auto flex w-fit">
              <div className="hidden flex-shrink-0 sm:block" style={{ width: 22 }} />
              <Ruler isLight={isLight} />
            </div>
          )}
          {/* One persistent editor — the surface keeps a stable position (and key) across
              page/pageless so the Yjs binding is never torn down (toggling never drops edits). */}
          <div className="flex justify-center">
            {layout === 'page' && <VerticalRuler isLight={isLight} height={contentHeight} />}
            <div
              key="doc-surface"
              ref={surfaceRef}
              className={
                layout === 'page'
                  ? `tl-editor relative mt-2 w-[816px] max-w-full rounded-sm px-10 py-12 shadow-xl sm:px-24 sm:py-20 ${isLight ? 'bg-white' : 'bg-[#0a1430]'}`
                  : 'tl-editor relative mx-auto min-h-full w-full max-w-4xl px-6 py-10 sm:px-12 sm:py-14'
              }
              style={layout === 'page' ? { minHeight: PAGE_H } : undefined}
            >
              {editorView}
              {layout === 'page' &&
                Array.from({ length: Math.max(0, Math.ceil(contentHeight / PAGE_H) - 1) }).map((_, i) => (
                  <div
                    key={i}
                    className="pointer-events-none absolute inset-x-0 flex items-center gap-2 px-3"
                    style={{ top: (i + 1) * PAGE_H }}
                  >
                    <div className={`h-px flex-1 border-t border-dashed ${isLight ? 'border-gray-300' : 'border-white/15'}`} />
                    <span className={`text-[9px] ${isLight ? 'text-gray-400' : 'text-gray-500'}`}>Page {i + 2}</span>
                    <div className={`h-px flex-1 border-t border-dashed ${isLight ? 'border-gray-300' : 'border-white/15'}`} />
                  </div>
                ))}
            </div>
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

      {muse && (
        <PrimeOSAssistant
          selText={muse.text}
          rect={muse.rect}
          isLight={isLight}
          onApply={applyMuse}
          onClose={() => setMuse(null)}
        />
      )}
    </div>
  )
}
