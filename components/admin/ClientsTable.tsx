'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search,
  MoreHorizontal,
  Mail,
  ExternalLink,
  UserCheck,
  UserX,
  Clock,
  RefreshCw,
  Loader2,
  Trash2,
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
  is_active: boolean
  invited_at: string | null
  onboarded_at: string | null
  created_at: string
  projects: Project[] | null
}

export default function ClientsTable({
  clients,
}: {
  clients: Client[]
}) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<
    'all' | 'active' | 'pending' | 'inactive'
  >('all')
  const router = useRouter()
  const [resending, setResending] =
    useState<string | null>(null)
  const [deleting, setDeleting] =
    useState<string | null>(null)
  const [openMenu, setOpenMenu] =
    useState<string | null>(null)

  // ── Filter + Search ──────────────────────
  const filtered = clients.filter((c) => {
    const q = search.toLowerCase()
    const matchesSearch =
      !q ||
      c.name.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      (c.company ?? '')
        .toLowerCase().includes(q)

    const status = getStatus(c)
    const matchesFilter =
      filter === 'all' ||
      status === filter

    return matchesSearch && matchesFilter
  })

  function getStatus(c: Client) {
    if (!c.is_active) return 'inactive'
    if (!c.onboarded_at) return 'pending'
    return 'active'
  }

  function formatDate(iso: string | null) {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString(
      'en-US',
      {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }
    )
  }

  async function resendInvite(
    clientId: string,
    email: string
  ) {
    setResending(clientId)
    try {
      const res = await fetch(
        '/api/admin/resend-invite',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email }),
        }
      )
      const result = await res.json()
      if (!res.ok)
        alert(result.error ?? 'Failed to resend.')
      else
        alert(`Invite resent to ${email}`)
    } catch {
      alert('Something went wrong.')
    } finally {
      setResending(null)
      setOpenMenu(null)
    }
  }

  async function deleteClient(
    clientId: string,
    clientName: string
  ) {
    if (
      !confirm(
        `Permanently delete "${clientName}"?\n\n` +
        'Their projects will be preserved ' +
        'but unlinked from this client.'
      )
    ) return

    setDeleting(clientId)
    try {
      const res = await fetch(
        '/api/admin/delete-client',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ clientId }),
        }
      )
      const result = await res.json()
      if (!res.ok) {
        alert(result.error ?? 'Failed to delete.')
      } else {
        router.refresh()
      }
    } catch {
      alert('Something went wrong.')
    } finally {
      setDeleting(null)
      setOpenMenu(null)
    }
  }

  const statusStyles: Record<
    string,
    { bg: string; color: string; label: string }
  > = {
    active: {
      bg: 'hsl(var(--status-green) / 0.1)',
      color: 'hsl(var(--status-green))',
      label: 'Active',
    },
    pending: {
      bg: 'hsl(var(--primary) / 0.1)',
      color: 'hsl(var(--primary))',
      label: 'Pending',
    },
    inactive: {
      bg: 'hsl(var(--status-gray) / 0.1)',
      color: 'hsl(var(--muted-foreground))',
      label: 'Inactive',
    },
  }

  const filters: {
    key: typeof filter
    label: string
  }[] = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'pending', label: 'Pending' },
    { key: 'inactive', label: 'Inactive' },
  ]

  // ── Empty state ──────────────────────────
  if (clients.length === 0) {
    return (
      <div
        className="flex flex-col items-center
        justify-center py-20 rounded-xl"
        style={{
          backgroundColor: 'hsl(var(--card))',
          border: '1px solid hsl(var(--border))',
        }}
      >
        <div
          className="w-12 h-12 rounded-xl
          flex items-center justify-center
          mb-4"
          style={{
            backgroundColor:
              'hsl(var(--primary) / 0.08)',
          }}
        >
          <UserCheck size={20}
            style={{ color: 'hsl(var(--primary))' }} />
        </div>
        <p className="text-sm font-semibold"
          style={{ color: 'hsl(var(--foreground))' }}>
          No clients yet
        </p>
        <p className="text-sm mt-1 mb-6"
          style={{ color: 'hsl(var(--muted-foreground))' }}>
          Invite your first client to get started
        </p>
        <a
          href="/admin/clients/new"
          className="px-4 py-2.5 rounded-lg
          text-sm font-semibold"
          style={{
            backgroundColor: 'hsl(var(--primary))',
            color: 'hsl(var(--primary-foreground))',
          }}
        >
          Invite Client
        </a>
      </div>
    )
  }

  return (
    <div className="space-y-4">

      {/* Search + Filter bar */}
      <div className="flex flex-col sm:flex-row
        gap-3">

        {/* Search */}
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-3
            top-1/2 -translate-y-1/2"
            style={{ color: 'hsl(var(--text-faint))' }}
          />
          <input
            type="text"
            placeholder="Search by name,
              email, or company..."
            value={search}
            onChange={(e) =>
              setSearch(e.target.value)
            }
            className="w-full pl-9 pr-4 py-2.5
            rounded-lg text-sm outline-none
            transition-all"
            style={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              color: 'hsl(var(--foreground))',
            }}
            onFocus={(e) => {
              e.target.style.borderColor =
                'hsl(var(--primary))'
            }}
            onBlur={(e) => {
              e.target.style.borderColor =
                'hsl(var(--border))'
            }}
          />
        </div>

        {/* Filter pills */}
        <div className="flex gap-1.5">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="px-3 py-2 rounded-lg
              text-xs font-semibold
              transition-all"
              style={{
                backgroundColor:
                  filter === f.key
                    ? 'hsl(var(--primary))'
                    : 'hsl(var(--card))',
                color:
                  filter === f.key
                    ? 'hsl(var(--primary-foreground))'
                    : 'hsl(var(--muted-foreground))',
                border:
                  '1px solid ' +
                  (filter === f.key
                    ? 'hsl(var(--primary))'
                    : 'hsl(var(--border))'),
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div
        className="rounded-xl overflow-hidden"
        style={{
          border: '1px solid hsl(var(--border))',
        }}
      >
        {/* Table header */}
        <div
          className="grid gap-4 px-5 py-3
          text-xs font-semibold uppercase
          tracking-wider"
          style={{
            backgroundColor: 'hsl(var(--card))',
            color: 'hsl(var(--text-faint))',
            gridTemplateColumns:
              '1fr 1fr 160px 140px 80px',
            borderBottom: '1px solid hsl(var(--border))',
          }}
        >
          <span>Client</span>
          <span>Project</span>
          <span>Portal Status</span>
          <span>Invited</span>
          <span></span>
        </div>

        {/* Rows */}
        {filtered.length === 0 ? (
          <div
            className="py-12 text-center
            text-sm"
            style={{
              backgroundColor: 'hsl(var(--primary-foreground))',
              color: 'hsl(var(--muted-foreground))',
            }}
          >
            No clients match your search.
          </div>
        ) : (
          filtered.map((client, i) => {
            const status = getStatus(client)
            const s = statusStyles[status]
            const project =
              client.projects?.[0] ?? null

            return (
              <div
                key={client.id}
                className="grid gap-4 px-5
                py-4 items-center
                transition-colors"
                style={{
                  backgroundColor:
                    i % 2 === 0
                      ? 'hsl(var(--primary-foreground))'
                      : 'hsl(var(--background))',
                  gridTemplateColumns:
                    '1fr 1fr 160px 140px 80px',
                  borderBottom:
                    i < filtered.length - 1
                      ? '1px solid hsl(var(--card))'
                      : 'none',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget
                    .style.backgroundColor =
                    'hsl(var(--card))'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget
                    .style.backgroundColor =
                    i % 2 === 0
                      ? 'hsl(var(--primary-foreground))'
                      : 'hsl(var(--background))'
                }}
              >
                {/* Client info */}
                <div className="min-w-0">
                  <p
                    className="text-sm
                    font-semibold truncate"
                    style={{ color: 'hsl(var(--foreground))' }}
                  >
                    {client.name}
                  </p>
                  <p
                    className="text-xs
                    truncate mt-0.5"
                    style={{ color: 'hsl(var(--muted-foreground))' }}
                  >
                    {client.company
                      ? `${client.company} · `
                      : ''}
                    {client.email}
                  </p>
                </div>

                {/* Project */}
                <div className="min-w-0">
                  {project ? (
                    <a
                      href={
                        `/admin/projects/` +
                        project.id
                      }
                      className="text-sm
                      truncate block
                      transition-colors
                      hover:underline"
                      style={{ color: 'hsl(var(--primary))' }}
                    >
                      {project.title}
                    </a>
                  ) : (
                    <span
                      className="text-sm"
                      style={{ color: 'hsl(var(--text-faint))' }}
                    >
                      No project linked
                    </span>
                  )}
                </div>

                {/* Status */}
                <div>
                  <span
                    className="inline-flex
                    items-center gap-1.5 px-2.5
                    py-1 rounded-full text-xs
                    font-semibold"
                    style={{
                      backgroundColor: s.bg,
                      color: s.color,
                    }}
                  >
                    {status === 'active' && (
                      <UserCheck size={11} />
                    )}
                    {status === 'pending' && (
                      <Clock size={11} />
                    )}
                    {status === 'inactive' && (
                      <UserX size={11} />
                    )}
                    {s.label}
                  </span>
                </div>

                {/* Invited date */}
                <div>
                  <p
                    className="text-sm"
                    style={{ color: 'hsl(var(--muted-foreground))' }}
                  >
                    {formatDate(client.invited_at)}
                  </p>
                  {client.onboarded_at && (
                    <p
                      className="text-xs mt-0.5"
                      style={{ color: 'hsl(var(--text-faint))' }}
                    >
                      Joined{' '}
                      {formatDate(
                        client.onboarded_at
                      )}
                    </p>
                  )}
                </div>

                {/* Actions menu */}
                <div className="flex
                  justify-end relative">
                  <button
                    onClick={() =>
                      setOpenMenu(
                        openMenu === client.id
                          ? null
                          : client.id
                      )
                    }
                    className="p-2 rounded-lg
                    transition-all"
                    style={{ color: 'hsl(var(--text-faint))' }}
                    onMouseEnter={(e) => {
                      e.currentTarget
                        .style.backgroundColor =
                        'hsl(var(--secondary))'
                      e.currentTarget
                        .style.color = 'hsl(var(--foreground))'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget
                        .style.backgroundColor =
                        'transparent'
                      e.currentTarget
                        .style.color = 'hsl(var(--text-faint))'
                    }}
                  >
                    <MoreHorizontal size={16} />
                  </button>

                  {/* Dropdown */}
                  {openMenu === client.id && (
                    <>
                      {/* Backdrop */}
                      <div
                        className="fixed inset-0
                        z-10"
                        onClick={() =>
                          setOpenMenu(null)
                        }
                      />

                      <div
                        className="absolute
                        right-0 top-9 z-20
                        rounded-lg overflow-hidden
                        min-w-[180px]"
                        style={{
                          backgroundColor:
                            'hsl(var(--card))',
                          border:
                            '1px solid hsl(var(--border))',
                          boxShadow:
                            '0 8px 24px ' +
                            'rgba(0,0,0,0.4)',
                        }}
                      >
                        {/* View detail */}
                        <a
                          href={
                            `/admin/clients/` +
                            client.id
                          }
                          className="flex
                          items-center gap-2.5
                          px-4 py-2.5 text-sm
                          transition-colors"
                          style={{
                            color: 'hsl(var(--foreground))',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget
                              .style
                              .backgroundColor =
                              'hsl(var(--secondary))'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget
                              .style
                              .backgroundColor =
                              'transparent'
                          }}
                        >
                          <ExternalLink
                            size={13} />
                          View Profile
                        </a>

                        {/* Resend invite
                          (only if not yet
                          onboarded) */}
                        {!client.onboarded_at && (
                          <button
                            onClick={() =>
                              resendInvite(
                                client.id,
                                client.email
                              )
                            }
                            disabled={
                              resending ===
                              client.id
                            }
                            className="w-full
                            flex items-center
                            gap-2.5 px-4 py-2.5
                            text-sm transition-colors
                            disabled:opacity-50"
                            style={{
                              color: 'hsl(var(--primary))',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget
                                .style
                                .backgroundColor =
                                'hsl(var(--secondary))'
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget
                                .style
                                .backgroundColor =
                                'transparent'
                            }}
                          >
                            {resending ===
                            client.id ? (
                              <Loader2
                                size={13}
                                className=
                                  "animate-spin"
                              />
                            ) : (
                              <RefreshCw
                                size={13} />
                            )}
                            Resend Invite
                          </button>
                        )}

                        {/* Email client */}
                        <a
                          href={
                            `mailto:` +
                            client.email
                          }
                          className="flex
                          items-center gap-2.5
                          px-4 py-2.5 text-sm
                          transition-colors"
                          style={{
                            color: 'hsl(var(--foreground))',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget
                              .style
                              .backgroundColor =
                              'hsl(var(--secondary))'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget
                              .style
                              .backgroundColor =
                              'transparent'
                          }}
                        >
                          <Mail size={13} />
                          Send Email
                        </a>

                        {/* Divider */}
                        <div
                          style={{
                            height: '1px',
                            backgroundColor:
                              'hsl(var(--border))',
                          }}
                        />

                        {/* Delete client */}
                        <button
                          onClick={() =>
                            deleteClient(
                              client.id,
                              client.name
                            )
                          }
                          disabled={
                            deleting ===
                            client.id
                          }
                          className="w-full
                          flex items-center
                          gap-2.5 px-4 py-2.5
                          text-sm transition-colors
                          disabled:opacity-50"
                          style={{
                            color: 'hsl(var(--destructive))',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget
                              .style
                              .backgroundColor =
                              'hsl(var(--destructive) / 0.08)'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget
                              .style
                              .backgroundColor =
                              'transparent'
                          }}
                        >
                          {deleting ===
                          client.id ? (
                            <Loader2
                              size={13}
                              className=
                                "animate-spin"
                            />
                          ) : (
                            <Trash2
                              size={13} />
                          )}
                          Delete Client
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Count footer */}
      {filtered.length > 0 && (
        <p className="text-xs text-right"
          style={{ color: 'hsl(var(--text-faint))' }}>
          Showing {filtered.length} of{' '}
          {clients.length} clients
        </p>
      )}
    </div>
  )
}
