'use client'

import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import { useSidebarStore } from '@/lib/stores/sidebar-store'

import NotificationBell from '../portal/NotificationBell'
import ThemeToggle from '../ThemeToggle'

type Props = {
  clientName: string
  clientId: string
  memberRole?: 'owner' | 'approver' | 'member' | 'viewer'
  // custom role name (owner-set); overrides the standard label
  roleTitle?: string | null
}

const ROLE_LABEL: Record<string, string> = {
  owner: 'Account owner',
  approver: 'Approver',
  member: 'Team member',
  viewer: 'Viewer',
}

const routeNames: Record<string, string> = {
  '/dashboard': 'Overview',
  '/projects': 'Projects',
  '/approvals': 'Review & Approvals',
  '/team': 'Your team',
  '/files': 'File Vault',
  '/messages': 'Messages',
  '/invoices': 'Invoices',
  '/dashboard/settings': 'Settings',
}

export default function Topbar({ clientName, clientId, memberRole = 'owner', roleTitle = null }: Props) {
  const pathname = usePathname()
  const { toggle } = useSidebarStore()

  const pageName =
    routeNames[pathname] ??
    (pathname.startsWith('/projects/') ? 'Project Detail' : 'Portal')

  return (
    <header className="glass-panel squircle-lg flex h-14 flex-shrink-0 items-center justify-between px-4 sm:px-6">
      {/* Left — current section */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={toggle}
          className="lg:hidden grid h-9 w-9 -ml-1 place-items-center squircle-sm transition-colors text-muted-foreground hover:bg-secondary hover:text-foreground"
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

        {/* The signed-in member — their own name and role, top-right */}
        <div className="flex items-center gap-2.5 pl-1">
          <div className="hidden sm:block text-right leading-tight">
            <p className="text-sm font-semibold text-foreground truncate max-w-[140px]">
              {clientName?.split(' ')[0] ?? 'Account'}
            </p>
            <p className="text-[11px] text-primary">{roleTitle ?? ROLE_LABEL[memberRole] ?? 'Member'}</p>
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
