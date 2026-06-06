'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import StoryboardHome from './StoryboardHome'
import StoryboardBoard from './StoryboardBoard'

// Storyboard entry: the boards home by default; the live shot board when a
// ?board=<id> is selected.
function StoryboardInner() {
  const boardId = useSearchParams().get('board')
  return boardId ? <StoryboardBoard boardId={boardId} /> : <StoryboardHome />
}

export default function Storyboard() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          <Loader2 size={18} className="mr-2 animate-spin" /> Loading…
        </div>
      }
    >
      <StoryboardInner />
    </Suspense>
  )
}
