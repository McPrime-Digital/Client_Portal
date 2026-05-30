'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard,
  FolderOpen,
  MessageSquare,
  Files,
  LogOut,
  Receipt,
  Settings,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useSidebarStore } from '@/lib/stores/sidebar-store'

type Props = {
  clientName: string
  clientCompany?: string | null
  clientId: string
  clientAvatar?: string | null
}

const navItems = [
  {
    section: 'Workspace',
    items: [
      { label: 'Overview', href: '/dashboard', icon: LayoutDashboard },
      { label: 'Projects', href: '/projects', icon: FolderOpen },
    ],
  },
  {
    section: 'Communication',
    items: [
      { label: 'Messages', href: '/messages', icon: MessageSquare },
      { label: 'Invoices', href: '/invoices', icon: Receipt },
    ],
  },
  {
    section: 'Assets',
    items: [
      { label: 'File Vault', href: '/files', icon: Files },
    ],
  },
  {
    section: 'Account',
    items: [
      { label: 'Settings', href: '/dashboard/settings', icon: Settings },
    ],
  },
]

export default function Sidebar({ clientName, clientCompany, clientId, clientAvatar }: Props) {
  // The portal is the client's own — brand it with their company (their logo if uploaded).
  const brandName = clientCompany || clientName || 'Client'
  const pathname = usePathname()
  const router = useRouter()
  const { close } = useSidebarStore()

  const [unreadMessages, setUnreadMessages] = useState(0)
  const [unpaidInvoices, setUnpaidInvoices] = useState(0)

  useEffect(() => {
    if (!clientId) return
    const supabase = createClient()

    async function loadBadges() {
      // Fetch messages via server API (bypasses RLS)
      try {
        const res = await fetch('/api/portal/badge-counts')
        if (res.ok) {
          const json = await res.json()
          setUnreadMessages(json.unreadMessages ?? 0)
          setUnpaidInvoices(json.unpaidInvoices ?? 0)
        }
      } catch {}
    }

    loadBadges()
    const interval = setInterval(loadBadges, 15_000)

    // Realtime subscription still fires when replication is on
    const channel = supabase
      .channel('sidebar-badges')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' },
        () => loadBadges())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' },
        () => loadBadges())
      .subscribe()

    return () => {
      clearInterval(interval)
      supabase.removeChannel(channel)
    }
  }, [clientId])

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <aside className="hidden lg:flex flex-col w-[240px] flex-shrink-0 h-screen bg-card border-r border-border">
      {/* Logo — client-branded; fixed 60px height so its bottom border aligns with the topbar's */}
      <div className="flex items-center gap-3 px-5 h-[60px] flex-shrink-0 border-b border-border">
        {clientAvatar ? (
          <div className="w-[30px] h-[30px] rounded-lg overflow-hidden flex-shrink-0 border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={clientAvatar} alt="" className="w-full h-full object-cover" />
          </div>
        ) : (
          // No client logo uploaded — show their initial (never the McPrime mark).
          <div
            className="w-[30px] h-[30px] rounded-lg flex items-center justify-center flex-shrink-0 font-bold text-sm bg-primary text-primary-foreground"
            aria-label={`${brandName} Portal`}
          >
            {brandName[0]?.toUpperCase() ?? 'C'}
          </div>
        )}
        <div className="leading-tight min-w-0">
          <div className="font-display font-bold text-sm text-foreground truncate" title={brandName}>
            {brandName}
          </div>
          <div className="text-[11px] uppercase tracking-widest text-faint">
            Portal
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6 scrollbar-thin">
        {navItems.map((section) => (
          <div key={section.section}>
            <p className="text-[11px] font-semibold uppercase tracking-widest px-3 mb-2 text-faint">
              {section.section}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon
                const isActive =
                  pathname === item.href ||
                  pathname.startsWith(item.href + '/')
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={close}
                    className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-all duration-150 ${
                      isActive
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                    }`}
                  >
                    <Icon size={16} />
                    {item.label}

                    {item.href === '/messages' && unreadMessages > 0 && (
                      <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center bg-destructive text-destructive-foreground">
                        {unreadMessages > 9 ? '9+' : unreadMessages}
                      </span>
                    )}

                    {item.href === '/invoices' && unpaidInvoices > 0 && (
                      <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center bg-primary text-primary-foreground">
                        {unpaidInvoices}
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User card */}
      <div className="px-3 py-4 border-t border-border">
        <div className="flex items-center gap-3 px-3 py-2 rounded-md">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 overflow-hidden bg-primary text-primary-foreground">
            {clientAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={clientAvatar} alt="" className="w-full h-full object-cover" />
            ) : (
              clientName?.[0]?.toUpperCase() ?? 'C'
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate text-foreground">
              {clientName}
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
  )
}
