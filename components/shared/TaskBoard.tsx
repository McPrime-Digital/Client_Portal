'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { logActivity } from '@/lib/logActivity'
import { uploadFileToR2 } from '@/lib/uploadClient'
import { phaseColor } from '@/lib/projectProgress'
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
  Paperclip,
  ShieldCheck,
  MessageSquareWarning,
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
  approved_at: string | null
  sort_order: number
  visible_to_client: boolean
  created_at: string
  phase_id: string | null
  requires_approval: boolean
  approval_status: string | null
  approval_note: string | null
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: any; next: string }> = {
  pending: { label: 'Pending', color: 'hsl(var(--muted-foreground))', bg: 'hsl(var(--status-gray) / 0.1)', icon: Circle, next: 'in_progress' },
  in_progress: { label: 'In Progress', color: 'hsl(var(--status-blue))', bg: 'hsl(var(--status-blue) / 0.1)', icon: Clock, next: 'review' },
  review: { label: 'In Review', color: 'hsl(var(--primary))', bg: 'hsl(var(--primary) / 0.1)', icon: AlertTriangle, next: 'completed' },
  completed: { label: 'Completed', color: 'hsl(var(--status-green))', bg: 'hsl(var(--status-green) / 0.1)', icon: CheckCircle2, next: 'pending' },
  blocked: { label: 'Blocked', color: 'hsl(var(--destructive))', bg: 'hsl(var(--destructive) / 0.1)', icon: Ban, next: 'pending' },
}

const PRIORITY_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  low: { label: 'Low', color: 'hsl(var(--text-faint))', dot: 'hsl(var(--text-faint))' },
  medium: { label: 'Medium', color: 'hsl(var(--muted-foreground))', dot: 'hsl(var(--muted-foreground))' },
  high: { label: 'High', color: 'hsl(var(--primary))', dot: 'hsl(var(--primary))' },
  urgent: { label: 'Urgent', color: 'hsl(var(--destructive))', dot: 'hsl(var(--destructive))' },
}

const CATEGORY_LABELS: Record<string, string> = {
  deliverable: 'Deliverable',
  milestone: 'Milestone',
  revision: 'Revision',
  approval: 'Approval',
  task: 'Task',
  internal: 'Internal',
}

function isApprovalGate(t: Task): boolean {
  return t.requires_approval || t.category === 'approval'
}

function isOverdue(dueDate: string | null, status: string): boolean {
  if (!dueDate || status === 'completed') return false
  return new Date(dueDate) < new Date()
}

