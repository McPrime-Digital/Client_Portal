'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import StatusBadge from '@/components/portal/StatusBadge'
import AdminInvoicesTab from '@/components/admin/AdminInvoicesTab'
import RoomThread from '@/components/shared/RoomThread'
import TaskBoard from '@/components/shared/TaskBoard'
import type { Message } from '@/lib/types/database'
import { uploadFileToR2 } from '@/lib/uploadClient'
import ProgressBar from '@/components/shared/ProgressBar'
import ProgressSlider from '@/components/shared/ProgressSlider'
import { computeProjectProgress, phaseColor } from '@/lib/projectProgress'
import {
  ArrowLeft,
  LayoutDashboard,
  Files,
  MessageSquare,
  CheckSquare,
  CreditCard,
  Settings,
  Upload,
  Download,
  Send,
  Plus,
  Trash2,
  Check,
  CheckCheck,
  Loader2,
  FileVideo,
  FileImage,
  FileText,
  File,
  X,
  Save,
  AlertCircle,
  RefreshCw,
} from 'lucide-react'
import FileVault from '@/components/shared/FileVault'

const STATUSES = [
  'Onboarding',
  'Pre-Production',
  'In Production',
  'Post-Production',
  'In Review',
  'Revisions',
  'Completed',
  'On Hold',
]

const tabs = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'files', label: 'Files', icon: Files },
  { id: 'messages', label: 'Messages', icon: MessageSquare },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare },
  { id: 'invoices', label: 'Invoices', icon: CreditCard },
  { id: 'settings', label: 'Settings', icon: Settings },
]

function getFileIcon(type: string | null) {
  if (!type) return File
  if (type.startsWith('video/')) return FileVideo
  if (type.startsWith('image/')) return FileImage
  if (type.includes('pdf') || type.includes('document'))
    return FileText
  return File
}

