'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
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

type Project = {
  id: string
  title: string
  status: string
  created_at: string
  updated_at: string
  clients: {
    id: string
    name: string
    company: string | null
    avatar_url: string | null
  } | null
  tasks: { id: string; status: string; visible_to_client: boolean }[]
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
  projects: { id: string; status: string }[]
}

type ActivityEvent = {
  id: string
  event_type: string
  title: string
  body: string | null
  actor_name: string
  actor_role: string
  created_at: string
  projects: { id: string; title: string } | null
  clients: { id: string; name: string } | null
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

const EVENT_ICONS: Record<string, { icon: any; color: string }> = {
  file_uploaded: { icon: Upload, color: 'hsl(var(--status-blue))' },
  message_sent: { icon: MessageSquare, color: 'hsl(var(--status-violet))' },
  task_completed: { icon: CheckSquare, color: 'hsl(var(--status-green))' },
  task_created: { icon: CheckSquare, color: 'hsl(var(--muted-foreground))' },
  invoice_paid: { icon: DollarSign, color: 'hsl(var(--status-green))' },
  invoice_created: { icon: DollarSign, color: 'hsl(var(--primary))' },
  project_created: { icon: Folder, color: 'hsl(var(--primary))' },
  project_status_changed: { icon: Zap, color: 'hsl(var(--primary))' },
  client_created: { icon: User, color: 'hsl(var(--status-blue))' },
  note_added: { icon: MessageSquare, color: 'hsl(var(--muted-foreground))' },
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

function getProjectCompletion(tasks: Project['tasks']): number {
  const visible = tasks.filter((t) => t.visible_to_client)
  if (visible.length === 0) return 0
  const done = visible.filter((t) => t.status === 'completed').length
  return Math.round((done / visible.length) * 100)
}

function getInitials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
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
  const [activeTab, setActiveTab] = useState<'pipeline' | 'clients'>('pipeline')
  const [statusFilter, setStatusFilter] = useState('all')

  // Realtime activity feed
  useEffect(() => {
    let channel: any
    try {
      channel = supabase
        .channel('admin-activity-feed')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_log' },
          async (payload) => {
            const { data } = await supabase
              .from('activity_log')
              .select('*, projects(id, title), clients(id, name)')
              .eq('id', payload.new.id)
              .single()
            if (data) setActivity((prev) => [data, ...prev].slice(0, 40))
          }
        )
        .subscribe()
    } catch {
      // activity_log table may not exist yet — silently ignore
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
          { label: 'Collected', value: formatCurrency(revenue.collected), sub: revenue.outstanding > 0 ? `${formatCurrency(revenue.outstanding)} outstanding` : 'Up to date', icon: TrendingUp, color: 'hsl(var(--status-green))', bg: 'hsl(var(--status-green) / 0.07)', href: '/admin/invoices' },
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

      {/* Outstanding / overdue alert */}
      {(revenue.outstanding > 0 || revenue.overdue > 0) && (
        <div className="flex items-center justify-between gap-4 p-4 rounded-xl flex-wrap"
          style={{
            backgroundColor: revenue.overdue > 0 ? 'hsl(var(--destructive) / 0.06)' : 'hsl(var(--primary) / 0.06)',
            border: revenue.overdue > 0 ? '1px solid hsl(var(--destructive) / 0.2)' : '1px solid hsl(var(--primary) / 0.2)',
          }}
        >
          <div className="flex items-center gap-3">
            <AlertCircle size={16} style={{ color: revenue.overdue > 0 ? 'hsl(var(--destructive))' : 'hsl(var(--primary))' }} />
            <div>
              <p className="text-sm font-semibold" style={{ color: revenue.overdue > 0 ? 'hsl(var(--destructive))' : 'hsl(var(--primary))' }}>
                {revenue.overdue > 0 ? `${formatCurrency(revenue.overdue)} overdue` : `${formatCurrency(revenue.outstanding)} outstanding`}
              </p>
              <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                {revenue.overdue > 0 ? 'Past-due invoices need attention' : 'Unpaid invoices pending'}
              </p>
            </div>
          </div>
          <Link href="/admin/invoices" className="text-xs font-semibold transition-colors flex items-center gap-1" style={{ color: 'hsl(var(--primary))' }}>
            View invoices <ArrowRight size={12} />
          </Link>
        </div>
      )}

      {/* Main 2-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">

        {/* Left: Pipeline + Clients tabs */}
        <div className="space-y-4">
          {/* Tabs */}
          <div className="flex gap-1" style={{ borderBottom: '1px solid hsl(var(--border))' }}>
            {[
              { key: 'pipeline', label: 'Project Pipeline', count: projects.length },
              { key: 'clients', label: 'Clients', count: clients.length },
            ].map(({ key, label, count }) => (
              <button key={key}
                onClick={() => setActiveTab(key as 'pipeline' | 'clients')}
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
                  {pipelineProjects.map((project) => <ProjectCard key={project.id} project={project} />)}
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
                clients.map((client) => <ClientRow key={client.id} client={client} />)
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

// ── ProjectCard ─────────────────────────────────

function ProjectCard({ project }: { project: Project }) {
  const cfg = STATUS_CONFIG[project.status] ?? { label: project.status, color: 'hsl(var(--muted-foreground))', bg: 'hsl(var(--status-gray) / 0.08)', dot: 'hsl(var(--muted-foreground))' }
  const completion = getProjectCompletion(project.tasks)
  const unpaidRevenue = project.invoices.filter((i) => ['unpaid', 'overdue'].includes(i.status)).reduce((a, i) => a + Number(i.amount), 0)

  return (
    <Link href={`/admin/projects/${project.id}`}
      className="card-interactive flex items-center gap-4 p-4 rounded-xl group block"
      style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'hsl(var(--secondary))'; e.currentTarget.style.borderColor = 'hsl(var(--border))' }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'hsl(var(--card))'; e.currentTarget.style.borderColor = 'hsl(var(--border))' }}
    >
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
        {project.tasks.length > 0 && (
          <div className="flex items-center gap-2 mt-2">
            <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'hsl(var(--secondary))' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${completion}%`, backgroundColor: completion === 100 ? 'hsl(var(--status-green))' : cfg.color }} />
            </div>
            <span className="text-[10px] tabular-nums flex-shrink-0" style={{ color: 'hsl(var(--text-faint))' }}>{completion}%</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        {project.files.length > 0 && <span className="text-xs" style={{ color: 'hsl(var(--text-faint))' }}>{project.files.length} files</span>}
        {project.messages.length > 0 && <span className="text-xs" style={{ color: 'hsl(var(--text-faint))' }}>{project.messages.length} msgs</span>}
        {unpaidRevenue > 0 && <span className="text-xs font-semibold" style={{ color: 'hsl(var(--primary))' }}>{formatCurrency(unpaidRevenue)}</span>}
        <ArrowRight size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'hsl(var(--primary))' }} />
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
  const cfg = EVENT_ICONS[event.event_type] ?? { icon: Circle, color: 'hsl(var(--muted-foreground))' }
  const Icon = cfg.icon
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl transition-all"
      style={{ backgroundColor: isFirst ? 'hsl(var(--primary) / 0.04)' : 'transparent', border: isFirst ? '1px solid hsl(var(--primary) / 0.08)' : '1px solid transparent' }}
    >
      <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ backgroundColor: `color-mix(in srgb, ${cfg.color} 8%, transparent)` }}>
        <Icon size={13} style={{ color: cfg.color }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium leading-snug" style={{ color: 'hsl(var(--foreground))' }}>{event.title}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {event.projects && (
            <Link href={`/admin/projects/${event.projects.id}`}
              className="text-[10px] transition-colors" style={{ color: 'hsl(var(--muted-foreground))' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'hsl(var(--primary))' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'hsl(var(--muted-foreground))' }}
            >
              {event.projects.title}
            </Link>
          )}
          {event.projects && <span style={{ color: 'hsl(var(--border))' }}>·</span>}
          <span className="text-[10px]" style={{ color: 'hsl(var(--text-faint))' }}>{timeAgo(event.created_at)}</span>
        </div>
      </div>
    </div>
  )
}
