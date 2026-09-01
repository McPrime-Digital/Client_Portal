'use client'

import ProductMark from '@/components/ProductMark'

import { Fragment, useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { SPACES, getSpace } from '@/lib/studio/spaces'
import { orgFeatureAllowed, type OrgRole } from '@/lib/permissions'
import { useSidebarStore } from '@/lib/stores/sidebar-store'
import PrimeOSMark from './PrimeOSMark'

// Live attention counts, keyed by the feature they badge. A tab shows a badge
// ONLY when a real count source exists and is non-zero — no static markers.
type BadgeCounts = { messages: number; review: number; invoices: number }
const ZERO_COUNTS: BadgeCounts = { messages: 0, review: 0, invoices: 0 }
const FEATURE_COUNT: Record<string, keyof BadgeCounts> = {
  'client/messages': 'messages',
  'client/review': 'review',
  'client/invoices': 'invoices',
}

// The studio rail — three floating squircle layers on the app canvas:
// the Genreline brand card, then the rail card holding the liquid-glass
// space deck (CREW / CLIENT / SUITE) and the feature card, which runs
// to the bottom. On phones it becomes a slide-over drawer (same store the
// portal sidebar uses; the two shells never mount together).
export default function StudioSidebar({
  userName,
  orgName,
  orgRoles = ['owner'],
  orgExtra = [],
  roleLabel = 'Owner',
  houseTools = false,
}: {
  userName: string
  orgName: string
  orgRoles?: OrgRole[]
  orgExtra?: string[]
  roleLabel?: string
  /** Whether this org's plan carries 'internal.pipeline' (house-only rail
   *  entries). Resolved server-side in the layout from the org's PLAN. */
  houseTools?: boolean
}) {
  const pathname = usePathname()
  const parts = pathname.split('/').filter(Boolean) // ['studio', space?, feature?]
  const activeId = parts[1] ?? 'crew'
  const activeFeature = parts[2]
  const space = getSpace(activeId) ?? SPACES[0]
  const [counts, setCounts] = useState<BadgeCounts>(ZERO_COUNTS)
  const router = useRouter()
  const { isOpen, close } = useSidebarStore()

  // Close the mobile drawer on route change; lock body scroll while open.
  useEffect(() => { close() }, [pathname, close])
  useEffect(() => {
    if (typeof document === 'undefined') return
    document.body.style.overflow = isOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  // Live attention badges — unread client messages, change requests on review
  // gates, overdue invoices. One channel, three table listeners; same source
  // the messages hub reads, so counts stay in lockstep with it.
  useEffect(() => {
    const supabase = createClient()

    async function loadBadge() {
      try {
        const res = await fetch('/api/admin/badge-counts')
        if (res.ok) {
          const json = await res.json()
          setCounts({
            messages: json.unreadClientMessages ?? 0,
            review: json.changesRequested ?? 0,
            invoices: json.overdueInvoices ?? 0,
          })
        }
      } catch {}
    }

    loadBadge()
    const interval = setInterval(loadBadge, 90_000)
    const channel = supabase
      .channel('studio-sidebar-badges')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => loadBadge())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => loadBadge())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, () => loadBadge())
      .subscribe()

    return () => {
      clearInterval(interval)
      supabase.removeChannel(channel)
    }
  }, [])

  const clientAttention = counts.messages + counts.review + counts.invoices

  return (
    <>
      {/* Mobile backdrop — tap to close. Hidden on lg+. */}
      <div
        onClick={close}
        aria-hidden
        className={`fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-200 lg:hidden ${
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col gap-3 bg-background p-3 transition-transform duration-200 ease-out lg:static lg:z-auto lg:h-full lg:flex-shrink-0 lg:translate-x-0 lg:bg-transparent lg:p-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* The product's card — deliberately its own layer, lifted off the rail. */}
        <div className="glass-panel squircle-lg flex flex-shrink-0 items-center px-4 py-3">
          <ProductMark size={36} showName showTagline />
        </div>

        {/* The rail — spaces and features in one squircle, to the bottom edge. */}
        <div className="glass-panel squircle-xl flex min-h-0 flex-1 flex-col p-3">
          {/* Space deck — one liquid-glass well, one glass tile per space,
              a thin glow hairline between them. */}
          <div className="glass-deck squircle flex flex-shrink-0 items-stretch p-1.5">
            {SPACES.map((s, i) => {
              const Icon = s.icon
              const active = s.id === activeId
              return (
                <Fragment key={s.id}>
                  {i > 0 && <span aria-hidden className="glow-divider-y mx-1" />}
                  <Link
                    href={`/studio/${s.id}`}
                    aria-current={active ? 'page' : undefined}
                    className={`group flex flex-1 flex-col items-center gap-1.5 squircle-sm px-0.5 py-3 font-display text-[9px] font-bold uppercase tracking-[0.12em] transition-all duration-200 ${
                      active
                        ? 'glass-tile-active text-primary'
                        : 'glass-tile text-muted-foreground hover:-translate-y-px hover:text-foreground'
                    }`}
                  >
                    <span className="relative">
                      <Icon size={17} className={`icon-live ${active ? 'text-primary' : ''}`} />
                      {s.id === 'client' && clientAttention > 0 && (
                        <span className="absolute -right-1.5 -top-1 h-2 w-2 rounded-full bg-destructive" />
                      )}
                    </span>
                    {s.label}
                  </Link>
                </Fragment>
              )
            })}
          </div>

          {/* Feature card — one box, squircle edges, extended to the bottom. */}
          <nav className="glass-inset squircle mt-3 min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2 scrollbar-thin">
            {space.features
              .filter((f) => !f.planFeature || houseTools)
              .filter((f) => orgFeatureAllowed(orgRoles, space.id, f.slug, orgExtra))
              .map((f) => {
              const Icon = f.icon
              const active = f.slug === activeFeature
              // Only a live attention count earns a badge — no static ★ markers.
              const countKey = FEATURE_COUNT[`${space.id}/${f.slug}`]
              const count = countKey ? counts[countKey] : 0
              return (
                <Link
                  key={f.slug}
                  href={`/studio/${space.id}/${f.slug}`}
                  className={`group flex items-center gap-3 squircle-sm px-3 py-2 text-[13px] transition-colors ${
                    active
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'text-muted-foreground hover:bg-glow/[0.06] hover:text-foreground'
                  }`}
                >
                  {f.slug === 'ai-chat'
                    ? <PrimeOSMark size={17} className="icon-live flex-shrink-0" />
                    : <Icon size={16} className="icon-live flex-shrink-0" />}
                  <span className="flex-1 truncate">{f.label}</span>
                  {count > 0 && (
                    <span className="min-w-[18px] rounded-full bg-destructive px-1.5 py-0.5 text-center text-[10px] font-bold text-destructive-foreground">
                      {count > 9 ? '9+' : count}
                    </span>
                  )}
                </Link>
              )
            })}
          </nav>

          {/* user footer */}
          <div className="flex-shrink-0 pt-3">
            <div className="glow-divider-x mb-2" />
            <div className="flex items-center gap-3 px-1 py-1.5">
              <div className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                {userName.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-[12.5px] font-semibold text-foreground">{userName}</div>
                <div className="truncate text-[10px] text-faint">{roleLabel} · {orgName}</div>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                title="Sign out"
                aria-label="Sign out"
                className="group grid h-8 w-8 flex-shrink-0 place-items-center squircle-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive"
              >
                <LogOut size={15} className="icon-live" />
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}
