'use client'

import { usePathname } from 'next/navigation'
import { ChevronRight, Shield, Menu } from 'lucide-react'
import { useSidebarStore } from '@/lib/stores/sidebar-store'
import ThemeToggle from '../ThemeToggle'
import AdminNotificationBell from './AdminNotificationBell'

type Props = { adminName: string; adminRole?: string }

const routeNames: Record<string, string> = {
  '/admin': 'Overview',
  '/admin/clients': 'Clients',
  '/admin/projects': 'Projects',
  '/admin/files': 'File Vault',
  '/admin/messages': 'Messages',
  '/admin/invoices': 'Invoices',
  '/admin/settings': 'Settings',
}

export default function AdminTopbar({ adminName, adminRole = 'Owner' }: Props) {
  const pathname = usePathname()
  const { toggle } = useSidebarStore()
  const pageName =
    routeNames[pathname] ??
    (pathname.includes('/admin/clients/') ? 'Client Detail' :
    pathname.includes('/admin/projects/') ? 'Project Detail' :
    'Admin')

  return (
    <header className="flex items-center justify-between px-6 lg:px-8 flex-shrink-0 h-[60px] bg-card border-b border-border">
      <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-0">
        <button
          onClick={toggle}
          className="lg:hidden p-2 -ml-2 rounded-md transition-colors text-muted-foreground hover:text-foreground"
          aria-label="Open menu"
        >
          <Menu size={18} />
        </button>
        <Shield size={14} className="text-primary flex-shrink-0" />
        <span className="text-primary">Admin</span>
        <ChevronRight size={12} className="text-faint flex-shrink-0" />
        <span className="text-foreground truncate">{pageName}</span>
      </div>
      <div className="flex items-center gap-2">
        <AdminNotificationBell />
        <ThemeToggle />
        {/* Owner / manager identity (extreme top-right) */}
        <div className="flex items-center gap-2.5 pl-2">
          <div className="hidden sm:block text-right leading-tight">
            <p className="text-sm font-semibold text-foreground truncate max-w-[160px]">{adminName}</p>
            <p className="text-[11px] text-primary">{adminRole}</p>
          </div>
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 bg-primary text-primary-foreground">
            {adminName?.[0]?.toUpperCase() ?? 'A'}
          </div>
        </div>
      </div>
    </header>
  )
}
