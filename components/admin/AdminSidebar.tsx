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

type Props = { adminName: string; companyName?: string }

const adminNavItems = [
  {
    section: 'Workspace',
    items: [
      { label: 'Dashboard', href: '/admin', icon: LayoutDashboard },
      { label: 'Clients', href: '/admin/clients', icon: Users },
      { label: 'Projects', href: '/admin/projects', icon: FolderOpen },
    ],
  },
  {
    section: 'Communication',
    items: [
      { label: 'Messages', href: '/admin/messages', icon: MessageSquare },
    ],
  },
  {
    section: 'Billing',
    items: [
      { label: 'Invoices', href: '/admin/invoices', icon: Receipt },
    ],
  },
  {
    section: 'Assets',
    items: [
      { label: 'File Vault', href: '/admin/files', icon: Files },
    ],
  },
  {
    section: 'Account',
    items: [
      { label: 'Settings', href: '/admin/settings', icon: Settings },
    ],
  },
]

export default function AdminSidebar({ adminName, companyName = 'McPrime Digital' }: Props) {
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
      {/* Logo + company name + Admin badge (extreme top-left) — fixed 60px
          height so its bottom border aligns with the topbar's */}
      <div className="flex items-center gap-2.5 px-4 h-[60px] flex-shrink-0 border-b border-border">
        <McPrimeLogo height={32} />
        <div className="min-w-0">
          <p className="text-sm font-bold leading-tight truncate text-foreground">
            {companyName}
          </p>
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
            <Shield size={9} />
            Admin Panel
          </span>
        </div>
      </div>

      {/* Nav — grouped like the client portal */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6 scrollbar-thin">
        {adminNavItems.map((group) => (
          <div key={group.section}>
            <p className="text-[11px] font-semibold uppercase tracking-widest px-3 mb-2 text-faint">
              {group.section}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
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
          </div>
        ))}
      </nav>

      {/* Sign out (extreme bottom-left) */}
      <div className="px-3 py-4 border-t border-border">
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors text-muted-foreground hover:text-destructive hover:bg-secondary"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
      </aside>
    </>
  )
}
