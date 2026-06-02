'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { logActivity } from '@/lib/logActivity'
import { uploadFileToR2 } from '@/lib/uploadClient'
import { phaseColor } from '@/lib/projectProgress'
import FileViewer, { type ViewerFile } from '@/components/shared/FileViewer'
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
  Sparkles,
  Eye,
  EyeOff,
  Download,
  FileText,
  RefreshCw,
  Layers,
  Flag,
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
  review_requested_at?: string | null
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

// Only categories permitted by the tasks.category CHECK constraint.
const CATEGORY_LABELS: Record<string, string> = {
  deliverable: 'Deliverable',
  milestone: 'Milestone',
  revision: 'Revision',
  approval: 'Approval',
  internal: 'Internal',
}

function isApprovalGate(t: Task): boolean {
  return t.requires_approval || t.category === 'approval'
}

// Activity-log event types that belong in the Approvals & Records ledger.
const RECORD_EVENTS = ['approval_requested', 'task_approved', 'changes_requested', 'task_auto_approved']

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

export type InvolvementEntry = {
  id: string
  actor_name: string
  actor_role: string
  event_type: string
  title: string
  body: string | null
  created_at: string
  meta?: {
    task_id?: string | null
    attachment_name?: string | null
    attachment_file_id?: string | null
    resend?: boolean | null
  } | null
}

// Icon / tint / label for a record event in the Approvals & Records timeline.
function recordMeta(ev: InvolvementEntry): { Icon: any; tint: string; label: string } {
  switch (ev.event_type) {
    case 'task_approved':
      return { Icon: ShieldCheck, tint: 'hsl(var(--status-green))', label: 'Approved' }
    case 'changes_requested':
      return { Icon: MessageSquareWarning, tint: 'hsl(var(--status-amber))', label: 'Changes requested' }
    case 'task_auto_approved':
      return { Icon: Clock, tint: 'hsl(var(--muted-foreground))', label: 'Auto-approved' }
    case 'approval_requested':
      return ev.meta?.resend
        ? { Icon: RefreshCw, tint: 'hsl(var(--status-blue))', label: 'Re-sent for approval' }
        : { Icon: Flag, tint: 'hsl(var(--status-blue))', label: 'Approval requested' }
    default:
      return { Icon: ShieldCheck, tint: 'hsl(var(--muted-foreground))', label: ev.event_type }
  }
}

type Props = {
  projectId: string
  clientId?: string
  initialTasks: Task[]
  phases?: Phase[]
  userRole: 'admin' | 'client'
  onProgressUpdate?: (pct: number) => void
  involvement?: InvolvementEntry[]
}

