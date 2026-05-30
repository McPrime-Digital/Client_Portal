'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import StatusBadge from '@/components/portal/StatusBadge'
import {
  Plus,
  Search,
  FolderOpen,
  ChevronRight,
  Files,
  CheckSquare,
  MessageSquare,
  Clock,
} from 'lucide-react'

const ALL_STATUSES = [
  'All',
  'Onboarding',
  'Pre-Production',
  'In Production',
  'Post-Production',
  'In Review',
  'Revisions',
  'Completed',
  'On Hold',
]

type Project = {
  id: string
  title: string
  status: string
  type: string
  progress: number
  due_date: string | null
  kickoff_date: string | null
  updated_at: string
  clients: {
    id: string
    name: string
    company: string | null
  } | null
  tasks: { id: string; status: string }[]
  files: { id: string }[]
  messages: {
    id: string
    sender_role: string
    read_at: string | null
  }[]
}

export default function AdminProjectsList({
  projects,
}: {
  projects: Project[]
}) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [view, setView] = useState<'grid' | 'list'>('list')

  const filtered = useMemo(() => {
    return projects.filter((p) => {
      const matchSearch =
        search.trim() === '' ||
        p.title
          .toLowerCase()
          .includes(search.toLowerCase()) ||
        p.clients?.name
          .toLowerCase()
          .includes(search.toLowerCase()) ||
        p.type
          .toLowerCase()
          .includes(search.toLowerCase())

      const matchStatus =
        statusFilter === 'All' ||
        p.status === statusFilter

      return matchSearch && matchStatus
    })
  }, [projects, search, statusFilter])

  const statusCounts = useMemo(() => {
    return ALL_STATUSES.reduce(
      (acc, s) => {
        acc[s] =
          s === 'All'
            ? projects.length
            : projects.filter((p) => p.status === s)
                .length
        return acc
      },
      {} as Record<string, number>
    )
  }, [projects])

  function getUnreadCount(project: Project) {
    return project.messages.filter(
      (m) => m.sender_role === 'client' && !m.read_at
    ).length
  }

  function getTaskProgress(project: Project) {
    if (project.tasks.length === 0) return null
    const done = project.tasks.filter(
      (t) => t.status === 'complete'
    ).length
    return { done, total: project.tasks.length }
  }

  return (
    <div className="space-y-6 w-full">

      {/* Header */}
      <div className="flex items-center 
        justify-between gap-4 flex-wrap">
        <div>
          <h1
            className="font-display text-2xl font-bold"
            style={{ color: 'hsl(var(--foreground))' }}
          >
            Projects
          </h1>
          <p className="text-sm mt-1"
            style={{ color: 'hsl(var(--muted-foreground))' }}>
            {projects.length} total ·{' '}
            {
              projects.filter(
                (p) =>
                  !['Completed', 'On Hold'].includes(
                    p.status
                  )
              ).length
            }{' '}
            active
          </p>
        </div>
        <Link
          href="/admin/projects/new"
          className="flex items-center gap-2 px-4 py-2.5 
          rounded-lg text-sm font-semibold transition-all"
          style={{
            backgroundColor: 'hsl(var(--primary))',
            color: 'hsl(var(--primary-foreground))',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'hsl(var(--primary))'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'hsl(var(--primary))'
          }}
        >
          <Plus size={14} />
          New Project
        </Link>
      </div>

      {/* Search + filters */}
      <div className="space-y-3">
        {/* Search */}
        <div className="relative">
          <Search
            size={15}
            className="absolute left-4 top-1/2 
            -translate-y-1/2"
            style={{ color: 'hsl(var(--text-faint))' }}
          />
          <input
            type="text"
            placeholder="Search projects or clients..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 rounded-xl 
            text-sm outline-none transition-all"
            style={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              color: 'hsl(var(--foreground))',
            }}
            onFocus={(e) => {
              e.target.style.borderColor = 'hsl(var(--primary))'
              e.target.style.boxShadow =
                '0 0 0 3px hsl(var(--primary) / 0.08)'
            }}
            onBlur={(e) => {
              e.target.style.borderColor = 'hsl(var(--border))'
              e.target.style.boxShadow = 'none'
            }}
          />
        </div>

        {/* Status pills */}
        <div className="flex gap-2 flex-wrap">
          {ALL_STATUSES.filter(
            (s) => statusCounts[s] > 0 || s === 'All'
          ).map((status) => {
            const isActive = statusFilter === status
            return (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className="flex items-center gap-1.5 
                px-3 py-1.5 rounded-full text-xs font-medium 
                transition-all whitespace-nowrap"
                style={{
                  backgroundColor: isActive
                    ? 'hsl(var(--primary))'
                    : 'hsl(var(--card))',
                  color: isActive ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))',
                  border: isActive
                    ? 'none'
                    : '1px solid hsl(var(--border))',
                }}
              >
                {status}
                <span
                  className="font-bold"
                  style={{
                    color: isActive
                      ? 'hsl(var(--primary-foreground))'
                      : 'hsl(var(--text-faint))',
                  }}
                >
                  {statusCounts[status]}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div
          className="flex flex-col items-center 
          justify-center py-20 rounded-xl"
          style={{
            backgroundColor: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
          }}
        >
          <FolderOpen size={36}
            style={{ color: 'hsl(var(--text-faint))' }} />
          <p className="text-sm mt-4"
            style={{ color: 'hsl(var(--muted-foreground))' }}>
            {search || statusFilter !== 'All'
              ? 'No projects match your filters'
              : 'No projects yet'}
          </p>
          {!search && statusFilter === 'All' && (
            <Link
              href="/admin/projects/new"
              className="flex items-center gap-2 mt-5 
              px-4 py-2 rounded-lg text-sm font-semibold"
              style={{
                backgroundColor: 'hsl(var(--primary))',
                color: 'hsl(var(--primary-foreground))',
              }}
            >
              <Plus size={13} />
              Create First Project
            </Link>
          )}
        </div>
      )}

      {/* Projects list */}
      {filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((project) => {
            const unread = getUnreadCount(project)
            const taskProgress = getTaskProgress(project)

            return (
              <Link
                key={project.id}
                href={`/admin/projects/${project.id}`}
                className="card-interactive flex items-center gap-5 p-4
                rounded-xl block group"
                style={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor =
                    'hsl(var(--border))'
                  e.currentTarget.style.backgroundColor =
                    'hsl(var(--secondary))'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor =
                    'hsl(var(--border))'
                  e.currentTarget.style.backgroundColor =
                    'hsl(var(--card))'
                }}
              >
                {/* Progress ring */}
                <div className="relative w-12 h-12 
                  flex-shrink-0">
                  <svg
                    width="48"
                    height="48"
                    viewBox="0 0 48 48"
                    className="rotate-[-90deg]"
                  >
                    <circle
                      cx="24"
                      cy="24"
                      r="20"
                      fill="none"
                      stroke="hsl(var(--secondary))"
                      strokeWidth="3.5"
                    />
                    <circle
                      cx="24"
                      cy="24"
                      r="20"
                      fill="none"
                      stroke={
                        project.status === 'Completed'
                          ? 'hsl(var(--status-green))'
                          : 'hsl(var(--primary))'
                      }
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      strokeDasharray={`${
                        2 * Math.PI * 20
                      }`}
                      strokeDashoffset={`${
                        2 *
                        Math.PI *
                        20 *
                        (1 - project.progress / 100)
                      }`}
                    />
                  </svg>
                  <span
                    className="absolute inset-0 flex 
                    items-center justify-center text-[10px] 
                    font-bold tabular-nums"
                    style={{
                      color:
                        project.status === 'Completed'
                          ? 'hsl(var(--status-green))'
                          : 'hsl(var(--primary))',
                    }}
                  >
                    {project.progress}%
                  </span>
                </div>

                {/* Main content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center 
                    gap-3 flex-wrap">
                    <p
                      className="text-sm font-semibold"
                      style={{ color: 'hsl(var(--foreground))' }}
                    >
                      {project.title}
                    </p>
                    <StatusBadge
                      status={project.status}
                      size="xs"
                    />
                    {unread > 0 && (
                      <span
                        className="text-[10px] font-bold 
                        px-1.5 py-0.5 rounded-full"
                        style={{
                          backgroundColor:
                            'hsl(var(--destructive) / 0.15)',
                          color: 'hsl(var(--destructive))',
                        }}
                      >
                        {unread} unread
                      </span>
                    )}
                  </div>

                  <div className="flex items-center 
                    gap-4 mt-1.5 flex-wrap">
                    <p className="text-xs"
                      style={{ color: 'hsl(var(--muted-foreground))' }}>
                      {project.clients?.name}
                      {project.clients?.company
                        ? ` · ${project.clients.company}`
                        : ''}
                    </p>
                    <span className="text-xs"
                      style={{ color: 'hsl(var(--text-faint))' }}>
                      {project.type}
                    </span>
                  </div>

                  {/* Meta row */}
                  <div className="flex items-center 
                    gap-4 mt-2">
                    {/* Files */}
                    <div className="flex items-center gap-1">
                      <Files size={11}
                        style={{ color: 'hsl(var(--text-faint))' }} />
                      <span className="text-[10px]"
                        style={{ color: 'hsl(var(--text-faint))' }}>
                        {project.files.length}
                      </span>
                    </div>

                    {/* Tasks */}
                    {taskProgress && (
                      <div className="flex items-center 
                        gap-1">
                        <CheckSquare size={11}
                          style={{ color: 'hsl(var(--text-faint))' }} />
                        <span className="text-[10px]"
                          style={{ color: 'hsl(var(--text-faint))' }}>
                          {taskProgress.done}/
                          {taskProgress.total}
                        </span>
                      </div>
                    )}

                    {/* Messages */}
                    <div className="flex items-center 
                      gap-1">
                      <MessageSquare size={11}
                        style={{ color: 'hsl(var(--text-faint))' }} />
                      <span className="text-[10px]"
                        style={{ color: 'hsl(var(--text-faint))' }}>
                        {project.messages.length}
                      </span>
                    </div>

                    {/* Due date */}
                    {project.due_date && (
                      <div className="flex items-center 
                        gap-1">
                        <Clock size={11}
                          style={{ color: 'hsl(var(--text-faint))' }} />
                        <span className="text-[10px]"
                          style={{ color: 'hsl(var(--text-faint))' }}>
                          {new Date(
                            project.due_date
                          ).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Arrow */}
                <ChevronRight
                  size={16}
                  style={{ color: 'hsl(var(--text-faint))' }}
                  className="flex-shrink-0 transition-transform 
                  group-hover:translate-x-0.5"
                />
              </Link>
            )
          })}
        </div>
      )}

      {/* Count */}
      {filtered.length > 0 && (
        <p className="text-xs text-center"
          style={{ color: 'hsl(var(--text-faint))' }}>
          Showing {filtered.length} of {projects.length}{' '}
          projects
        </p>
      )}
    </div>
  )
}
