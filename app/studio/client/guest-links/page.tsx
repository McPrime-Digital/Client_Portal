import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth/role'
import { requireOrgFeature } from '@/lib/studio/guard'
import { capGate } from '@/lib/capabilities.server'
import { listShareLinks, linkState } from '@/lib/shareLinks'
import GuestLinks, { type LinkRow, type ViewRowView } from '@/components/studio/GuestLinks'

/**
 * CLIENT · GUEST REVIEW LINKS — the screening room, studio side.
 *
 * NO SERVICE-ROLE CLIENT ANYWHERE ON THIS PAGE. 0085's crew policy is the
 * tenant boundary and project scope reaches the files through 0059, so a
 * freelance colourist sees the links on their own production and nothing else —
 * which is the whole point of a surface that hands assets to outsiders.
 *
 * ── THE VIEWS ARE READ IN ONE QUERY, NOT ONE PER LINK ────────────────────
 *
 * `listViews` exists for a single link's page. A list of forty links would be
 * forty round trips, which is the N+1 `listApprovalChains` was written to avoid
 * on the Review surface; the same argument applies here and the fix is the same
 * shape — one `in (...)` and a group in memory.
 */
export default async function GuestLinksPage() {
  await requireOrgFeature('client', 'guest-links')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdmin(user)) redirect('/login')

  const denied = await capGate(user, 'work.file.share')
  if (denied) redirect('/studio')

  const links = await listShareLinks(supabase)
  const ids = links.map((l) => l.id)
  const subjectIds = [...new Set(links.map((l) => l.subject_id))]

  const [{ data: views }, { data: named }, { data: candidates }] = await Promise.all([
    ids.length
      ? supabase.from('share_link_views')
          .select('id, link_id, viewer_email, viewer_name, started_at, seconds_watched, furthest_ms, duration_ms')
          .in('link_id', ids).order('started_at', { ascending: false }).limit(1000)
      : Promise.resolve({ data: [] as unknown[] }),
    // The names of what is already shared, so a withdrawn link still says what
    // it was for. Soft-deleted files included deliberately — a link to a file
    // somebody has since binned is exactly the row you want to be able to read.
    subjectIds.length
      ? supabase.from('files').select('id, file_name').in('id', subjectIds)
      : Promise.resolve({ data: [] as unknown[] }),
    // What may be shared NEXT. Video only: the player is a <video> element, and
    // offering a PDF here would produce a link that resolves and cannot play.
    supabase.from('files')
      .select('id, file_name, mime_type, project_id, projects(title)')
      .eq('bucket', 'r2').is('deleted_at', null)
      .like('mime_type', 'video/%')
      .order('created_at', { ascending: false }).limit(300),
  ])

  const nameById = new Map(
    (named ?? []).map((f) => [(f as { id: string }).id, (f as { file_name: string }).file_name])
  )

  const byLink = new Map<string, ViewRowView[]>()
  for (const raw of (views ?? []) as unknown[]) {
    const v = raw as {
      id: string; link_id: string; viewer_email: string | null; viewer_name: string | null
      started_at: string; seconds_watched: number; furthest_ms: number; duration_ms: number | null
    }
    const list = byLink.get(v.link_id) ?? []
    list.push({
      id: v.id,
      // The email is what the watermark bore, so it is what the record should
      // say. "Someone" is honest where nothing was given — never a fabricated
      // name, which is the one thing a viewing record must not contain.
      who: v.viewer_name || v.viewer_email || 'Someone (no details given)',
      startedAt: v.started_at,
      secondsWatched: v.seconds_watched,
      furthestMs: v.furthest_ms,
      durationMs: v.duration_ms,
    })
    byLink.set(v.link_id, list)
  }

  const rows: LinkRow[] = links.map((l) => ({
    id: l.id,
    title: l.title,
    fileName: nameById.get(l.subject_id) ?? null,
    state: linkState(l),
    expiresAt: l.expires_at,
    maxViews: l.max_views,
    viewCount: l.view_count,
    watermark: l.watermark,
    requireEmail: l.require_email,
    allowDownload: l.allow_download,
    // The hash never leaves the server — only the FACT that one is set.
    hasPasscode: !!l.passcode_hash,
    createdAt: l.created_at,
    views: byLink.get(l.id) ?? [],
  }))

  const files = ((candidates ?? []) as unknown[]).map((raw) => {
    const f = raw as {
      id: string; file_name: string
      projects: { title: string } | { title: string }[] | null
    }
    const p = Array.isArray(f.projects) ? f.projects[0] : f.projects
    return { id: f.id, name: f.file_name, project: p?.title ?? null }
  })

  return (
    <div className="mx-auto max-w-3xl">
      <GuestLinks links={rows} files={files} />
    </div>
  )
}
