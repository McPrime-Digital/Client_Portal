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
import RoomThread from '@/components/shared/RoomThread'
import TaskBoard from '@/components/shared/TaskBoard'
import { useNotifications } from '@/lib/hooks/useNotifications'
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
  client: Client
  /** The studio serving this client (S0-B §3) — resolved by the page. */
  studioName: string
  involvement?: any[]
  // the signed-in member's own display name (never the company owner's)
  memberName?: string
  // the member's client-side role — gates the approval buttons
  memberRole?: 'owner' | 'approver' | 'member' | 'viewer'
  // capability overrides (role default + owner grants), computed server-side
  canApprove?: boolean
  canMessage?: boolean
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
  client,
  studioName,
  involvement,
  memberName,
  memberRole = 'owner',
  canApprove,
  canMessage,
}: Props) {
  const [activeTab, setActiveTab] = useState('overview')
  // Honour a ?tab= deep-link (e.g. notification → opens the chat directly).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab')
    if (t && tabs.some((tab) => tab.id === t)) setActiveTab(t)
  }, [])
  const [phases, setPhases] = useState<ProjectPhase[]>(initialPhases)
  // The pipeline status is auto-derived from phase progress server-side; mirror
  // any change here so the client sees it without a reload.
  const [liveStatus, setLiveStatus] = useState(project.status)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [fileList, setFileList] = useState<FileRecord[]>(files)

  // Keep live state in sync whenever the server re-renders (RealtimeRefresh /
  // poll re-runs the page query). useState seeds only once, so without this the
  // client would never see admin-driven phase/status/file changes live — the
  // core of "phases must update live across portals".
  useEffect(() => { setPhases(initialPhases) }, [initialPhases])
  useEffect(() => { setLiveStatus(project.status) }, [project.status])
  useEffect(() => { setFileList(files) }, [files])
  // Typing & presence state
  const [adminTyping, setAdminTyping] = useState(false)
  const [adminOnline, setAdminOnline] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const clientUploadRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()

  // Live per-tab notification badges — counts of THIS project's unread
  // notifications by type, sourced from the same live hook the bell uses
  // (realtime + poll). Each badge persists until its tab is opened.
  const { notifications: bellNotifs } = useNotifications(client.id)
  const tabBadge = (type: string) =>
    bellNotifs.filter(
      (n) => n.project_id === project.id && n.type === type && !n.read_at && !n.dismissed_at,
    ).length

  // Opening the chat clears its bell notifications; the read watermark is
  // RoomThread's job now (one code path — Batch 15 item 1).
  useEffect(() => {
    if (activeTab === 'messages') {
      fetch('/api/portal/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: project.id, type: 'message' }),
      }).catch(() => {})
    }
  }, [activeTab, project.id])

  // Clear this project's notifications for the opened tab (files/tasks) — they
  // persist in the bell until the relevant tab is actually opened. (Messages is
  // handled in the effect above, which also marks chat messages read.)
  useEffect(() => {
    const typeForTab: Record<string, string | undefined> = {
      files: 'file_delivered',
      tasks: 'task_updated',
    }
    const type = typeForTab[activeTab]
    if (!type) return
    fetch('/api/portal/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: project.id, type }),
    }).catch(() => {})
  }, [activeTab, project.id])

  // Single source of truth — same helper the admin + lists use.
  const computedProgress = computeProjectProgress(phases, project.progress)

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

  // Realtime project subscription — live status badge as the project advances.
  useEffect(() => {
    const channel = supabase
      .channel(`project:${project.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'projects', filter: `id=eq.${project.id}` },
        (payload) => {
          const next = (payload.new as Project)?.status
          if (next) setLiveStatus(next)
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [project.id])

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
              <StatusBadge status={liveStatus} />
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
          // Live unread-notification count for this tab (clears when opened).
          const badge =
            tab.id === 'files'
              ? tabBadge('file_delivered')
              : tab.id === 'messages'
              ? tabBadge('message')
              : tab.id === 'tasks'
              ? tabBadge('task_updated')
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
              studioName={studioName}
            projectId={project.id}
            clientId={client.id}
            userId={client.id}
            userRole="client"
            userName={memberName ?? client.name}
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
          </div>

          <div className="flex-1 min-h-0 relative">
            <RoomThread
              role="client"
              clientId={client.id}
              orgId={client.organization_id}
              filter={{ kind: 'project', projectId: project.id }}
              currentName={memberName ?? client.name}
              otherName={studioName}
              canSend={canMessage !== false}
              selfFallback
              onTypingChange={setAdminTyping}
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
          studioName={studioName}
          projectId={project.id}
          clientId={client.id}
          initialTasks={(tasks ?? []) as any}
          phases={phases}
          userRole="client"
          canApprove={canApprove ?? (memberRole === 'owner' || memberRole === 'approver')}
          involvement={involvement}
        />
      )}
    </div>
  )
}
