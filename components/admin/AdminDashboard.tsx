'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { computeProjectProgress, phaseColor } from '@/lib/projectProgress'
import {
  Folder,
  Users,
  DollarSign,
  MessageSquare,
  TrendingUp,
  Clock,
  AlertCircle,
  Plus,
  ArrowRight,
  Film,
  Upload,
  CheckSquare,
  User,
  Zap,
  Circle,
  Activity,
} from 'lucide-react'

// ── Types ───────────────────────────────────────

type Phase = { id: string; name: string; progress: number; sort_order: number; is_complete: boolean }

type Project = {
  id: string
  title: string
  status: string
  progress: number | null
  created_at: string
  updated_at: string
  clients: {
    id: string
    name: string
    company: string | null
    avatar_url: string | null
  } | null
  project_phases: Phase[]
  tasks: {
    id: string
    status: string
    visible_to_client: boolean
    requires_approval?: boolean | null
    approval_status?: string | null
    approved_at?: string | null
  }[]
  files: { id: string }[]
  messages: { id: string }[]
  invoices: { id: string; amount: number; status: string }[]
}

type Client = {
  id: string
  name: string
  company: string | null
  email: string
  avatar_url: string | null
  created_at: string
  projects: { id: string; status: string; updated_at?: string | null }[]
}

// Most recent timestamp we know about for a client — their newest project
// activity, falling back to when the client was created.
function clientRecency(c: Client): number {
  const times = [
    ...c.projects.map((p) => (p.updated_at ? new Date(p.updated_at).getTime() : 0)),
    new Date(c.created_at).getTime(),
  ]
  return Math.max(...times)
}

// Recent Activity is sourced from the admin notification stream, so it reflects
// every alert type — not just messages.
type ActivityEvent = {
  id: string
  type: string
  title: string
  body: string | null
  created_at: string
  project_id: string | null
  client_id: string | null
}

type Revenue = {
  collected: number
  outstanding: number
  overdue: number
}

// ── Helpers ─────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  'In Production': { label: 'In Production', color: 'hsl(var(--status-blue))', bg: 'hsl(var(--status-blue) / 0.08)', dot: 'hsl(var(--status-blue))' },
  'Pre-Production': { label: 'Pre-Production', color: 'hsl(var(--primary))', bg: 'hsl(var(--primary) / 0.08)', dot: 'hsl(var(--primary))' },
  'Review': { label: 'Review', color: 'hsl(var(--status-violet))', bg: 'hsl(var(--status-violet) / 0.08)', dot: 'hsl(var(--status-violet))' },
  'In Review': { label: 'In Review', color: 'hsl(var(--status-violet))', bg: 'hsl(var(--status-violet) / 0.08)', dot: 'hsl(var(--status-violet))' },
  'Revisions': { label: 'Revisions', color: 'hsl(var(--primary))', bg: 'hsl(var(--primary) / 0.08)', dot: 'hsl(var(--primary))' },
  'Onboarding': { label: 'Onboarding', color: 'hsl(var(--status-blue))', bg: 'hsl(var(--status-blue) / 0.08)', dot: 'hsl(var(--status-blue))' },
  'Post-Production': { label: 'Post-Production', color: 'hsl(var(--status-violet))', bg: 'hsl(var(--status-violet) / 0.08)', dot: 'hsl(var(--status-violet))' },
  'Completed': { label: 'Completed', color: 'hsl(var(--status-green))', bg: 'hsl(var(--status-green) / 0.08)', dot: 'hsl(var(--status-green))' },
  'On Hold': { label: 'On Hold', color: 'hsl(var(--muted-foreground))', bg: 'hsl(var(--status-gray) / 0.08)', dot: 'hsl(var(--muted-foreground))' },
}

// Keyed by notification type — a distinct glyph + accent per alert kind so the
// feed reads at a glance (not one repeated icon).
const EVENT_ICONS: Record<string, { icon: any; color: string }> = {
  message: { icon: MessageSquare, color: 'hsl(var(--status-violet))' },
  file_delivered: { icon: Upload, color: 'hsl(var(--status-blue))' },
  status_change: { icon: Zap, color: 'hsl(var(--status-amber))' },
  invoice_created: { icon: DollarSign, color: 'hsl(var(--status-green))' },
  task_updated: { icon: CheckSquare, color: 'hsl(var(--primary))' },
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n)
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  const hrs = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  if (hrs < 24) return `${hrs}h ago`
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function getInitials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
}

