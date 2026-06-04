'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Send,
  Loader2,
  X,
  Reply,
  FileText,
  Eye,
  Plus,
  Image as ImageIcon,
  Video,
  File as FileIcon,
  Trash2,
  Mic,
  Camera,
  Pencil,
  Check,
  CheckCheck,
  Clock,
} from 'lucide-react'
import type { Message } from '@/lib/types/database'
import FileViewer from './FileViewer'
import AudioPlayer from './AudioPlayer'
import VoiceRecorder from './VoiceRecorder'

type Props = {
  messages: Message[]
  currentRole: 'admin' | 'client'
  currentName: string
  currentUserId?: string
  otherName?: string
  projectId: string
  onSendMessage: (body: string, replyToId?: string, attachmentUrl?: string, attachmentName?: string) => Promise<void>
  onUploadAttachment?: (file: File) => Promise<{ url: string; name: string }>
  onDeleteMessage?: (messageId: string) => Promise<void>
  onEditMessage?: (messageId: string, newBody: string) => Promise<void>
  onTyping?: () => void
}

// ── Helpers ──────────────────────────────────────────────────
// Classifies an attachment by name. Voice notes are recorded as
// `voice-*.webm` (or .m4a on Safari); since .webm is *also* a video
// container, voice notes must be matched as audio BEFORE the video
// extensions, otherwise they render as a (silent-looking) video box.
function attachmentKind(name: string): 'image' | 'video' | 'audio' | 'file' {
  const n = name.toLowerCase()
  if (/\.(jpe?g|png|gif|webp|svg|bmp|avif)$/.test(n)) return 'image'
  if (/^voice-/.test(n) || /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba|amr)$/.test(n))
    return 'audio'
  if (/\.(mp4|mov|avi|mkv|m4v|ogv|webm)$/.test(n)) return 'video'
  return 'file'
}
function canDelete(createdAt: string): boolean {
  const fiveMinutesMs = 5 * 60 * 1000
  return Date.now() - new Date(createdAt).getTime() < fiveMinutesMs
}
function isPending(msg: Message): boolean {
  return msg.id.startsWith('temp-')
}

// Sending → Sent (single tick) → Delivered (double gray) → Read (double blue)
function MessageTicks({ msg }: { msg: Message }) {
  if (isPending(msg)) {
    return <Clock size={12} className="opacity-70" />
  }
  if (msg.read_at) {
    return <CheckCheck size={13} style={{ color: 'hsl(var(--primary))' }} />
  }
  if (msg.delivered_at) {
    return <CheckCheck size={13} className="opacity-70" />
  }
  return <Check size={13} className="opacity-70" />
}
function canEdit(createdAt: string): boolean {
  const oneHourMs = 1 * 60 * 60 * 1000
  return Date.now() - new Date(createdAt).getTime() < oneHourMs
}

