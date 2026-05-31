'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import StatusBadge from './StatusBadge'
import { createClient } from '@/lib/supabase/client'
import type {
  Project,
  ProjectPhase,
  Task,
  FileRecord,
  Message,
  Client,
} from '@/lib/types/database'
import MessageThread from '@/components/shared/MessageThread'
import TaskBoard from '@/components/shared/TaskBoard'
import { logActivity } from '@/lib/logActivity'
import { uploadFileToR2 } from '@/lib/uploadClient'
import ProgressBar from '@/components/shared/ProgressBar'
import { computeProjectProgress, phaseColor } from '@/lib/projectProgress'
import {
  ArrowLeft,
  Clock,
  CheckSquare,
  Files,
  MessageSquare,
  LayoutDashboard,
  Download,
  Upload,
  Send,
  Check,
  CheckCheck,
  FileVideo,
  FileImage,
  FileText,
  File,
  Loader2,
  RefreshCw,
  Circle,
} from 'lucide-react'
import FileVault from '@/components/shared/FileVault'

type Props = {
  project: Project
  phases: ProjectPhase[]
  tasks: Task[]
  files: FileRecord[]
  initialMessages: Message[]
  client: Client
}

function getFileIcon(fileType: string | null) {
  if (!fileType) return File
  if (fileType.startsWith('video/')) return FileVideo
  if (fileType.startsWith('image/')) return FileImage
  if (
    fileType.includes('pdf') ||
    fileType.includes('document') ||
    fileType.includes('text')
  )
    return FileText
  return File
}

function formatBytes(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function timeAgo(date: string) {
  const seconds = Math.floor(
    (Date.now() - new Date(date).getTime()) / 1000
  )
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

const tabs = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'files', label: 'Files', icon: Files },
  { id: 'messages', label: 'Messages', icon: MessageSquare },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare },
]

