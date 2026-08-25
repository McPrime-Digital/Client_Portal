'use client'

import { usePathname } from 'next/navigation'
import { Search, PictureInPicture2 } from 'lucide-react'
import ThemeToggle from '@/components/ThemeToggle'
import AdminNotificationBell from '@/components/admin/AdminNotificationBell'
import { getSpace } from '@/lib/studio/spaces'
import { useSessionStore } from '@/lib/stores/session-store'

export default function StudioTopbar() {
  const parts = usePathname().split('/').filter(Boolean)
  const space = getSpace(parts[1] ?? 'workspace')
  const feature = space?.features.find((f) => f.slug === parts[2])
  const { mode, open, setMode } = useSessionStore()

  return (
    <header className="flex h-16 flex-shrink-0 items-center gap-4 border-b border-border bg-background/60 px-6 backdrop-blur">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>{space?.label ?? 'Studio'}</span>
        {feature && (
          <>
            <span className="text-faint">›</span>
            <span className="font-semibold text-foreground">{feature.label}</span>
          </>
        )}
      </div>

      <div className="ml-2 hidden max-w-md flex-1 items-center gap-2 rounded-lg border border-border bg-card/50 px-3 py-2 text-xs text-faint sm:flex">
        <Search size={15} />
        Search projects, assets, people…
        <span className="ml-auto rounded border border-border px-1.5 text-[10px]">⌘K</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          title="Open / restore session (page-in-view)"
          onClick={() => (mode === 'closed' ? open('Brand Film — Aurora v3', 'storyboard') : setMode('docked'))}
          className="grid h-9 w-9 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <PictureInPicture2 size={16} />
        </button>
        <ThemeToggle />
        <AdminNotificationBell />
      </div>
    </header>
  )
}
