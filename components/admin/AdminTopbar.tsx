'use client'

import { usePathname } from 'next/navigation'
import { ChevronRight, Shield, Menu } from 'lucide-react'
import { useSidebarStore } from '@/lib/stores/sidebar-store'
import ThemeToggle from '../ThemeToggle'
import AdminNotificationBell from './AdminNotificationBell'

type Props = { adminName: string }

const routeNames: Record<string, string> = {
  '/admin': 'Overview',
  '/admin/clients': 'Clients',
  '/admin/projects': 'Projects',
  '/admin/files': 'File Vault',
  '/admin/messages': 'Messages',
  '/admin/invoices': 'Invoices',
  '/admin/settings': 'Settings',
}

export default function AdminTopbar({ adminName }: Props) {
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
        <div className="text-xs px-3 py-1 rounded-full font-medium bg-primary/10 text-primary border border-primary/20">
          {adminName}
        </div>
      </div>
    </header>
  )
}
