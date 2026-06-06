'use client'

import * as Y from 'yjs'
import { useTheme } from 'next-themes'
import { useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import type { SupabaseYjsProvider } from '@/lib/collab/supabaseYjs'

// The BlockNote editor bound to a shared Y.Doc + sync provider. Renders live
// remote cursors via the provider's awareness.
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
    <BlockNoteView
      editor={editor}
      theme={resolvedTheme === 'light' ? 'light' : 'dark'}
      className="min-h-[58vh]"
    />
  )
}
