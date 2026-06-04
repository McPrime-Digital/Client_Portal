import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import StatusBadge from '@/components/portal/StatusBadge'
import WelcomeBanner from '@/components/portal/WelcomeBanner'
import OverviewGreeting from '@/components/portal/OverviewGreeting'
import ProgressBar from '@/components/shared/ProgressBar'
import RealtimeRefresh from '@/components/shared/RealtimeRefresh'
import { applyCanonicalProgress, phaseColor } from '@/lib/projectProgress'
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
  Sparkles,
  ClipboardList,
  CheckCircle2,
  FileVideo,
  FileImage,
  FileText,
  FileArchive,
  FileAudio,
  File as FileIcon,
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

type PhaseRow = {
  id: string
  project_id: string
  name: string
  progress: number
  sort_order: number
  is_complete: boolean
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

// File-type presentation for the deliverables cards — icon + accent + extension.
function fileMeta(fileName: string, fileType: string | null) {
  const ext = (fileName.split('.').pop() || '').toUpperCase().slice(0, 4)
  const t = (fileType || '').toLowerCase()
  const name = fileName.toLowerCase()
  const is = (...xs: string[]) => xs.some((x) => t.includes(x) || name.endsWith(`.${x}`))
  if (t.startsWith('video') || is('mp4', 'mov', 'webm', 'mkv'))
    return { Icon: FileVideo, color: 'hsl(var(--status-violet))', ext: ext || 'VIDEO' }
  if (t.startsWith('image') || is('png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'))
    return { Icon: FileImage, color: 'hsl(var(--status-blue))', ext: ext || 'IMG' }
  if (t.startsWith('audio') || is('mp3', 'wav', 'aac', 'm4a'))
    return { Icon: FileAudio, color: 'hsl(var(--status-green))', ext: ext || 'AUDIO' }
  if (is('zip', 'rar', '7z', 'tar', 'gz'))
    return { Icon: FileArchive, color: 'hsl(var(--status-amber))', ext: ext || 'ZIP' }
  if (t.includes('pdf') || t.includes('document') || is('pdf', 'doc', 'docx', 'txt'))
    return { Icon: FileText, color: 'hsl(var(--primary))', ext: ext || 'DOC' }
  return { Icon: FileIcon, color: 'hsl(var(--muted-foreground))', ext: ext || 'FILE' }
}

// Icon + accent for a notification type — drives the Recent Activity feed so it
// reflects every alert kind, not just messages.
function notifMeta(type: string): { Icon: LucideIcon; color: string } {
  switch (type) {
    case 'message': return { Icon: MessageSquare, color: 'hsl(var(--status-violet))' }
    case 'file_delivered': return { Icon: Download, color: 'hsl(var(--status-blue))' }
    case 'status_change': return { Icon: Activity, color: 'hsl(var(--status-amber))' }
    case 'invoice_created': return { Icon: CreditCard, color: 'hsl(var(--status-green))' }
    case 'task_updated': return { Icon: CheckSquare, color: 'hsl(var(--primary))' }
    default: return { Icon: Activity, color: 'hsl(var(--muted-foreground))' }
  }
}

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

  // Welcome banner shows for every client until they dismiss it themselves
  // (persisted in clients.welcome_dismissed_at). Absent column → shows.
  const welcomeDismissed = !!client?.welcome_dismissed_at

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
    { data: recentNotifs },
    { data: invoices },
    { data: phases },
    { count: deliverablesCount },
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
    // Recent Activity stream — every alert type for this client (messages,
    // deliveries, status changes, invoices, task approvals), not just messages.
    supabaseAdmin
      .from('notifications')
      .select('id, type, title, body, created_at, project_id')
      .eq('client_id', client.id)
      .order('created_at', { ascending: false })
      .limit(20),
    supabaseAdmin.from('invoices').select('*').eq('client_id', client.id),
    hasProjects
      ? supabaseAdmin
          .from('project_phases')
          .select('id, project_id, name, progress, sort_order, is_complete')
          .in('project_id', projectIds)
      : Promise.resolve({ data: [] as any[] }),
    // Total delivered files — powers the Deliverables KPI (accurate count,
    // not just the recent slice above).
    supabaseAdmin
      .from('files')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .eq('direction', 'delivery'),
  ])

  // Phases grouped per project (ordered) — drives the live phase breakdown on
  // each active-project card, mirroring the admin pipeline.
  const phasesByProject = new Map<string, PhaseRow[]>()
  for (const ph of (phases ?? []) as PhaseRow[]) {
    const arr = phasesByProject.get(ph.project_id) ?? []
    arr.push(ph)
    phasesByProject.set(ph.project_id, arr)
  }
  for (const arr of phasesByProject.values()) {
    arr.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  }

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
  // Only tasks the client can actually see count toward their progress
  // numbers (internal steps are excluded so the figures match what they see).
  const clientTasks = (tasks ?? []).filter((t) => t.visible_to_client)
  const completedTasks = clientTasks.filter((t) => isTaskDone(t.status) || !!t.approved_at).length
  const totalTasks = clientTasks.length
  const tasksRemaining = Math.max(0, totalTasks - completedTasks)
  const taskPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
  const unreadMessages = (unreadMsgs ?? []).length

  // Per-project task rollup for the Task Process overview card.
  const taskByProject = (projects ?? [])
    .map((p) => {
      const list = clientTasks.filter((t) => t.project_id === p.id)
      const done = list.filter((t) => isTaskDone(t.status) || !!t.approved_at).length
      return {
        id: p.id,
        title: p.title,
        status: p.status,
        total: list.length,
        done,
        pct: list.length > 0 ? Math.round((done / list.length) * 100) : 0,
      }
    })
    .filter((p) => p.total > 0)
    .sort((a, b) => a.pct - b.pct)

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
    (i) => (i.status === 'unpaid' || i.status === 'overdue') && i.stripe_payment_url
  )?.stripe_payment_url

  // Next project delivery
  const upcoming = activeProjects
    .filter((p) => p.due_date)
    .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime())[0]

  // Recent activity — the client's full alert stream (all notification types),
  // so it reflects messages, deliveries, status changes, invoices and task
  // approvals — not just messages.
  type ActivityItem = {
    id: string
    type: string
    title: string
    sub: string
    time: string
    projectId: string | null
  }
  const activity: ActivityItem[] = (recentNotifs ?? []).slice(0, 12).map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    sub: n.body ?? '',
    time: n.created_at,
    projectId: n.project_id ?? null,
  }))

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
      label: 'Deliverables',
      value: deliverablesCount ?? 0,
      sub: (deliverablesCount ?? 0) > 0 ? 'Ready to download' : 'None yet',
      icon: Files,
      href: '/files',
      color: 'hsl(var(--primary))',
    },
  ]

  return (
    <div className="space-y-6 w-full">
      {/* Live: refresh overview when the client's data changes */}
      <RealtimeRefresh
        tables={['projects', 'project_phases', 'tasks', 'invoices', 'activity_log', 'messages', 'files', 'notifications']}
        pollMs={30000}
      />

      {/* Welcome banner — stays until the client closes it themselves */}
      <WelcomeBanner clientName={client?.name ?? 'there'} dismissed={welcomeDismissed} />

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

      {/* Account standing — a premium relationship ribbon. Billing detail
          lives in the Billing Summary card; this is the at-a-glance status. */}
      {(() => {
        const standing = overdueAmount > 0
          ? { label: 'Action needed', tint: 'hsl(var(--destructive))', note: `${formatCurrency(overdueAmount)} overdue` }
          : dueCount > 0
          ? { label: 'Payment due', tint: 'hsl(var(--primary))', note: `${formatCurrency(outstanding)} across ${dueCount} invoice${dueCount !== 1 ? 's' : ''}` }
          : pendingApprovals.length > 0
          ? { label: 'Review pending', tint: 'hsl(var(--status-amber))', note: `${pendingApprovals.length} item${pendingApprovals.length !== 1 ? 's' : ''} awaiting you` }
          : { label: 'In good standing', tint: 'hsl(var(--status-green))', note: 'Everything is up to date' }
        const ctaHref = (overdueAmount > 0 || dueCount > 0) ? '/invoices' : pendingApprovals.length > 0 ? '/projects' : '/projects'
        const facts: string[] = [`${activeProjects.length} active project${activeProjects.length !== 1 ? 's' : ''}`]
        if (upcoming?.due_date) facts.push(`Next delivery ${shortDate(upcoming.due_date)}`)
        return (
          <Link href={ctaHref} className="block">
            <div className="card-interactive flex items-center justify-between gap-4 p-4 rounded-xl flex-wrap"
              style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold flex-shrink-0"
                  style={{ backgroundColor: `color-mix(in srgb, ${standing.tint} 12%, transparent)`, color: standing.tint }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: standing.tint }} />
                  {standing.label}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'hsl(var(--foreground))' }}>{standing.note}</p>
                  <p className="text-xs truncate" style={{ color: 'hsl(var(--muted-foreground))' }}>{facts.join(' · ')}</p>
                </div>
              </div>
              <span className="flex items-center gap-1 text-sm font-semibold flex-shrink-0" style={{ color: standing.tint }}>
                {(overdueAmount > 0 || dueCount > 0) ? 'View invoices' : pendingApprovals.length > 0 ? 'Review now' : 'View projects'}
                <ArrowRight size={14} />
              </span>
            </div>
          </Link>
        )
      })()}

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
              <div className="flex flex-col gap-3">
                {activeProjects.map((project) => (
                  <Link key={project.id} href={`/projects/${project.id}`} className="block">
                    <div className="card-interactive p-5 rounded-xl cursor-pointer bg-[hsl(var(--card))] border border-[hsl(var(--border))]">
                      <div className="flex items-start justify-between gap-4">
                        {/* Project thumbnail */}
                        {(project as any).image_url ? (
                          <img
                            src={(project as any).image_url}
                            alt={project.title}
                            className="w-14 h-14 rounded-xl object-cover flex-shrink-0 border border-[hsl(var(--border))]"
                          />
                        ) : (
                          <div className="w-14 h-14 rounded-xl flex-shrink-0 flex items-center justify-center bg-[hsl(var(--secondary))] border border-[hsl(var(--border))]">
                            <FolderOpen size={20} style={{ color: 'hsl(var(--text-faint))' }} />
                          </div>
                        )}
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

                      {/* Live phase breakdown — mirrors the admin pipeline.
                          Bars animate as the admin advances each phase. */}
                      {(() => {
                        const phs = phasesByProject.get(project.id) ?? []
                        if (phs.length === 0) return null
                        return (
                          <div className="mt-4 pt-4 space-y-1.5" style={{ borderTop: '1px solid hsl(var(--border))' }}>
                            {phs.map((ph, i) => (
                              <div key={ph.id} className="flex items-center gap-2.5">
                                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                  style={{ backgroundColor: ph.is_complete ? 'hsl(var(--status-green))' : phaseColor(i) }} />
                                <span className="text-[11px] flex-shrink-0 w-24 truncate"
                                  style={{ color: ph.is_complete ? 'hsl(var(--status-green))' : 'hsl(var(--muted-foreground))' }}>
                                  {ph.name}
                                </span>
                                <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'hsl(var(--secondary))' }}>
                                  <div className="h-full rounded-full transition-all duration-500"
                                    style={{ width: `${ph.progress}%`, backgroundColor: ph.is_complete ? 'hsl(var(--status-green))' : phaseColor(i) }} />
                                </div>
                                <span className="text-[10px] tabular-nums flex-shrink-0 w-8 text-right" style={{ color: 'hsl(var(--text-faint))' }}>
                                  {ph.progress}%
                                </span>
                              </div>
                            ))}
                          </div>
                        )
                      })()}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* Task Process overview — live production-task progress, end-to-end
              wired (refreshes on any task change via RealtimeRefresh). */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-base font-semibold" style={{ color: 'hsl(var(--foreground))' }}>
                Task Progress
              </h2>
              <Link href="/projects" className="flex items-center gap-1 text-sm" style={{ color: 'hsl(var(--primary))' }}>
                View all <ArrowRight size={14} />
              </Link>
            </div>

            {totalTasks === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 rounded-xl"
                style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
                <ClipboardList size={28} style={{ color: 'hsl(var(--text-faint))' }} />
                <p className="text-sm mt-3" style={{ color: 'hsl(var(--muted-foreground))' }}>
                  No tasks yet — your project plan will appear here
                </p>
              </div>
            ) : (
              <div className="rounded-xl p-5" style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
                {/* Header: overall completion + live indicator + stat chips */}
                <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: 'hsl(var(--primary) / 0.1)' }}>
                      <ClipboardList size={20} style={{ color: 'hsl(var(--primary))' }} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-display text-2xl font-bold tabular-nums" style={{ color: 'hsl(var(--foreground))' }}>
                          {taskPct}%
                        </p>
                        <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: 'hsl(var(--status-green))' }} title="Live" />
                      </div>
                      <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>overall completion</p>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {[
                      { label: 'Done', value: completedTasks, color: 'hsl(var(--status-green))', icon: CheckCircle2 },
                      { label: 'Remaining', value: tasksRemaining, color: 'hsl(var(--muted-foreground))', icon: Clock },
                      { label: 'Awaiting you', value: pendingApprovals.length, color: 'hsl(var(--status-amber))', icon: CheckSquare },
                    ].map((c) => {
                      const Icon = c.icon
                      return (
                        <div key={c.label} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
                          style={{ backgroundColor: 'hsl(var(--secondary))' }}>
                          <Icon size={13} style={{ color: c.color }} />
                          <span className="text-sm font-semibold tabular-nums" style={{ color: 'hsl(var(--foreground))' }}>{c.value}</span>
                          <span className="text-[11px]" style={{ color: 'hsl(var(--muted-foreground))' }}>{c.label}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Overall progress bar */}
                <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'hsl(var(--secondary))' }}>
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${taskPct}%`, background: taskPct === 100 ? 'hsl(var(--status-green))' : 'linear-gradient(90deg, color-mix(in srgb, hsl(var(--primary)) 72%, #000), hsl(var(--primary)))' }} />
                </div>

                {/* Per-project breakdown */}
                {taskByProject.length > 0 && (
                  <div className="mt-5 space-y-3">
                    {taskByProject.slice(0, 5).map((p) => (
                      <Link key={p.id} href={`/projects/${p.id}`} className="flex items-center gap-3 group">
                        <span className="text-xs flex-shrink-0 w-32 truncate transition-colors group-hover:text-[hsl(var(--primary))]"
                          style={{ color: 'hsl(var(--foreground))' }} title={p.title}>
                          {p.title}
                        </span>
                        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'hsl(var(--secondary))' }}>
                          <div className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${p.pct}%`, backgroundColor: p.pct === 100 ? 'hsl(var(--status-green))' : 'hsl(var(--primary))' }} />
                        </div>
                        <span className="text-[11px] tabular-nums flex-shrink-0 w-10 text-right font-semibold"
                          style={{ color: p.pct === 100 ? 'hsl(var(--status-green))' : 'hsl(var(--text-faint))' }}>
                          {p.done}/{p.total}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {recentFiles.slice(0, 6).map((file) => {
                  const { Icon, color, ext } = fileMeta(file.file_name, file.file_type)
                  return (
                    <Link key={file.id} href="/files" className="group">
                      <div
                        className="card-interactive rounded-xl p-4 h-full flex flex-col"
                        style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                      >
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div
                            className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                            style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 20%, transparent)` }}
                          >
                            <Icon size={20} style={{ color }} />
                          </div>
                          <span
                            className="text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-md flex-shrink-0"
                            style={{ backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`, color }}
                          >
                            {ext}
                          </span>
                        </div>
                        <p
                          className="text-sm font-semibold leading-snug break-words line-clamp-2"
                          style={{ color: 'hsl(var(--foreground))' }}
                          title={file.file_name}
                        >
                          {file.file_name}
                        </p>
                        <div className="mt-auto pt-3 flex items-center justify-between gap-2">
                          <span className="text-[11px] truncate" style={{ color: 'hsl(var(--muted-foreground))' }}>
                            {shortDate(file.created_at)}
                            {file.file_size ? ` · ${(file.file_size / 1024 / 1024).toFixed(1)} MB` : ''}
                          </span>
                          <span
                            className="flex items-center gap-1 text-[11px] font-semibold flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                            style={{ color: 'hsl(var(--primary))' }}
                          >
                            <Download size={12} /> Open
                          </span>
                        </div>
                      </div>
                    </Link>
                  )
                })}
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
            <div className="flex items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-2">
                <CreditCard size={15} style={{ color: 'hsl(var(--primary))' }} />
                <h2 className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>Billing Summary</h2>
              </div>
              {overdueAmount > 0 && (
                <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: 'hsl(var(--destructive) / 0.12)', color: 'hsl(var(--destructive))' }}>
                  <AlertCircle size={10} /> {formatCurrency(overdueAmount)} overdue
                </span>
              )}
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
                {activity.map((item, i) => {
                  const { Icon, color } = notifMeta(item.type)
                  // Where tapping the item takes the client — parity with the
                  // admin feed, where every event links to its context.
                  const href =
                    item.type === 'invoice_created'
                      ? '/invoices'
                      : item.projectId
                      ? `/projects/${item.projectId}`
                      : '/messages'
                  const isFirst = i === 0
                  return (
                    <Link
                      key={item.id}
                      href={href}
                      className="flex items-start gap-3 p-3 rounded-xl transition-all card-interactive"
                      style={{
                        backgroundColor: isFirst ? 'hsl(var(--primary) / 0.04)' : 'transparent',
                        border: isFirst ? '1px solid hsl(var(--primary) / 0.08)' : '1px solid transparent',
                      }}
                    >
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                        style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 22%, transparent)` }}
                      >
                        <Icon size={14} style={{ color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium leading-snug" style={{ color: 'hsl(var(--foreground))' }}>
                          {item.title}
                        </p>
                        {item.sub && (
                          <p className="text-[11px] mt-0.5 truncate" style={{ color: 'hsl(var(--muted-foreground))' }}>
                            {item.sub}
                          </p>
                        )}
                      </div>
                      <span className="text-[10px] flex-shrink-0 mt-0.5" style={{ color: 'hsl(var(--text-faint))' }}>
                        {timeAgo(item.time)}
                      </span>
                    </Link>
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