const isTaskDone = (s: string | null | undefined) =>
  ['complete', 'completed', 'done'].includes((s ?? '').toLowerCase())

// Per-project task rollup — shared by the Tasks tab and the summary band.
function taskStats(project: Project) {
  const tasks = project.tasks ?? []
  const total = tasks.length
  const done = tasks.filter((t) => isTaskDone(t.status) || !!t.approved_at).length
  const awaitingApproval = tasks.filter(
    (t) => !t.approved_at && (t.status === 'review' || t.approval_status === 'changes_requested'),
  ).length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return { total, done, awaitingApproval, pct }
}

// ── Main Component ──────────────────────────────

export default function AdminDashboard({
  projects,
  clients,
  activity: initialActivity,
  revenue,
  unreadMessages,
  adminName,
}: {
  projects: Project[]
  clients: Client[]
  activity: ActivityEvent[]
  revenue: Revenue
  unreadMessages: number
  adminName: string
}) {
  const supabase = createClient()
  const [activity, setActivity] = useState(initialActivity)
  const [activeTab, setActiveTab] = useState<'pipeline' | 'clients' | 'tasks'>('pipeline')
  const [statusFilter, setStatusFilter] = useState('all')

  // Realtime activity feed — live admin notifications (any alert type). The
  // payload carries the full row, so no follow-up read is needed.
  useEffect(() => {
    let channel: any
    try {
      channel = supabase
        .channel('admin-activity-notifs')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' },
          (payload) => {
            const n = payload.new as ActivityEvent & { for_admin?: boolean }
            if (!n || (n as any).for_admin !== true) return
            setActivity((prev) =>
              prev.some((x) => x.id === n.id)
                ? prev.map((x) => (x.id === n.id ? { ...x, ...n } : x))
                : [n, ...prev].slice(0, 40)
            )
          }
        )
        .subscribe()
    } catch {
      // silently ignore
    }
    return () => { if (channel) supabase.removeChannel(channel) }
  }, [])

  const activeProjects = projects.filter((p) => p.status !== 'Completed' && p.status !== 'On Hold')
  const projectsInReview = projects.filter((p) => p.status === 'In Review' || p.status === 'Review')
  const totalClients = clients.length
  const clientsWithActive = clients.filter((c) =>
    c.projects.some((p) => !['Completed', 'On Hold'].includes(p.status))
  ).length
  const pipelineProjects = statusFilter === 'all' ? projects : projects.filter((p) => p.status === statusFilter)
  const presentStatuses = Array.from(new Set(projects.map((p) => p.status)))
  // Task rollups across the workspace — power the Tasks tab + summary band.
  const totalTasks = projects.reduce((a, p) => a + (p.tasks?.length ?? 0), 0)
  const doneTasks = projects.reduce((a, p) => a + taskStats(p).done, 0)
  const awaitingApprovalTotal = projects.reduce((a, p) => a + taskStats(p).awaitingApproval, 0)
  const taskPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0
  // Projects that actually carry tasks, most active first (already sorted by updated_at).
  const taskProjects = projects.filter((p) => (p.tasks?.length ?? 0) > 0)
  // Recently worked-on clients first (newest project activity), then capped.
  const recentClients = [...clients].sort((a, b) => clientRecency(b) - clientRecency(a))
  // Strict overview caps — at most 3 projects and 5 clients shown at a time.
  const MAX_PIPELINE = 3
  const MAX_CLIENTS = 5

  return (
    <div className="space-y-6 w-full">

      {/* Greeting */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'hsl(var(--text-faint))' }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
          <h1 className="font-display text-2xl font-bold" style={{ color: 'hsl(var(--foreground))' }}>
            Good{' '}
            {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}
            , {adminName.split(' ')[0]} 👋
          </h1>
          <p className="text-sm mt-1" style={{ color: 'hsl(var(--muted-foreground))' }}>
            {activeProjects.length} active project{activeProjects.length !== 1 ? 's' : ''}
            {projectsInReview.length > 0 ? ` · ${projectsInReview.length} awaiting review` : ''}
            {unreadMessages > 0 ? ` · ${unreadMessages} unread message${unreadMessages > 1 ? 's' : ''}` : ''}
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Link href="/admin/projects/new"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all"
            style={{ backgroundColor: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'hsl(var(--primary))' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'hsl(var(--primary))' }}
          >
            <Plus size={12} /> New Project
          </Link>
          <Link href="/admin/clients/new"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all"
            style={{ backgroundColor: 'hsl(var(--secondary))', color: 'hsl(var(--foreground))', border: '1px solid hsl(var(--border))' }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'hsl(var(--text-faint))' }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'hsl(var(--border))' }}
          >
            <Plus size={12} /> New Client
          </Link>
          <Link href="/admin/invoices/new"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all"
            style={{ backgroundColor: 'hsl(var(--secondary))', color: 'hsl(var(--foreground))', border: '1px solid hsl(var(--border))' }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'hsl(var(--text-faint))' }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'hsl(var(--border))' }}
          >
            <DollarSign size={12} /> New Invoice
          </Link>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Active Projects', value: activeProjects.length, sub: projectsInReview.length > 0 ? `${projectsInReview.length} in review` : 'On track', icon: Film, color: 'hsl(var(--primary))', bg: 'hsl(var(--primary) / 0.07)', href: '/admin/projects' },
          { label: 'Clients', value: totalClients, sub: `${clientsWithActive} with active work`, icon: Users, color: 'hsl(var(--status-blue))', bg: 'hsl(var(--status-blue) / 0.07)', href: '/admin/clients' },
          { label: 'Tasks', value: `${doneTasks}/${totalTasks}`, sub: awaitingApprovalTotal > 0 ? `${awaitingApprovalTotal} awaiting approval` : (totalTasks > 0 ? `${taskPct}% complete` : 'No tasks yet'), icon: CheckSquare, color: 'hsl(var(--status-green))', bg: 'hsl(var(--status-green) / 0.07)', href: '/admin/projects' },
          {
            label: unreadMessages > 0 ? `${unreadMessages} Unread` : 'Messages',
            value: unreadMessages > 0 ? `${unreadMessages} new` : 'All read',
            sub: unreadMessages > 0 ? 'Needs a reply' : 'Inbox clear',
            icon: MessageSquare,
            color: unreadMessages > 0 ? 'hsl(var(--destructive))' : 'hsl(var(--muted-foreground))',
            bg: unreadMessages > 0 ? 'hsl(var(--destructive) / 0.07)' : 'hsl(var(--status-gray) / 0.07)',
            href: '/admin/messages',
          },
        ].map((kpi) => {
          const Icon = kpi.icon
          return (
            <Link key={kpi.label} href={kpi.href}
              className="card-interactive p-5 rounded-xl block group"
              style={{ backgroundColor: kpi.bg, border: `1px solid color-mix(in srgb, ${kpi.color} 9%, transparent)` }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = `color-mix(in srgb, ${kpi.color} 20%, transparent)` }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = `color-mix(in srgb, ${kpi.color} 9%, transparent)` }}
            >
              <div className="flex items-center justify-between mb-3">
                <Icon size={16} style={{ color: kpi.color }} />
                <ArrowRight size={13} className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: kpi.color }} />
              </div>
              <p className="font-display text-2xl font-bold tabular-nums" style={{ color: 'hsl(var(--foreground))' }}>{kpi.value}</p>
              <p className="text-xs mt-1" style={{ color: 'hsl(var(--muted-foreground))' }}>{kpi.label}</p>
              {kpi.sub && (
                <p className="text-[11px] mt-1.5 font-medium" style={{ color: kpi.color }}>{kpi.sub}</p>
              )}
            </Link>
          )
        })}
      </div>

      {/* Billing Summary — enterprise revenue snapshot across all clients */}
      <BillingSummary revenue={revenue} />

      {/* Main 2-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">

        {/* Left: Pipeline + Clients tabs */}
        <div className="space-y-4">
          {/* Tabs */}
          <div className="flex items-center justify-between gap-2" style={{ borderBottom: '1px solid hsl(var(--border))' }}>
            <div className="flex gap-1">
              {[
                { key: 'pipeline', label: 'Project Pipeline', count: projects.length },
                { key: 'clients', label: 'Clients', count: clients.length },
                { key: 'tasks', label: 'Tasks', count: totalTasks },
              ].map(({ key, label, count }) => (
                <button key={key}
                  onClick={() => setActiveTab(key as 'pipeline' | 'clients' | 'tasks')}
                  className="px-4 py-3 text-sm font-semibold transition-all relative"
                  style={{ color: activeTab === key ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))' }}
                >
                  {label}
                  <span className="ml-2 text-xs" style={{ color: activeTab === key ? 'hsl(var(--primary))' : 'hsl(var(--text-faint))' }}>{count}</span>
                  {activeTab === key && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t" style={{ backgroundColor: 'hsl(var(--primary))' }} />
                  )}
                </button>
              ))}
            </div>
            <Link
              href={activeTab === 'clients' ? '/admin/clients' : '/admin/projects'}
              className="flex items-center gap-1 text-xs font-semibold pr-1 flex-shrink-0"
              style={{ color: 'hsl(var(--primary))' }}
            >
              View all <ArrowRight size={12} />
            </Link>
          </div>

          {/* Pipeline tab */}
          {activeTab === 'pipeline' && (
            <div className="space-y-3">
              <div className="flex gap-1.5 flex-wrap">
                <button onClick={() => setStatusFilter('all')}
                  className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                  style={{ backgroundColor: statusFilter === 'all' ? 'hsl(var(--primary))' : 'hsl(var(--secondary))', color: statusFilter === 'all' ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))' }}
                >
                  All {projects.length}
                </button>
                {presentStatuses.map((status) => {
                  const cfg = STATUS_CONFIG[status]
                  const count = projects.filter((p) => p.status === status).length
                  return (
                    <button key={status} onClick={() => setStatusFilter(status)}
                      className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                      style={{ backgroundColor: statusFilter === status ? (cfg?.color ?? 'hsl(var(--primary))') : 'hsl(var(--secondary))', color: statusFilter === status ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))' }}
                    >
                      {status} {count}
                    </button>
                  )
                })}
              </div>

              {pipelineProjects.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 rounded-xl"
                  style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
                  <Folder size={28} style={{ color: 'hsl(var(--text-faint))' }} />
                  <p className="text-sm mt-3" style={{ color: 'hsl(var(--muted-foreground))' }}>No projects yet</p>
                  <Link href="/admin/projects/new"
                    className="flex items-center gap-2 mt-4 px-4 py-2 rounded-lg text-sm font-semibold"
                    style={{ backgroundColor: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}>
                    <Plus size={13} /> Create first project
                  </Link>
                </div>
              ) : (
                <div className="space-y-2">
                  {pipelineProjects.slice(0, MAX_PIPELINE).map((project) => <ProjectCard key={project.id} project={project} />)}
                  {pipelineProjects.length > MAX_PIPELINE && (
                    <Link href="/admin/projects" className="flex items-center justify-center gap-1.5 py-3 rounded-xl text-xs font-semibold transition-all"
                      style={{ color: 'hsl(var(--primary))', border: '1px dashed hsl(var(--border))' }}>
                      View all {pipelineProjects.length} projects <ArrowRight size={12} />
                    </Link>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Clients tab */}
          {activeTab === 'clients' && (
            <div className="space-y-2">
              {clients.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 rounded-xl"
                  style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
                  <Users size={28} style={{ color: 'hsl(var(--text-faint))' }} />
                  <p className="text-sm mt-3" style={{ color: 'hsl(var(--muted-foreground))' }}>No clients yet</p>
                </div>
              ) : (
                <>
                  {recentClients.slice(0, MAX_CLIENTS).map((client) => <ClientRow key={client.id} client={client} />)}
                  {recentClients.length > MAX_CLIENTS && (
                    <Link href="/admin/clients" className="flex items-center justify-center gap-1.5 py-3 rounded-xl text-xs font-semibold transition-all"
                      style={{ color: 'hsl(var(--primary))', border: '1px dashed hsl(var(--border))' }}>
                      View all {recentClients.length} clients <ArrowRight size={12} />
                    </Link>
                  )}
                </>
              )}
            </div>
          )}

          {/* Tasks tab — medium overview summary + per-project task progress */}
          {activeTab === 'tasks' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Total Tasks', value: totalTasks, color: 'hsl(var(--muted-foreground))' },
                  { label: 'Completed', value: doneTasks, color: 'hsl(var(--status-green))' },
                  { label: 'Awaiting Approval', value: awaitingApprovalTotal, color: awaitingApprovalTotal > 0 ? 'hsl(var(--status-amber))' : 'hsl(var(--text-faint))' },
                  { label: 'Overall', value: `${taskPct}%`, color: 'hsl(var(--primary))' },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl p-4" style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
                    <p className="font-display text-2xl font-bold tabular-nums" style={{ color: s.color }}>{s.value}</p>
                    <p className="text-[11px] mt-1" style={{ color: 'hsl(var(--muted-foreground))' }}>{s.label}</p>
                  </div>
                ))}
              </div>

              {taskProjects.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 rounded-xl"
                  style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
                  <CheckSquare size={28} style={{ color: 'hsl(var(--text-faint))' }} />
                  <p className="text-sm mt-3" style={{ color: 'hsl(var(--muted-foreground))' }}>No tasks yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {taskProjects.slice(0, MAX_PIPELINE).map((project) => <TaskProjectRow key={project.id} project={project} />)}
                  {taskProjects.length > MAX_PIPELINE && (
                    <Link href="/admin/projects" className="flex items-center justify-center gap-1.5 py-3 rounded-xl text-xs font-semibold transition-all"
                      style={{ color: 'hsl(var(--primary))', border: '1px dashed hsl(var(--border))' }}>
                      View all {taskProjects.length} projects with tasks <ArrowRight size={12} />
                    </Link>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Activity feed — styled like the client portal's Recent Activity card */}
        <section
          className="rounded-xl p-5 h-fit"
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
            <div className="flex flex-col items-center justify-center py-10">
              <Clock size={22} style={{ color: 'hsl(var(--text-faint))' }} />
              <p className="text-xs mt-2" style={{ color: 'hsl(var(--text-faint))' }}>No activity yet</p>
            </div>
          ) : (
            <div className="space-y-1 max-h-[420px] overflow-y-auto scrollbar-thin -mr-1 pr-1">
              {activity.slice(0, 20).map((event, i) => <ActivityItem key={event.id} event={event} isFirst={i === 0} />)}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

// ── BillingSummary ──────────────────────────────

function BillingSummary({ revenue }: { revenue: Revenue }) {
  const total = revenue.collected + revenue.outstanding
  const collectedPct = total > 0 ? Math.round((revenue.collected / total) * 100) : 100
  const stats = [
    { label: 'Collected', value: revenue.collected, color: 'hsl(var(--status-green))' },
    { label: 'Outstanding', value: revenue.outstanding, color: 'hsl(var(--primary))' },
    { label: 'Overdue', value: revenue.overdue, color: 'hsl(var(--destructive))' },
  ]
  return (
    <section
      className="relative rounded-2xl p-6 overflow-hidden"
      style={{
        // Liquid glass: translucent surface + blur + layered sheen.
        backgroundColor: 'hsl(var(--card) / 0.55)',
        backdropFilter: 'blur(20px) saturate(140%)',
        WebkitBackdropFilter: 'blur(20px) saturate(140%)',
        border: '1px solid hsl(var(--border) / 0.7)',
        boxShadow: '0 1px 0 hsl(0 0% 100% / 0.06) inset, 0 18px 40px -24px rgba(0,0,0,0.5)',
      }}
    >
      {/* Ambient gradient glow */}
      <div className="pointer-events-none absolute inset-0" style={{
        background: 'radial-gradient(120% 80% at 100% 0%, hsl(var(--primary) / 0.10), transparent 55%), radial-gradient(120% 90% at 0% 100%, hsl(var(--status-green) / 0.08), transparent 50%)',
      }} />
      <div className="relative">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'hsl(var(--primary) / 0.12)', border: '1px solid hsl(var(--primary) / 0.2)' }}>
              <DollarSign size={16} style={{ color: 'hsl(var(--primary))' }} />
            </div>
            <div>
              <h2 className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>Billing Summary</h2>
              <p className="text-[11px]" style={{ color: 'hsl(var(--text-faint))' }}>Across all clients</p>
            </div>
          </div>
          <Link href="/admin/invoices" className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
            style={{ color: 'hsl(var(--primary))', backgroundColor: 'hsl(var(--primary) / 0.08)', border: '1px solid hsl(var(--primary) / 0.15)' }}>
            View invoices <ArrowRight size={12} />
          </Link>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {stats.map((s) => (
            <div key={s.label} className="rounded-xl p-4" style={{ backgroundColor: 'hsl(var(--background) / 0.4)', border: '1px solid hsl(var(--border) / 0.6)' }}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: s.value > 0 ? s.color : 'hsl(var(--text-faint))' }} />
                <p className="text-[11px] font-medium" style={{ color: 'hsl(var(--muted-foreground))' }}>{s.label}</p>
              </div>
              <p className="font-display text-2xl font-bold tabular-nums" style={{ color: s.value > 0 ? s.color : 'hsl(var(--text-faint))' }}>
                {formatCurrency(s.value)}
              </p>
            </div>
          ))}
        </div>

        {total > 0 && (() => {
          // 3-segment bar that always fills 100%: Collected (green) ·
          // Outstanding (primary, in the middle) · Overdue (red).
          const overduePct = Math.round((revenue.overdue / total) * 100)
          const outstandingMidPct = Math.max(0, 100 - collectedPct - overduePct)
          return (
            <div className="mt-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium" style={{ color: 'hsl(var(--muted-foreground))' }}>{collectedPct}% collected</span>
                {revenue.overdue > 0 && (
                  <span className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: 'hsl(var(--destructive))' }}>
                    <AlertCircle size={11} /> {formatCurrency(revenue.overdue)} past due
                  </span>
                )}
              </div>
              <div className="h-2.5 rounded-full overflow-hidden flex" style={{ backgroundColor: 'hsl(var(--secondary) / 0.7)' }}>
                <div className="h-full" title="Collected" style={{ width: `${collectedPct}%`, background: 'linear-gradient(90deg, color-mix(in srgb, hsl(var(--status-green)) 72%, #000), hsl(var(--status-green)))' }} />
                <div className="h-full" title="Outstanding" style={{ width: `${outstandingMidPct}%`, backgroundColor: 'hsl(var(--primary))' }} />
                <div className="h-full" title="Overdue" style={{ width: `${overduePct}%`, backgroundColor: 'hsl(var(--destructive))' }} />
              </div>
              {/* Legend */}
              <div className="flex items-center gap-4 mt-2 flex-wrap">
                {[
                  { label: 'Collected', color: 'hsl(var(--status-green))' },
                  { label: 'Outstanding', color: 'hsl(var(--primary))' },
                  { label: 'Overdue', color: 'hsl(var(--destructive))' },
                ].map((l) => (
                  <span key={l.label} className="flex items-center gap-1.5 text-[10px]" style={{ color: 'hsl(var(--muted-foreground))' }}>
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: l.color }} /> {l.label}
                  </span>
                ))}
              </div>
            </div>
          )
        })()}
      </div>
    </section>
  )
}

