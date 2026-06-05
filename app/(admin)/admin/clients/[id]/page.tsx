import { isAdmin } from '@/lib/auth/role'
import { createClient } from
  '@/lib/supabase/server'
import { supabaseAdmin } from
  '@/lib/supabase/admin'
import { redirect, notFound }
  from 'next/navigation'
import Link from 'next/link'
import RealtimeRefresh from '@/components/shared/RealtimeRefresh'
import {
  ArrowLeft,
  Mail,
  Phone,
  Building2,
  Calendar,
  UserCheck,
  Clock,
  Folder,
} from 'lucide-react'

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } =
    await supabase.auth.getUser()

  if (
    !user ||
    !isAdmin(user)
  ) {
    redirect('/login')
  }

  // Fetch client + projects + recent activity
  const { data: client } = await supabaseAdmin
    .from('clients')
    .select(`
      id,
      name,
      email,
      company,
      phone,
      notes,
      is_active,
      invited_at,
      onboarded_at,
      invite_count,
      created_at,
      projects (
        id,
        title,
        status,
        created_at
      )
    `)
    .eq('id', id)
    .single()

  if (!client) notFound()

  let recentActivity: { id: string; event_type: string; title: string; created_at: string }[] = []
  try {
    const { data } = await supabaseAdmin
      .from('activity_log')
      .select('id, event_type, title, created_at')
      .eq('client_id', id)
      .order('created_at', { ascending: false })
      .limit(10)
    recentActivity = data ?? []
  } catch {
    recentActivity = []
  }

  // Client invoices + linked receipts (for the billing summary card).
  let invoices: {
    id: string; invoice_number: string | null; title: string | null
    amount: number | null; status: string | null; due_date: string | null
    created_at: string; receipt_file_id: string | null
  }[] = []
  try {
    const { data } = await supabaseAdmin
      .from('invoices')
      .select('id, invoice_number, title, amount, status, due_date, created_at, receipt_file_id')
      .eq('client_id', id)
      .order('created_at', { ascending: false })
    invoices = data ?? []
  } catch {
    invoices = []
  }
  const billed = invoices.reduce((a, i) => a + (i.amount ?? 0), 0)
  const paidTotal = invoices.filter((i) => i.status === 'paid').reduce((a, i) => a + (i.amount ?? 0), 0)
  const outstanding = billed - paidTotal
  const fmtUsd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const inviteCount = (client as { invite_count?: number }).invite_count ?? 0
  let statusLabel = 'Active'
  let statusColor = 'hsl(var(--status-green))'
  if (!client.is_active) {
    statusLabel = 'Inactive'
    statusColor = 'hsl(var(--muted-foreground))'
  } else if (!client.onboarded_at) {
    if (inviteCount > 1) {
      statusLabel = 'Invite Resent'
      statusColor = 'hsl(var(--primary))'
    } else if (inviteCount === 1 || client.invited_at) {
      statusLabel = 'Invite Sent'
      statusColor = 'hsl(var(--status-blue))'
    } else {
      statusLabel = 'Pending'
      statusColor = 'hsl(var(--primary))'
    }
  }

  function fmt(iso: string | null) {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString(
      'en-US',
      {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }
    )
  }

  const infoRows = [
    {
      icon: Mail,
      label: 'Email',
      value: client.email,
      href: `mailto:${client.email}`,
    },
    {
      icon: Phone,
      label: 'Phone',
      value: client.phone ?? '—',
    },
    {
      icon: Building2,
      label: 'Company',
      value: client.company ?? '—',
    },
    {
      icon: Calendar,
      label: 'Invited',
      value: fmt(client.invited_at),
    },
    {
      icon: UserCheck,
      label: 'Onboarded',
      value: fmt(client.onboarded_at),
    },
  ]

  return (
    <div className="space-y-6
      max-w-[900px]">
      {/* Live: projects + activity update without refresh */}
      <RealtimeRefresh tables={['projects', 'activity_log', 'invoices', 'clients']} />

      {/* Back */}
      <Link
        href="/admin/clients"
        className="inline-flex items-center
        gap-2 text-sm transition-colors"
        style={{ color: 'hsl(var(--muted-foreground))' }}
      >
        <ArrowLeft size={14} />
        Back to Clients
      </Link>

      {/* Header */}
      <div className="flex items-start
        justify-between gap-4">
        <div>
          <h1
            className="font-display text-2xl
            font-bold"
            style={{ color: 'hsl(var(--foreground))' }}
          >
            {client.name}
          </h1>
          {client.company && (
            <p className="text-sm mt-1"
              style={{ color: 'hsl(var(--muted-foreground))' }}>
              {client.company}
            </p>
          )}
          <span
            className="inline-flex items-center
            gap-1.5 px-2.5 py-1 rounded-full
            text-xs font-semibold mt-2"
            style={{
              backgroundColor:
                `color-mix(in srgb, ${statusColor} 9%, transparent)`,
              color: statusColor,
            }}
          >
            <span
              className="w-1.5 h-1.5
              rounded-full"
              style={{
                backgroundColor: statusColor,
              }}
            />
            {statusLabel}
          </span>
        </div>

        <div className="flex gap-2">
          <a
            href={`mailto:${client.email}`}
            className="flex items-center gap-2
            px-4 py-2.5 rounded-lg text-sm
            font-medium transition-all"
            style={{
              backgroundColor: 'hsl(var(--secondary))',
              color: 'hsl(var(--foreground))',
              border: '1px solid hsl(var(--border))',
            }}
          >
            <Mail size={14} />
            Email Client
          </a>
          <Link
            href={
              `/admin/clients/${client.id}/edit`
            }
            className="flex items-center gap-2
            px-4 py-2.5 rounded-lg text-sm
            font-semibold transition-all"
            style={{
              backgroundColor: 'hsl(var(--primary))',
              color: 'hsl(var(--primary-foreground))',
            }}
          >
            Edit Profile
          </Link>
        </div>
      </div>

      {/* Two column layout */}
      <div className="grid grid-cols-1
        lg:grid-cols-3 gap-6">

        {/* Left — Info */}
        <div className="lg:col-span-1
          space-y-5">

          {/* Contact details card */}
          <div
            className="p-5 rounded-xl"
            style={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
            }}
          >
            <p
              className="text-xs font-semibold
              uppercase tracking-wider mb-4"
              style={{ color: 'hsl(var(--text-faint))' }}
            >
              Contact Details
            </p>
            <div className="space-y-3.5">
              {infoRows.map((row) => (
                <div
                  key={row.label}
                  className="flex items-start
                  gap-3"
                >
                  <row.icon
                    size={14}
                    className="flex-shrink-0
                    mt-0.5"
                    style={{ color: 'hsl(var(--text-faint))' }}
                  />
                  <div>
                    <p
                      className="text-xs mb-0.5"
                      style={{
                        color: 'hsl(var(--text-faint))',
                      }}
                    >
                      {row.label}
                    </p>
                    {row.href ? (
                      <a
                        href={row.href}
                        className="text-sm
                        transition-colors"
                        style={{
                          color: 'hsl(var(--primary))',
                        }}
                      >
                        {row.value}
                      </a>
                    ) : (
                      <p
                        className="text-sm"
                        style={{
                          color: 'hsl(var(--foreground))',
                        }}
                      >
                        {row.value}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          {client.notes && (
            <div
              className="p-5 rounded-xl"
              style={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
              }}
            >
              <p
                className="text-xs font-semibold
                uppercase tracking-wider mb-3"
                style={{ color: 'hsl(var(--text-faint))' }}
              >
                Internal Notes
              </p>
              <p
                className="text-sm leading-relaxed"
                style={{ color: 'hsl(var(--muted-foreground))' }}
              >
                {client.notes}
              </p>
            </div>
          )}
        </div>

        {/* Right — Projects + Activity */}
        <div className="lg:col-span-2
          space-y-5">

          {/* Projects */}
          <div
            className="p-5 rounded-xl"
            style={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
            }}
          >
            <div className="flex items-center
              justify-between mb-4">
              <p
                className="text-xs font-semibold
                uppercase tracking-wider"
                style={{ color: 'hsl(var(--text-faint))' }}
              >
                Projects
              </p>
              <Link
                href="/admin/projects/new"
                className="text-xs transition-colors"
                style={{ color: 'hsl(var(--primary))' }}
              >
                + New Project
              </Link>
            </div>

            {client.projects &&
            client.projects.length > 0 ? (
              <div className="space-y-2">
                {client.projects.map((p) => (
                  <Link
                    key={p.id}
                    href={
                      `/admin/projects/${p.id}`
                    }
                    className="flex items-center
                    justify-between p-3.5
                    rounded-lg transition-colors group
                    border border-[hsl(var(--border))]
                    hover:border-[hsl(var(--primary))]"
                    style={{
                      backgroundColor: 'hsl(var(--background))',
                    }}
                  >
                    <div className="flex
                      items-center gap-3">
                      <Folder
                        size={14}
                        style={{
                          color: 'hsl(var(--primary))',
                        }}
                      />
                      <span
                        className="text-sm
                        font-medium"
                        style={{
                          color: 'hsl(var(--foreground))',
                        }}
                      >
                        {p.title}
                      </span>
                    </div>
                    <span
                      className="text-xs
                      px-2 py-0.5 rounded-full
                      capitalize"
                      style={{
                        backgroundColor:
                          'hsl(var(--secondary))',
                        color: 'hsl(var(--muted-foreground))',
                      }}
                    >
                      {p.status}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm py-4
                text-center"
                style={{ color: 'hsl(var(--text-faint))' }}>
                No projects linked yet
              </p>
            )}
          </div>

          {/* Billing summary */}
          <div className="p-5 rounded-xl" style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'hsl(var(--text-faint))' }}>
                Billing
              </p>
              <Link href="/admin/invoices" className="text-xs transition-colors" style={{ color: 'hsl(var(--primary))' }}>
                Manage invoices →
              </Link>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: 'Billed', value: fmtUsd(billed), color: 'hsl(var(--foreground))' },
                { label: 'Paid', value: fmtUsd(paidTotal), color: 'hsl(var(--status-green))' },
                { label: 'Outstanding', value: fmtUsd(outstanding), color: outstanding > 0 ? 'hsl(var(--primary))' : 'hsl(var(--text-faint))' },
              ].map((s) => (
                <div key={s.label} className="rounded-lg p-3" style={{ backgroundColor: 'hsl(var(--secondary))' }}>
                  <p className="text-[10px] uppercase tracking-wider" style={{ color: 'hsl(var(--text-faint))' }}>{s.label}</p>
                  <p className="text-sm font-bold tabular-nums mt-0.5" style={{ color: s.color }}>{s.value}</p>
                </div>
              ))}
            </div>
            {invoices.length > 0 ? (
              <div className="space-y-2">
                {invoices.slice(0, 5).map((inv) => {
                  const isPaid = inv.status === 'paid'
                  return (
                    <div key={inv.id} className="flex items-center justify-between p-3 rounded-lg" style={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))' }}>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: 'hsl(var(--foreground))' }}>
                          {inv.invoice_number ?? inv.title ?? 'Invoice'}
                        </p>
                        <p className="text-xs" style={{ color: 'hsl(var(--text-faint))' }}>
                          {fmtUsd(inv.amount ?? 0)}{inv.receipt_file_id ? ' · receipt on file' : ''}
                        </p>
                      </div>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize flex-shrink-0"
                        style={{ backgroundColor: isPaid ? 'hsl(var(--status-green) / 0.12)' : 'hsl(var(--primary) / 0.12)', color: isPaid ? 'hsl(var(--status-green))' : 'hsl(var(--primary))' }}>
                        {inv.status ?? 'unpaid'}
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm py-2 text-center" style={{ color: 'hsl(var(--text-faint))' }}>No invoices yet</p>
            )}
          </div>

          {/* Recent activity */}
          <div
            className="p-5 rounded-xl"
            style={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
            }}
          >
            <p
              className="text-xs font-semibold
              uppercase tracking-wider mb-4"
              style={{ color: 'hsl(var(--text-faint))' }}
            >
              Recent Activity
            </p>
            {recentActivity &&
            recentActivity.length > 0 ? (
              <div className="space-y-3">
                {recentActivity.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-start
                    gap-3"
                  >
                    <div
                      className="w-1.5 h-1.5
                      rounded-full mt-1.5
                      flex-shrink-0"
                      style={{
                        backgroundColor:
                          'hsl(var(--primary))',
                      }}
                    />
                    <div>
                      <p
                        className="text-sm"
                        style={{
                          color: 'hsl(var(--foreground))',
                        }}
                      >
                        {a.title}
                      </p>
                      <p
                        className="text-xs mt-0.5"
                        style={{
                          color: 'hsl(var(--text-faint))',
                        }}
                      >
                        {new Date(
                          a.created_at
                        ).toLocaleDateString(
                          'en-US',
                          {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          }
                        )}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm py-4
                text-center"
                style={{ color: 'hsl(var(--text-faint))' }}>
                No activity yet
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
