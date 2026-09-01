/**
 * Client-safe mention token helpers — Batch 15 item 5.
 *
 * Tokens live IN the body text: `<@u:uuid|Display>` (u/p/f/t/a =
 * user/project/file/task/approval). The server owns validation and the
 * mention ROWS (lib/messageMentions.ts, I-6); this module only builds and
 * renders the tokens.
 */

export type MentionKindChar = 'u' | 'p' | 'f' | 't' | 'a'

export const MENTION_KINDS: Record<MentionKindChar, 'user' | 'project' | 'file' | 'task' | 'approval'> = {
  u: 'user',
  p: 'project',
  f: 'file',
  t: 'task',
  a: 'approval',
}

const TOKEN_SRC =
  '<@([upfta]):([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:\\|([^>]{0,80}))?>'

export function buildMentionToken(kind: MentionKindChar, id: string, label: string): string {
  return `<@${kind}:${id}|${label.replace(/[|>]/g, ' ').slice(0, 80)}>`
}

export type BodyPart =
  | { type: 'text'; text: string }
  | { type: 'mention'; kind: 'user' | 'project' | 'file' | 'task' | 'approval'; id: string; label: string }

/** Split a body into text runs and mention parts (fresh regex each call). */
export function splitBody(body: string): BodyPart[] {
  const re = new RegExp(TOKEN_SRC, 'g')
  const parts: BodyPart[] = []
  let last = 0
  for (let m = re.exec(body); m; m = re.exec(body)) {
    if (m.index > last) parts.push({ type: 'text', text: body.slice(last, m.index) })
    parts.push({
      type: 'mention',
      kind: MENTION_KINDS[m[1].toLowerCase() as MentionKindChar],
      id: m[2].toLowerCase(),
      label: m[3] || 'mention',
    })
    last = m.index + m[0].length
  }
  if (last < body.length) parts.push({ type: 'text', text: body.slice(last) })
  return parts
}

/** Flatten tokens to `@Label` for previews and notifications. */
export function stripMentionTokens(body: string): string {
  const re = new RegExp(TOKEN_SRC, 'g')
  return body.replace(re, (_, _k, _id, label) => `@${label || 'mention'}`)
}

// ── Trigger preference (Batch 16): '@', '/', or both — device-level ────────

const TRIGGER_KEY = 'genreline-mention-trigger'
export type MentionTrigger = 'at' | 'slash' | 'both'

export function mentionTrigger(): MentionTrigger {
  try {
    const v = localStorage.getItem(TRIGGER_KEY)
    return v === 'at' || v === 'slash' ? v : 'both'
  } catch {
    return 'both'
  }
}

export function setMentionTrigger(t: MentionTrigger): void {
  try {
    localStorage.setItem(TRIGGER_KEY, t)
  } catch { /* non-persistent */ }
}

/** The trailing-token matcher for the composer, per the trigger preference. */
export function mentionQueryOf(text: string): string | null {
  const t = mentionTrigger()
  const chars = t === 'at' ? '@' : t === 'slash' ? '/' : '@/'
  const re = new RegExp(`(?:^|\\s)[${chars}]([^@/\\s]*)$`)
  const m = text.match(re)
  return m ? m[1] : null
}

export function replaceTrailingMentionQuery(text: string, token: string): string {
  return text.replace(/[@/][^@/\s]*$/, token + ' ')
}
