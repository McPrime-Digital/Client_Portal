'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  FolderOpen,
  MessageSquare,
  Receipt,
  Files,
  Settings,
  LogOut,
  Shield,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useSidebarStore } from '@/lib/stores/sidebar-store'
import McPrimeLogo from '@/components/McPrimeLogo'

type Props = { adminName: string }

const adminNavItems = [
  {
    label: 'Dashboard',
    href: '/admin',
    icon: LayoutDashboard,
  },
  {
    label: 'Clients',
    href: '/admin/clients',
    icon: Users,
  },
  {
    label: 'Projects',
    href: '/admin/projects',
    icon: FolderOpen,
  },
  {
    label: 'File Vault',
    href: '/admin/files',
    icon: Files,
  },
  {
    label: 'Messages',
    href: '/admin/messages',
    icon: MessageSquare,
  },
  {
    label: 'Invoices',
    href: '/admin/invoices',
    icon: Receipt,
  },
  {
    label: 'Settings',
    href: '/admin/settings',
    icon: Settings,
  },
]

export default function AdminSidebar({ adminName }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const { isOpen, close } = useSidebarStore()
  const [unreadClientMessages, setUnreadClientMessages] = useState(0)

  // Close the mobile drawer on navigation; lock body scroll while open.
  useEffect(() => { close() }, [pathname, close])
  useEffect(() => {
    if (typeof document === 'undefined') return
    document.body.style.overflow = isOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  useEffect(() => {
    const supabase = createClient()

    async function loadBadge() {
      try {
        const res = await fetch('/api/admin/badge-counts')
        if (res.ok) {
          const json = await res.json()
          setUnreadClientMessages(json.unreadClientMessages ?? 0)
        }
      } catch {}
    }

    loadBadge()
    const interval = setInterval(loadBadge, 15_000)

    const channel = supabase
      .channel('admin-sidebar-badges')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' },
        () => loadBadge())
      .subscribe()

    return () => {
      clearInterval(interval)
      supabase.removeChannel(channel)
    }
  }, [])

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <>
      {/* Mobile backdrop — tap to close. Hidden on lg+. */}
      <div
        onClick={close}
        aria-hidden
        className={`fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden transition-opacity duration-200 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col w-[260px] h-screen bg-card border-r border-border transition-transform duration-200 ease-out lg:static lg:z-auto lg:w-[240px] lg:flex-shrink-0 lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
      {/* Logo + Admin badge — fixed 60px height so its bottom border aligns with the topbar's */}
      <div className="flex items-center gap-3 px-5 h-[60px] flex-shrink-0 border-b border-border">
        <McPrimeLogo height={34} />
        <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-primary">
          <Shield size={10} />
          Admin Panel
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4">
        <div className="space-y-0.5">
          {adminNavItems.map((item) => {
            const Icon = item.icon
            const isActive =
              item.href === '/admin'
                ? pathname === '/admin'
                : pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={close}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-all ${
                  isActive
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                }`}
              >
                <Icon size={16} />
                {item.label}
                {item.href === '/admin/messages' && unreadClientMessages > 0 && (
                  <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center bg-destructive text-destructive-foreground">
                    {unreadClientMessages > 9 ? '9+' : unreadClientMessages}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      </nav>

      {/* Admin user card */}
      <div className="px-3 py-4 border-t border-border">
        <div className="flex items-center gap-3 px-3 py-2 rounded-md">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 bg-primary text-primary-foreground">
            {adminName[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate text-foreground">
              {adminName}
            </p>
            <p className="text-xs text-primary">
              Administrator
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="p-1.5 rounded-md transition-colors text-faint hover:text-destructive hover:bg-secondary"
            title="Sign out"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
      </aside>
    </>
  )
}
