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
  Settings2, Ruler as RulerIcon, Indent, Outdent, ImagePlus, Rows3,
} from 'lucide-react'
import type { SupabaseYjsProvider } from '@/lib/collab/supabaseYjs'
import { SCRIPT_TEMPLATES } from '@/lib/studio/scriptTemplates'
import { docSchema } from '@/lib/studio/editorSchema'
import { FONT_FAMILIES, FONT_SIZES } from '@/lib/studio/fonts'
import { createClient } from '@/lib/supabase/client'
import { paginationPlugin, paginationKey } from '@/lib/studio/pagination'
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

// Premium Google-Docs-style ruler — sits in the canvas above the page (not on it),
// inch + half-inch ticks, shaded margins, and DRAGGABLE left/right margin stops.
const PAGE_W = 816 // Letter @ 96dpi
function PageRuler({
  isLight,
  margins,
  setMargins,
}: {
  isLight: boolean
  margins: { left: number; right: number }
  setMargins: (fn: (m: { left: number; right: number }) => { left: number; right: number }) => void
}) {
  const PPI = 96
  const ref = useRef<HTMLDivElement>(null)
  const dragRef = useRef<'left' | 'right' | null>(null)
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current || !ref.current) return
      const rect = ref.current.getBoundingClientRect()
      const scale = rect.width / PAGE_W
      const x = Math.max(0, Math.min(PAGE_W, (e.clientX - rect.left) / scale))
      if (dragRef.current === 'left') setMargins((m) => ({ ...m, left: Math.round(Math.max(0, Math.min(PAGE_W - m.right - 96, x))) }))
      else setMargins((m) => ({ ...m, right: Math.round(Math.max(0, Math.min(PAGE_W - m.left - 96, PAGE_W - x))) }))
    }
    const onUp = () => { dragRef.current = null }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
  }, [setMargins])

  const tick = isLight ? 'bg-gray-400' : 'bg-white/35'
  const marginBg = isLight ? 'bg-gray-300/70' : 'bg-white/[0.08]'
  const barBg = isLight ? 'bg-white' : 'bg-[#0e1a3a]'
  const num = isLight ? 'text-gray-500' : 'text-gray-400'
  return (
    <div
      ref={ref}
      className={`relative mx-auto hidden h-6 w-[816px] max-w-full select-none overflow-hidden rounded ${barBg} ring-1 ${isLight ? 'ring-black/10' : 'ring-white/10'} sm:block`}
    >
      <div className={`absolute inset-y-0 left-0 ${marginBg}`} style={{ width: margins.left }} />
      <div className={`absolute inset-y-0 right-0 ${marginBg}`} style={{ width: margins.right }} />
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} className="absolute bottom-0" style={{ left: i * PPI }}>
          <span className={`absolute bottom-0 left-0 ${tick}`} style={{ width: 1, height: 8 }} />
          {i < 8 && <span className={`absolute bottom-0 ${tick}`} style={{ left: PPI / 2, width: 1, height: 4 }} />}
          {i > 0 && i < 8 && <span className={`absolute bottom-[8px] left-[3px] text-[8px] leading-none ${num}`}>{i}</span>}
        </div>
      ))}
      {/* draggable margin stops */}
      <div
        onPointerDown={(e) => { e.preventDefault(); dragRef.current = 'left' }}
        title="Left margin — drag to adjust"
        className="absolute top-0 z-10 h-full w-3 -translate-x-1/2 cursor-ew-resize"
        style={{ left: margins.left }}
      >
        <div className="mx-auto h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent" style={{ borderTopColor: 'hsl(var(--primary))' }} />
        <div className="mx-auto mt-px h-2 w-px" style={{ background: 'hsl(var(--primary))' }} />
      </div>
      <div
        onPointerDown={(e) => { e.preventDefault(); dragRef.current = 'right' }}
        title="Right margin — drag to adjust"
        className="absolute top-0 z-10 h-full w-3 -translate-x-1/2 cursor-ew-resize"
        style={{ left: PAGE_W - margins.right }}
      >
        <div className="mx-auto h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent" style={{ borderTopColor: 'hsl(var(--primary))' }} />
        <div className="mx-auto mt-px h-2 w-px" style={{ background: 'hsl(var(--primary))' }} />
      </div>
    </div>
  )
}

