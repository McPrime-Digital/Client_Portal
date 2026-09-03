'use client'

import { useDismissOnOutside } from '@/lib/hooks/useDismissOnOutside'
import { DEFAULT_WALLPAPER, type WallpaperPattern } from '@/lib/chatPrefs'
import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import {
  Send,
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
  MessagesSquare,
  SmilePlus,
  Pin,
  Bookmark,
  MoreHorizontal,
  Copy,
} from 'lucide-react'
import type { Message } from '@/lib/types/database'
import { splitBody, buildMentionToken, mentionQueryOf, replaceTrailingMentionQuery, stripMentionTokens, type BodyPart } from '@/lib/mentionClient'
import FileViewer from './FileViewer'
import AudioPlayer from './AudioPlayer'
import VoiceRecorder from './VoiceRecorder'

type Props = {
  /**
   * Renders the approval card for a message carrying `approval_id`
   * (Batch 22, S3-c §3.1). A render-prop rather than a component import: the
   * card needs to know which side's API it is talking to, and that is the
   * ROOM's knowledge, not this renderer's. Omitted, an approval message falls
   * through to an ordinary bubble.
   */
  renderApproval?: (approvalId: string, msg: Message) => React.ReactNode
  // view-only members get no composer at all — hidden, not disabled
  readOnly?: boolean
  messages: Message[]
  currentRole: 'admin' | 'client'
  currentName: string
  currentUserId?: string
  otherName?: string
  projectId: string
  onSendMessage: (body: string, replyToId?: string, attachmentUrl?: string, attachmentName?: string, attachmentFileId?: string) => Promise<void>
  onUploadAttachment?: (file: File) => Promise<{ url: string; name: string; fileId?: string }>
  onDeleteMessage?: (messageId: string) => Promise<void>
  onEditMessage?: (messageId: string, newBody: string) => Promise<void>
  onTyping?: () => void
  /** keyset pagination (Batch 15 item 2) — scroll to the top loads older */
  onLoadOlder?: () => Promise<void>
  hasMore?: boolean
  loadingOlder?: boolean
  /** threads (Batch 15 item 3): reply meta per root + open-panel action */
  replyMeta?: Record<string, { count: number; lastAt: string }>
  onOpenThread?: (msg: Message) => void
  /** reactions / pins / saves (Batch 15 item 4) */
  ownUserId?: string | null
  onToggleReaction?: (msg: Message, emoji: string) => void
  onTogglePin?: (msg: Message) => void
  onToggleSave?: (msg: Message) => void
  pinnedIds?: Set<string>
  savedIds?: Set<string>
  /** jump-to-message flash target */
  highlightId?: string | null
  /** mentions (Batch 15 item 5) */
  mentionTargets?: Record<string, Record<string, { label: string; sub?: string; href?: string } | null>> | null
  mentionCandidates?: { users: { id: string; name: string }[]; projects: { id: string; title: string }[] } | null
  /** live composer state for presence (Batch 16): recording on/off */
  onRecordingChange?: (recording: boolean) => void
  /** instant voice send (Batch 17): bubble appears immediately, upload rides behind */
  onSendVoice?: (file: File) => void
  /** sticky project tag in the composer (Batch 17): additive until changed */
  composerTag?: { id: string; title: string; color: string } | null
  composerTagOptions?: { id: string; title: string; color: string }[]
  composerTagLocked?: boolean
  /**
   * True when the thread IS one project (a project page, or a project chip in
   * the hub). Inside a project every message belongs to it by definition, so
   * naming it on each one is noise — the colour already says it. Also hides
   * the composer's project selector, which has nothing to choose between.
   */
  singleProject?: boolean
  onComposerTagChange?: (id: string | null) => void
  /** viewer's wallpaper (Batch 17): pattern class + intensity alpha */
  /** Viewer's wallpaper (Batch 17, set rebuilt). The pattern union lives in
   *  lib/chatPrefs so the picker, the validator and this renderer cannot
   *  drift — three copies of a string union is how 'aurora' survived in one
   *  place after being retired in another. */
  wallpaper?: { pattern: WallpaperPattern; alpha: number }
  /** forward + bulk select (Batch 18) */
  onForward?: (msgs: Message[]) => void
  selectionMode?: boolean
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
  /** project colour-bonding (Batch 16): tagged bubbles carry their project's colour */
  projectMeta?: Record<string, { title: string; color: string }>
}

// ── Helpers ──────────────────────────────────────────────────

// Curated picker — four rows people actually use. No dependency, no fetch.
const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  { label: 'Smileys', emojis: ['😀','😄','😂','🤣','😊','😍','😘','😎','🤔','😅','😢','😭','😤','😡','🥳','🤯','😴','🙃','😬','🤝','😉','😇','🥰','😜','🤪','😐','😶','🙄','😳','🥺','😱','🤗','🤫','🤭','🫠','😌','😷','🤒','🤠','🥸'] },
  { label: 'Gestures', emojis: ['👍','👎','👏','🙌','🙏','💪','✌️','🤞','👌','🤙','👊','✊','🖐️','👋','🫡','🤌','☝️','👇','👉','👈','🤲','🫶','🤟','🖖','✍️','💅','🦾','👂','👀','🧠'] },
  { label: 'Hearts & marks', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💯','✨','⭐','🔥','⚡','✅','❌','❗','❓','💬','👀'] },
  { label: 'Work & film', emojis: ['🎬','🎥','📷','🎞️','🎭','🎵','🎧','📝','📌','📎','📁','📀','🚀','🏆','⏰','📅','💡','🔔','🔒','🎯'] },
  { label: 'Animals & nature', emojis: ['🐶','🐱','🦁','🐼','🦊','🐸','🐢','🦋','🌵','🌴','🌸','🌻','🌙','☀️','🌈','⛰️','🌊','❄️','🍀','🔥'] },
  { label: 'Food & drink', emojis: ['☕','🍕','🍔','🌮','🍣','🍜','🍩','🍪','🎂','🍾','🥂','🍺','🍷','🧋','🍿','🥐','🍎','🥑','🍫','🍭'] },
]

