'use client'

import { useEffect, useState } from 'react'
import * as Y from 'yjs'
import { useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import {
  Undo2, Redo2, Pilcrow, Heading1, Heading2, Heading3,
  Bold, Italic, Underline, Strikethrough, Code,
  List, ListOrdered, ListChecks, AlignLeft, AlignCenter, AlignRight, Link2, ListTree,
} from 'lucide-react'
import type { SupabaseYjsProvider } from '@/lib/collab/supabaseYjs'

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
export default function DocEditor({
  ydoc,
  provider,
  userName,
  fragmentKey,
  theme,
}: {
  ydoc: Y.Doc
  provider: SupabaseYjsProvider
  userName: string
  fragmentKey: string
  theme: 'light' | 'dark'
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

  return (
    <div className="flex h-full flex-col">
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
      </div>

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
            <BlockNoteView editor={editor} theme={theme} />
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
