'use client'

import * as Y from 'yjs'
import { useTheme } from 'next-themes'
import { useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import type { SupabaseYjsProvider } from '@/lib/collab/supabaseYjs'

// BlockNote editor bound to a shared Y.Doc + sync provider. Owns the writing
// surface: wide, tall, transparent (page shows through), and clicking anywhere
// in the surface focuses the editor (so the cursor activates over the whole page).
export default function CollabEditor({
  ydoc,
  provider,
  userName,
}: {
  ydoc: Y.Doc
  provider: SupabaseYjsProvider
  userName: string
}) {
  const { resolvedTheme } = useTheme()
  const editor = useCreateBlockNote({
    collaboration: {
      provider,
      fragment: ydoc.getXmlFragment('blocknote'),
      user: { name: userName, color: provider.userColor },
    },
  })

  return (
    <div
      className="tl-editor mx-auto min-h-full w-full max-w-5xl px-6 py-10 sm:px-12 sm:py-14"
      onMouseDown={(e) => {
        // Clicking the margins / empty space focuses the editor instead of dead-ending.
        const t = e.target as HTMLElement
        if (t && !t.closest('.ProseMirror') && !t.closest('button') && !t.closest('a')) {
          e.preventDefault()
          editor.focus()
        }
      }}
    >
      <BlockNoteView editor={editor} theme={resolvedTheme === 'light' ? 'light' : 'dark'} />
    </div>
  )
}
