'use client'

import {
  useState,
  useEffect,
  useOptimistic,

} from 'react'
import { createClient } from '@/lib/supabase/client'
import { logActivity } from '@/lib/logActivity'
import {
  CheckCircle2,
  Circle,
  Clock,
  AlertTriangle,
  Ban,
  Loader2,
  Plus,
  ChevronDown,
  ChevronUp,
  Calendar,
  Flag,
  Tag,
  GripVertical,
} from 'lucide-react'

export type Task = {
  id: string
  project_id: string
  title: string
  description: string | null
  status: string
  priority: string
  category: string
  due_date: string | null
  completed_at: string | null
  sort_order: number
  visible_to_client: boolean
  created_at: string
}

const STATUS_CONFIG: Record<string, {
  label: string
  color: string
  bg: string
  icon: any
  next: string
}> = {
  pending: {
    label: 'Pending',
    color: 'hsl(var(--muted-foreground))',
    bg: 'hsl(var(--status-gray) / 0.1)',
    icon: Circle,
    next: 'in_progress',
  },
  in_progress: {
    label: 'In Progress',
    color: 'hsl(var(--status-blue))',
    bg: 'hsl(var(--status-blue) / 0.1)',
    icon: Clock,
    next: 'review',
  },
  review: {
    label: 'In Review',
    color: 'hsl(var(--primary))',
    bg: 'hsl(var(--primary) / 0.1)',
    icon: AlertTriangle,
    next: 'completed',
  },
  completed: {
    label: 'Completed',
    color: 'hsl(var(--status-green))',
    bg: 'hsl(var(--status-green) / 0.1)',
    icon: CheckCircle2,
    next: 'pending',
  },
  blocked: {
    label: 'Blocked',
    color: 'hsl(var(--destructive))',
    bg: 'hsl(var(--destructive) / 0.1)',
    icon: Ban,
    next: 'pending',
  },
}

const PRIORITY_CONFIG: Record<string, {
  label: string
  color: string
  dot: string
}> = {
  low: {
    label: 'Low',
    color: 'hsl(var(--text-faint))',
    dot: 'hsl(var(--text-faint))',
  },
  medium: {
    label: 'Medium',
    color: 'hsl(var(--muted-foreground))',
    dot: 'hsl(var(--muted-foreground))',
  },
  high: {
    label: 'High',
    color: 'hsl(var(--primary))',
    dot: 'hsl(var(--primary))',
  },
  urgent: {
    label: 'Urgent',
    color: 'hsl(var(--destructive))',
    dot: 'hsl(var(--destructive))',
  },
}

const CATEGORY_LABELS: Record<string, string> = {
  deliverable: 'Deliverable',
  milestone: 'Milestone',
  revision: 'Revision',
  approval: 'Approval',
  internal: 'Internal',
}

function isOverdue(
  dueDate: string | null,
  status: string
): boolean {
  if (!dueDate || status === 'completed') return false
  return new Date(dueDate) < new Date()
}