export default function ProjectDetail({
  project,
  phases: initialPhases,
  tasks,
  files,
  initialMessages,
  client,
}: Props) {
  const [activeTab, setActiveTab] = useState('overview')
  const [phases, setPhases] = useState<ProjectPhase[]>(initialPhases)
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [fileList, setFileList] = useState<FileRecord[]>(files)
  const [refreshing, setRefreshing] = useState(false)
  // Typing & presence state
  const [adminTyping, setAdminTyping] = useState(false)
  const [adminOnline, setAdminOnline] = useState(false)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typingBroadcastRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const clientUploadRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()

  const refreshMessages = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      const res = await fetch(
        `/api/portal/messages?project_id=${project.id}`
      )
      const json = await res.json()
      if (res.ok && json.messages) {
        setMessages(json.messages as Message[])
      }
    } catch (err) {
      console.error('Failed to refresh messages:', err)
    } finally {
      setRefreshing(false)
    }
  }, [project.id, refreshing])

  // Mark admin messages as read when messages tab is active
  useEffect(() => {
    if (activeTab === 'messages') {
      fetch('/api/portal/messages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: project.id }),
      }).catch(() => {})
      // Update local state so read receipts show immediately
      setMessages((prev) =>
        prev.map((m) =>
          m.sender_role === 'admin' && !m.read_at
            ? { ...m, read_at: new Date().toISOString() }
            : m
        )
      )
    }
  }, [activeTab, project.id])

  // Single source of truth — same helper the admin + lists use.
  const computedProgress = computeProjectProgress(phases, project.progress)

  // Realtime messages subscription — instant delivery when replication is enabled
  useEffect(() => {
    const channel = supabase
      .channel(`messages:${project.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `project_id=eq.${project.id}`,
        },
        (payload) => {
          setMessages((prev) => {
            if (prev.some((m) => m.id === (payload.new as Message).id)) return prev
            return [...prev, payload.new as Message]
          })
          // Acknowledge delivery of incoming admin messages.
          if ((payload.new as Message).sender_role === 'admin') {
            fetch('/api/portal/messages', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ project_id: project.id, mode: 'delivered' }),
            }).catch(() => {})
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `project_id=eq.${project.id}`,
        },
        (payload) => {
          setMessages((prev) =>
            prev.map((m) => m.id === payload.new.id ? { ...m, ...payload.new as Message } : m)
          )
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [project.id])

  // Acknowledge delivery of any already-loaded admin messages on mount.
  useEffect(() => {
    fetch('/api/portal/messages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: project.id, mode: 'delivered' }),
    }).catch(() => {})
  }, [project.id])

  // Typing indicator — subscribe to broadcast events from admin
  useEffect(() => {
    const ch = supabase
      .channel(`typing:${project.id}`)
      .on('broadcast', { event: 'typing' }, (payload) => {
        if (payload.payload?.role === 'admin') {
          setAdminTyping(true)
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
          typingTimeoutRef.current = setTimeout(() => setAdminTyping(false), 3000)
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [project.id])

  // Presence — track admin online status
  useEffect(() => {
    const ch = supabase.channel(`presence:${project.id}`, {
      config: { presence: { key: `client-${client.id}` } },
    })
    ch
      .on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState()
        const adminPresent = Object.values(state).some((presences: any) =>
          presences.some((p: any) => p.role === 'admin')
        )
        setAdminOnline(adminPresent)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await ch.track({ role: 'client', id: client.id })
        }
      })
    return () => { supabase.removeChannel(ch) }
  }, [project.id, client.id])

  // Broadcast typing when client types
  function handleTyping() {
    if (typingBroadcastRef.current) return
    supabase.channel(`typing:${project.id}`).send({
      type: 'broadcast',
      event: 'typing',
      payload: { role: 'client' },
    })
    typingBroadcastRef.current = setTimeout(() => {
      typingBroadcastRef.current = null
    }, 2000)
  }

  // Polling fallback — every 10s, detect new messages AND read_at changes
  useEffect(() => {
    const interval = setInterval(() => {
      fetch(`/api/portal/messages?project_id=${project.id}`)
        .then((r) => r.json())
        .then((json) => {
          if (!json.messages) return
          setMessages((prev) => {
            const incoming: Message[] = json.messages
            // Update if count changed OR any read_at changed
            const hasChanges =
              incoming.length !== prev.length ||
              incoming.some((m, i) => m.read_at !== prev[i]?.read_at)
            return hasChanges ? incoming : prev
          })
          // If messages tab is active, mark admin messages as read
          // (covers new messages arriving while tab is already open)
        })
        .catch(() => {})
    }, 10_000)
    return () => clearInterval(interval)
  }, [project.id])

  // Realtime phases subscription — drives live progress bar
  useEffect(() => {
    const channel = supabase
      .channel(`phases:${project.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'project_phases',
          filter: `project_id=eq.${project.id}`,
        },
        (payload) => {
          setPhases((prev) =>
            prev.map((p) =>
              p.id === payload.new.id
                ? { ...p, ...(payload.new as ProjectPhase) }
                : p
            )
          )
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [project.id])

  // Auto scroll messages
  useEffect(() => {
    if (activeTab === 'messages') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, activeTab])

  async function sendMessage(body: string, replyToId?: string, attachmentUrl?: string, attachmentName?: string) {
    // Optimistic insert — show the message instantly, then reconcile.
    const optimistic: Message = {
      id: `temp-${Date.now()}`,
      project_id: project.id,
      sender_id: client.user_id ?? client.id,
      sender_role: 'client',
      sender_name: client.name,
      body,
      read_at: null,
      delivered_at: null,
      reply_to_id: replyToId || null,
      attachment_url: attachmentUrl || null,
      attachment_name: attachmentName || null,
      is_deleted: false,
      edited_at: null,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimistic])

    try {
      const res = await fetch('/api/portal/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send_message',
          project_id: project.id,
          body,
          reply_to_id: replyToId,
          attachment_url: attachmentUrl,
          attachment_name: attachmentName,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      // Replace the optimistic placeholder with the persisted row.
      if (json.message) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === json.message.id)) {
            return prev.filter((m) => m.id !== optimistic.id)
          }
          return prev.map((m) => (m.id === optimistic.id ? json.message : m))
        })
      }

      // Log activity — fire-and-forget, never blocks message delivery
      logActivity({
        projectId: project.id,
        clientId: client.id,
        actorId: client.user_id ?? client.id,
        actorName: client.name,
        actorRole: 'client',
        eventType: 'message_sent',
        title: `${client.name} sent a message`,
        body: body.slice(0, 80),
        meta: { project_id: project.id },
      }).catch(() => {})
    } catch (err: any) {
      console.error('Failed to send message:', err)
      // Roll back the optimistic placeholder so it doesn't linger.
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
      throw err
    }
  }

  async function handleAttachmentUpload(file: File): Promise<{ url: string; name: string }> {
    const uploaded = await uploadFileToR2({
      file,
      projectId: project.id,
      direction: 'client-upload',
      category: 'message',
    })

    // Also add to fileList so it appears in the Files tab!
    setFileList((prev) => [uploaded as any, ...prev])

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
    // Soft delete locally
    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, is_deleted: true, body: '', attachment_url: null, attachment_name: null } : m))
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
    // Update locally
    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, body: newBody, edited_at: new Date().toISOString() } : m))
  }

  async function handleFileUpload(
    e: React.ChangeEvent<HTMLInputElement>,
    direction: 'delivery' | 'client-upload'
  ) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadError('')
    try {
      const uploaded = await uploadFileToR2({
        file,
        projectId: project.id,
        direction,
      })

      setFileList((prev) => [uploaded as any, ...prev])
      e.target.value = ''
    } catch (err: any) {
      console.error('Upload failed:', err)
      setUploadError(err.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function handleDownload(file: FileRecord) {
    // Route through the API so it works for both backends (R2 + Supabase).
    const res = await fetch(`/api/files/${file.id}/download`)
    const json = await res.json()
    if (res.ok && json.url) {
      window.open(json.url, '_blank')
    }
  }

  const deliveryFiles = fileList.filter(
    (f) => f.direction === 'delivery'
  )
  const clientFiles = fileList.filter(
    (f) => f.direction === 'client-upload'
  )

  return (
    <div className="w-full space-y-6">
      {/* Back + Header */}
      <div>
        <Link
          href="/projects"
          className="inline-flex items-center gap-2 text-sm 
          mb-4 transition-colors"
          style={{ color: 'hsl(var(--muted-foreground))' }}
        >
          <ArrowLeft size={14} />
          All Projects
        </Link>
        <div className="flex items-start justify-between gap-4 
          flex-wrap">
          <div>
            <h1
              className="font-display text-2xl font-bold"
              style={{ color: 'hsl(var(--foreground))' }}
            >
              {project.title}
            </h1>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
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
              {project.due_date && (
                <div className="flex items-center gap-1.5">
                  <Clock size={12} style={{ color: 'hsl(var(--text-faint))' }} />
                  <span className="text-xs"
                    style={{ color: 'hsl(var(--muted-foreground))' }}>
                    Due{' '}
                    {new Date(project.due_date).toLocaleDateString(
                      'en-US',
                      {
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric',
                      }
                    )}
                  </span>
                </div>
              )}
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

        {/* Overall progress bar */}
        <ProgressBar value={computedProgress} className="mt-4" />
      </div>

      {/* Tabs */}
      <div
        className="flex gap-1 p-1 rounded-xl w-fit max-w-full overflow-x-auto scrollbar-none"
        style={{ backgroundColor: 'hsl(var(--card))',
          border: '1px solid hsl(var(--border))' }}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          const badge =
            tab.id === 'tasks'
              ? (tasks ?? []).filter(
                  (t: any) =>
                    t.visible_to_client &&
                    t.status === 'review' &&
                    t.approval_status !== 'approved' &&
                    !t.approved_at
                ).length
              : 0
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="relative flex flex-shrink-0 whitespace-nowrap items-center gap-2 px-4 py-2
              rounded-lg text-sm font-medium transition-all"
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
                  style={{ backgroundColor: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
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
        <div className="space-y-6">
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

          {phases.length > 0 && (
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
                Production Phases
              </h3>
              <div className="space-y-5">
                {phases.map((phase, i) => (
                  <div key={phase.id}>
                    <div className="flex items-center 
                      justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {phase.is_complete ? (
                          <div
                            className="w-5 h-5 rounded-full flex 
                            items-center justify-center"
                            style={{
                              backgroundColor:
                                'hsl(var(--status-green) / 0.15)',
                            }}
                          >
                            <Check size={10}
                              style={{ color: 'hsl(var(--status-green))' }} />
                          </div>
                        ) : (
                          <div
                            className="w-5 h-5 rounded-full 
                            border-2"
                            style={{ borderColor: 'hsl(var(--border))' }}
                          />
                        )}
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
                      <span
                        className="text-xs font-semibold"
                        style={{
                          color: phase.is_complete
                            ? 'hsl(var(--status-green))'
                            : 'hsl(var(--primary))',
                        }}
                      >
                        {phase.progress}%
                      </span>
                    </div>
                    {phase.description && (
                      <p className="ml-7 mt-0.5 mb-1.5 text-[11px] leading-snug"
                        style={{ color: 'hsl(var(--text-faint))' }}>
                        {phase.description}
                      </p>
                    )}
                    <ProgressBar value={phase.progress} size="sm" accentColor={phaseColor(i)} className="ml-7" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Key dates */}
          {(project.kickoff_date || project.due_date) && (
            <div
              className="p-5 rounded-xl"
              style={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
              }}
            >
              <h3
                className="text-xs font-semibold uppercase 
                tracking-widest mb-4"
                style={{ color: 'hsl(var(--text-faint))' }}
              >
                Key Dates
              </h3>
              <div className="grid grid-cols-2 gap-4">
                {project.kickoff_date && (
                  <div>
                    <p className="text-xs mb-1"
                      style={{ color: 'hsl(var(--muted-foreground))' }}>
                      Kickoff
                    </p>
                    <p className="text-sm font-semibold"
                      style={{ color: 'hsl(var(--foreground))' }}>
                      {new Date(
                        project.kickoff_date
                      ).toLocaleDateString('en-US', {
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                )}
                {project.due_date && (
                  <div>
                    <p className="text-xs mb-1"
                      style={{ color: 'hsl(var(--muted-foreground))' }}>
                      Delivery
                    </p>
                    <p className="text-sm font-semibold"
                      style={{ color: 'hsl(var(--foreground))' }}>
                      {new Date(
                        project.due_date
                      ).toLocaleDateString('en-US', {
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── FILES TAB ── */}
      {activeTab === 'files' && (
        <div className="space-y-6">
          <FileVault
            projectId={project.id}
            clientId={client.id}
            userId={client.id}
            userRole="client"
            userName={client.name}
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
                  style={{ backgroundColor: adminOnline ? 'hsl(var(--status-green))' : 'hsl(var(--text-faint))' }}
                />
                <p
                  className="text-xs"
                  style={{ color: adminOnline ? 'hsl(var(--status-green))' : 'hsl(var(--text-faint))' }}
                >
                  {adminOnline ? 'Online' : 'Away'}
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
              <RefreshCw
                size={15}
                className={refreshing ? 'animate-spin' : ''}
              />
            </button>
          </div>

          <div className="flex-1 min-h-0 relative">
            <MessageThread
              messages={messages}
              currentRole="client"
              currentName={client.name}
              otherName="McPrime Digital"
              projectId={project.id}
              onSendMessage={sendMessage}
              onUploadAttachment={handleAttachmentUpload}
              onDeleteMessage={handleDeleteMessage}
              onTyping={handleTyping}
            />
            {/* Typing indicator overlay */}
            {adminTyping && (
              <div className="absolute bottom-20 left-5 flex gap-3 pointer-events-none z-10">
                <div
                  className="w-7 h-7 rounded-full flex items-center
                  justify-center text-xs font-bold flex-shrink-0"
                  style={{ backgroundColor: 'hsl(var(--primary) / 0.1)', color: 'hsl(var(--primary))',
                    border: '1px solid hsl(var(--primary) / 0.2)' }}
                >
                  M
                </div>
                <div
                  className="px-4 py-3 flex items-center gap-1"
                  style={{ backgroundColor: 'hsl(var(--card))', borderRadius: '18px 18px 18px 4px',
                    border: '1px solid hsl(var(--border) / 0.8)' }}
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
          clientId={client.id}
          initialTasks={(tasks ?? []) as any}
          phases={phases}
          userRole="client"
        />
      )}
    </div>
  )
}
