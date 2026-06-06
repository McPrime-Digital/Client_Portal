'use client'

import * as Y from 'yjs'
import { useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import type { SupabaseYjsProvider } from '@/lib/collab/supabaseYjs'

// BlockNote editor bound to the active tab's Y.Doc fragment. `theme` is the
// PER-DOCUMENT light/dark (independent of the app theme). The surface is
// transparent (page shows through) and clicking anywhere focuses the editor.
export default function CollabEditor({
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

  return (
    <div
      className="tl-editor mx-auto min-h-full w-full max-w-5xl px-6 py-10 sm:px-12 sm:py-14"
      onMouseDown={(e) => {
        const t = e.target as HTMLElement
        if (t && !t.closest('.ProseMirror') && !t.closest('button') && !t.closest('a')) {
          e.preventDefault()
          editor.focus()
        }
      }}
    >
      <BlockNoteView editor={editor} theme={theme} />
    </div>
  )
}
