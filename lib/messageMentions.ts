import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendPushToUser } from '@/lib/push'

/**
 * Mentions — Batch 15 item 5 (S3-core §1.5, S-F §2.3).
 *
 * The composer embeds opaque tokens in the body — `<@u:uuid|Name>` for a
 * person, `<@p:uuid|Title>` for a project (files `f:`, tasks `t:` render
 * when present; approvals wait for their table). The SERVER parses the body
 * at send time, validates every target against the caller's tenant, and
 * writes message_mentions itself — the request never supplies a mention row
 * (I-6, the same rule as the activity ledger in 6.1 and the attachment FK
 * in 14.4). An invalid target simply does not become a mention; the token
 * degrades to its embedded display text.
 */

export const MENTION_RE = /<@([upfta]):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\|([^>]{0,80}))?>/gi

const KIND_MAP: Record<string, 'user' | 'project' | 'file' | 'task' | 'approval'> = {
  u: 'user',
  p: 'project',
  f: 'file',
  t: 'task',
  a: 'approval',
}

export type ParsedMention = {
  kind: 'user' | 'project' | 'file' | 'task' | 'approval'
  targetId: string
}

export function parseMentions(body: string): ParsedMention[] {
  const out: ParsedMention[] = []
  const seen = new Set<string>()
  for (const m of body.matchAll(MENTION_RE)) {
    const kind = KIND_MAP[m[1].toLowerCase()]
    const targetId = m[2].toLowerCase()
    const key = `${kind}:${targetId}`
    if (!kind || seen.has(key)) continue
    seen.add(key)
    out.push({ kind, targetId })
  }
  return out.slice(0, 20) // a message is not a mailing list
}

/**
 * Validate against the room's tenant and write the rows. Users must be on a
 * roster that belongs in this room (the company's members or the org's
 * crew); projects/files/tasks must belong to the company/org. Approvals are
 * refused until their table exists (migrations 8–9). Returns the user ids
 * that were validly mentioned, for notification.
 */
export async function writeMentions(
  db: SupabaseClient,
  opts: {
    messageId: string
    body: string
    orgId: string
    clientId: string | null
  }
): Promise<{ id: string; side: 'client' | 'crew' }[]> {
  const parsed = parseMentions(opts.body)
  if (parsed.length === 0) return []

  const rows: { message_id: string; kind: string; target_id: string }[] = []
  const mentionedUsers: { id: string; side: 'client' | 'crew' }[] = []

  for (const m of parsed) {
    let ok = false
    if (m.kind === 'user') {
      const [{ data: cm }, { data: om }] = await Promise.all([
        opts.clientId
          ? db
              .from('client_members')
              .select('id')
              .eq('client_id', opts.clientId)
              .eq('user_id', m.targetId)
              .eq('status', 'active')
              .maybeSingle()
          : Promise.resolve({ data: null }),
        db
          .from('organization_members')
          .select('id')
          .eq('organization_id', opts.orgId)
          .eq('user_id', m.targetId)
          .eq('status', 'active')
          .maybeSingle(),
      ])
      ok = !!cm || !!om
      if (ok) mentionedUsers.push({ id: m.targetId, side: cm ? 'client' : 'crew' })
    } else if (m.kind === 'project') {
      const { data } = await db
        .from('projects')
        .select('id, organization_id, client_id')
        .eq('id', m.targetId)
        .maybeSingle()
      ok = !!data && data.organization_id === opts.orgId &&
        (!opts.clientId || data.client_id === opts.clientId)
    } else if (m.kind === 'file') {
      const { data } = await db
        .from('files')
        .select('id, organization_id, client_id')
        .eq('id', m.targetId)
        .maybeSingle()
      ok = !!data && data.organization_id === opts.orgId &&
        (!opts.clientId || data.client_id === opts.clientId)
    } else if (m.kind === 'task') {
      const { data } = await db
        .from('tasks')
        .select('id, organization_id')
        .eq('id', m.targetId)
        .maybeSingle()
      ok = !!data && data.organization_id === opts.orgId
    }
    // approvals: refused until the engine lands (migrations 8–9)
    if (ok) rows.push({ message_id: opts.messageId, kind: m.kind, target_id: m.targetId })
  }

  if (rows.length > 0) {
    const { error } = await db.from('message_mentions').insert(rows)
    if (error) throw new Error(`message_mentions write failed: ${error.message}`)
  }
  return mentionedUsers
}

/**
 * A mention is a direct address: push the mentioned people, honouring their
 * room preference — 'muted' silences even mentions; 'all' and 'mentions'
 * both deliver (that is what the 'mentions' level is FOR — item 6).
 */
