'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Search,
  MoreHorizontal,
  Mail,
  ExternalLink,
  Pencil,
  UserCheck,
  UserX,
  Clock,
  RefreshCw,
  Loader2,
  Trash2,
  FolderOpen,
} from 'lucide-react'

type Project = {
  id: string
  title: string
  status: string
}

type Client = {
  id: string
  name: string
  email: string
  company: string | null
  phone: string | null
  avatar_url?: string | null
  is_active: boolean
  invited_at: string | null
  onboarded_at: string | null
  invite_count: number | null
  created_at: string
  projects: Project[] | null
}

type StatusKey = 'active' | 'pending' | 'sent' | 'resent' | 'inactive'

export default function ClientsTable({
  clients,
}: {
  clients: Client[]
}) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'pending' | 'inactive'>('all')
  const router = useRouter()
  const [resending, setResending] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [openMenu, setOpenMenu] = useState<string | null>(null)

  // Close the actions menu on any outside click. Deferred a tick so the
  // opening click doesn't immediately close it. Robust even though cards
  // use a hover transform (which breaks a fixed-overlay backdrop).
  useEffect(() => {
    if (!openMenu) return
    const close = () => setOpenMenu(null)
    const t = setTimeout(() => document.addEventListener('click', close), 0)
    return () => { clearTimeout(t); document.removeEventListener('click', close) }
  }, [openMenu])

  const filtered = clients.filter((c) => {
    const q = search.toLowerCase()
    const matchesSearch =
      !q ||
      c.name.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      (c.company ?? '').toLowerCase().includes(q)
    const matchesFilter = filter === 'all' || getStatus(c) === filter
    return matchesSearch && matchesFilter
  })

  function getStatus(c: Client): 'active' | 'pending' | 'inactive' {
    if (!c.is_active) return 'inactive'
    if (!c.onboarded_at) return 'pending'
    return 'active'
  }

  function displayStatus(c: Client): StatusKey {
    if (!c.is_active) return 'inactive'
    if (c.onboarded_at) return 'active'
    if ((c.invite_count ?? 0) > 1) return 'resent'
    if ((c.invite_count ?? 0) === 1 || c.invited_at) return 'sent'
    return 'pending'
  }

  function formatDate(iso: string | null) {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  }

  async function resendInvite(clientId: string, email: string) {
    setResending(clientId)
    try {
      const res = await fetch('/api/admin/resend-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const result = await res.json()
      if (!res.ok) {
        alert(result.error ?? 'Failed to resend.')
      } else {
        alert(`Invite resent to ${email}`)
        router.refresh()
      }
    } catch {
      alert('Something went wrong.')
    } finally {
      setResending(null)
      setOpenMenu(null)
    }
  }

  async function deleteClient(clientId: string, clientName: string) {
    if (!confirm(
      `Permanently delete "${clientName}"?\n\nTheir projects are preserved but unlinked from this client.`
    )) return
    setDeleting(clientId)
    try {
      const res = await fetch('/api/admin/delete-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      })
      const result = await res.json()
      if (!res.ok) alert(result.error ?? 'Failed to delete.')
      else router.refresh()
    } catch {
      alert('Something went wrong.')
    } finally {
      setDeleting(null)
      setOpenMenu(null)
    }
  }

  const statusStyles: Record<StatusKey, { bg: string; color: string; label: string }> = {
    active: { bg: 'hsl(var(--status-green) / 0.1)', color: 'hsl(var(--status-green))', label: 'Active' },
    pending: { bg: 'hsl(var(--primary) / 0.1)', color: 'hsl(var(--primary))', label: 'Pending' },
    sent: { bg: 'hsl(var(--status-blue) / 0.1)', color: 'hsl(var(--status-blue))', label: 'Invite Sent' },
    resent: { bg: 'hsl(var(--primary) / 0.1)', color: 'hsl(var(--primary))', label: 'Invite Resent' },
    inactive: { bg: 'hsl(var(--status-gray) / 0.1)', color: 'hsl(var(--muted-foreground))', label: 'Inactive' },
  }

  const filters: { key: typeof filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'pending', label: 'Pending' },
    { key: 'inactive', label: 'Inactive' },
  ]

  if (clients.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 rounded-xl"
        style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
        <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
          style={{ backgroundColor: 'hsl(var(--primary) / 0.08)' }}>
          <UserCheck size={20} style={{ color: 'hsl(var(--primary))' }} />
        </div>
        <p className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>No clients yet</p>
        <p className="text-sm mt-1 mb-6" style={{ color: 'hsl(var(--muted-foreground))' }}>
          Invite your first client to get started
        </p>
        <Link href="/admin/clients/new" className="px-4 py-2.5 rounded-lg text-sm font-semibold"
          style={{ backgroundColor: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}>
          Invite Client
        </Link>
      </div>
    )
  }

  const StatusIcon = { active: UserCheck, pending: Clock, sent: Mail, resent: RefreshCw, inactive: UserX }

  return (
    <div className="space-y-5">
      {/* Search + Filter bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: 'hsl(var(--text-faint))' }} />
          <input
            type="text"
            placeholder="Search by name, email, or company..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-lg text-sm outline-none transition-all"
            style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}
            onFocus={(e) => { e.target.style.borderColor = 'hsl(var(--primary))' }}
            onBlur={(e) => { e.target.style.borderColor = 'hsl(var(--border))' }}
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {filters.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className="px-3 py-2 rounded-lg text-xs font-semibold transition-all"
              style={{
                backgroundColor: filter === f.key ? 'hsl(var(--primary))' : 'hsl(var(--card))',
                color: filter === f.key ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))',
                border: '1px solid ' + (filter === f.key ? 'hsl(var(--primary))' : 'hsl(var(--border))'),
              }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Card grid — 2 per row on tablet, 3 on wide screens */}
      {filtered.length === 0 ? (
        <div className="py-12 text-center text-sm rounded-xl"
          style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}>
          No clients match your search.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((client) => {
            const status = displayStatus(client)
            const s = statusStyles[status]
            const Icon = StatusIcon[status]
            const projects = client.projects ?? []
            const displayName = client.company || client.name

            return (
              <div key={client.id}
                onClick={() => router.push(`/admin/clients/${client.id}`)}
                className="card-interactive flex flex-col gap-4 rounded-xl p-5 cursor-pointer"
                style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>

                {/* Header: company logo + dominant company name + menu */}
                <div className="flex items-start gap-5">
                  <div className="w-[88px] h-[88px] rounded-2xl overflow-hidden flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: 'hsl(var(--primary) / 0.1)', border: '1px solid hsl(var(--border))' }}>
                    {client.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={client.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-3xl font-bold" style={{ color: 'hsl(var(--primary))' }}>
                        {displayName[0]?.toUpperCase() ?? 'C'}
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-lg font-bold leading-tight"
                      style={{ color: 'hsl(var(--foreground))' }} title={displayName}>
                      {displayName}
                    </p>
                    <p className="truncate text-sm mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
                      {client.company ? client.name : client.email}
                    </p>
                    {client.company && (
                      <p className="truncate text-xs mt-0.5" style={{ color: 'hsl(var(--text-faint))' }}>
                        {client.email}
                      </p>
                    )}

                    {/* Status + invite/joined — sits under the company details,
                        indented with them so the logo can read larger */}
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
                        style={{ backgroundColor: s.bg, color: s.color }}>
                        <Icon size={11} />
                        {s.label}
                      </span>
                      <span className="text-[11px]" style={{ color: 'hsl(var(--text-faint))' }}>
                        {client.onboarded_at ? `Joined ${formatDate(client.onboarded_at)}` : `Invited ${formatDate(client.invited_at)}`}
                      </span>
                    </div>
                  </div>

                  {/* 3-dot menu — anchored directly under the button */}
                  <div className="relative flex-shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === client.id ? null : client.id) }}
                      className="p-2 -mr-1 -mt-1 rounded-lg transition-all"
                      style={{ color: 'hsl(var(--text-faint))' }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'hsl(var(--secondary))'; e.currentTarget.style.color = 'hsl(var(--foreground))' }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'hsl(var(--text-faint))' }}
                      aria-label="Client actions">
                      <MoreHorizontal size={16} />
                    </button>
                    {openMenu === client.id && (
                      <div onClick={(e) => e.stopPropagation()}
                        className="absolute right-0 top-full mt-1 z-50 rounded-lg overflow-hidden min-w-[190px]"
                        style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', boxShadow: '0 10px 30px -8px rgba(0,0,0,0.45)' }}>
                          <Link href={`/admin/clients/${client.id}`} className="flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors hover:bg-[hsl(var(--secondary))]" style={{ color: 'hsl(var(--foreground))' }}>
                            <ExternalLink size={13} /> View Profile
                          </Link>
                          <Link href={`/admin/clients/${client.id}/edit`} className="flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors hover:bg-[hsl(var(--secondary))]" style={{ color: 'hsl(var(--foreground))' }}>
                            <Pencil size={13} /> Edit Profile
                          </Link>
                          {!client.onboarded_at && (
                            <button onClick={() => resendInvite(client.id, client.email)} disabled={resending === client.id}
                              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors disabled:opacity-50 hover:bg-[hsl(var(--secondary))]"
                              style={{ color: 'hsl(var(--primary))' }}>
                              {resending === client.id ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                              Resend Invite
                            </button>
                          )}
                          <a href={`mailto:${client.email}`} className="flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors hover:bg-[hsl(var(--secondary))]" style={{ color: 'hsl(var(--foreground))' }}>
                            <Mail size={13} /> Send Email
                          </a>
                          <div style={{ height: '1px', backgroundColor: 'hsl(var(--border))' }} />
                          <button onClick={() => deleteClient(client.id, client.name)} disabled={deleting === client.id}
                            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors disabled:opacity-50"
                            style={{ color: 'hsl(var(--destructive))' }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'hsl(var(--destructive) / 0.08)' }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}>
                            {deleting === client.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                            Delete Client
                          </button>
                        </div>
                    )}
                  </div>
                </div>

                {/* Projects as clickable capsules */}
                <div className="pt-3 mt-auto" style={{ borderTop: '1px solid hsl(var(--border))' }}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'hsl(var(--text-faint))' }}>
                    Projects
                  </p>
                  {projects.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {projects.slice(0, 3).map((p) => (
                        <Link key={p.id} href={`/admin/projects/${p.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium max-w-[180px] transition-all"
                          style={{ backgroundColor: 'hsl(var(--primary) / 0.1)', color: 'hsl(var(--primary))', border: '1px solid hsl(var(--primary) / 0.2)' }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'hsl(var(--primary) / 0.18)' }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'hsl(var(--primary) / 0.1)' }}>
                          <FolderOpen size={10} className="flex-shrink-0" />
                          <span className="truncate">{p.title}</span>
                        </Link>
                      ))}
                      {projects.length > 3 && (
                        <Link href={`/admin/clients/${client.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center px-3 py-1.5 rounded-full text-[11px] font-medium"
                          style={{ backgroundColor: 'hsl(var(--secondary))', color: 'hsl(var(--muted-foreground))' }}>
                          +{projects.length - 3} more
                        </Link>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs" style={{ color: 'hsl(var(--text-faint))' }}>No project linked</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {filtered.length > 0 && (
        <p className="text-xs text-right" style={{ color: 'hsl(var(--text-faint))' }}>
          Showing {filtered.length} of {clients.length} clients
        </p>
      )}
    </div>
  )
}
