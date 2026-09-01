'use client'

import { usePathname } from 'next/navigation'
import { Menu, Search, PictureInPicture2 } from 'lucide-react'
import ThemeToggle from '@/components/ThemeToggle'
import AdminNotificationBell from '@/components/admin/AdminNotificationBell'
import { getSpace } from '@/lib/studio/spaces'
import { useSessionStore } from '@/lib/stores/session-store'
import { useSidebarStore } from '@/lib/stores/sidebar-store'

export default function StudioTopbar() {
  const parts = usePathname().split('/').filter(Boolean)
  const space = getSpace(parts[1] ?? 'crew')
  const feature = space?.features.find((f) => f.slug === parts[2])
  const { mode, open, setMode } = useSessionStore()
  const { toggle } = useSidebarStore()

  return (
    <header className="glass-panel squircle-lg relative flex h-14 flex-shrink-0 items-center gap-3 px-3 sm:px-5">
      {/* mobile: open the rail drawer */}
      <button
        type="button"
        onClick={toggle}
        aria-label="Open navigation"
        className="grid h-9 w-9 flex-shrink-0 place-items-center squircle-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground lg:hidden"
      >
        <Menu size={17} />
      </button>

      <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
        <span className="hidden sm:inline">{space?.label ?? 'Studio'}</span>
        {feature && (
          <>
            <span className="hidden text-faint sm:inline">›</span>
            <span className="truncate font-semibold text-foreground">{feature.label}</span>
          </>
        )}
      </div>

      {/* Search — dead center of the bar, out of the reading path. */}
      <button
        type="button"
        className="glass-inset squircle-sm group absolute left-1/2 top-1/2 hidden w-72 -translate-x-1/2 -translate-y-1/2 items-center gap-2 px-3 py-2 text-xs text-faint transition-colors hover:text-muted-foreground md:flex lg:w-80 xl:w-96"
      >
        <Search size={14} className="icon-live flex-shrink-0" />
        <span className="truncate">Search projects, assets, people…</span>
        <span className="ml-auto flex-shrink-0 rounded-md border border-glow/25 px-1.5 text-[10px]">⌘K</span>
      </button>

      <div className="ml-auto flex flex-shrink-0 items-center gap-1.5 sm:gap-2">
        <button
          type="button"
          title="Open / restore session (page-in-view)"
          onClick={() => (mode === 'closed' ? open('Brand Film — Aurora v3', 'storyboard') : setMode('docked'))}
          className="grid h-9 w-9 place-items-center squircle-sm border border-glow/20 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <PictureInPicture2 size={16} className="icon-live" />
        </button>
        <ThemeToggle />
        <AdminNotificationBell />
      </div>
    </header>
  )
}
