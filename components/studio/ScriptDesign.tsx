'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import ScriptHome from './ScriptHome'
import ScriptEditorView from './ScriptEditorView'

// Script Design entry: the docs home (recent + templates) by default; the
// full-page collaborative editor when a ?doc=<id> is selected.
function ScriptDesignInner() {
  const params = useSearchParams()
  const docId = params.get('doc')
  return docId ? (
    <ScriptEditorView docId={docId} template={params.get('template') ?? undefined} />
  ) : (
    <ScriptHome />
  )
}

export default function ScriptDesign() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          <Loader2 size={18} className="mr-2 animate-spin" /> Loading…
        </div>
      }
    >
      <ScriptDesignInner />
    </Suspense>
  )
}