function formatDueDate(dateStr: string): string {
  const date = new Date(dateStr)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

type Phase = { id: string; name: string }

type Props = {
  projectId: string
  clientId?: string
  initialTasks: Task[]
  phases?: Phase[]
  userRole: 'admin' | 'client'
  onProgressUpdate?: (pct: number) => void
}

export default function TaskBoard({
  projectId,
  clientId,
  initialTasks,
  phases,
  userRole,
  onProgressUpdate,
}: Props) {
  const supabase = createClient()
  const [tasks, setTasks] = useState(initialTasks)
  const [updating, setUpdating] = useState<string | null>(null)
  const [attaching, setAttaching] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [filter, setFilter] = useState<string>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [collapsedPhases, setCollapsedPhases] = useState<Record<string, boolean>>({})
  const [newTask, setNewTask] = useState({
    title: '', priority: 'medium', category: 'deliverable', due_date: '',
    description: '', visible_to_client: true, requires_approval: false, phase_id: '',
  })
  const [addingTask, setAddingTask] = useState(false)

  // Task writes route through the admin server route (service role) so they're
  // RLS-safe and fire notifications. The realtime channel reconciles state.
  async function taskAction(payload: Record<string, unknown>) {
    const res = await fetch('/api/admin/project-actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? 'Action failed')
    return json
  }

  const visibleTasks = tasks.filter((t) => t.visible_to_client)
  const completedCount = visibleTasks.filter((t) => t.status === 'completed').length
  const completionPct = visibleTasks.length === 0 ? 0 : Math.round((completedCount / visibleTasks.length) * 100)

  useEffect(() => {
    onProgressUpdate?.(completionPct)
  }, [completionPct])

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel(`tasks:${projectId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks', filter: `project_id=eq.${projectId}` }, (payload) => {
        const t = payload.new as Task
        setTasks((prev) => (prev.some((x) => x.id === t.id) ? prev : [...prev, t].sort((a, b) => a.sort_order - b.sort_order)))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks', filter: `project_id=eq.${projectId}` }, (payload) => {
        const updated = payload.new as Task
        setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'tasks', filter: `project_id=eq.${projectId}` }, (payload) => {
        setTasks((prev) => prev.filter((t) => t.id !== payload.old.id))
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [projectId])

  async function cycleStatus(task: Task) {
    if (userRole !== 'admin') return
    const nextStatus = STATUS_CONFIG[task.status]?.next ?? 'pending'
    const isCompleting = nextStatus === 'completed'
    setUpdating(task.id)
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: nextStatus, completed_at: isCompleting ? new Date().toISOString() : null } : t)))
    try {
      await taskAction({ action: 'toggle_task', task_id: task.id, status: nextStatus })
      if (isCompleting) {
        logActivity({
          projectId: task.project_id, actorId: 'admin', actorName: 'Admin', actorRole: 'admin',
          eventType: 'task_completed', title: `Task completed: “${task.title}”`, meta: { task_id: task.id },
        }).catch(() => {})
      }
    } catch {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)))
    } finally {
      setUpdating(null)
    }
  }

  // Client approves an approval-gate task → completes it.
  async function approveTask(task: Task) {
    if (userRole !== 'client') return
    setUpdating(task.id)
    const now = new Date().toISOString()
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, approved_at: now, status: 'completed', completed_at: now, approval_status: 'approved' } : t)))
    try {
      const res = await fetch('/api/portal/actions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve_task', task_id: task.id }),
      })
      if (!res.ok) throw new Error('approve failed')
    } catch {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)))
    } finally {
      setUpdating(null)
    }
  }

  // Client requests changes — note is required and auto-posts to chat.
  async function requestChanges(task: Task, note: string) {
    if (userRole !== 'client' || !note.trim()) return
    setUpdating(task.id)
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, approval_status: 'changes_requested', approval_note: note, status: 'in_progress' } : t)))
    try {
      const res = await fetch('/api/portal/actions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request_changes', task_id: task.id, note }),
      })
      if (!res.ok) throw new Error('request failed')
    } catch {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)))
    } finally {
      setUpdating(null)
    }
  }

  // Admin attaches approval media to a task → uploaded to the vault under the
  // Tasks & Approvals folder, named for the task, and linked via task_id.
  async function attachMedia(task: Task, file: File) {
    if (userRole !== 'admin' || !clientId) return
    setAttaching(task.id)
    try {
      const named = new File([file], `${task.title} — client approval request — ${file.name}`, { type: file.type })
      await uploadFileToR2({
        file: named,
        projectId,
        clientId,
        direction: 'delivery',
        folder: 'tasks',
        taskId: task.id,
      })
      // Move the gate into review so the client is prompted to approve.
      if (task.status !== 'review' && task.status !== 'completed') {
        await taskAction({ action: 'toggle_task', task_id: task.id, status: 'review' })
        setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: 'review' } : t)))
      }
    } catch (err) {
      console.error('Attach media failed:', err)
    } finally {
      setAttaching(null)
    }
  }

  async function deleteTask(taskId: string) {
    if (!confirm('Delete this task?')) return
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
    try {
      await taskAction({ action: 'delete_task', task_id: taskId })
    } catch {
      /* realtime reconciles */
    }
  }

  async function handleAddTask(e: React.FormEvent) {
    e.preventDefault()
    if (!newTask.title.trim()) return
    setAddingTask(true)
    try {
      const { task: data } = await taskAction({
        action: 'add_task',
        project_id: projectId,
        title: newTask.title.trim(),
        description: newTask.description.trim() || null,
        priority: newTask.priority,
        category: newTask.requires_approval ? 'approval' : newTask.category,
        due_date: newTask.due_date || null,
        visible_to_client: newTask.visible_to_client,
        requires_approval: newTask.requires_approval,
        phase_id: newTask.phase_id || null,
        sort_order: tasks.length,
      })
      if (data) {
        setTasks((prev) => [...prev, data])
        logActivity({
          projectId, actorId: 'admin', actorName: 'Admin', actorRole: 'admin',
          eventType: 'task_created', title: `Task created: “${data.title}”`, meta: { task_id: data.id },
        }).catch(() => {})
      }
    } catch {
      /* no insert on failure */
    }
    setNewTask({ title: '', priority: 'medium', category: 'deliverable', due_date: '', description: '', visible_to_client: true, requires_approval: false, phase_id: '' })
    setShowAddForm(false)
    setAddingTask(false)
  }

  const filteredTasks = tasks.filter((t) => {
    if (userRole === 'client' && !t.visible_to_client) return false
    if (filter === 'all') return true
    if (filter === 'active') return !['completed', 'pending'].includes(t.status)
    if (filter === 'completed') return t.status === 'completed'
    if (filter === 'overdue') return isOverdue(t.due_date, t.status)
    if (filter === 'approvals') return isApprovalGate(t) && t.status !== 'completed'
    return true
  })

  const overdueCount = tasks.filter((t) => isOverdue(t.due_date, t.status) && (userRole === 'admin' || t.visible_to_client)).length
  const awaitingApproval = tasks.filter(
    (t) => isApprovalGate(t) && t.visible_to_client && t.status === 'review' && t.approval_status !== 'approved' && !t.approved_at
  ).length

  // Build phase-grouped sections when phases are available.
  const usePhases = (phases?.length ?? 0) > 0
  const phaseSections = usePhases
    ? [
        ...(phases ?? []).map((p, i) => ({
          id: p.id,
          name: p.name,
          color: phaseColor(i),
          items: filteredTasks.filter((t) => t.phase_id === p.id).sort((a, b) => a.sort_order - b.sort_order),
        })),
        {
          id: '__none',
          name: 'Other tasks',
          color: 'hsl(var(--muted-foreground))',
          items: filteredTasks.filter((t) => !t.phase_id || !(phases ?? []).some((p) => p.id === t.phase_id)).sort((a, b) => a.sort_order - b.sort_order),
        },
      ].filter((s) => s.items.length > 0)
    : []

  const flatActive = filteredTasks.filter((t) => t.status !== 'completed')
  const flatCompleted = filteredTasks.filter((t) => t.status === 'completed')

  const rowProps = (task: Task) => ({
    key: task.id,
    task,
    userRole,
    isUpdating: updating === task.id,
    isAttaching: attaching === task.id,
    isExpanded: expandedId === task.id,
    onToggleExpand: () => setExpandedId(expandedId === task.id ? null : task.id),
    onCycleStatus: () => cycleStatus(task),
    onApprove: () => approveTask(task),
    onRequestChanges: (note: string) => requestChanges(task, note),
    onAttachMedia: (file: File) => attachMedia(task, file),
    onDelete: () => deleteTask(task.id),
  })

  return (
    <div className="space-y-4">
      {/* Progress card */}
      <div className="p-5 rounded-2xl" style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>Project Progress</p>
            <p className="text-xs mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
              {completedCount} of {visibleTasks.length} steps complete
              {awaitingApproval > 0 && (
                <span style={{ color: 'hsl(var(--primary))' }}> · {awaitingApproval} awaiting your approval</span>
              )}
            </p>
          </div>
          <span className="font-display text-3xl font-bold tabular-nums" style={{ color: completionPct === 100 ? 'hsl(var(--status-green))' : 'hsl(var(--primary))' }}>
            {completionPct}%
          </span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'hsl(var(--secondary))' }}>
          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${completionPct}%`, backgroundColor: completionPct === 100 ? 'hsl(var(--status-green))' : 'hsl(var(--primary))' }} />
        </div>
      </div>

      {/* Filter + Add row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {[
            { key: 'all', label: 'All' },
            { key: 'active', label: 'Active' },
            { key: 'completed', label: 'Done' },
            ...(awaitingApproval > 0 ? [{ key: 'approvals', label: `Approvals ${awaitingApproval}` }] : []),
            ...(overdueCount > 0 ? [{ key: 'overdue', label: `Overdue ${overdueCount}` }] : []),
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
              style={{
                backgroundColor: filter === key ? (key === 'overdue' ? 'hsl(var(--destructive))' : 'hsl(var(--primary))') : 'hsl(var(--secondary))',
                color: filter === key ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {userRole === 'admin' && (
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{ backgroundColor: showAddForm ? 'hsl(var(--secondary))' : 'hsl(var(--primary))', color: showAddForm ? 'hsl(var(--muted-foreground))' : 'hsl(var(--primary-foreground))' }}
          >
            <Plus size={12} />
            Add Task
          </button>
        )}
      </div>

      {/* Add task form (admin only) */}
      {showAddForm && userRole === 'admin' && (
        <form onSubmit={handleAddTask} className="p-5 rounded-xl space-y-3" style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--primary) / 0.2)' }}>
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'hsl(var(--primary))' }}>New Task</p>
          <input
            type="text" required autoFocus value={newTask.title}
            onChange={(e) => setNewTask((p) => ({ ...p, title: e.target.value }))}
            placeholder="Task title..."
            className="w-full px-4 py-3 rounded-lg text-sm outline-none transition-all"
            style={{ backgroundColor: 'hsl(var(--primary-foreground))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}
          />
          <textarea
            value={newTask.description}
            onChange={(e) => setNewTask((p) => ({ ...p, description: e.target.value }))}
            placeholder="Description (optional)..." rows={2}
            className="w-full px-4 py-3 rounded-lg text-sm outline-none transition-all resize-none"
            style={{ backgroundColor: 'hsl(var(--primary-foreground))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}
          />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <select value={newTask.priority} onChange={(e) => setNewTask((p) => ({ ...p, priority: e.target.value }))} className="px-3 py-2.5 rounded-lg text-xs outline-none" style={{ backgroundColor: 'hsl(var(--primary-foreground))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}>
              {Object.entries(PRIORITY_CONFIG).map(([k, v]) => <option key={k} value={k} style={{ backgroundColor: 'hsl(var(--card))' }}>{v.label} Priority</option>)}
            </select>
            <select value={newTask.category} onChange={(e) => setNewTask((p) => ({ ...p, category: e.target.value }))} className="px-3 py-2.5 rounded-lg text-xs outline-none" style={{ backgroundColor: 'hsl(var(--primary-foreground))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k} style={{ backgroundColor: 'hsl(var(--card))' }}>{v}</option>)}
            </select>
            <input type="date" value={newTask.due_date} onChange={(e) => setNewTask((p) => ({ ...p, due_date: e.target.value }))} className="px-3 py-2.5 rounded-lg text-xs outline-none" style={{ backgroundColor: 'hsl(var(--primary-foreground))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))', colorScheme: 'dark' }} />
            {usePhases ? (
              <select value={newTask.phase_id} onChange={(e) => setNewTask((p) => ({ ...p, phase_id: e.target.value }))} className="px-3 py-2.5 rounded-lg text-xs outline-none" style={{ backgroundColor: 'hsl(var(--primary-foreground))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}>
                <option value="" style={{ backgroundColor: 'hsl(var(--card))' }}>No phase</option>
                {(phases ?? []).map((p) => <option key={p.id} value={p.id} style={{ backgroundColor: 'hsl(var(--card))' }}>{p.name}</option>)}
              </select>
            ) : (
              <button type="button" onClick={() => setNewTask((p) => ({ ...p, visible_to_client: !p.visible_to_client }))} className="px-3 py-2.5 rounded-lg text-xs font-medium transition-all" style={{ backgroundColor: newTask.visible_to_client ? 'hsl(var(--primary) / 0.1)' : 'hsl(var(--primary-foreground))', color: newTask.visible_to_client ? 'hsl(var(--primary))' : 'hsl(var(--text-faint))', border: newTask.visible_to_client ? '1px solid hsl(var(--primary) / 0.2)' : '1px solid hsl(var(--border))' }}>
                {newTask.visible_to_client ? '👁 Visible' : '🔒 Internal'}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={() => setNewTask((p) => ({ ...p, requires_approval: !p.requires_approval }))} className="px-3 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5" style={{ backgroundColor: newTask.requires_approval ? 'hsl(var(--primary) / 0.1)' : 'hsl(var(--secondary))', color: newTask.requires_approval ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))', border: newTask.requires_approval ? '1px solid hsl(var(--primary) / 0.2)' : '1px solid hsl(var(--border))' }}>
              <ShieldCheck size={12} /> {newTask.requires_approval ? 'Approval gate' : 'Make approval gate'}
            </button>
            {usePhases && (
              <button type="button" onClick={() => setNewTask((p) => ({ ...p, visible_to_client: !p.visible_to_client }))} className="px-3 py-2 rounded-lg text-xs font-medium transition-all" style={{ backgroundColor: newTask.visible_to_client ? 'hsl(var(--primary) / 0.1)' : 'hsl(var(--secondary))', color: newTask.visible_to_client ? 'hsl(var(--primary))' : 'hsl(var(--text-faint))', border: newTask.visible_to_client ? '1px solid hsl(var(--primary) / 0.2)' : '1px solid hsl(var(--border))' }}>
                {newTask.visible_to_client ? '👁 Visible to client' : '🔒 Internal only'}
              </button>
            )}
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => setShowAddForm(false)} className="px-4 py-2 rounded-lg text-sm transition-all" style={{ backgroundColor: 'hsl(var(--secondary))', color: 'hsl(var(--muted-foreground))' }}>Cancel</button>
            <button type="submit" disabled={addingTask} className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-60" style={{ backgroundColor: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}>
              {addingTask ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              {addingTask ? 'Adding...' : 'Add Task'}
            </button>
          </div>
        </form>
      )}

      {/* Empty state */}
      {filteredTasks.length === 0 && (
        <div className="flex flex-col items-center justify-center py-14 rounded-xl" style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
          <CheckCircle2 size={28} style={{ color: 'hsl(var(--text-faint))' }} />
          <p className="text-sm mt-3" style={{ color: 'hsl(var(--muted-foreground))' }}>
            {filter === 'completed' ? 'No completed tasks yet' : filter === 'overdue' ? 'No overdue tasks' : filter === 'approvals' ? 'Nothing awaiting approval' : 'No tasks yet'}
          </p>
        </div>
      )}

      {/* Phase-grouped process view */}
      {usePhases && phaseSections.map((section) => {
        const isCollapsed = collapsedPhases[section.id]
        const done = section.items.filter((t) => t.status === 'completed').length
        return (
          <div key={section.id} className="space-y-2">
            <button onClick={() => setCollapsedPhases((c) => ({ ...c, [section.id]: !c[section.id] }))} className="w-full flex items-center gap-2.5 text-left">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: section.color }} />
              <span className="text-sm font-semibold flex-1 min-w-0 truncate" style={{ color: 'hsl(var(--foreground))' }}>{section.name}</span>
              <span className="text-xs tabular-nums flex-shrink-0" style={{ color: 'hsl(var(--text-faint))' }}>{done}/{section.items.length}</span>
              <ChevronDown size={15} className="flex-shrink-0 transition-transform" style={{ color: 'hsl(var(--text-faint))', transform: isCollapsed ? 'rotate(-90deg)' : 'none' }} />
            </button>
            {!isCollapsed && (
              <div className="space-y-2 pl-1">
                {section.items.map((task) => <TaskRow {...rowProps(task)} />)}
              </div>
            )}
          </div>
        )
      })}

      {/* Flat view (no phases) */}
      {!usePhases && (
        <>
          {flatActive.length > 0 && <div className="space-y-2">{flatActive.map((task) => <TaskRow {...rowProps(task)} />)}</div>}
          {flatCompleted.length > 0 && (
            <CompletedGroup tasks={flatCompleted} rowProps={rowProps} />
          )}
        </>
      )}
    </div>
  )
}

// ── TaskRow ────────────────────────────────────────────────────────────────

type RowProps = {
  task: Task
  userRole: 'admin' | 'client'
  isUpdating: boolean
  isAttaching: boolean
  isExpanded: boolean
  onToggleExpand: () => void
  onCycleStatus: () => void
  onApprove: () => void
  onRequestChanges: (note: string) => void
  onAttachMedia: (file: File) => void
  onDelete: () => void
}

function TaskRow({
  task, userRole, isUpdating, isAttaching, isExpanded,
  onToggleExpand, onCycleStatus, onApprove, onRequestChanges, onAttachMedia, onDelete,
}: RowProps) {
  const cfg = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.pending
  const priorityCfg = PRIORITY_CONFIG[task.priority] ?? PRIORITY_CONFIG.medium
  const overdue = isOverdue(task.due_date, task.status)
  const StatusIcon = cfg.icon
  const gate = isApprovalGate(task)
  const fileRef = useRef<HTMLInputElement>(null)
  const [showNote, setShowNote] = useState(false)
  const [note, setNote] = useState('')

  const clientCanAct = userRole === 'client' && task.visible_to_client && task.status === 'review' && task.approval_status !== 'approved' && !task.approved_at

  return (
    <div className="rounded-xl overflow-hidden transition-all" style={{ backgroundColor: 'hsl(var(--card))', border: overdue ? '1px solid hsl(var(--destructive) / 0.2)' : gate && clientCanAct ? '1px solid hsl(var(--primary) / 0.35)' : task.status === 'completed' ? '1px solid hsl(var(--status-green) / 0.15)' : '1px solid hsl(var(--border))' }}>
      <div className="flex items-center gap-3 p-4">
        <button onClick={onCycleStatus} disabled={isUpdating || userRole === 'client'} className="flex-shrink-0 transition-all disabled:cursor-default" title={userRole === 'admin' ? `Mark as ${cfg.next}` : cfg.label}>
          {isUpdating ? <Loader2 size={20} className="animate-spin" style={{ color: 'hsl(var(--primary))' }} /> : <StatusIcon size={20} style={{ color: cfg.color, opacity: userRole === 'admin' ? 1 : 0.7 }} />}
        </button>

        <div className="flex-1 min-w-0 cursor-pointer" onClick={onToggleExpand}>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium" style={{ color: task.status === 'completed' ? 'hsl(var(--text-faint))' : 'hsl(var(--foreground))', textDecoration: task.status === 'completed' ? 'line-through' : 'none' }}>{task.title}</p>
            {gate && (
              <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: 'hsl(var(--primary) / 0.1)', color: 'hsl(var(--primary))' }}>
                <ShieldCheck size={9} /> Approval
              </span>
            )}
            {task.priority !== 'medium' && (
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: priorityCfg.dot }} />
                <span className="text-[10px]" style={{ color: priorityCfg.color }}>{priorityCfg.label}</span>
              </div>
            )}
            {!task.visible_to_client && <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: 'hsl(var(--muted) / 0.3)', color: 'hsl(var(--text-faint))' }}>Internal</span>}
            {task.approved_at && <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ backgroundColor: 'hsl(var(--status-green) / 0.12)', color: 'hsl(var(--status-green))' }}>✓ Approved</span>}
            {task.approval_status === 'changes_requested' && !task.approved_at && <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ backgroundColor: 'hsl(var(--status-amber) / 0.14)', color: 'hsl(var(--status-amber))' }}>Changes requested</span>}
          </div>
          {task.due_date && (
            <div className="flex items-center gap-1 mt-1.5">
              <Calendar size={11} style={{ color: overdue ? 'hsl(var(--destructive))' : 'hsl(var(--text-faint))' }} />
              <span className="text-xs" style={{ color: overdue ? 'hsl(var(--destructive))' : 'hsl(var(--text-faint))' }}>{overdue ? 'Overdue · ' : ''}{formatDueDate(task.due_date)}</span>
            </div>
          )}
        </div>

        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full flex-shrink-0" style={{ backgroundColor: cfg.bg }}>
          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cfg.color }} />
          <span className="text-[10px] font-semibold" style={{ color: cfg.color }}>{cfg.label}</span>
        </div>

        {/* Client approval actions */}
        {clientCanAct && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button onClick={onApprove} disabled={isUpdating} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-60" style={{ backgroundColor: 'hsl(var(--status-green))', color: 'hsl(var(--primary-foreground))' }}>Approve</button>
            <button onClick={() => { setShowNote((s) => !s); onToggleExpand() }} disabled={isUpdating} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-60" style={{ backgroundColor: 'hsl(var(--secondary))', color: 'hsl(var(--foreground))' }}>Request changes</button>
          </div>
        )}

        {(task.description || userRole === 'admin' || task.approval_note) && (
          <button onClick={onToggleExpand} className="p-1.5 rounded-lg transition-all flex-shrink-0 text-faint hover:text-foreground hover:bg-secondary">
            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
      </div>

      {/* Expanded detail */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-3" style={{ borderTop: '1px solid hsl(var(--secondary))' }}>
          {task.description && <p className="text-sm leading-relaxed pt-3" style={{ color: 'hsl(var(--muted-foreground))' }}>{task.description}</p>}

          {task.approval_note && (
            <div className="flex items-start gap-2 p-3 rounded-lg" style={{ backgroundColor: 'hsl(var(--status-amber) / 0.08)' }}>
              <MessageSquareWarning size={14} className="flex-shrink-0 mt-0.5" style={{ color: 'hsl(var(--status-amber))' }} />
              <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}><span className="font-semibold" style={{ color: 'hsl(var(--foreground))' }}>Change request:</span> {task.approval_note}</p>
            </div>
          )}

          {/* Client request-changes note input */}
          {clientCanAct && showNote && (
            <div className="space-y-2">
              <textarea
                value={note} onChange={(e) => setNote(e.target.value)} rows={3}
                placeholder="Describe the changes you'd like… (this will be posted to your project chat)"
                className="w-full px-3 py-2.5 rounded-lg text-sm outline-none resize-none"
                style={{ backgroundColor: 'hsl(var(--primary-foreground))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}
              />
              <div className="flex justify-end gap-2">
                <button onClick={() => { setShowNote(false); setNote('') }} className="px-3 py-1.5 rounded-lg text-xs" style={{ backgroundColor: 'hsl(var(--secondary))', color: 'hsl(var(--muted-foreground))' }}>Cancel</button>
                <button onClick={() => { if (note.trim()) { onRequestChanges(note.trim()); setShowNote(false); setNote('') } }} disabled={!note.trim() || isUpdating} className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50" style={{ backgroundColor: 'hsl(var(--status-amber))', color: 'hsl(var(--primary-foreground))' }}>Send request</button>
              </div>
            </div>
          )}

          {task.completed_at && (
            <p className="text-xs" style={{ color: 'hsl(var(--status-green))' }}>
              ✓ Completed {new Date(task.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          )}

          {/* Admin actions */}
          {userRole === 'admin' && (
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onAttachMedia(f); e.target.value = '' }} />
              <button onClick={() => fileRef.current?.click()} disabled={isAttaching} className="text-xs px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-60" style={{ backgroundColor: 'hsl(var(--secondary))', color: 'hsl(var(--foreground))' }}>
                {isAttaching ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />}
                {isAttaching ? 'Uploading…' : 'Attach approval media'}
              </button>
              <span className="text-xs flex-1" style={{ color: 'hsl(var(--text-faint))' }}>Click the status icon to advance</span>
              <button onClick={onDelete} className="text-xs px-3 py-1.5 rounded-lg transition-all hover:bg-destructive/10" style={{ color: 'hsl(var(--destructive))' }}>Delete task</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── CompletedGroup ──────────────────────────────────────────────────────────

function CompletedGroup({ tasks, rowProps }: { tasks: Task[]; rowProps: (t: Task) => RowProps }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 text-sm transition-colors w-full py-2 text-faint hover:text-muted-foreground" style={{ color: 'hsl(var(--text-faint))' }}>
        <div className="flex-1 h-px" style={{ backgroundColor: 'hsl(var(--secondary))' }} />
        <span className="flex-shrink-0 flex items-center gap-1.5">{open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}{tasks.length} completed</span>
        <div className="flex-1 h-px" style={{ backgroundColor: 'hsl(var(--secondary))' }} />
      </button>
      {open && <div className="space-y-2 mt-2">{tasks.map((task) => <TaskRow {...rowProps(task)} />)}</div>}
    </div>
  )
}