export default function TaskBoard({
  projectId,
  clientId,
  initialTasks,
  phases,
  userRole,
  onProgressUpdate,
  involvement,
}: Props) {
  const supabase = createClient()
  const [tasks, setTasks] = useState(initialTasks)
  const [involvementLog, setInvolvementLog] = useState<InvolvementEntry[]>(involvement ?? [])

  // Optimistically prepend a client action to the involvement ledger so it
  // shows instantly; the server-logged copy is the source of truth on reload.
  function appendInvolvement(
    eventType: string,
    title: string,
    note?: string,
    meta?: InvolvementEntry['meta'],
  ) {
    setInvolvementLog((prev) => [
      {
        id: `local-${Date.now()}`,
        actor_name: 'You',
        actor_role: 'client',
        event_type: eventType,
        title,
        body: note?.trim() || null,
        created_at: new Date().toISOString(),
        meta: meta ?? null,
      },
      ...prev,
    ])
  }
  const [updating, setUpdating] = useState<string | null>(null)
  const [attaching, setAttaching] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [filter, setFilter] = useState<string>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // Phase sections start MINIMIZED (collapsed) by default; only phases holding a
  // task that needs attention (awaiting approval / changes requested / overdue)
  // open automatically. Computed once on mount; the user can toggle after.
  const [collapsedPhases, setCollapsedPhases] = useState<Record<string, boolean>>(() => {
    const attention = new Set<string>()
    for (const t of initialTasks) {
      const needsAttn =
        (isApprovalGate(t) && t.visible_to_client && t.status === 'review' && t.approval_status !== 'approved' && !t.approved_at) ||
        (t.approval_status === 'changes_requested' && !t.approved_at) ||
        isOverdue(t.due_date, t.status)
      if (needsAttn && t.phase_id) attention.add(t.phase_id)
    }
    const init: Record<string, boolean> = { __none: true }
    for (const p of phases ?? []) init[p.id] = !attention.has(p.id)
    return init
  })
  const [newTask, setNewTask] = useState({
    // New tasks default to internal (admin-only); the admin toggles visibility
    // on before the client ever sees the step.
    title: '', priority: 'medium', category: 'deliverable', due_date: '',
    description: '', visible_to_client: false, requires_approval: false, phase_id: '',
  })
  const [addingTask, setAddingTask] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [showActive, setShowActive] = useState(true)
  // Records open by default so the full per-task history is visible at a glance.
  const [showRecords, setShowRecords] = useState(true)
  const [showGenMenu, setShowGenMenu] = useState(false)
  // In-app file viewer (plays media / previews docs in place, never a new tab).
  const [previewFile, setPreviewFile] = useState<ViewerFile | null>(null)
  const openFile = (fileId?: string | null, name?: string | null) => {
    if (!fileId) return
    setPreviewFile({ id: fileId, file_name: name ?? 'File' })
  }

  // Tracks whether an action is mid-flight, so the live poll never clobbers an
  // optimistic update. Updated every render (a ref, not state — no re-render).
  const busyRef = useRef(false)
  busyRef.current = !!updating || seeding || addingTask || attaching !== null

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

  // Realtime Approvals & Records — new approval decisions (from either side)
  // stream in live, no refresh. Reconciles against optimistic local entries.
  useEffect(() => {
    const channel = supabase
      .channel(`records:${projectId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_log', filter: `project_id=eq.${projectId}` }, (payload) => {
        const row = payload.new as any
        if (!RECORD_EVENTS.includes(row.event_type)) return
        const entry: InvolvementEntry = {
          id: row.id,
          actor_name: row.actor_name,
          actor_role: row.actor_role,
          event_type: row.event_type,
          title: row.title,
          body: row.body ?? null,
          created_at: row.created_at,
          meta: row.meta ?? null,
        }
        setInvolvementLog((prev) => {
          if (prev.some((e) => e.id === entry.id)) return prev
          const taskId = entry.meta?.task_id ?? null
          // Drop the matching optimistic placeholder, if any, then prepend.
          const pruned = prev.filter(
            (e) => !(e.id.startsWith('local-') && e.event_type === entry.event_type && (e.meta?.task_id ?? null) === taskId)
          )
          return [entry, ...pruned]
        })
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [projectId])

  // Live safety net — poll the server (service role) so tasks + records stay
  // live for BOTH portals even where a realtime subscription is blocked by RLS
  // (admin reads have no RLS grant). Skips while an action is in flight, and
  // only updates state when something actually changed (no flicker).
  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      if (busyRef.current || document.hidden) return
      try {
        const res = await fetch(`/api/project-tasks?project_id=${projectId}`)
        if (!res.ok || cancelled || busyRef.current) return
        const json = await res.json()
        if (cancelled || busyRef.current) return
        if (Array.isArray(json.tasks)) {
          setTasks((prev) => {
            const next = json.tasks as Task[]
            const changed =
              next.length !== prev.length ||
              next.some((t) => {
                const p = prev.find((x) => x.id === t.id)
                return !p || p.status !== t.status || p.approval_status !== t.approval_status ||
                  p.approved_at !== t.approved_at || p.title !== t.title ||
                  p.visible_to_client !== t.visible_to_client || p.phase_id !== t.phase_id ||
                  p.priority !== t.priority || p.due_date !== t.due_date || p.sort_order !== t.sort_order
              })
            return changed ? next : prev
          })
        }
        if (Array.isArray(json.involvement)) {
          setInvolvementLog((prev) => {
            const server = json.involvement as InvolvementEntry[]
            const serverKeys = new Set(server.map((e) => `${e.event_type}:${e.meta?.task_id ?? ''}`))
            const pendingLocal = prev.filter(
              (e) => e.id.startsWith('local-') && !serverKeys.has(`${e.event_type}:${e.meta?.task_id ?? ''}`)
            )
            const merged = [...pendingLocal, ...server]
            const same = merged.length === prev.length && merged.every((e, i) => e.id === prev[i]?.id)
            return same ? prev : merged
          })
        }
      } catch { /* ignore — realtime/other polls cover it */ }
    }
    const interval = setInterval(tick, 7000)
    const onVisible = () => { if (!document.hidden) tick() }
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(interval)
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
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

  // Upload an optional approval/change-request attachment to the vault and
  // return a chat-attachment ref (same `bucket::path` scheme the chat uses)
  // plus the committed file id, so it can be linked from the records ledger.
  async function uploadActionFile(file: File | null, taskId?: string): Promise<{ url?: string; name?: string; fileId?: string }> {
    if (!file || !clientId) return { url: undefined, name: undefined, fileId: undefined }
    // Land task approval/change files in the vault's "Tasks & Approvals" folder
    // (folder 'tasks' + taskId), matching admin — not the chat folder.
    const up = await uploadFileToR2({
      file, projectId, clientId, direction: 'client-upload', folder: 'tasks', taskId,
    })
    return { url: `${up.bucket}::${up.file_path}`, name: up.file_name, fileId: up.id }
  }

  // Client approves an approval-gate task → completes it. An optional note and
  // file are posted into the project chat as proof of approval.
  async function approveTask(task: Task, note = '', file: File | null = null) {
    if (userRole !== 'client') return
    setUpdating(task.id)
    const now = new Date().toISOString()
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, approved_at: now, status: 'completed', completed_at: now, approval_status: 'approved' } : t)))
    try {
      const att = await uploadActionFile(file, task.id)
      const res = await fetch('/api/portal/actions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve_task', task_id: task.id, note, attachment_url: att.url, attachment_name: att.name, attachment_file_id: att.fileId }),
      })
      if (!res.ok) throw new Error('approve failed')
      appendInvolvement('task_approved', `Approved “${task.title}”`, note, { task_id: task.id, attachment_name: att.name, attachment_file_id: att.fileId })
    } catch {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)))
    } finally {
      setUpdating(null)
    }
  }

  // Client requests changes — note is required, optional file. Auto-posts to chat.
  async function requestChanges(task: Task, note: string, file: File | null = null) {
    if (userRole !== 'client' || !note.trim()) return
    setUpdating(task.id)
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, approval_status: 'changes_requested', approval_note: note, status: 'in_progress' } : t)))
    try {
      const att = await uploadActionFile(file, task.id)
      const res = await fetch('/api/portal/actions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request_changes', task_id: task.id, note, attachment_url: att.url, attachment_name: att.name, attachment_file_id: att.fileId }),
      })
      if (!res.ok) throw new Error('request failed')
      appendInvolvement('changes_requested', `Requested changes on “${task.title}”`, note, { task_id: task.id, attachment_name: att.name, attachment_file_id: att.fileId })
    } catch {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)))
    } finally {
      setUpdating(null)
    }
  }

  // Admin attaches approval media to a task → uploaded to the vault under the
  // Tasks & Approvals folder, named for the task, and linked via task_id.
  async function attachMedia(task: Task, file: File | null, note = '') {
    if (userRole !== 'admin' || !clientId) return
    if (!file && !note.trim()) return
    setAttaching(task.id)
    try {
      // Optional file → vault (Tasks folder). Then wire note + file to the
      // Messages hub + Approvals & Records and send the gate for approval.
      let att: { url?: string; name?: string; fileId?: string } = {}
      if (file) {
        const named = new File([file], `${task.title} — approval media — ${file.name}`, { type: file.type })
        const up = await uploadFileToR2({
          file: named, projectId, clientId, direction: 'delivery', folder: 'tasks', taskId: task.id,
        })
        att = { url: `${up.bucket}::${up.file_path}`, name: up.file_name, fileId: up.id }
      }
      const { task: updated } = await taskAction({
        action: 'attach_task_media',
        task_id: task.id,
        attachment_url: att.url,
        attachment_name: att.name,
        attachment_file_id: att.fileId,
        note,
      })
      if (updated) setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)))
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
    setNewTask({ title: '', priority: 'medium', category: 'deliverable', due_date: '', description: '', visible_to_client: false, requires_approval: false, phase_id: '' })
    setShowAddForm(false)
    setAddingTask(false)
  }

  // Generate the premium per-phase production process (Discovery → Final
  // Delivery, with client approval gates). The trigger is always available to
  // the admin; `mode` decides how a re-trigger reconciles with an existing
  // process — fill empty phases, merge in missing steps, or replace it wholesale.
  async function seedPhaseProcess(mode: 'fill' | 'merge' | 'replace' = 'fill') {
    if (seeding) return
    setShowGenMenu(false)
    if (mode === 'replace' && !confirm('Replace the current phase process? Generated phase tasks will be removed and regenerated. Your custom deliverables and manually-added tasks are kept.')) return
    setSeeding(true)
    try {
      const { tasks: fresh, seeded } = await taskAction({ action: 'seed_phase_tasks', project_id: projectId, mode })
      if (Array.isArray(fresh)) setTasks(fresh)
      // Feedback when "fill" had nothing to do (every phase already populated),
      // so the trigger never reads as silently broken.
      if (seeded === 0 && mode === 'fill') {
        alert('Every phase already has a process. Use “Merge with existing” to add missing steps, or “Use new process (replace)” to regenerate.')
      }
    } catch (err: any) {
      alert(err.message ?? 'Failed to generate the phase process.')
    } finally {
      setSeeding(false)
    }
  }

  // Admin: patch task metadata (visibility, approval gate, priority, etc.).
  async function updateTaskFields(task: Task, fields: Partial<Task>) {
    if (userRole !== 'admin') return
    setUpdating(task.id)
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, ...fields } : t)))
    try {
      const { task: saved } = await taskAction({ action: 'update_task', task_id: task.id, updates: fields })
      if (saved) setTasks((prev) => prev.map((t) => (t.id === task.id ? saved : t)))
    } catch {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)))
    } finally {
      setUpdating(null)
    }
  }

  // Admin: set an explicit status (not just the next one in the cycle).
  async function setStatus(task: Task, status: string) {
    if (userRole !== 'admin' || status === task.status) return
    const isCompleting = status === 'completed'
    setUpdating(task.id)
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status, completed_at: isCompleting ? new Date().toISOString() : null } : t)))
    try {
      await taskAction({ action: 'toggle_task', task_id: task.id, status })
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

  // Admin: resend a gate for re-approval after the client requested changes —
  // re-opens it (status → review, approval reset to pending) so the client gets
  // a fresh approve/request-changes prompt. Recorded as a re-send in Records.
  async function resendForApproval(task: Task) {
    if (userRole !== 'admin') return
    setUpdating(task.id)
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: 'review', approval_status: 'pending', completed_at: null } : t)))
    try {
      const { task: saved } = await taskAction({ action: 'resend_approval', task_id: task.id })
      if (saved) setTasks((prev) => prev.map((t) => (t.id === task.id ? saved : t)))
    } catch {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)))
    } finally {
      setUpdating(null)
    }
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
  const activeApprovalTasks = tasks.filter(
    (t) => isApprovalGate(t) && t.visible_to_client && t.status === 'review' && t.approval_status !== 'approved' && !t.approved_at
  )
  const awaitingApproval = activeApprovalTasks.length
  // Held for re-work / re-approval — the client requested changes; the gate
  // stays in the Active folder until the admin resends it for approval (moves
  // it back to 'review') and the client approves (→ moves to Records).
  const changesRequestedActive = tasks.filter(
    (t) => isApprovalGate(t) && t.visible_to_client && t.approval_status === 'changes_requested' && !t.approved_at && t.status !== 'completed' && t.status !== 'review'
  )
  const activeApprovalCount = activeApprovalTasks.length + changesRequestedActive.length

  // Records grouped per task — each gate shows its full chronological timeline
  // (requested → changes → re-sent → approved). Groups ordered by latest activity.
  const recordGroups = (() => {
    const byTask = new Map<string, InvolvementEntry[]>()
    for (const ev of involvementLog) {
      const key = ev.meta?.task_id ?? `__${ev.id}`
      const arr = byTask.get(key) ?? []
      arr.push(ev)
      byTask.set(key, arr)
    }
    return Array.from(byTask.entries())
      .map(([taskId, events]) => {
        const ordered = [...events].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        const title = tasks.find((t) => t.id === taskId)?.title ?? ordered[0]?.title ?? 'Task'
        const resolved = ordered.some((e) => e.event_type === 'task_approved' || e.event_type === 'task_auto_approved')
        return { taskId, title, events: ordered, resolved, latestAt: ordered[ordered.length - 1]?.created_at ?? '' }
      })
      .sort((a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime())
  })()

  // Latest shared file per task (from the records ledger) — surfaced on the
  // card + in the Active folder so a gate shows its attachment, like Records.
  const latestAttachmentByTask = (() => {
    const map = new Map<string, { fileId: string; name: string }>()
    // involvementLog is newest-first, so the first hit per task is the latest.
    for (const ev of involvementLog) {
      const tid = ev.meta?.task_id
      if (!tid || map.has(tid)) continue
      if (ev.meta?.attachment_file_id && ev.meta?.attachment_name) {
        map.set(tid, { fileId: ev.meta.attachment_file_id, name: ev.meta.attachment_name })
      }
    }
    return map
  })()

  // Build phase-grouped sections when phases are available.
  const usePhases = (phases?.length ?? 0) > 0
  // Phases that have no tasks yet — admins can backfill the process into them.
  const populatedPhaseIds = new Set(tasks.map((t) => t.phase_id).filter(Boolean))
  const hasPhaseTasks = populatedPhaseIds.size > 0
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
    task,
    userRole,
    isUpdating: updating === task.id,
    isAttaching: attaching === task.id,
    isExpanded: expandedId === task.id,
    onToggleExpand: () => setExpandedId(expandedId === task.id ? null : task.id),
    onCycleStatus: () => cycleStatus(task),
    onSetStatus: (status: string) => setStatus(task, status),
    onUpdateFields: (fields: Partial<Task>) => updateTaskFields(task, fields),
    onApprove: (note: string, file: File | null) => approveTask(task, note, file),
    onRequestChanges: (note: string, file: File | null) => requestChanges(task, note, file),
    onAttachMedia: (file: File | null, note: string) => attachMedia(task, file, note),
    onResend: () => resendForApproval(task),
    onViewFile: (fileId: string, name: string) => openFile(fileId, name),
    attachment: latestAttachmentByTask.get(task.id) ?? null,
    onDelete: () => deleteTask(task.id),
    phases: phases ?? [],
  })

  return (
    <div className="space-y-4">
      {/* Progress card */}
      <div className="p-5 rounded-2xl" style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold" style={{ color: 'hsl(var(--foreground))' }}>Tasks Progress</p>
              {awaitingApproval > 0 && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: 'hsl(var(--status-amber) / 0.14)', color: 'hsl(var(--status-amber))' }}
                >
                  <ShieldCheck size={10} />
                  {awaitingApproval} pending {userRole === 'client' ? 'your approval' : 'client approval'}
                </span>
              )}
            </div>
            <p className="text-xs mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
              {completedCount} of {visibleTasks.length} tasks complete
              {awaitingApproval > 0 && (
                <span style={{ color: 'hsl(var(--status-amber))' }}>
                  {' '}· {awaitingApproval} {userRole === 'client' ? 'awaiting your approval' : 'awaiting client approval'}
                </span>
              )}
            </p>
          </div>
          <span className="font-display text-3xl font-bold tabular-nums flex-shrink-0" style={{ color: completionPct === 100 ? 'hsl(var(--status-green))' : 'hsl(var(--primary))' }}>
            {completionPct}%
          </span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'hsl(var(--secondary))' }}>
          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${completionPct}%`, backgroundColor: completionPct === 100 ? 'hsl(var(--status-green))' : 'hsl(var(--primary))' }} />
        </div>
      </div>

      {/* Approvals & Records — two live folder cards in both portals. ACTIVE
          holds gates awaiting a decision plus any change-requests held for
          re-approval (until the admin resends → review → client approves).
          RECORDS is the permanent, timestamped audit history. Both update live. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

        {/* ── Active Approvals folder ── */}
        <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
          <button onClick={() => setShowActive((s) => !s)} className="w-full flex items-center gap-2.5 px-4 py-3.5 text-left">
            <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'hsl(var(--status-amber) / 0.14)' }}>
              <Clock size={15} style={{ color: 'hsl(var(--status-amber))' }} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold flex items-center gap-2" style={{ color: 'hsl(var(--foreground))' }}>
                Active Approvals
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'hsl(var(--status-green))' }} title="Live" />
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
                {activeApprovalCount > 0 ? `${activeApprovalCount} awaiting action` : 'Nothing awaiting'}
              </p>
            </div>
            {activeApprovalCount > 0 && (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: 'hsl(var(--status-amber) / 0.16)', color: 'hsl(var(--status-amber))' }}>{activeApprovalCount}</span>
            )}
            <ChevronDown size={15} className="flex-shrink-0 transition-transform" style={{ color: 'hsl(var(--text-faint))', transform: showActive ? 'none' : 'rotate(-90deg)' }} />
          </button>
          {showActive && (
            <div className="px-4 pb-4 max-h-[320px] overflow-y-auto scrollbar-thin" style={{ borderTop: '1px solid hsl(var(--secondary))' }}>
              {activeApprovalCount === 0 && (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <ShieldCheck size={20} style={{ color: 'hsl(var(--text-faint))' }} />
                  <p className="text-xs mt-2" style={{ color: 'hsl(var(--muted-foreground))' }}>Nothing awaiting approval</p>
                </div>
              )}
              {/* Awaiting decision */}
              {activeApprovalTasks.map((t) => {
                const since = t.review_requested_at ?? t.created_at
                return (
                  <div key={t.id} className="flex items-start gap-3 rounded-lg p-2.5 mt-2" style={{ backgroundColor: 'hsl(var(--status-amber) / 0.07)' }}>
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ backgroundColor: 'hsl(var(--status-amber) / 0.14)' }}>
                      <Clock size={13} style={{ color: 'hsl(var(--status-amber))' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium leading-snug" style={{ color: 'hsl(var(--foreground))' }}>{t.title}</p>
                      <p className="text-[10px] mt-1" style={{ color: 'hsl(var(--text-faint))' }}>
                        {userRole === 'client' ? 'Awaiting your approval' : 'Awaiting client approval'} · since {new Date(since).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                      {latestAttachmentByTask.has(t.id) && (
                        <button type="button" onClick={() => { const a = latestAttachmentByTask.get(t.id)!; openFile(a.fileId, a.name) }}
                          className="inline-flex items-center gap-1.5 mt-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-colors"
                          style={{ backgroundColor: 'hsl(var(--primary) / 0.08)', color: 'hsl(var(--primary))', border: '1px solid hsl(var(--primary) / 0.18)' }}>
                          <Eye size={11} /> {latestAttachmentByTask.get(t.id)!.name}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
              {/* Change requests — held for re-work / re-approval */}
              {changesRequestedActive.map((t) => (
                <div key={t.id} className="flex items-start gap-3 rounded-lg p-2.5 mt-2" style={{ backgroundColor: 'hsl(var(--primary) / 0.06)' }}>
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ backgroundColor: 'hsl(var(--primary) / 0.12)' }}>
                    <MessageSquareWarning size={13} style={{ color: 'hsl(var(--primary))' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium leading-snug" style={{ color: 'hsl(var(--foreground))' }}>{t.title}</p>
                    {t.approval_note && <p className="text-[11px] mt-0.5 leading-snug" style={{ color: 'hsl(var(--muted-foreground))' }}>“{t.approval_note}”</p>}
                    <p className="text-[10px] mt-1" style={{ color: 'hsl(var(--text-faint))' }}>
                      Changes requested · {userRole === 'client' ? 'awaiting McPrime to resend for approval' : 'resend for approval when ready'}
                    </p>
                    {latestAttachmentByTask.has(t.id) && (
                      <button type="button" onClick={() => { const a = latestAttachmentByTask.get(t.id)!; openFile(a.fileId, a.name) }}
                        className="inline-flex items-center gap-1.5 mt-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-colors"
                        style={{ backgroundColor: 'hsl(var(--primary) / 0.08)', color: 'hsl(var(--primary))', border: '1px solid hsl(var(--primary) / 0.18)' }}>
                        <Eye size={11} /> {latestAttachmentByTask.get(t.id)!.name}
                      </button>
                    )}
                  </div>
                  {/* Admin: re-open the gate for re-approval */}
                  {userRole === 'admin' && (
                    <button
                      onClick={() => resendForApproval(t)}
                      disabled={updating === t.id}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold flex-shrink-0 transition-all disabled:opacity-60"
                      style={{ backgroundColor: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
                    >
                      {updating === t.id ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                      Resend for approval
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Records folder ── */}
        <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}>
          <button onClick={() => setShowRecords((s) => !s)} className="w-full flex items-center gap-2.5 px-4 py-3.5 text-left">
            <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'hsl(var(--primary) / 0.1)' }}>
              <ShieldCheck size={15} style={{ color: 'hsl(var(--primary))' }} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold flex items-center gap-2" style={{ color: 'hsl(var(--foreground))' }}>
                Records
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'hsl(var(--status-green))' }} title="Live" />
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
                {involvementLog.length > 0 ? `${involvementLog.length} decision${involvementLog.length === 1 ? '' : 's'} on record` : 'No records yet'}
              </p>
            </div>
            {involvementLog.length > 0 && (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: 'hsl(var(--primary) / 0.12)', color: 'hsl(var(--primary))' }}>{involvementLog.length}</span>
            )}
            <ChevronDown size={15} className="flex-shrink-0 transition-transform" style={{ color: 'hsl(var(--text-faint))', transform: showRecords ? 'none' : 'rotate(-90deg)' }} />
          </button>
          {showRecords && (
            <div className="px-4 pb-4 max-h-[320px] overflow-y-auto scrollbar-thin space-y-2" style={{ borderTop: '1px solid hsl(var(--secondary))' }}>
              {involvementLog.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <ShieldCheck size={20} style={{ color: 'hsl(var(--text-faint))' }} />
                  <p className="text-xs mt-2" style={{ color: 'hsl(var(--muted-foreground))' }}>No approval decisions yet</p>
                  <p className="text-[10px] mt-0.5" style={{ color: 'hsl(var(--text-faint))' }}>
                    Every approval &amp; change request is stored here for both you and {userRole === 'client' ? 'McPrime' : 'the client'}.
                  </p>
                </div>
              )}
              {/* One group per task — the full timeline of that gate, kept as a
                  permanent record with timestamps + details until it's approved. */}
              {recordGroups.map((group) => (
                <div key={group.taskId} className="pt-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <p className="text-xs font-semibold leading-snug min-w-0 truncate" style={{ color: 'hsl(var(--foreground))' }}>{group.title}</p>
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0"
                      style={group.resolved
                        ? { backgroundColor: 'hsl(var(--status-green) / 0.12)', color: 'hsl(var(--status-green))' }
                        : { backgroundColor: 'hsl(var(--status-amber) / 0.14)', color: 'hsl(var(--status-amber))' }}>
                      {group.resolved ? 'Resolved' : 'Open'}
                    </span>
                  </div>
                  <div className="space-y-2 pl-2 ml-1" style={{ borderLeft: '1px solid hsl(var(--secondary))' }}>
                    {group.events.map((ev) => {
                      const { Icon, tint, label } = recordMeta(ev)
                      return (
                        <div key={ev.id} className="flex items-start gap-2.5 pl-1.5">
                          <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ backgroundColor: `color-mix(in srgb, ${tint} 12%, transparent)` }}>
                            <Icon size={12} style={{ color: tint }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-semibold leading-snug" style={{ color: tint }}>{label}</p>
                            {ev.body && <p className="text-[11px] mt-0.5 leading-snug" style={{ color: 'hsl(var(--muted-foreground))' }}>{ev.body}</p>}
                            {ev.meta?.attachment_name && (
                              ev.meta.attachment_file_id ? (
                                <button
                                  type="button"
                                  onClick={() => openFile(ev.meta!.attachment_file_id, ev.meta!.attachment_name)}
                                  className="inline-flex items-center gap-1.5 mt-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-colors"
                                  style={{ backgroundColor: 'hsl(var(--primary) / 0.08)', color: 'hsl(var(--primary))', border: '1px solid hsl(var(--primary) / 0.18)' }}
                                >
                                  <Eye size={11} /> {ev.meta.attachment_name}
                                </button>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 mt-1.5 px-2 py-1 rounded-md text-[11px]" style={{ backgroundColor: 'hsl(var(--secondary))', color: 'hsl(var(--muted-foreground))' }}>
                                  <FileText size={11} /> {ev.meta.attachment_name}
                                </span>
                              )
                            )}
                            <p className="text-[10px] mt-1" style={{ color: 'hsl(var(--text-faint))' }}>
                              {ev.actor_name} · {new Date(ev.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
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
          <div className="flex items-center gap-1.5">
            {usePhases && (
              <div className="relative">
                <button
                  onClick={() => {
                    // No process yet → generate straight away. Otherwise offer
                    // the reconcile choices (merge / replace / customize).
                    if (!hasPhaseTasks) seedPhaseProcess('fill')
                    else setShowGenMenu((s) => !s)
                  }}
                  disabled={seeding}
                  title="Generate the Discovery → Final Delivery process with client approval gates"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-60"
                  style={{ backgroundColor: 'hsl(var(--primary) / 0.1)', color: 'hsl(var(--primary))', border: '1px solid hsl(var(--primary) / 0.2)' }}
                >
                  {seeding ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  {seeding ? 'Generating…' : hasPhaseTasks ? 'Generate process' : 'Generate phase process'}
                  {hasPhaseTasks && !seeding && <ChevronDown size={12} />}
                </button>

                {showGenMenu && !seeding && (
                  <>
                    {/* click-away */}
                    <div className="fixed inset-0 z-10" onClick={() => setShowGenMenu(false)} />
                    <div
                      className="absolute right-0 mt-1.5 w-72 rounded-xl overflow-hidden z-20 shadow-xl"
                      style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                    >
                      <div className="px-3.5 py-2.5" style={{ borderBottom: '1px solid hsl(var(--secondary))' }}>
                        <p className="text-xs font-semibold" style={{ color: 'hsl(var(--foreground))' }}>Re-generate process</p>
                        <p className="text-[10px] mt-0.5" style={{ color: 'hsl(var(--text-faint))' }}>A process already exists. Choose how to apply the standard one.</p>
                      </div>
                      {[
                        { mode: 'fill' as const, icon: Sparkles, label: 'Fill empty phases', desc: 'Only generate into phases with no tasks yet.' },
                        { mode: 'merge' as const, icon: Layers, label: 'Merge with existing', desc: 'Keep everything; add only missing steps.' },
                        { mode: 'replace' as const, icon: RefreshCw, label: 'Use new process (replace)', desc: 'Regenerate phase tasks; keep your custom deliverables.' },
                      ].map((opt) => {
                        const Icon = opt.icon
                        return (
                          <button
                            key={opt.mode}
                            onClick={() => seedPhaseProcess(opt.mode)}
                            className="w-full flex items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-secondary"
                          >
                            <Icon size={13} className="flex-shrink-0 mt-0.5" style={{ color: 'hsl(var(--primary))' }} />
                            <div className="min-w-0">
                              <p className="text-xs font-medium" style={{ color: 'hsl(var(--foreground))' }}>{opt.label}</p>
                              <p className="text-[10px] mt-0.5 leading-snug" style={{ color: 'hsl(var(--text-faint))' }}>{opt.desc}</p>
                            </div>
                          </button>
                        )
                      })}
                      <button
                        onClick={() => setShowGenMenu(false)}
                        className="w-full flex items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-secondary"
                        style={{ borderTop: '1px solid hsl(var(--secondary))' }}
                      >
                        <Flag size={13} className="flex-shrink-0 mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }} />
                        <div className="min-w-0">
                          <p className="text-xs font-medium" style={{ color: 'hsl(var(--foreground))' }}>Customize current</p>
                          <p className="text-[10px] mt-0.5 leading-snug" style={{ color: 'hsl(var(--text-faint))' }}>Keep the existing process and edit it by hand below.</p>
                        </div>
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{ backgroundColor: showAddForm ? 'hsl(var(--secondary))' : 'hsl(var(--primary))', color: showAddForm ? 'hsl(var(--muted-foreground))' : 'hsl(var(--primary-foreground))' }}
            >
              <Plus size={12} />
              Add Task
            </button>
          </div>
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
            style={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}
          />
          <textarea
            value={newTask.description}
            onChange={(e) => setNewTask((p) => ({ ...p, description: e.target.value }))}
            placeholder="Description (optional)..." rows={2}
            className="w-full px-4 py-3 rounded-lg text-sm outline-none transition-all resize-none"
            style={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}
          />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <select value={newTask.priority} onChange={(e) => setNewTask((p) => ({ ...p, priority: e.target.value }))} className="px-3 py-2.5 rounded-lg text-xs outline-none" style={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}>
              {Object.entries(PRIORITY_CONFIG).map(([k, v]) => <option key={k} value={k} style={{ backgroundColor: 'hsl(var(--card))' }}>{v.label} Priority</option>)}
            </select>
            <select value={newTask.category} onChange={(e) => setNewTask((p) => ({ ...p, category: e.target.value }))} className="px-3 py-2.5 rounded-lg text-xs outline-none" style={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k} style={{ backgroundColor: 'hsl(var(--card))' }}>{v}</option>)}
            </select>
            <input type="date" value={newTask.due_date} onChange={(e) => setNewTask((p) => ({ ...p, due_date: e.target.value }))} className="px-3 py-2.5 rounded-lg text-xs outline-none" style={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }} />
            {usePhases ? (
              <select value={newTask.phase_id} onChange={(e) => setNewTask((p) => ({ ...p, phase_id: e.target.value }))} className="px-3 py-2.5 rounded-lg text-xs outline-none" style={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}>
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
                {section.items.map((task) => <TaskRow key={task.id} {...rowProps(task)} />)}
              </div>
            )}
          </div>
        )
      })}

      {/* Flat view (no phases) */}
      {!usePhases && (
        <>
          {flatActive.length > 0 && <div className="space-y-2">{flatActive.map((task) => <TaskRow key={task.id} {...rowProps(task)} />)}</div>}
          {flatCompleted.length > 0 && (
            <CompletedGroup tasks={flatCompleted} rowProps={rowProps} />
          )}
        </>
      )}

      {/* In-app file viewer — plays media / previews docs in place. */}
      {previewFile && (
        <FileViewer key={previewFile.id} file={previewFile} onClose={() => setPreviewFile(null)} />
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
  onSetStatus: (status: string) => void
  onUpdateFields: (fields: Partial<Task>) => void
  onApprove: (note: string, file: File | null) => void
  onRequestChanges: (note: string, file: File | null) => void
  onAttachMedia: (file: File | null, note: string) => void
  onResend: () => void
  onViewFile: (fileId: string, name: string) => void
  attachment: { fileId: string; name: string } | null
  onDelete: () => void
  phases: Phase[]
}

function TaskRow({
  task, userRole, isUpdating, isAttaching, isExpanded,
  onToggleExpand, onCycleStatus, onSetStatus, onUpdateFields, onApprove, onRequestChanges, onAttachMedia, onResend, onViewFile, attachment, onDelete, phases,
}: RowProps) {
  const cfg = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.pending
  const priorityCfg = PRIORITY_CONFIG[task.priority] ?? PRIORITY_CONFIG.medium
  const overdue = isOverdue(task.due_date, task.status)
  const StatusIcon = cfg.icon
  const gate = isApprovalGate(task)
  // Admin gate that the client sent back — needs a resend for re-approval.
  const needsResend = userRole === 'admin' && gate && task.approval_status === 'changes_requested' && !task.approved_at && task.status !== 'review'
  const fileRef = useRef<HTMLInputElement>(null)
  const actionFileRef = useRef<HTMLInputElement>(null)
  const [actionMode, setActionMode] = useState<'approve' | 'changes' | null>(null)
  const [note, setNote] = useState('')
  const [actionFile, setActionFile] = useState<File | null>(null)
  // Admin "send for approval" composer (optional note + optional file).
  const [adminNote, setAdminNote] = useState('')
  const [adminFile, setAdminFile] = useState<File | null>(null)

  const clientCanAct = userRole === 'client' && task.visible_to_client && task.status === 'review' && task.approval_status !== 'approved' && !task.approved_at

  function resetAction() {
    setActionMode(null); setNote(''); setActionFile(null)
  }
  function openAction(mode: 'approve' | 'changes') {
    setActionMode(mode); setNote(''); setActionFile(null)
    if (!isExpanded) onToggleExpand()
  }

  // Completed cards read as "done" via a Liquid Glass surface; the expanded
  // (selected) card pops with a premium ring + subtle lift. Both portals share
  // this component, so the treatment is identical for admin and client.
  const isCompleted = task.status === 'completed'
  const isSelected = isExpanded
  const rowBorder = overdue
    ? '1px solid hsl(var(--destructive) / 0.25)'
    : isSelected
    ? '1px solid hsl(var(--primary) / 0.55)'
    : gate && clientCanAct
    ? '1px solid hsl(var(--primary) / 0.4)'
    : isCompleted
    ? '1px solid hsl(var(--status-green) / 0.22)'
    : '1px solid hsl(var(--border))'
  const rowShadow = isSelected
    ? '0 0 0 1px hsl(var(--primary) / 0.45), 0 16px 36px -16px hsl(var(--primary) / 0.4)'
    : gate && clientCanAct
    ? '0 1px 3px hsl(var(--primary) / 0.12)'
    : '0 1px 2px rgba(0,0,0,0.04)'
  const rowStyle: React.CSSProperties = {
    backgroundColor: isCompleted ? 'hsl(var(--card) / 0.55)' : 'hsl(var(--card))',
    border: rowBorder,
    boxShadow: rowShadow,
    transform: isSelected ? 'scale(1.01)' : 'none',
    ...(isCompleted
      ? { backdropFilter: 'blur(14px) saturate(140%)', WebkitBackdropFilter: 'blur(14px) saturate(140%)' }
      : {}),
  }

  return (
    <div className="rounded-2xl overflow-hidden transition-all" style={rowStyle}>
      <div className="flex items-center gap-3.5 p-5">
        <button onClick={onCycleStatus} disabled={isUpdating || userRole === 'client'} className="flex-shrink-0 transition-all disabled:cursor-default hover:scale-110" title={userRole === 'admin' ? `Mark as ${cfg.next}` : cfg.label}>
          {isUpdating ? <Loader2 size={22} className="animate-spin" style={{ color: 'hsl(var(--primary))' }} /> : <StatusIcon size={22} style={{ color: cfg.color, opacity: userRole === 'admin' ? 1 : 0.75 }} />}
        </button>

        {/* Left — title + due date. Shrinks/truncates so the chips can centre. */}
        <div className="min-w-0 cursor-pointer" onClick={onToggleExpand}>
          <p className="text-[15px] font-semibold leading-tight truncate" title={task.title} style={{ color: task.status === 'completed' ? 'hsl(var(--text-faint))' : 'hsl(var(--foreground))', textDecoration: task.status === 'completed' ? 'line-through' : 'none' }}>{task.title}</p>
          {task.due_date && (
            <div className="flex items-center gap-1 mt-1.5">
              <Calendar size={11} style={{ color: overdue ? 'hsl(var(--destructive))' : 'hsl(var(--text-faint))' }} />
              <span className="text-xs" style={{ color: overdue ? 'hsl(var(--destructive))' : 'hsl(var(--text-faint))' }}>{overdue ? 'Overdue · ' : ''}{formatDueDate(task.due_date)}</span>
            </div>
          )}
        </div>

        {/* Middle — indicator chips, centred in the card (both portals).
            Approval / priority / Internal / Approved / Changes. The status pill
            is pinned far-right (below), not here. */}
        <div className="flex-1 flex items-center justify-center gap-2 flex-wrap min-w-0">
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

        {/* Client approval actions — open a panel for an optional note + file */}
        {clientCanAct && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button onClick={() => openAction('approve')} disabled={isUpdating} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-60" style={{ backgroundColor: actionMode === 'approve' ? 'hsl(var(--status-green))' : 'hsl(var(--status-green))', color: 'hsl(var(--primary-foreground))' }}>Approve</button>
            <button onClick={() => openAction('changes')} disabled={isUpdating} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-60" style={{ backgroundColor: actionMode === 'changes' ? 'hsl(var(--status-amber))' : 'hsl(var(--secondary))', color: actionMode === 'changes' ? 'hsl(var(--primary-foreground))' : 'hsl(var(--foreground))' }}>Request changes</button>
          </div>
        )}

        {/* Admin: resend gate for re-approval — auto-appears after the client
            requested changes (the re-approval gate). */}
        {needsResend && (
          <button
            onClick={(e) => { e.stopPropagation(); onResend() }}
            disabled={isUpdating}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold flex-shrink-0 transition-all disabled:opacity-60"
            style={{ backgroundColor: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
            title="Re-open this gate for client re-approval"
          >
            {isUpdating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Resend for approval
          </button>
        )}

        {(task.description || userRole === 'admin' || task.approval_note || clientCanAct) && (
          <button onClick={onToggleExpand} className="p-1.5 rounded-lg transition-all flex-shrink-0 text-faint hover:text-foreground hover:bg-secondary">
            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}

        {/* Status pill — pinned to the far right (only this lives here). */}
        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full flex-shrink-0" style={{ backgroundColor: cfg.bg }}>
          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cfg.color }} />
          <span className="text-[10px] font-semibold" style={{ color: cfg.color }}>{cfg.label}</span>
        </div>
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

          {/* Unified client action panel — Approve or Request changes, each
              with an optional note + file that auto-posts to the project chat
              as a permanent record. */}
          {clientCanAct && actionMode && (
            <div
              className="space-y-2.5 rounded-lg p-3.5"
              style={{
                backgroundColor: actionMode === 'approve' ? 'hsl(var(--status-green) / 0.07)' : 'hsl(var(--status-amber) / 0.07)',
                border: actionMode === 'approve' ? '1px solid hsl(var(--status-green) / 0.25)' : '1px solid hsl(var(--status-amber) / 0.25)',
              }}
            >
              <p className="text-xs font-semibold flex items-center gap-1.5" style={{ color: actionMode === 'approve' ? 'hsl(var(--status-green))' : 'hsl(var(--status-amber))' }}>
                {actionMode === 'approve' ? <><ShieldCheck size={12} /> Approve this deliverable</> : <><MessageSquareWarning size={12} /> Request changes</>}
              </p>
              <textarea
                value={note} onChange={(e) => setNote(e.target.value)} rows={3}
                placeholder={actionMode === 'approve'
                  ? 'Add a note (optional) — this is posted to your project chat as a record.'
                  : "Describe the changes you'd like… (required — posted to your project chat)"}
                className="w-full px-3 py-2.5 rounded-lg text-sm outline-none resize-none"
                style={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}
              />
              <input ref={actionFileRef} type="file" className="hidden" onChange={(e) => setActionFile(e.target.files?.[0] ?? null)} />
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <button type="button" onClick={() => actionFileRef.current?.click()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all" style={{ backgroundColor: 'hsl(var(--secondary))', color: 'hsl(var(--foreground))', border: '1px solid hsl(var(--border))' }}>
                  <Paperclip size={12} /> {actionFile ? actionFile.name.slice(0, 28) : 'Attach file (optional)'}
                </button>
                <div className="flex gap-2">
                  <button onClick={resetAction} className="px-3 py-1.5 rounded-lg text-xs" style={{ backgroundColor: 'hsl(var(--secondary))', color: 'hsl(var(--muted-foreground))' }}>Cancel</button>
                  {actionMode === 'approve' ? (
                    <button
                      onClick={() => { onApprove(note.trim(), actionFile); resetAction() }}
                      disabled={isUpdating}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                      style={{ backgroundColor: 'hsl(var(--status-green))', color: 'hsl(var(--primary-foreground))' }}
                    >
                      {isUpdating ? 'Submitting…' : 'Confirm approval'}
                    </button>
                  ) : (
                    <button
                      onClick={() => { if (note.trim()) { onRequestChanges(note.trim(), actionFile); resetAction() } }}
                      disabled={!note.trim() || isUpdating}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                      style={{ backgroundColor: 'hsl(var(--status-amber))', color: 'hsl(var(--primary-foreground))' }}
                    >
                      {isUpdating ? 'Sending…' : 'Send request'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {task.completed_at && (
            <p className="text-xs" style={{ color: 'hsl(var(--status-green))' }}>
              ✓ Completed {new Date(task.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          )}

          {/* Shared file on this task — opens in the in-app viewer (no new tab). */}
          {attachment && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'hsl(var(--text-faint))' }}>Shared file</span>
              <button
                type="button"
                onClick={() => onViewFile(attachment.fileId, attachment.name)}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-colors"
                style={{ backgroundColor: 'hsl(var(--primary) / 0.08)', color: 'hsl(var(--primary))', border: '1px solid hsl(var(--primary) / 0.18)' }}
              >
                <Eye size={11} /> {attachment.name}
              </button>
            </div>
          )}

          {/* Admin control panel — every process control in one place:
              status, priority, visibility, approval gate, phase. */}
          {userRole === 'admin' && (
            <div className="space-y-3 pt-1">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {/* Process status */}
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'hsl(var(--text-faint))' }}>Status</span>
                  <select
                    value={task.status}
                    onChange={(e) => onSetStatus(e.target.value)}
                    disabled={isUpdating}
                    className="px-2.5 py-2 rounded-lg text-xs outline-none disabled:opacity-60"
                    style={{ backgroundColor: 'hsl(var(--secondary))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                  >
                    {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                      <option key={k} value={k} style={{ backgroundColor: 'hsl(var(--card))' }}>{v.label}</option>
                    ))}
                  </select>
                </label>
                {/* Priority */}
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'hsl(var(--text-faint))' }}>Priority</span>
                  <select
                    value={task.priority}
                    onChange={(e) => onUpdateFields({ priority: e.target.value })}
                    disabled={isUpdating}
                    className="px-2.5 py-2 rounded-lg text-xs outline-none disabled:opacity-60"
                    style={{ backgroundColor: 'hsl(var(--secondary))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                  >
                    {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
                      <option key={k} value={k} style={{ backgroundColor: 'hsl(var(--card))' }}>{v.label}</option>
                    ))}
                  </select>
                </label>
                {/* Phase */}
                {phases.length > 0 && (
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'hsl(var(--text-faint))' }}>Phase</span>
                    <select
                      value={task.phase_id ?? ''}
                      onChange={(e) => onUpdateFields({ phase_id: e.target.value || null })}
                      disabled={isUpdating}
                      className="px-2.5 py-2 rounded-lg text-xs outline-none disabled:opacity-60"
                      style={{ backgroundColor: 'hsl(var(--secondary))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                    >
                      <option value="" style={{ backgroundColor: 'hsl(var(--card))' }}>No phase</option>
                      {phases.map((p) => (
                        <option key={p.id} value={p.id} style={{ backgroundColor: 'hsl(var(--card))' }}>{p.name}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              {/* Toggles — visibility + approval gate */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => onUpdateFields({ visible_to_client: !task.visible_to_client })}
                  disabled={isUpdating}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all disabled:opacity-60"
                  style={{
                    backgroundColor: task.visible_to_client ? 'hsl(var(--status-blue) / 0.1)' : 'hsl(var(--secondary))',
                    color: task.visible_to_client ? 'hsl(var(--status-blue))' : 'hsl(var(--text-faint))',
                    border: task.visible_to_client ? '1px solid hsl(var(--status-blue) / 0.25)' : '1px solid hsl(var(--border))',
                  }}
                  title="When on, this step shows on the client portal"
                >
                  {task.visible_to_client ? <Eye size={12} /> : <EyeOff size={12} />}
                  {task.visible_to_client ? 'Visible to client' : 'Internal only'}
                </button>
                <button
                  onClick={() => onUpdateFields({ requires_approval: !gate })}
                  disabled={isUpdating}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all disabled:opacity-60"
                  style={{
                    backgroundColor: gate ? 'hsl(var(--primary) / 0.1)' : 'hsl(var(--secondary))',
                    color: gate ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
                    border: gate ? '1px solid hsl(var(--primary) / 0.25)' : '1px solid hsl(var(--border))',
                  }}
                  title="When on, the client can approve or request changes on this step"
                >
                  <ShieldCheck size={12} />
                  {gate ? 'Approval gate on' : 'Approval gate off'}
                </button>
              </div>

              {/* Send for approval — compose a note + optional file, then send
                  it to the client. Wires to Messages + Records + the vault. */}
              <div className="space-y-2.5 rounded-lg p-3.5" style={{ backgroundColor: 'hsl(var(--secondary) / 0.5)', border: '1px solid hsl(var(--border))' }}>
                <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'hsl(var(--text-faint))' }}>
                  {needsResend ? 'Re-send for approval' : 'Send for approval'}
                </p>
                <textarea
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  rows={2}
                  placeholder="Add a note for the client (optional)…"
                  className="w-full px-3 py-2.5 rounded-lg text-sm outline-none resize-none"
                  style={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                />
                <input ref={fileRef} type="file" className="hidden" onChange={(e) => { setAdminFile(e.target.files?.[0] ?? null) }} />
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <button type="button" onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all" style={{ backgroundColor: 'hsl(var(--secondary))', color: 'hsl(var(--foreground))', border: '1px solid hsl(var(--border))' }}>
                    <Paperclip size={12} /> {adminFile ? adminFile.name.slice(0, 28) : 'Attach file (optional)'}
                  </button>
                  <div className="flex items-center gap-2">
                    <button onClick={onDelete} className="text-xs px-3 py-1.5 rounded-lg transition-all hover:bg-destructive/10" style={{ color: 'hsl(var(--destructive))' }}>Delete task</button>
                    <button
                      onClick={() => { onAttachMedia(adminFile, adminNote); setAdminNote(''); setAdminFile(null) }}
                      disabled={isAttaching || (!adminFile && !adminNote.trim())}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-50"
                      style={{ backgroundColor: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
                    >
                      {isAttaching ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
                      {isAttaching ? 'Sending…' : needsResend ? 'Re-send for approval' : 'Send for approval'}
                    </button>
                  </div>
                </div>
              </div>
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
      {open && <div className="space-y-2 mt-2">{tasks.map((task) => <TaskRow key={task.id} {...rowProps(task)} />)}</div>}
    </div>
  )
}