// Vertical ruler attached to the left panel (not the page). Half-inch ticks.
function VerticalRuler({ isLight }: { isLight: boolean }) {
  const tick = isLight ? 'bg-gray-400' : 'bg-white/30'
  return (
    <div className={`relative w-[22px] flex-shrink-0 overflow-hidden border-r ${isLight ? 'border-black/10 bg-[#eceff1]' : 'border-white/10 bg-[#0a1530]'}`}>
      {Array.from({ length: 44 }).map((_, i) => (
        <div key={i} className="absolute right-0" style={{ top: i * 48 }}>
          <span className={`absolute right-0 ${tick}`} style={{ width: i % 2 === 0 ? 8 : 4, height: 1 }} />
          {i % 2 === 0 && i > 0 && (
            <span className={`absolute right-[2px] top-[1px] text-[7px] leading-none ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>{i / 2}</span>
          )}
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
  const [viewOpen, setViewOpen] = useState(false)
  const [menuBar, setMenuBar] = useState<string | null>(null)
  const [styleOpen, setStyleOpen] = useState(false)
  const [zoomOpen, setZoomOpen] = useState(false)
  const [lineOpen, setLineOpen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [lineSpacing, setLineSpacing] = useState(1.5)
  const [showRuler, setShowRuler] = useState(true)
  useEffect(() => {
    try {
      const v = localStorage.getItem('tl-showruler')
      if (v === '0') setShowRuler(false)
    } catch { /* ignore */ }
  }, [])
  const toggleRuler = () => setShowRuler((s) => {
    try { localStorage.setItem('tl-showruler', s ? '0' : '1') } catch { /* ignore */ }
    return !s
  })
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

  // Live pagination: a ProseMirror plugin inserts page-break spacers so content
  // flows onto the next page sheet (top + bottom margins), like Google Docs.
  const PAGE_H = 1056 // Letter @ 96dpi
  const PAGE_TOP = 72
  const PAGE_BOT = 72
  const PAGE_GAP = 24
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  useEffect(() => {
    const tip = editor._tiptapEditor
    if (!tip?.registerPlugin) return
    const plugin = paginationPlugin(() => layoutRef.current === 'page', {
      pageH: PAGE_H,
      topM: PAGE_TOP,
      botM: PAGE_BOT,
      gap: PAGE_GAP,
    })
    tip.registerPlugin(plugin)
    return () => {
      try {
        tip.unregisterPlugin(paginationKey)
      } catch {
        /* noop */
      }
    }
  }, [editor])

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

  // Page margins (adjustable via the ruler), remembered per doc.
  const [margins, setMargins] = useState({ left: 96, right: 96 })
  useEffect(() => {
    try {
      const v = localStorage.getItem(`tl-docmargins-${docId}`)
      if (v) {
        const p = JSON.parse(v)
        if (typeof p?.left === 'number' && typeof p?.right === 'number') setMargins(p)
      }
    } catch {
      /* ignore */
    }
  }, [docId])
  useEffect(() => {
    try {
      localStorage.setItem(`tl-docmargins-${docId}`, JSON.stringify(margins))
    } catch {
      /* ignore */
    }
  }, [margins, docId])
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
  const insertImage = () => {
    const url = window.prompt('Paste an image URL')
    if (!url) return
    try {
      const b = editor.getTextCursorPosition?.().block
      editor.insertBlocks([{ type: 'image', props: { url } } as any], b, 'after')
    } catch { /* noop */ }
    editor.focus()
  }
  const indent = (dir: 'in' | 'out') => {
    try { if (dir === 'in') editor.nestBlock?.(); else editor.unnestBlock?.() } catch { /* noop */ }
    editor.focus()
  }
  // current block style label for the "Normal text" dropdown
  const blockStyleLabel =
    type === 'heading' ? (level === 1 ? 'Heading 1' : level === 2 ? 'Heading 2' : 'Heading 3') :
    type === 'bulletListItem' || type === 'numberedListItem' || type === 'checkListItem' ? 'List item' : 'Normal text'

  const toggle = (s: string) => {
    ensureSelection()
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
  const openMuse = (fromRail = false) => {
    const text = (editor.getSelectedText?.() || window.getSelection()?.toString() || '').trim()
    if (!text && !fromRail) return // toolbar needs a selection; the rail opens a general chat
    const sel = typeof window !== 'undefined' ? window.getSelection() : null
    const rect = text && sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null
    const tip = editor._tiptapEditor
    const range = text && tip ? { from: tip.state.selection.from, to: tip.state.selection.to } : null
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
            <PrimeToolbarButton key="primeos" onMuse={() => openMuse()} />
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
      {/* menu bar — File · Edit · View · Insert · Format · Tools */}
      <div className={`flex flex-shrink-0 items-center gap-0.5 border-b px-2 py-0.5 text-[13px] ${barBg}`}>
        {([
          ['File', [
            { label: 'Print', fn: printDoc },
            { label: 'Download as PDF', fn: printDoc },
            { label: 'Download as Word (.doc)', fn: exportWord },
            { label: 'Download as HTML', fn: exportHtml },
            { label: 'Download as Markdown', fn: exportMarkdown },
            { label: 'Import Markdown…', fn: () => fileRef.current?.click() },
            { label: 'Version history', fn: toggleHistory },
          ]],
          ['Edit', [
            { label: 'Undo', fn: () => editor.undo() },
            { label: 'Redo', fn: () => editor.redo() },
            { label: 'Find & replace', fn: () => setShowFind(true) },
            { label: 'Clear formatting', fn: clearFormatting },
          ]],
          ['View', [
            { label: showRuler ? 'Hide ruler' : 'Show ruler', fn: toggleRuler },
            { label: layout === 'page' ? 'Pageless' : 'Pages', fn: toggleLayout },
            { label: mode === 'editing' ? 'Viewing (read-only)' : 'Editing', fn: () => setMode((m) => (m === 'editing' ? 'viewing' : 'editing')) },
          ]],
          ['Insert', [
            { label: 'Image', fn: insertImage },
            { label: 'Link', fn: addLink },
            { label: 'Comment', fn: () => setShowComments(true) },
          ]],
          ['Format', [
            { label: 'Bold', fn: () => toggle('bold') },
            { label: 'Italic', fn: () => toggle('italic') },
            { label: 'Underline', fn: () => toggle('underline') },
            { label: 'Heading 1', fn: () => setBlock('heading', { level: 1 }) },
            { label: 'Heading 2', fn: () => setBlock('heading', { level: 2 }) },
            { label: 'Normal text', fn: () => setBlock('paragraph') },
            { label: 'Clear formatting', fn: clearFormatting },
          ]],
          ['Tools', [
            { label: 'PrimeOS AI', fn: () => openMuse(true) },
            { label: `Word count: ${counts.words.toLocaleString()} words`, fn: () => editor.focus() },
            { label: `${counts.chars.toLocaleString()} characters`, fn: () => editor.focus() },
          ]],
          ['Extensions', [
            { label: 'PrimeOS AI', fn: () => openMuse(true) },
            { label: 'Comments', fn: () => setShowComments(true) },
            { label: 'Version history', fn: toggleHistory },
          ]],
          ['Help', [
            { label: 'Slash “/” for commands', fn: () => editor.focus() },
            { label: '⌘F — find & replace', fn: () => setShowFind(true) },
            { label: 'Select text → PrimeOS AI', fn: () => openMuse(true) },
          ]],
        ] as [string, { label: string; fn: () => void }[]][]).map(([name, items]) => (
          <div key={name} className="relative">
            <button
              onClick={() => setMenuBar((m) => (m === name ? null : name))}
              onMouseEnter={() => setMenuBar((m) => (m ? name : m))}
              className={`rounded px-2 py-0.5 transition-colors ${menuBar === name ? 'bg-primary/15 text-primary' : isLight ? 'text-gray-700 hover:bg-black/5' : 'text-gray-200 hover:bg-white/10'}`}
            >
              {name}
            </button>
            {menuBar === name && (
              <>
                <button aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setMenuBar(null)} />
                <div className={`absolute left-0 top-full z-20 mt-0.5 w-56 overflow-hidden rounded-xl border py-1 shadow-2xl ${isLight ? 'border-black/10 bg-white' : 'border-white/10 bg-[#0f1c3f]'}`}>
                  {items.map((it) => (
                    <button
                      key={it.label}
                      onClick={() => { setMenuBar(null); it.fn() }}
                      className={`block w-full px-3 py-1.5 text-left text-[13px] ${isLight ? 'text-gray-700 hover:bg-black/5' : 'text-gray-200 hover:bg-white/10'}`}
                    >
                      {it.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* persistent formatting toolbar */}
      <div className={`flex flex-shrink-0 flex-wrap items-center gap-0.5 border-b px-3 py-1.5 ${barBg}`}>
        <button className={btn} title="Undo" onClick={() => editor.undo()}><Undo2 size={16} /></button>
        <button className={btn} title="Redo" onClick={() => editor.redo()}><Redo2 size={16} /></button>
        <button className={btn} title="Print" onClick={printDoc}><Printer size={16} /></button>
        {/* zoom */}
        <div className="relative">
          <button className={`flex h-8 items-center gap-0.5 rounded-md px-1.5 text-xs ${isLight ? 'text-gray-700 hover:bg-black/5' : 'text-gray-200 hover:bg-white/10'}`} title="Zoom" onClick={() => setZoomOpen((o) => !o)}>
            {Math.round(zoom * 100)}% <ChevronDown size={12} className="opacity-60" />
          </button>
          {zoomOpen && (
            <>
              <button aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setZoomOpen(false)} />
              <div className={`absolute left-0 top-full z-20 mt-1 w-20 overflow-y-auto rounded-xl border py-1 shadow-2xl ${isLight ? 'border-black/10 bg-white' : 'border-white/10 bg-[#0f1c3f]'}`}>
                {[0.5, 0.75, 0.9, 1, 1.25, 1.5, 2].map((z) => (
                  <button key={z} onClick={() => { setZoom(z); setZoomOpen(false) }} className={`block w-full px-3 py-1 text-left text-sm ${z === zoom ? 'text-primary' : isLight ? 'text-gray-700 hover:bg-black/5' : 'text-gray-200 hover:bg-white/10'}`}>{Math.round(z * 100)}%</button>
                ))}
              </div>
            </>
          )}
        </div>
        <Sep />
        {/* styles dropdown */}
        <div className="relative">
          <button className={`flex h-8 items-center gap-1 rounded-md px-2 text-sm ${isLight ? 'text-gray-700 hover:bg-black/5' : 'text-gray-200 hover:bg-white/10'}`} title="Styles" onMouseDown={(e) => e.preventDefault()} onClick={() => setStyleOpen((o) => !o)}>
            <span className="w-20 truncate text-left">{blockStyleLabel}</span><ChevronDown size={13} className="opacity-60" />
          </button>
          {styleOpen && (
            <>
              <button aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setStyleOpen(false)} />
              <div className={`absolute left-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-xl border py-1 shadow-2xl ${isLight ? 'border-black/10 bg-white' : 'border-white/10 bg-[#0f1c3f]'}`}>
                {[
                  { label: 'Normal text', fn: () => setBlock('paragraph') },
                  { label: 'Heading 1', fn: () => setBlock('heading', { level: 1 }) },
                  { label: 'Heading 2', fn: () => setBlock('heading', { level: 2 }) },
                  { label: 'Heading 3', fn: () => setBlock('heading', { level: 3 }) },
                ].map((s) => (
                  <button key={s.label} onMouseDown={(e) => e.preventDefault()} onClick={() => { s.fn(); setStyleOpen(false) }} className={`block w-full px-3 py-1.5 text-left text-[13px] ${blockStyleLabel === s.label ? 'text-primary' : isLight ? 'text-gray-700 hover:bg-black/5' : 'text-gray-200 hover:bg-white/10'}`}>{s.label}</button>
                ))}
              </div>
            </>
          )}
        </div>
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
        {/* line spacing */}
        <div className="relative">
          <button className={btn} title="Line spacing" onClick={() => setLineOpen((o) => !o)}><Rows3 size={16} /></button>
          {lineOpen && (
            <>
              <button aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setLineOpen(false)} />
              <div className={`absolute left-0 top-full z-20 mt-1 w-24 overflow-hidden rounded-xl border py-1 shadow-2xl ${isLight ? 'border-black/10 bg-white' : 'border-white/10 bg-[#0f1c3f]'}`}>
                {[1, 1.15, 1.5, 2, 2.5].map((s) => (
                  <button key={s} onClick={() => { setLineSpacing(s); setLineOpen(false) }} className={`block w-full px-3 py-1 text-left text-sm ${s === lineSpacing ? 'text-primary' : isLight ? 'text-gray-700 hover:bg-black/5' : 'text-gray-200 hover:bg-white/10'}`}>{s.toFixed(2).replace(/\.00$/, '')}</button>
                ))}
              </div>
            </>
          )}
        </div>
        <button className={btn} title="Decrease indent" onClick={() => indent('out')}><Outdent size={16} /></button>
        <button className={btn} title="Increase indent" onClick={() => indent('in')}><Indent size={16} /></button>
        <Sep />
        <button className={btn} title="Add link" onClick={addLink}><Link2 size={16} /></button>
        <button className={btn} title="Insert image" onClick={insertImage}><ImagePlus size={16} /></button>
        <Sep />
        <button className={`${btn} ${showFind ? on : ''}`} title="Find & replace" onClick={() => setShowFind((s) => !s)}><Search size={16} /></button>
        <button className={`${btn} ${showHistory ? on : ''}`} title="Version history" onClick={toggleHistory}><History size={16} /></button>
        <button className={`${btn} ${showComments ? on : ''}`} title="Comments" onClick={() => setShowComments((s) => !s)}><MessageSquare size={16} /></button>
        <Sep />
        <div className="relative">
          <button className={`${btn} ${viewOpen ? on : ''}`} title="View options" onClick={() => setViewOpen((o) => !o)}><Settings2 size={16} /></button>
          {viewOpen && (
            <>
              <button aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setViewOpen(false)} />
              <div className={`absolute right-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-xl border py-1 shadow-2xl ${isLight ? 'border-black/10 bg-white' : 'border-white/10 bg-[#0f1c3f]'}`}>
                <button onClick={() => { toggleLayout(); setViewOpen(false) }} className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] ${isLight ? 'text-gray-700 hover:bg-black/5' : 'text-gray-200 hover:bg-white/10'}`}>
                  {layout === 'page' ? <StretchHorizontal size={14} className="opacity-70" /> : <FileText size={14} className="opacity-70" />}
                  {layout === 'page' ? 'Pageless view' : 'Pages view'}
                </button>
                <button onClick={toggleRuler} className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] ${isLight ? 'text-gray-700 hover:bg-black/5' : 'text-gray-200 hover:bg-white/10'}`}>
                  <RulerIcon size={14} className="opacity-70" /> {showRuler ? 'Hide ruler' : 'Show ruler'}
                </button>
                <button onClick={() => { setMode((m) => (m === 'editing' ? 'viewing' : 'editing')); setViewOpen(false) }} className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] ${isLight ? 'text-gray-700 hover:bg-black/5' : 'text-gray-200 hover:bg-white/10'}`}>
                  {mode === 'editing' ? <Eye size={14} className="opacity-70" /> : <PencilLine size={14} className="opacity-70" />}
                  {mode === 'editing' ? 'View mode (read-only)' : 'Edit mode'}
                </button>
              </div>
            </>
          )}
        </div>
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

      {/* horizontal ruler — attached to the upper panel, not floating on the page */}
      {layout === 'page' && showRuler && (
        <div className={`flex flex-shrink-0 items-center border-b py-1 ${barBg}`}>
          <div className="flex-shrink-0" style={{ width: 22 }} />
          <div className="min-w-0 flex-1 px-2"><PageRuler isLight={isLight} margins={margins} setMargins={setMargins} /></div>
          <div className="flex-shrink-0" style={{ width: 44 }} />
        </div>
      )}

      {/* body: [vertical ruler] · [canvas with real page gaps] · [panels] · [right rail] */}
      <div className="flex min-h-0 flex-1">
        {layout === 'page' && showRuler && <VerticalRuler isLight={isLight} />}
        <div
          className={`flex-1 overflow-y-auto ${layout === 'page' ? `px-4 pb-24 pt-5 ${isLight ? 'bg-[#f3f5f7]' : 'bg-[#070f24]'}` : ''}`}
          onMouseDown={(e) => {
            const t = e.target as HTMLElement
            if (t && !t.closest('.ProseMirror') && !t.closest('button') && !t.closest('a')) {
              e.preventDefault()
              editor.focus()
            }
          }}
        >
          {/* One persistent editor — content stays at a stable position (key) across
              page/pageless so the Yjs binding is never torn down (toggling never drops edits). */}
          <div className="flex justify-center">
            <div
              key="doc-surface"
              ref={surfaceRef}
              className={layout === 'page' ? 'relative w-[816px] max-w-full' : 'relative mx-auto w-full max-w-4xl'}
              style={{ zoom, ...(layout === 'page' ? { minHeight: PAGE_H } : {}) }}
            >
              {/* discrete page sheets with real gaps between them */}
              {layout === 'page' &&
                Array.from({ length: Math.max(1, Math.ceil(contentHeight / PAGE_H)) }).map((_, i) => (
                  <div
                    key={i}
                    className={`pointer-events-none absolute inset-x-0 rounded-sm shadow-xl ${isLight ? 'bg-white' : 'bg-[#0a1430]'}`}
                    style={{ top: i * PAGE_H, height: PAGE_H - PAGE_GAP }}
                  />
                ))}
              <div
                key="content"
                className={layout === 'page' ? 'tl-editor relative' : 'tl-editor relative px-6 py-10 sm:px-12 sm:py-14'}
                style={{ ['--tl-line' as string]: lineSpacing, ...(layout === 'page' ? { paddingLeft: margins.left, paddingRight: margins.right, paddingTop: PAGE_TOP, paddingBottom: PAGE_BOT } : {}) }}
              >
                {editorView}
              </div>
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

        {/* right rail — functional tools + live counter */}
        <div className={`flex w-11 flex-shrink-0 flex-col items-center gap-1 border-l py-2 ${isLight ? 'border-black/10 bg-black/[0.02]' : 'border-white/10 bg-white/[0.02]'}`}>
          {[
            { I: Aperture, title: 'PrimeOS AI', active: !!muse, fn: () => openMuse(true) },
            { I: ListTree, title: 'Outline', active: showOutline, fn: () => setShowOutline((s) => !s) },
            { I: MessageSquare, title: 'Comments', active: showComments, fn: () => setShowComments((s) => !s) },
            { I: History, title: 'Version history', active: showHistory, fn: toggleHistory },
            { I: Search, title: 'Find & replace', active: showFind, fn: () => setShowFind((s) => !s) },
          ].map(({ I, title, active, fn }) => (
            <button
              key={title}
              title={title}
              onClick={fn}
              className={`grid h-8 w-8 place-items-center rounded-lg transition-colors ${active ? 'bg-primary/15 text-primary' : isLight ? 'text-gray-500 hover:bg-black/5' : 'text-gray-300 hover:bg-white/10'}`}
            >
              <I size={16} />
            </button>
          ))}
          <div className={`mt-auto flex flex-col items-center pb-1 ${isLight ? 'text-gray-500' : 'text-gray-400'}`} title={`${counts.words.toLocaleString()} words · ${counts.chars.toLocaleString()} characters`}>
            <span className="text-[11px] font-bold leading-none">{counts.words.toLocaleString()}</span>
            <span className="text-[7px] uppercase tracking-wider">words</span>
            <span className="mt-1.5 text-[10px] font-semibold leading-none">{counts.chars.toLocaleString()}</span>
            <span className="text-[7px] uppercase tracking-wider">chars</span>
          </div>
        </div>
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