export async function notifyMentions(
  db: SupabaseClient,
  opts: {
    roomId: string | null
    mentionedUsers: { id: string; side: 'client' | 'crew' }[]
    senderUserId: string
    senderName: string
    preview: string
  }
): Promise<void> {
  const targets = opts.mentionedUsers.filter((u) => u.id !== opts.senderUserId)
  if (targets.length === 0) return

  let muted = new Set<string>()
  if (opts.roomId) {
    const { data: prefs } = await db
      .from('message_room_prefs')
      .select('user_id, level')
      .eq('room_id', opts.roomId)
      .in('user_id', targets.map((t) => t.id))
    muted = new Set((prefs ?? []).filter((p) => p.level === 'muted').map((p) => p.user_id))
  }

  await Promise.all(
    targets
      .filter((u) => !muted.has(u.id))
      .map((u) =>
        sendPushToUser(u.id, {
          title: `${opts.senderName} mentioned you`,
          body: opts.preview || undefined,
          url: u.side === 'crew' ? '/studio/client/messages' : '/messages',
          tag: 'mention',
        }).catch(() => {})
      )
  )
}

// ── Per-viewer resolution (render side) ─────────────────────────────────────

export type MentionTarget = { label: string; sub?: string; href?: string } | null
export type MentionTargets = Record<'user' | 'project' | 'file' | 'task' | 'approval', Record<string, MentionTarget>>

/**
 * Resolve mention targets for ONE viewer. "A mention can only reference
 * something the recipient can see": a project a scoped teammate is not
 * allowed to see resolves to null, and the renderer shows a restricted chip
 * instead of the name. Resolution happens per REQUEST — never at send time,
 * because two viewers of one message may see different things.
 */
export async function resolveMentionTargets(
  db: SupabaseClient,
  mentions: { kind: string; target_id: string }[],
  viewer: {
    role: 'admin' | 'client'
    orgId: string
    clientId?: string | null
    visibleProjectIds?: string[] | null
    projectHrefBase: string
  }
): Promise<MentionTargets> {
  const out: MentionTargets = { user: {}, project: {}, file: {}, task: {}, approval: {} }
  const byKind: Record<string, Set<string>> = {}
  for (const m of mentions) (byKind[m.kind] ??= new Set()).add(m.target_id)

  const canSeeProject = (pid: string | null | undefined) =>
    viewer.role === 'admin' ||
    !viewer.visibleProjectIds ||
    (pid != null && viewer.visibleProjectIds.includes(pid))

  if (byKind.user?.size) {
    const ids = [...byKind.user]
    const [{ data: cms }, { data: oms }] = await Promise.all([
      viewer.clientId
        ? db.from('client_members').select('user_id, name').eq('client_id', viewer.clientId).in('user_id', ids)
        : Promise.resolve({ data: [] as { user_id: string; name: string }[] }),
      db.from('organization_members').select('user_id, name').eq('organization_id', viewer.orgId).in('user_id', ids),
    ])
    for (const id of ids) out.user[id] = null
    for (const r of oms ?? []) out.user[r.user_id] = { label: r.name }
    for (const r of cms ?? []) out.user[r.user_id] = { label: r.name }
  }

  if (byKind.project?.size) {
    const ids = [...byKind.project]
    let q = db.from('projects').select('id, title, status').in('id', ids).eq('organization_id', viewer.orgId)
    if (viewer.role === 'client' && viewer.clientId) q = q.eq('client_id', viewer.clientId)
    const { data } = await q
    for (const id of ids) out.project[id] = null
    for (const p of data ?? []) {
      if (viewer.role === 'client' && viewer.visibleProjectIds && !viewer.visibleProjectIds.includes(p.id)) continue
      out.project[p.id] = { label: p.title, sub: p.status, href: `${viewer.projectHrefBase}/${p.id}` }
    }
  }

  if (byKind.file?.size) {
    const ids = [...byKind.file]
    let q = db.from('files').select('id, file_name, project_id').in('id', ids).eq('organization_id', viewer.orgId)
    if (viewer.role === 'client' && viewer.clientId) q = q.eq('client_id', viewer.clientId)
    const { data } = await q
    for (const id of ids) out.file[id] = null
    for (const f of data ?? []) {
      if (viewer.role === 'client' && !canSeeProject(f.project_id) && f.project_id != null) continue
      out.file[f.id] = { label: f.file_name, sub: 'File' }
    }
  }

  if (byKind.task?.size) {
    const ids = [...byKind.task]
    let q = db.from('tasks').select('id, title, status, project_id, visible_to_client').in('id', ids).eq('organization_id', viewer.orgId)
    const { data } = await q
    for (const id of ids) out.task[id] = null
    for (const t of data ?? []) {
      if (viewer.role === 'client' && (!t.visible_to_client || !canSeeProject(t.project_id))) continue
      out.task[t.id] = {
        label: t.title,
        sub: t.status,
        href: t.project_id ? `${viewer.projectHrefBase}/${t.project_id}?tab=tasks` : undefined,
      }
    }
  }

  for (const id of byKind.approval ?? []) out.approval[id] = null
  return out
}
