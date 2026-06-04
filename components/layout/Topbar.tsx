'use client'

import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import { useSidebarStore } from '@/lib/stores/sidebar-store'

import NotificationBell from '../portal/NotificationBell'
import ThemeToggle from '../ThemeToggle'

type Props = {
  clientName: string
  clientId: string
}

const routeNames: Record<string, string> = {
  '/dashboard': 'Overview',
  '/projects': 'Projects',
  '/files': 'File Vault',
  '/messages': 'Messages',
  '/invoices': 'Invoices',
  '/dashboard/settings': 'Settings',
}

export default function Topbar({ clientName, clientId }: Props) {
  const pathname = usePathname()
  const { toggle } = useSidebarStore()

  const pageName =
    routeNames[pathname] ??
    (pathname.startsWith('/projects/') ? 'Project Detail' : 'Portal')

  return (
    <header className="flex items-center justify-between px-6 lg:px-8 flex-shrink-0 h-[60px] bg-card border-b border-border">
      {/* Left — current section */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={toggle}
          className="lg:hidden p-2 -ml-2 rounded-md transition-colors text-muted-foreground hover:text-foreground"
          aria-label="Open menu"
        >
          <Menu size={18} />
        </button>
        <p className="text-sm font-semibold text-foreground truncate">{pageName}</p>
      </div>

      {/* Right */}
      <div className="flex items-center gap-2">
        <ThemeToggle />

        {/* Notification bell */}
        {clientId && (
          <NotificationBell clientId={clientId} />
        )}

        {/* Account owner / manager — first name at the extreme top-right */}
        <div className="flex items-center gap-2.5 pl-1">
          <div className="hidden sm:block text-right leading-tight">
            <p className="text-sm font-semibold text-foreground truncate max-w-[140px]">
              {clientName?.split(' ')[0] ?? 'Account'}
            </p>
            <p className="text-[11px] text-primary">Account owner</p>
          </div>
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold cursor-pointer transition-opacity hover:opacity-80 bg-primary text-primary-foreground"
            title={clientName}
          >
            {clientName?.[0]?.toUpperCase() ?? 'C'}
          </div>
        </div>
      </div>
    </header>
  )
}
