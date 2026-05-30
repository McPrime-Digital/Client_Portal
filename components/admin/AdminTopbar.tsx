'use client'

import { usePathname } from 'next/navigation'
import { ChevronRight, Shield } from 'lucide-react'
import ThemeToggle from '../ThemeToggle'

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
  const pageName =
    routeNames[pathname] ??
    (pathname.includes('/admin/clients/') ? 'Client Detail' :
    pathname.includes('/admin/projects/') ? 'Project Detail' :
    'Admin')

  return (
    <header className="flex items-center justify-between px-6 lg:px-8 flex-shrink-0 h-[60px] bg-card border-b border-border">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Shield size={14} className="text-primary" />
        <span className="text-primary">Admin</span>
        <ChevronRight size={12} className="text-faint" />
        <span className="text-foreground">{pageName}</span>
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <div className="text-xs px-3 py-1 rounded-full font-medium bg-primary/10 text-primary border border-primary/20">
          {adminName}
        </div>
      </div>
    </header>
  )
}
