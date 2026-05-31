import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import StatusBadge from '@/components/portal/StatusBadge'
import WelcomeBanner from '@/components/portal/WelcomeBanner'
import OverviewGreeting from '@/components/portal/OverviewGreeting'
import ProgressBar from '@/components/shared/ProgressBar'
import RealtimeRefresh from '@/components/shared/RealtimeRefresh'
import { applyCanonicalProgress } from '@/lib/projectProgress'
import {
  FolderOpen,
  CheckSquare,
  Files,
  MessageSquare,
  CreditCard,
  ArrowRight,
  Clock,
  AlertCircle,
  TrendingUp,
  Activity,
  CalendarClock,
  Download,
  Wallet,
  Sparkles,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

type Kpi = {
  label: string
  value: string | number
  sub?: string
  icon: LucideIcon
  href: string
  color: string
}

// ── Helpers ─────────────────────────────────────

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  const hrs = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (hrs < 24) return `${hrs}h ago`
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function shortDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const isTaskDone = (s: string | null) =>
  ['complete', 'completed', 'done'].includes((s ?? '').toLowerCase())

export default async function DashboardPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Service role + explicit ownership scoping (client is matched by the
  // authenticated user_id, all data scoped to that client) — mirrors the
  // projects/messages/files pages, which don't depend on RLS for reads.
  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertCircle size={40} style={{ color: 'hsl(var(--text-faint))' }} />
        <p style={{ color: 'hsl(var(--muted-foreground))' }}>
          Your account is being set up. Please contact McPrime Digital.
        </p>
      </div>
    )
  }

  const isFirstLogin = client?.onboarded_at
    ? Date.now() - new Date(client.onboarded_at).getTime() < 300000
    : false

  // Projects first, then everything scoped to their ids
  const { data: projects } = await supabaseAdmin
    .from('projects')
    .select('*')
    .eq('client_id', client.id)
    .order('created_at', { ascending: false })

  const projectIds = (projects ?? []).map((p) => p.id)
  const hasProjects = projectIds.length > 0

  const [
    { data: tasks },
    { data: recentFiles },
    { data: unreadMsgs },
    { data: recentMessages },
    { data: invoices },
    { data: phases },
  ] = await Promise.all([
    hasProjects
      ? supabaseAdmin.from('tasks').select('*').in('project_id', projectIds)
      : Promise.resolve({ data: [] as any[] }),
    supabaseAdmin
      .from('files')
      .select('*')
      .eq('client_id', client.id)
      .eq('direction', 'delivery')
      .order('created_at', { ascending: false })
      .limit(8),
    hasProjects
      ? supabaseAdmin
          .from('messages')
          .select('id')
          .is('read_at', null)
          .eq('sender_role', 'admin')
          .in('project_id', projectIds)
      : Promise.resolve({ data: [] as any[] }),
    hasProjects
      ? supabaseAdmin
          .from('messages')
          .select('*')
          .in('project_id', projectIds)
          .order('created_at', { ascending: false })
          .limit(6)
      : Promise.resolve({ data: [] as any[] }),
    supabaseAdmin.from('invoices').select('*').eq('client_id', client.id),
    hasProjects
      ? supabaseAdmin
          .from('project_phases')
          .select('project_id, progress')
          .in('project_id', projectIds)
      : Promise.resolve({ data: [] as any[] }),
  ])

  // Keep overview progress in sync with the phase-average (single
  // source of truth shared with project detail pages).
  applyCanonicalProgress(projects, phases)

  // Tasks the client needs to approve (shared, in review, not yet approved).
  const pendingApprovals = (tasks ?? []).filter(
    (t: any) => t.visible_to_client && t.status === 'review' && !t.approved_at
  )

  // ── Derived metrics ──
  const activeProjects = (projects ?? []).filter(
    (p) => p.status !== 'Completed' && p.status !== 'On Hold'
  )
  const inReview = (projects ?? []).filter(
    (p) => p.status === 'In Review' || p.status === 'Revisions'
  )
  const completedTasks = (tasks ?? []).filter((t) => isTaskDone(t.status)).length
  const totalTasks = (tasks ?? []).length
  const taskPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
  const unreadMessages = (unreadMsgs ?? []).length

  const allInvoices = invoices ?? []
  const outstanding = allInvoices
    .filter((i) => i.status === 'unpaid' || i.status === 'overdue')
    .reduce((a, i) => a + Number(i.amount), 0)
  const paidToDate = allInvoices
    .filter((i) => i.status === 'paid')
    .reduce((a, i) => a + Number(i.amount), 0)
  const overdueAmount = allInvoices
    .filter((i) => i.status === 'overdue')
    .reduce((a, i) => a + Number(i.amount), 0)
  const dueCount = allInvoices.filter(
    (i) => i.status === 'unpaid' || i.status === 'overdue'
  ).length
  const nextInvoice = allInvoices
    .filter((i) => (i.status === 'unpaid' || i.status === 'overdue') && i.due_date)
    .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime())[0]
  const payLink = allInvoices.find(
    (i) => (i.status === 'unpaid' || i.status === 'overdue') && i.stripe_payment_link
  )?.stripe_payment_link

  // Next project delivery
  const upcoming = activeProjects
    .filter((p) => p.due_date)
    .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime())[0]

  // Recent activity — merged from deliverables + messages
  type ActivityItem = {
    id: string
    kind: 'file' | 'message'
    title: string
    sub: string
    time: string
  }
  const fileActs: ActivityItem[] = (recentFiles ?? []).slice(0, 6).map((f) => ({
    id: `f-${f.id}`,
    kind: 'file',
    title: f.file_name,
    sub: 'New deliverable available',
    time: f.created_at,
  }))
  const msgActs: ActivityItem[] = (recentMessages ?? [])
    .filter((m) => !m.is_deleted && m.body)
    .map((m) => ({
      id: `m-${m.id}`,
      kind: 'message' as const,
      title: m.sender_role === 'admin' ? (m.sender_name || 'McPrime Digital') : 'You',
      sub: m.body,
      time: m.created_at,
    }))
  const activity = [...fileActs, ...msgActs]
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, 6)

  const firstName = (client.name ?? '').split(' ')[0]
  const now = new Date()
  const dateLabel = now.toLocaleDateString('en-US', { weekday: 'long' })
  const dateSub = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  // Summary chips for the header subtitle
  const summaryBits: string[] = [
    `${activeProjects.length} active project${activeProjects.length !== 1 ? 's' : ''}`,
  ]
  if (inReview.length > 0) summaryBits.push(`${inReview.length} in review`)
  if (unreadMessages > 0) summaryBits.push(`${unreadMessages} unread message${unreadMessages !== 1 ? 's' : ''}`)
  if (upcoming?.due_date) summaryBits.push(`next delivery ${shortDate(upcoming.due_date)}`)

  const kpis: Kpi[] = [
    {
      label: 'Active Projects',
      value: activeProjects.length,
      sub: inReview.length > 0 ? `${inReview.length} in review` : undefined,
      icon: FolderOpen,
      href: '/projects',
      color: 'hsl(var(--status-blue))',
    },
    {
      label: 'Tasks Complete',
      value: `${completedTasks}/${totalTasks}`,
      sub: `${taskPct}%`,
      icon: CheckSquare,
      href: '/projects',
      color: 'hsl(var(--status-green))',
    },
    {
      label: 'Unread Messages',
      value: unreadMessages,
      icon: MessageSquare,
      href: '/messages',
      color: 'hsl(var(--status-violet))',
    },
    {
      label: 'Outstanding',
      value: formatCurrency(outstanding),
      sub: dueCount > 0 ? `${dueCount} invoice${dueCount !== 1 ? 's' : ''} due` : 'All settled',
      icon: Wallet,
      href: '/invoices',
      color: outstanding > 0 ? 'hsl(var(--destructive))' : 'hsl(var(--status-green))',
    },
  ]

  return (
    <div className="space-y-6 w-full">
      {/* Live: refresh overview when the client's data changes */}
      <RealtimeRefresh
        tables={['projects', 'project_phases', 'invoices', 'activity_log', 'messages', 'files']}
        pollMs={45000}
      />

      {/* Welcome banner for first-time clients */}
      <WelcomeBanner clientName={client?.name ?? 'there'} isFirstLogin={isFirstLogin} />

      {/* Pending approvals — items awaiting the client's review */}
      {pendingApprovals.length > 0 && (
        <Link href="/projects" className="block">
          <div
            className="flex items-center justify-between gap-4 p-4 rounded-xl flex-wrap card-interactive"
            style={{
              backgroundColor: 'hsl(var(--primary) / 0.06)',
              border: '1px solid hsl(var(--primary) / 0.25)',
            }}
          >
            <div className="flex items-center gap-3">
              <CheckSquare size={18} style={{ color: 'hsl(var(--primary))' }} />
              <div>
                <p className="text-sm font-semibold" style={{ color: 'hsl(var(--primary))' }}>
                  {pendingApprovals.length} item{pendingApprovals.length === 1 ? '' : 's'} awaiting your approval
                </p>
                <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                  Review and approve deliverables in your projects
                </p>
              </div>
            </div>
            <span className="text-xs font-semibold flex items-center gap-1" style={{ color: 'hsl(var(--primary))' }}>
              Review now <ArrowRight size={12} />
            </span>
          </div>
        </Link>
      )}

      {/* Header — time-based greeting (like the admin portal) */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <OverviewGreeting firstName={firstName} summary={summaryBits.join(' · ')} />
        <div className="text-right flex-shrink-0">
          <p className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>{dateLabel}</p>
          <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>{dateSub}</p>
        </div>
      </div>

      {/* Overdue / unpaid alert */}
      {dueCount > 0 && (
        <Link href="/invoices">
          <div
            className="card-interactive flex items-center justify-between p-4 rounded-xl cursor-pointer"
            style={{
              backgroundColor: overdueAmount > 0 ? 'hsl(var(--destructive) / 0.08)' : 'hsl(var(--primary) / 0.06)',
              border: overdueAmount > 0 ? '1px solid hsl(var(--destructive) / 0.25)' : '1px solid hsl(var(--primary) / 0.2)',
            }}
          >
            <div className="flex items-center gap-3">
              <AlertCircle size={16} style={{ color: overdueAmount > 0 ? 'hsl(var(--destructive))' : 'hsl(var(--primary))' }} />
              <span className="text-sm font-medium" style={{ color: 'hsl(var(--foreground))' }}>
                {overdueAmount > 0
                  ? `${formatCurrency(overdueAmount)} overdue — please settle to avoid delays`
                  : `${formatCurrency(outstanding)} outstanding across ${dueCount} invoice${dueCount !== 1 ? 's' : ''}`}
              </span>
            </div>
            <div className="flex items-center gap-1 text-sm flex-shrink-0" style={{ color: overdueAmount > 0 ? 'hsl(var(--destructive))' : 'hsl(var(--primary))' }}>
              View invoices
              <ArrowRight size={14} />
            </div>
          </div>
        </Link>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => {
          const Icon = kpi.icon
          return (
            <Link key={kpi.label} href={kpi.href}>
              <div className="card-interactive p-5 rounded-xl cursor-pointer h-full bg-[hsl(var(--card))] border border-[hsl(var(--border))]">
                <div className="flex items-center justify-between mb-4">
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: `color-mix(in srgb, ${kpi.color} 12%, transparent)` }}
                  >
                    <Icon size={18} style={{ color: kpi.color }} />
                  </div>
                  {kpi.sub && (
                    <span className="text-xs font-semibold tabular-nums" style={{ color: kpi.color }}>
                      {kpi.sub}
                    </span>
                  )}
                </div>
                <div className="font-display text-2xl font-bold tabular-nums" style={{ color: 'hsl(var(--foreground))' }}>
                  {kpi.value}
                </div>
                <div className="text-xs mt-1" style={{ color: 'hsl(var(--muted-foreground))' }}>
                  {kpi.label}
                </div>
              </div>
            </Link>
          )
        })}
      </div>

      {/* Main 2-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">

        {/* ── Left column ── */}
        <div className="space-y-6 min-w-0">

          {/* Active Projects */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-base font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
                Active Projects
              </h2>
              <Link href="/projects" className="flex items-center gap-1 text-sm" style={{ color: 'hsl(var(--primary))' }}>
                View all <ArrowRight size={14} />
              </Link>
            </div>

            {activeProjects.length === 0 ? (
              <div
                className="flex flex-col items-center justify-center py-16 rounded-xl"
                style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
              >
                <FolderOpen size={32} style={{ color: 'hsl(var(--text-faint))' }} />
                <p className="text-sm mt-3" style={{ color: 'hsl(var(--muted-foreground))' }}>
                  No active projects yet
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {activeProjects.map((project) => (
                  <Link key={project.id} href={`/projects/${project.id}`}>
                    <div className="card-interactive p-5 rounded-xl cursor-pointer bg-[hsl(var(--card))] border border-[hsl(var(--border))]">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-2 flex-wrap">
                            <h3 className="font-semibold text-sm truncate" style={{ color: 'hsl(var(--foreground))' }}>
                              {project.title}
                            </h3>
                            <StatusBadge status={project.status} size="xs" />
                          </div>
                          <div className="flex items-center gap-4 flex-wrap">
                            <span
                              className="text-xs px-2 py-0.5 rounded-full"
                              style={{ backgroundColor: 'hsl(var(--secondary))', color: 'hsl(var(--muted-foreground))' }}
                            >
                              {project.type}
                            </span>
                            {project.due_date && (
                              <div className="flex items-center gap-1">
                                <Clock size={11} style={{ color: 'hsl(var(--text-faint))' }} />
                                <span className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                                  Due {shortDate(project.due_date)}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <div className="text-xs font-semibold tabular-nums" style={{ color: 'hsl(var(--primary))' }}>
                            {project.progress}%
                          </div>
                          <ArrowRight size={14} style={{ color: 'hsl(var(--text-faint))' }} />
                        </div>
                      </div>
                      <ProgressBar value={project.progress} size="sm" className="mt-4" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* Recent Deliverables */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-base font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
                Recent Deliverables
              </h2>
              <Link href="/files" className="flex items-center gap-1 text-sm" style={{ color: 'hsl(var(--primary))' }}>
                View all <ArrowRight size={14} />
              </Link>
            </div>

            {!recentFiles || recentFiles.length === 0 ? (
              <div
                className="flex flex-col items-center justify-center py-12 rounded-xl"
                style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
              >
                <Files size={28} style={{ color: 'hsl(var(--text-faint))' }} />
                <p className="text-sm mt-3" style={{ color: 'hsl(var(--muted-foreground))' }}>
                  No files delivered yet
                </p>
              </div>
            ) : (
              <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
                {recentFiles.slice(0, 5).map((file, index, arr) => (
                  <Link key={file.id} href="/files">
                    <div
                      className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-[hsl(var(--secondary))]"
                      style={{ borderBottom: index < arr.length - 1 ? '1px solid hsl(var(--border))' : 'none' }}
                    >
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: 'hsl(var(--primary) / 0.1)' }}
                      >
                        <Files size={14} style={{ color: 'hsl(var(--primary))' }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: 'hsl(var(--foreground))' }}>
                          {file.file_name}
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
                          {shortDate(file.created_at)}
                          {file.file_size ? ` · ${(file.file_size / 1024 / 1024).toFixed(1)} MB` : ''}
                        </p>
                      </div>
                      <Download
                        size={15}
                        className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                        style={{ color: 'hsl(var(--primary))' }}
                      />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* ── Right column ── */}
        <div className="space-y-6">

          {/* Account snapshot */}
          <section
            className="rounded-xl p-5"
            style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
          >
            <div className="flex items-center gap-2 mb-4">
              <CreditCard size={15} style={{ color: 'hsl(var(--primary))' }} />
              <h2 className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>Billing Snapshot</h2>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>Outstanding balance</p>
                <p
                  className="font-display text-2xl font-bold tabular-nums mt-0.5"
                  style={{ color: outstanding > 0 ? 'hsl(var(--foreground))' : 'hsl(var(--status-green))' }}
                >
                  {formatCurrency(outstanding)}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg p-3" style={{ backgroundColor: 'hsl(var(--secondary))' }}>
                  <div className="flex items-center gap-1.5">
                    <TrendingUp size={12} style={{ color: 'hsl(var(--status-green))' }} />
                    <p className="text-[11px]" style={{ color: 'hsl(var(--muted-foreground))' }}>Paid to date</p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums mt-1" style={{ color: 'hsl(var(--foreground))' }}>
                    {formatCurrency(paidToDate)}
                  </p>
                </div>
                <div className="rounded-lg p-3" style={{ backgroundColor: 'hsl(var(--secondary))' }}>
                  <div className="flex items-center gap-1.5">
                    <CalendarClock size={12} style={{ color: nextInvoice ? 'hsl(var(--primary))' : 'hsl(var(--text-faint))' }} />
                    <p className="text-[11px]" style={{ color: 'hsl(var(--muted-foreground))' }}>Next due</p>
                  </div>
                  <p className="text-sm font-semibold mt-1" style={{ color: 'hsl(var(--foreground))' }}>
                    {nextInvoice?.due_date ? shortDate(nextInvoice.due_date) : '—'}
                  </p>
                </div>
              </div>

              {payLink ? (
                <a
                  href={payLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="card-interactive flex items-center justify-center gap-2 w-full py-2.5 rounded-lg text-sm font-semibold"
                  style={{ backgroundColor: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
                >
                  Pay now <ArrowRight size={14} />
                </a>
              ) : (
                <Link
                  href="/invoices"
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg text-sm font-medium transition-colors"
                  style={{ backgroundColor: 'hsl(var(--secondary))', color: 'hsl(var(--foreground))', border: '1px solid hsl(var(--border))' }}
                >
                  View invoices <ArrowRight size={14} />
                </Link>
              )}
            </div>
          </section>

          {/* Recent activity */}
          <section
            className="rounded-xl p-5"
            style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Activity size={15} style={{ color: 'hsl(var(--primary))' }} />
                <h2 className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>Recent Activity</h2>
              </div>
              <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: 'hsl(var(--status-green))' }} title="Live" />
            </div>

            {activity.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8">
                <Clock size={22} style={{ color: 'hsl(var(--text-faint))' }} />
                <p className="text-xs mt-2" style={{ color: 'hsl(var(--text-faint))' }}>No activity yet</p>
              </div>
            ) : (
              <div className="space-y-1">
                {activity.map((item) => {
                  const Icon = item.kind === 'file' ? Files : MessageSquare
                  const color = item.kind === 'file' ? 'hsl(var(--primary))' : 'hsl(var(--status-violet))'
                  return (
                    <div key={item.id} className="flex items-start gap-3 p-2 rounded-lg">
                      <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                        style={{ backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)` }}
                      >
                        <Icon size={13} style={{ color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium leading-snug truncate" style={{ color: 'hsl(var(--foreground))' }}>
                          {item.title}
                        </p>
                        <p className="text-[11px] truncate" style={{ color: 'hsl(var(--muted-foreground))' }}>
                          {item.sub}
                        </p>
                      </div>
                      <span className="text-[10px] flex-shrink-0 mt-0.5" style={{ color: 'hsl(var(--text-faint))' }}>
                        {timeAgo(item.time)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* Support nudge */}
          <Link href="/messages" className="block">
            <section
              className="card-interactive rounded-xl p-5 cursor-pointer"
              style={{
                background: 'linear-gradient(135deg, hsl(var(--primary) / 0.1) 0%, hsl(var(--primary) / 0.03) 100%)',
                border: '1px solid hsl(var(--primary) / 0.2)',
              }}
            >
              <div className="flex items-center gap-2">
                <Sparkles size={15} style={{ color: 'hsl(var(--primary))' }} />
                <h2 className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>Need anything?</h2>
              </div>
              <p className="text-xs mt-2 leading-relaxed" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Message your project manager directly — we usually reply within a few hours.
              </p>
              <div className="flex items-center gap-1 text-sm mt-3 font-medium" style={{ color: 'hsl(var(--primary))' }}>
                Open messages <ArrowRight size={14} />
              </div>
            </section>
          </Link>
        </div>
      </div>
    </div>
  )
}