export default function MessageThread({
  messages,
  currentRole,
  currentName,
  currentUserId,
  otherName,
  projectId,
  onSendMessage,
  onUploadAttachment,
  onDeleteMessage,
  onEditMessage,
  onTyping,
}: Props) {
  const [newMessage, setNewMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [uploading, setUploading] = useState(false)
  const [attachment, setAttachment] = useState<{ url: string; name: string } | null>(null)
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const [recording, setRecording] = useState(false)
  const [viewerSource, setViewerSource] = useState<{ url: string; name: string } | null>(null)
  const [editingMsg, setEditingMsg] = useState<Message | null>(null)
  const [editText, setEditText] = useState('')

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const attachMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Close attach menu on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setShowAttachMenu(false)
      }
    }
    if (showAttachMenu) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showAttachMenu])

  // ── Submit ──────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if ((!newMessage.trim() && !attachment) || sending || uploading) return
    // Never send a reply that points at an unsent (optimistic) message —
    // its temp id is not a valid row and would be rejected by the DB.
    const replyId = replyTo && !isPending(replyTo) ? replyTo.id : undefined
    setSending(true)
    try {
      await onSendMessage(newMessage.trim(), replyId, attachment?.url, attachment?.name)
      setNewMessage('')
      setReplyTo(null)
      setAttachment(null)
    } catch (err) {
      console.error(err)
    } finally {
      setSending(false)
      // Keep the composer active for continuous, WhatsApp-style chat — the
      // input is disabled while `sending`, which blurs it, so refocus once
      // re-enabled (next tick, after React flushes the disabled→enabled swap).
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }

  // ── File Handling ──────────────────────────────────────
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !onUploadAttachment) return
    setUploading(true)
    setShowAttachMenu(false)
    try {
      const result = await onUploadAttachment(file)
      setAttachment(result)
    } catch (err) {
      console.error('Upload failed', err)
      alert('Failed to upload file.')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  // ── Camera Capture ────────────────────────────────────
  async function handleCameraCapture() {
    setShowAttachMenu(false)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      const video = document.createElement('video')
      video.srcObject = stream
      video.autoplay = true
      await video.play()

      // Wait for video to load a frame
      await new Promise(r => setTimeout(r, 500))

      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      canvas.getContext('2d')!.drawImage(video, 0, 0)

      stream.getTracks().forEach(t => t.stop())

      canvas.toBlob(async (blob) => {
        if (!blob || !onUploadAttachment) return
        const file = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' })
        setUploading(true)
        try {
          const result = await onUploadAttachment(file)
          setAttachment(result)
        } catch { alert('Failed to upload photo.') }
        finally { setUploading(false) }
      }, 'image/jpeg', 0.9)
    } catch {
      alert('Camera access denied or unavailable.')
    }
  }

  // ── Audio Recording ───────────────────────────────────
  // Capture + live waveform live in <VoiceRecorder>; this just
  // uploads the finished clip as a pending attachment.
  async function handleRecordingComplete(file: File) {
    setRecording(false)
    if (!onUploadAttachment) return
    setUploading(true)
    try {
      const result = await onUploadAttachment(file)
      setAttachment(result)
    } catch {
      alert('Failed to upload recording.')
    } finally {
      setUploading(false)
    }
  }

  // ── Delete Message ────────────────────────────────────
  async function handleDelete(msg: Message) {
    if (!onDeleteMessage) return
    if (!canDelete(msg.created_at)) {
      alert('Messages can only be deleted within 5 minutes of sending.')
      return
    }
    if (!confirm('Delete this message?')) return
    try {
      await onDeleteMessage(msg.id)
    } catch (err) {
      console.error('Delete failed', err)
    }
  }

  // ── Resolve attachment signed URL for inline preview ──
  const [resolvedUrls, setResolvedUrls] = useState<Record<string, string>>({})

  const resolveUrl = useCallback(async (rawUrl: string) => {
    if (resolvedUrls[rawUrl]) return resolvedUrls[rawUrl]
    // Resolve server-side — the browser client can't sign every bucket
    // (storage RLS), so this authorizes + signs with the service role.
    try {
      const res = await fetch('/api/portal/messages/attachment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: rawUrl }),
      })
      const json = await res.json()
      const signed = res.ok && json.url ? json.url : rawUrl
      setResolvedUrls(prev => ({ ...prev, [rawUrl]: signed }))
      return signed
    } catch {
      setResolvedUrls(prev => ({ ...prev, [rawUrl]: rawUrl }))
      return rawUrl
    }
  }, [resolvedUrls])

  // Resolve all attachment URLs on mount/messages change
  useEffect(() => {
    messages.forEach(msg => {
      if (msg.attachment_url && !resolvedUrls[msg.attachment_url]) {
        resolveUrl(msg.attachment_url)
      }
    })
  }, [messages])

  // ── Render ──────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0" style={{ backgroundColor: 'hsl(var(--background))' }}>
      {/* Universal attachment viewer */}
      {viewerSource && (
        <FileViewer
          key={viewerSource.url}
          source={{ url: viewerSource.url, name: viewerSource.name }}
          onClose={() => setViewerSource(null)}
          onDownload={() => window.open(viewerSource.url, '_blank')}
        />
      )}

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0 scrollbar-thin relative">
        {messages.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-sm italic" style={{ color: 'hsl(var(--text-faint))' }}>
              No messages yet. Start the conversation!
            </p>
          </div>
        )}

        {messages.filter(m => !m.is_deleted).map((msg, index, filtered) => {
          const isMe = msg.sender_role === currentRole
          const prevMsg = filtered[index - 1]
          const showDate = !prevMsg || new Date(msg.created_at).toDateString() !== new Date(prevMsg.created_at).toDateString()
          const repliedMsg = msg.reply_to_id ? messages.find(m => m.id === msg.reply_to_id) : null
          const resolvedAttachUrl = msg.attachment_url ? resolvedUrls[msg.attachment_url] : null
          const attachName = msg.attachment_name || ''
          const attKind = attachmentKind(attachName)
          const isImg = attKind === 'image'
          const isVid = attKind === 'video'
          const isAud = attKind === 'audio'
          const isPdf = /\.pdf$/i.test(attachName)
          const deletable = isMe && canDelete(msg.created_at) && onDeleteMessage

          return (
            <div key={msg.id}>
              {showDate && (
                <div className="flex items-center gap-3 my-6">
                  <div className="flex-1 h-px" style={{ backgroundColor: 'hsl(var(--border))' }} />
                  <span className="text-[10px] uppercase tracking-wider flex-shrink-0" style={{ color: 'hsl(var(--text-faint))' }}>
                    {new Date(msg.created_at).toLocaleDateString('en-US', {
                      weekday: 'short', month: 'short', day: 'numeric'
                    })}
                  </span>
                  <div className="flex-1 h-px" style={{ backgroundColor: 'hsl(var(--border))' }} />
                </div>
              )}

              <div className={`flex group ${isMe ? 'justify-end' : 'justify-start'}`}>
                {/* Hover actions — left side for received */}
                {!isMe && (
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-1 mr-1 self-center">
                    <button
                      onClick={() => { setReplyTo(msg); inputRef.current?.focus() }}
                      className="p-1.5 rounded-full hover:bg-[hsl(var(--border))] text-[hsl(var(--text-faint))] hover:text-[hsl(var(--foreground))] transition-colors"
                      title="Reply"
                    >
                      <Reply size={13} />
                    </button>
                  </div>
                )}

                <div className="max-w-[75%] min-w-[120px] flex flex-col">
                  {!isMe && (
                    <p className="text-[10px] font-semibold uppercase tracking-wider mb-1 ml-1" style={{ color: 'hsl(var(--muted-foreground))' }}>
                      {msg.sender_name}
                    </p>
                  )}

                  <div
                    className="rounded-2xl relative overflow-hidden"
                    style={{
                      backgroundColor: isMe ? 'hsl(var(--primary))' : 'hsl(var(--border))',
                      color: isMe ? 'hsl(var(--background))' : 'hsl(var(--foreground))',
                      borderBottomRightRadius: isMe ? '4px' : '16px',
                      borderBottomLeftRadius: isMe ? '16px' : '4px',
                    }}
                  >
                    {/* Replied Context */}
                    {repliedMsg && (
                      <div
                        className="mx-3 mt-3 p-2 rounded-lg text-xs border-l-2 cursor-pointer opacity-90"
                        style={{
                          backgroundColor: isMe ? 'hsl(var(--background) / 0.1)' : 'hsl(var(--background) / 0.3)',
                          borderColor: isMe ? 'hsl(var(--background))' : 'hsl(var(--primary))'
                        }}
                      >
                        <p className="font-semibold mb-0.5 truncate">{repliedMsg.sender_name}</p>
                        <p className="truncate opacity-80">{repliedMsg.body || 'Attachment'}</p>
                      </div>
                    )}

                    {/* Inline Image Preview */}
                    {resolvedAttachUrl && isImg && (
                      <div
                        className="cursor-pointer"
                        onClick={() => setViewerSource({ url: resolvedAttachUrl, name: attachName || 'image' })}
                      >
                        <img
                          src={resolvedAttachUrl}
                          alt={attachName}
                          className="w-full max-h-[300px] object-cover"
                          loading="lazy"
                        />
                      </div>
                    )}

                    {/* Inline Video Preview */}
                    {resolvedAttachUrl && isVid && (
                      <div
                        className="cursor-pointer"
                        onClick={() => setViewerSource({ url: resolvedAttachUrl, name: attachName || 'video' })}
                      >
                        <video
                          src={resolvedAttachUrl}
                          className="w-full max-h-[300px] object-cover"
                          muted
                          preload="metadata"
                        />
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center">
                            <Video size={20} className="text-white ml-0.5" />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Inline voice-note player — compact pill */}
                    {resolvedAttachUrl && isAud && (
                      <div className="m-1.5 w-64 max-w-full rounded-xl border border-border bg-card px-3 py-2">
                        <AudioPlayer src={resolvedAttachUrl} compact />
                      </div>
                    )}

                    {/* Inline PDF preview — first page is rendered right in the
                        bubble; tap anywhere to open the large in-app viewer. */}
                    {resolvedAttachUrl && isPdf && (
                      <div
                        className="relative m-1.5 rounded-xl overflow-hidden cursor-pointer border border-border"
                        style={{ width: 256, maxWidth: '100%' }}
                        onClick={() => setViewerSource({ url: resolvedAttachUrl, name: attachName || 'document.pdf' })}
                      >
                        <iframe
                          src={`${resolvedAttachUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
                          title={attachName || 'PDF preview'}
                          className="w-full pointer-events-none"
                          style={{ height: 200, border: 'none', backgroundColor: '#fff' }}
                          loading="lazy"
                        />
                        {/* Transparent hit area guarantees the tap opens large view */}
                        <div className="absolute inset-0" />
                        <div
                          className="absolute bottom-0 inset-x-0 flex items-center gap-2 px-3 py-2 text-xs"
                          style={{ backgroundColor: 'hsl(var(--background) / 0.9)', color: 'hsl(var(--foreground))' }}
                        >
                          <FileText size={14} className="flex-shrink-0" />
                          <span className="truncate flex-1 text-left">{attachName || 'PDF'}</span>
                          <Eye size={13} className="flex-shrink-0 opacity-70" />
                        </div>
                      </div>
                    )}

                    {/* Generic File Attachment — preview tile; opens in the viewer */}
                    {resolvedAttachUrl && !isImg && !isVid && !isAud && !isPdf && msg.attachment_url && (
                      <button
                        type="button"
                        onClick={() => setViewerSource({ url: resolvedAttachUrl, name: attachName || 'Attachment' })}
                        className={`m-1.5 flex w-64 max-w-full flex-col gap-2 rounded-xl p-3 text-xs transition-colors border border-border ${
                          isMe ? 'bg-[hsl(var(--background))]/10 hover:bg-[hsl(var(--background))]/20' : 'bg-[hsl(var(--background))]/30 hover:bg-[hsl(var(--background))]/50'
                        }`}
                      >
                        <div className="flex items-center justify-center h-20 rounded-lg" style={{ backgroundColor: 'hsl(var(--background) / 0.25)' }}>
                          <FileText size={32} className="opacity-70" />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="truncate flex-1 text-left font-medium">{attachName || 'Attachment'}</span>
                          <span className="flex items-center gap-1 flex-shrink-0 opacity-70">
                            <Eye size={13} /> Open
                          </span>
                        </div>
                      </button>
                    )}

                    {/* Message Body */}
                    {editingMsg?.id === msg.id ? (
                      <div className="px-3 py-2">
                        <input
                          autoFocus
                          type="text"
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          onKeyDown={async (e) => {
                            if (e.key === 'Enter' && editText.trim() && onEditMessage) {
                              await onEditMessage(msg.id, editText.trim())
                              setEditingMsg(null)
                              setEditText('')
                            }
                            if (e.key === 'Escape') { setEditingMsg(null); setEditText('') }
                          }}
                          className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                          style={{ backgroundColor: isMe ? 'hsl(var(--background) / 0.15)' : 'hsl(var(--background) / 0.3)', color: 'inherit', border: '1px solid hsl(var(--primary) / 0.3)' }}
                        />
                        <div className="flex items-center gap-2 mt-1.5">
                          <button
                            onClick={async () => {
                              if (editText.trim() && onEditMessage) {
                                await onEditMessage(msg.id, editText.trim())
                              }
                              setEditingMsg(null)
                              setEditText('')
                            }}
                            className="text-[10px] flex items-center gap-1 px-2 py-1 rounded"
                            style={{ color: 'hsl(var(--primary))' }}
                          >
                            <Check size={10} /> Save
                          </button>
                          <button
                            onClick={() => { setEditingMsg(null); setEditText('') }}
                            className="text-[10px] px-2 py-1 rounded"
                            style={{ color: 'hsl(var(--muted-foreground))' }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : msg.body ? (
                      <p className="text-sm leading-relaxed whitespace-pre-wrap px-4 py-3">{msg.body}</p>
                    ) : null}
                    {!msg.body && !editingMsg && msg.attachment_url && (
                      <div className="h-1" /> 
                    )}
                  </div>

                  {/* Meta row */}
                  <div className={`text-[10px] mt-1 flex items-center gap-1.5 ${isMe ? 'justify-end mr-1' : 'justify-start ml-1'}`} style={{ color: 'hsl(var(--text-faint))' }}>
                    {new Date(msg.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    {msg.edited_at && <span className="italic">• edited</span>}
                    {isMe && <MessageTicks msg={msg} />}
                  </div>
                </div>

                {/* Hover actions — right side for sent */}
                {isMe && (
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-1 ml-1 self-center">
                    <button
                      onClick={() => { setReplyTo(msg); inputRef.current?.focus() }}
                      className="p-1.5 rounded-full hover:bg-[hsl(var(--border))] text-[hsl(var(--text-faint))] hover:text-[hsl(var(--foreground))] transition-colors"
                      title="Reply"
                    >
                      <Reply size={13} />
                    </button>
                    {isMe && canEdit(msg.created_at) && onEditMessage && msg.body && (
                      <button
                        onClick={() => { setEditingMsg(msg); setEditText(msg.body) }}
                        className="p-1.5 rounded-full hover:bg-[hsl(var(--border))] text-[hsl(var(--text-faint))] hover:text-[hsl(var(--foreground))] transition-colors"
                        title="Edit (within 1 hour)"
                      >
                        <Pencil size={13} />
                      </button>
                    )}
                    {deletable && (
                      <button
                        onClick={() => handleDelete(msg)}
                        className="p-1.5 rounded-full hover:bg-red-500/20 text-[hsl(var(--text-faint))] hover:text-red-400 transition-colors"
                        title="Delete (within 5 minutes)"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Input Area ─────────────────────────────────────── */}
      <div className="flex-shrink-0 p-4" style={{ borderTop: '1px solid hsl(var(--border))', backgroundColor: 'hsl(var(--card))' }}>

        {/* Reply Context Bar */}
        {replyTo && (
          <div className="flex items-center justify-between mb-3 px-4 py-2.5 rounded-xl" style={{ backgroundColor: 'hsl(var(--border))' }}>
            <div className="flex items-center gap-2 min-w-0">
              <Reply size={14} style={{ color: 'hsl(var(--primary))' }} />
              <div className="min-w-0 text-xs">
                <span className="font-semibold mr-1" style={{ color: 'hsl(var(--foreground))' }}>
                  Replying to {replyTo.sender_name}
                </span>
                <span className="truncate block" style={{ color: 'hsl(var(--muted-foreground))' }}>
                  {replyTo.body || 'Attachment'}
                </span>
              </div>
            </div>
            <button onClick={() => setReplyTo(null)} className="p-1 hover:bg-[hsl(var(--background))] rounded text-[hsl(var(--muted-foreground))]">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Attachment Preview Bar */}
        {attachment && (
          <div className="flex items-center justify-between mb-3 px-4 py-2.5 rounded-xl border" style={{ backgroundColor: 'hsl(var(--primary) / 0.05)', borderColor: 'hsl(var(--primary) / 0.2)' }}>
            <div className="flex items-center gap-2 min-w-0">
              <FileIcon size={14} style={{ color: 'hsl(var(--primary))' }} />
              <span className="text-xs truncate font-medium" style={{ color: 'hsl(var(--foreground))' }}>
                {attachment.name}
              </span>
            </div>
            <button onClick={() => setAttachment(null)} className="p-1 hover:bg-[hsl(var(--border))] rounded text-[hsl(var(--muted-foreground))]">
              <X size={14} />
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          {recording ? (
            <VoiceRecorder
              onComplete={handleRecordingComplete}
              onCancel={() => setRecording(false)}
            />
          ) : (
          <>
          {/* Plus Button + Flyout Menu */}
          {onUploadAttachment && (
            <div className="relative" ref={attachMenuRef}>
              {/* Hidden file inputs */}
              <input type="file" ref={imageInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />
              <input type="file" ref={videoInputRef} className="hidden" accept="video/*" onChange={handleFileChange} />
              <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileChange} />

              <button
                type="button"
                onClick={() => setShowAttachMenu(!showAttachMenu)}
                disabled={uploading || sending}
                className="w-10 h-10 rounded-xl flex items-center justify-center transition-all disabled:opacity-50"
                style={{
                  backgroundColor: showAttachMenu ? 'hsl(var(--primary))' : 'hsl(var(--border))',
                  color: showAttachMenu ? 'hsl(var(--background))' : 'hsl(var(--muted-foreground))',
                }}
              >
                {uploading ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Plus size={18} className={`transition-transform duration-200 ${showAttachMenu ? 'rotate-45' : ''}`} />
                )}
              </button>

              {/* Flyout */}
              {showAttachMenu && (
                <div
                  className="absolute bottom-14 left-0 rounded-xl p-2 space-y-1 shadow-xl z-20 min-w-[180px]"
                  style={{ backgroundColor: 'hsl(var(--border))', border: '1px solid hsl(var(--border))' }}
                >
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors hover:bg-[hsl(var(--border))]"
                    style={{ color: 'hsl(var(--foreground))' }}
                  >
                    <ImageIcon size={16} style={{ color: 'hsl(var(--primary))' }} />
                    Image
                  </button>
                  <button
                    type="button"
                    onClick={() => videoInputRef.current?.click()}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors hover:bg-[hsl(var(--border))]"
                    style={{ color: 'hsl(var(--foreground))' }}
                  >
                    <Video size={16} style={{ color: 'hsl(var(--status-violet))' }} />
                    Video
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors hover:bg-[hsl(var(--border))]"
                    style={{ color: 'hsl(var(--foreground))' }}
                  >
                    <FileIcon size={16} style={{ color: 'hsl(var(--status-amber))' }} />
                    Document
                  </button>
                  <div className="h-px my-1" style={{ backgroundColor: 'hsl(var(--border))' }} />
                  <button
                    type="button"
                    onClick={handleCameraCapture}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors hover:bg-[hsl(var(--border))]"
                    style={{ color: 'hsl(var(--foreground))' }}
                  >
                    <Camera size={16} style={{ color: 'hsl(var(--status-green))' }} />
                    Take Photo
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Text input */}
          <input
            ref={inputRef}
            type="text"
            value={newMessage}
            onChange={(e) => {
              setNewMessage(e.target.value)
              if (onTyping) onTyping()
            }}
            placeholder={uploading ? 'Uploading...' : recording ? 'Recording...' : 'Type a message...'}
            className="flex-1 px-4 py-3 rounded-xl text-sm outline-none transition-all focus:border-[hsl(var(--primary))] focus:shadow-[0_0_0_3px_hsl(var(--primary) / 0.08)]"
            style={{ backgroundColor: 'hsl(var(--border))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}
            disabled={uploading || sending || recording}
          />

          {/* Voice Record */}
          {onUploadAttachment && (
            <button
              type="button"
              onClick={() => setRecording(true)}
              disabled={uploading || sending}
              className="w-10 h-10 rounded-xl flex items-center justify-center transition-all disabled:opacity-50"
              style={{ backgroundColor: 'hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}
              title="Voice note"
            >
              <Mic size={16} />
            </button>
          )}

          {/* Send */}
          <button
            type="submit"
            disabled={(!newMessage.trim() && !attachment) || sending || uploading || recording}
            className="w-10 h-10 rounded-xl flex items-center justify-center transition-all disabled:opacity-40"
            style={{ backgroundColor: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
          </>
          )}
        </form>
      </div>
    </div>
  )
}