// ── ProjectCard ─────────────────────────────────

function ProjectCard({ project }: { project: Project }) {
  const cfg = STATUS_CONFIG[project.status] ?? { label: project.status, color: 'hsl(var(--muted-foreground))', bg: 'hsl(var(--status-gray) / 0.08)', dot: 'hsl(var(--muted-foreground))' }
  // Canonical (phase-based) completion — matches the project detail / client.
  const phases = [...(project.project_phases ?? [])].sort((a, b) => a.sort_order - b.sort_order)
  const completion = computeProjectProgress(phases, project.progress)
  const unpaidRevenue = project.invoices.filter((i) => ['unpaid', 'overdue'].includes(i.status)).reduce((a, i) => a + Number(i.amount), 0)

  return (
    <Link href={`/admin/projects/${project.id}`}
      className="card-interactive block p-4 rounded-xl group"
      style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
    >
      <div className="flex items-center gap-4">
        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: cfg.dot }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold truncate" style={{ color: 'hsl(var(--foreground))' }}>{project.title}</p>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: cfg.bg, color: cfg.color }}>{cfg.label}</span>
          </div>
          {project.clients && (
            <p className="text-xs mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
              {project.clients.name}{project.clients.company ? ` · ${project.clients.company}` : ''}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2">
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'hsl(var(--secondary))' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${completion}%`, background: completion === 100 ? 'hsl(var(--status-green))' : `linear-gradient(90deg, color-mix(in srgb, ${cfg.color} 72%, #000), ${cfg.color})` }} />
            </div>
            <span className="text-[10px] tabular-nums flex-shrink-0 font-semibold" style={{ color: completion === 100 ? 'hsl(var(--status-green))' : 'hsl(var(--text-faint))' }}>{completion}%</span>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {project.files.length > 0 && <span className="text-xs hidden sm:inline" style={{ color: 'hsl(var(--text-faint))' }}>{project.files.length} files</span>}
          {project.messages.length > 0 && <span className="text-xs hidden sm:inline" style={{ color: 'hsl(var(--text-faint))' }}>{project.messages.length} msgs</span>}
          {unpaidRevenue > 0 && <span className="text-xs font-semibold" style={{ color: 'hsl(var(--primary))' }}>{formatCurrency(unpaidRevenue)}</span>}
          <ArrowRight size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'hsl(var(--primary))' }} />
        </div>
      </div>

      {/* Vertical phase overview — live per-phase progress (realtime-refreshed) */}
      {phases.length > 0 && (
        <div className="mt-3 pl-6 space-y-1.5" style={{ borderTop: '1px solid hsl(var(--border))', paddingTop: 12 }}>
          {phases.map((ph, i) => (
            <div key={ph.id} className="flex items-center gap-2.5">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: ph.is_complete ? 'hsl(var(--status-green))' : phaseColor(i) }} />
              <span className="text-[11px] flex-shrink-0 w-28 truncate" style={{ color: ph.is_complete ? 'hsl(var(--status-green))' : 'hsl(var(--muted-foreground))' }}>{ph.name}</span>
              <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'hsl(var(--secondary))' }}>
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${ph.progress}%`, backgroundColor: ph.is_complete ? 'hsl(var(--status-green))' : phaseColor(i) }} />
              </div>
              <span className="text-[10px] tabular-nums flex-shrink-0 w-8 text-right" style={{ color: 'hsl(var(--text-faint))' }}>{ph.progress}%</span>
            </div>
          ))}
        </div>
      )}
    </Link>
  )
}

// ── TaskProjectRow ──────────────────────────────

function TaskProjectRow({ project }: { project: Project }) {
  const { total, done, awaitingApproval, pct } = taskStats(project)
  return (
    <Link href={`/admin/projects/${project.id}?tab=tasks`}
      className="card-interactive block p-4 rounded-xl group"
      style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'hsl(var(--secondary))' }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'hsl(var(--card))' }}
    >
      <div className="flex items-center gap-4">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: 'hsl(var(--primary) / 0.08)' }}>
          <CheckSquare size={15} style={{ color: 'hsl(var(--primary))' }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold truncate" style={{ color: 'hsl(var(--foreground))' }}>{project.title}</p>
            {awaitingApproval > 0 && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: 'hsl(var(--status-amber) / 0.12)', color: 'hsl(var(--status-amber))' }}>
                {awaitingApproval} awaiting approval
              </span>
            )}
          </div>
          {project.clients && (
            <p className="text-xs mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
              {project.clients.name}{project.clients.company ? ` · ${project.clients.company}` : ''}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2">
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'hsl(var(--secondary))' }}>
              <div className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, background: pct === 100 ? 'hsl(var(--status-green))' : 'linear-gradient(90deg, color-mix(in srgb, hsl(var(--primary)) 72%, #000), hsl(var(--primary)))' }} />
            </div>
            <span className="text-[10px] tabular-nums flex-shrink-0 font-semibold"
              style={{ color: pct === 100 ? 'hsl(var(--status-green))' : 'hsl(var(--text-faint))' }}>{done}/{total}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="font-display text-sm font-bold tabular-nums" style={{ color: 'hsl(var(--primary))' }}>{pct}%</span>
          <ArrowRight size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'hsl(var(--primary))' }} />
        </div>
      </div>
    </Link>
  )
}

// ── ClientRow ───────────────────────────────────

function ClientRow({ client }: { client: Client }) {
  const activeCount = client.projects.filter((p) => !['Completed', 'On Hold'].includes(p.status)).length
  return (
    <Link href={`/admin/clients/${client.id}`}
      className="card-interactive flex items-center gap-3 p-4 rounded-xl group block"
      style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'hsl(var(--secondary))'; e.currentTarget.style.borderColor = 'hsl(var(--border))' }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'hsl(var(--card))'; e.currentTarget.style.borderColor = 'hsl(var(--border))' }}
    >
      {client.avatar_url ? (
        <img src={client.avatar_url} alt={client.name} width={36} height={36} loading="lazy" className="rounded-full flex-shrink-0 object-cover" />
      ) : (
        <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold"
          style={{ backgroundColor: 'hsl(var(--primary) / 0.12)', color: 'hsl(var(--primary))' }}>
          {getInitials(client.name)}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate" style={{ color: 'hsl(var(--foreground))' }}>{client.name}</p>
        <p className="text-xs truncate" style={{ color: 'hsl(var(--muted-foreground))' }}>{client.company ?? client.email}</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {activeCount > 0 && (
          <span className="text-xs font-semibold px-2 py-1 rounded-full" style={{ backgroundColor: 'hsl(var(--primary) / 0.1)', color: 'hsl(var(--primary))' }}>
            {activeCount} active
          </span>
        )}
        {client.projects.length === 0 && <span className="text-xs" style={{ color: 'hsl(var(--text-faint))' }}>No projects</span>}
        <ArrowRight size={13} className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'hsl(var(--primary))' }} />
      </div>
    </Link>
  )
}

// ── ActivityItem ────────────────────────────────

function ActivityItem({ event, isFirst }: { event: ActivityEvent; isFirst: boolean }) {
  const cfg = EVENT_ICONS[event.type] ?? { icon: Circle, color: 'hsl(var(--muted-foreground))' }
  const Icon = cfg.icon
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl transition-all"
      style={{ backgroundColor: isFirst ? 'hsl(var(--primary) / 0.04)' : 'transparent', border: isFirst ? '1px solid hsl(var(--primary) / 0.08)' : '1px solid transparent' }}
    >
      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ backgroundColor: `color-mix(in srgb, ${cfg.color} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${cfg.color} 22%, transparent)` }}>
        <Icon size={14} style={{ color: cfg.color }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium leading-snug" style={{ color: 'hsl(var(--foreground))' }}>{event.title}</p>
        {event.body && (
          <p className="text-[11px] mt-0.5 truncate" style={{ color: 'hsl(var(--muted-foreground))' }}>{event.body}</p>
        )}
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {event.project_id && (
            <Link href={`/admin/projects/${event.project_id}`}
              className="text-[10px] transition-colors" style={{ color: 'hsl(var(--muted-foreground))' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'hsl(var(--primary))' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'hsl(var(--muted-foreground))' }}
            >
              View project
            </Link>
          )}
          {event.project_id && <span style={{ color: 'hsl(var(--border))' }}>·</span>}
          <span className="text-[10px]" style={{ color: 'hsl(var(--text-faint))' }}>{timeAgo(event.created_at)}</span>
        </div>
      </div>
    </div>
  )
}
