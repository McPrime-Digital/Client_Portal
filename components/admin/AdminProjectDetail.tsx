'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import StatusBadge from '@/components/portal/StatusBadge'
import AdminInvoicesTab from '@/components/admin/AdminInvoicesTab'
import MessageThread from '@/components/shared/MessageThread'
import TaskBoard from '@/components/shared/TaskBoard'
import type { Message } from '@/lib/types/database'
import { logActivity } from '@/lib/logActivity'
import { uploadFileToR2 } from '@/lib/uploadClient'
import ProgressBar from '@/components/shared/ProgressBar'
import ProgressSlider from '@/components/shared/ProgressSlider'
import { computeProjectProgress } from '@/lib/projectProgress'
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
  initialMessages,
}: any) {
  const router = useRouter()
  const supabase = createClient()

  const [activeTab, setActiveTab] = useState('overview')
  const [project, setProject] = useState(initialProject)
  const [phases, setPhases] = useState(initialPhases)
  const [tasks, setTasks] = useState(initialTasks)
  const [files, setFiles] = useState(initialFiles)
  const [messages, setMessages] = useState(initialMessages)

  // Overview state
  const [savingPhase, setSavingPhase] = useState<string | null>(
    null
  )

  // Files state
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Messages state
  const [newMessage, setNewMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  // Typing & presence state
  const [clientTyping, setClientTyping] = useState(false)
  const [clientOnline, setClientOnline] = useState(false)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typingBroadcastRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const refreshMessages = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      const res = await fetch(
        `/api/admin/messages?project_id=${project.id}`
      )
      const json = await res.json()
      if (res.ok && json.messages) {
        setMessages(json.messages)
      }
    } catch (err) {
      console.error('Failed to refresh messages:', err)
    } finally {
      setRefreshing(false)
    }
  }, [project.id, refreshing])

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

  // Mark client messages as read when messages tab opens
  useEffect(() => {
    if (activeTab === 'messages') {
      fetch('/api/admin/messages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: project.id }),
      }).catch(() => {})
      setMessages((prev: any[]) =>
        prev.map((m: any) =>
          m.sender_role === 'client' && !m.read_at
            ? { ...m, read_at: new Date().toISOString() }
            : m
        )
      )
    }
  }, [activeTab, project.id])

  // Realtime messages — INSERT + UPDATE (read receipts)
  useEffect(() => {
    const channel = supabase
      .channel(`admin-messages:${project.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `project_id=eq.${project.id}`,
      }, (payload) => {
        setMessages((prev: any[]) => {
          if (prev.some((m) => m.id === payload.new.id)) return prev
          return [...prev, payload.new]
        })
        // Acknowledge delivery of incoming client messages.
        if (payload.new.sender_role === 'client') {
          fetch('/api/admin/messages', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project_id: project.id, mode: 'delivered' }),
          }).catch(() => {})
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'messages',
        filter: `project_id=eq.${project.id}`,
      }, (payload) => {
        setMessages((prev: any[]) =>
          prev.map((m) => m.id === payload.new.id ? { ...m, ...payload.new } : m)
        )
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [project.id])

  // Acknowledge delivery of any already-loaded client messages on mount.
  useEffect(() => {
    fetch('/api/admin/messages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: project.id, mode: 'delivered' }),
    }).catch(() => {})
  }, [project.id])

  // Typing indicator — listen for client typing broadcasts
  useEffect(() => {
    const ch = supabase
      .channel(`typing:${project.id}`)
      .on('broadcast', { event: 'typing' }, (payload) => {
        if (payload.payload?.role === 'client') {
          setClientTyping(true)
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
          typingTimeoutRef.current = setTimeout(() => setClientTyping(false), 3000)
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [project.id])

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

  // Broadcast typing when admin types
  function handleAdminTyping() {
    if (typingBroadcastRef.current) return
    supabase.channel(`typing:${project.id}`).send({
      type: 'broadcast',
      event: 'typing',
      payload: { role: 'admin' },
    })
    typingBroadcastRef.current = setTimeout(() => {
      typingBroadcastRef.current = null
    }, 2000)
  }

  // Polling fallback — every 10s, detect new messages AND read_at changes
  useEffect(() => {
    const interval = setInterval(() => {
      fetch(`/api/admin/messages?project_id=${project.id}`)
        .then((r) => r.json())
        .then((json) => {
          if (!json.messages) return
          setMessages((prev: any[]) => {
            const incoming = json.messages
            // Update if count changed OR any read_at changed
            const hasChanges =
              incoming.length !== prev.length ||
              incoming.some((m: any, i: number) => m.read_at !== prev[i]?.read_at)
            return hasChanges ? incoming : prev
          })
        })
        .catch(() => {})
    }, 10_000)
    return () => clearInterval(interval)
  }, [project.id])

  useEffect(() => {
    if (activeTab === 'messages') {
      messagesEndRef.current?.scrollIntoView({
        behavior: 'smooth',
      })
    }
  }, [messages, activeTab])

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
    try {
      const { phase } = await adminAction('update_phase', {
        phase_id: phaseId,
        progress,
      })
      setPhases((prev: any[]) =>
        prev.map((p) => (p.id === phaseId ? phase : p))
      )
    } catch (err: any) {
      console.error('Failed to update phase:', err)
      alert(`Failed to update phase: ${err.message}`)
    } finally {
      setSavingPhase(null)
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

  // ── MESSAGE HANDLERS ──
  async function sendMessage(body: string, replyToId?: string, attachmentUrl?: string, attachmentName?: string) {
    if (!body.trim() && !attachmentUrl) return
    setSending(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      const optimistic: Message = {
        id: `temp-${Date.now()}`,
        project_id: project.id,
        sender_id: user!.id,
        sender_role: 'admin',
        sender_name: 'McPrime Digital',
        body: body.trim(),
        read_at: null,
        delivered_at: null,
        reply_to_id: replyToId || null,
        attachment_url: attachmentUrl || null,
        attachment_name: attachmentName || null,
        is_deleted: false,
        edited_at: null,
        created_at: new Date().toISOString(),
      }

      setMessages((prev: any[]) => [...prev, optimistic])

      const { message } = await adminAction('send_message', {
        project_id: project.id,
        body: body.trim(),
        reply_to_id: replyToId || null,
        attachment_url: attachmentUrl || null,
        attachment_name: attachmentName || null,
      })
      
      setMessages((prev: any[]) =>
        prev.map((m) =>
          m.id === optimistic.id ? message : m
        )
      )

      // Log activity — fire-and-forget
      logActivity({
        projectId: project.id,
        actorId: user!.id,
        actorName: 'McPrime Digital',
        actorRole: 'admin',
        eventType: 'message_sent',
        title: 'McPrime Digital sent a message',
        body: body.slice(0, 80),
        meta: { project_id: project.id },
      }).catch(() => {})
    } catch (err: any) {
      console.error('Failed to send message:', err)
      alert(`Failed to send message: ${err.message}`)
    } finally {
      setSending(false)
    }
  }

  async function handleAttachmentUpload(file: File): Promise<{ url: string; name: string }> {
    const uploaded = await uploadFileToR2({
      file,
      projectId: project.id,
      direction: 'delivery',
      category: 'message',
    })

    return {
      url: `${uploaded.bucket}::${uploaded.file_path}`,
      name: uploaded.file_name,
    }
  }

  async function handleDeleteMessage(messageId: string) {
    const res = await fetch('/api/portal/messages/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id: messageId }),
    })
    if (!res.ok) {
      const json = await res.json()
      throw new Error(json.error || 'Delete failed')
    }
    setMessages((prev: any[]) => prev.map((m: any) => m.id === messageId ? { ...m, is_deleted: true, body: '', attachment_url: null, attachment_name: null } : m))
  }

  async function handleEditMessage(messageId: string, newBody: string) {
    const res = await fetch('/api/portal/messages/edit', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id: messageId, body: newBody }),
    })
    const json = await res.json()
    if (!res.ok) {
      alert(json.error || 'Edit failed')
      throw new Error(json.error || 'Edit failed')
    }
    setMessages((prev: any[]) => prev.map((m: any) => m.id === messageId ? { ...m, body: newBody, edited_at: new Date().toISOString() } : m))
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
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex flex-shrink-0 items-center gap-2 px-4 py-2
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
              {phases.map((phase: any) => (
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
                      showLabel={false}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── FILES TAB ── */}
      {activeTab === 'files' && (
        <div className="space-y-6">
          <FileVault
            projectId={project.id}
            clientId={project.client_id}
            userId="admin"
            userRole="admin"
            userName="McPrime Admin"
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
            <button
              onClick={refreshMessages}
              disabled={refreshing}
              title="Refresh messages"
              className="p-2 rounded-lg transition-all disabled:opacity-50"
              style={{ color: 'hsl(var(--text-faint))' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'hsl(var(--primary))'
                e.currentTarget.style.backgroundColor = 'hsl(var(--border))'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'hsl(var(--text-faint))'
                e.currentTarget.style.backgroundColor = 'transparent'
              }}
            >
              <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="flex-1 min-h-0 relative">
            <MessageThread
              messages={messages}
              currentRole="admin"
              currentName="McPrime Digital"
              otherName={client.name}
              projectId={project.id}
              onSendMessage={sendMessage}
              onUploadAttachment={handleAttachmentUpload}
              onDeleteMessage={handleDeleteMessage}
              onEditMessage={handleEditMessage}
              onTyping={handleAdminTyping}
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
          projectId={project.id}
          initialTasks={tasks ?? []}
          userRole="admin"
          onProgressUpdate={(pct) => {
            console.log('Progress:', pct + '%')
          }}
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
                    colorScheme: 'dark',
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
                    colorScheme: 'dark',
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