// Stickers: jumbo expressive emoji that SEND on tap and land animated.
const STICKERS = ['🎉','🔥','❤️','😂','👏','💯','🚀','🏆','🙌','😍','🤯','💪','✨','🥳','😎','🎬','🫡','👀','🤝','⚡','🌟','💡','🎯','☕']

// A message that is ONLY a few emoji renders jumbo — WhatsApp's move.
function isJumboEmoji(body: string): boolean {
  const t = body.trim()
  if (!t || t.length > 16) return false
  try {
    const re = /^(?:\p{Extended_Pictographic}[\u200d\uFE0F]*){1,3}$/u
    return re.test(t.replace(/\s/g, ''))
  } catch {
    return false
  }
}
// Today / Yesterday / date — the divider speaks the reader's calendar.
function dayLabel(dateStr: string): string {
  const d = new Date(dateStr)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

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
  renderApproval,
  messages,
  currentRole,
  currentName,
  currentUserId,
  otherName,
  projectId,
  readOnly = false,
  onSendMessage,
  onUploadAttachment,
  onDeleteMessage,
  onEditMessage,
  onTyping,
  onLoadOlder,
  hasMore = false,
  loadingOlder = false,
  replyMeta = {},
  onOpenThread,
  ownUserId = null,
  onToggleReaction,
  onTogglePin,
  onToggleSave,
  pinnedIds,
  savedIds,
  highlightId = null,
  mentionTargets = null,
  mentionCandidates = null,
  onRecordingChange,
  onSendVoice,
  composerTag = null,
  composerTagOptions = [],
  composerTagLocked = false,
  singleProject = false,
  onComposerTagChange,
  wallpaper = { pattern: DEFAULT_WALLPAPER, alpha: 0.75 },
  onForward,
  selectionMode = false,
  selectedIds,
  onToggleSelect,
  projectMeta = {},
}: Props) {
  const [newMessage, setNewMessage] = useState('')
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [uploading, setUploading] = useState(false)
  const [attachment, setAttachment] = useState<{ url: string; name: string; fileId?: string } | null>(null)
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const [recording, setRecording] = useState(false)
  const [viewerSource, setViewerSource] = useState<{ url: string; name: string } | null>(null)
  const [editingMsg, setEditingMsg] = useState<Message | null>(null)
  const [editText, setEditText] = useState('')
  const [pickerFor, setPickerFor] = useState<string | null>(null)
  const [msgMenuFor, setMsgMenuFor] = useState<string | null>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)

  /**
   * When to print a project's NAME on a message.
   *
   * Never inside a project view — every message there belongs to that project,
   * so the label is repeated on every row and says nothing. The inset colour
   * stripe carries it instead.
   *
   * In the All view, only at a BOUNDARY: the first message of a run that
   * belongs to a different project than the one before it. A conversation that
   * stays in one project therefore labels it once, not on every bubble.
   */
  const showProjectTag = useCallback(
    (msg: Message, prev?: Message) => {
      if (singleProject) return false
      if (!msg.project_id || !projectMeta[msg.project_id]) return false
      return (prev?.project_id ?? null) !== msg.project_id
    },
    [singleProject, projectMeta]
  )
  // Tap anywhere else, or press Escape, and these close. They used to stay
  // open until you hit their trigger again, which on touch reads as stuck.
  useDismissOnOutside(pickerFor !== null, useCallback(() => setPickerFor(null), []))
  useDismissOnOutside(msgMenuFor !== null, useCallback(() => setMsgMenuFor(null), []))
  useDismissOnOutside(emojiOpen, useCallback(() => setEmojiOpen(false), []))
  const [pickerTab, setPickerTab] = useState<'emoji' | 'stickers'>('emoji')
  const [tagMenuOpen, setTagMenuOpen] = useState(false)
  // '@' autocomplete (item 5): people + projects from the roster prop.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)

  const mentionMatches = (() => {
    if (mentionQuery == null || !mentionCandidates) return []
    const q = mentionQuery.toLowerCase()
    const users = mentionCandidates.users
      .filter((u) => u.name.toLowerCase().includes(q))
      .map((u) => ({ kind: 'u' as const, id: u.id, label: u.name, sub: 'Person' }))
    const projects = mentionCandidates.projects
      .filter((p) => p.title.toLowerCase().includes(q))
      .map((p) => ({ kind: 'p' as const, id: p.id, label: p.title, sub: 'Project' }))
    return [...users, ...projects].slice(0, 6)
  })()

  // The INPUT shows "@Name" (Batch 17 — the raw token was "a long text");
  // the token substitutes in at submit time, first occurrence per mention.
  const pendingMentionsRef = useRef<{ display: string; token: string }[]>([])
  function applyMention(m: { kind: 'u' | 'p'; id: string; label: string }) {
    const display = `@${m.label}`
    pendingMentionsRef.current.push({ display, token: buildMentionToken(m.kind, m.id, m.label) })
    setNewMessage((prev) => replaceTrailingMentionQuery(prev, display))
    setMentionQuery(null)
    setMentionIndex(0)
    inputRef.current?.focus()
  }
  function materializeMentions(text: string): string {
    let out = text
    for (const p of pendingMentionsRef.current) {
      const i = out.indexOf(p.display)
      if (i !== -1) out = out.slice(0, i) + p.token + out.slice(i + p.display.length)
    }
    pendingMentionsRef.current = []
    return out
  }

  // Jump-to-message: scroll the flash target into view when it arrives.
  useEffect(() => {
    if (!highlightId) return
    const el = document.getElementById(`msg-${highlightId}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [highlightId, messages])

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollBoxRef = useRef<HTMLDivElement>(null)
  // Autoscroll only when the reader is already at the tail — loading an older
  // page or reading history must never yank them to the bottom.
  const nearBottomRef = useRef(true)
  const fetchingOlderRef = useRef(false)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-grow the composer with its content, up to ~5 lines.
  const autosize = () => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }
  const attachMenuRef = useRef<HTMLDivElement>(null)

  // Opening a chat lands AT the latest message — an instant, before-paint
  // jump, never a visible top-to-bottom ride. Smooth scrolling is reserved
  // for messages that arrive while you are already reading at the tail.
  const didInitialScrollRef = useRef(false)
  useEffect(() => {
    didInitialScrollRef.current = false
  }, [projectId])
  useLayoutEffect(() => {
    if (messages.length === 0) {
      didInitialScrollRef.current = false
      return
    }
    const el = scrollBoxRef.current
    if (!didInitialScrollRef.current) {
      if (el) el.scrollTop = el.scrollHeight
      didInitialScrollRef.current = true
      nearBottomRef.current = true
      return
    }
    if (nearBottomRef.current && !fetchingOlderRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, projectId])

  async function handleScroll() {
    const el = scrollBoxRef.current
    if (!el) return
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (el.scrollTop < 80 && hasMore && !loadingOlder && !fetchingOlderRef.current && onLoadOlder) {
      fetchingOlderRef.current = true
      const prevHeight = el.scrollHeight
      const prevTop = el.scrollTop
      try {
        await onLoadOlder()
      } finally {
        requestAnimationFrame(() => {
          const box = scrollBoxRef.current
          if (box) box.scrollTop = box.scrollHeight - prevHeight + prevTop
          fetchingOlderRef.current = false
        })
      }
    }
  }

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
  // The message leaves the box the INSTANT Send is tapped: we clear the
  // composer synchronously and the bubble appears immediately (optimistic,
  // with a pending tick). The network round-trip runs in the background and
  // never blocks or disables the input — so chatting stays continuous.
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    doSubmit()
  }

  function doSubmit() {
    if ((!newMessage.trim() && !attachment) || uploading) return
    const body = materializeMentions(newMessage.trim())
    // Never send a reply that points at an unsent (optimistic) message —
    // its temp id is not a valid row and would be rejected by the DB.
    const replyId = replyTo && !isPending(replyTo) ? replyTo.id : undefined
    const att = attachment

    setNewMessage('')
    setReplyTo(null)
    setAttachment(null)
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (el) {
        el.style.height = 'auto'
        el.focus()
      }
    })

    void onSendMessage(body, replyId, att?.url, att?.name, att?.fileId).catch((err) => {
      console.error(err)
    })
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
      alert(`Upload failed: ${err instanceof Error ? err.message : 'unknown error'}`)
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
    onRecordingChange?.(false)
    // Instant send (Batch 17): the voice note appears as a playing bubble the
    // moment recording stops — no staging, no upload spinner. The upload and
    // send ride behind the optimistic message.
    if (onSendVoice) {
      onSendVoice(file)
      return
    }
    if (!onUploadAttachment) return
    setUploading(true)
    try {
      const result = await onUploadAttachment(file)
      setAttachment(result)
    } catch (err) {
      alert(`Recording upload failed: ${err instanceof Error ? err.message : 'unknown error'}`)
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

  const resolveUrl = useCallback(async (rawUrl: string, fileId?: string | null) => {
    if (resolvedUrls[rawUrl]) return resolvedUrls[rawUrl]
    // Resolve server-side — the browser client can't sign every bucket
    // (storage RLS), so this authorizes + signs with the service role.
    // A "bucket::path" ref is not itself a usable URL, so if signing fails we
    // must NOT fall back to it (that renders a broken image). Leave it
    // unresolved instead — the loading skeleton stays and we retry next pass.
    const failValue = rawUrl.includes('::') ? '' : rawUrl
    try {
      const res = await fetch('/api/portal/messages/attachment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fileId ? { file_id: fileId, ref: rawUrl } : { ref: rawUrl }),
      })
      const json = await res.json()
      const signed = res.ok && json.url ? json.url : failValue
      setResolvedUrls(prev => ({ ...prev, [rawUrl]: signed }))
      return signed
    } catch {
      setResolvedUrls(prev => ({ ...prev, [rawUrl]: failValue }))
      return failValue
    }
  }, [resolvedUrls])

  /**
   * Attachment URLs (item 7).
   *
   * The list endpoint now PRE-SIGNS every attachment on the page, so the
   * common case costs no request at all — the media is renderable the instant
   * the bubble is. Those arrive as `attachment_signed_url` and are seeded
   * straight into the map SYNCHRONOUSLY during render, not in an effect,
   * because an effect would paint one frame of empty media first and that
   * single frame is the flicker this item is about.
   *
   * Anything the server could not sign — a lazy surface like the pins panel,
   * or a file whose signing failed — still falls back to the per-attachment
   * route below. The second wave is gone from the thread; it is not gone from
   * the codebase, because those surfaces still need it.
   */
  const preSigned: Record<string, string> = {}
  for (const msg of messages) {
    const url = (msg as { attachment_signed_url?: string | null }).attachment_signed_url
    if (msg.attachment_url && url) preSigned[msg.attachment_url] = url
  }
  const urlFor = (raw: string | null | undefined): string | null =>
    raw ? (preSigned[raw] ?? resolvedUrls[raw] ?? null) : null

  useEffect(() => {
    messages.forEach(msg => {
      const already =
        (msg as { attachment_signed_url?: string | null }).attachment_signed_url ||
        (msg.attachment_url && resolvedUrls[msg.attachment_url])
      if (msg.attachment_url && !already) {
        resolveUrl(msg.attachment_url, (msg as { attachment_file_id?: string | null }).attachment_file_id)
      }
    })
  }, [messages])

  // Resolve the staged composer attachment too, so the preview bar can show a
  // real thumbnail of the image/video you're about to send (not a blank chip).
  useEffect(() => {
    if (attachment?.url && !resolvedUrls[attachment.url]) {
      resolveUrl(attachment.url)
    }
  }, [attachment])

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
      <div
        className={`${wallpaper.pattern !== 'none' ? `tl-chat-bg tl-wp-${wallpaper.pattern}` : ''} flex-1 min-h-0 relative`}
        style={{ ['--tl-wp-a' as string]: wallpaper.alpha }}
      >
      <div
        ref={scrollBoxRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-4 py-3 scrollbar-thin relative"
      >

        {!hasMore && messages.length > 0 && (
          <p
            className="text-center text-[9px] uppercase tracking-[0.14em] py-1.5"
            style={{ color: 'hsl(var(--text-faint))' }}
          >
            Beginning of conversation
          </p>
        )}
        {messages.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{
                backgroundColor: 'hsl(var(--primary) / 0.08)',
                border: '1px solid hsl(var(--primary) / 0.25)',
              }}
            >
              <Send size={18} style={{ color: 'hsl(var(--primary))' }} />
            </div>
            <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
              {otherName ? `This is the beginning of your conversation with ${otherName}.` : 'This is the beginning of the conversation.'}
            </p>
          </div>
        )}

        {messages.filter(m => !m.is_deleted && !m.deleted_at).map((msg, index, filtered) => {
          const isMe = msg.sender_role === currentRole
          const prevMsg = filtered[index - 1]
          const nextMsg = filtered[index + 1]
          const showDate = !prevMsg || new Date(msg.created_at).toDateString() !== new Date(prevMsg.created_at).toDateString()
          // WhatsApp-style grouping: a run of messages from one person within
          // four minutes reads as one utterance — name once, tail once, time once.
          const GROUP_MS = 4 * 60_000
          const prevSame = !!prevMsg && !showDate &&
            prevMsg.sender_id === msg.sender_id &&
            new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime() < GROUP_MS
          const nextSame = !!nextMsg &&
            nextMsg.sender_id === msg.sender_id &&
            new Date(nextMsg.created_at).toDateString() === new Date(msg.created_at).toDateString() &&
            new Date(nextMsg.created_at).getTime() - new Date(msg.created_at).getTime() < GROUP_MS
          const repliedMsg = msg.reply_to_id ? messages.find(m => m.id === msg.reply_to_id) : null
          const resolvedAttachUrl = urlFor(msg.attachment_url)
          const attachName = msg.attachment_name || ''
          const attKind = attachmentKind(attachName)
          const isImg = attKind === 'image'
          const isVid = attKind === 'video'
          const isAud = attKind === 'audio'
          const isPdf = /\.pdf$/i.test(attachName)
          const deletable = isMe && canDelete(msg.created_at) && onDeleteMessage

          // AN APPROVAL CARD IS A MESSAGE (S3-c §3.1), so it rides this list
          // rather than a parallel one — it inherits ordering, date dividers,
          // load-older, search and realtime for free. The card itself is
          // rendered by the OWNER of the room (RoomThread), which knows which
          // side's API to talk to; this renderer stays presentation.
          if (msg.approval_id && renderApproval) {
            return (
              <div key={msg.id} id={`msg-${msg.id}`} className="tl-msg-in mt-3 flex justify-center">
                {renderApproval(msg.approval_id, msg)}
              </div>
            )
          }

          return (
            <div
              key={msg.id}
              id={`msg-${msg.id}`}
              className={`tl-msg-in ${showDate ? '' : prevSame ? 'mt-[2px]' : 'mt-3'} ${highlightId === msg.id ? 'rounded-2xl' : ''}`}
              style={highlightId === msg.id ? { boxShadow: '0 0 0 2px hsl(var(--primary) / 0.6)', transition: 'box-shadow 0.4s' } : undefined}
            >
              {showDate && (
                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px" style={{ backgroundColor: 'hsl(var(--border))' }} />
                  <span
                    className="text-[9px] font-semibold uppercase tracking-[0.14em] flex-shrink-0 px-2.5 py-0.5 rounded-full"
                    style={{
                      color: 'hsl(var(--muted-foreground))',
                      backgroundColor: 'hsl(var(--card) / 0.9)',
                      border: '1px solid hsl(var(--border))',
                      backdropFilter: 'blur(4px)',
                    }}
                  >
                    {dayLabel(msg.created_at)}
                  </span>
                  <div className="flex-1 h-px" style={{ backgroundColor: 'hsl(var(--border))' }} />
                </div>
              )}

              <div className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`group max-w-[78%] md:max-w-[66%] min-w-[110px] flex flex-col relative ${selectionMode ? 'cursor-pointer' : ''}`}
                  onClick={selectionMode ? () => onToggleSelect?.(msg.id) : undefined}
                  style={
                    selectionMode && selectedIds?.has(msg.id)
                      ? { outline: '2px solid hsl(var(--primary))', outlineOffset: 2, borderRadius: 18 }
                      : undefined
                  }
                >
                  {/* Horizontal action bar (Batch 16): floats over the group
                      on hover — react · quote · thread · more. */}
                  <div
                    data-tl-keep-open
                    className={`absolute -top-4 ${isMe ? 'right-0' : 'left-0'} z-20 ${selectionMode ? 'hidden' : 'opacity-0 group-hover:opacity-100'} transition-opacity duration-150 flex items-center rounded-full shadow-lg`}
                    style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                  >
                    {onToggleReaction && (
                      <button
                        onClick={() => { setPickerFor(pickerFor === msg.id ? null : msg.id); setMsgMenuFor(null) }}
                        className="p-1.5 rounded-full hover:bg-[hsl(var(--border))] text-[hsl(var(--text-faint))] hover:text-[hsl(var(--primary))] transition-colors"
                        title="React"
                      >
                        <SmilePlus size={13} />
                      </button>
                    )}
                    <button
                      onClick={() => { setReplyTo(msg); inputRef.current?.focus() }}
                      className="p-1.5 rounded-full hover:bg-[hsl(var(--border))] text-[hsl(var(--text-faint))] hover:text-[hsl(var(--foreground))] transition-colors"
                      title="Quote reply"
                    >
                      <Reply size={13} />
                    </button>
                    {onOpenThread && !msg.thread_root_id && (
                      <button
                        onClick={() => onOpenThread(msg)}
                        className="p-1.5 rounded-full hover:bg-[hsl(var(--border))] text-[hsl(var(--text-faint))] hover:text-[hsl(var(--primary))] transition-colors"
                        title="Reply in thread"
                      >
                        <MessagesSquare size={13} />
                      </button>
                    )}
                    <button
                      onClick={() => { setMsgMenuFor(msgMenuFor === msg.id ? null : msg.id); setPickerFor(null) }}
                      className="p-1.5 rounded-full hover:bg-[hsl(var(--border))] text-[hsl(var(--text-faint))] hover:text-[hsl(var(--foreground))] transition-colors"
                      title="More"
                    >
                      <MoreHorizontal size={13} />
                    </button>
                  </div>
                  {pickerFor === msg.id && (
                    <div
                      data-tl-keep-open
                      className={`absolute -top-14 ${isMe ? 'right-0' : 'left-0'} z-30 flex gap-1 p-1.5 rounded-xl shadow-xl`}
                      style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                    >
                      {['👍', '❤️', '😂', '🎉', '👀', '✅'].map((e) => (
                        <button
                          key={e}
                          onClick={() => { onToggleReaction?.(msg, e); setPickerFor(null) }}
                          className="text-base hover:scale-125 transition-transform px-0.5"
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  )}
                  {msgMenuFor === msg.id && (
                    <div
                      data-tl-keep-open
                      className={`absolute top-5 ${isMe ? 'right-0' : 'left-0'} z-30 w-44 rounded-xl overflow-hidden shadow-2xl`}
                      style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                    >
                      {onForward && (
                        <button
                          onClick={() => { onForward([msg]); setMsgMenuFor(null) }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left transition-colors hover:bg-[hsl(var(--primary)/0.08)]"
                          style={{ color: 'hsl(var(--foreground))' }}
                        >
                          <Reply size={12} style={{ color: 'hsl(var(--text-faint))', transform: 'scaleX(-1)' }} />
                          Forward
                        </button>
                      )}
                      {onTogglePin && (
                        <button
                          onClick={() => { onTogglePin(msg); setMsgMenuFor(null) }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left transition-colors hover:bg-[hsl(var(--primary)/0.08)]"
                          style={{ color: 'hsl(var(--foreground))' }}
                        >
                          <Pin size={12} style={{ color: pinnedIds?.has(msg.id) ? 'hsl(var(--primary))' : 'hsl(var(--text-faint))' }} />
                          {pinnedIds?.has(msg.id) ? 'Unpin from room' : 'Pin to room'}
                        </button>
                      )}
                      {onToggleSave && (
                        <button
                          onClick={() => { onToggleSave(msg); setMsgMenuFor(null) }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left transition-colors hover:bg-[hsl(var(--primary)/0.08)]"
                          style={{ color: 'hsl(var(--foreground))' }}
                        >
                          <Bookmark size={12} style={{ color: savedIds?.has(msg.id) ? 'hsl(var(--primary))' : 'hsl(var(--text-faint))' }} />
                          {savedIds?.has(msg.id) ? 'Unsave' : 'Save for me'}
                        </button>
                      )}
                      {msg.body && (
                        <button
                          onClick={() => {
                            void navigator.clipboard?.writeText(stripMentionTokens(msg.body)).catch(() => {})
                            setMsgMenuFor(null)
                          }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left transition-colors hover:bg-[hsl(var(--primary)/0.08)]"
                          style={{ color: 'hsl(var(--foreground))' }}
                        >
                          <Copy size={12} style={{ color: 'hsl(var(--text-faint))' }} />
                          Copy text
                        </button>
                      )}
                      {isMe && canEdit(msg.created_at) && onEditMessage && msg.body && (
                        <button
                          onClick={() => { setEditingMsg(msg); setEditText(msg.body); setMsgMenuFor(null) }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left transition-colors hover:bg-[hsl(var(--primary)/0.08)]"
                          style={{ color: 'hsl(var(--foreground))' }}
                        >
                          <Pencil size={12} style={{ color: 'hsl(var(--text-faint))' }} />
                          Edit
                        </button>
                      )}
                      {deletable && (
                        <button
                          onClick={() => { handleDelete(msg); setMsgMenuFor(null) }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left transition-colors hover:bg-[hsl(var(--destructive)/0.12)]"
                          style={{ color: 'hsl(var(--destructive))' }}
                        >
                          <Trash2 size={12} />
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                  {!isMe && !prevSame && (
                    <p className="text-[9px] font-semibold uppercase tracking-wider mb-0.5 ml-1 flex items-center gap-1.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
                      {msg.sender_name}
                      {showProjectTag(msg, prevMsg) && (
                        <span
                          className="normal-case tracking-normal font-medium px-1.5 rounded-full text-[9px]"
                          style={{
                            color: projectMeta[msg.project_id!].color,
                            border: `1px solid ${projectMeta[msg.project_id!].color}`,
                          }}
                        >
                          {projectMeta[msg.project_id!].title}
                        </span>
                      )}
                    </p>
                  )}
                  {isMe && showProjectTag(msg, prevMsg) && (
                    <p className="text-[9px] font-medium mb-1 mr-1 self-end">
                      <span
                        className="px-1.5 rounded-full"
                        style={{
                          color: projectMeta[msg.project_id!].color,
                          border: `1px solid ${projectMeta[msg.project_id!].color}`,
                        }}
                      >
                        {projectMeta[msg.project_id!].title}
                      </span>
                    </p>
                  )}

                  <div
                    className="relative overflow-hidden"
                    style={{
                      backgroundColor: isMe ? 'hsl(var(--primary))' : 'hsl(var(--card))',
                      backgroundImage: isMe
                        ? 'linear-gradient(165deg, hsl(var(--primary)) 0%, hsl(var(--primary) / 0.86) 100%)'
                        : 'none',
                      color: isMe ? 'hsl(var(--background))' : 'hsl(var(--foreground))',
                      border: isMe ? 'none' : '1px solid hsl(var(--border))',
                      boxShadow: [
                        isMe
                          ? '0 1px 2px hsl(var(--background) / 0.25)'
                          : '0 1px 2px hsl(var(--background) / 0.15)',
                        // The project's colour BINDS to every message that
                        // carries its tag (Batch 16 / S-F §2.2).
                        msg.project_id && projectMeta[msg.project_id]
                          ? `inset ${isMe ? '-3px' : '3px'} 0 0 ${projectMeta[msg.project_id].color}`
                          : '',
                      ].filter(Boolean).join(', '),
                      borderRadius: 18,
                      borderTopRightRadius: isMe && prevSame ? 6 : 18,
                      borderBottomRightRadius: isMe ? (nextSame ? 6 : 5) : 18,
                      borderTopLeftRadius: !isMe && prevSame ? 6 : 18,
                      borderBottomLeftRadius: !isMe ? (nextSame ? 6 : 5) : 18,
                    }}
                  >
                    {/* Replied Context */}
                    {repliedMsg && (
                      <div
                        className="mx-2 mt-2 p-1.5 rounded-lg text-[11px] border-l-2 cursor-pointer opacity-90"
                        style={{
                          backgroundColor: isMe ? 'hsl(var(--background) / 0.1)' : 'hsl(var(--background) / 0.3)',
                          borderColor: isMe ? 'hsl(var(--background))' : 'hsl(var(--primary))'
                        }}
                      >
                        <p className="font-semibold mb-0.5 truncate">{repliedMsg.sender_name}</p>
                        <p className="truncate opacity-80">{repliedMsg.body ? stripMentionTokens(repliedMsg.body) : 'Attachment'}</p>
                      </div>
                    )}

                    {/* Loading skeleton — while the signed URL resolves, show a
                        placeholder so an attachment is never a blank bubble. */}
                    {msg.attachment_url && !resolvedAttachUrl && (
                      <div
                        className="m-1.5 flex items-center justify-center rounded-xl"
                        style={{
                          width: isImg || isVid || isPdf ? 256 : 200,
                          height: isImg || isVid || isPdf ? 160 : 56,
                          maxWidth: '100%',
                          backgroundColor: isMe ? 'hsl(var(--background) / 0.12)' : 'hsl(var(--background) / 0.35)',
                        }}
                      >
                        <FileText size={18} className="opacity-30" />
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
                          className="w-full max-h-[300px] object-cover transition-transform duration-300 hover:scale-[1.03]"
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
                          loop
                          playsInline
                          preload="metadata"
                          onMouseEnter={(e) => { void e.currentTarget.play().catch(() => {}) }}
                          onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0 }}
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
                      <div className={`${isJumboEmoji(msg.body) ? 'tl-sticker text-4xl leading-tight px-2.5 py-1.5' : 'text-[13px] leading-[1.45] px-3 py-2'} whitespace-pre-wrap`}>
                        {splitBody(msg.body).map((part: BodyPart, pi: number) => {
                          if (part.type === 'text') return <span key={pi}>{part.text}</span>
                          const resolved = mentionTargets?.[part.kind]?.[part.id]
                          if (part.kind === 'user') {
                            return (
                              <span
                                key={pi}
                                className="font-semibold px-1 rounded"
                                style={{
                                  color: isMe ? 'hsl(var(--background))' : 'hsl(var(--primary))',
                                  backgroundColor: isMe
                                    ? 'hsl(var(--background) / 0.15)'
                                    : 'hsl(var(--primary) / 0.1)',
                                }}
                              >
                                @{resolved?.label ?? part.label}
                              </span>
                            )
                          }
                          // Visibility is per VIEWER: a target resolved to
                          // null renders a restricted chip, never the name.
                          if (resolved === null) {
                            return <span key={pi} className="italic opacity-70">a restricted item</span>
                          }
                          // undefined ≠ restricted: it's a tag the fetch has
                          // not resolved yet — an optimistic send or a
                          // realtime arrival whose id isn't in the map. Fall
                          // back to the label the token itself carries. The
                          // old guard only caught undefined when the WHOLE
                          // map was missing, so the first live project tag
                          // fell through to `card.label` on undefined — a
                          // TypeError that unmounted the entire app to the
                          // error screen on both portals, every time.
                          const card = resolved ?? { label: part.label }
                          const inner = (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 rounded font-semibold"
                              style={{
                                backgroundColor: isMe
                                  ? 'hsl(var(--background) / 0.15)'
                                  : 'hsl(var(--primary) / 0.08)',
                                border: '1px solid ' + (isMe ? 'hsl(var(--background) / 0.25)' : 'hsl(var(--primary) / 0.3)'),
                              }}
                            >
                              {card.label}
                              {card.sub && <span className="opacity-70 font-normal text-[11px]">· {card.sub}</span>}
                            </span>
                          )
                          return card.href ? (
                            <a key={pi} href={card.href} className="hover:opacity-80">{inner}</a>
                          ) : (
                            <span key={pi}>{inner}</span>
                          )
                        })}
                      </div>
                    ) : null}
                    {!msg.body && !editingMsg && msg.attachment_url && (
                      <div className="h-1" /> 
                    )}
                  </div>

                  {/* Reactions (item 4): aggregated chips, yours in gold */}
                  {(msg.reactions?.length ?? 0) > 0 && (
                    <div className={`flex flex-wrap gap-1 mt-1 ${isMe ? 'justify-end mr-1' : 'justify-start ml-1'}`}>
                      {Object.entries(
                        (msg.reactions ?? []).reduce<Record<string, { count: number; mine: boolean }>>((acc, r) => {
                          const cur = acc[r.emoji] ?? { count: 0, mine: false }
                          acc[r.emoji] = { count: cur.count + 1, mine: cur.mine || r.user_id === ownUserId }
                          return acc
                        }, {})
                      ).map(([emoji, agg]) => (
                        <button
                          key={emoji}
                          onClick={() => onToggleReaction?.(msg, emoji)}
                          className="flex items-center gap-0.5 px-1.5 py-[1px] rounded-full text-[10px] transition-colors"
                          style={{
                            backgroundColor: agg.mine ? 'hsl(var(--primary) / 0.15)' : 'hsl(var(--card))',
                            border: agg.mine
                              ? '1px solid hsl(var(--primary) / 0.5)'
                              : '1px solid hsl(var(--border))',
                            color: 'hsl(var(--foreground))',
                          }}
                        >
                          {emoji} <span className="font-semibold">{agg.count}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Thread affordance (item 3): replies live in a panel */}
                  {onOpenThread && replyMeta[msg.id] && (
                    <button
                      onClick={() => onOpenThread(msg)}
                      className={`mt-1 text-[11px] font-semibold flex items-center gap-1 ${isMe ? 'self-end mr-1' : 'self-start ml-1'}`}
                      style={{ color: 'hsl(var(--primary))' }}
                    >
                      ↳ {replyMeta[msg.id].count} {replyMeta[msg.id].count === 1 ? 'reply' : 'replies'}
                      <span style={{ color: 'hsl(var(--text-faint))', fontWeight: 400 }}>
                        · {new Date(replyMeta[msg.id].lastAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </button>
                  )}

                  {/* Meta row — once per group; the run reads as one utterance */}
                  {(!nextSame || msg.edited_at) && (
                    <div className={`text-[9px] mt-0.5 flex items-center gap-1 ${isMe ? 'justify-end mr-1' : 'justify-start ml-1'}`} style={{ color: 'hsl(var(--text-faint))' }}>
                      {new Date(msg.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      {msg.edited_at && <span className="italic">• edited</span>}
                      {isMe && <MessageTicks msg={msg} />}
                    </div>
                  )}
                </div>

              </div>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>
      </div>

      {/* ── Input Area — glass bar, the shell's material ───── */}
      <div
        className="flex-shrink-0 p-3"
        style={{
          borderTop: '1px solid hsl(var(--border))',
          backgroundColor: 'hsl(var(--card) / 0.85)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >

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
                  {replyTo.body ? stripMentionTokens(replyTo.body) : 'Attachment'}
                </span>
              </div>
            </div>
            <button onClick={() => setReplyTo(null)} className="p-1 hover:bg-[hsl(var(--background))] rounded text-[hsl(var(--muted-foreground))]">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Attachment Preview Bar — shows a real thumbnail of what's staged */}
        {attachment && (() => {
          const kind = attachmentKind(attachment.name)
          const previewUrl = urlFor(attachment.url)
          const isMedia = kind === 'image' || kind === 'video'
          return (
            <div className="flex items-center justify-between mb-3 px-3 py-2.5 rounded-xl border" style={{ backgroundColor: 'hsl(var(--primary) / 0.05)', borderColor: 'hsl(var(--primary) / 0.2)' }}>
              <div className="flex items-center gap-3 min-w-0">
                {/* Thumb: image/video preview, or a typed icon for documents */}
                <div
                  className="w-12 h-12 rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: 'hsl(var(--border))' }}
                >
                  {isMedia && previewUrl ? (
                    kind === 'image' ? (
                      <img src={previewUrl} alt={attachment.name} className="w-full h-full object-cover" />
                    ) : (
                      <video src={previewUrl} className="w-full h-full object-cover" muted preload="metadata" />
                    )
                  ) : isMedia && !previewUrl ? (
                    <FileText size={16} className="opacity-40" style={{ color: 'hsl(var(--primary))' }} />
                  ) : kind === 'audio' ? (
                    <Mic size={18} style={{ color: 'hsl(var(--primary))' }} />
                  ) : (
                    <FileText size={18} style={{ color: 'hsl(var(--primary))' }} />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs truncate font-medium" style={{ color: 'hsl(var(--foreground))' }}>
                    {attachment.name}
                  </p>
                  <p className="text-[10px] uppercase tracking-wide mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
                    {isMedia && !previewUrl ? 'Loading preview…' : 'Ready to send'}
                  </p>
                </div>
              </div>
              <button onClick={() => setAttachment(null)} className="p-1 hover:bg-[hsl(var(--border))] rounded text-[hsl(var(--muted-foreground))] flex-shrink-0">
                <X size={14} />
              </button>
            </div>
          )
        })()}

        {/* Sticky project tag (Batch 17): what the next message is filed under.
            In a project view it is locked to that project; in All it is
            additive — it STAYS until changed. */}
        {/* The project selector exists to choose which project a message in
            the ALL view belongs to. Inside a project there is nothing to
            choose, so it is hidden rather than shown disabled. */}
        {!readOnly && !singleProject && onComposerTagChange && (composerTagOptions.length > 0 || composerTag) && (
          <div className="relative mb-2 flex items-center gap-2">
            <button
              type="button"
              disabled={composerTagLocked}
              onClick={() => setTagMenuOpen((v) => !v)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors disabled:cursor-default"
              style={{
                backgroundColor: composerTag ? 'transparent' : 'hsl(var(--background))',
                border: `1px solid ${composerTag ? composerTag.color : 'hsl(var(--border))'}`,
                color: composerTag ? composerTag.color : 'hsl(var(--muted-foreground))',
              }}
              title={composerTagLocked ? 'Messages here belong to this project' : 'File the next message under a project'}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: composerTag ? composerTag.color : 'hsl(var(--text-faint))' }}
              />
              {composerTag ? composerTag.title : 'No project'}
              {!composerTagLocked && <span style={{ opacity: 0.6 }}>▾</span>}
            </button>
            {tagMenuOpen && !composerTagLocked && (
              <div
                className="absolute bottom-8 left-0 z-40 w-56 rounded-xl overflow-hidden shadow-2xl"
                style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
              >
                <button
                  type="button"
                  onClick={() => { onComposerTagChange(null); setTagMenuOpen(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-[hsl(var(--primary)/0.08)]"
                  style={{ color: 'hsl(var(--muted-foreground))' }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'hsl(var(--text-faint))' }} />
                  No project
                </button>
                {composerTagOptions.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => { onComposerTagChange(o.id); setTagMenuOpen(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-[hsl(var(--primary)/0.08)]"
                    style={{ color: 'hsl(var(--foreground))' }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: o.color }} />
                    {o.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {!readOnly && mentionQuery != null && mentionMatches.length > 0 && (
          <div
            className="mb-2 rounded-xl overflow-hidden shadow-xl"
            style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
          >
            {mentionMatches.map((m, i) => (
              <button
                key={`${m.kind}:${m.id}`}
                type="button"
                onClick={() => applyMention(m)}
                className="w-full text-left px-3 py-2 text-sm flex items-center justify-between"
                style={{
                  backgroundColor: i === mentionIndex ? 'hsl(var(--primary) / 0.1)' : 'transparent',
                  color: 'hsl(var(--foreground))',
                }}
              >
                <span className="font-medium truncate">@{m.label}</span>
                <span className="text-[10px] uppercase tracking-wide flex-shrink-0" style={{ color: 'hsl(var(--text-faint))' }}>
                  {m.sub}
                </span>
              </button>
            ))}
          </div>
        )}
        {!readOnly && (
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          {recording ? (
            <VoiceRecorder
              onComplete={handleRecordingComplete}
              onCancel={() => { setRecording(false); onRecordingChange?.(false) }}
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
                disabled={uploading}
                className="w-9 h-9 rounded-xl flex items-center justify-center transition-all disabled:opacity-50"
                style={{
                  backgroundColor: showAttachMenu ? 'hsl(var(--primary))' : 'hsl(var(--border))',
                  color: showAttachMenu ? 'hsl(var(--background))' : 'hsl(var(--muted-foreground))',
                }}
              >
                <Plus
                  size={18}
                  className={`transition-transform duration-200 ${showAttachMenu ? 'rotate-45' : ''} ${uploading ? 'opacity-40' : ''}`}
                />
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

          {/* Emoji picker (Batch 16). data-tl-keep-open covers the trigger AND
              the panel: the outside-tap listener runs in the capture phase, so
              an unmarked trigger would close then immediately re-open. */}
          <div className="relative" data-tl-keep-open>
            <button
              type="button"
              onClick={() => setEmojiOpen((v) => !v)}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-all"
              style={{
                backgroundColor: emojiOpen ? 'hsl(var(--primary))' : 'hsl(var(--border))',
                color: emojiOpen ? 'hsl(var(--background))' : 'hsl(var(--muted-foreground))',
              }}
              title="Emoji"
            >
              <SmilePlus size={17} />
            </button>
            {emojiOpen && (
              <div
                className="absolute bottom-12 left-0 z-30 w-72 rounded-2xl shadow-2xl overflow-hidden"
                style={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
              >
                <div className="flex border-b" style={{ borderColor: 'hsl(var(--border))' }}>
                  {(['emoji', 'stickers'] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setPickerTab(tab)}
                      className="flex-1 py-2 text-[11px] font-semibold uppercase tracking-widest transition-colors"
                      style={{
                        color: pickerTab === tab ? 'hsl(var(--primary))' : 'hsl(var(--text-faint))',
                        boxShadow: pickerTab === tab ? 'inset 0 -2px 0 hsl(var(--primary))' : 'none',
                      }}
                    >
                      {tab === 'emoji' ? 'Emoji' : 'Stickers'}
                    </button>
                  ))}
                </div>
                {pickerTab === 'stickers' && (
                  <div className="grid grid-cols-6 gap-1 p-3 max-h-56 overflow-y-auto scrollbar-thin">
                    {STICKERS.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => {
                          setEmojiOpen(false)
                          void onSendMessage(e).catch(() => {})
                        }}
                        className="text-3xl hover:scale-125 transition-transform py-1"
                        title="Send sticker"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                )}
                {pickerTab === 'emoji' && (
                <div className="p-3 max-h-56 overflow-y-auto scrollbar-thin">
                {EMOJI_GROUPS.map((g) => (
                  <div key={g.label} className="mb-2">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.14em] mb-1" style={{ color: 'hsl(var(--text-faint))' }}>
                      {g.label}
                    </p>
                    <div className="grid grid-cols-10 gap-0.5">
                      {g.emojis.map((e) => (
                        <button
                          key={e}
                          type="button"
                          onClick={() => {
                            setNewMessage((prev) => prev + e)
                            inputRef.current?.focus()
                          }}
                          className="text-lg hover:scale-125 transition-transform"
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                </div>
                )}
              </div>
            )}
          </div>

          {/* Text input — multi-line: Enter sends, Shift+Enter breaks the line */}
          <textarea
            ref={inputRef}
            rows={1}
            value={newMessage}
            onChange={(e) => {
              setNewMessage(e.target.value)
              autosize()
              if (onTyping) onTyping()
              const q = mentionQueryOf(e.target.value)
              setMentionQuery(mentionCandidates && q != null ? q : null)
              setMentionIndex(0)
            }}
            onKeyDown={(e) => {
              if (mentionQuery != null && mentionMatches.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setMentionIndex((i) => (i + 1) % mentionMatches.length)
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length)
                } else if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault()
                  applyMention(mentionMatches[mentionIndex])
                } else if (e.key === 'Escape') {
                  setMentionQuery(null)
                }
                return
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                doSubmit()
              }
            }}
            placeholder={uploading ? 'Uploading…' : recording ? 'Recording…' : 'Write a message'}
            className="flex-1 px-3.5 py-2.5 rounded-xl text-[13px] leading-snug outline-none transition-all resize-none overflow-y-auto scrollbar-thin focus:border-[hsl(var(--primary))] focus:shadow-[0_0_0_3px_hsl(var(--primary)/0.12)]"
            style={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}
            disabled={uploading || recording}
          />

          {/* Voice Record */}
          {onUploadAttachment && (
            <button
              type="button"
              onClick={() => { setRecording(true); onRecordingChange?.(true) }}
              disabled={uploading}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-all disabled:opacity-50"
              style={{ backgroundColor: 'hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}
              title="Voice note"
            >
              <Mic size={16} />
            </button>
          )}

          {/* Send */}
          <button
            type="submit"
            disabled={(!newMessage.trim() && !attachment) || uploading || recording}
            className="w-9 h-9 rounded-xl flex items-center justify-center transition-all disabled:opacity-40 hover:shadow-[0_0_14px_hsl(var(--primary)/0.35)]"
            style={{ backgroundColor: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
            title="Send"
          >
            <Send size={16} />
          </button>
          </>
          )}
        </form>
        )}
      </div>
    </div>
  )
}