function formatBytes(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function AdminProjectDetail({
  project: initialProject,
  client,
  phases: initialPhases,
  tasks: initialTasks,
  files: initialFiles,
  involvement,
  studioName,
}: any) {
  const router = useRouter()
  const supabase = createClient()

  const [activeTab, setActiveTab] = useState('overview')
  // Honour a ?tab= deep-link (e.g. from a notification → opens the chat).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab')
    if (t && tabs.some((tab) => tab.id === t)) setActiveTab(t)
  }, [])
  const [project, setProject] = useState(initialProject)
  const [phases, setPhases] = useState(initialPhases)
  const [tasks, setTasks] = useState(initialTasks)
  const [files, setFiles] = useState(initialFiles)

  // Sync from the server on RealtimeRefresh/poll re-renders so client-driven
  // changes (approvals advancing phases, uploads) appear live for the admin
  // too. Fires only when the server actually returns new data (new prop ref).
  useEffect(() => { setProject(initialProject) }, [initialProject])
  useEffect(() => { setPhases(initialPhases) }, [initialPhases])
  useEffect(() => { setTasks(initialTasks) }, [initialTasks])
  useEffect(() => { setFiles(initialFiles) }, [initialFiles])

  // Overview state
  const [savingPhase, setSavingPhase] = useState<string | null>(
    null
  )

  // Files state
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Typing & presence state
  const [clientTyping, setClientTyping] = useState(false)
  const [clientOnline, setClientOnline] = useState(false)
  // Tasks state
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [addingTask, setAddingTask] = useState(false)

  // Settings state
  const [settings, setSettings] = useState({
    title: project.title,
    status: project.status,
    progress: project.progress,
    brief: project.brief ?? '',
    kickoff_date: project.kickoff_date ?? '',
    due_date: project.due_date ?? '',
    stripe_payment_url: project.stripe_payment_url ?? '',
    invoice_amount: project.invoice_amount ?? '',
  })
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)

  // Compute overall progress live from phases state (single source of
  // truth shared with the client portal, lists and overview).
  const computedProgress = computeProjectProgress(phases, project.progress)

  // Live per-tab notification badges — this project's unread admin
  // notifications by type, kept live (realtime + poll). Each badge persists
  // until its tab is opened.
  const [adminNotifs, setAdminNotifs] = useState<any[]>([])
  const loadAdminNotifs = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/notifications')
      if (!res.ok) return
      const json = await res.json()
      setAdminNotifs(json.notifications ?? [])
    } catch { /* ignore */ }
  }, [])
  useEffect(() => {
    loadAdminNotifs()
    const channel = supabase
      .channel(`admin-proj-notifs:${project.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => loadAdminNotifs())
      .subscribe()
    const poll = setInterval(loadAdminNotifs, 90_000)
    return () => { clearInterval(poll); supabase.removeChannel(channel) }
  }, [loadAdminNotifs])
  const tabBadge = (type: string) =>
    adminNotifs.filter((n: any) => n.project_id === project.id && n.type === type && !n.read_at && !n.dismissed_at).length

  // Opening the chat clears its bell notifications; the read watermark is
  // RoomThread's job now (one code path — Batch 15 item 1).
  useEffect(() => {
    if (activeTab === 'messages') {
      fetch('/api/admin/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: project.id, type: 'message' }),
      }).catch(() => {})
    }
  }, [activeTab, project.id])

  // Clear this project's admin notifications for the opened tab (files/tasks/
  // invoices) — they persist in the admin bell until the relevant tab is
  // opened. (Messages is handled in the effect above, which also marks read.)
  useEffect(() => {
    const typeForTab: Record<string, string | undefined> = {
      files: 'file_delivered',
      tasks: 'task_updated',
      invoices: 'invoice_created',
    }
    const type = typeForTab[activeTab]
    if (!type) return
    fetch('/api/admin/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: project.id, type }),
    }).catch(() => {})
  }, [activeTab, project.id])

  // Presence — track client online status
  useEffect(() => {
    const ch = supabase.channel(`presence:${project.id}`, {
      config: { presence: { key: `admin` } },
    })
    ch
      .on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState()
        const clientPresent = Object.values(state).some((presences: any) =>
          presences.some((p: any) => p.role === 'client')
        )
        setClientOnline(clientPresent)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await ch.track({ role: 'admin' })
        }
      })
    return () => { supabase.removeChannel(ch) }
  }, [project.id])

  // ── API HELPER ──
  async function adminAction(action: string, payload: Record<string, any>) {
    const res = await fetch('/api/admin/project-actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? 'Request failed')
    return json
  }

  // ── PHASE HANDLERS ──
  async function updatePhaseProgress(
    phaseId: string,
    progress: number
  ) {
    setSavingPhase(phaseId)
    // Optimistic — reflect the new value instantly (overall % is derived from
    // phases), then reconcile with the persisted row.
    setPhases((prev: any[]) =>
      prev.map((p) => (p.id === phaseId ? { ...p, progress, is_complete: progress >= 100 } : p))
    )
    try {
      const { phase, status } = await adminAction('update_phase', {
        phase_id: phaseId,
        progress,
      })
      setPhases((prev: any[]) =>
        prev.map((p) => (p.id === phaseId ? phase : p))
      )
      // The pipeline status is auto-derived from phase progress — reflect any
      // change in the header badge + settings without a reload.
      if (status) {
        setProject((prev: any) => ({ ...prev, status }))
        setSettings((prev) => ({ ...prev, status }))
      }
    } catch (err: any) {
      console.error('Failed to update phase:', err)
      alert(`Failed to update phase: ${err.message}`)
    } finally {
      setSavingPhase(null)
    }
  }

  // ── PHASE MANAGEMENT ──
  const [newPhaseName, setNewPhaseName] = useState('')
  const [phaseBusy, setPhaseBusy] = useState(false)

  async function addPhase(e: React.FormEvent) {
    e.preventDefault()
    if (!newPhaseName.trim()) return
    setPhaseBusy(true)
    try {
      const { phase } = await adminAction('add_phase', {
        project_id: project.id,
        name: newPhaseName.trim(),
      })
      setPhases((prev: any[]) => [...prev, phase])
      setNewPhaseName('')
    } catch (err: any) {
      alert(`Failed to add phase: ${err.message}`)
    } finally {
      setPhaseBusy(false)
    }
  }

  async function deletePhase(phaseId: string) {
    if (!confirm('Remove this phase? Its progress will be discarded.')) return
    setPhases((prev: any[]) => prev.filter((p) => p.id !== phaseId))
    try {
      const { status } = await adminAction('delete_phase', { phase_id: phaseId })
      if (status) {
        setProject((prev: any) => ({ ...prev, status }))
        setSettings((prev) => ({ ...prev, status }))
      }
    } catch (err: any) {
      alert(`Failed to delete phase: ${err.message}`)
    }
  }

  // ── FILE HANDLERS ──
  async function handleUpload(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadError('')

    try {
      const uploaded = await uploadFileToR2({
        file,
        projectId: project.id,
        direction: 'delivery',
      })

      setFiles((prev: any[]) => [uploaded, ...prev])
      e.target.value = ''
    } catch (err: any) {
      console.error('Upload failed:', err)
      setUploadError(err.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function handleDownload(file: any) {
    // Route through the API so it works for both backends (R2 + Supabase).
    const res = await fetch(`/api/files/${file.id}/download`)
    const json = await res.json()
    if (res.ok && json.url) window.open(json.url, '_blank')
  }

  async function handleDeleteFile(fileId: string, _filePath: string, _bucket: string) {
    try {
      // The API removes the blob from the correct backend (R2 or
      // Supabase) and deletes the metadata row in one step.
      const res = await fetch(`/api/files/${fileId}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error ?? 'Delete failed')
      }
      setFiles((prev: any[]) => prev.filter((f) => f.id !== fileId))
    } catch (err: any) {
      console.error('Delete failed:', err)
      alert(`Failed to delete file: ${err.message}`)
    }
  }

  // ── TASK HANDLERS ──
  async function addTask(e: React.FormEvent) {
    e.preventDefault()
    if (!newTaskTitle.trim() || addingTask) return
    setAddingTask(true)
    try {
      const { task } = await adminAction('add_task', {
        project_id: project.id,
        title: newTaskTitle.trim(),
        sort_order: tasks.length,
      })
      setTasks((prev: any[]) => [...prev, task])
      setNewTaskTitle('')
    } catch (err: any) {
      alert(`Failed to add task: ${err.message}`)
    } finally {
      setAddingTask(false)
    }
  }

  async function toggleTask(taskId: string, current: string) {
    const next = current === 'complete' ? 'pending' : 'complete'
    try {
      await adminAction('toggle_task', { task_id: taskId, status: next })
      setTasks((prev: any[]) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: next } : t))
      )
    } catch (err: any) {
      alert(`Failed to update task: ${err.message}`)
    }
  }

  async function deleteTask(taskId: string) {
    try {
      await adminAction('delete_task', { task_id: taskId })
      setTasks((prev: any[]) => prev.filter((t) => t.id !== taskId))
    } catch (err: any) {
      alert(`Failed to delete task: ${err.message}`)
    }
  }

  // ── SETTINGS HANDLERS ──
  async function saveSettings(e: React.FormEvent) {
    e.preventDefault()
    setSavingSettings(true)
    try {
      const { project: updated } = await adminAction('update_project', {
        project_id: project.id,
        updates: {
          title: settings.title,
          status: settings.status,
          progress: phases.length > 0 ? computedProgress : Number(settings.progress),
          brief: settings.brief || null,
          kickoff_date: settings.kickoff_date || null,
          due_date: settings.due_date || null,
          stripe_payment_url: settings.stripe_payment_url || null,
          invoice_amount: settings.invoice_amount
            ? parseFloat(settings.invoice_amount as string)
            : null,
        },
      })
      setProject(updated)
      setSettingsSaved(true)
      setTimeout(() => setSettingsSaved(false), 2500)
    } catch (err: any) {
      console.error('Failed to save settings:', err)
      alert(`Failed to save settings: ${err.message}`)
    } finally {
      setSavingSettings(false)
    }
  }

  const inputClass =
    'w-full px-4 py-3 rounded-lg text-sm outline-none transition-all'
  const inputStyle = {
    backgroundColor: 'hsl(var(--background))',
    border: '1px solid hsl(var(--border))',
    color: 'hsl(var(--foreground))',
  }
  const focusHandlers = {
    onFocus: (e: React.FocusEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >) => {
      e.target.style.borderColor = 'hsl(var(--primary))'
      e.target.style.boxShadow =
        '0 0 0 3px hsl(var(--primary) / 0.08)'
    },
    onBlur: (e: React.FocusEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >) => {
      e.target.style.borderColor = 'hsl(var(--border))'
      e.target.style.boxShadow = 'none'
    },
  }

  const deliveryFiles = files.filter(
    (f: any) => f.direction === 'delivery'
  )
  const clientFiles = files.filter(
    (f: any) => f.direction === 'client-upload'
  )

  return (
    <div className="space-y-6 w-full">
      {/* Back + Header */}
      <div>
        <Link
          href={`/admin/clients/${client.id}`}
          className="inline-flex items-center gap-2 text-sm 
          mb-4 transition-colors"
          style={{ color: 'hsl(var(--muted-foreground))' }}
        >
          <ArrowLeft size={14} />
          {client.name}
        </Link>

        <div className="flex items-start justify-between 
          gap-4 flex-wrap">
          <div>
            <h1
              className="font-display text-2xl font-bold"
              style={{ color: 'hsl(var(--foreground))' }}
            >
              {project.title}
            </h1>
            <div className="flex items-center gap-3 mt-2 
              flex-wrap">
              <StatusBadge status={project.status} />
              <span
                className="text-xs px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: 'hsl(var(--border))',
                  color: 'hsl(var(--muted-foreground))',
                }}
              >
                {project.type}
              </span>
              <span className="text-xs"
                style={{ color: 'hsl(var(--text-faint))' }}>
                {client.company
                  ? `${client.name} · ${client.company}`
                  : client.name}
              </span>
            </div>
          </div>
          <div className="text-right">
            <div
              className="font-display text-3xl font-bold"
              style={{ color: 'hsl(var(--primary))' }}
            >
              {computedProgress}%
            </div>
            <div className="text-xs mt-0.5"
              style={{ color: 'hsl(var(--muted-foreground))' }}>
              complete
            </div>
          </div>
        </div>

        <ProgressBar value={computedProgress} className="mt-4" />
      </div>

      {/* Tabs */}
      <div
        className="flex gap-1 p-1 rounded-xl w-fit max-w-full
        overflow-x-auto scrollbar-none"
        style={{
          backgroundColor: 'hsl(var(--card))',
          border: '1px solid hsl(var(--border))',
        }}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          // Live unread-notification count for this tab (clears when opened).
          const badge =
            tab.id === 'files'
              ? tabBadge('file_delivered')
              : tab.id === 'messages'
              ? tabBadge('message')
              : tab.id === 'tasks'
              ? tabBadge('task_updated')
              : tab.id === 'invoices'
              ? tabBadge('invoice_created')
              : 0
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="relative flex flex-shrink-0 items-center gap-2 px-4 py-2
              rounded-lg text-sm font-medium transition-all
              whitespace-nowrap"
              style={{
                backgroundColor: isActive
                  ? 'hsl(var(--border))'
                  : 'transparent',
                color: isActive ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))',
              }}
            >
              <Icon size={14} />
              {tab.label}
              {badge > 0 && (
                <span
                  className="ml-0.5 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold flex items-center justify-center"
                  style={{ backgroundColor: 'hsl(var(--status-amber))', color: 'hsl(var(--primary-foreground))' }}
                >
                  {badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {activeTab === 'overview' && (
        <div className="space-y-5">
          {project.brief && (
            <div
              className="p-5 rounded-xl"
              style={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
              }}
            >
              <h3
                className="text-xs font-semibold uppercase 
                tracking-widest mb-3"
                style={{ color: 'hsl(var(--text-faint))' }}
              >
                Project Brief
              </h3>
              <p className="text-sm leading-relaxed"
                style={{ color: 'hsl(var(--muted-foreground))' }}>
                {project.brief}
              </p>
            </div>
          )}

          <div
            className="p-5 rounded-xl"
            style={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
            }}
          >
            <h3
              className="text-xs font-semibold uppercase 
              tracking-widest mb-5"
              style={{ color: 'hsl(var(--text-faint))' }}
            >
              Production Phases — drag sliders to update
            </h3>
            <div className="space-y-6">
              {phases.map((phase: any, i: number) => (
                <div key={phase.id}>
                  <div className="flex items-center 
                    justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          updatePhaseProgress(
                            phase.id,
                            phase.is_complete ? 0 : 100
                          )
                        }
                        className="w-5 h-5 rounded-full flex 
                        items-center justify-center transition-all
                        flex-shrink-0"
                        style={{
                          backgroundColor: phase.is_complete
                            ? 'hsl(var(--status-green) / 0.2)'
                            : 'transparent',
                          border: phase.is_complete
                            ? 'none'
                            : '2px solid hsl(var(--border))',
                        }}
                      >
                        {phase.is_complete && (
                          <Check size={10}
                            style={{ color: 'hsl(var(--status-green))' }} />
                        )}
                      </button>
                      <span
                        className="text-sm font-medium"
                        style={{
                          color: phase.is_complete
                            ? 'hsl(var(--status-green))'
                            : 'hsl(var(--foreground))',
                        }}
                      >
                        {phase.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {savingPhase === phase.id && (
                        <Loader2
                          size={12}
                          className="animate-spin"
                          style={{ color: 'hsl(var(--text-faint))' }}
                        />
                      )}
                      <span
                        className="text-xs font-semibold w-8 
                        text-right tabular-nums"
                        style={{
                          color: phase.is_complete
                            ? 'hsl(var(--status-green))'
                            : 'hsl(var(--primary))',
                        }}
                      >
                        {phase.progress}%
                      </span>
                      <button
                        type="button"
                        onClick={() => deletePhase(phase.id)}
                        className="p-1 rounded-md transition-colors"
                        style={{ color: 'hsl(var(--text-faint))' }}
                        title="Remove phase"
                        onMouseEnter={(e) => { e.currentTarget.style.color = 'hsl(var(--destructive))' }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = 'hsl(var(--text-faint))' }}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                  {phase.description && (
                    <p className="ml-7 mt-0.5 mb-1.5 text-[11px] leading-snug"
                      style={{ color: 'hsl(var(--text-faint))' }}>
                      {phase.description}
                    </p>
                  )}
                  <div className="ml-7">
                    <ProgressSlider
                      value={phase.progress}
                      onChange={(v) => updatePhaseProgress(phase.id, v)}
                      accentColor={phaseColor(i)}
                      showLabel={false}
                    />
                  </div>
                </div>
              ))}

              {/* Add a production phase */}
              <form onSubmit={addPhase} className="flex items-center gap-2 pt-2">
                <input
                  value={newPhaseName}
                  onChange={(e) => setNewPhaseName(e.target.value)}
                  placeholder="Add a production phase…"
                  className="flex-1 px-3 py-2 rounded-lg text-sm outline-none transition-colors"
                  style={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                />
                <button
                  type="submit"
                  disabled={phaseBusy || !newPhaseName.trim()}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-50"
                  style={{ backgroundColor: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
                >
                  <Plus size={13} /> Add
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── FILES TAB ── */}
      {activeTab === 'files' && (
        <div className="space-y-6">
          <FileVault
            studioName={studioName}
            projectId={project.id}
            clientId={project.client_id}
            userId="admin"
            userRole="admin"
            userName={`${studioName} Admin`}
            initialFiles={files as any}
          />
        </div>
      )}

      {/* ── MESSAGES TAB ── */}
      {activeTab === 'messages' && (
        <div
          className="rounded-xl overflow-hidden flex flex-col"
          style={{
            backgroundColor: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            height: 'calc(100vh - 340px)',
            minHeight: '480px',
          }}
        >
          {/* Messages header */}
          <div
            className="px-5 py-4 flex-shrink-0 flex items-center justify-between"
            style={{ borderBottom: '1px solid hsl(var(--border))' }}
          >
            <div>
              <h3
                className="text-sm font-semibold"
                style={{ color: 'hsl(var(--foreground))' }}
              >
                Project Messages
              </h3>
              <div className="flex items-center gap-2 mt-0.5">
                <div
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: clientOnline ? 'hsl(var(--status-green))' : 'hsl(var(--text-faint))' }}
                />
                <p
                  className="text-xs"
                  style={{ color: clientOnline ? 'hsl(var(--status-green))' : 'hsl(var(--text-faint))' }}
                >
                  {clientOnline ? 'Online' : 'Away'}
                </p>
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 relative">
            <RoomThread
              role="admin"
              clientId={client.id}
              orgId={client.organization_id}
              filter={{ kind: 'project', projectId: project.id }}
              currentName={studioName}
              otherName={client.name}
              selfFallback
              onTypingChange={(k) => setClientTyping(k !== null)}
            />
            {/* Typing indicator overlay */}
            {clientTyping && (
              <div className="absolute bottom-20 left-5 flex gap-3 pointer-events-none z-10">
                <div
                  className="w-7 h-7 rounded-full flex items-center
                  justify-center text-xs font-bold flex-shrink-0"
                  style={{ backgroundColor: 'hsl(var(--primary) / 0.15)', color: 'hsl(var(--primary))',
                    border: '1px solid hsl(var(--primary) / 0.25)' }}
                >
                  {client.name[0].toUpperCase()}
                </div>
                <div
                  className="px-4 py-3 flex items-center gap-1"
                  style={{ backgroundColor: 'hsl(var(--secondary))', borderRadius: '18px 18px 18px 4px',
                    border: '1px solid rgba(15,30,51,0.9)' }}
                >
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="w-1.5 h-1.5 rounded-full animate-bounce"
                      style={{ backgroundColor: 'hsl(var(--primary))', animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TASKS TAB ── */}
      {activeTab === 'tasks' && (
        <TaskBoard
          studioName={studioName}
          projectId={project.id}
          clientId={client.id}
          initialTasks={(tasks ?? []) as any}
          phases={phases}
          userRole="admin"
          involvement={involvement}
        />
      )}

      {/* ── INVOICES TAB ── */}
      {activeTab === 'invoices' && (
        <AdminInvoicesTab
          projectId={project.id}
          clientId={client.id}
          projectTitle={project.title}
        />
      )}

      {/* ── SETTINGS TAB ── */}
      {activeTab === 'settings' && (
        <div
          className="p-6 rounded-xl"
          style={{
            backgroundColor: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
          }}
        >
          <h3
            className="font-display text-base font-semibold mb-6"
            style={{ color: 'hsl(var(--foreground))' }}
          >
            Project Settings
          </h3>
          <form
            onSubmit={saveSettings}
            className="space-y-5"
          >
            <div>
              <label
                className="block text-xs font-semibold 
                uppercase tracking-wider mb-2"
                style={{ color: 'hsl(var(--muted-foreground))' }}
              >
                Project Title
              </label>
              <input
                type="text"
                value={settings.title}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    title: e.target.value,
                  })
                }
                className={inputClass}
                style={inputStyle}
                {...focusHandlers}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  className="block text-xs font-semibold 
                  uppercase tracking-wider mb-2"
                  style={{ color: 'hsl(var(--muted-foreground))' }}
                >
                  Status
                </label>
                <select
                  value={settings.status}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      status: e.target.value,
                    })
                  }
                  className={inputClass}
                  style={inputStyle}
                  {...focusHandlers}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}
                      style={{ backgroundColor: 'hsl(var(--card))' }}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  className="block text-xs font-semibold 
                  uppercase tracking-wider mb-2"
                  style={{ color: 'hsl(var(--muted-foreground))' }}
                >
                  Overall Progress (%)
                </label>
                {phases.length > 0 ? (
                  <div className="pt-1">
                    <ProgressBar value={computedProgress} showLabel />
                    <p
                      className="text-xs mt-2"
                      style={{ color: 'hsl(var(--muted-foreground))' }}
                    >
                      Auto-calculated from phase progress.
                    </p>
                  </div>
                ) : (
                  <div className="pt-1">
                    <ProgressSlider
                      value={Number(settings.progress) || 0}
                      onChange={(v) =>
                        setSettings({ ...settings, progress: String(v) })
                      }
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  className="block text-xs font-semibold 
                  uppercase tracking-wider mb-2"
                  style={{ color: 'hsl(var(--muted-foreground))' }}
                >
                  Kickoff Date
                </label>
                <input
                  type="date"
                  value={settings.kickoff_date}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      kickoff_date: e.target.value,
                    })
                  }
                  className={inputClass}
                  style={{
                    ...inputStyle,
                  }}
                  {...focusHandlers}
                />
              </div>
              <div>
                <label
                  className="block text-xs font-semibold 
                  uppercase tracking-wider mb-2"
                  style={{ color: 'hsl(var(--muted-foreground))' }}
                >
                  Delivery Date
                </label>
                <input
                  type="date"
                  value={settings.due_date}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      due_date: e.target.value,
                    })
                  }
                  className={inputClass}
                  style={{
                    ...inputStyle,
                  }}
                  {...focusHandlers}
                />
              </div>
            </div>

            <div>
              <label
                className="block text-xs font-semibold 
                uppercase tracking-wider mb-2"
                style={{ color: 'hsl(var(--muted-foreground))' }}
              >
                Project Brief
              </label>
              <textarea
                rows={4}
                value={settings.brief}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    brief: e.target.value,
                  })
                }
                className="w-full px-4 py-3 rounded-lg text-sm 
                outline-none transition-all resize-none"
                style={inputStyle}
                {...focusHandlers}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  className="block text-xs font-semibold 
                  uppercase tracking-wider mb-2"
                  style={{ color: 'hsl(var(--muted-foreground))' }}
                >
                  Invoice Amount ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={settings.invoice_amount}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      invoice_amount: e.target.value,
                    })
                  }
                  placeholder="5000.00"
                  className={inputClass}
                  style={inputStyle}
                  {...focusHandlers}
                />
              </div>
              <div>
                <label
                  className="block text-xs font-semibold 
                  uppercase tracking-wider mb-2"
                  style={{ color: 'hsl(var(--muted-foreground))' }}
                >
                  Stripe Payment URL
                </label>
                <input
                  type="url"
                  value={settings.stripe_payment_url}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      stripe_payment_url: e.target.value,
                    })
                  }
                  placeholder="https://buy.stripe.com/..."
                  className={inputClass}
                  style={inputStyle}
                  {...focusHandlers}
                />
              </div>
            </div>

            <div className="flex items-center gap-4 pt-2">
              <button
                type="submit"
                disabled={savingSettings}
                className="flex items-center gap-2 px-6 py-3 
                rounded-lg text-sm font-semibold transition-all 
                disabled:opacity-60"
                style={{
                  backgroundColor: 'hsl(var(--primary))',
                  color: 'hsl(var(--primary-foreground))',
                }}
              >
                {savingSettings ? (
                  <Loader2 size={14}
                    className="animate-spin" />
                ) : (
                  <Save size={14} />
                )}
                {savingSettings ? 'Saving...' : 'Save Changes'}
              </button>
              {settingsSaved && (
                <div className="flex items-center gap-2">
                  <Check size={14}
                    style={{ color: 'hsl(var(--status-green))' }} />
                  <span className="text-sm"
                    style={{ color: 'hsl(var(--status-green))' }}>
                    Saved successfully
                  </span>
                </div>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
