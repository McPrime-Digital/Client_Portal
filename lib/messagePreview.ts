// Renders a one-line chat-list preview for a message, indicating the kind of
// media when there's an attachment (and no text). Mirrors the attachment
// classification in MessageThread so previews match what's rendered in-thread.
// Voice notes are saved as `voice-*.webm`, so they're matched before video.
export function messagePreview(
  msg:
    | { body?: string | null; attachment_name?: string | null; is_deleted?: boolean | null }
    | null
    | undefined
): string {
  if (!msg) return ''
  if (msg.is_deleted) return 'Message deleted'

  const name = (msg.attachment_name || '').toLowerCase()
  let mediaLabel = ''
  if (name) {
    if (/^voice-/.test(name) || /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba|amr)$/.test(name))
      mediaLabel = '🎙 Voice message'
    else if (/\.(jpe?g|png|gif|webp|svg|bmp|avif)$/.test(name)) mediaLabel = '📷 Photo'
    else if (/\.(mp4|mov|avi|mkv|m4v|ogv|webm)$/.test(name)) mediaLabel = '🎥 Video'
    else if (/\.pdf$/.test(name)) mediaLabel = '📄 PDF'
    else if (/\.(docx?|txt|rtf|odt|pages|md)$/.test(name)) mediaLabel = '📄 Document'
    else if (/\.(xlsx?|csv|numbers)$/.test(name)) mediaLabel = '📊 Spreadsheet'
    else if (/\.(zip|rar|7z|tar|gz)$/.test(name)) mediaLabel = '🗜 Archive'
    else mediaLabel = `📎 ${msg.attachment_name}`
  }

  const body = (msg.body || '').trim()
  if (body) return body
  return mediaLabel
}