function formatDueDate(dateStr: string): string {
  const date = new Date(dateStr)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  if (
    date.toDateString() === today.toDateString()
  ) return 'Today'
  if (
    date.toDateString() === tomorrow.toDateString()
  ) return 'Tomorrow'

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

type Props = {
  projectId: string
  initialTasks: Task[]
  userRole: 'admin' | 'client'
  onProgressUpdate?: (pct: number) => void
}

export default function TaskBoard({
  projectId,
  initialTasks,
  userRole,
  onProgressUpdate,
}: Props) {
  const supabase = createClient()
  const [tasks, setTasks] = useState(initialTasks)

  const [updating, setUpdating] =
    useState<string | null>(null)
  const [showAddForm, setShowAddForm] =
    useState(false)
  const [filter, setFilter] =
    useState<string>('all')
  const [expandedId, setExpandedId] =
    useState<string | null>(null)
  const [newTask, setNewTask] = useState({
    title: '',
    priority: 'medium',
    category: 'deliverable',
    due_date: '',
    description: '',
    visible_to_client: true,
  })
  const [addingTask, setAddingTask] =
    useState(false)

  // Compute completion %
  const visibleTasks = tasks.filter(
    (t) => t.visible_to_client
  )
  const completedCount = visibleTasks.filter(
    (t) => t.status === 'completed'
  ).length
  const completionPct =
    visibleTasks.length === 0
      ? 0
      : Math.round(
          (completedCount / visibleTasks.length) * 100
        )

  // Notify parent of progress change
  useEffect(() => {
    onProgressUpdate?.(completionPct)
  }, [completionPct])

  // Realtime tasks subscription
  useEffect(() => {
    const channel = supabase
      .channel(`tasks:${projectId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'tasks',
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          const t = payload.new as Task
          setTasks((prev) => {
            if (prev.some((x) => x.id === t.id))
              return prev
            return [...prev, t].sort(
              (a, b) => a.sort_order - b.sort_order
            )
          })
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tasks',
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          const updated = payload.new as Task
          setTasks((prev) =>
            prev.map((t) =>
              t.id === updated.id ? updated : t
            )
          )
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'tasks',
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          setTasks((prev) =>
            prev.filter(
              (t) => t.id !== payload.old.id
            )
          )
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [projectId])

  // Cycle task status (admin only)
  async function cycleStatus(task: Task) {
    if (userRole !== 'admin') return

    const nextStatus =
      STATUS_CONFIG[task.status]?.next ?? 'pending'
    const isCompleting = nextStatus === 'completed'

    setUpdating(task.id)

    // Optimistic update
    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id
          ? {
              ...t,
              status: nextStatus,
              completed_at: isCompleting
                ? new Date().toISOString()
                : null,
            }
          : t
      )
    )

    const { error } = await supabase
      .from('tasks')
      .update({
        status: nextStatus,
        completed_at: isCompleting
          ? new Date().toISOString()
          : null,
      })
      .eq('id', task.id)

    if (error) {
      // Rollback
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id ? task : t
        )
      )
    } else if (isCompleting) {
      // Log task completed — fire-and-forget
      // actorId unknown client-side; use project owner placeholder
      logActivity({
        projectId: task.project_id,
        actorId: 'admin',
        actorName: 'Admin',
        actorRole: 'admin',
        eventType: 'task_completed',
        title: `Task completed: “${task.title}”`,
        meta: { task_id: task.id },
      }).catch(() => {})
    }

    setUpdating(null)
  }

  // Delete task (admin only)
  async function deleteTask(taskId: string) {
    if (!confirm('Delete this task?')) return

    setTasks((prev) =>
      prev.filter((t) => t.id !== taskId)
    )

    await supabase
      .from('tasks')
      .delete()
      .eq('id', taskId)
  }

  // Add new task (admin only)
  async function handleAddTask(
    e: React.FormEvent
  ) {
    e.preventDefault()
    if (!newTask.title.trim()) return

    setAddingTask(true)

    const { data, error } = await supabase
      .from('tasks')
      .insert({
        project_id: projectId,
        title: newTask.title.trim(),
        description:
          newTask.description.trim() || null,
        priority: newTask.priority,
        category: newTask.category,
        due_date: newTask.due_date || null,
        visible_to_client:
          newTask.visible_to_client,
        sort_order: tasks.length,
      })
      .select()
      .single()

    if (!error && data) {
      setTasks((prev) => [...prev, data])

      // Log task created — fire-and-forget
      logActivity({
        projectId,
        actorId: 'admin',
        actorName: 'Admin',
        actorRole: 'admin',
        eventType: 'task_created',
        title: `Task created: “${data.title}”`,
        meta: { task_id: data.id },
      }).catch(() => {})
    }

    setNewTask({
      title: '',
      priority: 'medium',
      category: 'deliverable',
      due_date: '',
      description: '',
      visible_to_client: true,
    })
    setShowAddForm(false)
    setAddingTask(false)
  }

  // Filtered tasks
  const filteredTasks = tasks.filter((t) => {
    if (userRole === 'client' &&
      !t.visible_to_client) return false
    if (filter === 'all') return true
    if (filter === 'active')
      return !['completed', 'pending'].includes(
        t.status
      )
    if (filter === 'completed')
      return t.status === 'completed'
    if (filter === 'overdue')
      return isOverdue(t.due_date, t.status)
    return t.status === filter
  })

  const groupedTasks = {
    active: filteredTasks.filter(
      (t) => !['completed'].includes(t.status)
    ),
    completed: filteredTasks.filter(
      (t) => t.status === 'completed'
    ),
  }

  const overdueCount = tasks.filter(
    (t) => isOverdue(t.due_date, t.status) &&
      (userRole === 'admin' || t.visible_to_client)
  ).length

  return (
    <div className="space-y-4">

      {/* Progress bar */}
      <div
        className="p-5 rounded-2xl"
        style={{
          backgroundColor: 'hsl(var(--card))',
          border: '1px solid hsl(var(--border))',
        }}
      >
        <div className="flex items-center
          justify-between mb-3">
          <div>
            <p
              className="text-sm font-semibold"
              style={{ color: 'hsl(var(--foreground))' }}
            >
              Project Progress
            </p>
            <p className="text-xs mt-0.5"
              style={{ color: 'hsl(var(--muted-foreground))' }}>
              {completedCount} of{' '}
              {visibleTasks.length} tasks complete
            </p>
          </div>
          <span
            className="font-display text-3xl
            font-bold tabular-nums"
            style={{
              color: completionPct === 100
                ? 'hsl(var(--status-green))'
                : 'hsl(var(--primary))',
            }}
          >
            {completionPct}%
          </span>
        </div>

        {/* Progress bar track */}
        <div
          className="h-2 rounded-full overflow-hidden"
          style={{ backgroundColor: 'hsl(var(--secondary))' }}
        >
          <div
            className="h-full rounded-full
            transition-all duration-700"
            style={{
              width: `${completionPct}%`,
              backgroundColor:
                completionPct === 100
                  ? 'hsl(var(--status-green))'
                  : 'hsl(var(--primary))',
            }}
          />
        </div>

        {/* Status breakdown */}
        <div className="flex items-center
          gap-4 mt-3 flex-wrap">
          {Object.entries(
            tasks.reduce(
              (acc, t) => {
                if (
                  userRole === 'client' &&
                  !t.visible_to_client
                ) return acc
                acc[t.status] =
                  (acc[t.status] ?? 0) + 1
                return acc
              },
              {} as Record<string, number>
            )
          ).map(([status, count]) => {
            const cfg = STATUS_CONFIG[status]
            if (!cfg) return null
            return (
              <div
                key={status}
                className="flex items-center gap-1.5"
              >
                <div
                  className="w-2 h-2 rounded-full"
                  style={{
                    backgroundColor: cfg.color,
                  }}
                />
                <span className="text-xs"
                  style={{ color: 'hsl(var(--muted-foreground))' }}>
                  {count} {cfg.label}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Filter + Add row */}
      <div className="flex items-center
        justify-between gap-3 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {[
            { key: 'all', label: 'All' },
            {
              key: 'active',
              label: 'Active',
            },
            {
              key: 'completed',
              label: 'Done',
            },
            ...(overdueCount > 0
              ? [{
                  key: 'overdue',
                  label: `Overdue ${overdueCount}`,
                }]
              : []),
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className="px-3 py-1.5 rounded-full
              text-xs font-medium transition-all"
              style={{
                backgroundColor:
                  filter === key
                    ? key === 'overdue'
                      ? 'hsl(var(--destructive))'
                      : 'hsl(var(--primary))'
                    : 'hsl(var(--secondary))',
                color:
                  filter === key
                    ? 'hsl(var(--primary-foreground))'
                    : 'hsl(var(--muted-foreground))',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {userRole === 'admin' && (
          <button
            onClick={() =>
              setShowAddForm(!showAddForm)
            }
            className="flex items-center gap-1.5
            px-3 py-1.5 rounded-lg text-xs
            font-semibold transition-all"
            style={{
              backgroundColor: showAddForm
                ? 'hsl(var(--secondary))'
                : 'hsl(var(--primary))',
              color: showAddForm
                ? 'hsl(var(--muted-foreground))'
                : 'hsl(var(--primary-foreground))',
            }}
          >
            <Plus size={12} />
            Add Task
          </button>
        )}
      </div>

      {/* Add task form (admin only) */}
      {showAddForm && userRole === 'admin' && (
        <form
          onSubmit={handleAddTask}
          className="p-5 rounded-xl space-y-3"
          style={{
            backgroundColor: 'hsl(var(--card))',
            border: '1px solid hsl(var(--primary) / 0.2)',
          }}
        >
          <p
            className="text-xs font-semibold
            uppercase tracking-wider"
            style={{ color: 'hsl(var(--primary))' }}
          >
            New Task
          </p>

          <input
            type="text"
            required
            autoFocus
            value={newTask.title}
            onChange={(e) =>
              setNewTask((p) => ({
                ...p,
                title: e.target.value,
              }))
            }
            placeholder="Task title..."
            className="w-full px-4 py-3 rounded-lg
            text-sm outline-none transition-all"
            style={{
              backgroundColor: 'hsl(var(--primary-foreground))',
              border: '1px solid hsl(var(--border))',
              color: 'hsl(var(--foreground))',
            }}
            onFocus={(e) => {
              e.target.style.borderColor = 'hsl(var(--primary))'
            }}
            onBlur={(e) => {
              e.target.style.borderColor = 'hsl(var(--border))'
            }}
          />

          <textarea
            value={newTask.description}
            onChange={(e) =>
              setNewTask((p) => ({
                ...p,
                description: e.target.value,
              }))
            }
            placeholder="Description (optional)..."
            rows={2}
            className="w-full px-4 py-3 rounded-lg
            text-sm outline-none transition-all
            resize-none"
            style={{
              backgroundColor: 'hsl(var(--primary-foreground))',
              border: '1px solid hsl(var(--border))',
              color: 'hsl(var(--foreground))',
            }}
            onFocus={(e) => {
              e.target.style.borderColor = 'hsl(var(--primary))'
            }}
            onBlur={(e) => {
              e.target.style.borderColor = 'hsl(var(--border))'
            }}
          />

          <div className="grid grid-cols-2
            sm:grid-cols-4 gap-2">
            {/* Priority */}
            <select
              value={newTask.priority}
              onChange={(e) =>
                setNewTask((p) => ({
                  ...p,
                  priority: e.target.value,
                }))
              }
              className="px-3 py-2.5 rounded-lg
              text-xs outline-none transition-all"
              style={{
                backgroundColor: 'hsl(var(--primary-foreground))',
                border: '1px solid hsl(var(--border))',
                color: 'hsl(var(--foreground))',
              }}
            >
              {Object.entries(PRIORITY_CONFIG)
                .map(([k, v]) => (
                  <option
                    key={k}
                    value={k}
                    style={{
                      backgroundColor: 'hsl(var(--card))',
                    }}
                  >
                    {v.label} Priority
                  </option>
                ))}
            </select>

            {/* Category */}
            <select
              value={newTask.category}
              onChange={(e) =>
                setNewTask((p) => ({
                  ...p,
                  category: e.target.value,
                }))
              }
              className="px-3 py-2.5 rounded-lg
              text-xs outline-none transition-all"
              style={{
                backgroundColor: 'hsl(var(--primary-foreground))',
                border: '1px solid hsl(var(--border))',
                color: 'hsl(var(--foreground))',
              }}
            >
              {Object.entries(CATEGORY_LABELS)
                .map(([k, v]) => (
                  <option
                    key={k}
                    value={k}
                    style={{
                      backgroundColor: 'hsl(var(--card))',
                    }}
                  >
                    {v}
                  </option>
                ))}
            </select>

            {/* Due date */}
            <input
              type="date"
              value={newTask.due_date}
              onChange={(e) =>
                setNewTask((p) => ({
                  ...p,
                  due_date: e.target.value,
                }))
              }
              className="px-3 py-2.5 rounded-lg
              text-xs outline-none transition-all"
              style={{
                backgroundColor: 'hsl(var(--primary-foreground))',
                border: '1px solid hsl(var(--border))',
                color: 'hsl(var(--foreground))',
                colorScheme: 'dark',
              }}
            />

            {/* Client visibility */}
            <button
              type="button"
              onClick={() =>
                setNewTask((p) => ({
                  ...p,
                  visible_to_client:
                    !p.visible_to_client,
                }))
              }
              className="px-3 py-2.5 rounded-lg
              text-xs font-medium transition-all"
              style={{
                backgroundColor:
                  newTask.visible_to_client
                    ? 'hsl(var(--primary) / 0.1)'
                    : 'hsl(var(--primary-foreground))',
                color: newTask.visible_to_client
                  ? 'hsl(var(--primary))'
                  : 'hsl(var(--text-faint))',
                border: newTask.visible_to_client
                  ? '1px solid hsl(var(--primary) / 0.2)'
                  : '1px solid hsl(var(--border))',
              }}
            >
              {newTask.visible_to_client
                ? '👁 Visible to client'
                : '🔒 Internal only'}
            </button>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-4 py-2 rounded-lg
              text-sm transition-all"
              style={{
                backgroundColor: 'hsl(var(--secondary))',
                color: 'hsl(var(--muted-foreground))',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={addingTask}
              className="flex-1 flex items-center
              justify-center gap-2 py-2 rounded-lg
              text-sm font-semibold transition-all
              disabled:opacity-60"
              style={{
                backgroundColor: 'hsl(var(--primary))',
                color: 'hsl(var(--primary-foreground))',
              }}
            >
              {addingTask ? (
                <Loader2 size={13}
                  className="animate-spin" />
              ) : (
                <Plus size={13} />
              )}
              {addingTask
                ? 'Adding...'
                : 'Add Task'}
            </button>
          </div>
        </form>
      )}

      {/* Empty state */}
      {filteredTasks.length === 0 && (
        <div
          className="flex flex-col items-center
          justify-center py-14 rounded-xl"
          style={{
            backgroundColor: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
          }}
        >
          <CheckCircle2 size={28}
            style={{ color: 'hsl(var(--text-faint))' }} />
          <p className="text-sm mt-3"
            style={{ color: 'hsl(var(--muted-foreground))' }}>
            {filter === 'completed'
              ? 'No completed tasks yet'
              : filter === 'overdue'
              ? 'No overdue tasks'
              : 'No tasks yet — add your first'}
          </p>
        </div>
      )}

      {/* Active tasks */}
      {groupedTasks.active.length > 0 && (
        <div className="space-y-2">
          {groupedTasks.active.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              userRole={userRole}
              isUpdating={updating === task.id}
              isExpanded={expandedId === task.id}
              onToggleExpand={() =>
                setExpandedId(
                  expandedId === task.id
                    ? null
                    : task.id
                )
              }
              onCycleStatus={() =>
                cycleStatus(task)
              }
              onDelete={() => deleteTask(task.id)}
            />
          ))}
        </div>
      )}

      {/* Completed tasks — collapsible */}
      {groupedTasks.completed.length > 0 && (
        <CompletedGroup
          tasks={groupedTasks.completed}
          userRole={userRole}
          updating={updating}
          expandedId={expandedId}
          setExpandedId={setExpandedId}
          onCycleStatus={cycleStatus}
          onDelete={deleteTask}
        />
      )}
    </div>
  )
}

// ── TaskRow ────────────────────────────────────

function TaskRow({
  task,
  userRole,
  isUpdating,
  isExpanded,
  onToggleExpand,
  onCycleStatus,
  onDelete,
}: {
  task: Task
  userRole: 'admin' | 'client'
  isUpdating: boolean
  isExpanded: boolean
  onToggleExpand: () => void
  onCycleStatus: () => void
  onDelete: () => void
}) {
  const cfg =
    STATUS_CONFIG[task.status] ??
    STATUS_CONFIG.pending
  const priorityCfg =
    PRIORITY_CONFIG[task.priority] ??
    PRIORITY_CONFIG.medium
  const overdue = isOverdue(
    task.due_date,
    task.status
  )
  const StatusIcon = cfg.icon

  return (
    <div
      className="rounded-xl overflow-hidden
      transition-all"
      style={{
        backgroundColor: 'hsl(var(--card))',
        border: overdue
          ? '1px solid hsl(var(--destructive) / 0.2)'
          : task.status === 'completed'
          ? '1px solid hsl(var(--status-green) / 0.15)'
          : '1px solid hsl(var(--border))',
      }}
    >
      <div className="flex items-center gap-3 p-4">

        {/* Status toggle button */}
        <button
          onClick={onCycleStatus}
          disabled={
            isUpdating || userRole === 'client'
          }
          className="flex-shrink-0 transition-all
          disabled:cursor-default"
          title={
            userRole === 'admin'
              ? `Mark as ${cfg.next}`
              : cfg.label
          }
        >
          {isUpdating ? (
            <Loader2
              size={20}
              className="animate-spin"
              style={{ color: 'hsl(var(--primary))' }}
            />
          ) : (
            <StatusIcon
              size={20}
              style={{
                color: cfg.color,
                opacity:
                  userRole === 'admin' ? 1 : 0.7,
              }}
            />
          )}
        </button>

        {/* Task content */}
        <div
          className="flex-1 min-w-0 cursor-pointer"
          onClick={onToggleExpand}
        >
          <div className="flex items-center
            gap-2 flex-wrap">
            <p
              className="text-sm font-medium"
              style={{
                color:
                  task.status === 'completed'
                    ? 'hsl(var(--text-faint))'
                    : 'hsl(var(--foreground))',
                textDecoration:
                  task.status === 'completed'
                    ? 'line-through'
                    : 'none',
              }}
            >
              {task.title}
            </p>

            {/* Category badge */}
            <span
              className="text-[10px] font-semibold
              px-1.5 py-0.5 rounded"
              style={{
                backgroundColor: 'hsl(var(--secondary))',
                color: 'hsl(var(--muted-foreground))',
              }}
            >
              {CATEGORY_LABELS[task.category]}
            </span>

            {/* Priority dot */}
            {task.priority !== 'medium' && (
              <div
                className="flex items-center
                gap-1"
              >
                <div
                  className="w-1.5 h-1.5
                  rounded-full"
                  style={{
                    backgroundColor:
                      priorityCfg.dot,
                  }}
                />
                <span
                  className="text-[10px]"
                  style={{
                    color: priorityCfg.color,
                  }}
                >
                  {priorityCfg.label}
                </span>
              </div>
            )}

            {/* Internal badge */}
            {!task.visible_to_client && (
              <span
                className="text-[10px] px-1.5
                py-0.5 rounded font-medium"
                style={{
                  backgroundColor:
                    'hsl(var(--muted) / 0.3)',
                  color: 'hsl(var(--text-faint))',
                }}
              >
                Internal
              </span>
            )}
          </div>

          {/* Due date */}
          {task.due_date && (
            <div className="flex items-center
              gap-1 mt-1.5">
              <Calendar size={11}
                style={{
                  color: overdue
                    ? 'hsl(var(--destructive))'
                    : 'hsl(var(--text-faint))',
                }}
              />
              <span
                className="text-xs"
                style={{
                  color: overdue
                    ? 'hsl(var(--destructive))'
                    : 'hsl(var(--text-faint))',
                }}
              >
                {overdue ? 'Overdue · ' : ''}
                {formatDueDate(task.due_date)}
              </span>
            </div>
          )}
        </div>

        {/* Status chip */}
        <div
          className="hidden sm:flex items-center
          gap-1.5 px-2.5 py-1 rounded-full
          flex-shrink-0"
          style={{
            backgroundColor: cfg.bg,
          }}
        >
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{
              backgroundColor: cfg.color,
            }}
          />
          <span
            className="text-[10px] font-semibold"
            style={{ color: cfg.color }}
          >
            {cfg.label}
          </span>
        </div>

        {/* Expand / admin actions */}
        <div className="flex items-center
          gap-1 flex-shrink-0">
          {(task.description ||
            userRole === 'admin') && (
            <button
              onClick={onToggleExpand}
              className="p-1.5 rounded-lg
              transition-all"
              style={{ color: 'hsl(var(--text-faint))' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color
                  = 'hsl(var(--foreground))'
                e.currentTarget.style.backgroundColor
                  = 'hsl(var(--secondary))'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color
                  = 'hsl(var(--text-faint))'
                e.currentTarget.style.backgroundColor
                  = 'transparent'
              }}
            >
              {isExpanded ? (
                <ChevronUp size={14} />
              ) : (
                <ChevronDown size={14} />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {isExpanded && (
        <div
          className="px-4 pb-4 space-y-3"
          style={{
            borderTop: '1px solid hsl(var(--secondary))',
          }}
        >
          {task.description && (
            <p
              className="text-sm leading-relaxed
              pt-3"
              style={{ color: 'hsl(var(--muted-foreground))' }}
            >
              {task.description}
            </p>
          )}

          {task.completed_at && (
            <p className="text-xs"
              style={{ color: 'hsl(var(--status-green))' }}>
              ✓ Completed{' '}
              {new Date(
                task.completed_at
              ).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          )}

          {/* Admin actions */}
          {userRole === 'admin' && (
            <div className="flex items-center
              gap-2 pt-1">
              <span className="text-xs
                flex-1"
                style={{ color: 'hsl(var(--text-faint))' }}>
                Click the status icon to advance
              </span>
              <button
                onClick={onDelete}
                className="text-xs px-3 py-1.5
                rounded-lg transition-all"
                style={{ color: 'hsl(var(--destructive))' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor
                    = 'hsl(var(--destructive) / 0.1)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor
                    = 'transparent'
                }}
              >
                Delete task
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── CompletedGroup ─────────────────────────────

function CompletedGroup({
  tasks,
  userRole,
  updating,
  expandedId,
  setExpandedId,
  onCycleStatus,
  onDelete,
}: {
  tasks: Task[]
  userRole: 'admin' | 'client'
  updating: string | null
  expandedId: string | null
  setExpandedId: (id: string | null) => void
  onCycleStatus: (task: Task) => void
  onDelete: (id: string) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2
        text-sm transition-colors w-full
        py-2"
        style={{ color: 'hsl(var(--text-faint))' }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'hsl(var(--muted-foreground))'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'hsl(var(--text-faint))'
        }}
      >
        <div
          className="flex-1 h-px"
          style={{ backgroundColor: 'hsl(var(--secondary))' }}
        />
        <span className="flex-shrink-0
          flex items-center gap-1.5">
          {open ? (
            <ChevronUp size={13} />
          ) : (
            <ChevronDown size={13} />
          )}
          {tasks.length} completed
        </span>
        <div
          className="flex-1 h-px"
          style={{ backgroundColor: 'hsl(var(--secondary))' }}
        />
      </button>

      {open && (
        <div className="space-y-2 mt-2">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              userRole={userRole}
              isUpdating={updating === task.id}
              isExpanded={expandedId === task.id}
              onToggleExpand={() =>
                setExpandedId(
                  expandedId === task.id
                    ? null
                    : task.id
                )
              }
              onCycleStatus={() =>
                onCycleStatus(task)
              }
              onDelete={() => onDelete(task.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
