'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { SPACES, getSpace } from '@/lib/studio/spaces'
import { orgFeatureAllowed, type OrgRole } from '@/lib/permissions'
import PrimeOSMark from './PrimeOSMark'

export default function StudioSidebar({ userName, orgName, orgRole = 'owner' }: { userName: string; orgName: string; orgRole?: OrgRole }) {
  const parts = usePathname().split('/').filter(Boolean) // ['studio', space?, feature?]
  const activeId = parts[1] ?? 'workspace'
  const activeFeature = parts[2]
  const space = getSpace(activeId) ?? SPACES[2]
  const [unreadClientMessages, setUnreadClientMessages] = useState(0)
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  // Live unread-from-clients badge — same source + realtime channel the legacy
  // admin sidebar used, so counts stay in lockstep with the messages hub.
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
      .channel('studio-sidebar-badges')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => loadBadge())
      .subscribe()

    return () => {
      clearInterval(interval)
      supabase.removeChannel(channel)
    }
  }, [])

  return (
    <aside className="flex h-screen w-[264px] flex-shrink-0 flex-col border-r border-border bg-card">
      {/* brand */}
      <div className="flex h-16 flex-shrink-0 items-center gap-3 border-b border-border px-5">
        <div className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-background text-primary">
          <svg viewBox="0 0 48 48" fill="none" className="h-[26px] w-[26px]">
            <path d="M3 31 C 11 31, 13 13, 24 13 S 37 31, 45 31" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="3" cy="31" r="2.7" fill="currentColor" />
            <circle cx="24" cy="13" r="3.1" fill="currentColor" />
            <circle cx="45" cy="31" r="2.7" fill="currentColor" />
          </svg>
        </div>
        <div className="leading-tight">
          <div className="font-display text-[17px] font-bold text-foreground">Throughline</div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-faint">Studio OS</div>
        </div>
      </div>

      {/* space switcher */}
      <div className="flex gap-1 px-3 pt-3">
        {SPACES.map((s) => {
          const Icon = s.icon
          const active = s.id === activeId
          return (
            <Link
              key={s.id}
              href={`/studio/${s.id}`}
              className={`flex flex-1 flex-col items-center gap-1.5 rounded-lg border px-1 py-2.5 text-[11px] font-semibold transition-colors ${
                active
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-transparent text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
              }`}
            >
              <span className="relative">
                <Icon size={18} />
                {s.id === 'client' && unreadClientMessages > 0 && (
                  <span className="absolute -right-1.5 -top-1 h-2 w-2 rounded-full bg-destructive" />
                )}
              </span>
              {s.label}
            </Link>
          )
        })}
      </div>

      {/* active space blurb */}
      <div className="px-5 pb-1 pt-3">
        <p className="text-[10px] uppercase tracking-[0.18em] text-faint">{space.label}</p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">{space.blurb}</p>
      </div>

      {/* feature nav */}
      <nav className="mt-2 flex-1 space-y-0.5 overflow-y-auto px-3 pb-4 scrollbar-thin">
        {space.features.filter((f) => orgFeatureAllowed(orgRole, space.id, f.slug)).map((f) => {
          const Icon = f.icon
          const active = f.slug === activeFeature
          return (
            <Link
              key={f.slug}
              href={`/studio/${space.id}/${f.slug}`}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-[13px] transition-colors ${
                active ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
              }`}
            >
              {f.slug === 'ai-chat'
                ? <PrimeOSMark size={17} className="flex-shrink-0" />
                : <Icon size={16} className="flex-shrink-0" />}
              <span className="flex-1 truncate">{f.label}</span>
              {space.id === 'client' && f.slug === 'messages' && unreadClientMessages > 0 ? (
                <span className="min-w-[18px] rounded-full bg-destructive px-1.5 py-0.5 text-center text-[10px] font-bold text-destructive-foreground">
                  {unreadClientMessages > 9 ? '9+' : unreadClientMessages}
                </span>
              ) : (
                f.badge && <span className="text-[9px] font-bold tracking-wide text-primary">★ {f.badge}</span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* user footer */}
      <div className="flex-shrink-0 border-t border-border px-3 py-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
          <div className="grid h-8 w-8 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
            {userName.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[12.5px] font-semibold text-foreground">{userName}</div>
            <div className="truncate text-[10px] text-faint">Owner · {orgName}</div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            title="Sign out"
            aria-label="Sign out"
            className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </aside>
  )
}
